# 高级诊断命令

这份文档只放低频排查命令。日常运行优先看 [Commands](commands.md)。

## 1. 使用边界

高级诊断命令用于定位平台页面、接口、字段和运行时适配器问题。它们不应该成为桌面端 UI 的日常入口。

原则：

- 先跑统一 runner 和平台正式命令。
- 只有正式命令输出为空、字段异常或适配器疑似失效时，再跑诊断命令。
- 诊断结果用于修适配器或 mapper，不直接作为 SCRM 入库来源。

## 2. 抖音适配器同步

同步抖音运行时适配器：

```bash
node scripts/sync-douyin-runtime-comments.js
```

这个命令会同步抖音运行时适配器，包括：

- `skill-harvest`
- `skill-videos`
- `skill-comments`
- `skill-comment-id-bridge-probe`
- `skill-comment-name-dom-probe`
- `skill-resolve-user`
- `skill-messages-flat`
- `skill-messages-probe`
- `skill-messages-api-probe`
- `skill-messages-conversation-api-probe`
- `skill-messages-dom-detail-probe`
- `skill-messages-field-probe`
- `skill-messages-record-probe`
- `skill-messages-payload-probe`
- `skill-messages-field9-probe`
- `skill-messages-field9-classify-probe`
- `skill-messages-value-shape-probe`
- `skill-creator-inspect`
- `skill-creator-api-summary`

## 3. 抖音创作者中心只读检查

创作者中心页面状态检查：

```bash
node scripts/inspect-douyin-creator-center.js --date <YYYY-MM-DD>
```

默认目标页：

| 页面 | URL |
| --- | --- |
| 创作者中心首页 | `https://creator.douyin.com/creator-micro/home` |
| 内容管理 / 作品管理 | `https://creator.douyin.com/creator-micro/content/manage` |
| 互动管理 / 评论管理 | `https://creator.douyin.com/creator-micro/interactive/comment` |
| 互动管理 / 弹幕管理 | `https://creator.douyin.com/creator-micro/danmaku-manage/manage` |
| 互动管理 / 私信管理 | `https://creator.douyin.com/creator-micro/data/following/chat` |

输出文件：

```text
samples/douyin/<date>/creator-center-inspect.json
samples/douyin/<date>/creator-center-api-summary.json
samples/douyin/<date>/creator-center-inspect-report.json
```

这个命令只输出来源、页面状态、登录提示、模块提示、元素计数和数据结构摘要，不输出页面正文、作品正文或评论正文。报告里的 `summary_candidates` 会按作品、评论/互动、弹幕、指标、消息粗分候选路径；`ready_for_creator_harvest` 只表示已经看到可继续设计字段的候选结构。

包装命令默认会跟进 `prefetch.json` 中暴露的候选入口，再写一层响应结构摘要。候选入口只保留路径、query key、param key、credential key、hash 和结构，不保留参数值或响应正文；需要关闭时可传 `--no-follow-endpoints`。

默认会逐页检查以上 5 个目标页，并尝试点击 `内容管理,作品管理,互动管理,评论管理,弹幕管理,数据中心,私信管理` 这些可见标签来触发页面数据加载；需要限定范围时可传 `--url <URL>` 或 `--target-pages <URL1>,<URL2>`。

也可以直接运行适配器命令：

```bash
opencli douyin skill-creator-inspect -f json
opencli douyin skill-creator-api-summary -f json
```

## 3.1 抖音评论 ID 桥接字段探针

用于检查同一条作品在创作者中心评论接口和前台评论接口里，是否存在可直接桥接的隐藏 ID 字段或 `extra` 扩展字段。

```bash
opencli douyin skill-comment-id-bridge-probe 7633739761886490340 -f json
```

可选参数：

- `item_id <creator_item_id|auto>`：创作者中心评论作品 ID，默认 `auto`
- `limit <N>`：每侧最多检查多少条一级评论
- `reply_limit <N>`：每侧最多检查多少条回复

输出会分别给出：

- 创作者中心一级评论原始响应摘要
- 创作者中心回复原始响应摘要
- 前台一级评论原始响应摘要
- 前台回复原始响应摘要

每个摘要会列出：

- 候选桥接字段命中次数
- 候选字段样例路径和值
- 所有 `id/cid/group` 风格 key path
- `extra` 对象路径
- 看起来像内部加密 ID 的字段路径

## 3.2 抖音评论昵称 DOM / 状态探针

用于检查创作者中心评论页里，**可见昵称**是否能在评论卡片对应的 DOM/React 状态里找到，以及它和原始评论接口的哪一行对应。

```bash
opencli douyin skill-comment-name-dom-probe 7633739761886490340 -f json
```

可选参数：

- `item_id <creator_item_id|auto>`：创作者中心评论作品 ID，默认 `auto`
- `limit <N>`：最多检查多少条可见评论/原始评论

输出会分成四块：

- `visible_cards`：页面上可见评论卡片摘样
- `raw_comment_rows`：创作者中心旧评论接口原始行摘要
- `visible_to_raw_match`：按 `text + time` 把可见卡片和原始行对齐
- `request_candidates`：评论页里最近出现过的评论相关请求

这个探针重点看：

- 页面上的昵称是否只存在于 DOM/React 状态
- 原始评论行有没有作者名 / 头像 / IP
- 页面状态里有没有 `nickname / user_name / ip_label` 这类字段路径

## 4. 抖音私信诊断

页面候选诊断：

```bash
opencli douyin skill-messages-probe -f json
```

接口结构检查：

```bash
opencli douyin skill-messages-api-probe --wait_seconds 2 -f json
```

会话点击接口检查：

```bash
opencli douyin skill-messages-conversation-api-probe --wait_seconds 2 --conversation_clicks 5 -f json
```

第二层 DOM 诊断：

```bash
opencli douyin skill-messages-dom-detail-probe -f json
```

字段归因：

```bash
opencli douyin skill-messages-field-probe --wait_seconds 2 -f json
```

记录对照：

```bash
opencli douyin skill-messages-record-probe --wait_seconds 2 -f json
```

载荷检查：

```bash
opencli douyin skill-messages-payload-probe --wait_seconds 2 -f json
```

`field 9` 检查：

```bash
opencli douyin skill-messages-field9-probe --wait_seconds 2 -f json
```

`field 9` 分类：

```bash
opencli douyin skill-messages-field9-classify-probe --wait_seconds 2 -f json
```

字段形态检查：

```bash
opencli douyin skill-messages-value-shape-probe --wait_seconds 2 -f json
```

这些命令只输出字段号、wire type、长度、hash、候选结构、字符轮廓或候选数量等诊断信息，不输出私信正文、真实 ID 或原始二进制。

## 5. 常见使用场景

| 场景 | 优先命令 |
| --- | --- |
| 私信正式导出 0 条 | `skill-messages-probe` |
| 怀疑接口结构变化 | `skill-messages-api-probe` |
| 点击会话后字段不对应 | `skill-messages-conversation-api-probe` |
| DOM 提取发送人异常 | `skill-messages-dom-detail-probe` |
| 方向字段或时间字段异常 | `skill-messages-field-probe` / `skill-messages-record-probe` |
| 消息正文载荷字段变化 | `skill-messages-payload-probe` / `skill-messages-value-shape-probe` |
| 创作者中心页面状态确认 | `node scripts/inspect-douyin-creator-center.js` |
