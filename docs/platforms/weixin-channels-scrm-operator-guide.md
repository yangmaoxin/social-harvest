# 微信视频号抓取与 SCRM 入库操作手册

这份文档只保留当前稳定可用的口径，目标是让开发和日常操作都能快速上手。

覆盖范围：

1. 抓作品流（视频/图文）、评论、回复
2. 抓弹幕
3. 抓私信和打招呼消息
4. 导入 `scrm_file` / `scrm_comment` / `scrm_danmaku` / `scrm_message`
5. AI 意向分析配置与当前规则

如果你只关心私信链路，直接看：

- [weixin-channels-private-message-runbook.md](./weixin-channels-private-message-runbook.md)

如果你要的是“当前正式怎么跑、写哪些表、怎么验收”的直接手册，优先看：

- [weixin-channels-assistant-runbook.md](./weixin-channels-assistant-runbook.md)

## 1. 当前入口

### 主流程：作品/评论/私信

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --refresh
```

主流程会按顺序执行：

1. 抓作品流、图文增强、评论和回复
2. 导出 `danmaku-flat.json`
3. 导出 `private-messages-flat.json`
4. 默认正式写入 `scrm_file`、`scrm_comment`、`scrm_danmaku`、`scrm_message`
5. 视频作品写入 `scrm_file` 前会处理 `share_url`：数据库已有同一 `origin_type + no` 的链接就复用，没有才调用视频号接口生成短链

小范围验证可以先限制候选池和最终稿件数：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --post-limit 2 --image-text-limit 2 --work-limit 3 --refresh --import-scrm --import-scrm-message
```

- `--post-limit`：最多取多少条主作品流记录进入候选池
- `--image-text-limit`：最多取多少条图文增强入口记录进入候选池；图文增强只用于补字段和调试，不作为主识别依据
- `--work-limit`：作品流和图文增强结果合并、去重、排序后最多处理多少篇稿件
- `--limit`：`--work-limit` 的简写
- `--skip-image-text-list`：跳过单独图文增强入口，只使用账号作品流继续抓评论、回复和入库
- `--skip-danmaku`：跳过主流程最后的弹幕导出
- `--skip-private-messages`：跳过主流程最后的私信导出
- `--skip-preflight`：跳过正式抓取前的轻量登录态/接口检查
- `--skip-startup-preflight`：跳过启动前本地/SCRM 配置和表结构检查；只建议排查时临时使用
- `--allow-partial-import`：有稿件抓取失败时仍允许 `--import-scrm-apply` 写入部分结果；默认不允许
- `--no-import-scrm`：只抓作品/评论产物，不写 `scrm_file` / `scrm_comment`
- `--no-import-scrm-danmaku`：导出弹幕文件，但不写 `scrm_danmaku`
- `--no-import-scrm-message`：导出私信文件，但不写 `scrm_message`
- `--import-scrm` / `--import-scrm-danmaku` / `--import-scrm-message`：把对应默认正式入库降级成 dry-run

### 私信脚本排障

```bash
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

### 弹幕脚本排障

```bash
node scripts/sync-weixin-channels-danmaku-to-scrm.js --date <YYYY-MM-DD> --apply
```

### 作品/评论/弹幕/私信/账号一起跑

```bash
node scripts/task-runner.js run --platform weixin-channels -- --date <YYYY-MM-DD> --refresh
```

这是当前主流程默认行为：先产出账号主体、作品/评论、弹幕和私信等规范化文件，再由统一 sink runner 写入。默认目的地是 `scrm`；不想写库时把目的地声明为其他 sink，例如 `--sink feishu`。

### 已有样例文件时单独导入

主线优先用统一 sink runner 补写：

```bash
npm run sink:run -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --sink scrm --sink-apply
```

下面这些是 SCRM 底层导入器，主要用于排障和兼容验证。

作品/评论：

```bash
node scripts/import-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD>
node scripts/import-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD> --apply
```

私信：

```bash
node scripts/import-private-messages-to-scrm-message.js --date <YYYY-MM-DD>
node scripts/import-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

## 2. 运行前提

最少需要：

1. `Node.js 24.x`
2. 浏览器已登录微信视频号助手后台

安装依赖：

```bash
npm install --omit=dev
```

普通用户不需要全局安装 `opencli`，也不需要准备 `workspace/OpenCLI`。只有开发或调试视频号 adapter 时，才需要进入 `workspace/OpenCLI` 安装依赖并 `npm run build`。

建议先人工确认这两个页面能正常打开：

- `https://channels.weixin.qq.com/platform/post/list`
- `https://channels.weixin.qq.com/platform/interaction/comment`

## 3. 输出文件

默认输出目录：

- `samples/weixin-channels/<date>/`

最重要的文件：

- `harvest.json`
  统一稿件入库文件，视频和图文都会挂各自的 comments 数组
- `works.json`
  作品流和图文增强结果合并后的统一稿件队列
- `posts.json`
  主作品流原始结果，推荐以后优先看这个文件
