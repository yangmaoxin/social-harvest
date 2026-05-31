# SCRM 标准数据模型

这份文档定义“抓取结果最终如何进入数据库”的标准模型。

目标不是替代平台适配器字段，而是明确：

1. 各平台适配器可以保留自己的平台字段
2. 所有平台最终都要映射到统一的 SCRM 入库字段
3. 通用导入器只认标准字段，不直接关心平台细节

如果你还想看“平台字段和数据库字段之间逐项怎么对应”，再配合看：

- [field-mapping-matrix.md](./field-mapping-matrix.md)

## 当前数据库表

当前数据库里实际存在三张目标表：

- `scrm_file`
- `scrm_comment`
- `scrm_message`

如果开始把账号主体正式入库，建议新增第 4 张表：

- `scrm_account`

如果开始把弹幕明细正式入库，建议新增第 5 张表：

- `scrm_danmaku`

已确认字段如下。

当前数据库层约束：

- `scrm_file` 依赖联合唯一：`UNIQUE(no, origin_type)`
- `scrm_comment` 依赖联合唯一：`UNIQUE(origin_type, comment_id)`
- `scrm_message` 适合依赖联合唯一：`UNIQUE(origin_type, comment_id)`
- `scrm_account` 建议依赖联合唯一：`UNIQUE(origin_type, account_id)`
- `scrm_danmaku` 建议依赖联合唯一：`UNIQUE(origin_type, danmaku_id)`

### `scrm_account`（建议新增）

- `id`
- `account_id`
- `origin_type`
- `account_name`
- `account_photo`
- `profile_url`
- `fans_count`
- `raw_payload_json`
- `created_at`
- `updated_at`

### `scrm_file`

- `id`
- `no`
- `origin_type`
- `account_id`
- `duration`
- `title`
- `front_img_url`
- `share_url`
- `count_collect`
- `count_comment`
- `count_play`
- `count_danmaku`
- `count_like`
- `count_fav`
- `count_share`
- `public_at`
- `status`
- `created_at`
- `file_type`

### `scrm_comment`

- `id`
- `comment_id`
- `origin_type`
- `account_id`
- `comment_user_name`
- `comment_user_photo`
- `content`
- `intention`
- `no`
- `parent_comment_id`
- `root_parent_id`
- `reply_to`
- `reply_to_comment_id`
- `count_agree`
- `status`
- `created_at`

### `scrm_message`

- `id`
- `comment_id`
- `account_id`
- `comment_user_name`
- `comment_user_photo`
- `content`
- `origin_type`
- `intention`
- `created_at`

### `scrm_danmaku`（建议新增）

- `id`
- `danmaku_id`
- `origin_type`
- `account_id`
- `no`
- `comment_user_name`
- `comment_user_photo`
- `content`
- `intention`
- `video_timestamp_ms`
- `video_timestamp_text`
- `status`
- `created_at`

推荐建表 SQL：

- [scrm-account.sql](./sql/scrm-account.sql)
- [scrm-danmaku.sql](./sql/scrm-danmaku.sql)

## `no` 字段约束

`no` 不是展示编号，也不是平台局部 ID；它在标准模型里统一表示**稿件主键位**。

约束如下：

- `scrm_file.no`：稿件自身主键。
- `scrm_comment.no`：评论所属稿件主键。
- `scrm_danmaku.no`：弹幕所属稿件主键。

按平台映射时：

- 微信视频号：统一使用作品主键，例如 `object_id` / `export_id` 所归一后的稿件主键。
- 抖音：统一使用 `aweme_id`。

特别说明：

- 抖音的 `item_id`、`creator_comment_item_id`、`creator_danmaku_item_id` 都不是标准层里的稿件主键位，不能写入 `no`。
- 如果平台存在多个页面 ID，只能选择跨链路稳定、能和作品主档对齐的那个主键进入 `no`。

## 推荐分层

建议新增平台都遵循下面三层：

### 第一层：平台原始层

保留接口返回语义。

例如：

- 微信视频号：`object_id`
- 抖音：`aweme_id`

### 第二层：平台适配层

由适配器输出对业务更友好的字段，但仍保留平台语义。

例如：

- `cover_url`
- `avatar_url`
- `comment_count`
- `share_count`

### 第三层：数据库标准层

最终统一映射到下面这三类记录：

- `scrm_file`
- `scrm_comment`
- `scrm_message`

如果要保留弹幕逐条明细，再额外映射到：

- `scrm_danmaku`

如果要把创作者主体账号正式入库，再额外映射到：

- `scrm_account`

## 标准作品记录

所有平台最终都应被转换成如下结构：

