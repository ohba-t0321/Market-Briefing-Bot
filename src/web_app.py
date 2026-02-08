"""Web UI for collecting market-related information from the internet."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Iterable
from urllib.error import URLError
from urllib.parse import parse_qs, quote
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


USER_AGENT = "MarketBriefingBot/1.0 (+https://example.local)"
PORT = 8000
MAX_ITEMS_PER_FEED = 5
DEFAULT_QUERY = "マーケット"


@dataclass
class NewsItem:
    source: str
    title: str
    link: str
    published: str


class FeedFetchError(RuntimeError):
    """Raised when a feed cannot be fetched or parsed."""


def build_google_news_rss_url(query: str) -> str:
    encoded_query = quote(f"{query} when:1d")
    return (
        "https://news.google.com/rss/search?"
        f"q={encoded_query}&hl=ja&gl=JP&ceid=JP:ja"
    )


def fetch_rss_items(rss_url: str, *, source_label: str, limit: int = MAX_ITEMS_PER_FEED) -> list[NewsItem]:
    request = Request(rss_url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=15) as response:
            payload = response.read()
    except URLError as exc:
        raise FeedFetchError(f"{source_label} の取得に失敗しました: {exc}") from exc

    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise FeedFetchError(f"{source_label} のRSS解析に失敗しました: {exc}") from exc

    items: list[NewsItem] = []
    for item_node in root.findall("./channel/item")[:limit]:
        title = (item_node.findtext("title") or "(タイトルなし)").strip()
        link = (item_node.findtext("link") or "").strip()
        published = (item_node.findtext("pubDate") or "").strip()
        items.append(
            NewsItem(
                source=source_label,
                title=title,
                link=link,
                published=published,
            )
        )
    return items


def collect_market_news(query: str) -> tuple[list[NewsItem], list[str]]:
    """Collect market news from internet RSS feeds."""

    feed_targets = [
        ("Google News", build_google_news_rss_url(query)),
        ("Reuters Business", "https://feeds.reuters.com/reuters/businessNews"),
    ]

    all_items: list[NewsItem] = []
    errors: list[str] = []
    for label, url in feed_targets:
        try:
            all_items.extend(fetch_rss_items(url, source_label=label))
        except FeedFetchError as exc:
            errors.append(str(exc))

    all_items.sort(key=lambda item: item.published, reverse=True)
    return all_items, errors


def render_page(items: Iterable[NewsItem], query: str, errors: list[str]) -> str:
    item_html = []
    for item in items:
        item_html.append(
            "<li>"
            f"<a href=\"{escape(item.link)}\" target=\"_blank\" rel=\"noopener\">{escape(item.title)}</a>"
            f"<div class=\"meta\">{escape(item.source)} / {escape(item.published)}</div>"
            "</li>"
        )

    if not item_html:
        item_html.append("<li>取得できたニュースがありませんでした。</li>")

    error_html = "".join(f"<li>{escape(message)}</li>" for message in errors)
    error_section = (
        f"<section class='errors'><h2>取得エラー</h2><ul>{error_html}</ul></section>"
        if errors
        else ""
    )

    generated_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")

    return f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Market Briefing Bot - Web Dashboard</title>
  <style>
    body {{ font-family: sans-serif; margin: 2rem; max-width: 900px; }}
    h1 {{ margin-bottom: 0.5rem; }}
    .meta {{ color: #666; font-size: 0.9rem; margin-top: 0.2rem; }}
    ul {{ padding-left: 1.2rem; }}
    li {{ margin-bottom: 0.9rem; }}
    .errors {{ margin-top: 2rem; color: #8a1f11; }}
    form {{ margin: 1rem 0 1.5rem; }}
    input[type=text] {{ width: min(500px, 90vw); padding: 0.5rem; }}
    button {{ padding: 0.45rem 0.8rem; }}
  </style>
</head>
<body>
  <h1>マーケット情報ダッシュボード</h1>
  <p>インターネット上のRSSを収集し、最新情報を表示しています。</p>
  <form method="get" action="/">
    <input type="text" name="q" value="{escape(query)}" placeholder="検索キーワード" />
    <button type="submit">更新</button>
  </form>
  <p class="meta">取得時刻: {escape(generated_at)}</p>
  <ul>
    {''.join(item_html)}
  </ul>
  {error_section}
</body>
</html>
"""


class MarketBriefingHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler interface
        path, _, query_string = self.path.partition("?")
        if path != "/":
            self.send_error(404, "Not Found")
            return

        query = DEFAULT_QUERY
        parsed_query = parse_qs(query_string)
        if "q" in parsed_query and parsed_query["q"]:
            query = parsed_query["q"][0].strip() or DEFAULT_QUERY

        items, errors = collect_market_news(query)
        html = render_page(items, query, errors).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)


def run_server(port: int = PORT) -> None:
    server = HTTPServer(("0.0.0.0", port), MarketBriefingHandler)
    print(f"Server started: http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
