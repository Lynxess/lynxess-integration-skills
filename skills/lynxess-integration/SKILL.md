---
name: lynxess-integration
description: "用 Lynxess 整合 API 查詢與更新門市的商品、價格與電子價籤（ESL）：從 POS、ERP 或價格表改價、批次變價、刪除商品、綁定或解綁價籤，以及查 token 能用的門市與它為什麼不能用。token 在環境變數 LYNXESS_API_TOKEN，永遠不進對話。"
compatibility: "需要 Node.js 18 以上（scripts 用內建的 fetch，沒有外部套件）與連到 Lynxess 整合 API 的網路。"
metadata:
  api: "v1"
  catalog: "1.0.0"
---

# Lynxess 整合 API

Lynxess 整合 API 以建立 token 的成員本人的權限，查詢與更新門市的商品、價格與電子價籤。這個 skill 教你照固定流程安全地使用它：先驗證 token，寫入前一定讓使用者看過「舊值 → 新值」並同意。

## 什麼時候用

- 使用者要從 POS、ERP 或價格表更新門市商品的價格或其他欄位，並讓價籤跟著刷新。
- 要查門市、商品欄位、商品、價籤模板、標籤的狀態或綁定。
- 要刪除商品，或綁定、解除綁定標籤與商品。
- 要確認 token 能不能用、為什麼不能用、能用哪些門市。

## 準備

- token 在環境變數 `LYNXESS_API_TOKEN`；沒有設定時，請使用者在 Lynxess 帳號網站的「整合 API › token 管理」建立，並自己放進環境變數。API 位址在 `LYNXESS_API_BASE`，沒有設定時是 https://api.lynxess.com。
- `scripts/` 的三支 script 用 `node` 執行，不需要安裝任何套件：
  - `node scripts/verify.mjs`：驗證 token，說明能不能用、為什麼不能用、能用哪些門市（`--json` 只印出回應）。
  - `node scripts/smoke.mjs`：唯讀的連線測試（驗證 → 列門市 → 查欄位 → 讀一筆商品），不做任何寫入。
  - `node scripts/call.mjs <方法> "<路徑與 query>" [--body <JSON> | --body-file <檔案>] [--confirmed]`：呼叫一個端點，只能是文件裡的方法與路徑；寫入的端點要加 `--confirmed`。
- 端點的參數、範例與每個端點可能的錯誤：`references/guide.md`（與 Lynxess 帳號網站的文件分頁同一份）與 `references/openapi.json`（OpenAPI 3.1）。

## 固定流程

1. **驗證**：執行 `node scripts/verify.mjs`。`ready` 是 false（結束狀態不是 0）就停下，用白話向使用者說明 `blockers` 與誰能處理，不要繼續。
2. **列門市**：`node scripts/call.mjs GET "/v1/esl/store/list?active=1"`，把門市列給使用者，請他確認要處理哪一家。
3. **查欄位與商品**：`node scripts/call.mjs POST /v1/esl/scene/findDongTaiZiDuan` 取得欄位 ID（例如價格的 `price`）；用 `GET /v1/esl/goods/getByStoreId`（分頁，`fuzzy` 可搜尋）或 `GET /v1/esl/goods/singleQuery` 讀出商品目前的值。
4. **列出變更並等使用者同意**：列出「改哪些商品、舊值 → 新值」，等使用者明確同意；沒有同意就不寫入。
5. **寫入**：單筆用 `POST /v1/esl/goods/updateToStore`（A8），批次用 `POST /v1/esl/goods/batchUpdateBrush`（A9），每次最多 500 筆：`node scripts/call.mjs POST /v1/esl/goods/batchUpdateBrush --body-file <檔案> --confirmed`。讀取的 token 在這一步之前停下，告訴使用者需要讀取與寫入的 token。
6. **讀回確認**：用 `GET /v1/esl/goods/singleQuery` 讀回改過的商品，向使用者說明結果；外層成功不等於價籤已經刷新。

## 護欄

- 只呼叫 OpenAPI 裡的 route：`references/openapi.json` 的 13 個端點，用 `scripts/call.mjs` 呼叫，它會拒絕其他方法與路徑。
- token 只從環境變數 `LYNXESS_API_TOKEN` 讀，永遠不印出、不寫進檔案、對話或 log；不要請使用者把 token 貼進對話。
- 遇到 429，照 `Retry-After` 的秒數等待，再送同一個請求。
- 批次失敗先讀回、只重送失敗的那幾筆，不要整批重送。
- 刪除（A10）、綁定（A11）、解綁（A12）每次都要先列出項目、取得使用者同意，再加上 `--confirmed` 送出。
- 出錯時，向使用者回報錯誤碼與支援代碼（correlation id），不要猜原因。
- 就緒檢查回的 `apiVersion` 比 skill 新時，提醒使用者重新安裝 skill：`npx skills add Lynxess/lynxess-integration-skills`。

## 結果怎麼看

- 外層 `code` 是 200 不代表價籤已經刷新。
- 批次可能部分成功：要逐筆看結果，失敗時先讀回，只重送失敗的那幾筆。
- `opCode` 不能防止重複執行：失敗後不要整批重送。
- `scripts/call.mjs` 的結束狀態：0 成功；1 API 回了錯誤（stderr 有錯誤碼、怎麼做與支援代碼）；2 沒有送出（設定或請求不對，或寫入沒有加 `--confirmed`）；3 批次部分成功（stderr 列出失敗的那幾筆）。

