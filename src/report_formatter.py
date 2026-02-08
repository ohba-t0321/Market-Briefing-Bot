"""レポート出力時の引用整形ルール。"""

from __future__ import annotations

from typing import Any


CITATION_TEMPLATE = "[出所: {name}({url})]"
UNKNOWN_SOURCE_SECTION_TITLE = "## 出所不明の情報"


def has_complete_source(item: dict[str, Any]) -> bool:
    """source_name と source_url が揃っている場合のみ True を返す。"""

    source_name = str(item.get("source_name", "")).strip()
    source_url = str(item.get("source_url", "")).strip()
    return bool(source_name and source_url)


def format_citation(source_name: str, source_url: str) -> str:
    """引用表記を生成する。"""

    return CITATION_TEMPLATE.format(name=source_name.strip(), url=source_url.strip())


def append_citation_if_available(text: str, item: dict[str, Any]) -> str:
    """外部情報を使った文末に引用を自動追記する。"""

    text = text.rstrip()
    if not has_complete_source(item):
        return text

    citation = format_citation(item["source_name"], item["source_url"])
    if text.endswith(citation):
        return text
    return f"{text} {citation}"


def format_report_sections(
    items: list[dict[str, Any]],
    *,
    content_key: str = "text",
    isolate_unknown_sources: bool = True,
) -> str:
    """入力データを引用ルールに従って整形する。

    - source_name/source_url が揃っている項目は本文へ引用付きで出力
    - 欠落項目は本文に引用を付けず、isolate_unknown_sources=True のとき別セクションへ隔離
    """

    cited_lines: list[str] = []
    unknown_lines: list[str] = []

    for item in items:
        content = str(item.get(content_key, "")).strip()
        if not content:
            continue

        if has_complete_source(item):
            cited_lines.append(f"- {append_citation_if_available(content, item)}")
        elif isolate_unknown_sources:
            unknown_lines.append(f"- {content}（出所不明）")
        else:
            cited_lines.append(f"- {content}")

    sections: list[str] = []
    if cited_lines:
        sections.append("\n".join(cited_lines))

    if isolate_unknown_sources and unknown_lines:
        sections.append(f"{UNKNOWN_SOURCE_SECTION_TITLE}\n" + "\n".join(unknown_lines))

    return "\n\n".join(sections)
