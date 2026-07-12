const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const TZ = "Asia/Tokyo";
const FETCH_TIMEOUT_MS = 8500;
const MARKET_POINT_LIMIT = 6;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "auto";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const isMain = require.main === module;

const MODEL_PRIORITY = [
  "gpt-5",
  "gpt-5-mini",
  "o3",
  "o4-mini",
  "gpt-4.1"
];
let cachedOpenAiModel = null;

const OFFICIAL_FEEDS = [
  {
    id: "boj-stat",
    name: "日本銀行 統計RSS",
    region: "Japan",
    weight: 4,
    url: "https://www.boj.or.jp/rss/statistics.xml"
  },
  {
    id: "boj",
    name: "日本銀行 新着RSS",
    region: "Japan",
    weight: 3,
    url: "https://www.boj.or.jp/rss/whatsnew.xml"
  },
  {
    id: "cao",
    name: "内閣府 報道発表RSS",
    region: "Japan",
    weight: 3,
    url: "https://www.cao.go.jp/rss/news.rdf"
  },
  {
    id: "fsa",
    name: "金融庁 新着RSS",
    region: "Japan",
    weight: 2,
    url: "https://www.fsa.go.jp/fsaNewsListAll_rss2.xml"
  },
  {
    id: "fed",
    name: "FRB Press Releases",
    region: "Global",
    weight: 3,
    url: "https://www.federalreserve.gov/feeds/press_all.xml"
  },
  {
    id: "bls",
    name: "BLS Latest Numbers",
    region: "Global",
    weight: 2,
    url: "https://www.bls.gov/feed/bls_latest.rss"
  },
  {
    id: "ecb",
    name: "ECB News",
    region: "Global",
    weight: 2,
    url: "https://www.ecb.europa.eu/rss/press.html"
  }
];


const MARKET_NEWS_SEARCHES = [
  {
    id: "google-japan-stocks",
    name: "Google News: 日本株・企業決算",
    region: "Japan",
    weight: 3,
    query: "(日本株 OR 日経平均 OR TOPIX OR 決算 OR 業績予想 OR 自社株買い) when:1d"
  },
  {
    id: "google-yen-rates",
    name: "Google News: 為替・金利",
    region: "Japan",
    weight: 3,
    query: "(円相場 OR ドル円 OR 長期金利 OR 国債 OR 日銀) when:1d"
  },
  {
    id: "google-us-markets",
    name: "Google News: 米国株・金利",
    region: "Global",
    weight: 3,
    query: "(US stocks OR S&P 500 OR Nasdaq OR Treasury yields OR Fed) when:1d"
  },
  {
    id: "google-commodities-geopolitics",
    name: "Google News: 商品・地政学",
    region: "Global",
    weight: 2,
    query: "(oil prices OR gold OR semiconductor stocks OR geopolitics OR tariffs) when:1d"
  }
];

const WATCH_KEYWORDS = [
  "GDP",
  "CPI",
  "PPI",
  "消費者物価",
  "企業物価",
  "短観",
  "景気動向",
  "機械受注",
  "貿易",
  "国際収支",
  "雇用",
  "失業",
  "賃金",
  "金融政策",
  "利上げ",
  "利下げ",
  "国債",
  "為替",
  "FOMC",
  "inflation",
  "employment",
  "payroll",
  "yield",
  "interest rate",
  "monetary policy",
  "central bank",
  "日経平均",
  "TOPIX",
  "日本株",
  "米国株",
  "S&P 500",
  "Nasdaq",
  "決算",
  "業績",
  "自社株買い",
  "半導体",
  "原油",
  "gold",
  "tariff",
  "geopolitics",
  "earnings",
  "guidance",
  "stocks",
  "equities",
  "Treasury"
];

