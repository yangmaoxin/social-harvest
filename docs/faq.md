# 常见问题

这份 FAQ 面向 Social Harvest 当前最常见的使用和开发问题。平台内部细节放在对应平台 README 和运行手册里。

## 1. 这个项目现在到底是什么

Social Harvest 是多平台内容抓取、私信导出、SCRM 入库、飞书写入和远程进度推送的 CLI-first 采集运营工具。

它不是单纯的适配器仓库。适配器仍然在 `adapters/` 里维护，但当前主线是：

- 统一 runner
- agent-first harness
- CLI / 自动化入口
- 多平台任务和报告
- SCRM 入库闭环

## 2. 为什么还需要 OpenCLI

平台抓取仍需要 OpenCLI 连接用户自己的 Chrome 和浏览器插件。

当前仓库已经把 OpenCLI 作为项目 npm 依赖锁定，普通用户只需要在项目根目录安装依赖，不需要单独全局安装 `opencli`，也不需要准备 OpenCLI 主仓库。

开发或调试适配器时，本地 OpenCLI 工作副本通常放在：

```text
workspace/OpenCLI
```

正式交付形态是 zip / CLI-first 工作目录，不要求用户手动准备这个目录。

## 3. 用户首次安装后还需要什么

当前 CLI-first 使用方式需要：

- Node.js 24.x
- npm 依赖，通常运行 `npm install --omit=dev`
- 本机 Chrome
- OpenCLI 浏览器插件
- 平台后台登录态
- 数据库和 AI 服务配置

不需要：

- 全局 `opencli`
- 当前仓库以外的 OpenCLI 主仓库
- Python
- shell / PowerShell 编排脚本

## 4. 开发时应该优先跑什么入口

普通同步优先跑一线入口：

```bash
npm run check
npm run daily:douyin
npm run daily:weixin-channels
npm run daily:all
npm run history:douyin
npm run history:douyin-public
npm run history:weixin-channels
```

下面是内部排障入口，不是普通同步入口。只有排障、新增能力或按报告恢复失败时，才直接跑底层 Node 脚本：

```bash
node scripts/task-runner.js list --json
node scripts/task-runner.js run --task diagnostic
node scripts/task-runner.js run --platform douyin -- --work-limit 50 --comment-work-limit 50 --message-limit 50
node scripts/task-runner.js run --platform douyin --task public-content -- --account main
```

抖音当前建议直接按两种场景理解：

- 抓自己：默认走 `daily:douyin` 或 `history:douyin`。
- 抓别人：显式走公开主页历史入口 `history:douyin-public`；排障时才用 `node scripts/task-runner.js run --platform douyin --task public-content`。

新能力应先接 runner 和 CLI 文档，不新增容易误选的 npm 别名。

## 5. runner 会写哪些文件

统一 runner 会写出：

- `task-events.jsonl`
- `task-state.json`
- `task-report.json`

平台脚本可以继续输出自己的 `run-report.json`、`private-messages-report.json` 等文件；增量日常还会写 `daily-report.json`。一线汇报优先读取 `daily-report.json` 或 `task-report.json`。

## 6. 为什么不要并发跑同一个平台账号

同一个 Chrome/OpenCLI 会话被并发访问时，容易出现误判失败。不要同时启动同一账号的这些任务：

- 诊断
- 平台公开主页抓取 / 创作者中心抓取
- 私信导出
- 同账号重复运行

## 7. 为什么不再新增 shell 或 Python 编排脚本

因为CLI 工作目录 要跨 Windows/macOS 运行。Node 入口更容易统一任务状态、退出码、配置路径和错误处理。

当前规则：

- 新命令写在 `scripts/*.js`
- 只有确认为一线入口时才通过 `package.json` 暴露 npm script
- 不新增 `.sh`、`.bash`、PowerShell 或 Python 编排入口

## 8. 适配器代码改了，OpenCLI 里为什么看不到

开发环境中，适配器源码默认只在当前仓库里。修改 `adapters/` 后需要按对应平台同步到本地 OpenCLI 用户运行时或工作副本；普通用户不需要执行这一步。抖音这类用户级 runtime adapter 可能是项目需要的，不要因为看到 override 就直接 reset：

```bash
# 抖音用户级 runtime adapter
node scripts/sync-douyin-runtime-comments.js

# 通用 adapter 同步，仅在对应平台使用该路径时执行
node scripts/sync-adapter.js <platform>
cd workspace/OpenCLI
npm run build
```

## 9. 微信视频号为什么经常要先登录后台

微信视频号依赖用户自己的后台登录态。需要满足：

- Chrome 已登录微信视频号助手后台
- OpenCLI 插件连接的是这个 Chrome 会话
- 后台页面本身可正常访问

排查时先运行：

```bash
node scripts/task-runner.js run --task diagnostic -- --check-platforms --platform weixin-channels
```

## 10. 抖音现在为什么要分“抓自己”和“抓别人”

因为这两个任务的权限边界和数据语义本来就不同。

- 抓自己：默认走创作者中心全套任务，适合后台作品、评论管理、弹幕、私信和管理字段
- 抓别人：只走公开主页，适合公开作品、公开评论、公开回复

当前推荐策略见：

- [抖音数据源双方案策略](platforms/douyin-source-strategy.md)

## 11. 抖音私信现在是什么边界

当前正式范围是已登录账号本人授权可见的入站单聊消息。

规则：

- 朋友私信是主路径。
- 只采集网页端可见正文；提示“请打开抖音 app 查看”的 app-only 消息会跳过，不作为缺失。
- 自己发送的内容不入库。
- 群聊不入库。
- API 为主，DOM 用于会话切换、历史加载和方向校准。
- 不继续把“纯 API、零 DOM 依赖”作为桌面端前置条件。

详细复盘见：

- [抖音抓取难点报告](platforms/douyin-crawling-challenges-report.md)

## 12. 数据库导入默认怎么跑

面向 Social Harvest 用户时，“同步”默认就是正式采集并写入业务系统。用户不需要知道 `--apply`，也不需要先说 dry-run。

只有用户明确说“试跑”“预览”“不要写入业务系统”时，agent 才应该选择不写库入口。

下面是维护者直接操作底层命令时的对应关系。日常主线优先走统一 sink runner：

```bash
npm run sink:run -- --platform <platform> --output-dir samples/tasks/<task>/<platform> --sink scrm --sink-apply
```

稿件和评论：

```bash
node scripts/import-to-scrm.js --platform <platform> --date <YYYY-MM-DD>
```

私信：

```bash
node scripts/import-private-messages-to-scrm-message.js --date <YYYY-MM-DD>
node scripts/import-private-messages-to-scrm-message.js --platform douyin --date <YYYY-MM-DD>
```

维护者直接运行底层命令时，真正写库才加：

```bash
--apply
```

## 13. 新增平台最容易漏什么

常见遗漏：

- 平台 README
- 固定样例
- SCRM mapper
- 平台能力矩阵
- runner 注册
- 桌面端任务报告字段
- 最小测试

建议照：

- [new-platform-checklist.md](platforms/new-platform-checklist.md)

## 14. 当前最值得优先看的文档

日常开发：

1. [README.md](../README.md)
2. [getting-started.md](getting-started.md)
3. [commands.md](commands.md)
4. [agent-runbook.md](agent-runbook.md)
5. [agent-intent-routing.md](agent-intent-routing.md)

新增平台：

1. development-workflow.md
2. [new-platform-checklist.md](platforms/new-platform-checklist.md)
3. templates/adapter-template/README.md
