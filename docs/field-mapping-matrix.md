# 字段映射矩阵

这份文档解决的是“字段在不同层之间怎么对应”的问题。

当前仓库里，字段至少存在 3 层：

1. 平台原始层
   接口或页面原始返回字段
2. 适配器输出层
   `posts`、`comments`、`harvest` 对外输出的字段
3. 数据库标准层
   最终写入 `scrm_file` / `scrm_comment` / `scrm_message` 的字段

如果以后要继续开发更多平台，建议先补这份文档里的字段映射，再开始写代码。

## 为什么需要这份矩阵

不建议把平台命令输出直接做成数据库字段名。

更稳的结构是：

- 平台适配器保留平台语义
- 通用导入器只认标准数据库字段
- 平台差异只留在 mapper 层

对应代码位置：

- 平台适配器：
  - [adapters/weixin-channels/shared.js](../adapters/weixin-channels/shared.js)
  - [adapters/douyin/shared.js](../adapters/douyin/shared.js)
- SCRM mapper：
  - [scripts/lib/scrm-mappers.js](../scripts/lib/scrm-mappers.js)
- 私信 importer：
  - [scripts/import-private-messages-to-scrm-message.js](../scripts/import-private-messages-to-scrm-message.js)

## `no` 字段硬约束

标准层里的 `no` 统一表示**稿件主键位**。

- `scrm_file.no`：稿件自身主键
- `scrm_comment.no`：评论所属稿件主键
- `scrm_danmaku.no`：弹幕所属稿件主键

当前明确约束：

- 微信视频号：`no` 使用作品主键位
- 抖音：`no` 一律使用 `aweme_id`

以下字段不能进入标准层 `no`：

- 抖音 `item_id`
- 抖音 `creator_comment_item_id`
- 抖音 `creator_danmaku_item_id`

## 一、作品字段矩阵

### 核心字段

| 业务语义 | 微信视频号适配器字段 | 抖音适配器字段 | SCRM 字段 | 说明 |
| --- | --- | --- | --- | --- |
| 作品唯一标识 | `object_id` | `aweme_id` | `no` | 最终主键；抖音标准层固定取 `aweme_id` |
| 平台来源 | 固定平台值 | 固定平台值 | `origin_type` | 微信当前为 `1`，抖音当前为 `2` |
| 稿件类型 | `file_type` | `file_type` | `file_type` | 视频写 `1`；图文写 `2` |
| 标题 | `title` | `title` | `title` | 建议保持统一 |
| 封面 | `cover_url` | `cover_url` | `front_img_url` | URL 可能较长 |
| 视频链接 | `share_url` | `share_url` / `video_link` / `short_url` | `share_url` | 视频号导入时数据库已有则复用；没有才按 `object_id + object_nonce` 生成短链 |
| 时长 | `duration` | `duration` | `duration` | 单位由平台决定，当前按数值原样入库 |
| 评论数 | `comment_count` | `comment_count` | `count_comment` | |
| 点赞数 | `like_count` | `digg_count` / `like_count` | `count_like` | 抖音优先 `digg_count` |
| 播放数 | `view_count` | `play_count` / `view_count` | `count_play` | 抖音公开 Web 接口可能返回 `play_count` |
| 分享数 | `share_count` | `share_count` | `count_share` | |
| 收藏数 | `fav_count` | `fav_count` / `collect_count` | `count_fav` / `count_collect` | 目前微信更偏 `fav_count`，抖音可补 `collect_count` |
| 发布时间 | `publish_time` | `create_time` / `publish_time` | `public_at` | 最终统一成可读时间 |
| 入库创建时间 | 无直接适配器字段 | 无直接适配器字段 | `created_at` | 由导入器写入当前时间 |

### 微信视频号稿件字段

当前 `weixin-channels` 适配器的账号作品流已经稳定输出这些字段：

- `object_id`
- `object_nonce`
- `title`
- `media_type`
- `cover_url`
- `duration`
- `publish_timestamp`
- `publish_time`
- `view_count`
- `like_count`
- `fav_count`
- `share_count`
- `comment_count`
- `unread_comment_count`
- `visible`

对应实现：

- [normalizePostItem](../adapters/weixin-channels/shared.js:101)

