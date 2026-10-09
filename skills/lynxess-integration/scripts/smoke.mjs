#!/usr/bin/env node
// Lynxess 整合 API 的連線測試，只讀不寫：驗證 token → 列出門市 → 查商品欄位 → 列出一家門市的商品
// → 讀一筆商品。用法：node scripts/smoke.mjs
//
// 只讀兩個環境變數：LYNXESS_API_TOKEN（token）與 LYNXESS_API_BASE（API 位址，沒設時是正式環境）。
// token 只放進 Authorization 標頭，不會印出。端點、說明與錯誤碼都來自 ../references/openapi.json。
// 每支 script 都是單一檔案、沒有外部套件，所以下面的共用段落三支 script 各有一份。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- 共用段落（verify.mjs、smoke.mjs、call.mjs 相同）----

const OPENAPI = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "references", "openapi.json"),
    "utf8",
  ),
);
const TOKEN_FORM = /^lxi_[A-Za-z0-9_-]{43}$/;

/** 設定有問題：說明怎麼修，不送出任何請求，以狀態 2 結束。 */
function stop(lines) {
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(2);
}

/** token 與 API 位址，只從環境變數讀。 */
function settings() {
  const token = process.env.LYNXESS_API_TOKEN?.trim() ?? "";
  if (!token) {
    stop([
      "找不到 token：請把 Integration token 放進環境變數 LYNXESS_API_TOKEN。",
      "在 Lynxess 帳號網站的「整合 API › token 管理」建立 token，複製完整的 token（lxi_ 開頭），再執行：",
      "  export LYNXESS_API_TOKEN='貼上 token'",
      "  （Windows PowerShell：$env:LYNXESS_API_TOKEN='貼上 token'）",
      "不要把 token 貼進對話、寫進檔案或程式碼。",
    ]);
  }
  if (!TOKEN_FORM.test(token)) {
    stop([
      "LYNXESS_API_TOKEN 不是 Integration token：它應該是 lxi_ 開頭、共 47 個字元。",
      "請重新複製建立時顯示的完整 token；為了安全，這個值沒有送出。",
    ]);
  }
  const raw = process.env.LYNXESS_API_BASE?.trim() || OPENAPI.servers[0].url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    stop(["LYNXESS_API_BASE 不是網址，例如 https://api.lynxess.com。沒有設定時用正式環境。"]);
  }
  if (url.username || url.password) stop(["LYNXESS_API_BASE 不能包含帳號或密碼。"]);
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    stop([
      "LYNXESS_API_BASE 必須是 https:// 開頭的網址；只有本機測試可以用 http://。",
      "否則 token 會以明文傳送，所以沒有送出任何請求。",
    ]);
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}`;
  return { token, base, origin: url.origin };
}

/** 送出一個請求；回傳狀態、JSON 與支援代碼。連不上時 status 是 0。 */
async function send(config, method, path, body) {
  try {
    const response = await fetch(`${config.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: response.status,
      json,
      text,
      correlationId: response.headers.get("x-lynxess-correlation-id"),
      retryAfter: response.headers.get("retry-after"),
    };
  } catch (error) {
    return { status: 0, error: error?.cause?.code ?? error?.name ?? "error" };
  }
}

/** 拿掉輸出裡任何 token：token 永遠不印出。 */
function safe(config, text) {
  return String(text).split(config.token).join("[token]");
}

/** 一個沒成功的回應，以看得懂的繁中說明。 */
function explain(config, result) {
  if (result.status === 0) {
    return [`連不上 ${config.origin}（${result.error}）。請確認網路與 LYNXESS_API_BASE。`];
  }
  const error = result.json?.error ?? {};
  const code = typeof error.code === "string" ? error.code : undefined;
  const shared = code ? OPENAPI.components?.examples?.[code] : undefined;
  const lines = [
    `HTTP ${result.status}${code ? ` ${code}` : ""}${shared ? `：${shared.summary}` : ""}`,
  ];
  if (code === "INTEGRATION_TOKEN_INVALID") {
    const reasons = OPENAPI.paths["/v1/lynxess/token"]?.get?.["x-lynxess-token-reasons"] ?? {};
    lines.push(reasons[error.details?.reason] ?? reasons.invalid ?? "");
  } else if (shared?.description) {
    lines.push(`怎麼做：${shared.description}`);
  }
  if (result.status === 429 && result.retryAfter) {
    lines.push(`請等 ${result.retryAfter} 秒後再送。`);
  }
  if (typeof error.details?.upstreamCode === "number") {
    lines.push(`上游的結果代碼：${error.details.upstreamCode}`);
  }
  if (result.status === 404 && !code) {
    lines.push("這個 API 位址沒有整合 API：請確認 LYNXESS_API_BASE。");
  }
  const correlationId = error.correlationId ?? result.correlationId;
  if (correlationId) lines.push(`支援代碼：${correlationId}`);
  return lines.filter(Boolean).map((line) => safe(config, line));
}

