# 抖音弹幕统一入库方案

这份文档定义抖音弹幕如何进入统一 SCRM 模型。

当前现状：

- 视频号助手弹幕已经正式写入 `scrm_danmaku`。
- 抖音创作者中心弹幕已经可抓取、可去重、可正式写入 `scrm_danmaku`。
- 历史创作者中心补充表写入链路已经退役。
- 抖音作品级后台字段保留在本地创作者中心产物和预览报告中，不再写专属补充表。

当前目标不是继续扩一套抖音专属弹幕明细模型，而是把**跨平台共性**收敛到 `scrm_danmaku`，把**作品级后台增强**保留在创作者中心补充层。

## 1. 结论

推荐方案：

- 不再保留 `scrm_douyin_creator_work` 作为业务库目标表
- 抖音弹幕逐条明细统一写入 `scrm_danmaku`
- 逐步退役 `scrm_douyin_creator_danmaku`

这意味着当前职责划分为：

- `scrm_file`：作品级标准字段
- `scrm_danmaku`：跨平台统一弹幕明细

## 2. 为什么可以退掉弹幕补充表

当前仓库里，`scrm_douyin_creator_danmaku` 的主要作用是：

- 承接创作者中心导入脚本的写入目标
- 保存抖音后台特有字段
- 作为真实写库验证样本的落地点

但目前没有明显的读侧依赖把它当成主数据面：

- 没有桌面端页面直接消费这张表
- 没有通用报表直接依赖这张表
- 没有统一查询层把它当成唯一弹幕来源

换句话说，它更像“验证阶段的专用明细表”，而不是产品化后的长期主表。

## 3. 为什么作品级补字段不再单独落库

以下字段仍会出现在创作者中心本地产物和预览报告中：

- `creator_danmaku_count`
- `creator_danmaku_item_id`

原因：

- 它们属于作品级后台管理信息，不是逐条弹幕正文的一部分
- 它们和创作者中心页面管理动作直接相关
- 即使弹幕明细统一进 `scrm_danmaku`，作品级统计和回跳能力仍然有价值

这部分字段不再要求进入专属补充表；如后续业务明确需要查询，再评估是否进入统一主表或 metric 表。

## 4. 统一后的数据模型

### 4.1 统一主表

抖音弹幕进入 `scrm_danmaku` 时，标准字段只保留跨平台共性：

- `danmaku_id`
- `origin_type`
- `no`
- `comment_user_name`
- `comment_user_photo`
- `content`
- `intention`
- `video_timestamp_ms`
- `video_timestamp_text`
- `status`
- `created_at`

其中：

- `origin_type = 2`
- `no = aweme_id`

### 4.2 作品级后台字段

`creator_danmaku_count`、`creator_danmaku_item_id` 仍保留在本地创作者中心产物和预览报告中，不再写入专属补充表。

### 4.3 不再保留为长期主结构

已退役写入：

- `scrm_douyin_creator_danmaku`

## 5. 抖音字段到统一弹幕表的映射

| 抖音创作者中心字段 | 统一字段 | 说明 |
| --- | --- | --- |
| `danmaku_id` | `danmaku_id` | 主键 |
| `aweme_id` | `no` | 稿件主键位，统一固定为 `aweme_id` |
| `author` | `comment_user_name` | 作者昵称 |
| `avatar_url` | `comment_user_photo` | 作者头像 |
| `text` | `content` | 弹幕正文 |
| `video_position_seconds` | `video_timestamp_ms` | 乘以 `1000` 后写入 |
| `video_time` | `video_timestamp_text` | 原样保留显示值 |
| `time` / `create_time` | `created_at` | 统一格式化 |
| 固定值 | `origin_type` | 抖音为 `2` |
| 固定值 | `status` | 当前建议写 `1` |
| 固定值/分析器 | `intention` | 当前可先保留 `0` |

## 6. 不进入统一主表的字段

以下字段不再要求保留专门的逐条补充表承接：

- `item_id`
- `author_uid`
- `author_sec_uid`
- `digg_count`
- `video_position_seconds` 的原始秒值
- `source_url_path`

处理原则：

