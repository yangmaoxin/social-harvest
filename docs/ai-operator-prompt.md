# Social Harvest AI 操作提示

这份提示给用户电脑上的本地 AI agent 使用。用户可以说得很模糊，AI 应该自己读取文档、检查环境、选择任务、执行命令并读取报告，不要把内部命令和参数丢给普通用户选择。

## 用户可直接复制给 AI 的话

```text
请在当前目录操作 Social Harvest。先读取 docs/user-ai-command-card.md、docs/agent-runbook.md 和 docs/agent-intent-routing.md。

如果我说“安装 / 配置 / 检查能不能跑”，请先检查 Node 24、安装依赖、创建或检查 config.local.json，并运行 `npm run check`，不要写入业务系统。

如果我说“同步 / 跑今天数据 / 更新业务系统”，默认这是正式同步，会按平台 sink 配置写入；当前默认是 SCRM / 业务系统。请先简短说明会写入，然后按平台选择 `daily:douyin`、`daily:weixin-channels` 或 `daily:all`。其中 `daily:douyin` 和 `daily:weixin-channels` 都是默认增量日常：步骤完整，评论按新增/评论数增长/近期复查定向抓，弹幕按新增/弹幕数增长/近期复查定向抓；只有我明确说“抖音全量校准 / 抖音完整慢跑”时才用 `daily:douyin:full`，明确说“视频号全量校准 / 视频号完整慢跑”时才用 `daily:weixin-channels:full`。如果我只说内容/评论/弹幕、私信或指标，也优先跑对应平台的日常全流程，不要让我选择单模块命令。完成后读取 `task-report.json` 或 `daily-report.json`，用业务语言告诉我成功项、失败项和写入数量。SCRM 入库图片默认走 OSS，数据库写稳定 OSS URL。

如果我没有明确说“飞书 / 多维表格 / 展示表 / 发到飞书”，不要写飞书。只有我明确提到这些词时，才使用 `npm run publish:feishu -- ... --display-tables --apply` 或 runner 的飞书 sink。如果我说“只写飞书”，目的地必须是 `--sink feishu`，不要同时写 SCRM。

如果我说“全量 / 历史全部 / 从头抓完 / 一直抓到没有更多”，这才是历史全量。请使用 `history:*` 入口；不要把 `daily:*` 叫做全量抓取。

如果我说“试跑 / 先看看 / 不要写入 / 别入库”，请只跑不写库的 smoke 或 dry-run。

如果我没说展示方式，使用命令默认的人类可读进度展示。不要为了隐藏 JSON 把 `--display detailed` 改成 `compact`；原始 JSON 应过滤或留在报告文件里。只有我说“远端页面也要看到 / 同步到服务器展示 / 另一台电脑也要看进度”时，才使用 `npm run share:run` 包裹采集命令。

如果我没说日期，默认今天。如果只配置了一个平台，默认跑这个平台。如果配置了多个平台但我没说平台，请只追问“抖音、视频号，还是全部平台？”不要让我选择 `task:plan`、`task:run`、`--apply`、`dry-run` 这类内部参数。

不要要求我全局安装 opencli；先使用项目依赖和 `npm run check`。不要把 config.local.json 里的 main 当成真实 account_id；写库前必须使用 account-profile.json 里的平台真实账号 ID。
```

## AI 必须遵守的默认规则

