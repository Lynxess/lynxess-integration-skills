# Lynxess 整合 API 的 agent skill

讓 AI agent（Cursor、Claude 等）用 Lynxess 整合 API 安全地查詢與更新門市的商品、價格與電子價籤。

## 安裝

```sh
npx skills add Lynxess/lynxess-integration-skills
```

安裝指令是開源的 Skills CLI：它把 skill 裝進專案的 `.agents/skills/`，Cursor、Codex、GitHub Copilot、Gemini CLI、Cline 等 agent 從這裡讀；裝給 Claude Code（`-a claude-code`）時，另在 `.claude/skills/` 建立指向同一份的連結。不加 `-y` 時它會問要裝給哪些 agent；加上 `-g` 裝進使用者自己的資料夾（`~/.agents/skills/`、`~/.claude/skills/`），`-a <agent>` 只裝給指定的 agent。

不支援 skill 的 agent：把建立 token 時的「複製給 AI」當作 system prompt，或把這份文件貼給它。這份文件與「複製給 AI」都不含 token。

## 使用

1. 在 Lynxess 帳號網站的「整合 API › token 管理」建立 token，放進環境變數 `LYNXESS_API_TOKEN`。不要把 token 貼進對話。
2. 在 skill 的資料夾執行 `node scripts/verify.mjs` 驗證 token，`node scripts/smoke.mjs` 做唯讀的連線測試。
3. 請 agent 照 skill 做，例如「把這份價格表的新價格更新到信義旗艦店」。它會先列出舊值與新值，等你同意才寫入。

## 內容

`skills/lynxess-integration/` 是 skill：`SKILL.md`（流程與護欄）、`references/openapi.json`（OpenAPI 3.1）、`references/guide.md`（文件）與 `scripts/`（驗證、連線測試與呼叫一個端點）。這個 repository 由 Lynxess 從整合 API 的端點清單產生，不含 token 或任何 secret。

API 版本：v1（端點清單 1.0.0）。