图文增强入口通过 `image-texts` / `image-text-harvest` 输出同一套核心稿件字段，并额外带：

- `file_type`
- `image_count`
- `image_urls`

图文增强入口只用于补充字段和调试，不作为判断图文的主依据。图文入库时 `file_type` 写 `2`；缺失或非 `2` 时仍按 `1` 写入。

### 抖音作品字段

当前 `douyin` 适配器已经稳定输出这些作品字段：

- `aweme_id`
- `title`
- `file_type`
- `aweme_type`
- `media_type`
- `image_count`
- `cover_url`
- `play_url`
- `create_time`
- `digg_count`
- `comment_count`
- `share_count`
- `duration`

对应实现：

- [normalizeDouyinVideo](../adapters/douyin/shared.js:159)

当前抖音类型判断保持保守：有视频播放地址或时长时写 `file_type = 1`；没有视频但有 `images` 时写 `file_type = 2`；不确定时默认 `1`。

### 当前作品字段入库规则

#### 微信视频号

- `object_id -> no`
- `file_type -> file_type`，缺失时默认 `1`
- `title -> title`
- `cover_url -> front_img_url`
- `share_url -> share_url`，缺失时正式入库会尝试生成视频短链；数据库已有同一作品链接时直接复用
- `duration -> duration`
- `comment_count -> count_comment`
- `view_count -> count_play`
- `like_count -> count_like`
- `fav_count -> count_fav`
- `share_count -> count_share`
- `publish_time -> public_at`

#### 抖音

- `aweme_id -> no`
- `file_type -> file_type`，缺失时默认 `1`
- `title -> title`
- `cover_url -> front_img_url`
- `duration -> duration`
- `collect_count -> count_collect`
- `comment_count -> count_comment`
- `play_count/view_count -> count_play`
- `digg_count/like_count -> count_like`
- `fav_count -> count_fav`
- `share_count -> count_share`
- `create_time/publish_time -> public_at`

## 二、评论字段矩阵

### 核心字段

| 业务语义 | 微信视频号适配器字段 | 抖音适配器字段 | SCRM 字段 | 说明 |
| --- | --- | --- | --- | --- |
| 评论唯一标识 | `comment_id` | `comment_id` | `comment_id` | 建议平台层统一这个名字 |
| 评论所属作品 | `export_id` | `aweme_id` | `no` | 入库时映射为稿件主键；抖音固定取 `aweme_id` |
| 评论人昵称 | `author` | `author` | `comment_user_name` | |
| 评论人头像 | `avatar_url` | `avatar_url` | `comment_user_photo` | |
| 评论正文 | `text` | `text` | `content` | |
| 点赞数 | `like_count` | `digg_count` / `like_count` | `count_agree` | |
| 评论时间 | `time` | `time` | `created_at` | 适配器层已格式化 |
| 是否回复 | `is_reply` | `is_reply` | 无直接字段 | 用于业务判断，不单独入库 |
| 回复对象昵称 | `reply_to` | `reply_to` | `reply_to` | |
| 父评论 ID | `parent_comment_id` | `parent_comment_id` | `parent_comment_id` | |
| 根评论 ID | `root_comment_id` | `root_comment_id` / `root_parent_id` | `root_parent_id` | 抖音 mapper 已兼容两种命名 |
| 回复目标评论 ID | `reply_comment_id` | `reply_to_comment_id` | `reply_to_comment_id` | 微信和抖音命名不同 |

### 微信视频号评论字段

当前 `weixin-channels` 适配器评论字段包括：

- `comment_id`
- `export_id`
- `parent_comment_id`
- `root_comment_id`
- `author`
- `avatar_url`
- `reply_to`
- `text`
- `like_count`
- `reply_count`
- `reply_comment_id`
- `is_reply`
- `visible_flag`
- `comment_timestamp`
- `time`

对应实现：

- [normalizeCommentItem](../adapters/weixin-channels/shared.js:165)

### 抖音评论字段

当前 `douyin` 适配器评论字段包括：

- `comment_id`
- `aweme_id`
- `author`
- `avatar_url`
- `text`
- `time`
- `digg_count`
- `reply_count`
- `reply_to`
- `reply_to_comment_id`
- `parent_comment_id`
- `root_comment_id`
- `is_reply`

