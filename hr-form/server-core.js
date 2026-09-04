const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEMO_FORM_ID = "tech_onboarding";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "state.json");
const SENSITIVE_KEYS = new Set(["idCard", "idCardNumber", "bankCard", "salary", "expectedSalary", "fileId", "storageKey"]);
const TOKENS = {
  [process.env.HR_ADMIN_TOKEN || "demo-admin-token"]: { id: "user_admin", name: "Demo Admin", roles: ["admin", "hr"] },
  [process.env.HR_HR_TOKEN || "demo-hr-token"]: { id: "user_hr", name: "Demo HR", roles: ["hr"] },
  [process.env.HR_VIEWER_TOKEN || "demo-viewer-token"]: { id: "user_viewer", name: "Demo Viewer", roles: ["viewer"] },
};

const initialState = {
  schemas: [
    {
      formId: DEMO_FORM_ID,
      title: "技术岗入职信息表",
      version: 3,
      status: "Published",
      parentVersion: null,
      aliases: {},
      fields: [
        { key: "employeeName", label: "姓名", type: "input", required: true, defaultValue: "", validation: { minLength: 2, maxLength: 50 } },
        { key: "department", label: "部门", type: "select", required: true, options: [{ label: "研发", value: "rd" }, { label: "测试", value: "qa" }] },
        { key: "isFreshGraduate", label: "是否应届生", type: "select", required: true, options: [{ label: "是", value: "yes" }, { label: "否", value: "no" }] },
        { key: "previousCompany", label: "前公司名称", type: "input", visibleWhen: { field: "isFreshGraduate", equals: "no" }, requiredWhen: { field: "isFreshGraduate", equals: "no" } },
        { key: "expectedSalary", label: "期望薪资", type: "number", required: true, validation: { min: 0, max: 100000 }, hintWhen: { field: "expectedSalary", operator: ">", value: 30000, message: "需要 HRBP 特别审批", placeholder: "超过 30000 时会自动提示特别审批" } },
      ],
    },
    {
      formId: DEMO_FORM_ID,
      title: "技术岗入职信息表",
      version: 4,
      status: "Published",
      parentVersion: 3,
      aliases: { employeeName: "fullName" },
      fields: [
        { key: "fullName", label: "姓名", type: "input", required: true, defaultValue: "", validation: { minLength: 2, maxLength: 50 } },
        { key: "department", label: "部门", type: "select", required: true, options: [{ label: "研发", value: "rd" }, { label: "测试", value: "qa" }, { label: "产品", value: "product" }, { label: "设计", value: "design" }] },
        { key: "email", label: "邮箱", type: "input", required: true, validation: { email: true } },
        { key: "isFreshGraduate", label: "是否应届生", type: "select", required: true, options: [{ label: "是", value: "yes" }, { label: "否", value: "no" }] },
        { key: "previousCompany", label: "前公司名称", type: "input", visibleWhen: { field: "isFreshGraduate", equals: "no" }, requiredWhen: { field: "isFreshGraduate", equals: "no" } },
        { key: "expectedSalary", label: "期望薪资", type: "number", required: true, validation: { min: 0, max: 100000 }, hintWhen: { field: "expectedSalary", operator: ">", value: 30000, message: "需要 HRBP 特别审批", placeholder: "超过 30000 时会自动提示特别审批" } },
        { key: "idCard", label: "身份证附件", type: "upload", required: true, accept: ["image/png", "image/jpeg", "application/pdf"], maxSizeMB: 10 },
        {
          key: "workExperiences",
          label: "工作履历",
          type: "repeater",
          itemFields: [
            { key: "company", label: "公司", type: "input", required: true },
            { key: "position", label: "岗位", type: "input", required: true },
            { key: "years", label: "年限", type: "input", required: true, validation: { min: 0, max: 50 } },
          ],
        },
      ],
    },
  ],
  submissions: [],
  auditLogs: [
    { time: "2026-08-20 10:12", actor: "HR Admin", action: "发布 schema v4", detail: "employeeName -> fullName，新增 department" },
    { time: "2026-08-20 10:31", actor: "System", action: "触发 hook", detail: "提交后同步候选人到第三方考勤系统" },
    { time: "2026-08-20 11:02", actor: "HRBP", action: "修改 salary", detail: "30000 -> 35000" },
  ],
  hookEvents: [],
  files: [],
};

