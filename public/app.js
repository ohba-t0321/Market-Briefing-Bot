let currentBriefing = null;

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  liveBadge: document.querySelector("#liveBadge"),
  marketBadge: document.querySelector("#marketBadge"),
  generatedAt: document.querySelector("#generatedAt"),
  summaryList: document.querySelector("#summaryList"),
  marketGrid: document.querySelector("#marketGrid"),
  newsList: document.querySelector("#newsList"),
  newsCount: document.querySelector("#newsCount"),
  eventList: document.querySelector("#eventList"),
  sourceList: document.querySelector("#sourceList"),
  marketTemplate: document.querySelector("#marketTemplate")
};

const MARKET_SOURCE_LINKS = {
  nikkei: "https://indexes.nikkei.co.jp/en/nkave",
  topix: "https://www.jpx.co.jp/english/markets/indices/topix/",
  usdjpy: "https://www.investing.com/currencies/usd-jpy",
  jgb: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm",
  us10y: "https://fred.stlouisfed.org/series/DGS10",
  spx: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/"
};

const CLIENT_MARKET_STORAGE_KEY = "market-morning-brief:markets:v1";
const CLIENT_MARKET_STORAGE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CLIENT_MARKET_POINT_LIMIT = 7;
const CLIENT_MARKET_PROXY_PREFIX = "https://api.allorigins.win/raw?url=";
const SVG_NS = "http://www.w3.org/2000/svg";

