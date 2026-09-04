const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const {
  detectRuleCycles,
  normalizeAliases,
  redactSensitive,
  validateSchema,
  validateSubmission,
} = require("./server-core");

function parseJson(value) {
  if (value === null || value === undefined) return value;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function etagForSchema(schema) {
  return `"${crypto.createHash("sha256").update(JSON.stringify({
    formId: schema.formId,
    version: schema.version,
    status: schema.status,
    fields: schema.fields,
    aliases: schema.aliases || {},
  })).digest("hex").slice(0, 16)}"`;
}

function jsonPath(field) {
  const segments = String(field).split(".");
  if (!segments.every((segment) => /^[A-Za-z0-9_]+$/.test(segment))) {
    throw new Error(`invalid filter field: ${field}`);
  }
  return `$.${segments.map((segment) => `"${segment}"`).join(".")}`;
}

function createMySqlStore(config = {}, dependencies = {}) {
  const mysqlClient = dependencies.mysql || mysql;
  const fileSystem = dependencies.fs || fs;
  const pool = mysqlClient.createPool({
    host: config.host,
    port: Number(config.port || 3306),
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: Number(config.connectionLimit || 10),
    queueLimit: 0,
    connectTimeout: 10000,
    ssl: {
      ca: config.sslCa ? fileSystem.readFileSync(config.sslCa) : undefined,
      rejectUnauthorized: config.sslVerify !== false,
    },
  });
  const uploadRoot = config.uploadRoot || path.join(__dirname, "data", "uploads");

  async function ping() {
    const [rows] = await pool.query("SELECT 1 AS ok");
    return rows[0].ok === 1;
  }

  async function getLatestSchema(formId, publishedOnly = false) {
    const [rows] = await pool.execute(
      `SELECT form_id, version, status, schema_json, etag, parent_version, published_at, created_by
       FROM schema_versions
       WHERE form_id = ? ${publishedOnly ? "AND status = 'Published'" : ""}
       ORDER BY version DESC
       LIMIT 1`,
      [formId]
    );
    if (!rows.length) throw new Error(`No schema for formId=${formId}`);
    const row = rows[0];
    const schema = parseJson(row.schema_json);
    return {
      ...schema,
      formId: row.form_id,
      version: row.version,
      status: row.status,
      parentVersion: row.parent_version,
      publishedAt: row.published_at,
      createdBy: row.created_by,
      etag: row.etag,
    };
  }

  async function getLatestPublishedSchema(formId) {
    return getLatestSchema(formId, true);
  }

  async function saveSubmission(submission) {
    await pool.execute(
      `INSERT INTO submissions (id, form_id, schema_version, data, submitted_by)
       VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
      [
        submission.id,
        submission.formId,
        submission.schemaVersion,
        JSON.stringify(submission.data),
        submission.submittedBy || null,
      ]
    );
    return submission;
  }

  async function appendAuditLog(event) {
    const record = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      ...redactSensitive(event),
    };
    await pool.execute(
      `INSERT INTO audit_logs
        (id, actor_id, action, target_type, target_id, before_value, after_value, created_at)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
      [
        record.id,
        record.actorId || null,
        record.action,
        record.targetType,
        record.targetId,
        record.beforeValue === undefined ? null : JSON.stringify(record.beforeValue),
        record.afterValue === undefined ? null : JSON.stringify(record.afterValue),
        record.createdAt,
      ]
    );
    return record;
  }

  async function runHooks(eventName, context) {
    const id = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO hook_events (id, event_name, context) VALUES (?, ?, CAST(? AS JSON))`,
      [id, eventName, JSON.stringify(redactSensitive(context))]
    );
  }

  async function submitDynamicData(formId, payload, actor) {
    const schema = await getLatestPublishedSchema(formId);
    const errors = validateSubmission(schema, payload);
    if (errors.length) return { ok: false, errors };

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const submission = {
        id: crypto.randomUUID(),
        createdAt: new Date(),
        formId,
        schemaVersion: schema.version,
        submittedBy: actor?.id || null,
        data: normalizeAliases(schema, payload),
      };
      await connection.execute(
        `INSERT INTO submissions (id, form_id, schema_version, data, submitted_by)
         VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
        [submission.id, formId, schema.version, JSON.stringify(submission.data), submission.submittedBy]
      );
      const audit = {
        id: crypto.randomUUID(),
        actorId: actor?.id || null,
        action: "submission.created",
        targetType: "submission",
        targetId: submission.id,
        afterValue: submission,
      };
      const redacted = redactSensitive(audit);
      await connection.execute(
        `INSERT INTO audit_logs
          (id, actor_id, action, target_type, target_id, after_value)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [redacted.id, redacted.actorId, redacted.action, redacted.targetType, redacted.targetId, JSON.stringify(redacted.afterValue)]
      );
      await connection.execute(
        `INSERT INTO hook_events (id, event_name, context) VALUES (?, ?, CAST(? AS JSON))`,
        [crypto.randomUUID(), "afterSubmit", JSON.stringify(redactSensitive({ schema, submission }))]
      );
      await connection.commit();
      return { ok: true, submissionId: submission.id, submission };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getSubmissions(formId, query = {}) {
    const conditions = ["form_id = ?"];
    const params = [formId];
    for (const filter of query.filters || []) {
      const expression = `JSON_UNQUOTE(JSON_EXTRACT(data, ?))`;
      const path = jsonPath(filter.field);
      if (filter.operator === "contains") {
        conditions.push(`LOWER(${expression}) LIKE LOWER(?)`);
        params.push(path, `%${filter.value}%`);
      } else if (filter.operator === "in") {
        const values = String(filter.value).split(",").map((item) => item.trim()).filter(Boolean);
        if (values.length === 0) continue;
        conditions.push(`${expression} IN (${values.map(() => "?").join(", ")})`);
        params.push(path, ...values);
      } else if (["gt", "gte", "lt", "lte"].includes(filter.operator)) {
        const operator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.operator];
        conditions.push(`CAST(${expression} AS DECIMAL(30, 6)) ${operator} ?`);
        params.push(path, Number(filter.value));
      } else if (filter.operator === "neq") {
        conditions.push(`${expression} <> ?`);
        params.push(path, filter.value);
      } else {
        conditions.push(`${expression} = ?`);
        params.push(path, filter.value);
      }
    }
    if (query.schemaVersion) {
      conditions.push("schema_version = ?");
      params.push(query.schemaVersion);
    }

    const page = Math.max(Number(query.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize || 20), 1), 100);
    const offset = (page - 1) * pageSize;
    const where = conditions.join(" AND ");
    let orderBy = "created_at DESC";
    let rowParams = [...params, pageSize, offset];
    if (query.sort) {
      const direction = String(query.sort).startsWith("-") ? "DESC" : "ASC";
      const field = String(query.sort).replace(/^-/, "");
      orderBy = `JSON_UNQUOTE(JSON_EXTRACT(data, ?)) ${direction}, created_at DESC`;
      rowParams = [...params, jsonPath(field), pageSize, offset];
    }
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM submissions WHERE ${where}`, params);
    const [rows] = await pool.query(
      `SELECT id, form_id, schema_version, data, submitted_by, created_at
       FROM submissions WHERE ${where}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      rowParams
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        formId: row.form_id,
        schemaVersion: row.schema_version,
        data: parseJson(row.data),
        submittedBy: row.submitted_by,
        createdAt: row.created_at,
      })),
      total: Number(countRows[0].total),
      page,
      pageSize,
    };
  }

  async function publishSchema(schema, actor) {
    const errors = validateSchema(schema);
    if (errors.length) return { ok: false, errors, statusCode: 422 };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO schema_versions
          (form_id, version, status, schema_json, etag, parent_version, published_at, created_by)
         VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, CURRENT_TIMESTAMP(3), ?)`,
        [
          schema.formId,
          schema.version,
          schema.status,
          JSON.stringify(schema),
          etagForSchema(schema),
          schema.parentVersion || null,
          actor?.id || null,
        ]
      );
      await connection.execute(
        `INSERT INTO forms (form_id, title, created_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        [schema.formId, schema.title, actor?.id || null]
      );
      await connection.commit();
      await appendAuditLog({
        actorId: actor?.id || null,
        action: "schema.published",
        targetType: "schema",
        targetId: `${schema.formId}@v${schema.version}`,
        afterValue: schema,
      });
      return { ok: true, schema, etag: etagForSchema(schema) };
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") return { ok: false, statusCode: 409, message: "schema version already exists" };
      throw error;
    } finally {
      connection.release();
    }
  }

  async function initFile(file) {
    await pool.execute(
      `INSERT INTO files
        (file_id, original_name, mime_type, size_bytes, sha256, storage_key, scan_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [file.fileId, file.originalName, file.mimeType, file.sizeBytes, file.sha256, file.storageKey, file.createdBy || null]
    );
    await appendAuditLog({
      actorId: file.createdBy || null,
      action: "file.upload.initialized",
      targetType: "file",
      targetId: file.fileId,
      afterValue: file,
    });
    return file;
  }

  async function getFile(fileId) {
    const [rows] = await pool.execute("SELECT * FROM files WHERE file_id = ? LIMIT 1", [fileId]);
    if (!rows.length) return null;
    const row = rows[0];
    return {
      fileId: row.file_id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
      storageKey: row.storage_key,
      scanStatus: row.scan_status,
      contentStored: !!row.content_stored,
      localPath: row.local_path,
      createdBy: row.created_by,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  async function uploadFileContent(fileId, buffer, contentType, actor) {
    const file = await getFile(fileId);
    if (!file) return { ok: false, statusCode: 404, message: "file not found" };
    if (contentType && contentType !== file.mimeType) return { ok: false, statusCode: 415, message: "content type does not match init metadata" };
    if (buffer.length !== file.sizeBytes) return { ok: false, statusCode: 422, message: "uploaded size does not match init metadata" };
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    if (file.sha256 && digest !== file.sha256) return { ok: false, statusCode: 422, message: "sha256 mismatch" };
    const directory = path.join(uploadRoot, fileId);
    fileSystem.mkdirSync(directory, { recursive: true });
    const localPath = path.join(directory, file.originalName);
    fileSystem.writeFileSync(localPath, buffer);
    await pool.execute(
      `UPDATE files SET sha256 = ?, content_stored = TRUE, local_path = ?, scan_status = 'clean', completed_at = CURRENT_TIMESTAMP(3)
       WHERE file_id = ?`,
      [digest, localPath, fileId]
    );
    await appendAuditLog({ actorId: actor?.id || null, action: "file.upload.scanned", targetType: "file", targetId: fileId, afterValue: { ...file, sha256: digest, localPath, scanStatus: "clean" } });
    return { ok: true, file: redactSensitive({ ...file, sha256: digest, localPath, contentStored: true, scanStatus: "clean" }) };
  }

  async function completeFile(fileId, { sha256 } = {}, actor) {
    const file = await getFile(fileId);
    if (!file) return { ok: false, statusCode: 404, message: "file not found" };
    if (sha256 && file.sha256 && sha256 !== file.sha256) return { ok: false, statusCode: 422, message: "sha256 mismatch" };
    if (!file.contentStored || file.scanStatus !== "clean") return { ok: false, statusCode: 409, message: "file content must be stored and scanned before completion" };
    const completedFile = { ...file, completedAt: new Date() };
    await pool.execute("UPDATE files SET completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP(3)) WHERE file_id = ?", [fileId]);
    await appendAuditLog({ actorId: actor?.id || null, action: "file.upload.completed", targetType: "file", targetId: fileId, afterValue: completedFile });
    return { ok: true, file: redactSensitive(completedFile) };
  }

  async function getAuditLogs() {
    const [rows] = await pool.query(
      "SELECT id, actor_id, action, target_type, target_id, before_value, after_value, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 500"
    );
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      beforeValue: parseJson(row.before_value),
      afterValue: parseJson(row.after_value),
      createdAt: row.created_at,
    }));
  }

  async function close() {
    await pool.end();
  }

  return {
    close,
    completeFile,
    getAuditLogs,
    getFile,
    getLatestPublishedSchema,
    getLatestSchema: (formId) => getLatestSchema(formId, false),
    getSchemaEtag: etagForSchema,
    getSubmissions,
    initFile,
    ping,
    publishSchema,
    submitDynamicData,
    uploadFileContent,
  };
}

module.exports = { createMySqlStore, etagForSchema };