/** OpenAPI 裡某個 route 的方法與路徑（x-lynxess-route），以及它是否只讀。 */
function route(id) {
  for (const [path, item] of Object.entries(OPENAPI.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (operation["x-lynxess-route"] === id) {
        return { method: method.toUpperCase(), path, operation };
      }
    }
  }
  throw new Error(`references/openapi.json 沒有 ${id}`);
}

// ---- 共用段落結束 ----

/** 這個測試只送出讀取：驗證 token、A1、A2、A3、A4（spec 的唯讀連線測試）。 */
const STEPS = ["readiness", "A1", "A2", "A3", "A4"].map(route);
for (const step of STEPS) {
  if (step.operation["x-lynxess-scope"] !== "read") {
    throw new Error(`${step.method} ${step.path} 不是讀取的端點，連線測試不會送出它`);
  }
}
const [READINESS, STORES, FIELDS, PRODUCTS, PRODUCT] = STEPS;

const config = settings();
const out = (line) => process.stdout.write(`${safe(config, line)}\n`);
const fail = (step, result) => {
  out(`✗ ${step}`);
  for (const line of explain(config, result)) out(`  ${line}`);
  out("連線測試沒有通過。");
  process.exit(1);
};

out(`連線測試：${config.origin}（只讀，不做任何寫入）`);

const readiness = await send(config, READINESS.method, READINESS.path);
if (readiness.status !== 200) fail("1/5 驗證 token", readiness);
const answer = readiness.json;
if (!answer.ready) {
  out("✗ 1/5 驗證 token：token 現在不能用");
  const blockers = READINESS.operation["x-lynxess-blockers"] ?? {};
  for (const blocker of answer.blockers ?? []) out(`  ${blocker}：${blockers[blocker] ?? ""}`);
  out("連線測試沒有通過。");
  process.exit(1);
}
const scope = answer.token?.scope === "read_write" ? "讀取與寫入" : "讀取";
out(`✓ 1/5 驗證 token：可以使用（${answer.token?.name}，${scope}）`);

const stores = await send(config, STORES.method, `${STORES.path}?active=1`);
if (stores.status !== 200) fail("2/5 列出門市", stores);
const storeList = Array.isArray(stores.json?.data) ? stores.json.data : [];
out(`✓ 2/5 列出門市：${storeList.length} 家`);

const fields = await send(config, FIELDS.method, FIELDS.path);
if (fields.status !== 200) fail("3/5 查商品欄位", fields);
const fieldList = Array.isArray(fields.json?.data) ? fields.json.data : [];
out(`✓ 3/5 查商品欄位：${fieldList.length} 個欄位`);

// 用驗證結果裡第一家能讀的門市；沒有時用門市清單的第一家。
const readable = (answer.stores?.stores ?? []).find((store) => store.canRead);
const storeId = readable?.storeId ?? storeList[0]?.id;
if (!storeId) {
  out("✗ 4/5 列出商品：token 沒有能讀的門市");
  out("連線測試沒有通過。");
  process.exit(1);
}
const storeName =
  readable?.name ?? storeList.find((store) => store.id === storeId)?.name ?? storeId;
const query = new URLSearchParams({ page: "1", size: "1", storeId });
const products = await send(config, PRODUCTS.method, `${PRODUCTS.path}?${query}`);
if (products.status !== 200) fail("4/5 列出商品", products);
const items = Array.isArray(products.json?.items) ? products.json.items : [];
out(`✓ 4/5 列出商品（${storeName}）：共 ${products.json?.totalNum ?? items.length} 筆`);

const first = items[0]?.id;
if (first === undefined) {
  out("- 5/5 讀一筆商品：這家門市沒有商品，略過");
} else {
  const one = new URLSearchParams({ storeId, id: String(first) });
  const product = await send(config, PRODUCT.method, `${PRODUCT.path}?${one}`);
  if (product.status !== 200) fail("5/5 讀一筆商品", product);
  out(`✓ 5/5 讀一筆商品：${first}`);
}
out("連線測試通過：只做了讀取，沒有任何寫入。");
