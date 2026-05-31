# 平台能力矩阵

这份文档用来回答两个问题：

1. 当前仓库已经支持哪些平台
2. 每个平台具体能采集 / 更新什么、能导什么、能不能入库

如果你准备继续加第三个平台，建议每次都先更新这份矩阵。

## 总览

| 平台 | 当前状态 | 认证方式 | 已实现业务入口 | 内容聚合产物 | 二级回复 | SCRM 入库 | 真实样例 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `weixin-channels` | 可用 | 已登录后台 Cookie | 创作者内容更新 / 弹幕更新 / 私信线索更新 / 写入业务系统 | 支持 | 支持 | 支持 | 支持 |
| `douyin` | 可用 | 前台浏览器上下文 + 创作者中心登录态 | `node scripts/harvest-douyin.js` / `node scripts/harvest-douyin-creator.js` / `node scripts/sync-douyin-private-messages-to-scrm-message.js` | 支持 | 支持，回复接口拒绝时安全降级 | 支持 | 支持 |

## 平台详情

### `weixin-channels`

平台定位：

- 微信视频号助手后台
- 面向 `https://channels.weixin.qq.com`

认证方式：

- 浏览器后台登录态
- Cookie 型适配器

已实现命令：

- `opencli weixin-channels posts`
- `opencli weixin-channels comments <export-id>`
- `opencli weixin-channels harvest`
- `opencli weixin-channels image-texts`
- `opencli weixin-channels image-text-harvest`
- `opencli weixin-channels danmaku-flat`

可采集内容：

- 作品流，包含视频和部分图文
- 图文增强列表
- 作品标题、封面、发布时间、时长、媒体类型
- 图文增强字段，例如多图 URL
- 播放、点赞、收藏、评论、未读评论统计
- 一级评论
- 二级回复
- 评论人昵称
- 评论人头像
- 评论时间
- 回复关系
- 弹幕正文
- 弹幕作者
- 视频内时间点

典型输出文件：

- harvest.json
- harvest-comments.json

数据库状态：

- `scrm_file`：已接入
- `scrm_comment`：已接入
- `scrm_danmaku`：已接入
- 二级回复：已入库
- 图文稿件：通过 `file_type = 2` 写入 `scrm_file`

入口文档：

- [adapters/weixin-channels/README.md](../../adapters/weixin-channels/README.md)
- [weixin-channels-scrm-operator-guide.md](./weixin-channels-scrm-operator-guide.md)

备注：

- 已有断点续抓脚本
- 日常主流程以 `posts -> works -> comments -> import` 为准
- 图文增强入口只用于补充字段和调试，不作为判断图文的主依据
- Windows 交付流程不属于当前默认交付主线
- 更适合后台业务采集场景

### `douyin`

平台定位：

- 公开账号采集：面向别人或公开资料研究
- 创作者中心更新：面向自己账号的后台数据、弹幕、私信和管理字段

认证方式：

- 公开主页：浏览器上下文 + 公开 Web API
- 创作者中心：已登录创作者中心会话 + 后台接口
- 当前主链路优先 API / network，不默认依赖 DOM

已实现命令：

- `node scripts/harvest-douyin.js`
- `node scripts/harvest-douyin-creator.js`
- `node scripts/sync-douyin-private-messages-to-scrm-message.js`
- `opencli douyin skill-harvest --sec_uid <sec_uid>`
- `opencli douyin skill-creator-harvest`
- `opencli douyin skill-videos --sec_uid <sec_uid>`
- `opencli douyin skill-comments <aweme_id>`
- `opencli douyin skill-messages-flat`
- `opencli douyin skill-messages-api-probe`
- `opencli douyin skill-messages-conversation-api-probe`
- `opencli douyin skill-messages-dom-detail-probe`
- `opencli douyin skill-messages-field-probe`
- `opencli douyin skill-messages-record-probe`
- `opencli douyin skill-messages-payload-probe`
- `opencli douyin skill-messages-field9-probe`
- `opencli douyin skill-messages-field9-classify-probe`
- `opencli douyin skill-messages-value-shape-probe`

可采集内容：

- 通过配置读取稳定 `sec_uid`
- 指定用户公开作品列表
- 作品标题、播放地址、点赞数、时长
- `douyin skill-harvest` 返回的公开评论
- 评论人昵称
- 已登录本人账号可见的创作者中心作品、评论、弹幕和入站单聊私信

典型输出文件：

