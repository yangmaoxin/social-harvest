# 用户首次使用指南

这份指南面向拿到 Social Harvest 精简包的人。普通用户不需要先学命令；入口是打开本地 AI agent，让它在这个目录里完成安装、配置、检查和运行。

## 第一句话

把精简包 `.zip` 解压到本机后，让 Codex、Claude Code、Cursor 或其他能读文件并执行命令的本地 AI 打开这个目录，然后说：

```text
帮我安装并配置 Social Harvest。先检查环境，不要写入业务系统。
```

AI 应该先读取：

- `docs/ai-operator-prompt.md`
- `docs/agent-runbook.md`
- `docs/agent-intent-routing.md`
- `docs/config-reference.md`
- `DELIVERY_MANIFEST.md`

如果用户担心对方 AI 理解错，可以先把 [Social Harvest AI 操作提示](ai-operator-prompt.md) 里的整段提示复制给 AI。那份提示是最短操作协议，专门处理“用户说得模糊，但 AI 要自己配置、自己判断、自己跑任务”的场景。

日常使用时也可以先看 [用户通过 AI 操作 Social Harvest 速查卡](user-ai-command-card.md)。那页把“用户怎么说”和“AI 应该跑什么”收成一张表。

## AI 会自动做什么

- 检查 Node.js 是否为 24.x。
- 安装 npm 依赖；精简包优先使用 `npm install --omit=dev`，避免安装桌面端开发依赖。
- 根据 `config.example.json` 引导创建 `config.local.json`。
- 检查 Chrome、项目内置 `@jackwener/opencli`、OpenCLI 浏览器插件连接状态和平台登录态。
- 运行 `npm run check`。
- 查看可用任务。
- 在你明确要求试跑时，执行不写库的检查链路。
- 任务结束后读取 `daily-report.json` 或 `task-report.json`，用业务语言汇报结果。

## 用户需要提供什么

- 数据库 host、user、password、db_name；只有正式写入 SCRM 时需要。
- AI API Key；只有启用评论或私信意向分析时需要。
- 抖音账号的 `sec_uid` 或账号主页标识；公开主页抓取时需要。
- Chrome 里的平台登录态，例如抖音创作者中心或视频号助手后台。
- OpenCLI 浏览器插件连接状态。
- 正式同步意图。用户明确说“同步 / 跑今天数据 / 更新业务系统”时，即视为允许写入 SCRM / 业务系统；如果语义不清，AI 应先确认。

用户不需要单独全局安装 `opencli`。Social Harvest 的 npm scripts 默认使用项目依赖里的 `@jackwener/opencli`；如果 AI 因为 `opencli` 不在 PATH 就要执行 `npm install -g @jackwener/opencli`，应先停止，改为运行 `npm install --omit=dev` 和 `npm run check`。

如果终端出现 `Command <site>/<command> must declare access: 'read' | 'write'`，通常不是 OpenCLI 版本太低，而是用户目录 `~/.opencli/clis` 或 Windows `%USERPROFILE%\\.opencli\\clis` 里存在旧的第三方 adapter。优先确认目标平台命令是否继续运行；若这些旧模块干扰执行，应按 `docs/opencli-1.7.12-external-adapter-compat.md` 的 `1.7.12+` 兼容规则清理或升级对应 adapter，不要盲目升级全局 OpenCLI。

`npm run check` 会主动扫描用户级 OpenCLI adapter 目录。如果看到 `user-opencli-adapters` warning，先按提示移动或升级旧 adapter；这类 warning 不代表 Social Harvest zip 里的项目依赖缺失。

Windows 上如果抓取结果里的中文出现乱码，优先重新运行本项目的 npm 脚本，不要手动复制终端输出保存 JSON。项目脚本会自动兼容 UTF-8 / GBK 输出并用 UTF-8 写入结果文件；如果仍有乱码，可以让 AI 设置 `HARVEST_OPS_STDIO_ENCODING=gbk` 后重跑对应任务。

