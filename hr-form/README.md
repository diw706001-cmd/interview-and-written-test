# HR Dynamic Form Engine

这是「全栈开发工程师：HR 动态表单与通用接口引擎」笔试题的完整交付包。

## 交付内容

- `answers.md`：完整题解文档。
- `index.html`：可交互的动态表单演示页。
- `schema-example.json`：技术岗入职表 Schema 示例。
- `api-design.md`：通用 API 设计说明。
- `data-model.md`：数据库表结构设计。
- `server-core.ts`：后端核心逻辑示意。
- `server-core.js`：可运行的后端核心与 API 服务。
- `server.js`：本地启动入口。
- `package.json`：测试与启动脚本。
- `scripts/run-node.cmd`：Windows 下的 Node 启动兼容脚本。
- `scripts/mysql-init.js`：MySQL 数据库和表初始化脚本。
- `deployment.md`：生产部署和外部资源清单。
- `.env.example`：环境变量示例。

## 如何查看

直接用浏览器打开 `index.html`。

如果要跑本地服务：

```bash
pnpm test
pnpm start
```

初始化 MySQL：

```bash
pnpm db:init
```

执行前通过环境变量设置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD` 和 `MYSQL_SSL_VERIFY`。

默认服务地址是 `http://127.0.0.1:3000`。服务默认启用本地 JSON 持久化，数据写入 `data/state.json`；也可以通过 `HR_DATA_FILE` 指定其它文件。

本地演示 Token：

- `demo-admin-token`：Schema 发布、调试状态、全部 HR 能力。
- `demo-hr-token`：提交、上传、审计。
- `demo-viewer-token`：读取 Schema 和查询提交。

页面不会把 Token 写入源码。需要在浏览器控制台执行 `localStorage.setItem("hr_demo_token", "demo-hr-token")` 后刷新页面；生产环境应由反向代理或 OIDC 登录态提供认证。

生产部署需要的外部信息见 `deployment.md`；仅做本地笔试演示无需提供账号或密钥。

演示页包含：

- Schema 版本切换
- 动态字段渲染
- 字段联动
- repeater 动态数组
- 前端校验
- 模拟提交结果
- 审计日志
- API 与版本策略说明

后端已经补齐：

- Bearer Token 基础认证与角色权限。
- Schema 发布时的 ETag 乐观锁。
- Schema 字段重复、未知规则引用、循环依赖校验。
- `filter[field][operator]` 动态查询、分页、排序。
- 文件初始化/完成流程、MIME/大小校验和安全扫描状态。
- 本地二进制上传、SHA-256 校验和落盘。
- 审计日志敏感字段脱敏。

## 技术选型建议

正式工程可以采用：

- 前端：React + TypeScript + React Hook Form
- 后端：Node.js + Fastify/NestJS
- 数据库：PostgreSQL JSONB
- 文件存储：S3 / OSS / MinIO
- 鉴权：JWT + RBAC

## 核心设计原则

1. Schema 驱动 UI 与校验。
2. 已发布 Schema 不可变更，只能发布新版本。
3. Submission 永久绑定提交时的 Schema Version。
4. 文件二进制不进入 Submission JSON。
5. 并发修改使用 optimistic locking / ETag。
6. 审计日志 append-only。
