const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  completeFile,
  createServer,
  configurePersistence,
  detectRuleCycles,
  getSchemaEtag,
  resetState,
  initFile,
  uploadFileContent,
  submitDynamicData,
  validateSubmission,
  validateSchema,
  getStateSnapshot,
  DEMO_FORM_ID,
} = require("../server-core");

function requestJson(port, method, pathname, body, token = "demo-admin-token", extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : {} });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function requestBuffer(port, method, pathname, buffer, token = "demo-admin-token", contentType = "application/pdf") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          "Content-Length": buffer.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : {} });
        });
      }
    );
    req.on("error", reject);
    req.end(buffer);
  });
}

test("validateSubmission accepts a valid submission with alias mapping", () => {
  const schema = {
    formId: DEMO_FORM_ID,
    version: 4,
    status: "Published",
    aliases: { employeeName: "fullName" },
    fields: [
      { key: "fullName", label: "姓名", type: "input", required: true, validation: { minLength: 2 } },
      { key: "email", label: "邮箱", type: "input", required: true, validation: { email: true } },
    ],
  };

  const errors = validateSubmission(schema, { employeeName: "张三", email: "zhangsan@example.com" });
  assert.deepEqual(errors, []);
});

test("validateSubmission rejects invalid email", () => {
  const schema = {
    formId: DEMO_FORM_ID,
    version: 4,
    status: "Published",
    fields: [
      { key: "email", label: "邮箱", type: "input", required: true, validation: { email: true } },
    ],
  };

  const errors = validateSubmission(schema, { email: "bad-email" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "email");
});

test("detectRuleCycles finds a cycle", () => {
  const schema = {
    formId: "demo",
    version: 1,
    status: "Published",
    fields: [
      { key: "a", label: "A", type: "input", visibleWhen: { field: "c", equals: 1 } },
      { key: "b", label: "B", type: "input", visibleWhen: { field: "a", equals: 1 } },
      { key: "c", label: "C", type: "input", visibleWhen: { field: "b", equals: 1 } },
    ],
  };

  const cycles = detectRuleCycles(schema);
  assert.ok(cycles.length >= 1);
});

test("submitDynamicData stores a submission and audit log", async () => {
  resetState();
  const file = initFile({
    originalName: "id-card.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
    actor: { id: "user_hr" },
  });
  uploadFileContent(file.fileId, Buffer.from("demo"), "application/pdf", { id: "user_hr" });
  completeFile(file.fileId, {}, { id: "user_hr" });
  const result = await submitDynamicData(DEMO_FORM_ID, {
    fullName: "张三",
    department: "rd",
    email: "zhangsan@example.com",
    isFreshGraduate: "yes",
    expectedSalary: 28000,
    idCard: file.fileId,
    workExperiences: [],
  });

  assert.equal(result.ok, true);
  const state = getStateSnapshot();
  assert.equal(state.submissions.length, 1);
  assert.equal(state.auditLogs[0].action, "submission.created");
});

test("server serves schema and accepts submissions", async (t) => {
  resetState();
  const server = createServer({ rootDir: path.join(__dirname, ".."), persist: false });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const unauthenticatedRes = await requestJson(port, "GET", `/api/v1/forms/${DEMO_FORM_ID}/schema`, undefined, "");
  assert.equal(unauthenticatedRes.statusCode, 401);

  const schemaRes = await requestJson(port, "GET", `/api/v1/forms/${DEMO_FORM_ID}/schema`, undefined, "demo-viewer-token");
  assert.equal(schemaRes.statusCode, 200);
  assert.equal(schemaRes.body.schema.version, 4);
  assert.ok(schemaRes.body.etag);

  const fileInit = await requestJson(port, "POST", "/api/v1/files/init", {
    originalName: "id-card.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
  });
  assert.equal(fileInit.statusCode, 200);
  const fileUpload = await requestBuffer(port, "PUT", `/api/v1/files/${fileInit.body.fileId}/content`, Buffer.from("demo"));
  assert.equal(fileUpload.statusCode, 200);
  const fileComplete = await requestJson(port, "POST", `/api/v1/files/${fileInit.body.fileId}`, {});
  assert.equal(fileComplete.statusCode, 200);

  const submitRes = await requestJson(port, "POST", `/api/v1/dynamic-data/${DEMO_FORM_ID}`, {
    fullName: "李四",
    department: "qa",
    email: "lisi@example.com",
    isFreshGraduate: "yes",
    expectedSalary: 26000,
    idCard: fileInit.body.fileId,
    workExperiences: [],
  });
  assert.equal(submitRes.statusCode, 200);
  assert.equal(submitRes.body.ok, true);

  const listRes = await requestJson(port, "GET", `/api/v1/dynamic-data/${DEMO_FORM_ID}`, undefined, "demo-viewer-token");
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.total, 1);
});