```json
{
  "video_no": "string",
  "origin_type": 1,
  "account_id": "string",
  "duration": 0,
  "title": "string",
  "front_img_url": "https://...",
  "share_url": "https://...",
  "count_collect": 0,
  "count_comment": 0,
  "count_play": 0,
  "count_danmaku": 0,
  "count_like": 0,
  "count_fav": 0,
  "count_share": 0,
  "public_at": "<YYYY-MM-DD HH:mm:ss>",
  "status": 1,
  "created_at": "<YYYY-MM-DD HH:mm:ss>",
  "file_type": 1
}
```

落库时：

- `video_no -> scrm_file.no`
- `origin_type -> scrm_file.origin_type`
- `account_id -> scrm_file.account_id`
- 其中抖音必须使用 `aweme_id -> video_no -> scrm_file.no`
- 微信视频号视频抓取写 `file_type = 1`
- `share_url -> scrm_file.share_url`；视频号导入时如果数据库已有同一 `origin_type + no` 的 `share_url`，直接复用，不再重新生成短链
- 抖音按归一化结果写 `file_type`：视频为 `1`，无视频且有图片时为 `2`

## 标准评论记录

所有平台最终都应被转换成如下结构：

```json
{
  "comment_id": "string",
  "origin_type": 1,
  "account_id": "string",
  "comment_user_name": "string",
  "comment_user_photo": "https://...",
  "content": "string",
  "video_no": "string",
  "parent_comment_id": "string",
  "root_parent_id": "string",
  "reply_to": "string",
  "reply_to_comment_id": "string",
  "count_agree": 0,
  "status": 1,
  "created_at": "<YYYY-MM-DD HH:mm:ss>"
}
```

落库时：

- `video_no -> scrm_comment.no`
- `origin_type -> scrm_comment.origin_type`
- `account_id -> scrm_comment.account_id`
- 其中抖音必须使用 `aweme_id -> video_no -> scrm_comment.no`

## 标准私信记录

当前微信视频号私信最终统一映射到如下结构：

```json
{
  "comment_id": "string",
  "account_id": "string",
  "comment_user_name": "string",
  "comment_user_photo": "https://...",
  "content": "string",
  "origin_type": 1,
  "intention": 0,
  "created_at": "<YYYY-MM-DD HH:mm:ss>"
}
```

落库时：

- `comment_id -> scrm_message.comment_id`
- `account_id -> scrm_message.account_id`
- `comment_user_name -> scrm_message.comment_user_name`
- `comment_user_photo -> scrm_message.comment_user_photo`
- `content -> scrm_message.content`
- `origin_type -> scrm_message.origin_type`
- `intention -> scrm_message.intention`
- `created_at -> scrm_message.created_at`

## 标准账号记录

纯接口账号采集结果建议统一映射到如下结构：

```json
{
  "account_id": "平台对外唯一账号标识，例如抖音号 / 视频号ID",
  "origin_type": 1,
  "account_name": "string",
  "account_photo": "https://...",
  "profile_url": "https://...",
  "fans_count": 0,
  "raw_payload_json": "{\"platform\":\"...\"}",
  "created_at": "<YYYY-MM-DD HH:mm:ss>",
  "updated_at": "<YYYY-MM-DD HH:mm:ss>"
}
```

落库时：

- `account_id -> scrm_account.account_id`
- `account_id` 建议直接使用平台前台/后台一致展示的唯一账号标识
- `origin_type -> scrm_account.origin_type`
- `account_name -> scrm_account.account_name`
- `account_photo -> scrm_account.account_photo`
- `profile_url -> scrm_account.profile_url`
- `fans_count -> scrm_account.fans_count`
- 平台特有稳定标识，例如抖音 `sec_uid`、视频号 `finder_username`，建议保留在 `raw_payload_json`

## 标准弹幕记录

建议把弹幕明细统一映射到如下结构：

```json
{
  "danmaku_id": "string",
  "origin_type": 1,
  "account_id": "string",
  "video_no": "string",
  "comment_user_name": "string",
  "comment_user_photo": "https://...",
  "content": "string",
  "intention": 0,
  "video_timestamp_ms": 14000,
  "video_timestamp_text": "00:14",
  "status": 1,
  "created_at": "<YYYY-MM-DD HH:mm:ss>"
}
```

落库时：

- `danmaku_id -> scrm_danmaku.danmaku_id`
- `origin_type -> scrm_danmaku.origin_type`
- `account_id -> scrm_danmaku.account_id`
- `video_no -> scrm_danmaku.no`
- 其中抖音必须使用 `aweme_id -> video_no -> scrm_danmaku.no`

设计取舍：

- 继续沿用 `comment_user_name` / `comment_user_photo` / `content` / `intention` / `created_at` 这套命名，和 `scrm_comment`、`scrm_message` 保持同一语言
- 不复用 `comment_id`，改用更明确的 `danmaku_id`，避免和普通评论、私信混淆
- 同时保留 `video_timestamp_ms` 和 `video_timestamp_text`
  前者适合排序、过滤和程序计算，后者适合直接展示