const MARKET_SYMBOLS = [
  {
    id: "nikkei",
    name: "Nikkei 225",
    source: "Yahoo Finance",
    yahooSymbol: "^N225",
    sourceUrl: "https://finance.yahoo.com/quote/%5EN225/",
    unit: "pt"
  },
  {
    id: "topix-etf",
    name: "TOPIX ETF",
    source: "Yahoo Finance",
    yahooSymbol: "1306.T",
    sourceUrl: "https://finance.yahoo.com/quote/1306.T/",
    unit: "JPY"
  },
  {
    id: "usdjpy",
    name: "USD/JPY",
    source: "Yahoo Finance",
    yahooSymbol: "USDJPY=X",
    sourceUrl: "https://finance.yahoo.com/quote/USDJPY%3DX/",
    unit: "JPY"
  },
  {
    id: "spx",
    name: "S&P 500",
    source: "Yahoo Finance",
    yahooSymbol: "^GSPC",
    sourceUrl: "https://finance.yahoo.com/quote/%5EGSPC/",
    unit: "pt"
  },
  {
    id: "us10y",
    name: "US 10Y Yield",
    source: "Yahoo Finance",
    yahooSymbol: "^TNX",
    sourceUrl: "https://finance.yahoo.com/quote/%5ETNX/",
    unit: "%"
  }
];

const DEMO_MARKETS = [
  {
    id: "nikkei-demo",
    name: "Nikkei 225",
    value: 38420.15,
    change: 274.22,
    changePct: 0.72,
    unit: "pt",
    date: "demo",
    source: "Demo fallback",
    sourceUrl: "https://indexes.nikkei.co.jp/en/nkave",
    fetchedAt: null,
    spark: [37200, 37420, 37340, 37830, 38100, 38020, 38420]
  },
  {
    id: "topix-demo",
    name: "TOPIX",
    value: 2743.18,
    change: 12.24,
    changePct: 0.45,
    unit: "pt",
    date: "demo",
    source: "Demo fallback",
    sourceUrl: "https://www.jpx.co.jp/english/markets/indices/topix/",
    fetchedAt: null,
    spark: [2698, 2714, 2705, 2722, 2730, 2731, 2743]
  },
  {
    id: "usdjpy-demo",
    name: "USD/JPY",
    value: 155.24,
    change: -0.28,
    changePct: -0.18,
    unit: "JPY",
    date: "demo",
    source: "Demo fallback",
    sourceUrl: "https://stooq.com/q/?s=usdjpy",
    fetchedAt: null,
    spark: [156.1, 155.9, 155.6, 155.7, 155.4, 155.5, 155.24]
  },
  {
    id: "jgb-demo",
    name: "JGB 10Y",
    value: 1.42,
    change: 0.04,
    changePct: 2.9,
    unit: "%",
    date: "demo",
    source: "Demo fallback",
    sourceUrl: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm",
    fetchedAt: null,
    spark: [1.31, 1.34, 1.32, 1.36, 1.39, 1.38, 1.42]
  },
  {
    id: "spx-demo",
    name: "S&P 500",
    value: 5328.44,
    change: -18.2,
    changePct: -0.34,
    unit: "pt",
    date: "demo",
    source: "Demo fallback",
    sourceUrl: "https://stooq.com/q/?s=%5Espx",
    fetchedAt: null,
    spark: [5356, 5364, 5342, 5338, 5349, 5336, 5328]
  }
];

const FALLBACK_NEWS = [
  {
    id: "fallback-boj",
    title: "日銀・政府統計・海外中銀RSSの取得待ち",
    link: "https://www.boj.or.jp/rss.htm",
    sourceUrl: "https://www.boj.or.jp/rss.htm",
    sourceFeedUrl: "https://www.boj.or.jp/rss.htm",
    publishedAt: new Date().toISOString(),
    source: "Demo fallback",
    region: "Japan",
    summary: "ネットワークまたはRSS配信元に接続できない場合の表示です。実運用では公式RSSとAPIから直近項目を取り込みます。",
    keywords: ["RSS", "統計", "金融政策"],
    score: 4
  },
  {
    id: "fallback-market",
    title: "市場データは無料ソースで試作、実運用はライセンス契約を推奨",
    link: "https://www.jpx.co.jp/english/markets/",
    sourceUrl: "https://www.jpx.co.jp/english/markets/",
    sourceFeedUrl: "https://www.jpx.co.jp/english/markets/",
    publishedAt: new Date().toISOString(),
    source: "Demo fallback",
    region: "Japan",
    summary: "指数・株価・債券利回りは、用途に応じてJPX、情報ベンダー、または有償APIへ切り替える設計です。",
    keywords: ["TOPIX", "市場データ", "ライセンス"],
    score: 3
  }
];