test("HTTP file flow rejects unsafe files and accepts a valid binary", async (t) => {
  resetState();
  const server = createServer({ rootDir: path.join(__dirname, ".."), persist: false });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const unsafe = await requestJson(port, "POST", "/api/v1/files/init", {
    originalName: "../../secret.exe",
    mimeType: "application/x-msdownload",
    sizeBytes: 4,
  });
  assert.equal(unsafe.statusCode, 400);

  const init = await requestJson(port, "POST", "/api/v1/files/init", {
    originalName: "../../id-card.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
  });
  assert.equal(init.statusCode, 200);
  assert.equal(init.body.file.originalName, "id-card.pdf");

  const wrongSize = await requestBuffer(port, "PUT", `/api/v1/files/${init.body.fileId}/content`, Buffer.from("bad"));
  assert.equal(wrongSize.statusCode, 422);

  const upload = await requestBuffer(port, "PUT", `/api/v1/files/${init.body.fileId}/content`, Buffer.from("demo"));
  assert.equal(upload.statusCode, 200);
  assert.equal(upload.body.file.scanStatus, "clean");
});

test("audit output redacts sensitive values", async () => {
  resetState();
  const file = initFile({ originalName: "id.pdf", mimeType: "application/pdf", sizeBytes: 1 });
  uploadFileContent(file.fileId, Buffer.from("x"), "application/pdf");
  completeFile(file.fileId);
  const result = await submitDynamicData(DEMO_FORM_ID, {
    fullName: "敏感数据测试",
    department: "rd",
    email: "sensitive@example.com",
    isFreshGraduate: "yes",
    expectedSalary: 50000,
    idCard: file.fileId,
    workExperiences: [],
  });
  assert.equal(result.ok, true);
  const audit = getStateSnapshot().auditLogs[0];
  assert.equal(audit.afterValue.data.expectedSalary, "[REDACTED]");
});

test("viewer cannot publish schema and hr cannot inspect debug state", async (t) => {
  resetState();
  const server = createServer({ rootDir: path.join(__dirname, ".."), persist: false });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const schemaRes = await requestJson(port, "GET", `/api/v1/forms/${DEMO_FORM_ID}/schema`, undefined, "demo-viewer-token");
  const schema = JSON.parse(JSON.stringify(schemaRes.body.schema));
  schema.version = 5;
  const publishRes = await requestJson(port, "POST", `/api/v1/forms/${DEMO_FORM_ID}/schema/publish`, { schema }, "demo-viewer-token", { "If-Match": schemaRes.body.etag });
  assert.equal(publishRes.statusCode, 403);
  const debugRes = await requestJson(port, "GET", "/api/v1/debug/state", undefined, "demo-hr-token");
  assert.equal(debugRes.statusCode, 403);
});

test("dynamic query supports filters and pagination", async () => {
  resetState();
  await submitDynamicData(DEMO_FORM_ID, {
    fullName: "李四",
    department: "qa",
    email: "lisi@example.com",
    isFreshGraduate: "yes",
    expectedSalary: 26000,
    idCard: "unvalidated",
    workExperiences: [],
  }).catch(() => {});
  const secondFile = initFile({ originalName: "b.pdf", mimeType: "application/pdf", sizeBytes: 1 });
  uploadFileContent(secondFile.fileId, Buffer.from("b"), "application/pdf");
  completeFile(secondFile.fileId);
  await submitDynamicData(DEMO_FORM_ID, {
    fullName: "王五",
    department: "rd",
    email: "wangwu@example.com",
    isFreshGraduate: "yes",
    expectedSalary: 50000,
    idCard: secondFile.fileId,
    workExperiences: [],
  });

  const result = require("../server-core").getSubmissions(DEMO_FORM_ID, {
    page: 1,
    pageSize: 1,
    filters: [{ field: "expectedSalary", operator: "gt", value: "30000" }],
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].data.fullName, "王五");
});