- 继续使用 `no` 关联作品表，和 `scrm_comment.no -> scrm_file.no` 的风格保持一致
- `scrm_file.count_danmaku` 继续承担作品级聚合计数，`scrm_danmaku` 负责逐条弹幕明细

## 平台映射建议

## 当前 AI 意向标准

评论和私信统一使用：

- `0 未分析`
- `1 无意向`
- `2 低意向`
- `3 中意向`
- `4 高意向`

当前业务口径：

- `1`
  无关 / 无需求：夸视频、夸作者、表情、玩梗、打招呼、路人互动、冲流量标签、无关闲聊、纯负面但无咨询行为、历史用户单纯吐槽或明确不续费
- `2`
  认知了解：问功能、原理、用途、疾病、科普、产品区别、行业泛讨论、轻度好奇或泛泛质疑
- `3`
  购买评估：问价格、收费、优惠、套餐、分期、有没有必要、值不值、要不要存、靠不靠谱、怕被坑、家里纠结、想了解或正在考虑
- `4`
  行动推进：明确想买、想办、想存、询问办理流程、私信/留联系方式/销售跟进、地区或医院落地咨询、临产/住院/过几天生、病史驱动下继续咨询、续费或二胎继续存

当前规则以购买阶段为准，不只按关键词判断；同时出现多个信号时取最高等级。普通“智商税吗 / 靠谱吗”这类泛泛质疑默认是 `2`，但如果围绕本人是否购买、价格、办理或临产等现实决策，则升为 `3` 或 `4`。历史存过不直接等于 `4`，只有当前再次推进、续费、二胎继续存或继续咨询才提高等级。

当前实现支持模型池顺序尝试；前一个模型无响应或报错时，自动切下一个。

### 微信视频号

视频：

- `object_id -> no`
- `cover_url -> front_img_url`
- `share_url -> share_url`；缺失时正式入库会用 `object_id + object_nonce` 生成视频短链，数据库已有则不生成
- `comment_count -> count_comment`
- `view_count -> count_play`
- `like_count -> count_like`
- `fav_count -> count_fav`
- `share_count -> count_share`
- `publish_time -> public_at`

评论：

- `author -> comment_user_name`
- `avatar_url -> comment_user_photo`
- `text -> content`
- `export_id -> no`
- `root_comment_id -> root_parent_id`
- `reply_comment_id -> reply_to_comment_id`
- `like_count -> count_agree`
- `time -> created_at`

私信：

- `message_id -> comment_id`
- `sender_name -> comment_user_name`
- `sender_avatar_url -> comment_user_photo`
- `text -> content`
- 固定平台值 -> `origin_type`
- `intention` 编码：`0 未分析 / 1 无意向 / 2 低 / 3 中 / 4 高`
- `time -> created_at`

弹幕：

- `bulletCommentId -> danmaku_id`
- `exportId/objectId -> no`
- `userInfo.nickname -> comment_user_name`
- `userInfo.headImgUrl -> comment_user_photo`
- `content -> content`
- 固定平台值 -> `origin_type`
- `intention` 编码：`0 未分析 / 1 无意向 / 2 低 / 3 中 / 4 高`
- `videoTimestampMs -> video_timestamp_ms`
- 派生展示值 -> `video_timestamp_text`
- `createTime/time -> created_at`

### 抖音

视频：

- `aweme_id -> no`
- `cover_url -> front_img_url`
- `share_url/video_link/short_url -> share_url`
- `comment_count -> count_comment`
- `play_count/view_count -> count_play`
- `digg_count/like_count -> count_like`
- `share_count -> count_share`
- `create_time/publish_time -> public_at`

评论：

- `author -> comment_user_name`
- `avatar_url -> comment_user_photo`
- `text -> content`
- `aweme_id -> no`
- `parent_comment_id -> parent_comment_id`
- `root_parent_id -> root_parent_id`
- `reply_to -> reply_to`
- `reply_to_comment_id -> reply_to_comment_id`
- `digg_count/like_count -> count_agree`
- `time -> created_at`

## 实现建议

推荐使用下面的结构：

```text
scripts/
  import-to-scrm.js
  import-private-messages-to-scrm-message.js
  lib/
    scrm-base.js
    scrm-mappers.js
```

职责划分：

- `import-to-scrm.js`
  通用入口、dry-run、apply、校验报告
- `import-private-messages-to-scrm-message.js`
  微信视频号私信导入 `scrm_message` 的专用入口
- `lib/scrm-base.js`
  公共 SQL、连接、校验、通用字段清洗
- `lib/scrm-mappers.js`
  微信视频号到标准字段的映射
- `scripts/lib/scrm-mappers.js`
  抖音到标准字段的映射

## 当前结论

以后新平台入库时：

- 适配器层不必直接改成数据库字段名
- 视频/评论优先新增该平台 mapper
- 私信类数据可以走专用 importer
- 通用导入器和专用 importer 可以并存
