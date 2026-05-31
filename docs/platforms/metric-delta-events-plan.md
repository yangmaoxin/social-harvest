# Metric Delta Events Plan

这份计划用于实现“点赞+1 / 关注+1 / 分享+1”这类列表展示。

核心口径：

- 先把平台可见的计数保存成快照。
- 再从相邻快照的差值生成展示事件。
- 展示事件可以拆成多条 `+1`，但必须标记为快照差值推导，不等同于平台真实逐条动作明细。
- 本地产物只作为“本次抓取结果”的输入；所有历史基线和 delta 对比只能读取数据库里的 `scrm_metric_snapshot`，不能读取本地历史 JSON 做对比。

## 1. 目标和非目标

目标：

- 支持同一个数据库下多设备并发抓取，不生成重复展示事件。
- 已支持抖音创作者中心账号级和作品级 metric。
- 已支持微信视频号账号级和作品级 metric。
- 列表可展示多条独立的 `+1`，而不是只展示 `+4`。
- 保留原始快照，规则变化时可以重算展示事件。

非目标：

- 不承诺拿到“谁在什么时候点赞/关注/分享”的真实动作明细。
- 不在 adapter 层生成业务事件。
- 不把本功能直接塞进 `scrm_file` / `scrm_account` 的当前值覆盖逻辑里。

## 2. 数据来源口径

### 抖音优先级

账号级指标优先使用创作者中心首页/账号接口：

- `fans_count`：用于生成“关注+1”。
- `like_count`：用于生成“点赞+1”。

作品级指标使用创作者中心作品列表：

- `share_count`：用于生成“分享+1”。
- `digg_count`：仅在需要展示“某作品点赞+1”时使用。

推荐展示口径：

- 账号级 `like_count` 增长展示为“点赞+1”。
- 账号级 `fans_count` 增长展示为“关注+1”。
- 作品级 `share_count` 增长展示为“分享+1”。
- 如果作品级归因缺失，不强行编造作品标题。

### 微信视频号口径

视频号复用同一套快照和 delta 生成逻辑。

已接入：

- 账号级 `fans_count`：来自 `account-profile.json`，用于“关注+1”。
- 作品级 `like_count`：用于作品级“点赞+1”。
- 作品级 `share_count`：用于“分享+1”。

`fav_count` / `comment_count` 会进入作品快照，但当前不默认生成主列表事件。如果视频号暂时没有稳定账号级“获赞总数”，不要用作品汇总冒充账号总获赞；先只支持能稳定抓到的指标。

## 3. 后端已提供的数据表契约

后端已经完成数据库和表结构建设，Social Harvest 不负责建库建表，也不再新增 `CREATE TABLE` 执行脚本。

本节只记录本地采集、快照写入和 delta 生成逻辑依赖的表契约。开发时需要做的是确认后端环境中这些表、字段、唯一键和索引可用；如果后端字段名或索引名调整，以后端实现为准，再同步更新本计划和脚本映射。

### 3.1 `scrm_metric_snapshot`

保存平台某一时刻可见的计数快照。多设备可以并发写入，去重由 `snapshot_hash` 兜底。

本地脚本依赖字段：

- `id`
- `origin_type`
- `target_scope`
- `target_id`
- `source`
- `source_run_id`
- `device_id`
- `capture_bucket`
- `snapshot_hash`
- `fans_count`
- `like_count`
- `share_count`
- `collect_count`
- `comment_count`
- `following_count`
- `video_count`
- `captured_at`
- `raw_payload_json`
- `created_at`

本地脚本依赖约束：

- `snapshot_hash` 需要唯一约束，用于快照幂等写入。
- 需要能按 `origin_type, target_scope, target_id, captured_at` 查询目标的时间序列快照。
- 需要能按 `source_run_id` 回查某次任务写入的快照。
- 需要能按 `origin_type, target_scope, target_id, capture_bucket` 定位同一时间桶快照。

`target_scope` 约定：

- `account`：账号级指标，`target_id` 使用平台账号标识。
- `work`：作品级指标，抖音 `target_id` 使用 `aweme_id`，视频号使用作品主键。