| 用户说法 | AI 默认理解 |
| --- | --- |
| “检查一下”“能不能跑” | 只做环境检查，不写库 |
| “安装配置一下” | 安装依赖、引导配置、preflight，不写库 |
| “跑一下今天数据”“同步一下” | 正式同步，按默认 sink 写入，当前默认是 SCRM / 业务系统 |
| “今天都跑一下” | 全部已配置平台正式同步 |
| “全量抓一下”“历史全部补齐” | 历史全量断点抓取，必须使用 `history:*` 或 `--full` |
| “处理一下评论/私信/弹幕” | 平台唯一则跑对应 `daily:*` 全流程；多平台则追问平台 |
| “先试试”“先看看”“不要写入” | dry-run / smoke，不写库 |
| “详细看看过程”“显示抓取进度” | 本机详细展示；优先使用 `daily:*` / `history:*` 的默认展示 |
| “远端页面也要看”“同步到服务器展示” | 可选远端详细展示，用 `share:run` 包裹任务 |
| “刚才失败了” | 读取最近 `daily-report.json` 或 `task-report.json`，用 `npm run daily:failed -- <报告文件>` 补跑失败步骤 |

默认 sink 是 SCRM / 业务系统。飞书、多维表格和展示表都是显式外部发布目标，不是普通同步的默认附加动作；显式 `--sink feishu` 表示只写飞书。

## 展示模式选择

用户不需要知道 `--display` 或多个 `--` 怎么写。AI 必须自己选择模式并拼好命令。

| 用户意图 | AI 使用方式 |
| --- | --- |
| 普通同步、普通检查 | 使用命令默认的人类可读展示，不额外加展示参数 |
| “详细看看过程”“显示每一步”“让我看到抓到多少” | 优先用 `daily:*` / `history:*` 的默认展示；排障时由 AI 直接调用内部 runner |
| “远端页面也要看到”“同步到服务器”“另一台电脑看进度” | 远端详细展示：`npm run share:run -- ... -- npm run daily:douyin` |
| “看原始事件”“调试 TASK_EVENT” | 调试原始事件：`--display jsonl` |
| “不要输出日志”“静默跑” | 静默展示：`--display silent` |

远端详细展示需要用户或配置提供 `server`、`task-id`、`device-id`。如果用户只说“远端也看”，但没有服务器地址，先追问服务器地址；不要猜。

命令里的多个 `--` 是 AI 的责任，不要让普通用户解释横线含义。拼接顺序固定为：

```text
npm run share:run -- <发送器参数> -- <采集命令>
```

## AI 不应该做的事

- 不要要求普通用户记内部 runner 命令、`--apply`、`dry-run`。
- 不要把 `daily:*` 叫成“历史全量”；`daily:*` 是日常全流程，只有 `history:*` / `--full` 才是历史全量。
- 不要直接把 `scripts/run-daily-full.js`、`scripts/run-history.js` 当用户命令；普通场景通过对应 `npm run daily:*` 或 `npm run history:*` 入口执行。
- 不要要求普通用户理解多个 `--`。如果需要远端详细展示，AI 自己按模板拼命令。
- 不要因为 `opencli` 不在 PATH 就安装全局 OpenCLI。
- 不要手动复制终端输出当 JSON；必须通过项目 npm scripts 生成 UTF-8 产物。
- 不要把产物放到 `samples/douyin/creator-harvest.json` 或 `samples/weixin-channels/works.json` 这类平台根目录；日常任务应使用 `samples/tasks/<task-id>/` 输出目录，底层调试脚本才使用自己的默认目录。
- 不要直接执行 SQL 写入、删除或改表；正式写入走项目 npm scripts / runner。
- 不要删除、清空、覆盖数据，除非用户明确确认平台、日期范围、表名和影响。

## 最短执行顺序

1. 读 `docs/user-ai-command-card.md`、`docs/agent-runbook.md` 和 `docs/agent-intent-routing.md`。
2. 确认 Node 24，必要时安装依赖：`npm install --omit=dev`。
3. 运行 `npm run check`。
4. 根据用户意图选择 `npm run daily:douyin`、`npm run daily:weixin-channels`、`npm run daily:all`、`npm run history:*`、`npm run daily:failed` 或不写库 smoke。
5. 任务结束后读取输出目录里的 `task-report.json` 或 `daily-report.json`。
6. 用“采集了什么、写入了多少、哪里失败、下一步做什么”的业务语言回复用户。
