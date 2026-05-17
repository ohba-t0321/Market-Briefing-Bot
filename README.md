# Market Briefing Bot

## GitHub Pages

日本の金融・経済指標を中心に、公式RSSと市場データを朝の確認用にまとめるダッシュボードを追加しています。ブラウザからPPTX形式のサマリースライドをダウンロードできます。

公開URL:

```text
https://ohba-t0321.github.io/Market-Briefing-Bot/
```

GitHub Actions で `public/data/briefing.json` を毎朝 7:30 JST（UTC 22:30）に生成し、`public/` を GitHub Pages にデプロイします。手動で実行ボタンを押さなくても日次で自動実行されます。

`OPENAI_API_KEY` を GitHub Secrets に設定すると、要約文は OpenAI API で自動生成されます。未設定時は既存のルールベース要約に自動フォールバックします。

### OpenAI API を使った日次自動要約の設定

1. GitHub リポジトリの **Settings → Secrets and variables → Actions** を開く
2. Secret に `OPENAI_API_KEY` を登録
3. （任意）Repository variable `OPENAI_MODEL` を登録（例: `gpt-4.1-mini`）

これで毎朝のスケジュール実行時に、最新ニュース・市場データを使ったテキスト要約が自動生成されます。

ローカル起動:

```powershell
npm start
```

朝刊テキスト出力:

```powershell
npm run brief
```

GitHub Pages用データ生成:

```powershell
npm run export
```

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

## Web画面での情報表示

インターネット上のニュースRSSを収集し、Web画面で表示する簡易ダッシュボードを追加しました。

### 起動方法

```bash
python src/web_app.py
```

ブラウザで `http://localhost:8000` を開くと、以下を表示します。

- Google News（検索クエリ指定可）
- Reuters Business RSS

画面上部の検索フォームでキーワードを変更すると、再収集して表示します。