`snapshot_hash` 建议由下面字段拼接后做 SHA-256：

```text
origin_type
target_scope
target_id
capture_bucket
fans_count
like_count
share_count
collect_count
comment_count
following_count
video_count
```

`capture_bucket` 第一版建议按 1 分钟取整。如果抓取频率较低，可以调整为 5 分钟。

### 3.2 `scrm_metric_delta_event`

保存列表真正读取的展示事件。相邻快照中某个指标净增长 `N` 时，生成 `N` 条 `+1`。

本地脚本依赖字段：

- `id`
- `origin_type`
- `target_scope`
- `target_id`
- `metric_type`
- `delta_unit`
- `from_snapshot_id`
- `to_snapshot_id`
- `window_started_at`
- `window_ended_at`
- `event_time`
- `sequence_no`
- `sequence_total`
- `display_title`
- `display_status`
- `confidence`
- `created_at`

本地脚本依赖约束：

- `from_snapshot_id, to_snapshot_id, metric_type, sequence_no` 需要唯一约束，用于 delta 事件幂等生成。
- 需要能按 `origin_type, event_time, id` 查询 feed。
- 需要能按 `origin_type, target_scope, target_id, metric_type, event_time` 查询目标指标事件。

`metric_type` 第一版约定：

- `fan`：粉丝数增长，展示为“关注+1”。
- `like`：账号获赞数或作品点赞数增长，展示为“点赞+1”。
- `share`：分享数增长，展示为“分享+1”。
- `collect`：收藏数增长，默认不进主列表。
- `comment`：评论数增长，默认不进主列表。

`display_status` 约定：

- `normal`：正常展示。
- `hidden`：保留但不展示。
- `correction`：修正记录，不作为 `+1` 通知展示。

### 3.3 `scrm_job_lock`

多设备共用同一个数据库时，抓取脚本都可以写快照，但 delta 生成最好同一时间只有一个设备跑。

本地脚本依赖字段：

- `lock_name`
- `owner_id`
- `locked_until`
- `updated_at`

本地脚本依赖约束：

- `lock_name` 需要唯一约束或主键，用于抢占同一类 delta 生成任务。

第一版锁名：

```text
metric_delta_generate:douyin:account
metric_delta_generate:douyin:work
metric_delta_generate:weixin-channels:account
metric_delta_generate:weixin-channels:work
```

锁过期时间建议 5 分钟。脚本崩溃后，其他设备可以在过期后继续生成。锁按平台和 `target_scope` 区分，是为了让 daily 主流程能连续执行账号级 delta 和作品级 delta，同时仍避免多设备同时生成同一 scope 的事件。

## 4. 本地脚本职责

adapter 只负责抓取和归一平台字段，不生成业务展示事件。

当前落地状态：

- 后端已经完成数据库和表结构建设；本项目只做表契约检查、快照写入和 delta 事件生成。
- 第一版已支持抖音账号级 `fan` / `like` delta。
- 第二版已支持抖音作品级 `share` delta。
- 第三版已提供最小 metric feed 查询脚本。
- 第四版已支持视频号账号级 `fan`、作品级 `like` / `share` delta。
- 写入前建议先跑 `node scripts/preflight-scrm.js --require-metric-db`，确认后端表、字段和唯一约束满足脚本要求。
- 默认不写库；只有显式传 `--apply` 时才会写入测试库或正式库。

已新增 Node 脚本：

```text
scripts/import-metric-snapshot-to-scrm.js
scripts/generate-metric-delta-events.js
scripts/query-metric-feed.js
```

已新增 npm scripts：

```json
{
  "metric:snapshot:write": "node scripts/import-metric-snapshot-to-scrm.js",
  "metric:delta:generate": "node scripts/generate-metric-delta-events.js",
  "metric:feed": "node scripts/query-metric-feed.js"
}
```

后端表契约检查：

```bash
node scripts/preflight-scrm.js --require-metric-db
```