## 錯誤碼

出錯時，向使用者回報錯誤碼、怎麼做與支援代碼（correlation id）。

| 錯誤碼 | HTTP | 怎麼做 |
| --- | --- | --- |
| `NOT_FOUND` | 404 | 確認 API 位址（LYNXESS_API_BASE）是 Lynxess 提供的位址 |
| `INTEGRATION_TOKEN_INVALID` | 401 | 確認 LYNXESS_API_TOKEN 是完整的 token；過期或撤銷時建立新的 token |
| `INTEGRATION_DISABLED` | 403 | 請組織擁有者聯絡 Lynxess 業務；開通後原本的 token 就能使用 |
| `INTEGRATION_SCOPE_DENIED` | 403 | 改用讀取與寫入的 token；讀取的 token 只能查詢 |
| `MEMBERSHIP_INACTIVE` | 403 | 請組織擁有者恢復這位成員 |
| `ORGANIZATION_SUSPENDED` | 403 | 請組織擁有者聯絡 Lynxess 支援 |
| `ENTITLEMENT_EXPIRED` | 403 | 請組織擁有者續約；續約後原本的 token 就能使用 |
| `ROUTE_NOT_ALLOWED` | 403 | 只呼叫文件列出的 13 個端點，方法與路徑完全相同 |
| `CAPABILITY_DENIED` | 403 | 請組織擁有者調整這位成員在該門市的角色 |
| `STORE_SCOPE_DENIED` | 403 | 用「列出門市」與驗證 token 的結果確認能用的門市與標籤 |
| `INVALID_REQUEST` | 400 | 照 details 修正請求；批次拆成每次最多 500 筆 |
| `REQUEST_TOO_LARGE` | 413 | 把請求拆小，例如批次拆成較少的筆數 |
| `RATE_LIMITED` | 429 | 照 Retry-After 的秒數等待，再送同一個請求 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 稍後再送同一個請求 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 稍後再送同一個請求 |
| `ADAPTER_UNAVAILABLE` | 503 | 先讀回確認，再決定要不要重送 |
| `CONTROL_API_UNAVAILABLE` | 503 | 稍後再驗證一次 |
| `RESPONSE_REFUSED` | 502 | 先讀回確認，再決定要不要重送 |
| `INTERNAL_ERROR` | 500 | 先讀回確認；持續發生時，把支援代碼提供給 Lynxess 支援 |
| `UPSTREAM_UNAVAILABLE` | 503 | 先讀回確認，再決定要不要重送 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 聯絡 Lynxess 支援，並提供支援代碼 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 稍後再送同一個請求 |
| `UPSTREAM_RATE_LIMITED` | 429 | 等一下再送同一個請求 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 請組織擁有者確認這位成員在該門市的角色 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 聯絡 Lynxess 支援，並提供支援代碼 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 聯絡 Lynxess 支援，並提供支援代碼 |
| `UPSTREAM_REJECTED` | 422 | 照端點列出的結果代碼修正請求 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 聯絡 Lynxess 支援，並提供支援代碼 |

## 端點

| 路由 | 方法與路徑 | 用途 | 權限 |
| --- | --- | --- | --- |
| A1 | `GET /v1/esl/store/list` | 列出 token 可用的門市 | 讀取 |
| A2 | `POST /v1/esl/scene/findDongTaiZiDuan` | 查商品欄位定義 | 讀取 |
| A3 | `GET /v1/esl/goods/getByStoreId` | 分頁列出或搜尋門市商品 | 讀取 |
| A4 | `GET /v1/esl/goods/singleQuery` | 以商品 ID 查一筆商品 | 讀取 |
| A5 | `GET /v1/esl/template/findAll` | 列出門市模板 | 讀取 |
| A6 | `GET /v1/esl/label/cascadQuery` | 列出門市標籤與狀態 | 讀取 |
| A7 | `POST /v1/esl/label/batchBindQuery` | 依標籤或商品查綁定 | 讀取 |
| A8 | `POST /v1/esl/goods/updateToStore` | 新增或更新一筆商品並刷新價籤 | 讀取與寫入 |
| A9 | `POST /v1/esl/goods/batchUpdateBrush` | 批次新增或更新商品，並刷新已綁定的價籤 | 讀取與寫入 |
| A10 | `POST /v1/esl/goods/batchDelete` | 批次刪除門市商品 | 讀取與寫入 |
| A11 | `POST /v1/esl/label/update` | 綁定標籤、商品與模板 | 讀取與寫入 |
| A12 | `POST /v1/esl/label/deleteBind` | 解除標籤綁定 | 讀取與寫入 |
| readiness | `GET /v1/lynxess/token` | 驗證 token 是否可以使用 | 讀取 |

要查一個端點的參數、範例與可能的錯誤，在 `references/guide.md` 找它的段落（`### 方法 路徑`）。`references/openapi.json` 是給程式讀的同一份內容，很大，不要整份讀進對話。這個 skill 依 API v1（端點清單 1.0.0）產生；就緒檢查回的 `apiVersion` 比它新時，重新執行 `npx skills add Lynxess/lynxess-integration-skills`。
