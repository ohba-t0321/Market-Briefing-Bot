const designEls = {
  heroHeadline: document.querySelector("#heroHeadline"),
  heroLede: document.querySelector("#heroLede"),
  signalScore: document.querySelector("#signalScore"),
  signalLabel: document.querySelector("#signalLabel"),
  signalBar: document.querySelector("#signalBar"),
  signalCopy: document.querySelector("#signalCopy"),
  summarySourceBadge: document.querySelector("#summarySourceBadge"),
  researchBtn: document.querySelector("#researchBtn"),
  summarizeBtn: document.querySelector("#summarizeBtn"),
  newsSearch: document.querySelector("#newsSearch"),
  actionStatus: document.querySelector("#actionStatus")
};

function morningHeadline(data) {
  const nikkei = (data.markets || []).find((market) => String(market.id).includes("nikkei"));
  const move = Number(nikkei?.changePct || 0);
  if (move <= -2) return ["リスクオフの深さと、", "円・金利の連鎖を測る朝。"];
  if (move >= 2) return ["上昇の持続力と、", "過熱の兆しを見極める朝。"];
  return ["材料を選別し、", "次の変化を先回りする朝。"];
}

function calculateSignal(data) {
  const moves = (data.markets || []).map((market) => Math.abs(Number(market.changePct || 0)));
  const maxMove = moves.length ? Math.max(...moves) : 0;
  const failedSources = (data.sourceHealth || []).filter((source) => !source.ok).length;
  const score = Math.max(24, Math.min(94, Math.round(34 + maxMove * 5 + Math.min(failedSources, 4) * 3)));
  const label = score >= 72 ? "DEFENSIVE" : score >= 52 ? "WATCH" : "BALANCED";
  return { score, label };
}

function enhanceMorningAlpha(data) {
  if (!data || !designEls.heroHeadline) return;
  const [line1, line2] = morningHeadline(data);
  const emphasis = document.createElement("em");
  emphasis.textContent = line2;
  designEls.heroHeadline.replaceChildren(line1, document.createElement("br"), emphasis);
  designEls.heroLede.textContent = (data.summary || []).slice(0, 2).join(" ") || "主要指標と重要ニュースを確認しています。";

  const signal = calculateSignal(data);
  designEls.signalScore.textContent = String(signal.score);
  designEls.signalLabel.textContent = signal.label;
  designEls.signalBar.style.width = `${signal.score}%`;
  const leadMarket = [...(data.markets || [])].sort((a, b) => Math.abs(Number(b.changePct || 0)) - Math.abs(Number(a.changePct || 0)))[0];
  designEls.signalCopy.textContent = leadMarket
    ? `${leadMarket.name}の変動率 ${Number(leadMarket.changePct) >= 0 ? "+" : ""}${Number(leadMarket.changePct).toFixed(2)}%を中心に、ニュースと取得元の状態を反映した参考シグナルです。`
    : "株式・為替・金利と重要ニュースから算出する参考シグナルです。";

  const isAi = String(data.summarySource || "").toLowerCase().includes("openai");
  setPill(designEls.summarySourceBadge, isAi ? "OPENAI要約" : "ルール要約", isAi ? "live" : "demo");
  designEls.actionStatus.textContent = `${data.generatedAtTokyo || "直近"}のクラウド生成データを表示中。次回は平日6:30 JSTです。`;
}

function filterNews() {
  const query = designEls.newsSearch.value.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll("#newsList .news-item").forEach((item) => {
    const matches = !query || item.textContent.toLowerCase().includes(query);
    item.hidden = !matches;
    if (matches) visible += 1;
  });
  if (query) document.querySelector("#newsCount").textContent = `${visible}件表示`;
  else if (currentBriefing) document.querySelector("#newsCount").textContent = `${currentBriefing.news.length}件`;
}

designEls.researchBtn.addEventListener("click", async () => {
  designEls.researchBtn.disabled = true;
  designEls.actionStatus.textContent = "市場データを再取得しています。";
  document.querySelector("#refreshBtn").click();
  window.setTimeout(() => {
    designEls.researchBtn.disabled = false;
    if (currentBriefing) enhanceMorningAlpha(currentBriefing);
  }, 1800);
});

designEls.summarizeBtn.addEventListener("click", () => {
  document.querySelector("#summaryTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  designEls.actionStatus.textContent = "最新のAI要約を表示しました。次回の自動生成は平日6:30 JSTです。";
});

designEls.newsSearch.addEventListener("input", filterNews);
document.querySelector("#downloadBtn").addEventListener("click", () => {
  designEls.actionStatus.textContent = "最新データから朝会用PPTXを生成しました。";
});

const morningObserver = new MutationObserver(() => {
  if (currentBriefing) {
    enhanceMorningAlpha(currentBriefing);
    filterNews();
  }
});
morningObserver.observe(document.querySelector("#summaryList"), { childList: true });