- `image-texts.json`
  图文增强入口原始结果；开启 `--skip-image-text-list` 或增强入口失败时可能为空或不存在
- `private-messages-flat.json`
  一行一条私信，私信入库用它
- `danmaku-flat.json`
  一行一条弹幕，弹幕入库用它
- `progress.json`
  抓取进度；如果图文增强失败，会在 `warnings` 里记录，但主流程不会因此中断
- `run-report.json`
  本轮完整性报告；包含启动前配置/表结构预检、作品/图文/评论/回复统计、每篇作品抓取状态、预期评论数和实际抓取数对比、弹幕导出/入库状态、私信导出/入库状态、正式入库闸门状态、接口 preflight 结果和失败恢复建议
- `task-events.jsonl`
  runner 实时事件流和历史回放来源

## 4. 数据库目标与幂等

当前目标表：

- `scrm_file`
- `scrm_comment`
- `scrm_danmaku`
- `scrm_message`

当前已确认：

- `scrm_file` 依赖联合唯一：`UNIQUE(no, origin_type)`
- `scrm_comment` 依赖联合唯一：`UNIQUE(origin_type, comment_id)`
- `scrm_message` 依赖联合唯一：`UNIQUE(origin_type, comment_id)`
- `scrm_danmaku` 依赖联合唯一：`UNIQUE(origin_type, danmaku_id)`
- 默认正式入库前会先做启动前预检；缺数据库配置、连接失败或缺必要唯一索引时，会在抓取前停止并写入 `run-report.json.startup_preflight`
- 视频和图文导入会按稿件编码 `no` + 平台来源 `origin_type` 幂等更新
- `scrm_file.share_url` 用于保存平台分享链接；视频号短链每次生成可能不同，所以导入时优先读数据库已有值，只有数据库缺失且本轮稿件有 `object_nonce` 时才生成新短链
- 弹幕导入会按平台来源 `origin_type` + 弹幕 ID `danmaku_id` 幂等更新
- 私信导入会按平台来源 `origin_type` + 消息 ID `comment_id` 幂等更新；缺少唯一索引时会阻止正式导入
- 如果本轮有稿件评论抓取失败，默认会阻止正式写入；确认接受部分入库时再显式增加 `--allow-partial-import`

### 弹幕 Schema 审计

如果要确认数据库已经完全收口到 canonical `danmaku` 结构，建议执行：

```bash
node scripts/audit-danmaku.js
```

详细步骤见：
- [canonical-scrm-schema.md](../canonical-scrm-schema.md)

## 5. 当前字段映射

### `scrm_file`

- `no <- object_id`
- `file_type <- file_type`，视频为 `1`，图文为 `2`
- `origin_type <- 1`
- `duration <- duration`
- `title <- title`
- `front_img_url <- cover_url`
- `share_url <- share_url`；缺失时正式入库会按 `object_id + object_nonce` 生成视频短链，数据库已有则不重新生成
- `count_comment <- comment_count`
- `count_play <- view_count`
- `count_like <- like_count`
- `count_fav <- fav_count`
- `count_share <- share_count`
- `public_at <- publish_time`
- `status <- 1`
- `created_at <- 导入时当前时间`

### `scrm_comment`

- `comment_id <- comment_id`
- `origin_type <- 1`
- `comment_user_name <- author`
- `comment_user_photo <- avatar_url`
- `content <- text`
- `intention <- AI 分析结果`
- `no <- export_id`
- `parent_comment_id <- parent_comment_id`
- `root_parent_id <- root_comment_id`
- `reply_to <- reply_to`
- `reply_to_comment_id <- reply_comment_id`
- `count_agree <- like_count`
- `status <- 1`
- `created_at <- time`

### `scrm_message`

- `comment_id <- message_id`
- `comment_user_name <- sender_name`
- `comment_user_photo <- sender_avatar_url`
- `content <- text`
- `origin_type <- 1`
- `intention <- AI 分析结果`
- `created_at <- time`

## 6. 当前 AI 意向分析

### 编码

- `0` 未分析
- `1` 无意向
- `2` 低意向
- `3` 中意向
- `4` 高意向

### 当前判断口径

- `1 无意向`
  无关 / 无需求：夸视频、夸作者、夸剪辑、玩梗、追星、表情、纯互动、纯打招呼、冲流量标签、无关闲聊、纯负面但无咨询行为、历史用户单纯吐槽或明确不续费
- `2 低意向`
  认知了解：问功能、原理、用途、疾病、科普、产品区别、行业泛讨论、轻度好奇或泛泛质疑
- `3 中意向`
  购买评估：问价格、收费、优惠、套餐、分期、有没有必要、值不值、要不要存、靠不靠谱、怕被坑、家里纠结、想了解或正在考虑
- `4 高意向`
  行动推进：明确想买、想办、想存、询问办理流程、私信/留联系方式/销售跟进、地区或医院落地咨询、临产/住院/过几天生、病史驱动下继续咨询、续费或二胎继续存

