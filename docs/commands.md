# CLI 命令清单

Social Harvest 现在是 CLI-first 工具。普通用户和 AI 一线采集时只需要记 `check`、`daily:*`、`history:*` 和失败补跑入口。`task-runner.js`、`runner/`、`tasks/*.json` 仍然保留，但它们是内部执行器，不再作为用户入口。

默认规则：用户没有特别声明目标 sink 时，`daily:*` 和 `history:*` 都按 `platforms.<platform>.sinks` / `default_sinks` 写入；默认配置是 **采集并写入 SCRM / 业务系统**。飞书、多维表格、远端页面都不是默认动作，只有用户明确提到时才执行。

## 一线入口

| 你想做什么 | 命令 | 写业务系统 | 语义 |
| --- | --- | --- | --- |
| 检查环境、配置、登录态 | `npm run check` | 否 | 只检查，不采集、不写库 |
| 跑抖音自己账号今天数据 | `npm run daily:douyin` | 是 | 增量日常全流程：步骤完整，评论按新增/评论数增长/近期复查定向抓，弹幕按新增/弹幕数增长/近期复查定向抓 |
| 抖音全量校准跑 | `npm run daily:douyin:full` | 是 | 完整慢流程；需要校准或排查漏抓时使用，不是历史翻页全量 |
| 跑视频号今天数据 | `npm run daily:weixin-channels` | 是 | 增量日常全流程：步骤完整，评论按新增/评论数增长/近期复查定向抓，弹幕按新增/弹幕数增长/近期复查定向抓 |
| 视频号全量校准跑 | `npm run daily:weixin-channels:full` | 是 | 完整慢流程；需要校准或排查漏抓时使用，不是历史翻页全量 |
| 跑全部平台今天数据 | `npm run daily:all` | 是 | 全平台增量日常全流程 |
| 全平台全量校准跑 | `npm run daily:all:full` | 是 | 全平台完整慢流程 |
| 按失败报告补跑失败步骤 | `npm run daily:failed -- samples/tasks/<task>/daily-report.json` | 按报告原步骤 | 增量日常报告补跑 `status=failed` 的步骤；旧 runner 报告继续补跑失败/跳过任务 |
| 抖音自己账号历史补抓 | `npm run history:douyin` | 是 | 显式 `--full`，历史全量补抓 |
| 抖音公开主页历史补抓 | `npm run history:douyin-public` | 是 | 显式 `--full`，公开主页历史补抓 |
| 视频号历史补抓 | `npm run history:weixin-channels` | 是 | 显式 `--full`，历史全量补抓 |

## 日常全流程 vs 历史全量

日常全流程是“今天/近期同步”：平台步骤先产出采集文件，再由统一 sink runner 按 `platforms.<platform>.sinks` 写入 SCRM / 业务系统或飞书；默认 sink 是 `scrm`，不会主动翻完整历史。SCRM 入库时，图片会按 `sinks.scrm.media` 上传到 OSS，数据库写稳定 OSS URL。

历史全量是“补历史”：命令里显式带 `--full`，会按批次翻历史、写 checkpoint，并尽量续跑到上限或没有更多数据。用户说“全量、历史、从头抓完、一直抓到没有更多”时才用 `history:*`。

用户说“同步一下、跑今天、更新业务系统”时，用 `daily:*`。如果用户只提到内容、私信或指标，也优先跑日常全流程；失败恢复用 `daily:failed`，需要慢速兜底时用 `daily:douyin:full`、`daily:weixin-channels:full` 或 `daily:all:full`。不要把 `daily:*` 叫成全量抓取。

默认终端输出面向普通用户，保留可读的详细进度、摘要和报告路径，但不展开原始 JSON。需要排障时读取输出目录里的 `daily-report.json` / `task-report.json` 和平台产物文件。

## 失败后补跑

每次日常任务都会写 `daily-report.json` / `task-report.json`。当任务失败时，优先按报告补跑失败步骤：

```bash
npm run daily:failed -- samples/tasks/<task-id>/daily-report.json
```

增量日常报告会按保存的步骤命令补跑 `failed` 步骤；旧 runner 计划报告仍会补跑 `failed` 和依赖跳过的 `skipped` 任务。

补跑入口会读取报告里的失败结果，保留可复用参数，只重跑这些项。它不会自动重跑已经成功的步骤。

如果是抖音/视频号增量日常生成的 `daily-report.json`，优先直接重跑对应的 `npm run daily:douyin` 或 `npm run daily:weixin-channels`；如果是 runner 计划生成的 `task-report.json`，再使用 `daily:failed` 精准补跑失败/跳过步骤。

## 外部推送

这些是二线入口，不混入默认采集命令。只有用户明确提到飞书、多维表格、展示表、多个 sink 或远端页面时才用。

| 你想做什么 | 命令 | 说明 |
| --- | --- | --- |
| 把已有采集产物写入飞书多维表格 | `npm run publish:feishu -- <参数>` | 调用 `scripts/write-to-feishu-base.js` |
| 把已有采集产物写入多个 sink | `npm run sink:run -- <参数>` | 调用 `scripts/run-sinks.js` |
| 把某次采集过程同步到远端页面 | `npm run share:run -- <发送器参数> -- <采集命令>` | 调用 `scripts/live-share.js`，只负责展示进度 |