let state = clone(initialState);
let persistenceFile = process.env.HR_DATA_FILE || DEFAULT_DATA_FILE;
let persistenceEnabled = false;
let maxBodyBytes = DEFAULT_MAX_BODY_BYTES;

function clone(value) {
  return global.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function configurePersistence(options = {}) {
  persistenceEnabled = options.enabled ?? true;
  persistenceFile = options.file || persistenceFile;
  if (options.load !== false && persistenceEnabled) loadState();
  return persistenceFile;
}

function loadState() {
  try {
    if (!fs.existsSync(persistenceFile)) return false;
    const persisted = JSON.parse(fs.readFileSync(persistenceFile, "utf8"));
    state = { ...clone(initialState), ...persisted };
    return true;
  } catch {
    state = clone(initialState);
    return false;
  }
}

function persistState() {
  if (!persistenceEnabled) return;
  const directory = path.dirname(persistenceFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = `${persistenceFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporaryFile, persistenceFile);
}

function resetState(options = {}) {
  state = clone(initialState);
  if (options.persist === true) persistState();
  if (options.clearPersistence === true && fs.existsSync(persistenceFile)) fs.rmSync(persistenceFile);
}

function computeETag(schema) {
  return `"${crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex").slice(0, 16)}"`;
}

function getAllSchemas(formId) {
  return state.schemas.filter((schema) => schema.formId === formId).sort((a, b) => a.version - b.version);
}

function getLatestPublishedSchema(formId) {
  const candidates = getAllSchemas(formId).filter((schema) => schema.status === "Published");
  if (candidates.length === 0) throw new Error(`No published schema for formId=${formId}`);
  return clone(candidates[candidates.length - 1]);
}

function getSchemaEtag(schema) {
  return computeETag({
    formId: schema.formId,
    version: schema.version,
    status: schema.status,
    fields: schema.fields,
    aliases: schema.aliases || {},
  });
}

function matchCondition(condition, data) {
  if (!condition) return false;
  const current = data[condition.field];
  if (Object.prototype.hasOwnProperty.call(condition, "equals")) return current === condition.equals;
  if (Object.prototype.hasOwnProperty.call(condition, "notEquals")) return current !== condition.notEquals;
  const left = Number(current);
  const right = Number(condition.value);
  if (condition.operator === ">") return left > right;
  if (condition.operator === ">=") return left >= right;
  if (condition.operator === "<") return left < right;
  if (condition.operator === "<=") return left <= right;
  if (condition.operator === "==") return current === condition.value;
  if (condition.operator === "!=") return current !== condition.value;
  return false;
}

function isVisible(field, data) {
  return !field.visibleWhen || matchCondition(field.visibleWhen, data);
}

function isRequired(field, data) {
  if (field.required) return true;
  return !!(field.requiredWhen && matchCondition(field.requiredWhen, data));
}

function normalizeAliases(schema, data) {
  const normalized = { ...data };
  for (const [oldKey, newKey] of Object.entries(schema.aliases || {})) {
    if (normalized[newKey] === undefined && normalized[oldKey] !== undefined) normalized[newKey] = normalized[oldKey];
  }
  return normalized;
}

function validateField(field, value, data) {
  if (!isVisible(field, data)) return null;
  if (isRequired(field, data) && (value === undefined || value === null || value === "")) {
    return { field: field.key, message: `${field.label}不能为空` };
  }
  if (value === undefined || value === null || value === "") return null;

  if (field.validation?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
    return { field: field.key, message: `${field.label}格式不正确` };
  }
  if (field.validation?.regex && !new RegExp(field.validation.regex).test(String(value))) {
    return { field: field.key, message: `${field.label}格式不匹配` };
  }
  if (field.validation?.minLength !== undefined && String(value).length < field.validation.minLength) {
    return { field: field.key, message: `${field.label}长度不能小于${field.validation.minLength}` };
  }
  if (field.validation?.maxLength !== undefined && String(value).length > field.validation.maxLength) {
    return { field: field.key, message: `${field.label}长度不能大于${field.validation.maxLength}` };
  }
  if (field.validation?.min !== undefined && Number(value) < field.validation.min) {
    return { field: field.key, message: `${field.label}不能小于${field.validation.min}` };
  }
  if (field.validation?.max !== undefined && Number(value) > field.validation.max) {
    return { field: field.key, message: `${field.label}不能大于${field.validation.max}` };
  }
  return null;
}

