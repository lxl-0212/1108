# YKVS AI Assistant — Stable Render Version

這個版本把 MCP stdio server 改成 Python 標準函式庫實作，不依賴 Python `mcp` 套件，避免 Render 啟動時因 Python 套件或 FastMCP 版本造成服務退出。

## GitHub 根目錄

`server.js`、`mcp-client.js`、`hello_tool.py`、`llm-client-openai.js`、`quick-reply.js`、`package.json`、`render.yaml`、`public/`、`data/` 必須位於同一個專案根目錄。

## Render

Build Command: `npm install`

Start Command: `node server.js`

Health Check: `/healthz`

如果設定 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`，系統會使用 LLM 做自然語言整理；即使沒有 API Key，校務查詢仍會用 MCP 資料產生可讀的自然語言回答。
