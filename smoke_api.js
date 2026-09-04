const BASE = process.env.BASE || "http://127.0.0.1:3100";
const FORM_ID = "tech_onboarding";
const TOKENS = { admin: "demo-admin-token", hr: "demo-hr-token", viewer: "demo-viewer-token" };

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
  return "测试内容";
}

(async () => {
  const results = [];
  const health = await req("GET", "/health");
  results.push(["GET /health", health.status, health.text.slice(0, 60)]);

  const noAuth = await req("GET", `/api/v1/forms/${FORM_ID}/schema`);
  results.push(["GET schema (no token)", noAuth.status, "expect 401"]);

  const schema = await req("GET", `/api/v1/forms/${FORM_ID}/schema`, { token: TOKENS.viewer });
  results.push(["GET schema (viewer)", schema.status, `v=${schema.json?.schema?.version} etag=${schema.etag}`]);

  const s = schema.json?.schema;
  const payload = {};
  for (const f of s?.fields || []) {
    if (f.required !== true) continue;
    payload[f.key] = sample(f);
  }
  const submit = await req("POST", `/api/v1/dynamic-data/${FORM_ID}`, { token: TOKENS.hr, body: payload });
  results.push(["POST dynamic-data (hr)", submit.status, submit.json?.ok ? `id=${submit.json.submissionId}` : (submit.text || "").slice(0, 160)]);

  const bad = await req("POST", `/api/v1/dynamic-data/${FORM_ID}`, { token: TOKENS.hr, body: { ...payload, email: "not-an-email" } });
  results.push(["POST invalid payload", bad.status, (bad.text || "").slice(0, 140)]);

  const list = await req("GET", `/api/v1/dynamic-data/${FORM_ID}?page=1&pageSize=5`, { token: TOKENS.viewer });
  results.push(["GET dynamic-data (viewer)", list.status, `total=${list.json?.total ?? list.json?.items?.length ?? "?"}`]);

  const audit = await req("GET", `/api/v1/audit?page=1&pageSize=5`, { token: TOKENS.hr });
  results.push(["GET /api/v1/audit (hr)", audit.status, `items=${audit.json?.items?.length ?? "?"}`]);

  const files = await req("GET", `/api/v1/files`, { token: TOKENS.hr });
  results.push(["GET /api/v1/files (hr)", files.status, ""]);

  for (const [name, status, extra] of results) {
    console.log(`${String(status).padEnd(4)} ${name.padEnd(28)} ${extra}`);
  }
})();
