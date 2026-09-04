const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const schemaExample = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "schema-example.json"), "utf8")
);

function getConnectionConfig() {
  if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
    throw new Error("MYSQL_HOST, MYSQL_USER and MYSQL_PASSWORD are required");
  }
  if (process.env.MYSQL_SSL_VERIFY !== "true") {
    throw new Error("MYSQL_SSL_VERIFY must be true");
  }
  if (!process.env.MYSQL_SSL_CA) {
    throw new Error("MYSQL_SSL_CA is required when MYSQL_SSL_VERIFY=true");
  }
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    ssl: {
      ca: fs.readFileSync(process.env.MYSQL_SSL_CA),
      rejectUnauthorized: process.env.MYSQL_SSL_VERIFY === "true",
    },
    connectTimeout: 10000,
    multipleStatements: true,
  };
}

function schemaEtag(schema) {
  return `"${crypto.createHash("sha256").update(JSON.stringify({
    formId: schema.formId,
    version: schema.version,
    status: schema.status,
    fields: schema.fields,
    aliases: schema.aliases || {},
  })).digest("hex").slice(0, 16)}"`;
}

async function main() {
  const database = process.env.MYSQL_DATABASE;
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error("MYSQL_DATABASE must contain only letters, numbers and underscores");
  }

  const connection = await mysql.createConnection(getConnectionConfig());
  await connection.query(`
    CREATE DATABASE IF NOT EXISTS \`${database}\`
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_0900_ai_ci
  `);
  await connection.query(`USE \`${database}\``);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS forms (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      form_id VARCHAR(128) NOT NULL,
      title VARCHAR(255) NOT NULL,
      created_by VARCHAR(128) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_forms_form_id (form_id)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS schema_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      form_id VARCHAR(128) NOT NULL,
      version INT UNSIGNED NOT NULL,
      status VARCHAR(32) NOT NULL,
      schema_json JSON NOT NULL,
      etag VARCHAR(128) NOT NULL,
      parent_version INT UNSIGNED NULL,
      published_at TIMESTAMP(3) NULL,
      created_by VARCHAR(128) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_form_version (form_id, version),
      KEY idx_schema_form_status_version (form_id, status, version)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS submissions (
      id CHAR(36) NOT NULL,
      form_id VARCHAR(128) NOT NULL,
      schema_version INT UNSIGNED NOT NULL,
      data JSON NOT NULL,
      submitted_by VARCHAR(128) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_submissions_form_version (form_id, schema_version),
      KEY idx_submissions_created_at (created_at)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS files (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      file_id VARCHAR(128) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(128) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL,
      sha256 CHAR(64) NULL,
      storage_key VARCHAR(512) NOT NULL,
      scan_status VARCHAR(32) NOT NULL,
      content_stored BOOLEAN NOT NULL DEFAULT FALSE,
      local_path VARCHAR(1024) NULL,
      created_by VARCHAR(128) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      completed_at TIMESTAMP(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_files_file_id (file_id),
      KEY idx_files_scan_status (scan_status)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS audit_logs (
      id CHAR(36) NOT NULL,
      actor_id VARCHAR(128) NULL,
      action VARCHAR(128) NOT NULL,
      target_type VARCHAR(128) NOT NULL,
      target_id VARCHAR(255) NOT NULL,
      before_value JSON NULL,
      after_value JSON NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_audit_target (target_type, target_id),
      KEY idx_audit_created_at (created_at)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS hook_events (
      id CHAR(36) NOT NULL,
      event_name VARCHAR(128) NOT NULL,
      context JSON NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_hook_event_name (event_name)
    ) ENGINE=InnoDB;
  `);

  await connection.execute(
    `INSERT INTO forms (form_id, title, created_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title)`,
    [schemaExample.formId, schemaExample.title, "migration"]
  );

  const [existing] = await connection.execute(
    "SELECT id FROM schema_versions WHERE form_id = ? AND version = ? LIMIT 1",
    [schemaExample.formId, schemaExample.version]
  );

  if (existing.length === 0) {
    await connection.execute(
      `INSERT INTO schema_versions
        (form_id, version, status, schema_json, etag, parent_version, published_at, created_by)
       VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, CURRENT_TIMESTAMP(3), ?)`,
      [
        schemaExample.formId,
        schemaExample.version,
        schemaExample.status,
        JSON.stringify(schemaExample),
        schemaEtag(schemaExample),
        schemaExample.parentVersion || null,
        "migration",
      ]
    );
  }

  const [tables] = await connection.query("SHOW TABLES");
  console.log(JSON.stringify({
    database,
    tables: tables.map((row) => Object.values(row)[0]),
  }));
  await connection.end();
}

main().catch((error) => {
  console.error(JSON.stringify({
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState,
    message: error.message,
  }));
  process.exit(1);
});
