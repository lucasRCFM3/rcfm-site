const API_PREFIX = "/api/cloud-save";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SAVE_BYTES = 250 * 1024 * 1024;
const MAX_BACKUPS_PER_GAME = 3;
const PASSWORD_ITERATIONS = 600_000;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const apiError = (message, status = 400) => json({ error: message }, status);

const base64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const fromBase64Url = (value) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0),
);

const bytesToHex = (bytes) => [...new Uint8Array(bytes)]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

const randomId = (bytes = 20) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
};

const sha256 = async (value) => bytesToHex(await crypto.subtle.digest("SHA-256", value));

async function hashPassword(password, salt = randomId(16)) {
  const passwordKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: fromBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  }, passwordKey, 256);
  return { salt, hash: base64Url(new Uint8Array(bits)) };
}

const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const safeGameId = (id) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,160}$/.test(id);

const readJson = async (request) => {
  try { return await request.json(); } catch { return null; }
};

async function createSession(env, userId) {
  const token = randomId(32);
  const tokenHash = await sha256(new TextEncoder().encode(token));
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO cloud_save_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(randomId(), userId, tokenHash, expiresAt, new Date().toISOString()).run();
  return { token, expiresAt };
}

async function requireSession(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256(new TextEncoder().encode(token));
  const session = await env.DB.prepare(
    `SELECT sessions.id AS session_id, users.id AS user_id, users.email
     FROM cloud_save_sessions AS sessions
     JOIN cloud_save_users AS users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  ).bind(tokenHash, new Date().toISOString()).first();
  return session ? { ...session, tokenHash } : null;
}

function configured(env) {
  return Boolean(env.DB && env.SAVES);
}

async function register(request, env) {
  const payload = await readJson(request);
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!validEmail(email)) return apiError("Informe um e-mail válido.");
  if (password.length < 8 || password.length > 256) {
    return apiError("A senha precisa ter entre 8 e 256 caracteres.");
  }
  const existing = await env.DB.prepare("SELECT id FROM cloud_save_users WHERE email = ?").bind(email).first();
  if (existing) return apiError("Este e-mail já possui uma conta.", 409);

  const userId = randomId();
  const passwordRecord = await hashPassword(password);
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO cloud_save_users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(userId, email, passwordRecord.hash, passwordRecord.salt, createdAt).run();
  const session = await createSession(env, userId);
  return json({ token: session.token, expiresAt: session.expiresAt, user: { id: userId, email } }, 201);
}

async function login(request, env) {
  const payload = await readJson(request);
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, password_salt FROM cloud_save_users WHERE email = ?",
  ).bind(email).first();
  if (!user) return apiError("E-mail ou senha incorretos.", 401);
  const candidate = await hashPassword(password, user.password_salt);
  if (candidate.hash !== user.password_hash) return apiError("E-mail ou senha incorretos.", 401);
  const session = await createSession(env, user.id);
  return json({ token: session.token, expiresAt: session.expiresAt, user: { id: user.id, email: user.email } });
}

async function listBackups(env, userId, gameId) {
  const result = await env.DB.prepare(
    `SELECT id, size_bytes AS sizeBytes, file_count AS fileCount, sha256, created_at AS createdAt
     FROM cloud_save_backups WHERE user_id = ? AND game_id = ? ORDER BY created_at DESC`,
  ).bind(userId, gameId).all();
  return result.results || [];
}

async function uploadBackup(request, env, session, gameId) {
  if (!request.body) return apiError("Arquivo de save ausente.");
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength && (!Number.isFinite(contentLength) || contentLength > MAX_SAVE_BYTES)) {
    return apiError("O save excede o limite de 250 MB.", 413);
  }
  const sizeBytes = Number(request.headers.get("x-rcfm-save-size") || contentLength || 0);
  const fileCount = Number(request.headers.get("x-rcfm-save-file-count") || 0);
  const checksum = request.headers.get("x-rcfm-save-sha256") || "";
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_SAVE_BYTES || !/^[a-f0-9]{64}$/i.test(checksum)) {
    return apiError("Metadados do save inválidos.");
  }
  const backupId = randomId();
  const objectKey = `cloud-saves/${session.user_id}/${gameId}/${backupId}.zip`;
  await env.SAVES.put(objectKey, request.body, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { userId: session.user_id, gameId, sha256: checksum.toLowerCase() },
  });
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO cloud_save_backups
       (id, user_id, game_id, object_key, size_bytes, file_count, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(backupId, session.user_id, gameId, objectKey, sizeBytes, Math.max(0, fileCount), checksum.toLowerCase(), createdAt).run();

  const backups = await listBackups(env, session.user_id, gameId);
  for (const staleBackup of backups.slice(MAX_BACKUPS_PER_GAME)) {
    await env.SAVES.delete(`cloud-saves/${session.user_id}/${gameId}/${staleBackup.id}.zip`);
    await env.DB.prepare("DELETE FROM cloud_save_backups WHERE id = ? AND user_id = ?")
      .bind(staleBackup.id, session.user_id).run();
  }
  return json({ id: backupId, sizeBytes, fileCount: Math.max(0, fileCount), sha256: checksum.toLowerCase(), createdAt }, 201);
}

async function downloadBackup(env, session, gameId, backupId) {
  const backup = await env.DB.prepare(
    "SELECT object_key, size_bytes, sha256 FROM cloud_save_backups WHERE id = ? AND user_id = ? AND game_id = ?",
  ).bind(backupId, session.user_id, gameId).first();
  if (!backup) return apiError("Backup não encontrado.", 404);
  const object = await env.SAVES.get(backup.object_key);
  if (!object) return apiError("Arquivo do backup não encontrado.", 404);
  return new Response(object.body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(backup.size_bytes),
      "x-rcfm-save-sha256": backup.sha256,
      "cache-control": "no-store",
    },
  });
}

async function cloudSaveApi(request, env, url) {
  if (!configured(env)) return apiError("O serviço de saves ainda não foi configurado.", 503);
  const path = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, "") || "/";
  if (request.method === "POST" && path === "/auth/register") return register(request, env);
  if (request.method === "POST" && path === "/auth/login") return login(request, env);

  const session = await requireSession(request, env);
  if (!session) return apiError("Sessão expirada ou inválida.", 401);
  if (request.method === "POST" && path === "/auth/logout") {
    await env.DB.prepare("DELETE FROM cloud_save_sessions WHERE id = ?").bind(session.session_id).run();
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET" && path === "/me") return json({ user: { id: session.user_id, email: session.email } });

  const match = path.match(/^\/games\/([^/]+)\/backups(?:\/([^/]+))?$/);
  if (!match || !safeGameId(decodeURIComponent(match[1]))) return apiError("Rota de save inválida.", 404);
  const gameId = decodeURIComponent(match[1]);
  const backupId = match[2] ? decodeURIComponent(match[2]) : undefined;
  if (request.method === "GET" && !backupId) return json({ backups: await listBackups(env, session.user_id, gameId) });
  if (request.method === "POST" && !backupId) return uploadBackup(request, env, session, gameId);
  if (request.method === "GET" && backupId) return downloadBackup(env, session, gameId, backupId);
  return apiError("Método não suportado.", 405);
}

const isMediaFireHost = (hostname) => hostname === "mediafire.com" || hostname.endsWith(".mediafire.com");
const isDownloadHost = (hostname) => hostname.startsWith("download") && isMediaFireHost(hostname);
const mediaFireUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const getStableMediaFireUrl = (sourceUrl) => {
  if (!isDownloadHost(sourceUrl.hostname)) return sourceUrl;
  const quickKey = sourceUrl.pathname.split("/").filter(Boolean).at(-2);
  return quickKey && /^[a-zA-Z0-9]{8,}$/.test(quickKey) ? new URL(`https://www.mediafire.com/file/${quickKey}`) : sourceUrl;
};
const extractMediaFireDirectLink = (page) => (page.match(/<a\b[^>]*>/gi) ?? []).find((tag) =>
  tag.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2] === "downloadButton" || (tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2]?.split(/\s+/) ?? []).includes("popsok"),
)?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]?.replaceAll("&amp;", "&");