function findFile(fileId) {
  return state.files.find((file) => file.fileId === fileId);
}

function validateUpload(field, value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { field: field.key, message: `${field.label}必须引用 fileId` };
  const file = findFile(value);
  if (!file) return { field: field.key, message: `${field.label}引用的文件不存在` };
  if (file.scanStatus !== "clean") return { field: field.key, message: `${field.label}尚未通过安全扫描` };
  return null;
}

function validateSubmission(schema, payload) {
  const data = normalizeAliases(schema, payload);
  const errors = [];

  for (const field of schema.fields) {
    if (field.type === "repeater") {
      const rows = data[field.key];
      if (rows === undefined || rows === null) continue;
      if (!Array.isArray(rows)) {
        errors.push({ field: field.key, message: `${field.label}必须是数组` });
        continue;
      }
      rows.forEach((row, index) => {
        for (const itemField of field.itemFields || []) {
          const error = validateField(itemField, row?.[itemField.key], row || {});
          if (error) errors.push({ field: `${field.key}.${index}.${error.field}`, message: error.message });
        }
      });
      continue;
    }

    const error = field.type === "upload"
      ? validateUpload(field, data[field.key]) || validateField(field, data[field.key], data)
      : validateField(field, data[field.key], data);
    if (error) errors.push(error);
  }

  return errors;
}

function validateSchema(schema) {
  const errors = [];
  if (!schema || typeof schema !== "object") return ["schema must be an object"];
  if (!schema.formId || typeof schema.formId !== "string") errors.push("formId is required");
  if (!Number.isInteger(schema.version) || schema.version < 1) errors.push("version must be a positive integer");
  if (schema.status !== "Published") errors.push("only Published schemas can be published");
  if (!Array.isArray(schema.fields) || schema.fields.length === 0) errors.push("fields must be a non-empty array");

  const allKeys = new Set((schema.fields || []).map((field) => field.key));
  const keys = new Set();
  for (const field of schema.fields || []) {
    if (!field.key || typeof field.key !== "string") errors.push("every field needs a string key");
    if (keys.has(field.key)) errors.push(`duplicate field key: ${field.key}`);
    keys.add(field.key);
    if (!["input", "select", "upload", "repeater"].includes(field.type)) errors.push(`unsupported field type: ${field.type}`);
    for (const condition of [field.visibleWhen, field.requiredWhen]) {
      if (condition?.field && !allKeys.has(condition.field)) errors.push(`rule references unknown field: ${condition.field}`);
    }
  }
  errors.push(...detectRuleCycles(schema).map((cycle) => `rule cycle: ${cycle}`));
  return errors;
}

function detectRuleCycles(schema) {
  const graph = new Map();
  for (const field of schema.fields || []) {
    if (!graph.has(field.key)) graph.set(field.key, new Set());
    for (const condition of [field.visibleWhen, field.requiredWhen]) {
      if (condition?.field) {
        if (!graph.has(condition.field)) graph.set(condition.field, new Set());
        graph.get(condition.field).add(field.key);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function dfs(node, pathNodes) {
    if (visiting.has(node)) {
      cycles.push([...pathNodes, node].join(" -> "));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of graph.get(node) || []) dfs(next, [...pathNodes, node]);
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) dfs(node, []);
  return cycles;
}

function redactSensitive(value, key = "") {
  if (SENSITIVE_KEYS.has(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactSensitive(childValue, childKey)]));
  }
  return value;
}

function appendAuditLog(event) {
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...redactSensitive(event) };
  state.auditLogs.unshift(record);
  persistState();
  return record;
}

function saveSubmission(submission) {
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...submission };
  state.submissions.unshift(record);
  persistState();
  return record;
}

function runHooks(eventName, context) {
  state.hookEvents.push({ id: crypto.randomUUID(), eventName, createdAt: new Date().toISOString(), context: redactSensitive(context) });
  persistState();
}

async function submitDynamicData(formId, payload, actor = Object.values(TOKENS).find((user) => user.roles.includes("hr"))) {
  const schema = getLatestPublishedSchema(formId);
  const errors = validateSubmission(schema, payload);
  if (errors.length > 0) return { ok: false, errors };

  const submission = saveSubmission({
    formId,
    schemaVersion: schema.version,
    submittedBy: actor?.id || null,
    data: normalizeAliases(schema, payload),
  });
  appendAuditLog({
    actorId: actor?.id || null,
    action: "submission.created",
    targetType: "submission",
    targetId: submission.id,
    afterValue: submission,
  });
  runHooks("afterSubmit", { schema, submission });
  return { ok: true, submissionId: submission.id, submission };
}