const RELEASE_CALENDAR = [
  {
    date: "2026-05-12",
    region: "Japan",
    title: "景気動向指数 2026年3月速報",
    source: "内閣府ESRI"
  },
  {
    date: "2026-05-21",
    region: "Japan",
    title: "機械受注 2026年3月",
    source: "内閣府ESRI"
  },
  {
    date: "2026-05-29",
    region: "Japan",
    title: "消費者態度指数 2026年5月",
    source: "内閣府ESRI"
  },
  {
    date: "2026-06-05",
    region: "Japan",
    title: "景気動向指数 2026年4月速報",
    source: "内閣府ESRI"
  }
];

function nowIso() {
  return new Date().toISOString();
}

function formatTokyo(date = new Date()) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function htmlDecode(input = "") {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  return htmlDecode(block.match(pattern)?.[1] || "");
}

function extractLink(block) {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  if (atom) return htmlDecode(atom);
  return extractTag(block, "link");
}

function extractDate(block) {
  const raw =
    extractTag(block, "pubDate") ||
    extractTag(block, "dc:date") ||
    extractTag(block, "updated") ||
    extractTag(block, "published");
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function keywordHits(text) {
  const normalized = text.toLowerCase();
  return WATCH_KEYWORDS.filter((keyword) => normalized.includes(keyword.toLowerCase()));
}

function scoreNews(item, source) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(item.publishedAt)) / 36e5);
  const recency = Math.max(0, 4 - ageHours / 12);
  const impactTerms = ["株", "stocks", "equities", "yield", "金利", "為替", "円", "oil", "原油", "semiconductor", "半導体", "決算", "earnings", "guidance", "tariff", "地政学"];
  const impactBonus = impactTerms.filter((term) => `${item.title || ""} ${item.summary || ""}`.toLowerCase().includes(term.toLowerCase())).length * 0.7;
  return Number((source.weight + item.keywords.length * 1.1 + impactBonus + recency).toFixed(2));
}

function googleNewsRssUrl(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "ja");
  url.searchParams.set("gl", "JP");
  url.searchParams.set("ceid", "JP:ja");
  return url.toString();
}

function summarizeNewsItem({ title, summary, source, publishedAt, keywords }) {
  const cleanSummary = htmlDecode(summary || "");
  const sentences = cleanSummary
    .split(/(?<=[。.!?！？])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const core = sentences.slice(0, 2).join(" ") || title;
  const dateText = Number.isNaN(Date.parse(publishedAt)) ? "" : new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(publishedAt));
  const keywordText = keywords?.length ? ` 検出テーマ: ${keywords.slice(0, 4).join(" / ")}。` : "";
  const sourceText = source ? `（${source}${dateText ? `、${dateText}` : ""}）` : dateText ? `（${dateText}）` : "";
  return `${core}${sourceText}${keywordText}`.slice(0, 360);
}

function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks
    .map((block, index) => {
      const title = extractTag(block, "title");
      const summary = extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content");
      const link = extractLink(block) || source.url;
      const publishedAt = extractDate(block);
      const keywords = keywordHits(`${title} ${summary}`);
      return {
        id: `${source.id}-${Date.parse(publishedAt) || Date.now()}-${index}`,
        title,
        link,
        sourceUrl: link,
        sourceFeedUrl: source.url,
        publishedAt,
        source: source.name,
        region: source.region,
        summary: summarizeNewsItem({ title, summary, source: source.name, publishedAt, keywords }),
        rawSummary: summary,
        keywords,
        score: scoreNews({ title, summary, publishedAt, keywords }, source)
      };
    })
    .filter((item) => item.title)
    .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function withCacheBuster(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("_", String(Date.now()));
  return parsed.toString();
}

