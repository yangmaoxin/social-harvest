# 抖音创作者中心合并策略

本文定义抖音前台数据与创作者中心数据进入 SCRM 前的合并规则。目标是用创作者中心补字段，而不是覆盖前台主档。

## 1. 主来源

| 数据域 | 主来源 | 规则 |
| --- | --- | --- |
| 作品身份 | `aweme_id` | 前台与创作者中心 `aweme_id` 一致时视为同一作品 |
| 作品公共主档 | 前台 | 标题、封面、分享链接、公开互动数和发布时间以前台为主 |
| 作品后台字段 | 创作者中心 | 状态、可见性、后台指标、管理侧评论数作为补充字段 |
| 评论身份 | `comment_id` | 只用真实 `comment_id` 合并评论 |
| 本人账号评论管理字段 | 创作者中心 | 评论作者 UID/sec_uid、IP、回复关系、后台互动字段优先使用创作者中心 |
| 前台独有评论/回复 | 前台 | 创作者中心没有返回的前台回复保留，不被删除 |

## 2. 禁用的合并键

不要用以下字段判断同一作品：

- `item_id`
- `creator_comment_item_id`

原因：作品管理页的 `item_id` 可能是数字 ID，评论管理页的作品 ID 可能是签名 token，二者不是稳定的跨页面主键。

## 3. 账号保护

正式写入前必须满足至少一个条件：

- 创作者中心汇总与目标前台账号已有作品存在 `aweme_id` 交集。
- 用户显式确认当前创作者中心登录态绑定到某个抖音账号。

如果两个条件都不满足，只允许生成预览报告，不允许自动补字段。

## 4. 字段策略

作品字段：

- 前台优先：`title`、`cover_url`、`share_url`、`play_count`、`digg_count`、`collect_count`、`share_count`、`publish_time`。
- 创作者中心可补空值：`title`、`cover_url`、`publish_time`。
- 创作者中心补充：`creator_type`、`visibility`、`status_value`、`metrics`、`creator_comment_count`、`creator_comment_item_id`、`creator_danmaku_count`、`creator_danmaku_item_id`。

评论字段：

- 主写来源：创作者中心评论。
- 创作者中心优先补充：`author_uid`、`author_sec_uid`、`comment_user_name`、`comment_user_photo`、`digg_count`、`reply_count`、`reply_to_comment_id`、`parent_comment_id`、`root_comment_id`。
- 前台可选补充：`ip_location`，以及 creator 当前未覆盖的公开回复缺口。
- 当前不再要求 `comment_id` 跨源直接对齐；creator-primary 主表写入默认允许只依赖 creator 评论本身运行。

## 5. 当前实现状态

当前已实现主表 dry-run 映射预览：

```bash
node scripts/preview-douyin-main-table-merge.js --input samples/douyin/<date>/creator-harvest.json
node scripts/preview-douyin-main-table-comment-merge.js --input samples/douyin/<date>/creator-harvest.json
```

带前台文件做保护校验：

```bash
node scripts/preview-douyin-main-table-merge.js \
  --input samples/douyin/<date>/creator-harvest.json \
  --front-input samples/douyin/<date>/<account-id>/harvest.json
```

如果还没有对应前台文件，但用户确认当前创作者中心登录态属于该账号，可以显式绑定：

```bash
node scripts/preview-douyin-main-table-merge.js \
  --input samples/douyin/<date>/creator-harvest.json \
  --account-bound
```

输出：

```text
creator-scrm-preview.json
creator-scrm-preview-report.json
creator-scrm-supplement-plan.json
```

报告中的 `merge_policy` 是机器可读版本，正式写库逻辑必须按该字段实现。

历史补充表导入命令已经退役。当前创作者中心正式写库只走主表和统一表导入入口。

## 6. 补字段计划

`creator-scrm-supplement-plan.json` 用于正式写入前的人工和程序校验：

- `status=blocked`：没有 `aweme_id` 交集，也没有显式账号绑定，只能预览。
- `status=ready`：通过保护校验，可以进入写入流程。
- `account_guard`：记录作品 ID 交集、未匹配作品和是否显式绑定。
- `works`：每个创作者中心作品的动作和可补字段。
- `comments`：每条创作者中心评论的动作和可补字段。
- `schema_gaps`：当前 SCRM 表结构还不能直接承载的后台字段。

当前已识别的表结构缺口：

- `scrm_file`：`creator_type`、`visibility`、`status_value`、`metrics`、`creator_comment_count`、`creator_comment_item_id`
- `scrm_comment`：`author_uid`、`author_sec_uid`

正式写入不再采用补充表方案。作品、评论、弹幕分别进入 `scrm_file`、`scrm_comment`、`scrm_danmaku`；账号、私信和指标进入各自统一目标表。

## 7. 真实验收记录

`2026-05-01` 已完成一轮真实创作者中心弹幕抓取、前台对齐、正式写库和重复写入校验：

- 创作者中心抓取样本：`3` 个作品、`21` 条评论、`33` 条弹幕行。
- 同账号前台 `harvest.json` 参与 preview 后，`account_guard` 通过，`overlap_count=3`。
- 同一份 `creator-harvest.json` 中，`33` 条弹幕行实际只有 `11` 个唯一 `danmaku_id`；统一导入 `scrm_danmaku` 时按 `danmaku_id` 去重，这是预期行为，不是漏数。
- 历史补充表写入链路已由主表和统一表导入取代。
