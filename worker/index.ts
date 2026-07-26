/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const isMediaFireHost = (hostname: string) =>
  hostname === "mediafire.com" || hostname.endsWith(".mediafire.com");
const isDownloadHost = (hostname: string) => hostname.startsWith("download") && isMediaFireHost(hostname);
const mediaFireUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// Espelha o seletor do launcher: a#downloadButton[href], a.input.popsok[href].
const extractMediaFireDirectLink = (page: string) => {
  const anchorTags = page.match(/<a\b[^>]*>/gi) ?? [];
  const anchor = anchorTags.find((tag) => {
    const id = tag.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2];
    const classes = tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2]?.split(/\s+/) ?? [];
    return id === "downloadButton" || (classes.includes("input") && classes.includes("popsok"));
  });

  return anchor
    ?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]
    ?.replaceAll("&amp;", "&");
};

const downloadError = (message: string, status: number) => new Response(message, {
  status,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
});

async function resolveMediaFireDownload(url: URL): Promise<Response> {
  const rawUrl = url.searchParams.get("url");
  if (!rawUrl) return downloadError("Link do instalador ausente.", 400);

  let sourceUrl: URL;
  try { sourceUrl = new URL(rawUrl); } catch { return downloadError("Link do instalador inválido.", 400); }
  if (sourceUrl.protocol !== "https:" || !isMediaFireHost(sourceUrl.hostname)) {
    return downloadError("O link informado não pertence ao MediaFire.", 400);
  }

  const upstream = await fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": mediaFireUserAgent,
    },
    redirect: "follow",
  });
  const finalUrl = new URL(upstream.url);
  if (isDownloadHost(finalUrl.hostname)) return Response.redirect(finalUrl.toString(), 302);

  const directLink = extractMediaFireDirectLink(await upstream.text());
  if (!directLink) return downloadError("Não foi possível resolver o download no MediaFire.", 502);

  const downloadUrl = new URL(directLink);
  if (!isDownloadHost(downloadUrl.hostname)) return downloadError("O MediaFire retornou um destino inválido.", 502);
  return Response.redirect(downloadUrl.toString(), 302);
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/mediafire-download") return resolveMediaFireDownload(url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