async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "market-morning-brief/0.1 (+local dashboard)",
        "cache-control": "no-cache",
        pragma: "no-cache",
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, {
    accept: "application/json,text/plain,*/*",
    ...headers
  });
  return JSON.parse(text);
}

async function fetchNews() {
  const sources = [
    ...OFFICIAL_FEEDS,
    ...MARKET_NEWS_SEARCHES.map((source) => ({
      ...source,
      url: googleNewsRssUrl(source.query)
    }))
  ];
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const xml = await fetchText(source.url);
      return {
        source,
        items: parseFeed(xml, source)
      };
    })
  );

  const sourceHealth = results.map((result, index) => {
    const source = sources[index];
    const items = result.status === "fulfilled" ? result.value.items : [];
    const rssItems = items
      .slice()
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 12)
      .map((item) => ({
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        summary: item.summary,
        keywords: item.keywords
      }));
    return {
      id: source.id,
      name: source.name,
      region: source.region,
      ok: result.status === "fulfilled",
      count: items.length,
      error: result.status === "rejected" ? String(result.reason?.message || result.reason) : "",
      feedUrl: source.url,
      rssItems
    };
  });

  const items = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value.items)
    .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const seenLinks = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.link || item.title;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    deduped.push(item);
  }
  const selected = deduped.slice(0, 28);

  return {
    items: selected.length ? selected : FALLBACK_NEWS,
    sourceHealth
  };
}

function marketDigits(unit) {
  if (unit === "JPY" || unit === "%") return 3;
  return 2;
}

function roundMarketValue(value, unit) {
  return Number(Number(value).toFixed(marketDigits(unit)));
}

function yahooChartUrl(symbol, range, interval) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  return url.toString();
}

