# 微信视频号适配器

微信视频号适配器面向 `https://channels.weixin.qq.com` 的已登录后台会话，用于抓取作品、图文、评论、回复、弹幕和私信/打招呼消息。

完整操作手册：

- [微信视频号 SCRM 操作手册](../../docs/platforms/weixin-channels-scrm-operator-guide.md)
- [视频号助手正式运行手册](../../docs/platforms/weixin-channels-assistant-runbook.md)
- [微信视频号私信流程](../../docs/platforms/weixin-channels-private-message-runbook.md)

更高层入口：

- [Getting Started](../../docs/getting-started.md)
- [Commands](../../docs/commands.md)
- [Platform Capability Matrix](../../docs/platforms/platform-capability-matrix.md)
- [Field Mapping Matrix](../../docs/field-mapping-matrix.md)

## 1. 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 账号作品流 | 可用 | 视频和图文统一进入作品队列 |
| 图文增强 | 可用 | 只补字段，不作为主识别依据 |
| 评论抓取 | 可用 | 支持一级评论 |
| 回复抓取 | 可用 | 支持二级回复 |
| 弹幕明细 | 可用 | 入库到 `scrm_danmaku` |
| 私信/打招呼消息 | 可用 | 入库到 `scrm_message` |
| SCRM 入库 | 可用 | 写入 `scrm_file`、`scrm_comment`、`scrm_danmaku`、`scrm_message` |
| 统一 runner | 可用 | `harvest`、`private-messages`、`import` |

## 2. 使用前准备

微信视频号是后台 Cookie 型适配器，不是公开 API 适配器。

运行前必须满足：

1. 用 OpenCLI 所连接的 Chrome 打开微信视频号助手后台。
2. 保持登录状态。
3. 后台页面可正常访问。
4. OpenCLI 浏览器插件可连接当前 Chrome。

如果未登录，应该先运行诊断，而不是把空结果当作正常抓取。

## 3. 日常命令

优先使用统一 runner：

```bash
npm run task:run -- --platform weixin-channels --output-dir samples/tasks/weixin-demo -- --date <YYYY-MM-DD> --refresh
npm run task:run -- --platform weixin-channels --task creator-messages --output-dir samples/tasks/weixin-messages-demo -- --message-limit 50
```

平台快捷入口：

```bash
npm run weixin-channels:assistant:run -- --date <YYYY-MM-DD>
npm run weixin-channels:assistant:run:detailed -- --date <YYYY-MM-DD> --refresh
npm run weixin-channels:assistant:messages -- --date <YYYY-MM-DD> --apply
npm run weixin-channels:assistant:account -- --date <YYYY-MM-DD>
npm run weixin-channels:assistant:danmaku -- --date <YYYY-MM-DD> --apply
```

一键联调验证：

```bash
npm run weixin-channels:verify
```

## 4. OpenCLI 命令

适配器层命令：

```bash
opencli weixin-channels posts --limit 5
opencli weixin-channels account-profile -f json
opencli weixin-channels comments '<export-id>' --limit 10 --with-replies true -f json
opencli weixin-channels harvest --limit 5 --comment-limit 20 --with-replies true -f json
opencli weixin-channels danmaku-flat --limit 5 -f json
```

图文增强命令：

```bash
opencli weixin-channels image-texts --limit 5 -f json
opencli weixin-channels image-text-harvest --limit 5 --comment-limit 20 -f json
```

日常业务优先走 npm 主流程；OpenCLI 命令主要用于适配器调试。

## 5. 输出

主流程输出：

```text
samples/weixin-channels/<date>/harvest.json
samples/weixin-channels/<date>/work-index.json
samples/weixin-channels/<date>/harvest-comments.json
samples/weixin-channels/<date>/account-profile.json
samples/weixin-channels/<date>/account-profile-report.json
samples/weixin-channels/<date>/danmaku-flat.json
samples/weixin-channels/<date>/danmaku-report.json
samples/weixin-channels/<date>/private-messages-flat.json
samples/weixin-channels/<date>/run-report.json
```

统一 runner 输出：

```text
task-events.jsonl
task-state.json
task-report.json
```

## 6. 常用参数

- `--date <YYYY-MM-DD>`：指定输出日期目录。
- `--refresh`：忽略已有产物重新抓取。
- `--post-limit N`：限制作品流候选数量。
- `--image-text-limit N`：限制图文增强候选数量。
- `--work-limit N`：合并去重后最多处理多少篇稿件。
- `--skip-image-text-list`：跳过图文增强入口。
- `--skip-danmaku`：跳过弹幕导出。
- `--skip-private-messages`：跳过私信导出。
- `--no-import-scrm`：不写 `scrm_file` / `scrm_comment`。
- `--no-import-scrm-danmaku`：导出弹幕文件，但不写 `scrm_danmaku`。
- `--no-import-scrm-message`：不写 `scrm_message`。
- `--allow-partial-import`：有稿件失败时仍允许正式入库。

## 7. 私信

私信独立入口：

```bash
npm run weixin-channels:assistant:messages -- --date <YYYY-MM-DD> --apply
```

主流程默认会在作品/评论/回复结束后导出私信。只想跑私信时用独立入口。

私信入库依赖 `scrm_message` 上的唯一约束：

```sql
UNIQUE(origin_type, comment_id)
```

## 8. 弹幕

弹幕独立入口：

```bash
npm run weixin-channels:assistant:danmaku -- --date <YYYY-MM-DD> --apply
```

主流程默认会在作品/评论/回复结束后继续导出 `danmaku-flat.json`，并尝试写入 `scrm_danmaku`。只想单独跑弹幕时用独立入口；只想单独导入时，直接复用导出的扁平文件。

弹幕入库依赖 `scrm_danmaku` 上的唯一约束：

```sql
UNIQUE(origin_type, danmaku_id)
```

## 9. 入库

作品和评论：

```bash
npm run scrm:import:weixin-channels -- --date 2026-04-15 --limit 1
npm run scrm:import:weixin-channels -- --date <YYYY-MM-DD> --apply
```

私信：

```bash
npm run scrm:import:weixin-channels-messages -- --date <YYYY-MM-DD> --apply
```

弹幕：

```bash
npm run scrm:import:weixin-channels-danmaku -- --date <YYYY-MM-DD> --apply
```

账号主体：

```bash
node scripts/import-account-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD>
node scripts/import-account-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD> --apply
```

字段映射见：

- [Field Mapping Matrix](../../docs/field-mapping-matrix.md)
- [Canonical SCRM Schema](../../docs/canonical-scrm-schema.md)

## 10. 固定样例

- harvest.json
- harvest-comments.json

固定样例日期保留真实日期，用于回归测试和文档对照。

## 11. 测试

```bash
npm run test:weixin-channels
npm test
```
