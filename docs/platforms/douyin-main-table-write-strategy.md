# 抖音主表写入策略

这份文档定义抖音在正式使用阶段如何处理“双抓取源、单主表写入”的问题。

目标不是取消双线抓取，而是避免：

- 前台抓取和创作者中心抓取同时直接写主表
- 两套 importer 各自 upsert，导致字段互相覆盖
- 同一条作品 / 评论 / 弹幕在不同入口里出现不同口径

一句话规则：

- **抓取层允许双线**
- **主表写入层只允许单口**
- **抓自己：创作者中心主，前台辅**
- **抓别人：前台唯一主线**

## 1. 场景分流

### 1.1 抓自己

定义：

- 当前登录态属于本人账号
- 允许访问创作者中心
- 目标是拿后台管理数据、私信、弹幕、后台指标

来源规则：

- 主来源：创作者中心
- 辅来源：公开主页

公开主页在这个场景下只承担：

- 公开字段补充
- `account_guard`
- 异常校验

### 1.2 抓别人

定义：

- 目标账号不是当前创作者中心登录态对应账号
- 只研究公开作品和公开互动

来源规则：

- 唯一来源：公开主页
- 不读取创作者中心
- 不走后台补充表逻辑

## 2. 总体写入原则

### 2.1 抓取层双线，写入层单口

允许：

- 前台产出 `harvest.json`
- 创作者中心产出 `creator-harvest.json`

不允许：

- 前台 importer 直接写主表
- 创作者中心 importer 也直接写同一张主表

正式目标应该是：

1. 前台抓取先落样本
2. 创作者中心抓取先落样本
3. 统一交给抖音 merge/import 层
4. 由 merge/import 决定主表如何落库

### 2.2 主来源优先，但空值不能覆盖非空值

如果自己账号场景中创作者中心是主来源，则：

- 创作者中心的非空字段优先
- 但创作者中心空值不能把前台已有非空值抹掉

基础规则：

- 主来源非空 > 辅来源非空
- 非空 > 空
- 新鲜值 > 陈旧值

### 2.3 来源信息要可追溯

主表记录至少要能回答：

- 当前主要来源是谁
- 最近一次更新是谁触发的

维护实现时建议保留最少的来源痕迹，例如：

- `primary_source`
- `last_source`
- `source_updated_at`

如果当前主表不扩字段，也至少要在导入报告或任务产物里保留这类信息。

## 3. 各主表归属

### 3.1 `scrm_file`

#### 自己账号

- 主写来源：创作者中心
- 前台角色：补公开字段

创作者中心优先字段：

- 后台状态
- 可见性
- 后台统计
- 管理字段

前台补充字段：

- 公开分享链接
- 公开展示文案
- 公开页展示字段

当前 `scrm_file` 冲突字段裁决表已经定成：

| 字段 | 当前裁决 | 理由 |
| --- | --- | --- |
| `title` | 前台非空优先，创作者中心补空 | 公开主页标题更贴近对外展示文案 |
| `front_img_url` | 前台非空优先，创作者中心补空 | 公开主页封面更贴近真实对外展示 |
| `public_at` | 前台非空优先，创作者中心补空 | 对外发布时间以公开页展示为准 |
| `duration` | 创作者中心非 0 优先，否则回退前台 | 后台通常更稳，但公开视频时长可补后台的 `0` |
| `count_play` | 创作者中心非 0 优先，否则回退前台 | 前台实测常出现 `0`，不能覆盖后台播放数 |
| `count_comment` | 创作者中心非 0 优先，否则回退前台 | 后台评论数优先 |
| `count_danmaku` | 创作者中心非 0 优先，否则回退前台 | 弹幕数以创作者中心为准 |
| `count_collect` / `count_like` / `count_fav` / `count_share` | 创作者中心非 0 优先，否则回退前台 | 互动统计统一按后台优先处理 |
| `file_type` | 创作者中心归一化结果优先 | 避免前台缺失或类型口径漂移误判 |

真实双源预演里，当前最集中的冲突字段是：

- `count_play`
- `front_img_url`
- 少量 `title`
- `duration`

这几项已经有明确裁决，不再属于“未定规则”。

#### 别人账号

- 前台唯一主写

### 3.2 `scrm_comment`

#### 自己账号

- 当前策略：创作者中心优先，前台补充
- 暂不建议立即删掉前台评论写入能力

当前真实 preview 结论：

- 同账号样本 `account_guard` 已通过，作品 `aweme_id` 交集是 `4/4`。
- 创作者中心评论 `29` 条，前台较完整样本评论 `27` 条。
- 两边 `comment_id` 仍然是 `0` 重合，不能直接拿来做跨源 merge 主键。
- 但按 `work_no + content + created_at + reply_layer` 的语义键已经能对齐 `27` 条。
- 剩余 `2` 条差异都是创作者中心独有回复，说明当前前台主要弱在回复层，而不是一级评论面。

创作者中心优先字段：

- 评论主记录
- `comment_user_name`
- `comment_user_photo`
- UID / sec_uid
- 管理侧互动字段

前台补充字段：

- `ip_location`
- 公开回复缺口

当前建议的正式运行方式：

- **creator-only 默认主线**：不依赖前台评论即可正式写入 `scrm_comment`
- **public IP supplement 可选增强**：只有显式提供前台样本并开启 IP 补充时，才用语义匹配把 `ip_location` 补进 creator 评论
- 报告层默认展示这次评论写入的 IP 状态：
  - 是否启用前台 IP 补充
  - 当前“有 IP / 缺 IP”的条数
  - 可语义补位的评论候选数

