# Lynxess 整合 API 文件

整合 API 每個端點能做什麼、要帶哪些參數，以及怎麼讓 AI agent 幫你串接，都在這裡。

這份文件不含 token。API 版本：v1（端點清單 1.0.0）。

## 開始使用

### 安裝 agent skill（Cursor、Claude 等 AI agent）

```sh
npx skills add Lynxess/lynxess-integration-skills
```

安裝指令是開源的 Skills CLI：它把 skill 裝進專案的 `.agents/skills/`，Cursor、Codex、GitHub Copilot、Gemini CLI、Cline 等 agent 從這裡讀；裝給 Claude Code（`-a claude-code`）時，另在 `.claude/skills/` 建立指向同一份的連結。不加 `-y` 時它會問要裝給哪些 agent；加上 `-g` 裝進使用者自己的資料夾（`~/.agents/skills/`、`~/.claude/skills/`），`-a <agent>` 只裝給指定的 agent。

不支援 skill 的 agent：把建立 token 時的「複製給 AI」當作 system prompt，或把這份文件貼給它。這份文件與「複製給 AI」都不含 token。

token 放在環境變數 LYNXESS_API_TOKEN；API 位址可以用環境變數 LYNXESS_API_BASE 指定，沒有設定時是 https://api.lynxess.com。

### 給 AI agent 的固定流程

1. 驗證：`GET /v1/lynxess/token`；`ready` 是 false 就停下，用白話說明 `blockers`。
2. 列門市（`GET /v1/esl/store/list`），請使用者確認要處理哪一家。
3. 查欄位（`POST /v1/esl/scene/findDongTaiZiDuan`）與商品（`GET /v1/esl/goods/getByStoreId`、`GET /v1/esl/goods/singleQuery`）。
4. 列出「改哪些商品、舊值 → 新值」，等使用者同意。
5. 單筆用 `POST /v1/esl/goods/updateToStore`，批次用 `POST /v1/esl/goods/batchUpdateBrush`，每次最多 500 筆。讀取的 token 在這一步之前停下。
6. 讀回確認，並說明外層成功不等於價籤已經刷新。

### 給 AI agent 的護欄

- 只呼叫 OpenAPI 裡的 route（文件列出的 13 個端點）。
- token 只從環境變數 LYNXESS_API_TOKEN 讀，永遠不印出、不寫進檔案、對話或 log。
- 遇到 429，照 `Retry-After` 的秒數等待。
- 批次失敗先讀回、只重送失敗的那幾筆。
- 刪除、綁定、解綁每次都要先取得使用者同意。
- 出錯時，回報錯誤碼與支援代碼（correlation id）。
- 就緒檢查回的 `apiVersion` 比 skill 新時，提醒使用者重新安裝：`npx skills add Lynxess/lynxess-integration-skills`。

## 整合指南

1. 取得 token：在「token 管理」分頁建立，放進系統的環境變數 LYNXESS_API_TOKEN。

   驗證你的 token（token 放在環境變數 LYNXESS_API_TOKEN）：

   ```sh
   curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" https://api.lynxess.com/v1/lynxess/token
   ```
2. 每個請求都帶 Authorization 標頭：Bearer 加上你的 token。
3. 門市 ID 從「列出門市」取得；token 只能用在它涵蓋的門市。
4. 批次每次最多 500 筆，結果要逐筆看。
5. opCode 不能防止重複執行，失敗後不要整批重送。
6. 超過使用上限時會收到 429，請照 Retry-After 的秒數等待。
7. 每個錯誤都附支援代碼，回報問題時請一併提供。
8. 要換 token 時，先建立新的，切換完成後再撤銷舊的。

### token 與權限

Integration token 是成員為自己的系統建立的長效憑證，以 `lxi_` 開頭，建立時只顯示一次；Lynxess 不保存 token 本身，之後誰都看不到。

token 能做的事永遠不超過建立者當下的權限，再受 token 自己的權限與門市限制：讀取的 token 只能查詢；讀取與寫入的 token 還可以改價、刪除商品、綁定與解綁標籤。

門市是「我的全部門市」（建立者目前的門市，含之後被指派的）或「指定門市」，建立後不能改。建立者被降權、移出門市或停權，下一個請求就生效。

token 一定有到期日（30、90、180 或 365 天），不能延長。先用 `GET /v1/lynxess/token` 驗證：它回答 token 能不能用、權限、門市與每家能讀或能寫、到期日，以及最近 7 天沒成功的呼叫；`ready` 是 false 時，`blockers` 說明原因。

### 請求與回應

API 位址是 https://api.lynxess.com，路徑都以 `/v1` 開頭。每個請求帶 `Authorization: Bearer` 加上 token；有 body 時是 JSON（`Content-Type: application/json`）。只有文件列出的 13 個端點，其他方法或路徑回 403 `ROUTE_NOT_ALLOWED`。

