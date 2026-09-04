# HR 动态表单与通用接口引擎 - 面试笔试答案

## 1. 题目理解

这道题本质是做一个「Schema 驱动的 HR 低代码平台」。
核心不是单一表单，而是四层能力：

1. 表单定义层：用 JSON Schema 描述字段、校验、联动、版本。
2. 渲染层：前端根据 Schema 自动生成表单并管理状态。
3. 数据层：通用提交、查询、过滤、校验、持久化。
4. 平台层：版本管理、并发控制、审计、插件扩展。

## 2. 推荐总体架构

- `Schema Service`：创建、发布、版本化管理表单定义。
- `Form Renderer`：读取 Schema，渲染 input/select/upload/repeater。
- `Rule Engine`：处理字段联动、显隐、必填、计算提示。
- `Submission Service`：统一接收提交、执行校验、写入存储。
- `File Service`：独立处理文件上传与安全校验。
- `Audit Service`：记录谁在什么时间改了什么。
- `Hook System`：通知、PDF、同步第三方考勤等扩展点。

## 3. Q0 Schema 数据结构设计

建议 Schema 至少包含：

- `formId`
- `title`
- `version`
- `status`
- `fields`
- `publishedAt`
- `aliases` / `migrations`
- `hooks`

字段建议支持：

- `key`
- `label`
- `type`: `input | select | upload | repeater`
- `required`
- `defaultValue`
- `validation`: `min` / `max` / `regex` / `email`
- `visibleWhen`
- `requiredWhen`
- `options`
- `itemFields`（repeater）

示例：

```json
{
  "formId": "tech_onboarding",
  "version": 4,
  "title": "技术岗入职信息表",
  "fields": [
    {
      "key": "fullName",
      "label": "姓名",
      "type": "input",
      "required": true,
      "validation": { "minLength": 2 }
    },
    {
      "key": "department",
      "label": "部门",
      "type": "select",
      "required": true,
      "options": ["研发", "测试", "产品", "设计"]
    }
  ]
}
```

## 4. Q1 前端动态渲染引擎

实现方式：

1. 读取 Schema。
2. 遍历 `fields`，按 `type` 渲染控件。
3. 用统一 `formState` 管理值、错误、dirty/loading。
4. 提交前执行前端规则校验。
5. 支持重复项、嵌套对象、文件选择、错误提示。

关键点：

- `repeater` 用数组表示。
- `visibleWhen` 控制显隐，隐藏字段不参与必填。
- `requiredWhen` 让规则和显示解耦。
- `field error` 与 `form error` 分层展示。
- `server validation error` 要能回填到对应字段。

## 5. Q2 Schema 生命周期与版本管理

原则：

- 已发布 Schema 不直接修改。
- 每次变更生成新版本。
- 历史 Submission 固定绑定原版本。
- 新提交永远使用最新发布版。

建议做法：

- Schema 表保存 `version`、`status`、`publishedAt`、`parentVersion`。
- Submission 表保存 `schemaVersion` 快照。
- 字段重命名用 `aliases` 做兼容。
- 删除字段保留历史，但新版本不再渲染。

## 6. 场景二 通用数据 API

接口建议：

- `POST /api/v1/dynamic-data/:formId`
- `GET /api/v1/dynamic-data/:formId`
- `GET /api/v1/forms/:formId/schema`
- `POST /api/v1/forms/:formId/schema/publish`
- `POST /api/v1/files/init`
- `POST /api/v1/files/:fileId/complete`

提交流程：

1. 根据 `formId` 找到最新发布版 Schema。
2. 解析 payload。
3. 做 Schema 校验。
4. 文件只存引用，不把二进制塞进 Submission JSON。
5. 落库并记录审计日志。

查询流程：

- 支持分页、排序、动态字段过滤。
- 过滤条件从 JSON 查询参数或 DSL 传入。
- 对高频字段建立索引，对 JSON 字段做表达式索引或物化列。

## 7. Q2 字段联动与规则引擎

建议规则模型：

- `visibleWhen`
- `requiredWhen`
- `disabledWhen`
- `hintWhen`
- `computedWhen`

执行策略：

- 构建依赖图。
- 使用拓扑排序或分层计算。
- 检测循环依赖。
- 一旦发现环，拒绝发布或降级提示。

题目里的示例可以这样处理：

- 选择“是”时显示 `前公司名称`，并取消必填。
- `期望薪资 > 30000` 时显示 HRBP 审批提示。

## 8. Q3 文件上传安全

不要把大文件 Binary 直接写进 Submission JSON。

推荐方案：

- 前端先向文件服务申请 `uploadId`。
- 文件上传到对象存储。
- 后端只保存 `fileId`、`name`、`mime`、`size`、`hash`、`storageKey`。

安全控制：

- 限制 MIME 和扩展名白名单。
- 限制大小和数量。
- 做病毒扫描和内容嗅探。
- 敏感文件单独权限控制。

## 9. Q4 插件 / 钩子机制

建议提供事件：

- `beforeValidate`
- `afterValidate`
- `beforeSave`
- `afterSave`
- `afterSubmit`
- `onPublishSchema`

用途：

- 提交后发钉钉通知。
- 自动生成 PDF 合同。
- 同步候选人到第三方系统。

## 10. Q5 并发修改

推荐用乐观锁：

- Schema 保存时带 `version` 或 `etag`。
- 更新时校验 `If-Match`。
- 版本不一致直接拒绝并提示重新拉取最新版本。

好处：

- 简单。
- 可审计。
- 适合多人编辑但冲突不频繁的场景。

## 11. Q6 审计日志

必须记录：

- 谁改的
- 什么时候改的
- 改了什么
- 改前是什么
- 改后是什么
- 对应哪个 submission / schemaVersion

日志建议 append-only，不直接覆盖。

## 12. 一句话总结

这题最重要的不是把页面画出来，而是把「Schema、渲染、校验、版本、并发、审计、扩展」串成一个完整平台。
只要能讲清楚这条链路，面试官通常就会知道你不是在写普通表单，而是在做平台。