test("schema validation rejects rule cycles and duplicate keys", () => {
  const errors = validateSchema({
    formId: "demo",
    version: 2,
    status: "Published",
    fields: [
      { key: "a", label: "A", type: "input", visibleWhen: { field: "b", equals: 1 } },
      { key: "a", label: "A2", type: "input", visibleWhen: { field: "a", equals: 1 } },
      { key: "b", label: "B", type: "input", visibleWhen: { field: "a", equals: 1 } },
    ],
  });
  assert.ok(errors.some((error) => error.includes("duplicate field key")));
  assert.ok(errors.some((error) => error.includes("rule cycle")));
});

test("local persistence reloads state from disk", () => {
  const stateFile = path.join(__dirname, "tmp-state.json");
  resetState({ clearPersistence: true });
  configurePersistence({ enabled: true, file: stateFile, load: false });
  resetState({ persist: true });
  const file = initFile({ originalName: "persisted.pdf", mimeType: "application/pdf", sizeBytes: 1 });
  uploadFileContent(file.fileId, Buffer.from("p"), "application/pdf");
  completeFile(file.fileId);
  configurePersistence({ enabled: true, file: stateFile, load: true });
  assert.equal(getStateSnapshot().files.length, 1);
  resetState({ clearPersistence: true });
  configurePersistence({ enabled: false, load: false });
});

test("schema publish requires a matching ETag and creates a newer version", async (t) => {
  resetState();
  const server = createServer({ rootDir: path.join(__dirname, ".."), persist: false });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const current = await requestJson(port, "GET", `/api/v1/forms/${DEMO_FORM_ID}/schema`, undefined, "demo-viewer-token");
  const schema = JSON.parse(JSON.stringify(current.body.schema));
  schema.version = 5;
  schema.status = "Published";

  const stale = await requestJson(port, "POST", `/api/v1/forms/${DEMO_FORM_ID}/schema/publish`, { schema }, "demo-admin-token", { "If-Match": '"stale"' });
  assert.equal(stale.statusCode, 412);

  const published = await requestJson(port, "POST", `/api/v1/forms/${DEMO_FORM_ID}/schema/publish`, { schema }, "demo-admin-token", { "If-Match": current.body.etag });
  assert.equal(published.statusCode, 200);
  assert.equal(published.body.schema.version, 5);
  assert.equal(published.body.etag, getSchemaEtag(schema));
});

test("index.html defaults to the latest version and no longer hardcodes idCard visibility", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /let activeVersion = schemas\.length;/);
  assert.doesNotMatch(html, /if \(field\.key === "idCard"\) return activeVersion === 2;/);
  assert.doesNotMatch(html, /const apiToken = "demo-hr-token"/);
});

test("production preflight rejects missing or weak credentials and accepts valid credentials", () => {
  const preflightPath = path.join(__dirname, "..", "preflight.js");
  const nodePath = process.execPath;
  const caDir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-preflight-"));
  const caFile = path.join(caDir, "mysql-ca.pem");
  fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\ntest-only\n-----END CERTIFICATE-----\n");
  const baseEnv = { ...process.env, NODE_ENV: "production", HR_DATA_FILE: "/tmp/hr-state.json", HR_AUTH_REQUIRED: "true" };
  const mysqlEnv = {
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: "hr_forms",
    MYSQL_USER: "hr_app",
    MYSQL_PASSWORD: "preflight-test-password",
    MYSQL_SSL_VERIFY: "true",
    MYSQL_SSL_CA: caFile,
  };
  try {
    const missing = childProcess.spawnSync(nodePath, [preflightPath], { env: { ...baseEnv, HR_ADMIN_TOKEN: "", HR_HR_TOKEN: "", HR_VIEWER_TOKEN: "" }, encoding: "utf8" });
    assert.notEqual(missing.status, 0, "preflight must fail when tokens are missing");
    const valid = childProcess.spawnSync(nodePath, [preflightPath], {
      env: {
        ...baseEnv,
        ...mysqlEnv,
        HR_ADMIN_TOKEN: "admin-token-abcdefghijklmnopqrstuvwxyz-123456",
        HR_HR_TOKEN: "hr-token-abcdefghijklmnopqrstuvwxyz-123456",
        HR_VIEWER_TOKEN: "viewer-token-abcdefghijklmnopqrstuvwxyz-123456",
      },
      encoding: "utf8",
    });
    assert.equal(valid.status, 0, `preflight should pass with valid credentials: ${valid.stderr || valid.stdout}`);
  } finally {
    fs.rmSync(caDir, { recursive: true, force: true });
  }
});
