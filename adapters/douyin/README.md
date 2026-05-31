# 抖音适配器

抖音适配器分成两种正式模式：

- 抓别人：公开 Web 侧作品/评论抓取
- 抓自己：已登录本人账号的创作者中心数据导出

更高层入口：

- [Getting Started](../../docs/getting-started.md)
- [Commands](../../docs/commands.md)
- [抖音当前开发计划](../../docs/platforms/douyin-development-plan.md)
- [抖音数据源双方案策略](../../docs/platforms/douyin-source-strategy.md)
- [抖音创作者中心合并策略](../../docs/platforms/douyin-creator-merge-policy.md)
- [抖音抓取难点报告](../../docs/platforms/douyin-crawling-challenges-report.md)
- [Advanced Diagnostics](../../docs/advanced-diagnostics.md)

## 1. 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 用户作品抓取 | 可用 | 通过 `sec_uid` 抓取作品 |
| 视频/图文识别 | 可用 | 归一到 `file_type` |
| 评论抓取 | 可用 | 支持一级评论和二级回复 |
| 作品级评论增强 | 可用 | 可按作品补抓评论和回复 |
| 断点续跑 | 可用 | 成功报告存在时默认复用 |
| 失败重试 | 可用 | 账号级和失败作品级重跑 |
| 私信导出 | 可用版 | API 主体 + DOM 辅助 |
| 创作者中心只读检查 | 可用 | 页面状态、登录提示、模块提示和数据结构摘要 |
| 创作者中心作品列表 | 初版可用 | 基于作品管理页 `work_list`，输出后台作品字段和指标摘要 |
| 创作者中心弹幕列表 | 初版可用 | 基于弹幕管理页 `danmaku/manage/list/`，按作品输出后台弹幕字段 |
| 创作者中心评论列表 | 初版可用 | 先读取评论管理页“选择作品”列表，再输出选中作品的后台评论字段 |
| 创作者中心汇总 | 初版可用 | 汇总后台作品和评论；ID 不一致时保留未匹配说明 |
| SCRM 入库 | 可用 | 写入 `scrm_file`、`scrm_comment`、`scrm_message` |
| 统一 runner | 可用 | 公开主页 `harvest`、创作者中心 `creator-harvest`、创作者中心私信 `private-messages`、`import` |

## 2. 能力边界

抖音私信当前正式范围：

- 已登录账号本人授权可见的数据。
- 入站单聊消息。
- 朋友私信为主路径。
- 只采集网页端可见正文；提示“请打开抖音 app 查看”的 app-only 消息会跳过，不作为缺失。
- 自己发送的内容不入库。
- 群聊不入库。

暂不作为桌面端第一版前置条件：

- 陌生人私信完整闭环。
- 纯 API 方向字段。
- 纯 API 历史翻页。
- 普通抖音号文本自动解析为 `sec_uid`。

## 3. 配置

多账号配置放在 `config.local.json`：

```json
{
  "platforms": {
    "douyin": {
      "video_limit": 10,
      "comment_limit": 10,
      "with_replies": true,
      "accounts": [
        {
          "id": "main",
          "label": "主账号",
          "sec_uid": "MS4wLjABAAAA...",
          "enabled": true
        }
      ]
    }
  }
}
```

字段说明见 [Config Reference](../../docs/config-reference.md)。

## 4. 日常命令

按模式选择统一 runner：

```bash
npm run task:run -- --platform douyin --output-dir samples/tasks/douyin-demo -- --account main --import-scrm
npm run task:run -- --platform douyin --task creator-content --output-dir samples/tasks/douyin-creator-demo -- --work-limit 50 --comment-work-limit 50
npm run task:run -- --platform douyin --task creator-messages --output-dir samples/tasks/douyin-messages-demo -- --message-limit 50
```

抖音私信同步默认抓 `全部` tab；如果只想抓某一类，可以追加 `--tab-name 朋友私信`、`--tab-name 陌生人私信` 或 `--tab-name 群消息`。

平台快捷入口：

```bash
npm run douyin:public:run -- --account target --import-scrm
npm run douyin:creator:messages -- --date <YYYY-MM-DD> --apply
npm run douyin:creator:account -- --date <YYYY-MM-DD>
npm run douyin:creator:harvest -- --date <YYYY-MM-DD>
npm run douyin:creator:inspect -- --date <YYYY-MM-DD>
```

创作者中心作品列表初版：

