# 快速开始

这份文档面向第一次进入 Social Harvest 的开发者。当前项目主线是 CLI-first 命令、统一 runner、平台适配器、全量断点、SCRM 入库、飞书写入和远程进度推送。

## 1. 先理解项目是什么

Social Harvest 是多平台内容采集和统一 sink 写入的 Node 任务系统。核心层次是：

- `package.json`：一线 CLI 入口，只暴露 `check`、`daily:*`、`history:*`、`publish:feishu`、`sink:run`、`share:run`。
- `scripts/task-runner.js`：内部任务执行器。
- `runner/`：任务执行、事件、状态、报告、计划和 checkpoint 内核。
- `scripts/lib/platform-registry.js`：平台和任务注册表。
- `scripts/*.js`：平台主流程、私信导出、统一 sink 写入、SCRM 底层导入器、环境诊断和维护任务。
- `adapters/`：OpenCLI 平台适配器。
- `tasks/`：多任务计划样例。
- `docs/`：开发文档、平台 runbook、验证矩阵和归档资料。

本地联调 OpenCLI 时可以使用 `workspace/OpenCLI`，但普通运行和用户交付 zip 不要求准备这个目录。

## 2. 环境准备

开发环境需要：

- Node.js 24.x，项目 `engines.node` 为 `>=24 <25`。
- npm。
- 可用的本机 Chrome。
- OpenCLI 浏览器插件。
- 如需真实入库，需要 MySQL 配置。

日常主流程、入库和维护工具都使用 Node。项目不再新增 shell、PowerShell 或 Python 编排脚本。

安装依赖：

```bash
nvm use 24
npm install
```

精简包 / 最终用户机器优先安装生产依赖：

```bash
npm install --omit=dev
```

Social Harvest 的 npm scripts 默认使用项目依赖里的 `@jackwener/opencli`，当前锁定到 `1.8.0`。普通用户不需要全局安装 `opencli`，也不需要准备 `workspace/OpenCLI`；只有开发或调试适配器时才需要本地 OpenCLI 工作副本。

验证仓库：

```bash
npm run check
npm test
```

## 3. 配置

开发环境默认读取：

- 命令行参数
- 环境变量
- `config.local.json`

先参考：

- [config.example.json](../config.example.json)
- [config-reference.md](./config-reference.md)

抖音多账号、数据库、AI 模型池等配置都放在同一份配置语义里。

## 4. 优先使用一线命令

检查环境：

```bash
npm run check
```

日常全流程：

```bash
npm run daily:douyin
npm run daily:weixin-channels
npm run daily:all
```

历史全量补抓：

```bash
npm run history:douyin
npm run history:douyin-public
npm run history:weixin-channels
```

下面是内部排障入口，不是普通同步入口。只有排障、新增能力或按报告恢复失败时，才直接查看内部 runner 能力：

```bash
node scripts/task-runner.js list --json
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/diagnostic-demo
```

一线命令背后仍由 runner 执行，并生成：

- `task-events.jsonl`
- `task-state.json`
- `task-report.json`
- `checkpoint.json`，仅全量或断点任务使用

这些文件是 agent 复盘、实时展示、远端同步和历史报告的主要数据来源。

## 5. 全量和断点续跑

默认任务是轻量更新。只有用户明确要求“全量、历史全部、从头抓完、一直抓到没有更多”时，才加 `--full`。

全量模式：

```bash
npm run history:douyin
```

抖音公开主页历史全量：

```bash
npm run history:douyin-public
```

视频号历史全量：

```bash
npm run history:weixin-channels
```

规则：

- `--resume` 是默认续跑语义。
- `--refresh` 表示重置旧过程数据和 checkpoint。
- `--batch-size` 控制每批数量。
- `--max-items 0` 表示不额外限制，直到平台返回没有更多。

## 6. 底层排障脚本

为了快速开发和排查，平台脚本仍然可以单独运行，但不再包装成 npm 一线菜单：

```bash
node scripts/resume-weixin-channels.js --date <YYYY-MM-DD>
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
node scripts/harvest-douyin-creator.js --date <YYYY-MM-DD>
node scripts/sync-douyin-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
node scripts/harvest-douyin.js --account target --import-scrm
```

新能力仍应优先接入统一 runner 和测试。只有确认为一线用户入口时，才增加 npm script。

## 6.1 微博专项链路

微博目前不是主线平台能力，而是一条独立专项链路。它不接 `daily:*`、`history:*`、`platform-registry`，适合做“指定用户微博列表 + 详情 + 本地媒体归档 + 飞书 Base 展示”。

最常用的几条命令：

```bash
npm run weibo:user-original-posts -- --user <uid-or-name> --limit 20
npm run weibo:harvest -- --user <uid-or-name>
npm run weibo:harvest:new -- --user <uid-or-name>
npm run weibo:harvest:history -- --user <uid-or-name>
npm run weibo:harvest -- --user <uid-or-name> --original-only
npm run weibo:harvest -- --user <uid-or-name> --original-only --resume
npm run weibo:publish:feishu -- --input-dir samples/weibo/<user> --display-tables --apply
npm run weibo:cleanup:retweets -- --apply
npm run weibo:repair:media-cache -- --user <uid> --apply
```

专项链路说明：

