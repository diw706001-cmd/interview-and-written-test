const path = require("path");
const { createServer } = require("./server-core");
const { createMySqlStore } = require("./mysql-store");

if (process.env.NODE_ENV === "production") {
  require("./preflight");
}

const port = Number(process.env.PORT || 3000);
let server = null;
let store = null;

async function start() {
  if (process.env.NODE_ENV === "production") {
    store = createMySqlStore({
      host: process.env.MYSQL_HOST,
      port: process.env.MYSQL_PORT,
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      sslVerify: process.env.MYSQL_SSL_VERIFY === "true",
      sslCa: process.env.MYSQL_SSL_CA,
      uploadRoot: process.env.HR_UPLOAD_ROOT || path.join(__dirname, "data", "uploads"),
      connectionLimit: process.env.MYSQL_CONNECTION_LIMIT,
    });
    await store.ping();
    console.log("MySQL connection verified");
  }

  server = createServer({
    rootDir: __dirname,
    persist: process.env.NODE_ENV !== "production",
    store,
    authRequired: process.env.HR_AUTH_REQUIRED !== "false",
    bodyLimit: Number(process.env.HR_MAX_BODY_BYTES || 1024 * 1024),
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  console.log(`HR dynamic form server listening on http://127.0.0.1:${port}`);
  console.log(`Serving ${path.join(__dirname, "index.html")}`);
}

start().catch(async (error) => {
  console.error(`Server startup failed: ${error.message}`);
  if (store) await store.close().catch(() => {});
  process.exit(1);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  const closeServer = server
    ? new Promise((resolve) => server.close(() => resolve()))
    : Promise.resolve();
  closeServer
    .then(() => (store ? store.close() : undefined))
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
