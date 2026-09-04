const crypto = require("crypto");
const fs = require("fs");

const required = ["HR_ADMIN_TOKEN", "HR_HR_TOKEN", "HR_VIEWER_TOKEN"];
const weakValues = new Set(["demo-admin-token", "demo-hr-token", "demo-viewer-token", "replace-me", "change-me"]);
const missing = required.filter((key) => !process.env[key]);
const weak = required.filter((key) => weakValues.has(process.env[key]));

if (missing.length || weak.length) {
  const details = [];
  if (missing.length) details.push(`missing: ${missing.join(", ")}`);
  if (weak.length) details.push(`weak/demo values: ${weak.join(", ")}`);
  console.error(`Production preflight failed: ${details.join("; ")}`);
  process.exit(1);
}

const tokens = required.map((key) => process.env[key]);
if (new Set(tokens).size !== tokens.length) {
  console.error("Production preflight failed: authentication tokens must be unique");
  process.exit(1);
}

if (tokens.some((token) => token.length < 32)) {
  console.error("Production preflight failed: authentication tokens must be at least 32 characters");
  process.exit(1);
}

if (process.env.HR_AUTH_REQUIRED === "false") {
  console.error("Production preflight failed: HR_AUTH_REQUIRED cannot be false");
  process.exit(1);
}

if (!process.env.HR_DATA_FILE) {
  console.error("Production preflight failed: HR_DATA_FILE is required");
  process.exit(1);
}

const mysqlRequired = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
const mysqlMissing = mysqlRequired.filter((key) => !process.env[key]);
if (mysqlMissing.length) {
  console.error(`Production preflight failed: missing: ${mysqlMissing.join(", ")}`);
  process.exit(1);
}

if (process.env.MYSQL_SSL_VERIFY !== "true") {
  console.error("Production preflight failed: MYSQL_SSL_VERIFY must be true");
  process.exit(1);
}

if (!process.env.MYSQL_SSL_CA) {
  console.error("Production preflight failed: MYSQL_SSL_CA is required when MYSQL_SSL_VERIFY=true");
  process.exit(1);
}

if (!fs.existsSync(process.env.MYSQL_SSL_CA)) {
  console.error("Production preflight failed: MYSQL_SSL_CA file does not exist");
  process.exit(1);
}

if (!/^[A-Za-z0-9_]+$/.test(process.env.MYSQL_DATABASE)) {
  console.error("Production preflight failed: MYSQL_DATABASE must contain only letters, numbers and underscores");
  process.exit(1);
}

console.log(`Production preflight OK (${crypto.createHash("sha256").update(tokens.join("|")).digest("hex").slice(0, 12)})`);
