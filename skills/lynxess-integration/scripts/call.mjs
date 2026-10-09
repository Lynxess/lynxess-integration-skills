#!/usr/bin/env node
// 呼叫 Lynxess 整合 API 的一個端點：只能是 ../references/openapi.json 裡的方法與路徑，其他一律拒絕、
// 不送出。寫入的端點要先把變更列給使用者並取得同意，再加上 --confirmed。
//
// 用法：
//   node scripts/call.mjs GET "/v1/esl/goods/getByStoreId?storeId=…&page=1&size=10"
//   node scripts/call.mjs POST /v1/esl/goods/batchUpdateBrush --body-file changes.json --confirmed
//   node scripts/call.mjs POST /v1/esl/goods/updateToStore --body '{"id":"…","storeId":"…"}' --confirmed
//   node scripts/call.mjs --help        列出全部端點
//
// 只讀兩個環境變數：LYNXESS_API_TOKEN（token）與 LYNXESS_API_BASE（API 位址，沒設時是正式環境）。
// 結束狀態：0 成功；1 API 回錯誤；2 沒有送出（設定或請求不對）；3 批次部分成功。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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

// ---- 共用段落結束 ----

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const ENDPOINTS = Object.entries(OPENAPI.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, operation]) => ({ method: method.toUpperCase(), path, operation })),
);

function listing() {
  return ENDPOINTS.map(
    ({ method, path, operation }) =>
      `  ${method} ${path}  ${operation.summary}（${operation["x-lynxess-scope"] === "read" ? "讀取" : "讀取與寫入"}）`,
  );
}

/** 不在文件裡的請求：說明原因與可以呼叫的端點，不送出。 */
function refuse(reason) {
  stop([`${reason} 不在整合 API 的文件裡，沒有送出。`, "可以呼叫的端點：", ...listing()]);
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    body: { type: "string" },
    "body-file": { type: "string" },
    confirmed: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help || positionals.length === 0) {
  process.stdout.write(
    [
      "用法：node scripts/call.mjs <方法> <路徑與 query> [--body <JSON> | --body-file <檔案>] [--confirmed]",
      "寫入的端點要先取得使用者同意，再加上 --confirmed。",
      "端點：",
      ...listing(),
      "",
    ].join("\n"),
  );
  process.exit(positionals.length === 0 && !values.help ? 2 : 0);
}

const config = settings();
const [rawMethod = "", target = ""] = positionals;
const method = rawMethod.toUpperCase();
if (positionals.length > 2) refuse(`多出來的參數「${positionals.slice(2).join(" ")}」`);
if (!target.startsWith("/")) refuse(`${method} ${target}`);
const [pathname = "", search = ""] = target.split(/\?(.*)/s);
const endpoint = ENDPOINTS.find((one) => one.method === method && one.path === pathname);
if (!endpoint || target.includes("#")) refuse(`${method} ${pathname}`);
const { operation } = endpoint;

// query：只能是文件列出的參數，必填的都要有，每個只出現一次。
const params = new URLSearchParams(search);
const documented = (operation.parameters ?? []).filter((param) => param.in === "query");
const names = [...params.keys()];
for (const name of names) {
  if (!documented.some((param) => param.name === name)) {
    refuse(
      `參數 ${name}（${method} ${pathname} 的參數：${documented.map((param) => param.name).join("、") || "沒有"}）`,
    );
  }
  if (params.getAll(name).length > 1) stop([`參數 ${name} 重複了，沒有送出。`]);
}
const missing = documented
  .filter((param) => param.required && !params.has(param.name))
  .map((param) => param.name);
if (missing.length > 0) stop([`缺少必填的參數：${missing.join("、")}，沒有送出。`]);

// body：只有文件有 requestBody 的端點才收，而且是 JSON 物件。
let body;
const bodyText =
  values["body-file"] === "-"
    ? readFileSync(0, "utf8")
    : values["body-file"]
      ? readFileSync(values["body-file"], "utf8")
      : values.body;
const schema = operation.requestBody?.content?.["application/json"]?.schema;
if (bodyText !== undefined && !schema) stop([`${method} ${pathname} 不收 body，沒有送出。`]);
if (schema) {
  if (bodyText === undefined)
    stop([`${method} ${pathname} 要帶 JSON body（--body 或 --body-file），沒有送出。`]);
  try {
    body = JSON.parse(bodyText);
  } catch {
    stop(["body 不是正確的 JSON，沒有送出。"]);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    stop(["body 必須是 JSON 物件，沒有送出。"]);
  const absent = (schema.required ?? []).filter((name) => !(name in body));
  if (absent.length > 0) stop([`body 缺少必填的欄位：${absent.join("、")}，沒有送出。`]);
  const batch = operation["x-lynxess-batch"];
  if (batch && Array.isArray(body[batch.field]) && body[batch.field].length > batch.maxItems) {
    stop([
      `${batch.field} 有 ${body[batch.field].length} 筆，每次最多 ${batch.maxItems} 筆：請拆成幾次送，沒有送出。`,
    ]);
  }
}

if (operation["x-lynxess-scope"] !== "read" && !values.confirmed) {
  stop([
    `${method} ${pathname}（${operation.summary}）會改變門市的資料，沒有送出。`,
    "先把要改的內容（哪些商品、舊值 → 新值，或要刪除、綁定、解綁的項目）列給使用者，取得同意後，加上 --confirmed 再執行。",
  ]);
}

const query = params.toString();
const result = await send(config, method, `${pathname}${query ? `?${query}` : ""}`, body);
if (result.status === 0 || result.status >= 300) {
  for (const line of explain(config, result)) process.stderr.write(`${line}\n`);
  process.exit(1);
}
process.stdout.write(
  `${safe(config, result.json === undefined ? result.text : JSON.stringify(result.json, null, 2))}\n`,
);
const reference = result.correlationId ? `（支援代碼：${result.correlationId}）` : "";
// 批次的結果要逐筆看：外層成功不代表每一筆都成功，也不代表價籤已經刷新。
const items =
  operation["x-lynxess-batch"] && Array.isArray(result.json?.data) ? result.json.data : null;
if (items) {
  const failed = items
    .map((item, index) => ({ index, code: item?.code, msg: item?.msg }))
    .filter((item) => item.code !== 200);
  process.stderr.write(
    `HTTP ${result.status}${reference}：逐筆結果 ${items.length - failed.length} 筆成功、${failed.length} 筆失敗。\n`,
  );
  if (failed.length > 0) {
    for (const item of failed) {
      process.stderr.write(
        `  第 ${item.index + 1} 筆：${item.code} ${safe(config, item.msg ?? "")}\n`,
      );
    }
    process.stderr.write("部分成功：先讀回確認，只重送失敗的那幾筆，不要整批重送。\n");
    // 不用 process.exit：stdout 接到 pipe 時可能還沒寫完（macOS 上 pipe 是非同步的）。
    process.exitCode = 3;
  }
} else {
  process.stderr.write(`HTTP ${result.status}${reference}\n`);
}
if (operation["x-lynxess-scope"] !== "read") {
  process.stderr.write("外層成功不代表價籤已經刷新：請讀回確認。\n");
}
