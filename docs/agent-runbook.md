# Social Harvest Agent Runbook

更新日期：2026-05-25

这份 runbook 面向任意能读取仓库文件、执行命令、查看 JSON 报告的 agent。它不绑定 Codex；Codex skill、OpenClaw、Claude Code 或其他本地 agent 都应该优先复用这里的流程。

## 基本契约

Social Harvest 的 agent-first 交付由四层组成：

| 层 | 作用 | 是否绑定某个 agent |
| --- | --- | --- |
| `package.json` npm scripts | 用户和 AI 的一线业务入口 | 否 |
| `scripts/run-*-daily.js` / `scripts/run-daily-full.js` / `scripts/run-history.js` | 一线入口到 runner 和平台脚本的薄包装 | 否 |
| `scripts/task-runner.js` / `runner/` / `tasks/*.json` | 内部执行器、事件、报告和计划编排 | 否 |
| `daily-report.json` / `task-report.json` | 任务结果、失败归类、下一步动作和证据文件 | 否 |
| agent runbook / skill | 告诉 agent 如何选择命令、读报告、恢复失败 | 可按 agent 适配 |

Codex 的 `skills/social-harvest-operator` 是第一个适配层，不是唯一客户端。

## 标准流程

先把用户的自然语言意图翻译成 Social Harvest 的业务动作。用户说得不具体时，先按 [Social Harvest Agent Intent Routing](agent-intent-routing.md) 判断默认值和是否需要追问。

如果这是第一次接手用户电脑上的 Social Harvest，先读取 [用户通过 AI 操作 Social Harvest 速查卡](user-ai-command-card.md) 和 [Social Harvest AI 操作提示](ai-operator-prompt.md)。前者给用户和 AI 对齐话术，后者是给通用 AI agent 的短协议。

| 用户意图 | 默认动作 |
| --- | --- |
| 检查能不能跑 | 运行 `npm run check` |
| 同步、跑今天数据、更新业务系统 | 运行 `daily:*`，按默认 sink 写入，当前默认是 SCRM / 业务系统 |
| 历史、全量、从头抓完 | 运行 `history:*` |
| 写飞书 | 已有产物用 `npm run publish:feishu -- ...`；本次同步只写飞书时用 runner sink 声明 `--sink feishu` |
| 远端页面看进度 | 使用 `npm run share:run -- ... -- <采集命令>` |
| 试跑、不要写入、看看链路通不通 | 运行不写库的 smoke / dry-run |
| 失败了、看看原因 | 读取 `daily-report.json` 或 `task-report.json`，按 `failure_category` 和 `next_actions` 汇报 |

在 Social Harvest 里，用户说“同步”默认表示采集并按默认 sink 写入；当前默认 sink 是 SCRM / 业务系统。agent 可以在执行前简短说明这次会写入，但不要把普通同步请求自动降级为试运行。SCRM 入库会按配置先把图片写入 OSS，再把稳定 URL 写入数据库。

飞书不是默认同步目标。只有用户明确说“飞书”“多维表格”“展示表”“发到飞书”时，才运行 `npm run publish:feishu -- ...` 或 runner 的飞书 sink。用户明确说“只写飞书”时，使用完整目的地声明 `--sink feishu`，不要同时写 SCRM。不要因为用户只说“同步”“跑今天”“更新业务系统”就自动写飞书。

在抖音语境里，用户只说“抖音”默认表示抖音创作者中心主线；只有明确说“抖音前台”“公开主页”“前台公开页”时，才切到前台公开页链路。

不要要求普通用户说 `dry-run`、`task:plan`、`task:run`、`--apply`。这些是 agent 内部执行细节。只有当用户明确说“试跑”“不要写入”“先看看链路”时，才选择不写库的 smoke / dry-run。

如果用户说“弄一下数据”“跑一下今天”“处理一下评论”这类模糊话术，优先查 [Social Harvest Agent Intent Routing](agent-intent-routing.md)，不要直接暴露命令让用户选择。

追问时只问业务选项。例如“你想跑抖音、视频号，还是全部平台？”不要问“要不要 `--apply`”“跑哪个 task JSON”“是否 dry-run”。这些内部判断由 agent 根据用户语义完成。

## 写库安全规则

正式写入只能通过本项目提供的 CLI / runner 执行，不要直接对 SCRM 数据库执行 `DELETE`、`UPDATE`、`INSERT`、`TRUNCATE` 或 DDL。排查时可以做只读查询；如果确实需要清理、覆盖、修复历史数据，必须先向用户说明表名、平台、账号、日期范围和影响行数，并等待明确确认。

