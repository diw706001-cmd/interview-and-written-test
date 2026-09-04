#!/usr/bin/env node
/**
 * 上线验收脚本：对运行中的服务做一次端到端冒烟检查。
 *
 * 用法：
 *   node scripts/smoke-api.js                       # 默认 http://127.0.0.1:3000
 *   BASE=https://your-domain node scripts/smoke-api.js
 *   BASE=... HR_TOKEN=xxx VIEWER_TOKEN=yyy node scripts/smoke-api.js
 */

const BASE = (process.env.BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const FORM_ID = process.env.FORM_ID || "tech_onboarding";
const HR_TOKEN = process.env.HR_TOKEN || "demo-hr-token";
const VIEWER_TOKEN = process.env.VIEWER_TOKEN || "demo-viewer-token";

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, etag: res.headers.get("etag") };
}

function sample(field) {
  const rules = field.rules || {};
  if (rules.email) return "qa@example.com";
  if (rules.regex === "^1\\d{10}$") return "13800000000";
  if (rules.type === "number" || rules.min !== undefined) return 4;
  if (field.type === "select") {
    const first = (field.options || [])[0];
    return typeof first === "object" && first ? first.value : first;
  }
  if (field.type === "repeater") {
    const sub = (field.itemSchema?.fields || []).filter((f) => f.required);
    return sub.length ? [Object.fromEntries(sub.map((f) => [f.key, sample(f)]))] : [];
  }
  if (field.type === "object") {
    const sub = field.itemSchema?.fields || [];
    return Object.fromEntries(sub.map((f) => [f.key, sample(f)]));
  }
  return "验收样例";
}

(async () => {
  const rows = [];
  const push = (name, res, extra = "") => rows.push([name, res.status, extra]);

  const health = await req("GET", "/health");
  push("GET /health", health, health.json?.ok ? "ok" : health.text.slice(0, 60));

  const noAuth = await req("GET", `/api/v1/forms/${FORM_ID}/schema`);
  push("GET schema（无 token，期望 401）", noAuth, noAuth.status === 401 ? "已鉴权拦截" : "未拦截，请检查 HR_AUTH_REQUIRED");

  const schema = await req("GET", `/api/v1/forms/${FORM_ID}/schema`, { token: VIEWER_TOKEN });
  push("GET schema（viewer）", schema, schema.json ? `v=${schema.json.schema?.version} etag=${schema.etag}` : schema.text.slice(0, 60));

  const s = schema.json?.schema;
  const payload = {};
  for (const f of s?.fields || []) {
    if (f.required !== true) continue;
    payload[f.key] = sample(f);
  }
  const submit = await req("POST", `/api/v1/dynamic-data/${FORM_ID}`, { token: HR_TOKEN, body: payload });
  push("POST dynamic-data（hr）", submit, submit.json?.ok ? `submissionId=${submit.json.submissionId}` : (submit.text || "").slice(0, 120));

  const bad = await req("POST", `/api/v1/dynamic-data/${FORM_ID}`, { token: HR_TOKEN, body: { ...payload, email: "not-an-email" } });
  push("POST 非法 payload（期望 422）", bad, bad.json?.errors?.[0]?.message || bad.text.slice(0, 80));

  const list = await req("GET", `/api/v1/dynamic-data/${FORM_ID}?page=1&pageSize=5`, { token: VIEWER_TOKEN });
  push("GET dynamic-data（分页/筛选）", list, `total=${list.json?.total ?? "?"}`);

  const audit = await req("GET", "/api/v1/audit?page=1&pageSize=5", { token: HR_TOKEN });
  push("GET /api/v1/audit", audit, `items=${audit.json?.items?.length ?? "?"}`);

  let failed = 0;
  for (const [name, status, extra] of rows) {
    const ok = /期望 401/.test(name) ? status === 401 : /期望 422/.test(name) ? status === 422 : status < 500;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${String(status).padEnd(4)} ${name.padEnd(30)} ${extra}`);
  }
  console.log(`\nBASE=${BASE}  通过 ${rows.length - failed}/${rows.length}`);
  process.exit(failed ? 1 : 0);
})();