抖音账号级快照 dry-run：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --date <YYYY-MM-DD>
```

抖音账号级快照正式写入：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --date <YYYY-MM-DD> --apply
```

抖音作品级快照 dry-run：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --scope work --date <YYYY-MM-DD>
```

抖音作品级快照正式写入：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --scope work --date <YYYY-MM-DD> --apply
```

视频号账号级快照 dry-run / 正式写入：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD>
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD> --apply
```

视频号作品级快照 dry-run / 正式写入：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --scope work --date <YYYY-MM-DD>
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --scope work --date <YYYY-MM-DD> --apply
```

抖音账号级 delta 事件 dry-run：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope account
```

抖音账号级 delta 事件正式写入：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope account --apply
```

抖音作品级分享 delta 事件 dry-run：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope work
```

抖音作品级分享 delta 事件正式写入：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope work --apply
```

视频号账号级 / 作品级 delta 事件 dry-run 和正式写入：

```bash
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope account
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope account --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope work
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope work --apply
```

针对单个账号验证时，可以加 `--target-id` 缩小范围：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope account --target-id <account-id> --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope account --target-id <account-id> --apply
```

针对单个作品验证时，抖音 `--target-id` 使用 `aweme_id`，视频号使用 `object_id`：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope work --target-id <aweme-id> --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope work --target-id <object-id> --apply
```

查询 feed：

```bash
node scripts/query-metric-feed.js --platform douyin --limit 50
node scripts/query-metric-feed.js --platform douyin --scope account --metric-type fan --limit 50
node scripts/query-metric-feed.js --platform douyin --scope work --metric-type share --target-id <aweme-id> --limit 50
node scripts/query-metric-feed.js --platform weixin-channels --limit 50
node scripts/query-metric-feed.js --platform weixin-channels --scope work --metric-type like --target-id <object-id> --limit 50
```

开发验收中已经用测试账号 `metric-test-account` 做过一次真实入库验证：

- 两个账号快照分别为 `fans_count=2, like_count=5` 和 `fans_count=5, like_count=9`。
- 生成 `fan` 事件 3 条，展示标题为 `关注+1`。
- 生成 `like` 事件 4 条，展示标题为 `点赞+1`。
- 复跑同一段 delta 生成后，数据库事件数量保持不变，确认唯一键幂等生效。

快照写入脚本职责：

- 不创建数据库或表结构，只写入后端已经提供的 `scrm_metric_snapshot`。
- 读取抖音 `account-profile.json` / `creator-harvest.json`，以及视频号 `account-profile.json` / `works.json`。
- `--scope account` 默认读取 `account-profile.json`。
- `--scope work` 在抖音默认读取 `creator-harvest.json`，在视频号默认读取 `works.json`。
- 计算 `capture_bucket` 和 `snapshot_hash`。
- 使用 `INSERT ... ON DUPLICATE KEY UPDATE` 幂等写入 `scrm_metric_snapshot`。
- 不直接生成 delta event。
- 不读取本地历史产物，不负责和上一次本地文件做差。

delta 生成脚本职责：

- 不创建数据库或表结构，只读取后端已经提供的快照表、事件表和锁表。
- 先抢 `scrm_job_lock`。
- 按 `origin_type + target_scope + target_id + captured_at + id` 排序读取快照。
- 只比较相邻快照。
- 所有比较都基于数据库中已经入库的快照；机器 A 今天写入、机器 B 明天写入时，机器 B 不需要机器 A 的本地 JSON 文件。
- 对 `delta > 0` 的指标拆成多条 `+1`。
- 每条 `+1` 的 `event_time` 按相邻快照时间窗口生成确定性随机时间，避免长间隔采集后所有事件挤在同一秒。
- 每条 `+1` 的 `created_at` 记录 delta 事件真实入库生成时间。
- 对 `delta = 0` 不生成事件。
- 对 `delta < 0` 不生成 `+1`，必要时只生成 `correction` 或跳过。
- 使用 `INSERT IGNORE` 或 `ON DUPLICATE KEY UPDATE id=id` 保证重跑幂等。