```bash
opencli douyin skill-creator-works -f json --limit 20
opencli douyin skill-creator-account -f json
opencli douyin skill-creator-danmaku-probe -f json
```

创作者中心弹幕列表初版：

```bash
opencli douyin skill-creator-danmaku <item_id> -f json --limit 20
opencli douyin skill-creator-danmaku auto -f json --limit 20
```

`item_id` 可先通过 `skill-creator-works` 取到；`auto` 会优先跟随当前页面选中的作品卡片，拿不到时退回作品列表第一项。

创作者中心评论列表初版：

```bash
opencli douyin skill-creator-comments auto -f json --limit 20
opencli douyin skill-creator-comments <item_id> -f json --aweme_id <aweme_id> --limit 20
```

`auto` 对应页面上的“选择作品”流程；评论管理页的作品 ID 可能不同于作品管理页的数字 ID。

创作者中心作品/评论/弹幕汇总初版：

```bash
npm run douyin:creator:harvest -- --date <YYYY-MM-DD>
opencli douyin skill-creator-harvest -f json --work_limit 20 --comment_work_limit 5
```

同步运行时适配器：

```bash
npm run douyin:sync-runtime-adapter
```

低频检查和字段排查命令见 [Advanced Diagnostics](../../docs/advanced-diagnostics.md)。

## 5. 输出

公开主页抓取输出：

```text
samples/douyin/<date>/<account-id>/harvest.json
samples/douyin/<date>/<account-id>/run-report.json
samples/douyin/<date>/index.json
```

私信输出：

```text
samples/douyin/<date>/private-messages-flat.json
samples/douyin/<date>/private-messages-report.json
```

创作者中心只读检查输出：

```text
samples/douyin/<date>/creator-center-inspect.json
samples/douyin/<date>/creator-center-api-summary.json
samples/douyin/<date>/creator-center-inspect-report.json
samples/douyin/<date>/account-profile.json
samples/douyin/<date>/account-profile-report.json
```

创作者中心只读检查默认覆盖：

```text
https://creator.douyin.com/creator-micro/home
https://creator.douyin.com/creator-micro/content/manage
https://creator.douyin.com/creator-micro/interactive/comment
https://creator.douyin.com/creator-micro/danmaku-manage/manage
https://creator.douyin.com/creator-micro/data/following/chat
```

创作者中心作品列表输出带 `data_source: "douyin_creator_center"`，并保留 `aweme_id`、`item_id`、标题、发布时间、状态、指标摘要和来源路径。

创作者中心评论列表输出带 `data_source: "douyin_creator_center"`，并保留 `comment_id`、`item_id`、评论作者、内容、时间、互动计数、回复关系和来源路径。
开启 `--with-replies` 时，创作者中心一级评论也会保留 `fetched_reply_count`、`reply_fetch_status`、`reply_fetch_error`；汇总报告会输出 `reply_fetch_status_counts`。

创作者中心弹幕列表输出带 `data_source: "douyin_creator_center"`，并保留 `danmaku_id`、`item_id`、发送者、正文、时间、点赞数、弹幕位置和来源路径。
当前弹幕抓取会优先按目标作品的明文 `aweme_id` 请求后台明细，因此 `creator-harvest.json` 中的弹幕条数应与弹幕管理页当前作品实际可见条数对齐；若页面显示 `11` 条，样本也应为 `11` 条，不再出现同一批弹幕重复挂到多条作品的情况。

创作者中心汇总输出以作品行为主，每行带 `comments`、`danmaku` 数组、`creator_comment_*` / `creator_danmaku_*` 关联字段和 `creator_harvest_summary` 摘要；评论管理或弹幕管理作品 ID 与作品管理 ID 不一致时，会用 `creator_harvest_errors` 标记。

runner 落盘文件：

```text
samples/douyin/<date>/creator-harvest.json
samples/douyin/<date>/creator-harvest-report.json
samples/douyin/<date>/creator-scrm-preview.json
samples/douyin/<date>/creator-scrm-preview-report.json
samples/douyin/<date>/creator-scrm-supplement-plan.json
```

`creator-scrm-preview*` 只做本地映射预览，不写数据库；正式写库需先确认前台与创作者中心同作品的合并策略。
当前合并策略已写入 `creator-scrm-preview-report.json` 的 `merge_policy` 字段：作品用 `aweme_id` 对齐，评论用 `comment_id` 对齐，弹幕用 `danmaku_id` 保留独立补充记录，前台公共字段为主，创作者中心补后台字段。
`creator-scrm-supplement-plan.json` 会列出账号保护结果、候选补字段和当前表结构缺口。
历史 `douyin:creator:supplement:*` 补充表链路已退役；当前正式写库走 `scrm_file`、`scrm_comment`、`scrm_danmaku`、`scrm_account`、`scrm_message` 和 metric 表入口。
如果要先按统一 `scrm_danmaku` 模型预演抖音弹幕映射，可直接运行：

