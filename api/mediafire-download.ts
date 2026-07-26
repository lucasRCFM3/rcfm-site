type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  send(body: string): void;
  redirect(statusOrUrl: number | string, url?: string): void;
};

const isMediaFireHost = (hostname: string) =>
  hostname === "mediafire.com" || hostname.endsWith(".mediafire.com");
const isDownloadHost = (hostname: string) => hostname.startsWith("download") && isMediaFireHost(hostname);

const fail = (response: VercelResponse, status: number, message: string) => {
  response.setHeader("Cache-Control", "no-store");
  response.status(status).send(message);
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const rawUrl = typeof request.query?.url === "string" ? request.query.url : undefined;
  if (!rawUrl) return fail(response, 400, "Link do instalador ausente.");

  let sourceUrl: URL;
  try { sourceUrl = new URL(rawUrl); } catch { return fail(response, 400, "Link do instalador inválido."); }
  if (sourceUrl.protocol !== "https:" || !isMediaFireHost(sourceUrl.hostname)) {
    return fail(response, 400, "O link informado não pertence ao MediaFire.");
  }

  try {
    const upstream = await fetch(sourceUrl, {
      headers: { accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const finalUrl = new URL(upstream.url);
    if (isDownloadHost(finalUrl.hostname)) return response.redirect(302, finalUrl.toString());

    const page = (await upstream.text()).replaceAll("\\/", "/").replaceAll("&amp;", "&");
    const directLink = page.match(/https?:\/\/download[^"'<>\s]+\.mediafire\.com\/[^"'<>\s]+/i)?.[0];
    if (!directLink) return fail(response, 502, "Não foi possível resolver o download no MediaFire.");

    const downloadUrl = new URL(directLink);
    if (!isDownloadHost(downloadUrl.hostname)) return fail(response, 502, "O MediaFire retornou um destino inválido.");
    return response.redirect(302, downloadUrl.toString());
  } catch {
    return fail(response, 502, "Não foi possível conectar ao MediaFire.");
  }
}
