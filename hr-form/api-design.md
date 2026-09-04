# 通用 API 设计

## 0. 认证

除静态页面和健康检查外，API 使用 Bearer Token：

```http
Authorization: Bearer demo-hr-token
```

生产环境应替换为 JWT/OIDC，并接入真实 RBAC。

## 1. 获取最新发布版 Schema

`GET /api/v1/forms/:formId/schema`

返回：

```json
{
  "formId": "tech_onboarding",
  "version": 4,
  "status": "Published",
  "schema": {}
}
```

响应同时包含 `ETag`，发布时必须带上当前版本的 `If-Match`。

## 2. 发布 Schema

`POST /api/v1/forms/:formId/schema/publish`

请求头：

```http
If-Match: "schema-v10"
```

用途：

- 防止并发覆盖。
- 发布时执行 Schema 合法性校验。
- 检查 rule engine 是否存在循环依赖。

## 3. 通用提交接口

`POST /api/v1/dynamic-data/:formId`

流程：

1. 读取最新 Published Schema。
2. 校验 payload。
3. 处理字段别名和默认值。
4. 写入 submission。
5. 写入 audit log。
6. 触发 afterSubmit hooks。

失败返回：

```json
{
  "ok": false,
  "errors": [
    {
      "field": "email",
      "message": "邮箱格式不正确"
    }
  ]
}
```

## 4. 通用查询接口

`GET /api/v1/dynamic-data/:formId?page=1&pageSize=20&filter[experience][gt]=3`

支持：

- 分页
- 排序
- 动态字段过滤
- schemaVersion 过滤
- 创建时间过滤

支持的动态操作符：`eq`、`neq`、`gt`、`gte`、`lt`、`lte`、`contains`、`in`。

## 5. 文件上传接口

`POST /api/v1/files/init`

返回预签名上传地址：

```json
{
  "fileId": "file_8f2c1a",
  "uploadUrl": "https://storage.example.com/upload/...",
  "expiresIn": 600
}
```

`PUT /api/v1/files/:fileId/content`

上传原始二进制，服务端校验：

- `Content-Type` 是否与初始化元数据一致。
- 实际字节数是否与 `sizeBytes` 一致。
- SHA-256 是否一致。
- 文件保存后才允许完成。

`POST /api/v1/files/:fileId/complete`

后端确认文件已保存并通过本地演示扫描后，允许 submission 引用该文件。

当前交付包将二进制写入本地 `data/uploads`，并使用本地演示扫描状态；接入 S3/OSS 时，将 `uploadUrl` 替换成真实预签名地址，并把 `scanStatus` 接到病毒扫描服务。