`config.local.json` 里的平台账号 `id` 只是本机配置别名，例如 `main`，不能当作业务表里的 `account_id`。写入 `scrm_file`、`scrm_comment`、`scrm_message`、`scrm_danmaku`、`scrm_account` 时，`account_id` 必须是平台真实账号标识，例如抖音号或视频号 ID。拿不到真实 `account_id` 时，先生成或读取 `account-profile.json`，不要把 `main`、`account-1` 这类别名传给 `--account-id`。

1. 运行环境检查。

```bash
npm run check
```

如果 Node 不满足 `package.json` 的 `engines.node`，先切到 Node 24，再运行 npm scripts。

2. 必要时查看内部可运行任务。普通同步不需要这一步。

```bash
node scripts/task-runner.js list --json
```

3. 按用户意图选择任务。

正式同步默认使用按平台 sink 配置写入的计划；当前默认配置会写入 SCRM / 业务系统：

```bash
npm run daily:douyin
npm run daily:weixin-channels
npm run daily:all
```

`daily:douyin` 和 `daily:weixin-channels` 都是默认增量日常：诊断、内容、弹幕、私信、指标和 +1/+N 事件都会跑。评论按新增/评论数增长/近期复查定向抓，弹幕按新增/弹幕数增长/近期复查定向抓；平台统计数和已入库可见明细数不一致时，不作为日常反复补抓条件。需要完整慢流程校准时用 `npm run daily:douyin:full` 或 `npm run daily:weixin-channels:full`。

历史全量只在用户明确说“历史 / 全量 / 从头抓完”时使用：

```bash
npm run history:douyin
npm run history:douyin-public
npm run history:weixin-channels
```

只有用户明确要求试运行时，才使用不写库计划：

```bash
node scripts/task-runner.js plan --config tasks/smoke-douyin-public.json --output-dir samples/tasks/smoke-douyin-public-demo
```

4. 读取任务报告。

优先打开任务输出目录下的 `daily-report.json` 或 `task-report.json`；抖音和视频号增量日常会同时写这两个报告文件。不要只看 stdout。重点字段：

- `status`
- `summary_text`
- `failure_category`
- `next_actions`
- `repro_command`
- `verification_commands`
- `evidence_files`
- `harness_warnings`

5. 按报告恢复失败。

如果 `suggested_skill` 是 `opencli-autofix`，说明更适合进入 OpenCLI adapter/浏览器诊断流程。否则按 `next_actions` 和 `verification_commands` 处理。

## 一线入口

| 场景 | 入口 |
| --- | --- |
| 最小环境检查 | `npm run check` |
| 日常抖音 | `npm run daily:douyin` |
| 日常视频号 | `npm run daily:weixin-channels` |
| 日常全部平台 | `npm run daily:all` |
| 历史抖音自己账号 | `npm run history:douyin` |
| 历史抖音公开主页 | `npm run history:douyin-public` |
| 历史视频号 | `npm run history:weixin-channels` |
| 写飞书 | `npm run publish:feishu -- ...` |
| 远端页面展示 | `npm run share:run -- ... -- <采集命令>` |
| 模糊话术路由 | `docs/agent-intent-routing.md` |
| 选择验证命令 | `docs/harness/harness-validation-matrix.md` |
| 失败恢复策略 | `docs/harness/harness-failure-catalog.md` |
| report 字段解释 | `docs/harness/harness-report-agent-fields.md` |

## 内部排障入口

这些命令不是普通同步入口；只在排障、验证 runner 能力、新增任务或按报告恢复失败时使用。

| 场景 | 入口 |
| --- | --- |
| 查看内部任务能力 | `node scripts/task-runner.js list --json` |
| 运行内部单平台任务 | `node scripts/task-runner.js run --platform <platform> --task <task>` |
| 运行内部计划任务 | `node scripts/task-runner.js plan --config <plan.json>` |

## Agent 适配建议

新的 agent 适配不应该复制大段项目文档。推荐只做三件事：

- 指向本 runbook 作为入口。
- 指向 `docs/harness/harness-validation-matrix.md` 选择验证命令。
- 保持 `daily-report.json` / `task-report.json` 为任务结果真相源。

如果某个 agent 支持专用 skill 或项目指令文件，可以把这份 runbook 作为路由页，再按该 agent 的格式封装。