如果要按当前正式主线直接操作，而不是继续看策略说明，改看：

- [抖音自己账号正式运行手册](./douyin-self-runbook.md)

因此，`scrm_comment` 的下一步不应继续强依赖 `comment_id` 对齐，而应优先评估：

1. 创作者中心主写 + 前台只补 IP / 回复缺口；
2. 或基于语义键的双源对齐策略。

#### 别人账号

- 前台唯一主写

### 3.3 `scrm_danmaku`

#### 自己账号

- 创作者中心唯一主写

说明：

- 当前真实链路已经跑通
- 页面可见条数、样本条数、主表条数已经对齐
- 正式写库时不允许主动 `--skip-intention`

#### 别人账号

- 当前不正式接入
- 前台探针保留研究和校验价值

### 3.4 `scrm_message`

#### 自己账号

- 创作者中心唯一主写

#### 别人账号

- 不适用

## 4. 现有 importer 的职责

### 4.1 公开主页抓取

入口：

- `node scripts/harvest-douyin.js`
- `node scripts/task-runner.js run --platform douyin --task public-content`

当前职责：

- 抓别人：正式主线
- 抓自己：公开字段补充、校验、账号保护辅助

维护要求：

- 继续负责样本产出
- 不应在“自己账号 + 创作者中心主线”场景下单独成为主表唯一真相

### 4.2 创作者中心抓取

入口：

- `node scripts/harvest-douyin-creator.js`
- `node scripts/task-runner.js run --platform douyin --task creator-content`
- `node scripts/preview-douyin-main-table-merge.js`
- `node scripts/import-douyin-main-table-file-to-scrm.js`

当前职责：

- 产出作品、评论、弹幕的后台样本
- 作为“抓自己”主来源
- 提供 `scrm_file` / `scrm_comment` 主表 merge 预演和正式写库入口

维护要求：

- 继续优先承接自己账号的作品、评论、弹幕主记录

### 4.3 历史补充表链路

`scrm_douyin_creator_work` / `scrm_douyin_creator_comment` 曾用于保存创作者中心后台专有字段。

当前默认抖音创作者中心链路已经收敛到主表和统一表：

- 作品写入 `scrm_file`
- 评论写入 `scrm_comment`
- 弹幕写入 `scrm_danmaku`
- 账号写入 `scrm_account`
- 私信写入 `scrm_message`
- 指标写入 metric 表

因此补充表写入入口已经退役，不再作为当前业务链路的一部分。

### 4.4 统一弹幕 importer

入口：

- `node scripts/import-danmaku-to-scrm.js --platform douyin`

当前职责：

- 读取 `creator-harvest.json`
- 正式写入 `scrm_danmaku`
- 正式 `--apply` 时必须尝试意向分析

长期定位：

- 继续保留为抖音弹幕唯一正式写入口

## 5. 实施顺序

### Phase A：先固定规则

先统一认知：

- 抓取允许双线
- 主表写入只允许单口
- 自己账号优先创作者中心
- 别人账号只走前台

### Phase B：先固定弹幕和私信

这两块已经相对稳定：

- `scrm_danmaku`：创作者中心唯一主写
- `scrm_message`：创作者中心唯一主写

### Phase C：作品主表切到创作者中心优先

目标：

- 自己账号场景中，`scrm_file` 逐步由创作者中心主写
- 前台改为补公开字段

当前已落地：

- `node scripts/preview-douyin-main-table-merge.js`
- `node scripts/import-douyin-main-table-file-to-scrm.js`
- `preview-main-table` 负责预演 `scrm_file`，输出最终作品行和字段来源
- `import-main-table-file` 复用同一套 `account_guard` 和字段裁决规则，正式写入 `scrm_file`
- 产物内已包含机器可读的 `field_resolution_policy`
- `npm run daily:douyin` 已默认走增量日常；平台采集产物由 `sink-runner` 统一写入 `sink: scrm` / `sink: feishu`

### Phase D：评论最后切

原因：

- 前台和创作者中心评论面仍有差异
- 回复覆盖还需要继续观察
- 同账号真实样本里评论 `comment_id` 目前 `0` 重合，不能直接沿用作品主表那套身份合并思路
- 创作者中心评论现在已经能稳定给出 `comment_user_name`、`comment_user_photo`；`ip_location` 仍需要前台补充
- 当前已经落地：
  - `node scripts/preview-douyin-main-table-comment-merge.js`
  - `node scripts/import-douyin-main-table-comment-to-scrm.js`
  - `creator-only` 默认可正式写库
  - 只有显式开启 `--supplement-public-ip` 时，才用前台样本补 `ip_location`
  - `npm run daily:douyin` 已默认按增量计划定向抓评论；完整慢速链路保留为 `npm run daily:douyin:full`

所以评论不建议先于作品做彻底切换。

## 6. 当前结论

当前建议正式定稿为：

### 自己账号

- `scrm_file`：创作者中心主写，前台补充
- `scrm_comment`：创作者中心优先，前台补充
- `scrm_danmaku`：创作者中心唯一主写
- `scrm_message`：创作者中心唯一主写

### 别人账号

- `scrm_file`：前台主写
- `scrm_comment`：前台主写
- `scrm_danmaku`：不接入别人账号主线
- `scrm_message`：不适用

这就是当前代码维护和 importer 收口的基准方案。