对应实现：

- [normalizeDouyinComment](../adapters/douyin/shared.js:240)

### 当前评论字段入库规则

#### 微信视频号

- `comment_id -> comment_id`
- `author -> comment_user_name`
- `avatar_url -> comment_user_photo`
- `text -> content`
- `export_id -> no`
- `parent_comment_id -> parent_comment_id`
- `root_comment_id -> root_parent_id`
- `reply_to -> reply_to`
- `reply_comment_id -> reply_to_comment_id`
- `like_count -> count_agree`
- `time -> created_at`

#### 抖音

- `comment_id -> comment_id`
- `author -> comment_user_name`
- `avatar_url -> comment_user_photo`
- `text -> content`
- `aweme_id -> no`
- `parent_comment_id -> parent_comment_id`
- `root_parent_id/root_comment_id -> root_parent_id`
- `reply_to -> reply_to`
- `reply_to_comment_id -> reply_to_comment_id`
- `digg_count/like_count -> count_agree`
- `time -> created_at`

## 三、私信字段矩阵

当前这部分覆盖微信视频号和抖音。抖音私信链路只导出已登录账号本人授权可见的入站单聊消息，默认过滤自己发送和疑似群聊。

### 核心字段

| 业务语义 | 微信视频号适配器字段 | SCRM 字段 | 说明 |
| --- | --- | --- | --- |
| 消息唯一标识 | `message_id` | `comment_id` | `scrm_message` 当前复用 comment 风格命名 |
| 发送人昵称 | `sender_name` | `comment_user_name` | 当前只保留对方发来的消息 |
| 发送人头像 | `sender_avatar_url` | `comment_user_photo` | 没有时回退 `thread_avatar_url` |
| 消息正文 | `text` | `content` | |
| 平台来源 | 固定平台值 | `origin_type` | 微信当前为 `1`，抖音当前为 `2` |
| 意向状态 | 无直接适配器字段 | `intention` | `0 未分析 / 1 无意向 / 2 低 / 3 中 / 4 高` |
| 消息时间 | `time` | `created_at` | 适配器层已格式化 |

### 微信视频号私信字段

当前 `private-messages-flat` 重点字段包括：

- `thread_id`
- `thread_tab`
- `thread_tab_label`

## 四、弹幕字段矩阵

当前这部分覆盖微信视频号和抖音创作者中心。

### 核心字段

| 业务语义 | 微信视频号适配器字段 | 抖音创作者中心字段 | SCRM 字段 | 说明 |
| --- | --- | --- | --- | --- |
| 弹幕唯一标识 | `bulletCommentId` / `bullet_comment_id` | `danmaku_id` | `danmaku_id` | 统一主键 |
| 所属作品 | `exportId` / `work_no` | `aweme_id` / `item_id` | `no` / supplement 侧 `aweme_id` | 标准层 `no` 表示稿件主键；抖音固定取 `aweme_id`，`item_id` 仅保留在 supplement 侧 |
| 弹幕作者 | `nickname` / `comment_user_name` | `author` | `comment_user_name` | 抖音创作者中心原始字段为 `author`，统一入库后映射到 `comment_user_name` |
| 弹幕作者头像 | `headImgUrl` / `comment_user_photo` | `avatar_url` | `comment_user_photo` / supplement 侧 `avatar_url` | |
| 弹幕正文 | `content` / `text` | `text` | `content` / supplement 侧 `text` | |
| 视频内时间 | `videoTimestampText` / `video_timestamp_text` | `video_time` | `video_timestamp_text` / supplement 侧 `video_time` | |
| 视频内时间毫秒 | `video_timestamp_ms` | 无直接字段 | `video_timestamp_ms` | 微信通用 SCRM 使用毫秒字段 |
| 视频内秒位点 | 无 | `video_position_seconds` | supplement 侧 `video_position_seconds` | 抖音创作者中心保留更细粒度秒位点 |
| 点赞数 | 无 | `digg_count` | supplement 侧 `digg_count` | 微信当前不稳定提供 |
| 创建时间 | `time` / `created_at` | `time` / `create_time` | `created_at` | |

