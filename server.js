const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const TZ = "Asia/Tokyo";
const FETCH_TIMEOUT_MS = 8500;
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
  "central bank"
];

const MARKET_SYMBOLS = [
  {
    id: "nikkei",
    name: "Nikkei 225",
    source: "Stooq",
    url: "https://stooq.com/q/l/?s=%5Enkx&f=sd2t2ohlcv&h&e=csv",
    unit: "pt"
  },
  {
    id: "topix",
    name: "TOPIX",
    source: "Stooq",
    url: "https://stooq.com/q/l/?s=%5Etpx&f=sd2t2ohlcv&h&e=csv",
    unit: "pt"
  },
  {
    id: "usdjpy",
    name: "USD/JPY",
    source: "Stooq",
    url: "https://stooq.com/q/l/?s=usdjpy&f=sd2t2ohlcv&h&e=csv",
    unit: "JPY"
  },
  {
    id: "spx",
    name: "S&P 500",
    source: "Stooq",
    url: "https://stooq.com/q/l/?s=%5Espx&f=sd2t2ohlcv&h&e=csv",
    unit: "pt"
  },
  {
    id: "us10y",
    name: "US 10Y Yield",
    source: "Stooq",
    url: "https://stooq.com/q/l/?s=10usy.b&f=sd2t2ohlcv&h&e=csv",
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
    spark: [5356, 5364, 5342, 5338, 5349, 5336, 5328]
  }
];

const FALLBACK_NEWS = [
  {
    id: "fallback-boj",
    title: "日銀・政府統計・海外中銀RSSの取得待ち",
    link: "https://www.boj.or.jp/rss.htm",
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
  const recency = Math.max(0, 3 - ageHours / 24);
  return Number((source.weight + item.keywords.length * 1.2 + recency).toFixed(2));
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
        publishedAt,
        source: source.name,
        region: source.region,
        summary,
        keywords,
        score: scoreNews({ publishedAt, keywords }, source)
      };
    })
    .filter((item) => item.title)
    .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "market-morning-brief/0.1 (+local dashboard)"
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

async function fetchNews() {
  const results = await Promise.allSettled(
    OFFICIAL_FEEDS.map(async (source) => {
      const xml = await fetchText(source.url);
      return {
        source,
        items: parseFeed(xml, source)
      };
    })
  );

  const sourceHealth = results.map((result, index) => {
    const source = OFFICIAL_FEEDS[index];
    return {
      id: source.id,
      name: source.name,
      region: source.region,
      ok: result.status === "fulfilled",
      count: result.status === "fulfilled" ? result.value.items.length : 0,
      error: result.status === "rejected" ? String(result.reason?.message || result.reason) : ""
    };
  });

  const items = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value.items)
    .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 18);

  return {
    items: items.length ? items : FALLBACK_NEWS,
    sourceHealth
  };
}

function parseMarketCsv(csv, symbol) {
  const [, line] = csv.trim().split(/\r?\n/);
  if (!line) throw new Error("empty csv");
  const [code, date, time, open, high, low, close, volume] = line.split(",");
  const value = Number(close);
  const openValue = Number(open);
  if (!Number.isFinite(value)) throw new Error(`invalid price for ${symbol.name}`);
  const change = Number.isFinite(openValue) ? value - openValue : 0;
  const changePct = Number.isFinite(openValue) && openValue !== 0 ? (change / openValue) * 100 : 0;
  const base = Number.isFinite(openValue) ? openValue : value;
  return {
    id: symbol.id,
    name: symbol.name,
    value,
    change,
    changePct,
    unit: symbol.unit,
    date: `${date || ""} ${time || ""}`.trim(),
    source: symbol.source,
    spark: [
      base * 0.985,
      base * 0.994,
      base * 0.99,
      (base + value) / 2,
      value * 0.997,
      value * 1.002,
      value
    ].map((num) => Number(num.toFixed(symbol.unit === "JPY" ? 3 : 2))),
    rawCode: code,
    volume
  };
}

async function fetchMarkets() {
  const results = await Promise.allSettled(
    MARKET_SYMBOLS.map(async (symbol) => {
      const csv = await fetchText(symbol.url);
      return parseMarketCsv(csv, symbol);
    })
  );
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
    return OPENAI_MODEL;
  }
  if (cachedOpenAiModel) {
    return cachedOpenAiModel;
  }

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
  return cachedOpenAiModel;
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
    return null;
  }

  const topNews = newsItems.slice(0, 8).map((item) => ({
    title: item.title,
    summary: item.summary,
    source: item.source,
    region: item.region,
    publishedAt: item.publishedAt
  }));

  const topMarkets = markets.slice(0, 6).map((item) => ({
    name: item.name,
    value: item.value,
    unit: item.unit,
    changePct: item.changePct,
    source: item.source
  }));

  const prompt = {
    timezone: TZ,
    isLive,
    instruction: "日本語で朝会向けに4行で要約。1行目: 全体感、2行目: 注目ニュース、3行目: 市場変動、4行目: 注意点。",
    news: topNews,
    markets: topMarkets
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: await resolveOpenAiModel(),
      input: [
        {
          role: "system",
          content: "あなたはマーケットアナリストです。推測を避け、与えられたデータのみを使って簡潔に要約してください。"
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
    throw new Error(`OpenAI API request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const selectedModel = payload.model || await resolveOpenAiModel();
  const text = payload.output_text;
  if (!text || typeof text !== "string") {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return { lines, model: selectedModel };
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
    console.warn(String(error?.message || error));
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
    console.log(`- ${item.name}: ${item.value} ${item.unit} (${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%) [${item.source}]`);
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
