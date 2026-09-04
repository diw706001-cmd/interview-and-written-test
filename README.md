# HR 动态表单与通用接口引擎 · 笔试交付

> 全栈开发工程师笔试题：实现一个 Schema 驱动的 HR 动态表单引擎，并部署上线。

## 线上演示

- 服务入口：**http://115.190.238.188/**
- 健康检查：`GET /health` → `{"ok":true}`
- Schema 接口：`GET /api/v1/forms/tech_onboarding/schema`
- 数据提交：`POST /api/v1/dynamic-data/tech_onboarding`

线上接口需要 Bearer Token 认证，角色与示例令牌见 `hr-form/.env.example` 与 `hr-form/README.md`。

## 仓库结构

- `hr-form/`：完整项目源码、API 服务、前端演示页、部署脚本、测试用例。
- `docs/`：笔试分析报告、上线交付摘要、原题 PDF 与解析文本。

## 快速开始

```bash
cd hr-form
pnpm install
pnpm start
```

本地默认地址 `http://127.0.0.1:3000`，Token 见 `hr-form/.env.example`。

## 技术要点

- Schema 驱动 UI 渲染与字段级校验。
- 版本化 Schema + ETag 乐观锁。
- 动态查询 `filter[field][operator]`、分页、排序。
- 文件上传 `init → PUT content → complete` 流程，SHA-256 校验。
- 角色权限：`admin` / `hr` / `viewer`。
- 审计日志 append-only，敏感字段脱敏。
- 部署：`systemd + nginx` 反向代理，JSON 文件持久化（演示模式）。

## 交付物清单

| 文件 | 说明 |
|---|---|
| `hr-form/README.md` | 项目源码详细说明 |
| `docs/笔试分析报告.md` | 笔试题目分析与解题思路 |
| `docs/上线交付摘要.md` | 线上环境、验收结果、待办事项 |
| `docs/exam.pdf` | 原笔试题 |
| `docs/exam_text.txt` | 题目文本提取 |

## 状态

- 本地冒烟测试 **7/7 通过**。
- 公网端到端全链路验证通过。
- 服务已上线并可公网访问。
