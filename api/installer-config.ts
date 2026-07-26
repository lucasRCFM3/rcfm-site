import { resolveInstallerConfig } from "../server/installerConfig.js";

type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  json(body: unknown): void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const fileName = typeof request.query?.fileName === "string" ? request.query.fileName : "";
  response.setHeader("Cache-Control", "no-store");
  if (!fileName) {
    return response.status(400).json({ error: "Nome do instalador ausente." });
  }

  try {
    return response.status(200).json(await resolveInstallerConfig(fileName));
  } catch (error) {
    return response.status(404).json({
      error: error instanceof Error ? error.message : "Não foi possível localizar a configuração.",
    });
  }
}