feed 查询脚本职责：

- 不写库，只读取后端已经提供的 `scrm_metric_delta_event`。
- 默认查询 `display_status = normal` 的事件。
- 默认按 `event_time DESC, id DESC` 排序。
- 支持按 `target_scope`、`target_id`、`metric_type`、`display_status` 和 `limit` 过滤。

## 5. 开发阶段

### Phase 1：抖音账号级快照

范围：

- 使用现有 `douyin:creator:account` 产物。
- 写入 `target_scope = account` 的 `fans_count`、`like_count`、`following_count`、`video_count`。
- 生成账号级 `fan` 和 `like` delta events。

验收：

- 同一份输入重复导入，`scrm_metric_snapshot` 不重复。
- 同一个快照窗口重复生成 delta，`scrm_metric_delta_event` 不重复。
- `fans_count +3` 生成 3 条 `fan` 事件。
- `like_count +4` 生成 4 条 `like` 事件。

### Phase 2：抖音作品级分享

范围：

- 使用现有 `douyin:creator:harvest` 产物。
- 写入 `target_scope = work` 的 `share_count`、`like_count`、`collect_count`、`comment_count`。
- 第一版只默认展示 `share` delta。

验收：

- `share_count +2` 生成 2 条 `share` 事件。
- 能通过 `target_id = aweme_id` 回查作品标题；查不到时不阻塞事件生成。
- 作品级 `like` 默认不和账号级 `like` 混合展示，避免双计数。

### Phase 3：列表查询接口或查询脚本

范围：

- 从 `scrm_metric_delta_event` 查询 feed。
- 默认展示 `display_status = normal`。
- 按 `event_time DESC, id DESC` 排序。

验收：

- 能稳定看到多条独立 `+1`。
- 能按平台、账号、指标类型过滤。
- 能区分账号级和作品级事件。

### Phase 4：视频号接入

范围：

- 复用同一套表和 delta 生成脚本。
- 已接入账号级 `fans_count`，生成 `fan` 事件。
- 已接入作品级 `like_count`、`share_count`，生成 `like` / `share` 事件。
- 账号级获赞数只有在稳定可抓后再接入，不使用作品汇总冒充账号级获赞。

验收：

- 视频号快照和抖音快照可共存，通过 `origin_type` 区分。
- 视频号事件不会影响抖音事件生成锁。
- 同一数据库多设备写入时仍保持幂等。
- 测试库已验证视频号账号 `fans_count 2 -> 4` 生成 2 条 `fan`。
- 测试库已验证视频号作品 `like_count 1 -> 3` 生成 2 条 `like`。
- 测试库已验证视频号作品 `share_count 2 -> 5` 生成 3 条 `share`。

## 6. 风险和边界

- 快照差值是净增长，不是逐条真实动作。
- 多个用户关注后又取消，净增长可能为 0，不会生成 `+1`。
- 多个设备时间不一致时，依赖 `capture_bucket` 和相邻快照排序降低重复风险。
- 抖音账号级“点赞+1”和作品级“某作品点赞+1”不能默认相加展示，否则会双计。
- 视频号当前没有稳定账号级获赞总数，所以只做账号级关注和作品级点赞 / 分享。
- 分享目前优先走作品级；如果平台提供账号级总分享数，再补账号级口径。

## 7. 推荐实现顺序

1. 确认后端已提供的 `scrm_metric_snapshot`、`scrm_metric_delta_event`、`scrm_job_lock` 字段和约束契约。
2. 增加本地启动前兼容检查：只检查表、字段、唯一约束是否满足脚本运行，不执行建表。
3. 实现抖音账号级快照导入。
4. 实现 delta 生成脚本和锁表抢锁。
5. 补抖音账号级测试：重复导入、重复生成、并发插入唯一键。
6. 接入抖音作品级分享快照。
7. 补 feed 查询。
8. 视频号账号级关注和作品级分享/点赞已落地；只在拿到稳定账号级获赞总数字段后，再评估账号级点赞。