function getPath(value, pathExpression) {
  return pathExpression.split(".").reduce((current, key) => current?.[key], value);
}

function parseFilters(searchParams) {
  const filters = [];
  for (const [key, value] of searchParams.entries()) {
    const match = key.match(/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/);
    if (match) filters.push({ field: match[1], operator: match[2] || "eq", value });
  }
  return filters;
}

function compareFilter(actual, operator, expected) {
  if (operator === "contains") return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
  if (operator === "in") return String(expected).split(",").map((item) => item.trim()).includes(String(actual));
  if (["gt", "gte", "lt", "lte"].includes(operator)) {
    const left = Number(actual);
    const right = Number(expected);
    if (operator === "gt") return left > right;
    if (operator === "gte") return left >= right;
    if (operator === "lt") return left < right;
    return left <= right;
  }
  if (operator === "neq") return String(actual) !== String(expected);
  return String(actual ?? "") === String(expected);
}

function getSubmissions(formId, query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || 20), 1), 100);
  let items = state.submissions.filter((item) => item.formId === formId);
  const filters = query.filters || [];
  items = items.filter((item) => filters.every((filter) => compareFilter(getPath(item.data, filter.field), filter.operator, filter.value)));
  if (query.schemaVersion) items = items.filter((item) => String(item.schemaVersion) === String(query.schemaVersion));
  if (query.sort) {
    const direction = query.sort.startsWith("-") ? -1 : 1;
    const field = query.sort.replace(/^-/, "");
    items.sort((a, b) => String(getPath(a.data, field) ?? "").localeCompare(String(getPath(b.data, field) ?? "")) * direction);
  }
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

function createFileRecord({ originalName, mimeType, sizeBytes, sha256, actor }) {
  if (!originalName || !mimeType || !Number.isFinite(Number(sizeBytes))) {
    return { ok: false, statusCode: 400, message: "originalName, mimeType and sizeBytes are required" };
  }
  const size = Number(sizeBytes);
  const allowed = ["image/png", "image/jpeg", "application/pdf"];
  if (!allowed.includes(mimeType)) return { ok: false, statusCode: 400, message: "unsupported MIME type" };
  if (size <= 0 || size > 10 * 1024 * 1024) return { ok: false, statusCode: 400, message: "file size must be between 1 byte and 10MB" };

  const safeName = path.basename(String(originalName));
  const file = {
    fileId: `file_${crypto.randomBytes(6).toString("hex")}`,
    originalName: safeName,
    mimeType,
    sizeBytes: size,
    sha256: sha256 || null,
    storageKey: `hr/uploads/${crypto.randomUUID()}/${safeName}`,
    scanStatus: "pending",
    contentStored: false,
    createdBy: actor?.id || null,
    createdAt: new Date().toISOString(),
  };
  return { ok: true, file };
}

function initFile({ originalName, mimeType, sizeBytes, sha256, actor }) {
  const result = createFileRecord({ originalName, mimeType, sizeBytes, sha256, actor });
  if (!result.ok) return result;
  const file = result.file;
  state.files.push(file);
  persistState();
  appendAuditLog({ actorId: actor?.id || null, action: "file.upload.initialized", targetType: "file", targetId: file.fileId, afterValue: file });
  return { ok: true, fileId: file.fileId, uploadUrl: `/api/v1/files/${file.fileId}/content`, expiresIn: 600, file };
}

function uploadFileContent(fileId, buffer, contentType, actor) {
  const file = findFile(fileId);
  if (!file) return { ok: false, statusCode: 404, message: "file not found" };
  if (!Buffer.isBuffer(buffer)) return { ok: false, statusCode: 400, message: "binary content is required" };
  if (contentType && contentType !== file.mimeType) return { ok: false, statusCode: 415, message: "content type does not match init metadata" };
  if (buffer.length !== file.sizeBytes) return { ok: false, statusCode: 422, message: "uploaded size does not match init metadata" };

  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  if (file.sha256 && digest !== file.sha256) return { ok: false, statusCode: 422, message: "sha256 mismatch" };

  const uploadDir = path.join(path.dirname(persistenceFile), "uploads", fileId);
  fs.mkdirSync(uploadDir, { recursive: true });
  const storedPath = path.join(uploadDir, file.originalName);
  fs.writeFileSync(storedPath, buffer);
  file.contentStored = true;
  file.sha256 = digest;
  file.localPath = storedPath;
  file.scanStatus = "clean";
  file.completedAt = new Date().toISOString();
  persistState();
  appendAuditLog({ actorId: actor?.id || null, action: "file.upload.scanned", targetType: "file", targetId: fileId, afterValue: file });
  return { ok: true, file: redactSensitive(file) };
}