API 只給你的伺服器或程式呼叫，不支援瀏覽器的跨網域請求（CORS）。請求裡的 `token` 標頭與任何層級的 `merchantCode` 不會送出。

成功時，回應是門市管理服務的結果：外層的 `code`、`msg` 與 `data`。Lynxess 拒絕時，回應是 `{"error": {"code": …, "correlationId": …, "details": …}}` 與對應的 HTTP 狀態。每個回應都有 `X-Lynxess-Correlation-Id` 標頭，就是支援代碼。

外層 `code` 是 200 不代表價籤已經刷新。要確認寫入的結果，讀回商品；價籤是否已經顯示新的值，要看門市的價籤。

### 批次與部分成功

`POST /v1/esl/goods/batchUpdateBrush`（批次新增或更新商品）與 `POST /v1/esl/goods/batchDelete`（批次刪除商品）每次最多 500 筆，超過時回 400 `INVALID_REQUEST`。

批次可能部分成功：要逐筆看結果，失敗時先讀回，只重送失敗的那幾筆。`POST /v1/esl/goods/batchUpdateBrush` 的回應 `data` 是每筆商品各自的結果，依送出的順序：`code` 是 200 才是那一筆成功。

外層 `code` 是 200 不代表價籤已經刷新。結果不確定時（例如 `UPSTREAM_UNAVAILABLE`，或連線中斷），先讀回確認哪些已經寫入，再只送還沒寫入的。

### opCode

`opCode` 是 `POST /v1/esl/goods/batchUpdateBrush` 的選填參數，少於 10 位數：每次送不同的值，或不送由系統產生。

`opCode` 不能防止重複執行：失敗後不要整批重送。Lynxess 沒有冪等 key 或「安全重送」：重送前一定先讀回。

### 使用上限

| 範圍 | 上限 |
| --- | --- |
| 每個 token 的讀取：`GET /v1/esl/store/list`、`POST /v1/esl/scene/findDongTaiZiDuan`、`GET /v1/esl/goods/getByStoreId`、`GET /v1/esl/goods/singleQuery`、`GET /v1/esl/template/findAll`、`GET /v1/esl/label/cascadQuery`、`POST /v1/esl/label/batchBindQuery`、`GET /v1/lynxess/token` | 300 次／60 秒 |
| 每個 token 的單筆寫入：`POST /v1/esl/goods/updateToStore`、`POST /v1/esl/label/update`、`POST /v1/esl/label/deleteBind` | 120 次／60 秒 |
| 每個 token 的批次寫入：`POST /v1/esl/goods/batchUpdateBrush`、`POST /v1/esl/goods/batchDelete` | 20 次／60 秒，每次最多 500 筆 |
| 每個組織：全部 token 合計 | 600 次／60 秒 |
| 全平台：所有整合流量合計 | 100 次／1 秒 |
| 同一個 IP 的 401 | 60 秒內超過 30 次時，暫停 600 秒 |

超過時回 429 `RATE_LIMITED` 與 `Retry-After` 標頭（秒）：照它等待，再送同一個請求。

### 錯誤碼

| 錯誤碼 | HTTP | 意思 | 怎麼做 |
| --- | --- | --- | --- |
| `NOT_FOUND` | 404 | 這個 API 位址沒有開放整合 API：每個請求都回 404 | 確認 API 位址（LYNXESS_API_BASE）是 Lynxess 提供的位址 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked | 確認 LYNXESS_API_TOKEN 是完整的 token；過期或撤銷時建立新的 token |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 | 請組織擁有者聯絡 Lynxess 業務；開通後原本的 token 就能使用 |
| `INTEGRATION_SCOPE_DENIED` | 403 | 讀取的 token 呼叫了需要寫入權限的端點 | 改用讀取與寫入的 token；讀取的 token 只能查詢 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 | 請組織擁有者恢復這位成員 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 | 請組織擁有者聯絡 Lynxess 支援 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 | 請組織擁有者續約；續約後原本的 token 就能使用 |
| `ROUTE_NOT_ALLOWED` | 403 | 這個方法與路徑不是整合 API 的端點 | 只呼叫文件列出的 13 個端點，方法與路徑完全相同 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 | 請組織擁有者調整這位成員在該門市的角色 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 | 用「列出門市」與驗證 token 的結果確認能用的門市與標籤 |
| `INVALID_REQUEST` | 400 | 請求的格式不對，或批次超過 500 筆；details 說明是哪個欄位 | 照 details 修正請求；批次拆成每次最多 500 筆 |
| `REQUEST_TOO_LARGE` | 413 | 請求的內容太大 | 把請求拆小，例如批次拆成較少的筆數 |
| `RATE_LIMITED` | 429 | 超過使用上限 | 照 Retry-After 的秒數等待，再送同一個請求 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 | 稍後再送同一個請求 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 | 稍後再送同一個請求 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 | 先讀回確認，再決定要不要重送 |
| `CONTROL_API_UNAVAILABLE` | 503 | 暫時無法取得 token 的資料 | 稍後再驗證一次 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 | 先讀回確認，再決定要不要重送 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 | 先讀回確認；持續發生時，把支援代碼提供給 Lynxess 支援 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 | 先讀回確認，再決定要不要重送 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 | 聯絡 Lynxess 支援，並提供支援代碼 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 | 稍後再送同一個請求 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 | 等一下再送同一個請求 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 | 請組織擁有者確認這位成員在該門市的角色 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 | 聯絡 Lynxess 支援，並提供支援代碼 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 | 聯絡 Lynxess 支援，並提供支援代碼 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 | 照端點列出的結果代碼修正請求 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 | 聯絡 Lynxess 支援，並提供支援代碼 |

