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
  if (Array.isArray(market.spark) && market.spark.length >= 2) {
    return "増減率: 直前サンプル比";
  }
  return "増減率: 前回終値（または前回取得値）比";
}

function drawSparkline(canvas, values, positive) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!values || values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 6;

  ctx.strokeStyle = "#dce3dd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - pad);
  ctx.lineTo(width, height - pad);
  ctx.stroke();

  ctx.strokeStyle = positive ? "#1f7a4d" : "#b13c3c";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / range) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
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
    const canvas = node.querySelector("canvas");
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
    drawSparkline(canvas, market.spark, positive);
    els.marketGrid.append(node);
  });
  setPill(els.marketBadge, data.status.marketLive ? "ライブ" : "デモ", data.status.marketLive ? "live" : "demo");
}

function renderNews(data) {
  els.newsList.replaceChildren(
    ...data.news.slice(0, 12).map((item) => {
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

function renderSources(data) {
  const health = data.sourceHealth?.length
    ? data.sourceHealth
    : data.sources.map((source) => ({ name: source.name, ok: true, count: 0, error: "", region: "" }));
  els.sourceList.replaceChildren(
    ...health.map((source) => {
      const div = document.createElement("div");
      div.className = `source-card ${source.ok ? "ok" : "fail"}`;
      const status = document.createElement("span");
      status.textContent = source.ok ? `${source.count}件取得` : source.error || "未取得";
      const name = document.createElement("strong");
      name.textContent = source.name;
      div.append(status, name);
      return div;
    })
  );
}

function render(data) {
  currentBriefing = data;
  renderSummary(data);
  renderMarkets(data);
  renderNews(data);
  renderEvents(data);
  renderSources(data);
}

async function loadBriefing() {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "取得中";
  try {
    const response = await fetch("data/briefing.json", { cache: "no-store" });
    if (response.ok) {
      render(await response.json());
      return;
    }
    const apiResponse = await fetch("/api/briefing", { cache: "no-store" });
    if (!apiResponse.ok) throw new Error(`HTTP ${apiResponse.status}`);
    render(await apiResponse.json());
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
      { x: 7.0, y: 1.55, w: 5.5, h: 3.0, text: `生成時刻\n${data.generatedAtTokyo}\n\nステータス\nニュース: ${data.status.newsLive ? "公式RSS" : "デモ"}\n市場: ${data.status.marketLive ? "ライブ" : "デモ"}`, size: 1750, fill: "EEF5F1", line: "C4DED0" }
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

els.refreshBtn.addEventListener("click", loadBriefing);
els.downloadBtn.addEventListener("click", downloadSlides);
loadBriefing();
