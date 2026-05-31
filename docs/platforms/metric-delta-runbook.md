# Metric Delta 正式运行手册

这份手册面向已经完成的 **抖音 / 视频号 metric 闭环**：

- 抖音账号级 `关注+1`、`点赞+1`
- 抖音作品级 `分享+1`
- 视频号账号级 `关注+1`
- 视频号作品级 `点赞+1`、`分享+1`
- feed 查询

事件来自相邻快照的净增长差值，会拆成多条 `+1` 用于列表展示；它不是平台真实逐条动作明细。

## 1. 前置检查

本功能不负责建库建表。后端需要已经提供下面 3 张表及唯一约束：

- `scrm_metric_snapshot`
- `scrm_metric_delta_event`
- `scrm_job_lock`

正式写入前先跑：

```bash
node scripts/preflight-scrm.js --require-metric-db
```

预期结果：

- `scrm-db-connect` 为 `ok`
- `scrm-metric-schema` 为 `ok`

如果这里失败，不要继续写入快照或生成 delta；先确认后端表结构和配置。

## 2. 抓取源数据

日常流程会自动生成并写入 metric 快照；手工排障时才需要单独准备输入文件。优先使用 `samples/tasks/<task-id>/...` 里的产物，只有直接运行底层脚本时才会看到旧式日期目录。

抖音账号级指标来自创作者中心账号产物：

```bash
node scripts/harvest-douyin-account.js --date <YYYY-MM-DD>
```

常见产物：

```text
samples/tasks/<task-id>/douyin/account-profile.json
samples/douyin/<YYYY-MM-DD>/account-profile.json
```

抖音作品级分享指标来自创作者中心作品产物：

```bash
node scripts/harvest-douyin-creator.js --date <YYYY-MM-DD>
```

常见产物：

```text
samples/tasks/<task-id>/douyin/creator-harvest.json
samples/douyin/<YYYY-MM-DD>/creator-harvest.json
```

视频号账号级关注指标来自视频号账号产物：

```bash
node scripts/harvest-weixin-channels-account.js --date <YYYY-MM-DD>
```

常见产物：

```text
samples/tasks/<task-id>/metadata/account-profile.json
samples/tasks/<task-id>/weixin-channels/account-profile.json
```

视频号作品级点赞和分享指标来自视频号作品产物：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --refresh
```

常见产物：

```text
samples/tasks/<task-id>/metadata/works.json
samples/tasks/<task-id>/weixin-channels/works.json
```

如果只是在已有样本上回放，可以跳过本节，直接使用已有样本文件。

## 3. 写入 metric 快照

先 dry-run 账号级快照：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --date <YYYY-MM-DD>
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD>
```

确认 `snapshot_rows`、`target_scope`、`snapshot_example.target_id` 正常后，再正式写入：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --date <YYYY-MM-DD> --apply
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD> --apply
```

再 dry-run 作品级快照：

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --scope work --date <YYYY-MM-DD>
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --scope work --date <YYYY-MM-DD>
```

确认 `target_scope = work` 后，再正式写入。抖音 `target_id` 是作品 `aweme_id`，视频号 `target_id` 是作品 `object_id`。

```bash
node scripts/import-metric-snapshot-to-scrm.js --platform douyin --scope work --date <YYYY-MM-DD> --apply
node scripts/import-metric-snapshot-to-scrm.js --platform weixin-channels --scope work --date <YYYY-MM-DD> --apply
```

快照写入是幂等的。同一份计数、同一个时间桶重复写入，不应该生成重复快照。

## 4. 生成 delta 事件

先 dry-run 账号级 delta：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope account
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope account
```

确认 `event_rows` 符合预期后正式写入：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope account --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope account --apply
```

再 dry-run 作品级 delta：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope work
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope work
```

抖音作品级只默认生成 `share` 类型事件；视频号作品级默认生成 `like` 和 `share` 类型事件。确认无误后正式写入：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope work --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope work --apply
```

如果只想验证单个目标，可以加 `--target-id`：