function formatMarketDate(iso, timeZone, includeTime = true) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: timeZone || TZ,
    month: "numeric",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function latestFinite(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] === null || values[index] === undefined) continue;
    const value = Number(values[index]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function selectRecentMarketPoints(points) {
  return points.slice(-MARKET_POINT_LIMIT);
}

function normalizeYahooPoints(result, symbol, attempt) {
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const points = timestamps
    .map((timestamp, index) => {
      const rawValue = closes[index];
      if (rawValue === null || rawValue === undefined) return null;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return null;
      return {
        timestamp: new Date(Number(timestamp) * 1000).toISOString(),
        value
      };
    })
    .filter(Boolean);

  const metaPrice = Number(meta.regularMarketPrice);
  const metaTime = Number(meta.regularMarketTime);
  if (Number.isFinite(metaPrice) && Number.isFinite(metaTime)) {
    const metaTimestamp = new Date(metaTime * 1000).toISOString();
    const matchingPoint = points.find((point) => point.timestamp === metaTimestamp);
    if (matchingPoint) {
      matchingPoint.value = metaPrice;
    } else {
      points.push({
        timestamp: metaTimestamp,
        value: metaPrice
      });
    }
  }

  points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (!points.length) {
    throw new Error(`no chart points for ${symbol.name}`);
  }

  const timeZone = meta.exchangeTimezoneName || symbol.timeZone || TZ;
  const latest = points.at(-1);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const previousSample = points.length >= 2 ? points.at(-2).value : null;
  const firstOpen = Array.isArray(quote.open) ? quote.open.find((value) => Number.isFinite(Number(value))) : null;
  const basis = Number.isFinite(previousClose) ? previousClose : Number(previousSample ?? firstOpen ?? latest.value);
  const change = latest.value - basis;
  const changePct = basis !== 0 ? (change / basis) * 100 : 0;
  const selectedPoints = selectRecentMarketPoints(points).map((point) => ({
    timestamp: point.timestamp,
    label: formatMarketDate(point.timestamp, timeZone, attempt.interval !== "1d"),
    value: roundMarketValue(point.value, symbol.unit)
  }));

  return {
    id: symbol.id,
    name: symbol.name,
    value: roundMarketValue(latest.value, symbol.unit),
    change: roundMarketValue(change, symbol.unit),
    changePct: Number(changePct.toFixed(2)),
    unit: symbol.unit,
    date: formatMarketDate(latest.timestamp, timeZone, true),
    source: symbol.source,
    sourceUrl: symbol.sourceUrl,
    fetchedAt: nowIso(),
    latestAt: latest.timestamp,
    timeZone,
    changeBasis: Number.isFinite(previousClose) ? "前回終値比" : "直近サンプル比",
    points: selectedPoints,
    spark: selectedPoints.map((point) => point.value),
    rawSymbol: meta.symbol || symbol.yahooSymbol,
    interval: attempt.interval,
    range: attempt.range,
    volume: latestFinite(quote.volume)
  };
}

async function fetchYahooMarket(symbol) {
  const attempts = [
    { range: "1mo", interval: "1d" }
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const payload = await fetchJson(withCacheBuster(yahooChartUrl(symbol.yahooSymbol, attempt.range, attempt.interval)), {
        "user-agent": "Mozilla/5.0 (compatible; market-morning-brief/0.1; +local dashboard)"
      });
      const error = payload?.chart?.error;
      if (error) {
        throw new Error(error.description || error.code || "Yahoo chart error");
      }
      const result = payload?.chart?.result?.[0];
      if (!result) {
        throw new Error("empty Yahoo chart response");
      }
      return normalizeYahooPoints(result, symbol, attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || `failed to fetch ${symbol.name}`);
}

async function fetchMarkets() {
  const results = await Promise.allSettled(MARKET_SYMBOLS.map((symbol) => fetchYahooMarket(symbol)));
  const live = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const errors = results
    .map((result, index) => ({
      id: MARKET_SYMBOLS[index].id,
      ok: result.status === "fulfilled",
      error: result.status === "rejected" ? String(result.reason?.message || result.reason) : ""
    }))
    .filter((entry) => !entry.ok);

  return {
    items: live.length >= 3 ? live : DEMO_MARKETS,
    isLive: live.length >= 3,
    errors
  };
}

function getUpcomingEvents() {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  return RELEASE_CALENDAR.filter((event) => event.date >= todayKey).slice(0, 5);
}

async function resolveOpenAiModel() {
  if (OPENAI_MODEL !== "auto") {
    console.log(`[AI] OPENAI_MODEL is fixed: ${OPENAI_MODEL}`);
    return OPENAI_MODEL;
  }
  if (cachedOpenAiModel) {
    console.log(`[AI] Reusing cached OpenAI model: ${cachedOpenAiModel}`);
    return cachedOpenAiModel;
  }

  console.log("[AI] Resolving model via OpenAI /v1/models...");

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI model list request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const ids = new Set((payload.data || []).map((item) => item.id));
  const selected = MODEL_PRIORITY.find((id) => ids.has(id));
  cachedOpenAiModel = selected || "gpt-4.1";
  console.log(`[AI] Resolved model: ${cachedOpenAiModel}`);
  return cachedOpenAiModel;
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") return null;

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload.output)) return null;

  const textChunks = [];
  for (const item of payload.output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!content || content.type !== "output_text" || typeof content.text !== "string") continue;
      const value = content.text.trim();
      if (value) textChunks.push(value);
    }
  }

  return textChunks.length ? textChunks.join("\n") : null;
}

