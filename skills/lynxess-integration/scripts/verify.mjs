#!/usr/bin/env node
// 驗證 Lynxess 整合 API 的 token：呼叫就緒檢查 GET /v1/lynxess/token，整理成看得懂的摘要——能不能用、
// 不能用的原因與誰能處理、權限、到期日、能用的門市、使用上限與最近沒成功的呼叫。
// 用法：node scripts/verify.mjs [--json]（--json 只印出就緒檢查的回應，給程式讀）
//
// 只讀兩個環境變數：LYNXESS_API_TOKEN（token）與 LYNXESS_API_BASE（API 位址，沒設時是正式環境）。
// 結束狀態：0 token 可以使用；1 不能用或 API 回錯誤；2 沒有送出（設定不對）。

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

// ---- 共用段落結束 ----

const READINESS = OPENAPI.paths["/v1/lynxess/token"].get;
const SCOPE = { read: "讀取", read_write: "讀取與寫入" };
const MODE = { all_my_stores: "建立者目前全部的門市", selected: "建立時指定的門市" };
/** 這個 skill 是依哪一版的 API 與端點清單做的。 */
const SKILL_VERSION = OPENAPI["x-lynxess-api-version"];

/** 版本 a 是否比 b 新（v1、v2…；1.2.3 逐段比數字）。 */
function newer(a, b) {
  const parts = (value) =>
    String(value ?? "")
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    if ((left[at] ?? 0) !== (right[at] ?? 0)) return (left[at] ?? 0) > (right[at] ?? 0);
  }
  return false;
}

/** 就緒檢查回的 API 比 skill 新時，提醒重新執行安裝指令。 */
function reminder(answer) {
  const version = answer.apiVersion ?? {};
  const outdated =
    newer(version.api, SKILL_VERSION.api) ||
    (!newer(SKILL_VERSION.api, version.api) && newer(version.catalog, SKILL_VERSION.catalog));
  if (!outdated) return [];
  return [
    `! Lynxess 整合 API 已經更新（${version.api} ${version.catalog}，這個 skill 是 ${SKILL_VERSION.api} ${SKILL_VERSION.catalog}）。請重新執行安裝指令，更新 skill：`,
    `  ${OPENAPI["x-lynxess-skill"]?.install}`,
  ];
}

/** 台北時間的日期（與時間）：台北沒有夏令時間，是 UTC+8。 */
function taipei(iso, withTime = false) {
  const at = new Date(Date.parse(iso) + 8 * 3600_000);
  if (Number.isNaN(at.getTime())) return String(iso);
  const date = `${at.getUTCFullYear()} 年 ${at.getUTCMonth() + 1} 月 ${at.getUTCDate()} 日`;
  const time = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
  return withTime ? `${date} ${time}` : date;
}

function summary(answer) {
  const lines = [];
  if (answer.ready) {
    lines.push("✓ token 可以使用");
  } else {
    lines.push("✗ token 現在不能用：");
    for (const blocker of answer.blockers ?? []) {
      lines.push(`  - ${blocker}：${READINESS["x-lynxess-blockers"]?.[blocker] ?? ""}`);
    }
  }
  const token = answer.token ?? {};
  lines.push(`  token：${token.name}（${token.prefix}），${SCOPE[token.scope] ?? token.scope}`);
  lines.push(`  到期：${taipei(token.expiresAt)}（還有 ${token.daysLeft} 天）`);
  lines.push(
    `  建立者：${answer.creator?.username ?? "（還沒有使用者名稱）"}；組織：${answer.organization?.name}${answer.organization?.integrationEnabled ? "" : "（整合 API 還沒開通）"}`,
  );
  const stores = answer.stores?.stores ?? [];
  lines.push(
    `  門市（${MODE[answer.stores?.mode] ?? answer.stores?.mode}）：${stores.length === 0 ? "沒有能用的門市" : ""}`,
  );
  for (const store of stores) {
    const can = [store.canRead ? "讀取" : "", store.canWrite ? "寫入" : ""].filter(Boolean);
    lines.push(
      `    - ${store.name ?? "（沒有名稱）"}（${store.storeId}）：${can.length > 0 ? can.join("、") : "不能讀取或寫入"}`,
    );
  }
  const limits = answer.limits ?? {};
  const per = (limit) => `${limit?.requests} 次／${limit?.windowSeconds} 秒`;
  lines.push(
    `  使用上限：讀取 ${per(limits.read)}；單筆寫入 ${per(limits.write)}；批次寫入 ${per(limits.batch)}，每次最多 ${limits.batchItems} 筆；組織合計 ${per(limits.organization)}`,
  );
  const errors = answer.recentErrors ?? [];
  lines.push(`  最近 7 天沒成功的呼叫：${errors.length} 筆`);
  for (const error of errors) {
    const meaning = OPENAPI.components?.examples?.[error.code]?.summary;
    const upstream = error.upstreamCode === undefined ? "" : `，上游代碼 ${error.upstreamCode}`;
    lines.push(
      `    - ${taipei(error.at, true)} ${error.method} ${error.path ?? "（不是整合 API 的端點）"} ${error.code}${meaning ? `：${meaning}` : ""}（支援代碼：${error.correlationId}${upstream}）`,
    );
  }
  const version = answer.apiVersion ?? {};
  const same = version.api === SKILL_VERSION.api && version.catalog === SKILL_VERSION.catalog;
  lines.push(
    `  API 版本：${version.api}（端點清單 ${version.catalog}）${same ? "，與 skill 相同" : `；skill 是 ${SKILL_VERSION.api}（${SKILL_VERSION.catalog}）`}`,
  );
  return [...lines, ...reminder(answer)];
}

const json = process.argv.slice(2).includes("--json");
const config = settings();
const result = await send(config, "GET", "/v1/lynxess/token");
// 以 exitCode 結束，不用 process.exit：stdout 接到 pipe 時可能還沒寫完（macOS 上 pipe 是非同步的）。
if (result.status !== 200 || !result.json || typeof result.json.ready !== "boolean") {
  if (json && result.json)
    process.stdout.write(`${safe(config, JSON.stringify(result.json, null, 2))}\n`);
  process.stdout.write("✗ token 不能用，或沒有得到就緒檢查的結果\n");
  for (const line of explain(config, result)) process.stdout.write(`  ${line}\n`);
  process.exitCode = 1;
} else {
  const answer = result.json;
  if (json) {
    process.stdout.write(`${safe(config, JSON.stringify(answer, null, 2))}\n`);
    for (const line of reminder(answer)) process.stderr.write(`${line}\n`);
  } else {
    for (const line of summary(answer)) process.stdout.write(`${safe(config, line)}\n`);
  }
  process.exitCode = answer.ready ? 0 : 1;
}