async function resolveMediaFireDownload(url) {
  const rawUrl = url.searchParams.get("url");
  const asJson = url.searchParams.get("format") === "json";
  if (!rawUrl) return new Response("Link do instalador ausente.", { status: 400 });
  let sourceUrl; try { sourceUrl = new URL(rawUrl); } catch { return new Response("Link inválido.", { status: 400 }); }
  if (sourceUrl.protocol !== "https:" || !isMediaFireHost(sourceUrl.hostname)) return new Response("Link não pertence ao MediaFire.", { status: 400 });
  const upstream = await fetch(getStableMediaFireUrl(sourceUrl), { headers: { accept: "text/html", "user-agent": mediaFireUserAgent }, redirect: "follow" });
  const directLink = isDownloadHost(new URL(upstream.url).hostname) ? upstream.url : extractMediaFireDirectLink(await upstream.text());
  if (!directLink || !isDownloadHost(new URL(directLink).hostname)) return new Response("Não foi possível resolver o download.", { status: 502 });
  return asJson ? json({ downloadUrl: directLink }) : Response.redirect(directLink, 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API_PREFIX)) return cloudSaveApi(request, env, url);
    if (url.pathname === "/api/mediafire-download") return resolveMediaFireDownload(url);
    const assetResponse = await env.ASSETS.fetch(request);
    return assetResponse.status !== 404 || request.method !== "GET"
      ? assetResponse
      : env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