日常任务的标准产物位置是 `samples/tasks/<task-id>/`。抖音/视频号增量日常会写 `daily-report.json`、`task-report.json`、`task-state.json`、`task-events.jsonl` 和平台子目录。抖音/视频号创作者内容、私信、弹幕等平台文件应出现在这个任务目录下，而不是直接散落在 `samples/douyin` 或 `samples/weixin-channels` 根目录。看到根目录散落文件时，通常说明 AI 绕过了项目 npm 脚本、手动保存了 OpenCLI 输出，或把 `--output-dir` 传错了；应重新通过 `npm run daily:douyin` 或 `npm run daily:weixin-channels` 运行。

抖音/视频号增量日常还会在任务目录下写 `metadata/`、`delta/` 和 `delta-plan.json`。不要把 `harvest.json`、`danmaku-flat.json` 或 `private-messages-flat.json` 当成一线最终报告；AI 应读取 `daily-report.json` 或 `task-report.json` 后再用业务语言汇报。

## 常用说法

检查环境，不写业务系统：

```text
帮我检查 Social Harvest 今天能不能正常跑，不要写入业务系统。
```

试跑抖音，不写业务系统：

```text
先试跑一下抖音链路，不要写入业务系统。
```

正式同步抖音：

```text
帮我同步今天的抖音数据，完成后告诉我写入了多少。
```

正式同步全部已配置平台：

```text
今天所有平台的数据都跑一下，完成后总结成功和失败情况。
```

排查失败：

```text
刚才任务失败了，帮我看报告文件，告诉我原因和下一步。
```

## 模糊表达怎么处理

用户可以说得比较自然，例如“今天数据跑一下”。AI 会按 `docs/agent-intent-routing.md` 判断默认值：

- 没说日期：默认今天。
- 只有一个启用平台：默认跑这个平台。
- 多个平台启用但没说平台：AI 应该追问跑哪个平台，或是否全部跑。
- 用户说“同步”“跑今天数据”“更新业务系统”：默认正式写入业务系统。
- 用户说“试跑”“先看看”“不要写入”：默认不写业务系统。

更具体的例子：

| 用户说 | AI 应该怎么做 |
| --- | --- |
| “安装一下，看看能不能用” | 安装依赖、检查配置和登录态，不写库 |
| “今天抖音跑一下” | 跑抖音正式同步，写入业务系统，完成后读报告 |
| “今天都跑一下” | 跑全部已配置平台；如果配置不完整，先说明缺口 |
| “处理一下评论” | 平台唯一则直接跑；多平台则追问“抖音、视频号，还是全部？” |
| “先看看数据对不对” | 只做试运行或 preview，不写库 |
| “刚才报错了” | 找最近 `daily-report.json` 或 `task-report.json`，按失败分类和下一步建议处理 |

AI 追问时只问业务选项，不要问用户要不要加 `--apply`、跑哪个 `task:plan` / `task:run`、是否 `dry-run`。这些是 AI 自己根据语义决定的内部细节。

## 安全边界

AI 不应该替用户编造凭据，也不应该静默执行高风险动作。

遇到这些情况时，AI 必须先确认：

- 写入业务系统；用户明确要求“同步 / 跑今天数据 / 更新业务系统”时除外，这已经是正式同步意图。
- 修改 `config.local.json` 中的数据库或 AI Key。
- 删除、清空、覆盖、重置数据。
- 直接执行 SQL 写入、删除或更新 SCRM 数据。
- 上传、发送或公开报告。
- 修改数据库结构。

如果只是安装依赖、检查环境、读取报告或不写库试跑，AI 可以直接推进。

另外，`config.local.json` 里的账号 `id`，例如 `main`，只是给人和配置选择用的本地别名。正式写库时必须使用平台真实 `account_id`，例如抖音号或视频号 ID；如果 AI 不确定，应先生成或读取 `account-profile.json`，不能把 `main` 当成业务账号 ID。
