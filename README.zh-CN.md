# Social Harvest

[English](README.md)

Social Harvest 是一个面向社交平台运营数据的 CLI 工具。它把抖音、微信视频号等平台的内容、评论、回复、弹幕、私信、指标和媒体采集流程收束成可重复运行的命令，并把结果写入 SCRM、飞书多维表格或结构化报告。

它的目标不是让用户记住复杂参数，而是让本地 AI Agent 或操作者用稳定的一线命令完成“检查环境、同步今天数据、补抓历史、读取报告、恢复失败”这些日常工作。

## 功能特点

- **一线命令清晰**：`check`、`daily:*`、`history:*`、`daily:failed` 覆盖常见运营任务。
- **AI 友好**：内置 agent runbook、用户话术卡和结构化任务报告，方便 AI 执行命令后汇报结果。
- **结构化产物**：每次任务生成 `daily-report.json`、`task-report.json`、`task-events.jsonl`、`task-state.json` 和 checkpoint。
- **多平台采集**：支持抖音自己账号、抖音公开主页、微信视频号助手等场景。
- **多目的地写入**：支持 SCRM / MySQL 写入、飞书 Base 写入和统一 sink runner。
- **可续跑和可恢复**：历史补抓和全量任务使用 checkpoint，失败步骤可按报告补跑。
- **终端输出可读**：默认展示人能看懂的进度和摘要，原始诊断细节进入报告文件。

## 平台能力

| 平台 | 自己账号 | 公开主页 | 评论/回复 | 弹幕 | 私信 | SCRM 写入 | 历史补抓 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 抖音 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| 微信视频号 | 支持 | 不适用 | 支持 | 支持 | 支持 | 支持 | 支持 |

## 快速开始

需要 Node.js 24.x。

```bash
node -v
npm install --omit=dev
npm run check
```

Social Harvest 使用项目依赖里的 `@jackwener/opencli`。普通用户不需要全局安装 `opencli`，也不需要准备 OpenCLI 主仓库。

## 配置

复制本机配置：

```bash
cp config.example.json config.local.json
```

然后按实际环境填写：

- SCRM / MySQL 数据库连接
- 飞书应用配置，可选
- AI 服务配置，可选
- 平台账号别名和运行参数

`config.local.json` 是本机私密配置，不要提交到仓库。完整说明见 [docs/config-reference.md](docs/config-reference.md)。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 检查环境、配置和登录态 | `npm run check` |
| 跑抖音日常同步 | `npm run daily:douyin` |
| 跑视频号日常同步 | `npm run daily:weixin-channels` |
| 跑全部平台日常同步 | `npm run daily:all` |
| 抖音自己账号历史补抓 | `npm run history:douyin` |
| 抖音公开主页历史补抓 | `npm run history:douyin-public` |
| 视频号历史补抓 | `npm run history:weixin-channels` |
| 按报告补跑失败步骤 | `npm run daily:failed -- samples/tasks/<task>/daily-report.json` |
| 把已有产物写入飞书 Base | `npm run publish:feishu -- <参数>` |
| 把已有产物写入声明的 sink | `npm run sink:run -- <参数>` |
| 把进度同步到远端页面 | `npm run share:run -- <发送器参数> -- <采集命令>` |

`daily:*` 是日常增量同步。只有明确要“历史、全量、从头补齐、一直抓到没有更多”时，才使用 `history:*`。

## 让 AI 帮你操作

你可以把仓库交给本地 AI，然后直接说：

```text
帮我检查一下 Social Harvest 环境，看看今天能不能正常运行。
```

或：

```text
帮我同步今天的抖音数据，完成后告诉我写入了多少。
```

如果 AI 需要规则提示，可以让它先读：

- [docs/ai-operator-prompt.md](docs/ai-operator-prompt.md)
- [docs/user-ai-command-card.md](docs/user-ai-command-card.md)
- [docs/agent-runbook.md](docs/agent-runbook.md)
- [docs/user-first-run.md](docs/user-first-run.md)

## 运行结果

任务通常会在 `samples/tasks/` 下生成报告：

- `daily-report.json`
- `task-report.json`
- `task-events.jsonl`
- `task-state.json`
- `checkpoint.json`

AI 或操作者汇报结果时应优先读取报告文件，而不是只看终端日志。

## 文档

| 主题 | 文档 |
| --- | --- |
| 第一次使用 | [docs/user-first-run.md](docs/user-first-run.md) |
| 命令清单 | [docs/commands.md](docs/commands.md) |
| 配置说明 | [docs/config-reference.md](docs/config-reference.md) |
| AI 操作 | [docs/ai-operator-prompt.md](docs/ai-operator-prompt.md)、[docs/agent-runbook.md](docs/agent-runbook.md) |
| 平台能力 | [docs/platforms/platform-capability-matrix.md](docs/platforms/platform-capability-matrix.md) |
| SCRM / 飞书写入 | [docs/multi-platform-sinks.md](docs/multi-platform-sinks.md) |
| 排障 | [docs/faq.md](docs/faq.md)、[docs/advanced-diagnostics.md](docs/advanced-diagnostics.md) |

完整入口见 [docs/README.md](docs/README.md)，中文入口见 [docs/README.zh-CN.md](docs/README.zh-CN.md)。

## 仓库结构

```text
social-harvest/
├── adapters/      # 平台 OpenCLI 适配器
├── docs/          # 用户指南、AI runbook、平台说明和数据写入说明
├── runner/        # 任务执行、事件、报告和 checkpoint 内核
├── samples/       # 本地运行产物目录
├── scripts/       # CLI 入口、平台流程、sink 写入和诊断工具
└── tasks/         # runner 任务计划样例
```

## 参与贡献

欢迎提交 bug report、功能建议和文档改进。贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

请不要提交 `config.local.json`、密钥、cookies、私信、真实媒体文件或生产数据库导出。更多说明见 [SECURITY.md](SECURITY.md)。

## License

Apache-2.0. See [LICENSE](LICENSE).
