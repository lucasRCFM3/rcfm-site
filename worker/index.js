const isMediaFireHost = (hostname) =>
  hostname === "mediafire.com" || hostname.endsWith(".mediafire.com");

const isDownloadHost = (hostname) =>
  hostname.startsWith("download") && isMediaFireHost(hostname);

const mediaFireUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const getStableMediaFireUrl = (sourceUrl) => {
  if (!isDownloadHost(sourceUrl.hostname)) return sourceUrl;

  const quickKey = sourceUrl.pathname.split("/").filter(Boolean).at(-2);
  if (!quickKey || !/^[a-zA-Z0-9]{8,}$/.test(quickKey)) return sourceUrl;
  return new URL(`https://www.mediafire.com/file/${quickKey}`);
};

const extractMediaFireDirectLink = (page) => {
  const anchorTags = page.match(/<a\b[^>]*>/gi) ?? [];
  const anchor = anchorTags.find((tag) => {
    const id = tag.match(/\bid\s*=\s*(["'])(.*?)\1/i)?.[2];
    const classes =
      tag.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2]?.split(/\s+/) ?? [];
    return id === "downloadButton"
      || (classes.includes("input") && classes.includes("popsok"));
  });

  return anchor
    ?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]
    ?.replaceAll("&amp;", "&");
};

const downloadError = (message, status) => new Response(message, {
  status,
  headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  },
});

async function resolveMediaFireDownload(url) {
  const rawUrl = url.searchParams.get("url");
  if (!rawUrl) return downloadError("Link do instalador ausente.", 400);

  let sourceUrl;
  try {
    sourceUrl = new URL(rawUrl);
  } catch {
    return downloadError("Link do instalador inválido.", 400);
  }
  if (sourceUrl.protocol !== "https:" || !isMediaFireHost(sourceUrl.hostname)) {
    return downloadError("O link informado não pertence ao MediaFire.", 400);
  }

  try {
    const upstream = await fetch(getStableMediaFireUrl(sourceUrl), {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": mediaFireUserAgent,
      },
      redirect: "follow",
    });
    const finalUrl = new URL(upstream.url);
    if (isDownloadHost(finalUrl.hostname)) {
      return Response.redirect(finalUrl.toString(), 302);
    }

    const directLink = extractMediaFireDirectLink(await upstream.text());
    if (!directLink) {
      return downloadError("Não foi possível resolver o download no MediaFire.", 502);
    }

    const downloadUrl = new URL(directLink);
    if (!isDownloadHost(downloadUrl.hostname)) {
      return downloadError("O MediaFire retornou um destino inválido.", 502);
    }
    return Response.redirect(downloadUrl.toString(), 302);
  } catch {
    return downloadError("Não foi possível conectar ao MediaFire.", 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/mediafire-download") {
      return resolveMediaFireDownload(url);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || request.method !== "GET") {
      return assetResponse;
    }

    // Fallback de SPA para rotas abertas diretamente.
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