`UPSTREAM_REJECTED` 的 `details.upstreamCode` 是門市管理服務的結果代碼，各端點列出常見的代碼。Lynxess 不轉述上游的訊息文字。

### 輪替與撤銷

要換 token 時，先建立新的，切換完成後再撤銷舊的；兩個可以同時有效。token 不能延長，也不能換掉 secret。

撤銷後，使用這個 token 的系統在下一個請求就被拒（401）。token 外洩時立刻撤銷。組織擁有者看得到組織全部 token 的資料，可以撤銷任何一個。

### 沒有的功能

沒有庫存 API：庫存數量當成商品的自訂欄位，用 `POST /v1/esl/goods/updateToStore` 或 `POST /v1/esl/goods/batchUpdateBrush` 送。

沒有 webhook 或事件推送，也沒有 MCP。

## 端點

| 方法 | 路徑 | 用途 | 需要的權限 |
| --- | --- | --- | --- |
| GET | `/v1/esl/store/list` | 列出 token 可用的門市 | 讀取 |
| POST | `/v1/esl/scene/findDongTaiZiDuan` | 查商品欄位定義 | 讀取 |
| GET | `/v1/esl/goods/getByStoreId` | 分頁列出或搜尋門市商品 | 讀取 |
| GET | `/v1/esl/goods/singleQuery` | 以商品 ID 查一筆商品 | 讀取 |
| GET | `/v1/esl/template/findAll` | 列出門市模板 | 讀取 |
| GET | `/v1/esl/label/cascadQuery` | 列出門市標籤與狀態 | 讀取 |
| POST | `/v1/esl/label/batchBindQuery` | 依標籤或商品查綁定 | 讀取 |
| POST | `/v1/esl/goods/updateToStore` | 新增或更新一筆商品並刷新價籤 | 讀取與寫入 |
| POST | `/v1/esl/goods/batchUpdateBrush` | 批次新增或更新商品，並刷新已綁定的價籤 | 讀取與寫入 |
| POST | `/v1/esl/goods/batchDelete` | 批次刪除門市商品 | 讀取與寫入 |
| POST | `/v1/esl/label/update` | 綁定標籤、商品與模板 | 讀取與寫入 |
| POST | `/v1/esl/label/deleteBind` | 解除標籤綁定 | 讀取與寫入 |
| GET | `/v1/lynxess/token` | 驗證 token 是否可以使用 | 讀取 |

### GET /v1/esl/store/list

列出 token 可用的門市

列出這個 token 現在可以使用的門市：建立者目前被指派、而且在 token 門市範圍內的門市（組織擁有者是組織的門市）。每家門市的 `id` 就是其他端點的 `storeId`。

- 需要的權限：讀取
- 門市範圍：不需要門市：回應只列出這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `active` | query | integer | 是 | 1：營業中的門市；0：已關閉的門市 |
| `condition` | query | string | 否 | 依門市名稱、門市編號或地址搜尋 |

#### 範例

請求：