```bash
npm run douyin:creator:danmaku:write -- --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --skip-intention
```

这个入口会直接读取 `creator-harvest.json` 里的 `danmaku` 数组，按统一表规则归一；其中 `no` 固定映射为 `aweme_id`。`--skip-intention` 可跳过 AI 意向分析，适合做结构预演。
正式 `--apply` 写库时不会允许 `--skip-intention`；系统必须先尝试意向分析，只有模型失败、超时或漏返回时，单条记录才会回落为 `intention=0`。

账号主体导入 `scrm_account` 时，可直接运行：

```bash
node scripts/import-account-to-scrm.js --platform douyin --date <YYYY-MM-DD>
node scripts/import-account-to-scrm.js --platform douyin --date <YYYY-MM-DD> --apply
```

真实写库时，建议按这个顺序：

```bash
npm run douyin:creator:harvest -- --date <YYYY-MM-DD>
npm run douyin:public:run -- --account <account-id> --without-replies
npm run douyin:creator:file:preview -- --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --front-input samples/douyin/<YYYY-MM-DD>/<account-id>/harvest.json
npm run douyin:creator:comment:preview -- --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --front-input samples/douyin/<YYYY-MM-DD>/<account-id>/harvest.json
npm run douyin:creator:file:write -- --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --front-input samples/douyin/<YYYY-MM-DD>/<account-id>/harvest.json --apply
npm run douyin:creator:comment:write -- --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --front-input samples/douyin/<YYYY-MM-DD>/<account-id>/harvest.json --apply
npm run douyin:creator:danmaku:write -- --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --apply
```

其中有两个真实前提需要先满足：

- `creator-scrm-preview-report.json.account_guard.passed` 必须为 `true`，或者显式加 `--account-bound`。
- 数据库中的主表和统一表结构需满足当前导入脚本校验；弹幕明细统一导入 `scrm_danmaku`。

`2026-05-01` 的真实样本里，创作者中心汇总包含 `33` 条弹幕行，但只有 `11` 个唯一 `danmaku_id`；统一导入 `scrm_danmaku` 时按 `danmaku_id` 去重属于预期行为。

统一 runner 输出：

```text
task-events.jsonl
task-state.json
task-report.json
```

## 6. 断点和重试

- 同账号、同参数下已有成功 `run-report.json` 和 `harvest.json` 时默认跳过。
- 本次增加 `--import-scrm` 或 `--import-scrm-apply` 时，会复用已有 `harvest.json` 只补入库。
- 强制重抓加 `--refresh`。
- 账号失败重试用 `--retry N`。
- 作品级评论失败样本写入 `failure-samples.json`。
- 只重跑失败作品用 `--retry-failed-work-comments`。

## 7. 作品级评论增强

```bash
npm run douyin:public:run -- --account main --with-replies --work-comments --work-comment-limit 20 --work-comment-pages 3 --work-reply-limit 10 --work-reply-pages 2
```

说明：

- `--work-comments` 开启作品级评论增强。
- `--with-replies` 开启二级回复。
- `--strict-work-comments` 可把增强失败升级成账号任务失败。
- 增强失败默认进入 warning，不阻断主作品抓取。
- 前台评论行会保留 `fetched_reply_count`、`reply_fetch_status`、`reply_fetch_error`，用于区分完整回复、部分回复和扩展回复接口降级。

## 8. 入库

公开主页抓取入库：

```bash
npm run scrm:import -- --platform douyin --date 2026-04-18 --limit 1
npm run scrm:import -- --platform douyin --input test-support/fixtures/douyin/2026-04-18/harvest.json --apply
```

私信入库：

```bash
npm run scrm:import:douyin-messages -- --date <YYYY-MM-DD> --apply
```

映射说明：

- [Field Mapping Matrix](../../docs/field-mapping-matrix.md)
- [Canonical SCRM Schema](../../docs/canonical-scrm-schema.md)

## 9. 固定样例

- harvest.json
- videos.json
- comments-flat.json

固定样例日期保留真实日期，用于回归测试和文档对照。

## 10. 测试

```bash
npm run test:douyin
npm test
```