- `weibo:harvest --original-only` 会优先走本地原创列表器，而不是直接依赖上游 `opencli weibo user-posts`。
- `weibo:harvest:new` 会先探测最新列表，只对本地 / 飞书没见过的 `post_id` 调用主采集。
- `weibo:harvest:history` 会用本地 / 飞书里可见的最旧微博日期作为边界，按批次向旧日期补抓未见过的 `post_id`，默认最多 10 批；可用 `--max-batches` 调整。
- 微博采集默认排除转发：增量 / 历史入口会在规划阶段跳过明显转发，主采集会在详情阶段再次过滤；只有调试需要保留转发时才加 `--include-retweets`。
- `weibo:cleanup:retweets` 用来清理早期已经写入飞书的转发记录，默认 dry-run，加 `--apply` 后删除。
- 两个增量入口默认使用 `--baseline local,feishu`；离线或飞书排障时可改成 `--baseline local`。
- `weibo:harvest` 现在会在输出目录写 `checkpoint.json`，默认 `--resume` 续跑，`--refresh` 强制重抓。
- `weibo:harvest` 会在抓详情后下载正文原始媒体，不需要日常再单独跑下载命令。
- 本地媒体默认落到 `samples/weibo/<user>/media/images` 和 `samples/weibo/<user>/media/videos`，同一个账号只维护这一个本地目录。
- 飞书会同时写原始表和中文展示表；展示表附件优先上传本地 `media/` 里的原始图片。
- 本地媒体缓存丢失时，优先用 `weibo:repair:media-cache` 从飞书原始表重建本地缓存；它只下载文件，不重抓详情、不写飞书。
- 原始表会带 `collection_mode`、`original_only`，便于区分“全部微博”与“原创抓取”。

## 7. 本地 OpenCLI 工作副本

只有修改 `adapters/` 时才需要本地 OpenCLI 工作副本。

推荐目录：

```text
workspace/OpenCLI
```

首次准备：

```bash
git clone <your-opencli-repo> workspace/OpenCLI
cd workspace/OpenCLI
npm install
npm run build
cd <repo>
```

同步适配器：

```bash
node scripts/sync-adapter.js weixin-channels
node scripts/sync-adapter.js douyin
```

同步后进入 `workspace/OpenCLI` 重新构建。

## 8. 安装开发 Skills

如果这台电脑也要继续开发 OpenCLI 适配器，建议安装项目推荐的 skills：

```bash
node scripts/install-social-harvest-skills.js
```

安装后重启 Codex。它们主要用于写新平台、修 OpenCLI 命令、检查真实 Chrome 页面、搜索已有能力，以及按 `social-harvest-operator` 执行 Social Harvest 工作流。

## 9. 样例和运行产物

任务运行产物默认写到：

```text
samples/tasks/<task-id>/
```

区分两类文件：

- 固定回归样例：放在 `test-support/fixtures/`，被测试或文档点名依赖，可以提交。
- 本地运行产物：写到 `samples/`，真实抓取生成，默认不提交。

边界说明见：

- [samples/README.md](../samples/README.md)
- test-support/fixtures/README.md

## 10. Sink 写入和底层 SCRM 导入器

日常和历史主流程会先产出规范化采集文件，再由统一 sink runner 写入。默认 sink 是 `scrm`；显式 `--sink feishu` 表示只写飞书，`--sink scrm --sink feishu` 表示两个都写。

已有产物要补写 sink 时，优先使用：

```bash
npm run sink:run -- --platform <platform> --output-dir samples/tasks/<task>/<platform> --sink scrm --sink-apply
npm run sink:run -- --platform <platform> --output-dir samples/tasks/<task>/<platform> --sink feishu --dataset messages --sink-apply
```

SCRM 底层导入器仍保留给排障和兼容场景。稿件和评论导入器：

```bash
node scripts/import-to-scrm.js --platform <platform> --date <YYYY-MM-DD>
```

真正写库加：

```bash
--apply
```

私信底层导入器：

```bash
node scripts/import-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
node scripts/import-private-messages-to-scrm-message.js --platform douyin --date <YYYY-MM-DD> --apply
```

弹幕 schema 审计：

```bash
node scripts/audit-danmaku.js
```

字段和表结构见：

- [canonical-scrm-schema.md](./canonical-scrm-schema.md)
- [field-mapping-matrix.md](./field-mapping-matrix.md)

## 11. 新平台开发入口

新增平台建议先读：

- development-workflow.md
- [new-platform-checklist.md](./platforms/new-platform-checklist.md)
- templates/adapter-template/README.md

最小顺序：

1. 新建 `adapters/<platform>/`。
2. 打通最小 OpenCLI 命令。
3. 生成固定样例。
4. 接 SCRM mapper 或专用 importer。
5. 注册到 `platform-registry.js`。
6. 通过对应 npm script 或 `task-runner.js` 排障入口验证。
7. 补测试和文档。

## 12. 最短上手路径

如果只想最快进入当前主线：

1. 看 [README.md](../README.md)。
2. 看 [commands.md](./commands.md)。
3. 配好 `config.local.json`。
4. 跑 `npm run check`。
5. 跑目标平台一线任务，例如 `npm run daily:douyin`、`npm run daily:weixin-channels` 或 `npm run history:douyin`。
6. 如果失败，再按报告里的建议使用内部 runner 排障入口。
7. 看 `task-report.json`。
