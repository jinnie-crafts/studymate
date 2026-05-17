/**
 * RAG Retriever — StudyMate AI
 * Fetches real-time info from NewsData.io + DuckDuckGo in parallel.
 */

const CONFIG = {
  MAX_SOURCES_PER_PROVIDER: 5,
  MAX_TOTAL_SOURCES: 6,
  FETCH_TIMEOUT_MS: 8000,
  NEWS_FRESHNESS_HOURS: 48,
  MIN_TITLE_LENGTH: 10,
  MAX_TITLE_LENGTH: 200
};

async function fetchFromNewsData(query) {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    console.log("[RAG Retriever] NewsData.io: No API key, skipping.");
    return { sources: [], providerName: "newsdata" };
  }
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const cq = cleanSearchQuery(query);
    const url = `https://newsdata.io/api/1/news?apikey=${apiKey}&q=${encodeURIComponent(cq)}&language=en`;
    console.log(`[RAG Retriever] NewsData.io: Fetching "${cq.slice(0, 50)}"`);
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    if (!res.ok) throw new Error(`NewsData HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.results) || !data.results.length) {
      console.log("[RAG Retriever] NewsData.io: No results.");
      return { sources: [], providerName: "newsdata" };
    }
    const now = new Date();
    const articles = data.results.filter(a => {
      if (!a?.pubDate || !a?.link || !a?.title) return false;
      if (!/^https?:\/\//i.test(a.link)) return false;
      if (a.title.length < CONFIG.MIN_TITLE_LENGTH) return false;
      const pub = new Date(a.pubDate);
      if (isNaN(pub.getTime())) return false;
      const hrs = (now - pub) / 36e5;
      return hrs >= 0 && hrs <= CONFIG.NEWS_FRESHNESS_HOURS;
    }).slice(0, CONFIG.MAX_SOURCES_PER_PROVIDER).map(a => {
      const now2 = new Date();
      let q = 0.6;
      const hrs = (now2 - new Date(a.pubDate)) / 36e5;
      if (hrs <= 6) q += 0.3; else if (hrs <= 12) q += 0.2; else if (hrs <= 24) q += 0.1;
      if (a.description && a.description.length > 50) q += 0.1;
      return {
        title: sanitizeText(a.title).slice(0, CONFIG.MAX_TITLE_LENGTH),
        url: a.link,
        snippet: sanitizeText(a.description || a.content || "").slice(0, 300),
        publishedAt: a.pubDate || "",
        provider: "newsdata",
        quality: Math.min(q, 1.0)
      };
    });
    console.log(`[RAG Retriever] NewsData.io: ${articles.length} fresh articles.`);
    return { sources: articles, providerName: "newsdata" };
  } catch (e) {
    console.error(`[RAG Retriever] NewsData.io: ${e.name === "AbortError" ? "Timeout" : e.message}`);
    return { sources: [], providerName: "newsdata" };
  } finally { clearTimeout(tid); }
}

async function fetchFromDuckDuckGo(query) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const cq = cleanSearchQuery(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cq)}`;
    console.log(`[RAG Retriever] DuckDuckGo: Fetching "${cq.slice(0, 50)}"`);
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
    const html = await res.text();
    const sources = [];
    
    // Parse HTML results
    const blocks = html.split('class="result__snippet"');
    for (let i = 1; i < blocks.length; i++) {
        if (sources.length >= CONFIG.MAX_SOURCES_PER_PROVIDER) break;
        
        const block = blocks[i];
        
        // Extract URL
        const urlMatch = block.match(/href="([^"]+)"/);
        let actualUrl = urlMatch ? urlMatch[1] : "";
        if (actualUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
            actualUrl = decodeURIComponent(actualUrl.split("uddg=")[1].split("&")[0]);
        }
        if (!/^https?:\/\//i.test(actualUrl) || actualUrl.includes("ad_domain") || actualUrl.includes("viagogo")) continue;
        
        // Extract Snippet
        const snippetMatch = block.match(/>([\s\S]*?)<\/a>/);
        let snippet = "";
        if (snippetMatch) {
            snippet = sanitizeText(snippetMatch[1]).slice(0, 300);
        }
        
        if (snippet && actualUrl) {
            sources.push({
                title: actualUrl.split("/")[2] || "Web Result", // DDG HTML doesn't make title extraction as easy in this block split, so we use domain
                url: actualUrl,
                snippet: snippet,
                provider: "duckduckgo",
                quality: 0.8
            });
        }
    }
    
    console.log(`[RAG Retriever] DuckDuckGo: ${sources.length} results.`);
    return { sources, providerName: "duckduckgo" };
  } catch (e) {
    console.error(`[RAG Retriever] DuckDuckGo: ${e.name === "AbortError" ? "Timeout" : e.message}`);
    return { sources: [], providerName: "duckduckgo" };
  } finally { clearTimeout(tid); }
}

/**
 * Main retrieval orchestrator. Runs providers in parallel, merges/dedupes/ranks.
 */
async function retrieve(query, category) {
  const start = Date.now();
  console.log(`[RAG Retriever] Starting retrieval for category: ${category}`);
  const [newsRes, ddgRes] = await Promise.allSettled([fetchFromNewsData(query), fetchFromDuckDuckGo(query)]);
  const newsSrc = newsRes.status === "fulfilled" ? (newsRes.value?.sources || []) : [];
  const ddgSrc = ddgRes.status === "fulfilled" ? (ddgRes.value?.sources || []) : [];
  if (newsRes.status === "rejected") console.error("[RAG Retriever] NewsData rejected:", newsRes.reason);
  if (ddgRes.status === "rejected") console.error("[RAG Retriever] DDG rejected:", ddgRes.reason);

  const all = [...newsSrc, ...ddgSrc];
  const deduped = deduplicateSources(all);
  const ranked = rankSources(deduped, category);
  const final = ranked.slice(0, CONFIG.MAX_TOTAL_SOURCES);
  const rawContext = final.map((s, i) => `[${i+1}] ${s.title}${s.snippet ? ` — ${s.snippet}` : ""}`).join("\n");
  const ms = Date.now() - start;
  console.log(`[RAG Retriever] Complete: ${final.length} sources in ${ms}ms`);
  return { sources: final, rawContext, retrievalTimeMs: ms };
}

// --- Helpers ---

function flattenDDGTopics(topics) {
  if (!Array.isArray(topics)) return [];
  const flat = [];
  for (const item of topics) {
    if (item?.FirstURL && item?.Text) flat.push(item);
    else if (Array.isArray(item?.Topics)) {
      for (const n of item.Topics) { if (n?.FirstURL && n?.Text) flat.push(n); }
    }
  }
  return flat.filter(i => /^https?:\/\//i.test(i.FirstURL));
}

function deduplicateSources(sources) {
  const seen = new Set();
  return sources.filter(s => {
    if (!s?.url) return false;
    const norm = s.url.trim().toLowerCase().replace(/\/+$/, "");
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

function rankSources(sources, category) {
  return [...sources].sort((a, b) => {
    let sa = a.quality || 0.5, sb = b.quality || 0.5;
    if (a.snippet && a.snippet.length > 50) sa += 0.1;
    if (b.snippet && b.snippet.length > 50) sb += 0.1;
    return sb - sa;
  });
}

function cleanSearchQuery(query) {
  return String(query || "")
    .replace(/\b(please|can you|tell me|i want to know|what about|show me)\b/gi, "")
    .replace(/[?!.]+$/, "").replace(/\s{2,}/g, " ").trim().slice(0, 150);
}

function sanitizeText(text) {
  return String(text || "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ")
    .replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

module.exports = { retrieve, CONFIG };