```sh
curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" "https://api.lynxess.com/v1/esl/store/list?active=1&condition=%E4%BF%A1%E7%BE%A9"
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": [
    {
      "id": "1408232104776437760",
      "number": "001",
      "name": "信義旗艦店",
      "active": 1,
      "country": null,
      "province": null,
      "city": null,
      "address": "台北市信義區松仁路 100 號",
      "serverIp": null,
      "image": "",
      "imageFullPath": null,
      "description": null,
      "latitude": null,
      "longitude": null,
      "createTime": "2026-09-01 10:00:00",
      "updateTime": "2026-09-01 10:00:00",
      "createBy": "1408232104776437700",
      "updateBy": null,
      "merchantCode": "886092",
      "remark": null,
      "deleteFlag": 0
    },
    {
      "id": "1408232104776437761",
      "number": "002",
      "name": "南港門市",
      "active": 1,
      "country": null,
      "province": null,
      "city": null,
      "address": "台北市南港區經貿二路 1 號",
      "serverIp": null,
      "image": "",
      "imageFullPath": null,
      "description": null,
      "latitude": null,
      "longitude": null,
      "createTime": "2026-09-01 10:00:00",
      "updateTime": "2026-09-01 10:00:00",
      "createBy": "1408232104776437700",
      "updateBy": null,
      "merchantCode": "886092",
      "remark": null,
      "deleteFlag": 0
    }
  ]
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### POST /v1/esl/scene/findDongTaiZiDuan

查商品欄位定義

列出組織的商品欄位（基本欄位與自訂欄位）。新增或更新商品時，以欄位的 `id` 當作 key 送欄位的值，例如 `price`。欄位在組織內共用，不需要門市。

- 需要的權限：讀取
- 門市範圍：不需要門市：組織內共用
- 使用上限：讀取 300 次／60 秒

#### 參數

沒有參數。

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" https://api.lynxess.com/v1/esl/scene/findDongTaiZiDuan
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": [
    {
      "_id": "60af6b554149c400017c9501",
      "id": "id",
      "number": 10001,
      "colunmDataType": 7,
      "internalType": 0,
      "name": "id",
      "description": null,
      "merchantCode": "886092",
      "prefix": null,
      "createTime": "2026-09-01 10:00:00",
      "createdBy": "1408232104776437700",
      "updateTime": "2026-09-01 10:00:00",
      "updatedBy": "1408232104776437700",
      "iconLibrary": null
    },
    {
      "_id": "60af6b554149c400017c9502",
      "id": "name",
      "number": 10002,
      "colunmDataType": 0,
      "internalType": 0,
      "name": "name",
      "description": null,
      "merchantCode": "886092",
      "prefix": null,
      "createTime": "2026-09-01 10:00:00",
      "createdBy": "1408232104776437700",
      "updateTime": "2026-09-01 10:00:00",
      "updatedBy": "1408232104776437700",
      "iconLibrary": null
    },
    {
      "_id": "60af6b554149c400017c9503",
      "id": "price",
      "number": 10003,
      "colunmDataType": 0,
      "internalType": 0,
      "name": "price",
      "description": null,
      "merchantCode": "886092",
      "prefix": null,
      "createTime": "2026-09-01 10:00:00",
      "createdBy": "1408232104776437700",
      "updateTime": "2026-09-01 10:00:00",
      "updatedBy": "1408232104776437700",
      "iconLibrary": null
    }
  ]
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### GET /v1/esl/goods/getByStoreId

分頁列出或搜尋門市商品

分頁列出一家門市的商品；帶 `fuzzy` 時只列出欄位內容符合關鍵字的商品。每筆商品是它的欄位與值。

- 需要的權限：讀取
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `page` | query | integer | 是 | 第幾頁，從 1 開始 |
| `size` | query | integer | 是 | 每頁幾筆 |
| `storeId` | query | string | 是 | 門市 ID，從「列出門市」取得 |
| `fuzzy` | query | string | 否 | 關鍵字：比對商品的欄位（流水號以外） |

#### 範例

請求：

```sh
curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" "https://api.lynxess.com/v1/esl/goods/getByStoreId?page=1&size=10&storeId=1408232104776437760&fuzzy=%E8%B1%86%E6%BC%BF"
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "currentPage": 1,
  "pageSize": 10,
  "totalNum": 1,
  "isMore": null,
  "totalPage": null,
  "startIndex": null,
  "items": [
    {
      "id": "6901939721248",
      "storeId": "1408232104776437760",
      "name": "有機豆漿 1L",
      "price": "39"
    }
  ],
  "hasStore": false
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### GET /v1/esl/goods/singleQuery

以商品 ID 查一筆商品

以商品 ID 讀取門市中的一筆商品與它的欄位。寫入之後用它讀回確認。

- 需要的權限：讀取
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `storeId` | query | string | 是 | 門市 ID，從「列出門市」取得 |
| `id` | query | string | 是 | 商品 ID |

#### 範例

請求：