function completeFile(fileId, { sha256 } = {}, actor) {
  const file = findFile(fileId);
  if (!file) return { ok: false, statusCode: 404, message: "file not found" };
  if (sha256 && file.sha256 && sha256 !== file.sha256) return { ok: false, statusCode: 422, message: "sha256 mismatch" };
  if (!file.contentStored) return { ok: false, statusCode: 409, message: "upload content before completing the file" };
  file.scanStatus = "clean";
  file.completedAt = new Date().toISOString();
  persistState();
  appendAuditLog({ actorId: actor?.id || null, action: "file.upload.completed", targetType: "file", targetId: fileId, afterValue: file });
  return { ok: true, file };
}

function getStateSnapshot() {
  return clone(state);
}

function getUserFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return TOKENS[token] || null;
}

function requireRole(req, res, role, authRequired) {
  const user = getUserFromRequest(req);
  if (!authRequired) return user || Object.values(TOKENS).find((candidate) => candidate.roles.includes("admin"));
  if (!user) {
    sendJson(res, 401, { ok: false, message: "Authentication required" });
    return null;
  }
  if (role && !user.roles.includes(role)) {
    sendJson(res, 403, { ok: false, message: `Role required: ${role}` });
    return null;
  }
  return user;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(Object.assign(new Error("request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

function createRequestHandler({ rootDir, authRequired = true, store = null } = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
        return sendText(res, 200, html, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/ready") {
        if (store) await store.ping();
        return sendJson(res, 200, { ok: true });
      }
      if (parts[0] !== "api" || parts[1] !== "v1") return sendJson(res, 404, { ok: false, message: "Not Found" });

      if (parts[2] === "forms" && parts[4] === "schema" && req.method === "GET") {
        const user = requireRole(req, res, "viewer", authRequired);
        if (!user) return;
        const schema = store
          ? await store.getLatestPublishedSchema(parts[3])
          : getLatestPublishedSchema(parts[3]);
        const etag = store?.getSchemaEtag ? store.getSchemaEtag(schema) : getSchemaEtag(schema);
        return sendJson(res, 200, { ok: true, schema, etag }, { ETag: etag });
      }

      if (parts[2] === "forms" && parts[4] === "schema" && parts[5] === "publish" && req.method === "POST") {
        const user = requireRole(req, res, "admin", authRequired);
        if (!user) return;
        const body = await parseJsonBody(req);
        const schema = body.schema;
        let existing = null;
        if (store) {
          try {
            existing = await store.getLatestSchema(parts[3]);
          } catch (error) {
            if (!String(error.message || "").startsWith("No schema")) throw error;
          }
        } else {
          existing = getAllSchemas(parts[3]).at(-1);
        }
        if (!schema || !schema.formId) return sendJson(res, 400, { ok: false, message: "schema is required" });
        const existingEtag = existing
          ? (store?.getSchemaEtag ? store.getSchemaEtag(existing) : getSchemaEtag(existing))
          : null;
        if (existing && req.headers["if-match"] !== existingEtag) {
          return sendJson(res, 412, { ok: false, message: "schema changed, refresh before publishing", currentEtag: existingEtag });
        }
        if (schema.formId !== parts[3]) return sendJson(res, 400, { ok: false, message: "formId does not match path" });
        if (existing && schema.version <= existing.version) return sendJson(res, 409, { ok: false, message: "version must be greater than current version" });
        const errors = validateSchema(schema);
        if (errors.length) return sendJson(res, 422, { ok: false, errors });
        if (store) {
          const result = await store.publishSchema(schema, user);
          return sendJson(res, result.statusCode || 200, result, result.etag ? { ETag: result.etag } : {});
        }
        state.schemas.push(clone(schema));
        persistState();
        appendAuditLog({ actorId: user.id, action: "schema.published", targetType: "schema", targetId: `${schema.formId}@v${schema.version}`, afterValue: schema });
        const etag = getSchemaEtag(schema);
        return sendJson(res, 200, { ok: true, schema, etag }, { ETag: etag });
      }

      if (parts[2] === "dynamic-data" && req.method === "POST") {
        const user = requireRole(req, res, "hr", authRequired);
        if (!user) return;
        const result = store
          ? await store.submitDynamicData(parts[3], await parseJsonBody(req), user)
          : await submitDynamicData(parts[3], await parseJsonBody(req), user);
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      if (parts[2] === "dynamic-data" && req.method === "GET") {
        const user = requireRole(req, res, "viewer", authRequired);
        if (!user) return;
        const query = {
          page: url.searchParams.get("page"),
          pageSize: url.searchParams.get("pageSize"),
          schemaVersion: url.searchParams.get("schemaVersion"),
          sort: url.searchParams.get("sort"),
          filters: parseFilters(url.searchParams),
        };
        const result = store
          ? await store.getSubmissions(parts[3], query)
          : getSubmissions(parts[3], query);
        return sendJson(res, 200, { ok: true, ...result });
      }

      if (parts[2] === "files" && parts.length === 4 && parts[3] === "init" && req.method === "POST") {
        const user = requireRole(req, res, "hr", authRequired);
        if (!user) return;
        const body = await parseJsonBody(req);
        let result;
        if (store) {
          const prepared = createFileRecord({ ...body, actor: user });
          if (!prepared.ok) return sendJson(res, prepared.statusCode || 400, prepared);
          const file = await store.initFile(prepared.file);
          result = { ok: true, fileId: file.fileId, uploadUrl: `/api/v1/files/${file.fileId}/content`, expiresIn: 600, file };
        } else {
          result = initFile({ ...body, actor: user });
        }
        return sendJson(res, result.statusCode || 200, result);
      }

      if (parts[2] === "files" && parts.length === 5 && parts[4] === "content" && req.method === "PUT") {
        const user = requireRole(req, res, "hr", authRequired);
        if (!user) return;
        const buffer = await parseRawBody(req);
        const result = store
          ? await store.uploadFileContent(parts[3], buffer, req.headers["content-type"], user)
          : uploadFileContent(parts[3], buffer, req.headers["content-type"], user);
        return sendJson(res, result.statusCode || 200, result);
      }

      if (parts[2] === "files" && parts.length === 4 && parts[3] !== "init" && req.method === "POST") {
        const user = requireRole(req, res, "hr", authRequired);
        if (!user) return;
        const result = store
          ? await store.completeFile(parts[3], await parseJsonBody(req), user)
          : completeFile(parts[3], await parseJsonBody(req), user);
        return sendJson(res, result.statusCode || 200, result);
      }

      if (parts[2] === "audit" && req.method === "GET") {
        const user = requireRole(req, res, "hr", authRequired);
        if (!user) return;
        const items = store ? await store.getAuditLogs() : state.auditLogs;
        return sendJson(res, 200, { ok: true, items });
      }

      if (parts[2] === "debug" && parts[3] === "state" && req.method === "GET") {
        const user = requireRole(req, res, "admin", authRequired);
        if (!user) return;
        if (store) return sendJson(res, 404, { ok: false, message: "debug state is unavailable with MySQL storage" });
        return sendJson(res, 200, { ok: true, state: getStateSnapshot() });
      }

      return sendJson(res, 404, { ok: false, message: "Not Found" });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, { ok: false, message: error.message });
    }
  };
}

function createServer({ rootDir = __dirname, persist = true, dataFile, authRequired = true, bodyLimit, store = null } = {}) {
  if (bodyLimit) maxBodyBytes = bodyLimit;
  configurePersistence({ enabled: persist && !store, file: dataFile, load: persist && !store });
  return http.createServer(createRequestHandler({ rootDir, authRequired, store }));
}

module.exports = {
  DEMO_FORM_ID,
  TOKENS,
  completeFile,
  configurePersistence,
  createRequestHandler,
  createServer,
  detectRuleCycles,
  getLatestPublishedSchema,
  getSchemaEtag,
  getStateSnapshot,
  getSubmissions,
  initFile,
  normalizeAliases,
  redactSensitive,
  resetState,
  submitDynamicData,
  uploadFileContent,
  validateSchema,
  validateSubmission,
};
