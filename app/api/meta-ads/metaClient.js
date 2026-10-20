import "server-only";

// Server-only Meta Marketing / Graph API client.
//   - the token comes from SSM (metaToken.js) and is sent only in the Authorization header — never in a URL
//   - follows paging.next until done
//   - backs off and retries on rate-limit / transient errors
//   - on an auth error (OAuthException / code 190) clears the cached token and retries once with a fresh one
//   - logs the x-business-use-case-usage header on every response (it holds usage numbers only)
//   - errors carry only Meta's message and code — never the request URL, headers or token
import { getMetaToken, clearMetaToken } from "./metaToken";

const VERSION = process.env.META_API_VERSION || "v26.0";
export const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID; // act_XXXX
const GRAPH = `https://graph.facebook.com/${VERSION}`;

// Throttling codes: 4 app, 17 user, 32 page, 613 calls, 80000–80014 business use case (ads_insights = 80000)
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const isRateLimit = (code) => RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014);
const isAuthError = (err) => err?.code === 190 || err?.type === "OAuthException" && [102, 190, 463, 467].includes(err?.code);
const MAX_TRIES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Error safe to log and to send to the browser: Meta's message + code only
export class MetaApiError extends Error {
  constructor(message, { code, subcode, status } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.metaCode = code;
    this.metaSubcode = subcode;
    this.httpStatus = status;
  }
}
const clip = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 300);
// Anything at all that might echo the token or a URL is cut out of messages
function sanitize(msg, token) {
  let m = clip(msg);
  if (token) m = m.split(token).join("[redacted]");
  return m.replace(/https?:\/\/\S+/g, "[url]").replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").replace(/EAA[A-Za-z0-9]{20,}/g, "[redacted]");
}

export function assertConfigured() {
  const missing = ["META_TOKEN_PARAM", "META_AD_ACCOUNT_ID"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  if (!/^act_\d+$/.test(AD_ACCOUNT_ID)) throw new Error("META_AD_ACCOUNT_ID must look like act_1234567890");
}

// Minutes Meta says to wait, from x-business-use-case-usage ({ "<id>": [{ estimated_time_to_regain_access }] })
function regainMinutes(usageHeader) {
  try {
    const parsed = JSON.parse(usageHeader || "{}");
    return Math.max(0, ...Object.values(parsed).flat().map((u) => Number(u?.estimated_time_to_regain_access) || 0));
  } catch {
    return 0;
  }
}

// Never let a token ride along in a URL (paging.next links can echo query params)
function stripToken(url) {
  const u = new URL(url);
  u.searchParams.delete("access_token");
  return u.toString();
}

async function request(url, init = {}) {
  url = stripToken(url);
  let lastError;
  let authRetried = false;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const token = await getMetaToken();
    let res;
    try {
      res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (e) {
      lastError = new MetaApiError(`Network error calling Meta (${e?.cause?.code || e?.name || "fetch failed"})`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const usage = res.headers.get("x-business-use-case-usage");
    if (usage) console.log(`[meta-ads] x-business-use-case-usage: ${usage}`);
    const insightsThrottle = res.headers.get("x-fb-ads-insights-throttle");
    if (insightsThrottle) console.log(`[meta-ads] x-fb-ads-insights-throttle: ${insightsThrottle}`);

    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.error) return body;

    const err = body.error || {};
    lastError = new MetaApiError(
      `Meta API error ${err.code ?? res.status}${err.error_subcode ? `/${err.error_subcode}` : ""}: ${sanitize(err.message || `HTTP ${res.status}`, token)}`,
      { code: err.code, subcode: err.error_subcode, status: res.status },
    );

    // token rejected (expired / rotated): drop the cached one and try once more with a fresh read from SSM
    if (isAuthError(err) && !authRetried) {
      authRetried = true;
      clearMetaToken();
      attempt--;
      continue;
    }
    // "Please reduce the amount of data" — retrying the same request won't help; the caller switches to async
    if (isTooMuchData(lastError)) throw lastError;
    const retryable = isRateLimit(err.code) || err.is_transient || res.status >= 500 || err.code === 1 || err.code === 2;
    if (!retryable || attempt === MAX_TRIES) throw lastError;

    // Back off: Meta's own estimate if it gives one (capped at 2 min — Vercel functions are short-lived), else exponential
    const wait = Math.min(120_000, Math.max(regainMinutes(usage) * 60_000, 2000 * 2 ** attempt));
    console.warn(`[meta-ads] ${lastError.message} — retry ${attempt}/${MAX_TRIES - 1} in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  throw lastError;
}

export const isTooMuchData = (e) => /reduce the amount of data|too much data/i.test(e?.message || "") || e?.metaSubcode === 1487534;

export async function graphGet(path, params = {}) {
  return request(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
}

// Every row across all pages
export async function graphGetAll(path, params = {}) {
  const rows = [];
  let page = await graphGet(path, params);
  for (;;) {
    rows.push(...(page.data || []));
    const next = page.paging?.next;
    if (!next) break;
    page = await request(next);
  }
  return rows;
}

// Async insights report: start a job, poll until it's done, then read every row.
// Used when a synchronous request is too big for Meta to answer in one go.
export async function insightsAsync(path, params = {}, { timeoutMs = 200_000 } = {}) {
  const start = await request(`${GRAPH}/${path}`, { method: "POST", body: new URLSearchParams(params) });
  const id = start.report_run_id;
  if (!id) throw new MetaApiError("Meta did not return an async report id");
  const t0 = Date.now();
  for (;;) {
    await sleep(5000); // every poll is an API call — keep them sparse
    const job = await graphGet(id, { fields: "async_status,async_percent_completion" });
    if (job.async_status === "Job Completed") break;
    if (job.async_status === "Job Failed" || job.async_status === "Job Skipped") throw new MetaApiError(`Meta async report ${job.async_status.toLowerCase()}`);
    if (Date.now() - t0 > timeoutMs) throw new MetaApiError(`Meta async report still running (${job.async_percent_completion || 0}%) — try Refresh again in a few minutes`);
  }
  return graphGetAll(`${id}/insights`, { limit: "500" });
}

// Sync first; if Meta says the request is too large, run it as an async report instead
export async function insightsAuto(path, params = {}) {
  try {
    return await graphGetAll(path, params);
  } catch (e) {
    if (!isTooMuchData(e)) throw e;
    console.warn(`[meta-ads] ${e.message} — switching to an async report`);
    return insightsAsync(path, params);
  }
}

// What a route may send to the browser for any error
export function safeErrorMessage(e, fallback) {
  if (e instanceof MetaApiError) return e.message;
  const m = String(e?.message || "");
  // our own config / SSM messages are safe; anything else is replaced by the fallback
  if (/^(Missing env|META_AD_ACCOUNT_ID must|Could not read the Meta token|The Meta token parameter)/.test(m)) return m;
  return fallback;
}

export const API_VERSION = VERSION;