```sh
curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" "https://api.lynxess.com/v1/esl/goods/singleQuery?storeId=1408232104776437760&id=6901939721248"
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": {
    "id": "6901939721248",
    "name": "有機豆漿 1L",
    "price": "39"
  }
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼：12068 這家門市沒有這個商品 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### GET /v1/esl/template/findAll

列出門市模板

分頁列出門市可以使用的價籤模板。綁定標籤時（綁定標籤、商品與模板）用模板的 `demoId`。

- 需要的權限：讀取
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `page` | query | integer | 是 | 第幾頁，從 1 開始 |
| `size` | query | integer | 是 | 每頁幾筆 |
| `fuzzy` | query | string | 否 | 關鍵字：比對模板名稱等資料 |
| `color` | query | string | 否 | 模板顏色，例如 black、red |
| `inch` | query | number | 否 | 螢幕尺寸（吋）；0 是不限 |
| `storeId` | query | string | 是 | 門市 ID，從「列出門市」取得 |
| `screening` | query | integer | 否 | 0：全部模板；1：系統模板；其他數字：門市模板 |

#### 範例

請求：

```sh
curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" "https://api.lynxess.com/v1/esl/template/findAll?page=1&size=6&fuzzy=%E5%83%B9%E6%A0%BC&color=red&inch=0&storeId=1408232104776437760&screening=2"
```

回應：

```json
{
  "code": 200,
  "msg": null,
  "data": {
    "code": null,
    "page": 1,
    "size": 6,
    "totalPage": 1,
    "totalCount": 1,
    "rows": [
      {
        "demoId": "1397855106749173760",
        "demoName": "價格標 2.13 吋",
        "screenSize": {
          "inch": 2.13,
          "width": 250,
          "height": 122
        },
        "demoData": "{\"inch\":2.13,\"resolution\":{\"width\":250,\"height\":122},\"elements\":{}}",
        "color": "red",
        "previewing": null,
        "storeId": "1408232104776437760",
        "orientation": 0,
        "version": 2,
        "merchantCode": "886092",
        "type": 0,
        "modify": 0,
        "crops": null,
        "createTime": "2026-09-01 10:00:00",
        "updateTime": "2026-09-01 10:00:00",
        "templateType": 0,
        "multivaluesCount": null,
        "multivaluesPreviewing": null,
        "thumbPath": null
      }
    ]
  }
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### GET /v1/esl/label/cascadQuery

列出門市標籤與狀態

分頁列出門市的標籤（電子價籤）或警示燈，與它們的上線狀態、電量和綁定的商品。回應不含裝置的金鑰或密碼。

- 需要的權限：讀取
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `page` | query | integer | 是 | 第幾頁，從 1 開始 |
| `size` | query | integer | 是 | 每頁幾筆 |
| `storeId` | query | string | 是 | 門市 ID，從「列出門市」取得 |
| `fuzzy` | query | string | 否 | 關鍵字，例如尺寸 2.13 |
| `eqstatus` | query | string | 是 | 要列出的狀態，多個以逗號分隔：1 離線、2 上線、5 低電量、8 已綁定、9 未綁定 |
| `type` | query | integer | 是 | 1：標籤；2：警示燈 |

#### 範例

請求：

```sh
curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" "https://api.lynxess.com/v1/esl/label/cascadQuery?page=1&size=10&storeId=1408232104776437760&fuzzy=2.13&eqstatus=1%2C2&type=1"
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "currentPage": 1,
  "pageSize": 10,
  "totalNum": 1,
  "isMore": 0,
  "totalPage": 1,
  "startIndex": 0,
  "items": [
    {
      "id": "1352070932163727360",
      "mac": "ac233fd010e2",
      "number": null,
      "type": 1,
      "screenSize": "2.13",
      "battery": 100,
      "lastupdate": "2026-09-25 09:30:00",
      "heartbeat": "0",
      "subcategory": null,
      "protocolStack": null,
      "firmware": "3.0.0",
      "hardware": null,
      "manufacturer": null,
      "storeId": "1408232104776437760",
      "temperature": 21,
      "chip": null,
      "rssi": -59,
      "peripheral": null,
      "createTime": "2026-09-01 10:00:00",
      "updateTime": "2026-09-25 09:30:00",
      "createBy": null,
      "updateBy": null,
      "merchantCode": "886092",
      "remark": null,
      "doubleSide": "1",
      "firmwareType": "0",
      "isOnline": "2",
      "goodsId": null,
      "goodsIds": [
        "6901939721248"
      ],
      "screenInfo": {
        "inch": 2.13,
        "width": 250,
        "height": 122,
        "color": "bwr"
      },
      "eslInterval": null,
      "monitorDuration": null
    }
  ],
  "hasStore": false
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### POST /v1/esl/label/batchBindQuery

依標籤或商品查綁定

查一家門市中，標籤綁定的商品與模板。以 `macs`（標籤）或 `goodIds`（商品）擇一查詢；沒有綁定時 `goodId` 與 `demoId` 是 null。

- 需要的權限：讀取
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `macs` | body | string[] | 否 | 標籤的 MAC（小寫 12 碼）；與 goodIds 擇一 |
| `storeId` | body | string | 是 | 門市 ID，從「列出門市」取得 |
| `goodIds` | body | string[] | 否 | 商品 ID；與 macs 擇一 |

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" -H "Content-Type: application/json" -d '{"macs":["ac233fd010e2"],"storeId":"1408232104776437760"}' https://api.lynxess.com/v1/esl/label/batchBindQuery
```

請求的 body：

```json
{
  "macs": [
    "ac233fd010e2"
  ],
  "storeId": "1408232104776437760"
}
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": [
    {
      "goodId": "6901939721248",
      "mac": "ac233fd010e2",
      "demoId": "1397855106749173760"
    }
  ]
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | 請求的格式不對，或批次超過 500 筆；details 說明是哪個欄位 |
| `REQUEST_TOO_LARGE` | 413 | 請求的內容太大 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### POST /v1/esl/goods/updateToStore

新增或更新一筆商品並刷新價籤

新增或更新門市中的一筆商品：商品 ID 不存在時新增，存在時更新你送的欄位。已綁定這個商品的價籤會自動刷新。庫存數量也是商品的自訂欄位，用同樣的方式送。

- 需要的權限：讀取與寫入
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：單筆寫入 120 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | body | string | 是 | 商品 ID |
| `storeId` | body | string | 是 | 門市 ID，從「列出門市」取得 |
| `<欄位 ID>` | body | string | 否 | 其他欄位：以「查商品欄位定義」的欄位 ID 當 key，例如 price |

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" -H "Content-Type: application/json" -d '{"id":"6901939721248","storeId":"1408232104776437760","price":"39","barcode":"6901939721248"}' https://api.lynxess.com/v1/esl/goods/updateToStore
```

請求的 body：

```json
{
  "id": "6901939721248",
  "storeId": "1408232104776437760",
  "price": "39",
  "barcode": "6901939721248"
}
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": null
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INTEGRATION_SCOPE_DENIED` | 403 | 讀取的 token 呼叫了需要寫入權限的端點 |
| `INVALID_REQUEST` | 400 | 請求的格式不對，或批次超過 500 筆；details 說明是哪個欄位 |
| `REQUEST_TOO_LARGE` | 413 | 請求的內容太大 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼：12070 門市不存在 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

#### 注意

- 外層 `code` 是 200 不代表價籤已經刷新。

### POST /v1/esl/goods/batchUpdateBrush

批次新增或更新商品，並刷新已綁定的價籤

一次新增或更新門市中最多 500 筆商品，已綁定的價籤會刷新；可以同時讓價籤的燈閃爍（`color`、`total`、`period`、`interval`、`brightness`，不需要時省略）。每筆商品都寫進請求的 `storeId`。結果的 `data` 是每筆商品各自的結果。

- 需要的權限：讀取與寫入
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：批次寫入 20 次／60 秒，每次最多 500 筆

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `storeId` | body | string | 是 | 門市 ID，從「列出門市」取得 |
| `goodsList` | body | object[] | 是 | 商品清單：每筆一個物件，id 是商品 ID，其他欄位以欄位 ID 當 key；每次最多 500 筆 |
| `goodsList[].id` | body | string | 是 | 商品 ID |
| `goodsList[].<欄位 ID>` | body | string | 否 | 其他欄位：以「查商品欄位定義」的欄位 ID 當 key，例如 price |
| `color` | body | integer | 否 | 燈的顏色：0 關、1 藍、2 綠、3 紅、4 黃、5 白、6 粉紅、7 青 |
| `total` | body | integer | 否 | 閃燈的總時間（秒）：週期乘以次數 |
| `period` | body | integer | 否 | 每個週期中亮燈的時間（毫秒），1 到 interval 減 1 |
| `interval` | body | integer | 否 | 一個週期的長度（毫秒） |
| `brightness` | body | integer | 否 | 亮度，1 到 100 |
| `opCode` | body | integer | 否 | 操作代碼，少於 10 位數；每次送不同的值，或不送由系統產生。它不能防止重複執行 |

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" -H "Content-Type: application/json" -d '{"storeId":"1408232104776437760","goodsList":[{"id":"6901939721248","price":"39"}]}' https://api.lynxess.com/v1/esl/goods/batchUpdateBrush
```

請求的 body：

```json
{
  "storeId": "1408232104776437760",
  "goodsList": [
    {
      "id": "6901939721248",
      "price": "39"
    }
  ]
}
```

回應：

```json
{
  "code": 200,
  "msg": "success",
  "data": [
    {
      "code": 200,
      "msg": "success",
      "data": null
    }
  ]
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INTEGRATION_SCOPE_DENIED` | 403 | 讀取的 token 呼叫了需要寫入權限的端點 |
| `INVALID_REQUEST` | 400 | 請求的格式不對，或批次超過 500 筆；details 說明是哪個欄位 |
| `REQUEST_TOO_LARGE` | 413 | 請求的內容太大 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼：12070 門市不存在 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

#### 注意

- 外層 `code` 是 200 不代表價籤已經刷新。
- 批次可能部分成功：要逐筆看結果，失敗時先讀回，只重送失敗的那幾筆。
- `opCode` 不能防止重複執行：失敗後不要整批重送。

### POST /v1/esl/goods/batchDelete

批次刪除門市商品

一次刪除門市中最多 500 筆商品。刪除前先向使用者列出要刪的商品並取得同意。

- 需要的權限：讀取與寫入
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市
- 使用上限：批次寫入 20 次／60 秒，每次最多 500 筆

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `storeId` | body | string | 是 | 門市 ID，從「列出門市」取得 |
| `idArray` | body | string[] | 是 | 要刪除的商品 ID，每次最多 500 筆 |

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" -H "Content-Type: application/json" -d '{"idArray":["6901939721248","6901939721255"],"storeId":"1408232104776437760"}' https://api.lynxess.com/v1/esl/goods/batchDelete
```

請求的 body：

```json
{
  "idArray": [
    "6901939721248",
    "6901939721255"
  ],
  "storeId": "1408232104776437760"
}
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": null
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INTEGRATION_SCOPE_DENIED` | 403 | 讀取的 token 呼叫了需要寫入權限的端點 |
| `INVALID_REQUEST` | 400 | 請求的格式不對，或批次超過 500 筆；details 說明是哪個欄位 |
| `REQUEST_TOO_LARGE` | 413 | 請求的內容太大 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

#### 注意

- 外層 `code` 是 200 不代表價籤已經刷新。
- 批次可能部分成功：要逐筆看結果，失敗時先讀回，只重送失敗的那幾筆。
- `opCode` 不能防止重複執行：失敗後不要整批重送。

### POST /v1/esl/label/update

綁定標籤、商品與模板

把門市中的一個標籤綁定到一個商品與模板；雙面標籤可以兩面各用一個模板。綁定前商品與模板要先存在，標籤也必須在這家門市。

- 需要的權限：讀取與寫入
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市，labelMac 的標籤也必須在這家門市
- 使用上限：單筆寫入 120 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `storeId` | body | string | 是 | 門市 ID，從「列出門市」取得 |
| `labelMac` | body | string | 是 | 標籤的 MAC（12 碼） |
| `goodsId` | body | string | 是 | 商品 ID |
| `demoIdMap` | body | object | 是 | 模板：A 是正面的模板 ID，雙面標籤另給 B（背面） |
| `demoIdMap.A` | body | string | 是 | 正面的模板 ID |
| `demoIdMap.B` | body | string | 否 | 背面的模板 ID |

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" -H "Content-Type: application/json" -d '{"labelMac":"AC233FD010E2","goodsId":"6901939721248","storeId":"1408232104776437760","demoIdMap":{"A":"1397855106749173760"}}' https://api.lynxess.com/v1/esl/label/update
```

請求的 body：

```json
{
  "labelMac": "AC233FD010E2",
  "goodsId": "6901939721248",
  "storeId": "1408232104776437760",
  "demoIdMap": {
    "A": "1397855106749173760"
  }
}
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": null
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INTEGRATION_SCOPE_DENIED` | 403 | 讀取的 token 呼叫了需要寫入權限的端點 |
| `INVALID_REQUEST` | 400 | 請求的格式不對，或批次超過 500 筆；details 說明是哪個欄位 |
| `REQUEST_TOO_LARGE` | 413 | 請求的內容太大 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼：12004 缺少必填的參數；12014 標籤沒有匯入這家門市；12015 模板是空的；12042 模板不存在；12043 標籤已經綁定；12044 綁定失敗；12045 模板與標籤的尺寸不符；12046 找不到商品，請先新增；54023 模板參數錯誤（例如標籤還沒回報它的螢幕） |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

### POST /v1/esl/label/deleteBind

解除標籤綁定

解除門市中一個標籤與商品、模板的綁定；標籤有初始化模板時會刷新成它。解除前先取得使用者同意。

- 需要的權限：讀取與寫入
- 門市範圍：請求的 storeId 必須是這個 token 可以使用的門市，mac 的標籤也必須在這家門市
- 使用上限：單筆寫入 120 次／60 秒

#### 參數

| 名稱 | 位置 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `mac` | query | string | 是 | 標籤的 MAC（小寫 12 碼） |
| `storeId` | query | string | 是 | 門市 ID，從「列出門市」取得 |

#### 範例

請求：

```sh
curl -sS -X POST -H "Authorization: Bearer $LYNXESS_API_TOKEN" "https://api.lynxess.com/v1/esl/label/deleteBind?mac=ac233fd010e2&storeId=1408232104776437760"
```

回應：

```json
{
  "code": 200,
  "msg": "Success",
  "data": null
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INTEGRATION_SCOPE_DENIED` | 403 | 讀取的 token 呼叫了需要寫入權限的端點 |
| `STORE_SCOPE_DENIED` | 403 | 門市或標籤不在這個 token 能用的範圍內 |
| `CAPABILITY_DENIED` | 403 | 建立 token 的成員在這家門市沒有這個動作的權限 |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `INTEGRATION_DISABLED` | 403 | 組織的整合 API 沒有開通 |
| `MEMBERSHIP_INACTIVE` | 403 | 建立 token 的成員目前不是啟用狀態，例如被停權 |
| `ORGANIZATION_SUSPENDED` | 403 | 組織被停權 |
| `ENTITLEMENT_EXPIRED` | 403 | 組織的方案已經過了寬限期 |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼：12016 標籤沒有綁定；12020 標籤不存在或 MAC 錯誤；12070 門市不存在；12092 解除綁定失敗；54031 標籤離線：綁定已經解除，但沒有刷新；54033 標籤沒有初始化的畫面 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |

#### 注意

- 標籤離線時，綁定會先解除，接著刷新失敗而回 `UPSTREAM_REJECTED`（`upstreamCode` 54031）：綁定其實已經解除，再送一次會得到 12016。先用「依標籤或商品查綁定」讀回確認。

### GET /v1/lynxess/token

驗證 token 是否可以使用

回答這個 token 現在能不能用（`ready` 與 `blockers`）、它的權限與到期日、能用哪些門市與每家能讀或能寫、使用上限、API 版本，以及最近 7 天最多 20 筆沒成功的呼叫（只有時間、方法與路徑、錯誤碼與支援代碼）。token 無效、過期或已撤銷時回 401；token 有效時一律回 200，不能用的原因列在 `blockers`：`INTEGRATION_DISABLED`（組織還沒開通整合 API）、`MEMBERSHIP_INACTIVE`（建立者不是啟用的成員）、`ORGANIZATION_SUSPENDED`（組織被停權）、`ENTITLEMENT_EXPIRED`（方案已過寬限期）、`NO_STORES`（沒有能用的門市）。

- 需要的權限：讀取
- 門市範圍：不需要門市；回應列出這個 token 可以使用的門市
- 使用上限：讀取 300 次／60 秒

#### 參數

沒有參數。

#### 範例

請求：

```sh
curl -sS -H "Authorization: Bearer $LYNXESS_API_TOKEN" https://api.lynxess.com/v1/lynxess/token
```

回應：

```json
{
  "ready": true,
  "blockers": [],
  "token": {
    "name": "門市 POS",
    "prefix": "lxi_7Kq2Ab",
    "scope": "read_write",
    "createdAt": "2026-09-25T02:00:00.000Z",
    "expiresAt": "2026-12-24T02:00:00.000Z",
    "daysLeft": 90
  },
  "creator": {
    "username": "mei_huang"
  },
  "organization": {
    "name": "好日子生活百貨",
    "integrationEnabled": true
  },
  "stores": {
    "mode": "selected",
    "stores": [
      {
        "storeId": "1408232104776437760",
        "name": "信義旗艦店",
        "canRead": true,
        "canWrite": true
      }
    ]
  },
  "limits": {
    "read": {
      "requests": 300,
      "windowSeconds": 60
    },
    "write": {
      "requests": 120,
      "windowSeconds": 60
    },
    "batch": {
      "requests": 20,
      "windowSeconds": 60
    },
    "organization": {
      "requests": 600,
      "windowSeconds": 60
    },
    "batchItems": 500
  },
  "apiVersion": {
    "api": "v1",
    "catalog": "1.0.0"
  },
  "recentErrors": [
    {
      "at": "2026-09-25T01:58:00.000Z",
      "method": "POST",
      "path": "/v1/esl/goods/batchUpdateBrush",
      "code": "STORE_SCOPE_DENIED",
      "correlationId": "7f3c2a9e-4b1d-4e8a-9c55-2d6f1a0b8e41"
    }
  ]
}
```

#### 可能的錯誤

| 錯誤碼 | HTTP | 意思 |
| --- | --- | --- |
| `INTEGRATION_TOKEN_INVALID` | 401 | token 無效、過期或已撤銷；details.reason 是 invalid、expired 或 revoked |
| `RATE_LIMITED` | 429 | 超過使用上限 |
| `CONTROL_API_UNAVAILABLE` | 503 | 暫時無法取得 token 的資料 |
| `UPSTREAM_REJECTED` | 422 | 門市管理服務拒絕了請求；details.upstreamCode 是它的結果代碼 |
| `UPSTREAM_PERMISSION_DENIED` | 403 | 門市管理服務的權限檢查拒絕了建立者 |
| `UPSTREAM_RATE_LIMITED` | 429 | 門市管理服務認為請求太頻繁 |
| `UPSTREAM_UNAVAILABLE` | 503 | 門市管理服務暫時無法回應，或沒有明確的結果 |
| `UPSTREAM_SESSION_REJECTED` | 503 | 門市管理服務暫時不接受這次的連線 |
| `UPSTREAM_CREDENTIAL_REJECTED` | 502 | 門市管理服務不接受建立者的帳號 |
| `UPSTREAM_ACCOUNT_DISABLED` | 403 | 建立者在門市管理服務的帳號被停用 |
| `UPSTREAM_ACCOUNT_EXPIRED` | 403 | 門市管理服務認為組織的帳號已經過期 |
| `UPSTREAM_ACCOUNT_NOT_FOUND` | 404 | 建立者還沒有門市管理的帳號 |
| `ADAPTER_UNAVAILABLE` | 503 | Lynxess 暫時無法處理請求，結果不確定 |
| `RESPONSE_REFUSED` | 502 | Lynxess 無法安全地轉回結果；請求可能已經執行 |
| `AUTHORIZATION_UNAVAILABLE` | 503 | 暫時無法確認 token 的權限，請求沒有送出 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 暫時無法計算使用上限，請求沒有送出 |
| `INTERNAL_ERROR` | 500 | Lynxess 內部錯誤，結果不確定 |