function buildSummary(newsItems, markets, isLive) {
  const japanCount = newsItems.filter((item) => item.region === "Japan").length;
  const globalCount = newsItems.filter((item) => item.region !== "Japan").length;
  const topKeywords = new Map();
  newsItems.forEach((item) => item.keywords.forEach((keyword) => topKeywords.set(keyword, (topKeywords.get(keyword) || 0) + 1)));
  const keywordText = [...topKeywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([keyword]) => keyword)
    .join(" / ");

  const movers = markets
    .slice()
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3)
    .map((item) => `${item.name} ${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`);

  return [
    `日本公式ソースから${japanCount}件、海外重要ソースから${globalCount}件を抽出しました。`,
    keywordText ? `注目キーワードは ${keywordText} です。` : "注目キーワードはまだ十分に検出されていません。",
    `主な値動きは ${movers.join("、")}。${isLive ? "市場データはライブ取得です。" : "市場データはデモ表示です。APIまたはベンダー契約を設定してください。"}`,
    "投資判断は一次資料と取引先データで必ず再確認してください。"
  ];
}

async function generateAiSummary(newsItems, markets, isLive) {
  if (!OPENAI_API_KEY) {
    console.log("[AI] OPENAI_API_KEY is not set. Falling back to rule-based summary.");
    return null;
  }

  console.log(`[AI] Attempting OpenAI summary generation (news=${newsItems.length}, markets=${markets.length}, isLive=${isLive})`);

  const topNews = newsItems.slice(0, 12).map((item) => ({
    title: item.title,
    summary: item.summary,
    source: item.source,
    sourceUrl: item.sourceUrl || item.link,
    region: item.region,
    publishedAt: item.publishedAt
  }));

  const topMarkets = markets.slice(0, 6).map((item) => ({
    name: item.name,
    value: item.value,
    unit: item.unit,
    changePct: item.changePct,
    source: item.source,
    sourceUrl: item.sourceUrl,
    fetchedAt: item.fetchedAt
  }));

  const prompt = {
    timezone: TZ,
    isLive,
    instruction: "日本語で朝会向けに4行で要約。各行は具体的なニュース名・数値・資産クラスを含め、単なるキーワード列挙を避ける。1行目: 全体感、2行目: 株価に影響し得る注目ニュース、3行目: 市場変動、4行目: 確認すべきリスク。",
    news: topNews,
    markets: topMarkets
  };

  const selectedModel = await resolveOpenAiModel();
  console.log(`[AI] Calling OpenAI Responses API with model=${selectedModel}`);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: selectedModel,
      input: [
        {
          role: "system",
          content: "あなたはマーケットアナリストです。推測を避け、与えられたニュース本文・タイトル・市場データのみを使い、投資判断に役立つ具体情報を日本語で簡潔に要約してください。"
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.warn(`[AI] OpenAI API returned non-OK status: ${response.status}`);
    throw new Error(`OpenAI API request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  try {
    console.log(`[AI] Raw OpenAI Responses payload: ${JSON.stringify(payload)}`);
  } catch (error) {
    console.warn(`[AI] Failed to stringify raw OpenAI payload: ${String(error?.message || error)}`);
  }

  const resolvedModel = payload.model || selectedModel;
  console.log(`[AI] OpenAI summary generation succeeded. response_model=${resolvedModel}`);
  const text = extractResponseText(payload);
  if (!text || typeof text !== "string") {
    console.warn("[AI] OpenAI response did not contain output_text. Falling back to rule-based summary.");
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return { lines, model: resolvedModel };
}


function uniqueSourceRefs(refs, limit = 4) {
  const seen = new Set();
  return refs
    .filter((ref) => ref && ref.label && ref.url)
    .filter((ref) => {
      const key = `${ref.label}|${ref.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function newsSourceRef(item) {
  return item?.link
    ? { label: item.source || "ニュース原文", url: item.link }
    : null;
}

function marketSourceRef(item) {
  return item?.sourceUrl
    ? { label: `${item.name} / ${item.source}`, url: item.sourceUrl }
    : null;
}

function buildSummarySources(newsItems, markets) {
  const topNewsRefs = uniqueSourceRefs(newsItems.slice(0, 6).map(newsSourceRef), 3);
  const marketRefs = uniqueSourceRefs(markets.slice(0, 6).map(marketSourceRef), 3);
  return [
    topNewsRefs,
    topNewsRefs,
    marketRefs,
    uniqueSourceRefs([...topNewsRefs, ...marketRefs], 4)
  ];
}

async function buildBriefing() {
  const [news, markets] = await Promise.all([fetchNews(), fetchMarkets()]);
  let aiSummary = null;
  let aiModel = null;
  try {
    const aiResult = await generateAiSummary(news.items, markets.items, markets.isLive);
    aiSummary = aiResult?.lines || null;
    aiModel = aiResult?.model || null;
  } catch (error) {
    console.warn(`[AI] Failed to generate OpenAI summary. ${String(error?.message || error)}`);
  }
  const briefing = {
    generatedAt: nowIso(),
    generatedAtTokyo: formatTokyo(),
    status: {
      newsLive: news.items !== FALLBACK_NEWS,
      marketLive: markets.isLive,
      timezone: TZ
    },
    summary: aiSummary || buildSummary(news.items, markets.items, markets.isLive),
    summarySources: buildSummarySources(news.items, markets.items),
    summarySource: aiSummary ? `OpenAI:${aiModel || OPENAI_MODEL}` : "rule-based",
    markets: markets.items,
    news: news.items,
    events: getUpcomingEvents(),
    sourceHealth: news.sourceHealth,
    marketErrors: markets.errors,
    sources: [
      {
        name: "BOJ RSS / BOJ Time-Series Data Search API",
        url: "https://www.boj.or.jp/rss.htm"
      },
      {
        name: "e-Stat / 統計ダッシュボードAPI",
        url: "https://dashboard.e-stat.go.jp/static/api"
      },
      {
        name: "Cabinet Office ESRI release schedule",
        url: "https://www.esri.cao.go.jp/en/stat/stat-schedule-e.html"
      },
      {
        name: "Federal Reserve RSS",
        url: "https://www.federalreserve.gov/feeds/feeds.htm"
      },
      {
        name: "BLS RSS",
        url: "https://www.bls.gov/feed/"
      }
    ]
  };
  return briefing;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

async function sendStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const fullPath = path.normalize(path.join(PUBLIC_DIR, pathname));
  const relative = path.relative(PUBLIC_DIR, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500);
    res.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/api/briefing") {
        sendJson(res, 200, await buildBriefing());
        return;
      }
      if (url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, generatedAt: nowIso() });
        return;
      }
      await sendStatic(req, res);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  server.listen(PORT, () => {
    console.log(`Market morning brief dashboard: http://localhost:${PORT}`);
  });
}

async function printBriefing() {
  const briefing = await buildBriefing();
  console.log(`# Morning Market Brief (${briefing.generatedAtTokyo})`);
  briefing.summary.forEach((line) => console.log(`- ${line}`));
  console.log("\n## Markets");
  briefing.markets.forEach((item) => {
    console.log(`- ${item.name}: ${item.value} ${item.unit} (${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%) [${item.source}] ${item.sourceUrl || ""} fetched=${item.fetchedAt || "demo"}`);
  });
  console.log("\n## Top News");
  briefing.news.slice(0, 8).forEach((item) => {
    console.log(`- ${item.title} (${item.source}) ${item.link}`);
  });
}

async function exportBriefing(filePath = path.join(PUBLIC_DIR, "data", "briefing.json")) {
  const briefing = await buildBriefing();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(briefing, null, 2)}\n`, "utf8");
  console.log(`Wrote ${filePath}`);
}

module.exports = {
  buildBriefing,
  exportBriefing
};

if (isMain && process.argv[2] === "brief") {
  printBriefing().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else if (isMain && process.argv[2] === "export") {
  exportBriefing(process.argv[3]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else if (isMain) {
  startServer();
}
