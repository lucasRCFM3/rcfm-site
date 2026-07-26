type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};

type FirestoreRunQueryItem = {
  document?: {
    name?: string;
    fields?: Record<string, FirestoreValue>;
  };
};

const FIREBASE_PROJECT_ID = "rcfm-launcher";
const FIREBASE_API_KEY = "AIzaSyDMx2qzC--Zy-sUMNSbVIsDiL5be9xeTfo";
const FIRESTORE_RUN_QUERY_URL =
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;

const decodeFirestoreValue = (value?: FirestoreValue): unknown => {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  if (value.mapValue) return decodeFirestoreFields(value.mapValue.fields ?? {});
  return undefined;
};

const decodeFirestoreFields = (fields: Record<string, FirestoreValue>) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));

const normalizeApostrophes = (value: string) =>
  value.normalize("NFC").replace(/[\u0060\u00b4\u02bc\u2018\u2019\u201a\u201b\u2032\uff07]/g, "'");

const safeFileStem = (value: string) =>
  normalizeApostrophes(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/[. ]+$/g, "");

const parseInstallerFileName = (fileName: string) => {
  const stem = fileName.trim().replace(/\.exe$/i, "");
  const separatorIndex = stem.lastIndexOf(" - ");
  if (separatorIndex <= 0 || separatorIndex >= stem.length - 3) {
    throw new Error("O nome do instalador não contém jogo e patch.");
  }
  return {
    title: normalizeApostrophes(stem.slice(0, separatorIndex).trim()),
    patch: stem.slice(separatorIndex + 3).trim(),
  };
};

const asStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
};

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export async function resolveInstallerConfig(fileName: string) {
  const lookup = parseInstallerFileName(fileName);
  const queryResponse = await fetch(FIRESTORE_RUN_QUERY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "versions", allDescendants: true }],
      },
    }),
  });

  if (!queryResponse.ok) {
    throw new Error(`O catálogo respondeu com HTTP ${queryResponse.status}.`);
  }

  const queryItems = await queryResponse.json() as FirestoreRunQueryItem[];
  const candidates = queryItems
    .filter(item => item.document?.fields)
    .map(item => ({
      id: item.document?.name?.split("/").at(-1) ?? "",
      isGame: item.document?.name?.includes("/documents/games/") === true,
      data: decodeFirestoreFields(item.document!.fields!),
    }))
    .filter(candidate =>
      candidate.isGame
      && normalizeApostrophes(String(candidate.data.title ?? "")) === lookup.title
      && (candidate.data.type === "Game" || candidate.data.type === undefined)
    );

  const matchingCandidate = candidates.find(candidate =>
    safeFileStem(String(candidate.data.patch ?? "")) === lookup.patch
  );
  if (!matchingCandidate) {
    throw new Error(`Nenhuma versão de "${lookup.title}" com patch "${lookup.patch}" foi encontrada.`);
  }

  const data = matchingCandidate.data;
  const downloadLinks = data.downloadLinks && typeof data.downloadLinks === "object"
    ? data.downloadLinks as Record<string, unknown>
    : {};
  const manifestUrl = typeof downloadLinks.manifestUrl === "string" ? downloadLinks.manifestUrl : "";
  const chunkUrls = asStringRecord(downloadLinks.chunkUrls);
  if (!manifestUrl || Object.keys(chunkUrls).length === 0) {
    throw new Error("A versão encontrada não possui manifest e chunks configurados.");
  }

  return {
    formatVersion: 2,
    gameId: matchingCandidate.id || String(data.appId ?? ""),
    title: String(data.title ?? lookup.title),
    coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : "",
    heroUrl: typeof data.heroUrl === "string" ? data.heroUrl : "",
    manifestUrl,
    chunkUrls,
    typeck: typeof data.typeck === "string" ? data.typeck : "Nenhum",
    onlineCrackUrl: typeof data.onlineCrackUrl === "string" ? data.onlineCrackUrl : null,
    offlineCrackUrl: typeof data.offlineCrackUrl === "string" ? data.offlineCrackUrl : null,
    onlineCrackFiles: asStringArray(data.onlineCrackFiles),
    offlineCrackFiles: asStringArray(data.offlineCrackFiles),
  };
}
