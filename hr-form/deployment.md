# 部署与外部接入清单

## 当前已完成

- 本地 Node.js API 服务。
- MySQL 8.0/8.4 初始化脚本。
- Docker 镜像与 Docker Compose 编排。
- Nginx 反向代理入口。
- 生产启动前环境变量校验。
- SIGTERM/SIGINT 优雅停机。
- 本地 JSON 持久化。
- Schema 版本与 ETag 乐观锁。
- 动态字段查询、分页、排序。
- 本地二进制上传、文件名安全处理、MIME/大小/hash 校验。
- 演示用角色权限。
- 审计日志和敏感字段脱敏。
- 13 条自动化回归测试。

## 生产接入时需要提供

在没有服务器、域名、数据库和对象存储凭据前，我不能替你执行远程上线；当前已经完成的是可部署包和上线前校验。

### 1. 云服务器部署

- SSH 公钥，或可登录的部署账号。
- 目标服务器 IP、端口和操作系统。
- 域名及 DNS 管理权限。
- HTTPS 证书，或允许使用 Let's Encrypt。

部署命令：

```bash
cp .env.production.example .env.production
# 修改 .env.production 中的三个 Token
docker compose up -d --build
docker compose ps
curl http://127.0.0.1/health
```

数据库初始化：

```bash
pnpm db:init
```

当前工作环境对外部 MySQL 的后续 TCP 连接被系统策略拒绝，因此本次未实际执行建库；初始化脚本已放入 `scripts/mysql-init.js`，应在能访问数据库的部署机上执行。

上线前必须把 `deploy/nginx.conf` 的 `server_name _;` 换成真实域名，并配置 HTTPS 证书。

### 2. 对象存储

任选一种：

- AWS：`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、Region、Bucket。
- 阿里云 OSS：AccessKey、Region、Bucket。
- MinIO：Endpoint、Access Key、Secret Key、Bucket。

### 3. 数据库

- PostgreSQL 连接串。
- 数据库名、用户、密码。
- 是否允许执行建表和索引迁移。

### 4. 身份认证

- JWT/OIDC issuer。
- Client ID / Client Secret。
- 用户角色映射规则。

### 5. 文件安全

- 病毒扫描服务地址，或 ClamAV 部署方式。
- 文件保留周期。
- 敏感文件访问角色。

### 6. 外部业务 Hook

如果要接入真实业务，还需要：

- 钉钉/企业微信机器人配置。
- PDF 合同模板。
- 第三方考勤系统 API 地址和鉴权方式。

## 目前不需要提供

如果只是继续做本地演示、笔试提交或本机测试，现在不需要你提供任何账号、密钥或服务器信息。