const CLIENT_MARKET_SYMBOLS = [
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

function formatNumber(value, unit) {
  const digits = unit === "JPY" || unit === "%" ? 3 : 2;
  return Number(value).toLocaleString("ja-JP", {
    minimumFractionDigits: unit === "pt" ? 2 : 0,
    maximumFractionDigits: digits
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "--";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatMarketDate(value, timeZone, includeTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: timeZone || currentBriefing?.status?.timezone || "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function setPill(el, text, mode) {
  el.textContent = text;
  el.classList.remove("live", "demo");
  if (mode) el.classList.add(mode);
}

function pickMarketSourceLink(data, market) {
  if (market.sourceUrl) return market.sourceUrl;

  const marketId = String(market.id || "").toLowerCase();
  const knownKey = Object.keys(MARKET_SOURCE_LINKS).find((key) => marketId.includes(key));
  if (knownKey) return MARKET_SOURCE_LINKS[knownKey];

  const sourceName = String(market.source || "").toLowerCase();
  const sourceCandidate = (data.sources || []).find((source) => sourceName && String(source.name || "").toLowerCase().includes(sourceName));
  return sourceCandidate?.url || "";
}

function appendSourceRefs(container, refs, fallbackLabel = "出所") {
  const validRefs = (refs || []).filter((ref) => ref?.url);
  if (!validRefs.length) return;

  const cite = document.createElement("p");
  cite.className = "inline-source";
  cite.append(`${fallbackLabel}: `);
  validRefs.forEach((ref, index) => {
    if (index > 0) cite.append(" / ");
    const link = document.createElement("a");
    link.href = ref.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = ref.label || ref.url;
    cite.append(link);
  });
  container.append(cite);
}

function getChangeBasisLabel(market) {
  if (market.changeBasis) {
    return `増減率: ${market.changeBasis}`;
  }
  if ((Array.isArray(market.points) && market.points.length >= 2) || (Array.isArray(market.spark) && market.spark.length >= 2)) {
    return "増減率: 直近サンプル比";
  }
  return "増減率: 前回終値（または前回取得値）比";
}

function getMarketPoints(market) {
  if (Array.isArray(market.points) && market.points.length) {
    return market.points
      .map((point, index) => ({
        label: point.label || (point.timestamp ? formatDate(point.timestamp) : `#${index + 1}`),
        value: Number(point.value)
      }))
      .filter((point) => Number.isFinite(point.value));
  }

  return (market.spark || [])
    .map((value, index) => ({
      label: `#${index + 1}`,
      value: Number(value)
    }))
    .filter((point) => Number.isFinite(point.value));
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function getLineChartGeometry(points) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const left = 6;
  const right = 6;
  const top = 12;
  const bottom = 16;
  const width = 100 - left - right;
  const height = 100 - top - bottom;

  return points.map((point, index) => {
    const x = left + (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width);
    const y = top + ((max - point.value) / range) * height;
    return {
      ...point,
      x,
      y
    };
  });
}

function renderMarketChart(container, market, positive) {
  const points = getMarketPoints(market);
  container.classList.toggle("up", positive);
  container.classList.toggle("down", !positive);

  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "market-chart-empty";
    empty.textContent = "値動きデータなし";
    container.replaceChildren(empty);
    return;
  }

  const geometry = getLineChartGeometry(points);
  const linePoints = geometry.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const areaPoints = `${geometry[0].x.toFixed(2)},100 ${linePoints} ${geometry.at(-1).x.toFixed(2)},100`;
  const plot = document.createElement("div");
  const svg = createSvgElement("svg", {
    class: "chart-svg",
    viewBox: "0 0 100 100",
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false"
  });
  const axis = document.createElement("div");
  const startLabel = document.createElement("span");
  const endLabel = document.createElement("span");

  plot.className = "chart-plot";
  axis.className = "chart-axis";
  startLabel.textContent = points[0].label;
  endLabel.textContent = points.at(-1).label;

  [25, 50, 75].forEach((y) => {
    svg.append(
      createSvgElement("line", {
        class: "chart-grid",
        x1: "0",
        y1: String(y),
        x2: "100",
        y2: String(y)
      })
    );
  });
  svg.append(createSvgElement("polygon", { class: "chart-area", points: areaPoints }));
  svg.append(createSvgElement("polyline", { class: "chart-line", points: linePoints }));

  const pointButtons = geometry.map((point, index) => {
    const button = document.createElement("button");
    const tooltip = document.createElement("span");
    const valueText = `${formatNumber(point.value, market.unit)} ${market.unit}`;

    button.type = "button";
    button.className = [
      "chart-point",
      index === 0 ? "start" : "",
      index === geometry.length - 1 ? "end latest" : ""
    ]
      .filter(Boolean)
      .join(" ");
    button.style.setProperty("--x", point.x.toFixed(2));
    button.style.setProperty("--y", point.y.toFixed(2));
    button.setAttribute("aria-label", `${point.label}: ${valueText}`);
    tooltip.className = "chart-tooltip";
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.textContent = `${point.label} ${valueText}`;
    button.append(tooltip);
    return button;
  });

  axis.append(startLabel, endLabel);
  plot.append(svg, ...pointButtons);
  container.replaceChildren(plot, axis);
}

function renderSummary(data) {
  const summaryNodes = data.summary.map((line, index) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = line;
    li.append(text);
    appendSourceRefs(li, data.summarySources?.[index], "データソース");
    return li;
  });
  els.summaryList.replaceChildren(...summaryNodes);
  els.generatedAt.textContent = `生成: ${data.generatedAtTokyo || formatDate(data.generatedAt)}`;
  const mode = data.status.newsLive ? "live" : "demo";
  setPill(els.liveBadge, data.status.newsLive ? "公式RSS" : "デモ", mode);
}

function renderMarkets(data) {
  els.marketGrid.replaceChildren();
  data.markets.forEach((market) => {
    const node = els.marketTemplate.content.cloneNode(true);
    const card = node.querySelector(".market-card");
    const title = node.querySelector("h3");
    const change = node.querySelector(".change");
    const value = node.querySelector(".market-value");
    const source = node.querySelector(".market-source");
    const basis = document.createElement("p");
    basis.className = "market-basis";
    const chart = node.querySelector(".market-chart");
    const positive = Number(market.changePct) >= 0;
    title.textContent = market.name;
    change.textContent = `${positive ? "+" : ""}${Number(market.changePct || 0).toFixed(2)}%`;
    change.classList.add(positive ? "up" : "down");
    value.textContent = `${formatNumber(market.value, market.unit)} ${market.unit}`;
    source.textContent = `${market.source} / 市場日時: ${market.date || "latest"}`;
    const fetchedAt = market.fetchedAt ? formatDate(market.fetchedAt) : "デモデータ（取得日時なし）";
    source.append(` / 取得: ${fetchedAt}`);
    const sourceLink = pickMarketSourceLink(data, market);
    if (sourceLink) {
      const a = document.createElement("a");
      a.href = sourceLink;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "実データ取得元";
      source.append(" / ", a);
    }
    basis.textContent = getChangeBasisLabel(market);
    source.after(basis);
    card.dataset.market = market.id;
    renderMarketChart(chart, market, positive);
    els.marketGrid.append(node);
  });
  const marketBadgeText = data.clientMarketUpdatedAt ? "サイト更新" : data.status.marketLive ? "ライブ" : "デモ";
  setPill(els.marketBadge, marketBadgeText, data.status.marketLive ? "live" : "demo");
}

function renderNews(data) {
  els.newsList.replaceChildren(
    ...data.news.slice(0, 16).map((item) => {
      const article = document.createElement("article");
      article.className = "news-item";
      const link = document.createElement("a");
      link.href = item.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = item.title;
      const meta = document.createElement("p");
      meta.className = "news-meta";
      meta.textContent = `${item.source} / ${item.region} / ${formatDate(item.publishedAt)}`;
      const summary = document.createElement("p");
      summary.className = "news-summary";
      summary.textContent = item.summary || "概要は配信元リンクで確認してください。";
      appendSourceRefs(article, [{ label: item.source, url: item.sourceUrl || item.link }], "データソース");
      const tags = document.createElement("div");
      tags.className = "tag-row";
      (item.keywords || []).slice(0, 5).forEach((keyword) => {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = keyword;
        tags.append(tag);
      });
      article.replaceChildren(link, meta, summary, ...article.querySelectorAll(".inline-source"), tags);
      return article;
    })
  );
  els.newsCount.textContent = `${data.news.length}件`;
}

function renderEvents(data) {
  els.eventList.replaceChildren(
    ...data.events.map((event) => {
      const div = document.createElement("div");
      div.className = "event-card";
      const time = document.createElement("time");
      time.textContent = event.date;
      const title = document.createElement("strong");
      title.textContent = event.title;
      const source = document.createElement("span");
      source.textContent = `${event.region} / ${event.source}`;
      div.append(time, title, source);
      return div;
    })
  );
}

function renderSourceRssItems(source) {
  const items = source.rssItems || [];
  if (!items.length) return null;

  const details = document.createElement("details");
  details.className = "rss-details";
  const summary = document.createElement("summary");
  summary.textContent = "参照したRSSの内容";
  const list = document.createElement("div");
  list.className = "rss-item-list";

  items.forEach((item) => {
    const block = document.createElement("article");
    block.className = "rss-item";
    const title = document.createElement("a");
    title.href = item.link || source.feedUrl || "#";
    title.target = "_blank";
    title.rel = "noopener";
    title.textContent = item.title || "無題";
    const meta = document.createElement("p");
    meta.className = "rss-meta";
    meta.textContent = item.publishedAt ? formatDate(item.publishedAt) : "日時不明";
    const body = document.createElement("p");
    body.className = "rss-body";
    body.textContent = item.summary || "RSS本文は空です。リンク先で確認してください。";
    block.append(title, meta, body);
    list.append(block);
  });

  details.append(summary, list);
  return details;
}

function renderSources(data) {
  const health = data.sourceHealth?.length
    ? data.sourceHealth
    : data.sources.map((source) => ({ name: source.name, ok: true, count: 0, error: "", region: "", feedUrl: source.url, rssItems: [] }));
  els.sourceList.replaceChildren(
    ...health.map((source) => {
      const div = document.createElement("div");
      div.className = `source-card ${source.ok ? "ok" : "fail"}`;
      const status = document.createElement("span");
      status.textContent = source.ok ? `${source.count}件取得` : source.error || "未取得";
      const name = document.createElement("strong");
      name.textContent = source.name;
      const feed = document.createElement("a");
      feed.className = "source-feed-link";
      feed.href = source.feedUrl || "#";
      feed.target = "_blank";
      feed.rel = "noopener";
      feed.textContent = "RSSフィード";
      const rssItems = renderSourceRssItems(source);
      div.append(status, name);
      if (source.feedUrl) div.append(feed);
      if (rssItems) div.append(rssItems);
      return div;
    })
  );
}

function marketDigits(unit) {
  if (unit === "JPY" || unit === "%") return 3;
  return 2;
}

function roundMarketValue(value, unit) {
  return Number(Number(value).toFixed(marketDigits(unit)));
}

function latestFinite(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] === null || values[index] === undefined) continue;
    const value = Number(values[index]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function selectClientMarketPoints(points) {
  return points.slice(-CLIENT_MARKET_POINT_LIMIT);
}

function withCacheBuster(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("_", String(Date.now()));
  return parsed.toString();
}

function yahooChartUrl(symbol, range, interval) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  return url.toString();
}

async function fetchClientText(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchClientJson(url) {
  const attempts = [
    { label: "direct", url },
    { label: "cors-proxy", url: `${CLIENT_MARKET_PROXY_PREFIX}${encodeURIComponent(url)}` }
  ];
  const errors = [];

  for (const attempt of attempts) {
    try {
      return JSON.parse(await fetchClientText(attempt.url));
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" / "));
}

function normalizeClientYahooPoints(result, symbol, attempt) {
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

  const timeZone = meta.exchangeTimezoneName || symbol.timeZone || currentBriefing?.status?.timezone || "Asia/Tokyo";
  const latest = points.at(-1);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const previousSample = points.length >= 2 ? points.at(-2).value : null;
  const firstOpen = Array.isArray(quote.open) ? quote.open.find((value) => Number.isFinite(Number(value))) : null;
  const basis = Number.isFinite(previousClose) ? previousClose : Number(previousSample ?? firstOpen ?? latest.value);
  const change = latest.value - basis;
  const changePct = basis !== 0 ? (change / basis) * 100 : 0;
  const selectedPoints = selectClientMarketPoints(points).map((point) => ({
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
    fetchedAt: new Date().toISOString(),
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

async function fetchClientYahooMarket(symbol) {
  const attempts = [
    { range: "1d", interval: "5m" },
    { range: "5d", interval: "1d" }
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const payload = await fetchClientJson(withCacheBuster(yahooChartUrl(symbol.yahooSymbol, attempt.range, attempt.interval)));
      const error = payload?.chart?.error;
      if (error) {
        throw new Error(error.description || error.code || "Yahoo chart error");
      }
      const result = payload?.chart?.result?.[0];
      if (!result) {
        throw new Error("empty Yahoo chart response");
      }
      return normalizeClientYahooPoints(result, symbol, attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || `failed to fetch ${symbol.name}`);
}

async function fetchClientMarkets() {
  const results = await Promise.allSettled(CLIENT_MARKET_SYMBOLS.map((symbol) => fetchClientYahooMarket(symbol)));
  const items = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const errors = results
    .map((result, index) => ({
      id: CLIENT_MARKET_SYMBOLS[index].id,
      ok: result.status === "fulfilled",
      error: result.status === "rejected" ? String(result.reason?.message || result.reason) : ""
    }))
    .filter((entry) => !entry.ok);

  if (items.length < 3) {
    throw new Error(`市場データの取得成功が${items.length}件のみでした`);
  }

  return { items, errors };
}

function replaceMarketsInBriefing(data, markets, marketErrors = [], updatedAt = new Date().toISOString()) {
  return {
    ...data,
    status: {
      ...data.status,
      marketLive: true,
      marketSource: "browser"
    },
    markets,
    marketErrors,
    clientMarketUpdatedAt: updatedAt
  };
}

function saveClientMarketSnapshot(data) {
  try {
    localStorage.setItem(
      CLIENT_MARKET_STORAGE_KEY,
      JSON.stringify({
        savedAt: data.clientMarketUpdatedAt || new Date().toISOString(),
        markets: data.markets,
        marketErrors: data.marketErrors || []
      })
    );
  } catch (error) {
    console.warn("Failed to save client market snapshot", error);
  }
}

function readClientMarketSnapshot() {
  try {
    const raw = localStorage.getItem(CLIENT_MARKET_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!Array.isArray(snapshot.markets) || !snapshot.markets.length) return null;
    return snapshot;
  } catch (error) {
    console.warn("Failed to read client market snapshot", error);
    return null;
  }
}

function applyStoredClientMarkets(data) {
  const snapshot = readClientMarketSnapshot();
  if (!snapshot?.savedAt) return data;

  const savedAt = Date.parse(snapshot.savedAt);
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > CLIENT_MARKET_STORAGE_MAX_AGE_MS) return data;

  const generatedAt = Date.parse(data.generatedAt);
  if (data.status?.marketLive && Number.isFinite(generatedAt) && savedAt <= generatedAt) return data;

  return replaceMarketsInBriefing(data, snapshot.markets, snapshot.marketErrors || [], snapshot.savedAt);
}

async function refreshClientMarketsFromBrowser() {
  if (!currentBriefing) return false;

  setPill(els.marketBadge, "市場取得中", "live");
  try {
    const { items, errors } = await fetchClientMarkets();
    const nextBriefing = replaceMarketsInBriefing(currentBriefing, items, errors);
    currentBriefing = nextBriefing;
    saveClientMarketSnapshot(nextBriefing);
    renderMarkets(nextBriefing);
    return true;
  } catch (error) {
    console.warn("Failed to refresh market data in browser", error);
    setPill(els.marketBadge, "更新失敗", "demo");
    return false;
  }
}

async function fetchBriefingData() {
  const apiResponse = await fetch(`/api/briefing?_=${Date.now()}`, { cache: "no-store" });
  if (apiResponse.ok) {
    return {
      source: "api",
      data: await apiResponse.json()
    };
  }

  const response = await fetch(`data/briefing.json?_=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${apiResponse.status || response.status}`);
  return {
    source: "static",
    data: await response.json()
  };
}

function render(data) {
  currentBriefing = data;
  renderSummary(data);
  renderMarkets(data);
  renderNews(data);
  renderEvents(data);
  renderSources(data);
}

async function loadBriefing({ refreshClientMarkets = false } = {}) {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "取得中";
  try {
    const { source, data } = await fetchBriefingData();
    const briefing = source === "static" ? applyStoredClientMarkets(data) : data;
    render(briefing);

    if (refreshClientMarkets && source === "static") {
      els.refreshBtn.textContent = "市場取得中";
      await refreshClientMarketsFromBrowser();
    }
  } catch (error) {
    setPill(els.liveBadge, "エラー", "demo");
    els.summaryList.replaceChildren(Object.assign(document.createElement("li"), { textContent: `取得に失敗しました: ${error.message}` }));
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "更新";
  }
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emu(inches) {
  return Math.round(inches * 914400);
}

function shape(id, name, x, y, w, h, text, options = {}) {
  const fill = options.fill || "FFFFFF";
  const line = options.line || "FFFFFF";
  const color = options.color || "17201B";
  const size = options.size || 1900;
  const bold = options.bold ? ' b="1"' : "";
  const paragraphs = String(text)
    .split("\n")
    .map(
      (lineText) => `<a:p><a:r><a:rPr lang="ja-JP" sz="${size}"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xmlEscape(lineText)}</a:t></a:r><a:endParaRPr lang="ja-JP"/></a:p>`
    )
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="100000" tIns="70000" rIns="100000" bIns="70000"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function slideXml(title, blocks, accent = "1F7A4D") {
  const content = [
    shape(2, "Title", 0.55, 0.35, 12.1, 0.65, title, { size: 2850, bold: true, fill: "F5F7F4", line: "F5F7F4", color: "17201B" }),
    shape(3, "Accent", 0.55, 1.08, 12.1, 0.08, "", { fill: accent, line: accent })
  ];
  blocks.forEach((block, index) => {
    content.push(
      shape(10 + index, `Block ${index + 1}`, block.x, block.y, block.w, block.h, block.text, {
        size: block.size || 1650,
        bold: block.bold,
        fill: block.fill || "FFFFFF",
        line: block.line || "DCE3DD",
        color: block.color || "17201B"
      })
    );
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F5F7F4"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${content.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function makeSlides(data) {
  const marketStatus = data.clientMarketUpdatedAt
    ? `サイト更新 (${formatDate(data.clientMarketUpdatedAt)})`
    : data.status.marketLive
      ? "ライブ"
      : "デモ";
  const marketLines = data.markets
    .slice(0, 6)
    .map((m) => `${m.name}: ${formatNumber(m.value, m.unit)} ${m.unit} (${m.changePct >= 0 ? "+" : ""}${Number(m.changePct).toFixed(2)}%) / 取得: ${m.fetchedAt ? formatDate(m.fetchedAt) : "demo"} / 出所: ${m.sourceUrl || m.source}`)
    .join("\n");
  const newsLines = data.news
    .slice(0, 6)
    .map((n, i) => `${i + 1}. ${n.title}
   出所: ${n.sourceUrl || n.link}`)
    .join("\n");
  const eventLines = data.events.map((e) => `${e.date} ${e.title}`).join("\n") || "直近予定なし";
  return [
    slideXml("金融指標・ニュース朝刊", [
      { x: 0.75, y: 1.55, w: 6.0, h: 3.0, text: data.summary.join("\n"), size: 1750, fill: "FFFFFF" },
      { x: 7.0, y: 1.55, w: 5.5, h: 3.0, text: `生成時刻\n${data.generatedAtTokyo}\n\nステータス\nニュース: ${data.status.newsLive ? "公式RSS" : "デモ"}\n市場: ${marketStatus}`, size: 1750, fill: "EEF5F1", line: "C4DED0" }
    ]),
    slideXml("主要値動き", [{ x: 0.75, y: 1.5, w: 11.8, h: 4.9, text: marketLines, size: 2050, fill: "FFFFFF" }], "315F91"),
    slideXml("重要ニュース", [{ x: 0.75, y: 1.5, w: 11.8, h: 4.9, text: newsLines, size: 1550, fill: "FFFFFF" }], "A66C16"),
    slideXml("予定と確認事項", [
      { x: 0.75, y: 1.5, w: 5.8, h: 4.9, text: eventLines, size: 1750, fill: "FFFFFF" },
      { x: 6.85, y: 1.5, w: 5.7, h: 4.9, text: "確認事項\n一次資料の公表値\n市場データのライセンス\n配信エラーの有無\n重要ニュースの原文", size: 1850, fill: "FFF6DE", line: "EAD7AD" }
    ], "1F7A4D")
  ];
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dosDate };
}

function u16(value) {
  return [value & 255, (value >>> 8) & 255];
}

function u32(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, dosDate } = dosDateTime();

  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const content = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(content);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(time),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(content.length),
      ...u32(content.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...content
    ]);
    parts.push(local);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(time),
        ...u16(dosDate),
        ...u32(crc),
        ...u32(content.length),
        ...u32(content.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...name
      ])
    );
    offset += local.length;
  });

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0)
  ]);
  return new Blob([...parts, ...central, end], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  });
}