当前规则以购买阶段为准，不只按关键词判断；同时出现多个信号时取最高等级。普通“多少钱 / 怎么收费 / 值不值”默认判 `3`；“哪里可以办 / 当地能不能存 / 私信你了 / 过几天生”这类开始落地推进的内容判 `4`。普通“智商税吗 / 靠谱吗”这类泛泛质疑默认是 `2`，但如果围绕本人是否购买、价格、办理或临产等现实决策，则升为 `3` 或 `4`。

历史存过不直接等于 `4`；只有当前再次推进、续费、二胎继续存或继续咨询才提高等级。

### 当前模型配置

至少配置：

- `OPENCLI_MODELSCOPE_API_KEY` 或 `MODELSCOPE_API_KEY`

可选配置：

- `OPENCLI_MODELSCOPE_BASE_URL`
- `OPENCLI_MODELSCOPE_MODEL`
  强制单模型
- `OPENCLI_MODELSCOPE_MODELS`
  逗号分隔模型池
- `ai.models`
  `config.local.json` 里的模型数组

默认模型池按顺序尝试：

- `ZhipuAI/GLM-5`
- `Qwen/Qwen3.5-397B-A17B`
- `Qwen/Qwen3-235B-A22B-Instruct-2507`
- `Qwen/Qwen3-Next-80B-A3B-Instruct`
- `ZhipuAI/GLM-5.1`
- `Qwen/Qwen3.5-35B-A3B`
- `Qwen/Qwen3.5-27B`
- `Qwen/Qwen3-Coder-30B-A3B-Instruct`
- `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`
- `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`

当前面的模型无响应或报错时，脚本会自动切到下一个。

如果没有配置 API key，导入不会中断，但会保留：

- `intention = 0`

### 当前数据口径

库里的历史有意向数据已经按新规则重新清洗过。

当前最终保留的典型有意向样本是：

- `这个多钱`
- `有点想买，费用咋样`
- `这个怎么买，在哪买`
- `廊坊能存吗`
- `私信你了，帮我看看`
- `过几天就生了，想了解`
- `这个原理是啥啊`
- `这个产品这么卖`
- `这个产品怎么卖呢`
- `多少钱`

像下面这类内容，当前已经统一压回 `1 无意向`：

- `这个视频做的很棒真不错`
- `好玩好玩`
- `老师真的很厉害，但没流量`
- `@DOU+上热门`

## 7. 导入后怎么核对

主流程正式入库后，至少看这几个点：

- `run-report.json.status` 是否为 `complete`
- `run-report.json.harvest_status` 是否为 `complete`
- `run-report.json.startup_preflight.status` 是否为 `ok` 或 `skipped`
- `run-report.json.import_gate.scrm_apply_allowed` 是否为 `true`
- `run-report.json.private_messages.status` 是否为 `imported`
- `run-report.json.private_messages.matched_current_payload_rows` 是否等于 `write_attempt_rows`
- `run-report.json.failure_recovery.has_blockers` 是否为 `false`
- `scrm_file` 总数是否增长合理
- `scrm_comment` 总数是否增长合理
- `scrm_message` 总数是否增长合理
- 每条作品的评论数和回复数是否匹配
- `scrm_comment.intention` / `scrm_message.intention` 是否有异常大量 `0`

如果手工查库，优先看：

- `scrm_file.no`
- `scrm_file.file_type`
- `scrm_comment.no`
- `scrm_comment.parent_comment_id`
- `scrm_comment.root_parent_id`
- `scrm_comment.intention`
- `scrm_message.comment_id`
- `scrm_message.intention`

## 8. 最小排错清单

抓不到数据，优先检查：

1. 浏览器是否登录了视频号助手后台
2. 登录态是否过期
3. 当前 OpenCLI 连的是不是这个浏览器会话

导入失败，优先检查：

1. 数据库连接信息是否正确
2. `scrm_file` / `scrm_comment` / `scrm_message` 的联合唯一索引是否存在
3. `harvest.json` / `private-messages-flat.json` 是否存在
4. AI key 是否配置

失败恢复优先看：

1. `run-report.json.startup_preflight`：启动前配置/表结构失败原因
2. `run-report.json.preflight`：微信后台登录态或接口轻量检查结果
3. `run-report.json.works[*].status/error`：具体哪篇稿件失败
4. `run-report.json.failure_recovery.next_steps`：下一步处理建议
5. `run-report.json.failure_recovery.commands`：可直接重试的命令

runner 实时事件展示没明显滚动，优先检查：

1. 是否通过一线 `daily:*` / `history:*` 或内部 runner 启动
2. 是否所有文件都被缓存命中
3. 是否需要加 `--refresh`
4. 是否 preflight 已经失败；失败原因会写进 `run-report.json.preflight`
5. `task-events.jsonl` 是否持续写入新事件

## 9. 最短操作版本

新电脑上最短只要做这几步：

1. 安装 `Node.js 24.x`
2. 执行：

```bash
npm install --omit=dev
```

4. 浏览器登录视频号助手后台
5. 根目录准备 `config.local.json`
6. 执行：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --refresh
```