- 如果只是“抓取阶段调试”需要，可继续存在于原始 JSON 产物里
- 如果出现明确业务消费场景，再评估是否给 `scrm_danmaku` 扩字段或单独补旁表

当前没有证据表明这些字段已经构成必须长期保留一张专用明细表的理由。

## 7. 迁移阶段

### Phase A：方案确认

确认下面三件事：

- 作品级后台字段保留在本地产物和预览报告中
- 抖音弹幕统一进入 `scrm_danmaku`
- `scrm_douyin_creator_danmaku` 不再作为长期主结构

### Phase B：先做 dry-run 预览

新增或扩展抖音弹幕到 `scrm_danmaku` 的预演入口，先不写库，只输出：

- 标准化后的弹幕记录
- 去重前后数量
- 缺字段告警

验收点：

- `creator-harvest.json` 能稳定映射成 `scrm_danmaku` 记录
- 重复 `danmaku_id` 会去重
- `no` 一律落成 `aweme_id`

当前入口：

```bash
node scripts/import-danmaku-to-scrm.js --platform douyin --input samples/douyin/<YYYY-MM-DD>/creator-harvest.json --skip-intention
```

说明：

- `--skip-intention` 仅用于 dry-run 结构预演与样本排查。
- 正式 `--apply` 写库必须尝试意向分析；若分析过程超时、失败或漏返回，才允许单条记录回落为 `intention=0`。

### Phase C：正式写入统一表

扩展统一弹幕导入器，让它支持 `douyin`：

- `origin_type = 2`
- `work_no = aweme_id`
- 时间统一映射

验收点：

- 重复执行同一份输入不会重复插入
- `UNIQUE(origin_type, danmaku_id)` 生效
- `scrm_danmaku` 中抖音记录数与去重后的弹幕数一致

`2026-05-02` 已完成真实验证并在同日修正创作者中心弹幕目标映射：

- 输入样本：当日真实创作者中心汇总产物 `creator-harvest.json`
- 创作者中心汇总：`11` 条弹幕行
- 实际页面：弹幕管理页对应作品可见 `11` 条弹幕
- 写入候选：`11` 条唯一 `danmaku_id`
- 正式写入后，`okrtest.scrm_danmaku` 从 `2` 条视频号弹幕增长到 `13` 条总记录，其中：
  - `origin_type = 1`：`2`
  - `origin_type = 2`：`11`
- 对同一份输入重复执行 `--apply` 后，总行数保持不变，说明统一表写入已经具备幂等性
- 抓取层修复点：`danmaku/manage/list` 现在优先使用目标作品的明文 `aweme_id` 请求，不再把同一批弹幕重复挂到多个作品

### Phase D：退役旧表写入

`2026-05-02` 已完成：

- 停止向 `scrm_douyin_creator_danmaku` 写入
- 作品级后台字段保留在本地产物和预览报告中
- 更新文档、命令说明和测试口径

### Phase E：回收旧表

`2026-05-02` 已完成 `okrtest` 实库回收：

- 删除 `scrm_douyin_creator_danmaku`
- 删除前后 `scrm_danmaku` 保持：
  - `origin_type = 1`：`2`
  - `origin_type = 2`：`11`
- 说明旧表回收没有影响统一弹幕主表

## 8. 验收标准

满足以下条件时，可以认为统一完成：

1. 同一份真实抖音创作者中心样本写入 `scrm_danmaku` 后，条数等于唯一 `danmaku_id` 数量
2. 重复执行 `--apply` 不新增行
3. 作品级后台统计继续可在本地产物和预览报告中查看
4. 文档、命令、测试都不再把 `scrm_douyin_creator_danmaku` 当成主链路

## 9. 风险和回滚

### 风险

- 统一表不会保留全部抖音后台专属增强字段
- 如果业务需要分析 `author_uid/sec_uid`，可能需要重新补充结构

### 回滚策略

如果统一后发现确实需要逐条保留抖音后台增强字段：

- 可以恢复 `scrm_douyin_creator_danmaku` 的写入
- 但仍保持 `scrm_danmaku` 作为通用主表

也就是说，回滚优先是“恢复双写”，而不是推翻统一主表思路。