function pptxFiles(data) {
  const slides = makeSlides(data);
  const slideOverrides = slides
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join("");
  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  const presentationRels = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    ...slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
  ].join("");
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Market Morning Brief</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides></Properties>`
    },
    {
      name: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Market Morning Brief</dc:title><dc:creator>Market Morning Brief Dashboard</dc:creator><cp:lastModifiedBy>Market Morning Brief Dashboard</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`
    },
    {
      name: "ppt/presentation.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="ja-JP"/></a:defPPr></p:defaultTextStyle></p:presentation>`
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presentationRels}</Relationships>`
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
    },
    {
      name: "ppt/theme/theme1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Market Brief"><a:themeElements><a:clrScheme name="Market"><a:dk1><a:srgbClr val="17201B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="214C36"/></a:dk2><a:lt2><a:srgbClr val="F5F7F4"/></a:lt2><a:accent1><a:srgbClr val="1F7A4D"/></a:accent1><a:accent2><a:srgbClr val="315F91"/></a:accent2><a:accent3><a:srgbClr val="A66C16"/></a:accent3><a:accent4><a:srgbClr val="B13C3C"/></a:accent4><a:accent5><a:srgbClr val="6F9DB4"/></a:accent5><a:accent6><a:srgbClr val="68746D"/></a:accent6><a:hlink><a:srgbClr val="315F91"/></a:hlink><a:folHlink><a:srgbClr val="68746D"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Yu Gothic"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Yu Gothic"/></a:minorFont></a:fontScheme><a:fmtScheme name="Market"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
    }
  ];
  slides.forEach((content, index) => {
    files.push({
      name: `ppt/slides/slide${index + 1}.xml`,
      content
    });
    files.push({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
    });
  });
  return files;
}

function downloadSlides() {
  if (!currentBriefing) return;
  const blob = makeZip(pptxFiles(currentBriefing));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `market-morning-brief-${new Date().toISOString().slice(0, 10)}.pptx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

els.refreshBtn.addEventListener("click", () => loadBriefing({ refreshClientMarkets: true }));
els.downloadBtn.addEventListener("click", downloadSlides);
loadBriefing();