飞书能力没有删除。runner 内部支持完整目的地声明：`--sink feishu` 表示只写飞书，`--sink scrm --sink feishu` 表示数据库和飞书都写。普通用户只在“已有产物要写飞书”时使用 `publish:feishu`；如果用户要求“这次同步只写飞书”，由 AI 给 `daily:*` 或内部 runner 追加 `--sink feishu --sink-apply`。不要因为用户只说“同步”或“更新业务系统”就自动写飞书。

远程推送能力也没有删除。`share:run` 保留 `TASK_EVENT`、`OPENCLI_PROGRESS`、`task-events.jsonl`、`task-state.json` 和 `task-report.json` 的展示链路；它不改变采集和写库语义。

示例：

```bash
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables --apply
```

```bash
npm run share:run -- --server http://127.0.0.1:8001 --task-id demo --device-id office -- npm run daily:douyin
```

## AI 选命令规则

| 用户说法 | 使用入口 |
| --- | --- |
| “检查一下”“能不能跑” | `npm run check` |
| “同步一下”“跑今天”“更新业务系统” | `daily:*` |
| “抖音日常”“跑抖音今天数据” | `npm run daily:douyin`，默认是增量日常，覆盖诊断、内容、弹幕、私信、指标和 +1/+N 事件 |
| “抖音全量校准”“抖音完整慢跑” | `npm run daily:douyin:full` |
| “视频号日常”“跑视频号今天数据” | `npm run daily:weixin-channels`，默认是增量日常，覆盖诊断、内容、弹幕、私信、指标和 +1/+N 事件 |
| “视频号全量校准”“视频号完整慢跑” | `npm run daily:weixin-channels:full` |
| “只跑内容/评论/弹幕” | 用户层不再拆分；用对应 `daily:*` 全流程，必要时说明会一起刷新相关链路 |
| “只跑私信” | 用户层不再拆分；用对应 `daily:*` 全流程，失败恢复用 `daily:failed` |
| “只跑指标” | 用户层不再拆分；用对应 `daily:*` 全流程，避免缺少前置账号/作品基线 |
| “刚才失败了，补一下” | `npm run daily:failed -- <daily-report.json 或 task-report.json>` |
| “今天全部跑一下” | `npm run daily:all` |
| “历史全量”“从头抓完”“补齐历史” | `history:*` |
| “把已有结果写飞书” | `npm run publish:feishu -- ...` |
| “这次同步只写飞书” | `daily:*` / runner 内部 sink 加 `--sink feishu --sink-apply` |
| “远端页面看进度”“同步到服务器展示” | `npm run share:run -- ... -- <采集命令>` |

除非用户明确说“飞书 / 多维表格 / 展示表”，否则同步结果按默认 sink 写入，通常只写 SCRM / 业务系统。不要要求普通用户选择 `task:plan`、`task:run`、`--apply`、`dry-run`、sink 或多个 `--`。如果必须用底层脚本排障，由 AI 自己拼完整命令并说明原因。

命令模式保持业务词优先：日常用 `daily:*`，历史用 `history:*`，失败恢复用 `daily:failed`，已有产物补写用 `sink:run` / `publish:feishu`，远端展示用 `share:run`。不要再为 `fast`、`quick`、`normal` 这类实现细节新增用户级命令。

## 排障脚本索引

下面这些脚本继续存在，但不再包装成 npm 一线菜单。需要排障时直接运行 `node scripts/<name>.js`。

| 场景 | 脚本 |
| --- | --- |
| 查看 runner 能力 | `node scripts/task-runner.js list --json` |
| 运行指定 runner 任务 | `node scripts/task-runner.js run --platform <platform> --task <task>` |
| 运行指定计划 | `node scripts/task-runner.js plan --config tasks/<plan>.json` |
| 抖音公开主页采集 | `node scripts/harvest-douyin.js` |
| 抖音创作者中心内容 | `node scripts/harvest-douyin-creator.js` |
| 抖音 delta 计划 | `node scripts/build-douyin-delta-plan.js --works <creator-harvest.json>` |
| 抖音增量日常编排 | `node scripts/run-douyin-daily.js` |
| 完整慢流程校准编排 | `node scripts/run-daily-full.js <douyin\|weixin-channels\|all>` |
| 历史补抓编排 | `node scripts/run-history.js <douyin\|weixin-channels> [task]` |
| 抖音私信导出/兼容入库 | `node scripts/sync-douyin-private-messages-to-scrm-message.js` |
| 视频号内容主流程 | `node scripts/resume-weixin-channels.js` |
| 视频号 delta 计划 | `node scripts/build-weixin-channels-delta-plan.js --works <works.json>` |
| 视频号增量日常编排 | `node scripts/run-weixin-channels-daily.js` |
| 视频号私信导出/兼容入库 | `node scripts/sync-weixin-channels-private-messages-to-scrm-message.js` |
| 视频号弹幕导出/兼容入库 | `node scripts/sync-weixin-channels-danmaku-to-scrm.js` |
| 统一 sink 补写 | `node scripts/run-sinks.js` |
| SCRM 底层导入器 | `node scripts/import-to-scrm.js` |
| SCRM 弹幕审计 | `node scripts/audit-danmaku.js` |
| metric smoke | `node scripts/metric-smoke-test.js` |
| metric 快照 | `node scripts/import-metric-snapshot-to-scrm.js` |
| metric delta | `node scripts/generate-metric-delta-events.js` |
| metric feed 查询 | `node scripts/query-metric-feed.js` |

底层脚本的参数以脚本 `--help` 和对应平台 runbook 为准。新增用户级入口时，优先考虑是否会增加歧义；能作为排障脚本存在的，不再加 npm 菜单。
