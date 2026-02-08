# Market Briefing Bot

## 入力データ仕様（引用メタデータ）

外部情報を使う項目は、`source_name` と `source_url` を持てる仕様とする。

```json
{
  "text": "原油先物は前日比で上昇",
  "source_name": "Reuters",
  "source_url": "https://www.reuters.com/markets"
}
```

- `source_name`: 出所名（例: Reuters, Bloomberg）
- `source_url`: 出所 URL
- どちらかが欠落している項目は「引用可能データ」として扱わない

## 引用フォーマット

`src/report_formatter.py` は、外部情報を使った文末に以下の形式を自動追記する。

```text
[出所: 名称(URL)]
```

例:

```text
原油先物は前日比で上昇 [出所: Reuters(https://www.reuters.com/markets)]
```

## 欠落データの扱い

`source_name` / `source_url` が欠落している項目は、次のどちらかで扱う。

1. 本文では引用対象にしない（引用を付けない）
2. 既定動作として「出所不明」セクションに隔離する

既定では `format_report_sections(..., isolate_unknown_sources=True)` により隔離される。

## サンプル出力

入力:

```json
[
  {
    "text": "原油先物は前日比で上昇",
    "source_name": "Reuters",
    "source_url": "https://www.reuters.com/markets"
  },
  {
    "text": "一部地域で電力需要が増加"
  }
]
```

出力:

```text
- 原油先物は前日比で上昇 [出所: Reuters(https://www.reuters.com/markets)]

## 出所不明の情報
- 一部地域で電力需要が増加（出所不明）
```
