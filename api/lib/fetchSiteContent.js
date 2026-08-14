// assay-engine-generalization-v1 — extracted out of api/assay.js before that
// file's deletion. This function has nothing to do with fintech-specific
// scoring; it's a generic site-content fetcher (Jina first, direct-fetch
// fallback) that api/businesses/shared.js's company-research pipeline
// depends on independently of Assay.
export async function fetchSiteContent(web) {
  const url = web.startsWith("http") ? web : `https://${web}`;

  // 1. Try Jina reader (best at extracting text from JS-heavy sites)
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "Accept": "text/plain",
        "User-Agent": "Mozilla/5.0 (compatible; Prospector/1.0)",
        ...(process.env.JINA_API_KEY ? { "Authorization": `Bearer ${process.env.JINA_API_KEY}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      if (text && text.length > 100 && !text.toLowerCase().includes("jina.ai error")) {
        return { content: text.slice(0, 4000), method: "jina" };
      }
    }
  } catch (_) { /* fall through */ }

  // 2. Fall back to direct fetch with realistic browser headers
  try {
    const directRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (directRes.ok) {
      const html = await directRes.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 100) {
        return { content: text.slice(0, 4000), method: "direct" };
      }
    }
  } catch (_) { /* fall through */ }

  return { content: null, method: "failed" };
}