- harvest.json
- videos.json
- comments-flat.json

数据库状态：

- `scrm_file`：已接入
- `scrm_comment`：已接入
- `scrm_message`：抖音入站单聊私信已接入
- 历史 `scrm_douyin_creator_work` / `scrm_douyin_creator_comment` 补充表链路已退役
- `scrm_danmaku`：抖音弹幕明细统一入库已接入
- 基础评论：已入库

入口文档：

- [adapters/douyin/README.md](../../adapters/douyin/README.md)
- [douyin-development-plan.md](./douyin-development-plan.md)
- [douyin-main-table-write-strategy.md](./douyin-main-table-write-strategy.md)

备注：

- 已完成真实浏览器会话验证
- 公开账号和创作者中心已经按“别人账号采集 / 自己账号更新”分成两套正式方案
- 主表写入方案已定为“采集 / 更新层双线、写入层单口”
- 公开账号继续负责别人账号研究；创作者中心继续负责自己账号的后台数据
- 图文识别已接入归一化逻辑；真实覆盖取决于公开 Web 侧作品接口返回字段
- `--work-comments` 已能通过 `douyin skill-comments` 补多页作品评论和平台原始评论 ID
- `--with-replies` 已能补二级回复关系；独立回复接口临时拒绝时会安全降级
- `node scripts/verify-douyin-scrm-fixture.js -- --apply` 可用固定样本验证真实 MySQL 回复关系和 upsert
- `node scripts/sync-douyin-private-messages-to-scrm-message.js` 只做本人已登录账号的只读入站私信导出，默认过滤自己发送和疑似群聊
- 私信 API 探针已定位 `imapi.douyin.com/v1/stranger/get_conversation_list` 和 `imapi.douyin.com/v1/message/get_by_user`，响应是 `application/x-protobuf`
- 私信字段归因探针已能针对候选消息数组 `6.200.1[]` 输出 `field_path`、字段覆盖率、长度范围、时间范围、枚举样本和脱敏 hash 样本，不输出正文或原始响应
- 私信记录对照探针已能按候选消息记录输出 `record_key_hash`、`message_id_hash`、`timestamp_candidate`、方向枚举候选、对方 hash 候选和载荷长度，不输出正文、真实 ID 或原始响应
- 私信载荷探针已能针对 `field 8` 输出载荷类型、hash、JSON key 列表或 protobuf-like 字段路径，不输出正文值、真实 ID 或原始响应
- 私信 `field 9` 探针已能展开候选重复项，输出条目 hash、长度、`part1`/`part2` 的 hash 与结构类型，不输出正文值、真实 ID 或原始响应

## 当前统一输出思路

虽然每个平台字段不完全一样，但当前仓库已经基本固定了这套统一思路：

- `posts`
  负责作品流
- `comments`
  负责单作品评论
- 内容聚合产物
  负责“作品为主，评论挂载到 `comments` 数组下”；现有文件名仍可能叫 `harvest.json`，属于脚本兼容产物名，不作为桌面端业务动作名。

评论字段建议尽量对齐：

- `comment_id`
- `author`
- `avatar_url`
- `text`
- `time`
- `reply_to`
- `is_reply`

视频字段建议尽量对齐：

- 平台视频主键
- `title`
- `cover_url`
- 发布时间字段
- 评论数
- 点赞数
- 时长

## 当前统一写入思路

所有平台最终都先产出规范化 datasets，再由统一 sink runner 写入目标 sink：

```bash
npm run sink:run -- --platform <platform> --output-dir samples/tasks/<task>/<platform> --sink scrm --sink-apply
```

平台差异只体现在：

- `scripts/lib/scrm-mappers.js`
- 平台产物文件名和 mapper 输入解析

SCRM 底层导入器 `node scripts/import-to-scrm.js --platform <platform> --date <YYYY-MM-DD>` 保留为排障和兼容入口。

最终目标表：

- `scrm_file`
- `scrm_comment`

详细字段标准见：

- [canonical-scrm-schema.md](../canonical-scrm-schema.md)

## 新平台加入时建议补齐的内容

每新增一个平台，建议同时补齐这 6 项：

1. `adapters/<platform>/README.md`
2. `samples/<platform>/<date>/harvest.json` 或等价内容聚合样例
3. `scripts/lib/scrm-mappers.js` 中的平台 mapper
4. `docs/platforms/platform-capability-matrix.md`
5. 该平台测试文件
6. 至少一次真实运行验证记录