### 当前通用弹幕入库规则

微信视频号 `scrm_danmaku`：

- `bulletCommentId/bullet_comment_id -> danmaku_id`
- `exportId/work_no -> no`
- `nickname/comment_user_name -> comment_user_name`
- `headImgUrl/comment_user_photo -> comment_user_photo`
- `content/text -> content`
- `videoTimestampText/video_timestamp_text -> video_timestamp_text`
- `video_timestamp_ms -> video_timestamp_ms`
- `time/created_at -> created_at`

抖音创作者中心统一弹幕入库 `scrm_danmaku`：

- `danmaku_id -> danmaku_id`
- `aweme_id -> no`
- `item_id -> supplement 侧 item_id，不进入 scrm_danmaku.no`
- `author -> comment_user_name`
- `avatar_url -> comment_user_photo`
- `text -> content`
- `video_time -> video_timestamp_text`
- `video_position_seconds -> video_timestamp_ms`
- `time/create_time -> created_at`
- `thread_nickname`
- `thread_avatar_url`
- `message_id`
- `sender_name`
- `sender_avatar_url`
- `direction`
- `text`
- `time`

对应实现：

- [flattenPrivateMessages](../adapters/weixin-channels/shared.js)
- [import-private-messages-to-scrm-message.js](../scripts/import-private-messages-to-scrm-message.js)

### 当前私信字段入库规则

#### 微信视频号

- `message_id -> comment_id`
- `sender_name -> comment_user_name`
- `sender_avatar_url/thread_avatar_url -> comment_user_photo`
- `text -> content`
- 固定平台值 -> `origin_type`
- `intention` 编码：`0 未分析 / 1 无意向 / 2 低 / 3 中 / 4 高`
- `time -> created_at`

## 四、`harvest` 聚合结构约定

当前两个平台都已经按“作品为主、评论挂在下面”的方式输出：

```json
[
  {
    "work_primary_key": "xxx",
    "title": "作品标题",
    "cover_url": "https://...",
    "publish_or_create_time": "<YYYY-MM-DD HH:mm:ss>",
    "comment_count": 10,
    "comments": [
      {
        "comment_id": "c1",
        "author": "张三",
        "avatar_url": "https://...",
        "text": "评论内容",
        "time": "<YYYY-MM-DD HH:mm:ss>",
        "reply_to": "",
        "is_reply": false
      }
    ]
  }
]
```

这层结构的意义是：

- 对业务最直观
- 最适合导出样例
- 最适合作为统一入库输入

## 五、哪些字段应该优先统一

如果继续增加更多平台，建议优先统一这些适配器层字段：

### 作品层

- 平台作品主键
- `title`
- `cover_url`
- 发布时间字段
- `comment_count`
- 点赞数
- 时长

### 评论层

- `comment_id`
- `author`
- `avatar_url`
- `text`
- `time`
- `reply_to`
- `parent_comment_id`
- `root_comment_id`
- `is_reply`

## 五、哪些字段可以按平台保留差异

这些字段可以不强求完全统一：

- 微信的 `object_nonce`
- 微信的 `media_type`
- 微信的 `unread_comment_count`
- 抖音的 `play_url`
- 抖音的 `sec_uid`
- 抖音的 `uid`
- 抖音的 `unique_id`

这类字段更适合作为平台增强字段保留在适配器层，不一定进入标准数据库表。

## 六、新平台接入时怎么用这份矩阵

建议顺序：

1. 先列出平台原始字段
2. 先映射到适配器输出字段
3. 再决定哪些字段进入 SCRM 标准层
4. 最后实现 `scripts/lib/scrm-mappers.js` 中的平台 mapper

最小检查清单：

- 作品主键是否明确
- 评论主键是否明确
- 评论归属作品字段是否明确
- 评论层级关系字段是否明确
- 时间字段是否已经格式化
- 头像和封面字段是否已经归一

## 七、相关文档

- [README.md](../README.md)
- [Getting Started](./getting-started.md)
- [Platform Capability Matrix](./platforms/platform-capability-matrix.md)
- [Canonical SCRM Schema](./canonical-scrm-schema.md)