```bash
node scripts/generate-metric-delta-events.js --platform douyin --scope account --target-id <account-id> --apply
node scripts/generate-metric-delta-events.js --platform douyin --scope work --target-id <aweme-id> --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope account --target-id <account-id> --apply
node scripts/generate-metric-delta-events.js --platform weixin-channels --scope work --target-id <object-id> --apply
```

delta 生成会使用 `scrm_job_lock` 抢锁，避免多设备同时生成同一平台同一 scope 的事件。锁按平台和 `target_scope` 区分，抖音和视频号互不影响；同一平台内账号级和作品级也可以在 daily 主流程里连续运行。重复运行同一窗口时，脚本会先校验唯一键，只把缺失事件写入数据库，避免把已存在事件反复提交给数据库。

日常增量流程会给本次快照写入固定 `source_run_id`，再用 `--to-source-run-id` 只生成以本轮快照为终点的 delta 窗口；历史全量或手工回放不加这个参数时，仍可扫描全部历史快照补齐事件。

## 5. 查询 feed

查询最近 50 条抖音 metric 事件：

```bash
node scripts/query-metric-feed.js --platform douyin --limit 50
node scripts/query-metric-feed.js --platform weixin-channels --limit 50
```

只看账号关注事件：

```bash
node scripts/query-metric-feed.js --platform douyin --scope account --metric-type fan --limit 50
node scripts/query-metric-feed.js --platform weixin-channels --scope account --metric-type fan --limit 50
```

只看某个作品的作品级事件：

```bash
node scripts/query-metric-feed.js --platform douyin --scope work --metric-type share --target-id <aweme-id> --limit 50
node scripts/query-metric-feed.js --platform weixin-channels --scope work --metric-type like --target-id <object-id> --limit 50
node scripts/query-metric-feed.js --platform weixin-channels --scope work --metric-type share --target-id <object-id> --limit 50
```

默认只查询 `display_status = normal` 的事件，并按下面顺序排序：

```text
event_time DESC, id DESC
```

## 6. 最小验收标准

改 metric 代码或发包前，先跑本地 dry-run smoke：

```bash
node scripts/metric-smoke-test.js
```

这条命令只创建临时 JSON fixture，覆盖抖音 / 视频号的账号级和作品级快照、delta 预览，不连接真实数据库，也不会写入快照或事件。

跑完一轮正式流程后，至少确认：

- `metric:snapshot:write` 的 `METRIC_SNAPSHOT_APPLIED` 出现，且 `write_attempt_rows > 0`。
- `metric:delta:generate` 的 `METRIC_DELTA_APPLIED` 出现；其中 `generated_rows` 是本轮校验事件数，`inserted_rows` 是本次实际新增事件数，`duplicate_rows` 是已存在数量，`write_attempt_rows` 是实际提交给数据库的缺失事件数。
- `metric:feed` 能查到 `关注+1`、`点赞+1` 或 `分享+1`。
- 重复执行同一个 delta 生成命令后，feed 里的同一窗口事件数量不翻倍。

当前已用测试库验证过抖音：

- `fans_count 2 -> 5` 生成 3 条 `关注+1`。
- `like_count 5 -> 9` 生成 4 条 `点赞+1`。
- `share_count 4 -> 6` 生成 2 条 `分享+1`。
- 重复生成 delta 后，事件数量保持不变。

当前已用测试库验证过视频号：

- 账号 `fans_count 2 -> 4` 生成 2 条 `关注+1`。
- 作品 `like_count 1 -> 3` 生成 2 条 `点赞+1`。
- 作品 `share_count 2 -> 5` 生成 3 条 `分享+1`。
- 重复生成 delta 后，事件数量保持不变。

## 7. 当前边界

- 事件来自快照净增长，不代表平台真实逐条动作明细。
- 抖音作品级第一版只默认生成 `share`，不默认生成作品级 `like`，避免和账号级获赞双计数。
- 上一条边界只适用于抖音；视频号当前没有稳定账号级获赞总数，所以作品级可以默认生成 `like`。
- 视频号账号级只默认生成 `fan`；如果平台稳定提供账号级获赞总数，再单独接入账号级 `like`。
