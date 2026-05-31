# 抖音双线开发计划

这份文档是抖音能力维护入口。历史难点、踩坑和方案取舍见 [抖音抓取难点报告](douyin-crawling-challenges-report.md)。公开主页与创作者中心的合并规则见 [抖音创作者中心合并策略](douyin-creator-merge-policy.md)。当前推荐的数据源分流策略见 [抖音数据源双方案策略](douyin-source-strategy.md)。抖音弹幕统一入 `scrm_danmaku` 的方案见 [抖音弹幕统一入库方案](douyin-danmaku-unification-plan.md)。

## 1. 目标

抖音能力继续保留两条数据线，但按“抓自己 / 抓别人”重新分工：

| 数据线 | 稳定入口 | 数据域 | 当前状态 |
| --- | --- | --- | --- |
| 公开主页数据 | `www.douyin.com` | 公开主页作品、图文、公开视频评论、二级回复 | 已可用，作为“抓别人”的主线 |
| 创作者中心数据 | `creator.douyin.com` | 已登录本人账号后台数据、私信、后台作品/互动/指标 | 私信可用，作品/评论/弹幕汇总可用，作为“抓自己”的主线 |

原则：

- 抓自己：创作者中心主线，公开主页辅助校验。
- 抓别人：公开主页唯一主线，不碰创作者中心。
- 公开主页数据和创作者中心数据不再混称“默认抓取”。
- 先给每条数据线独立 CLI 可验证入口，再接桌面端。
- 数据输出必须保留 `data_source`，保证入库和报告可区分来源。
- DOM 只用于进入页面、触发接口和诊断兜底；正式数据优先来自接口或稳定结构。

## 2. 当前边界

### 公开主页数据

已接入：

- 多账号按配置抓取。
- 用户主页作品列表。
- 视频/图文归一。
- 一级评论和二级回复。
- `--work-comments` 作品级评论增强。
- SCRM `scrm_file`、`scrm_comment` 入库。
- 断点续跑、账号级重试、失败作品评论重跑。

当前入口：

```bash
node scripts/task-runner.js run --platform douyin -- --account main --import-scrm
node scripts/harvest-douyin.js --account target --import-scrm
```

### 创作者中心数据

已接入：

- 本人已登录账号可见的入站单聊私信。
- 朋友私信主路径。
- 自己发送内容不入库。
- 群聊不入库。
- SCRM `scrm_message` 入库。
- 作品管理列表初版 CLI，可输出后台作品 ID、状态和指标摘要。
- 评论管理列表初版 CLI，可用 `auto` 先读取评论管理页“选择作品”列表，再输出选中作品的后台评论字段。
- 创作者中心汇总初版 CLI，可把作品管理和评论管理数据合并到作品结构。

当前入口：

```bash
node scripts/sync-douyin-private-messages-to-scrm-message.js --date <YYYY-MM-DD>
node scripts/task-runner.js run --platform douyin --task creator-messages -- --message-limit 50
node scripts/task-runner.js run --platform douyin --task creator-content -- --work-limit 50 --comment-work-limit 50
node scripts/harvest-douyin-creator.js --date <YYYY-MM-DD>
node scripts/sync-douyin-private-messages-to-scrm-message.js --date <YYYY-MM-DD>
```

目标页面：

| 页面 | URL |
| --- | --- |
| 创作者中心首页 | `https://creator.douyin.com/creator-micro/home` |
| 内容管理 / 作品管理 | `https://creator.douyin.com/creator-micro/content/manage` |
| 互动管理 / 评论管理 | `https://creator.douyin.com/creator-micro/interactive/comment` |
| 互动管理 / 弹幕管理 | `https://creator.douyin.com/creator-micro/danmaku-manage/manage` |
| 互动管理 / 私信管理 | `https://creator.douyin.com/creator-micro/data/following/chat` |

当前不覆盖：

- 陌生人私信完整闭环。
- 创作者中心作品/评论/互动字段完整入库。
- 普通抖音号文本自动解析为 `sec_uid`。

## 3. 开发阶段

### P0：边界收口和来源标记

目标：现有能力不大改，但所有报告和中间数据能明确来源。

任务：

- 公开主页 `harvest.json` 作品和评论补 `data_source: "douyin_public"`。
- 公开主页 `run-report.json` 和 `index.json` 补 `data_source: "douyin_public"`。
- 创作者中心私信 `private-messages-report.json` 补 `data_source: "douyin_creator_center"`。
- 文档、报告、桌面文案避免把公开主页和创作者中心混成一个概念。

验收：

```bash
npm test -- scripts/harvest-douyin.test.js scripts/sync-douyin-private-messages-to-scrm-message.test.js adapters/douyin/shared.test.js
npm run test:douyin
```

### P1：公开主页数据稳定化

目标：让公开作品/评论成为稳定、可回归、可解释的数据线。

任务：

- 将 `harvest` 文案逐步调整为“抖音公开主页抓取”。
- 报告中明确作品、评论、回复、图文的来源和计数。
- 补公开主页失败样本：登录态、主页不可见、评论接口拒绝、二级回复降级。
- 保持 `--work-comments` 为公开主页评论增强，不引入创作者中心语义。

验收：

```bash
node scripts/harvest-douyin.js --account main --with-replies --work-comments --work-comment-limit 20 --work-comment-pages 2
```

### P2：创作者中心接口调研

目标：先确认后台有哪些稳定接口，再决定正式字段和入库策略。

任务：

- 新增创作者中心只读检查命令，优先不输出正文敏感内容。
- 梳理后台作品列表、作品详情、互动/评论、指标字段。
- 每个检查命令输出脱敏报告：URL 路径、状态码、字段形状、计数、采样 key。
- 只读检查报告输出 `summary_candidates`，先把作品、评论/互动、弹幕、指标、消息候选路径分开。
- 只读检查可跟进 `prefetch.json` 暴露的候选入口，只输出 endpoint 路径、参数 key、hash 和结构摘要。
- 明确哪些字段可直接入库，哪些只保留在 JSON 报告中。

验收：

```bash
opencli douyin skill-creator-inspect -f json
opencli douyin skill-creator-api-summary -f json
node scripts/inspect-douyin-creator-center.js --date <YYYY-MM-DD>
```

### P3：创作者中心正式适配

目标：形成独立于前台的后台数据链路。

候选入口：

- `douyin skill-creator-works`：已接入初版，基于作品管理页 `work_list`。
- `douyin skill-creator-comments`：已接入初版，支持 `item_id=auto` 先走评论管理页“选择作品”列表，也支持显式传评论管理页作品 ID。
- `douyin skill-creator-harvest`：已接入初版，先汇总作品和评论，未匹配评论目标会保留说明。
- `node scripts/task-runner.js run --platform douyin --task creator-content`：已接入 runner，输出创作者内容报告。
- 桌面端已识别 `creator-content` 任务，计划页可单独选择“抖音创作者内容更新”。
- 历史 `douyin:creator:supplement:*` 补充表链路已退役；当前创作者中心写库走主表和统一表入口。
- 合并策略已固化为 `creator-scrm-preview-report.json` 的 `merge_policy` 字段。
- 补字段计划已固化为 `creator-scrm-supplement-plan.json`，包含账号保护、候选补字段和当前表结构缺口。

输出要求：

- 所有行带 `data_source: "douyin_creator_center"`。
- 作品优先保留 `aweme_id`、后台作品 ID、发布时间、状态、指标。
- 评论优先保留真实评论 ID、作品 ID、用户信息、内容、时间、互动状态。
- 不和公开主页抓取隐式合并；合并逻辑放在 importer 或专用合并器里。

验收：

```bash
opencli douyin skill-creator-works -f json --limit 20
opencli douyin skill-creator-comments auto -f json --limit 20
opencli douyin skill-creator-harvest -f json --work_limit 20 --comment_work_limit 5
node scripts/task-runner.js run --platform douyin --task creator-content -- --limit 20
node scripts/preview-douyin-main-table-merge.js --input samples/douyin/<date>/creator-harvest.json --front-input samples/douyin/<date>/<account-id>/harvest.json
node scripts/preview-douyin-main-table-comment-merge.js --input samples/douyin/<date>/creator-harvest.json --front-input samples/douyin/<date>/<account-id>/harvest.json
```

### P4：入库和桌面端整合

目标：让用户在桌面端明确选择数据线，并看到来源差异。

任务：

- 桌面任务选择拆成“抖音公开主页抓取”“抖音创作者中心抓取”“抖音私信”。
- 任务历史和报告页展示 `data_source`。
- 创作者中心任务历史和报告页展示一级评论数、回复数和 `reply_fetch_status_counts`。
- 先用 dry-run 映射预览确认 `scrm_file` / `scrm_comment` 行数和字段。
- 入库去重优先用真实 `aweme_id` / `comment_id`。
- 公开主页与后台同作品冲突时，公开主页保留公开字段，后台补运营指标和管理状态。
- 正式写库前需要满足账号保护：存在 `aweme_id` 交集，或用户显式绑定当前创作者中心登录态。
- 当前正式写库不再使用创作者中心补充表；后台专有字段只保留在本地产物和预览报告中。
- 默认日计划已接入创作者中心拆分步骤；公开主页批量研究继续使用独立公开主页计划。

## 4. 开发规则

- 新增抖音能力必须先有 CLI 可验证入口，再考虑桌面端 UI。
- 新增命令必须是 Node/npm 入口，不新增 shell、Python 或 PowerShell 编排脚本。
- 稳定能力接入 `scripts/lib/platform-registry.js`；低频检查命令只放 Advanced Diagnostics。
- 平台原始字段先保留抖音语义，SCRM 转换在 mapper 或专用 importer 内处理。
- 任何失败、warning、产物路径必须进入 runner 报告。
- 不能为了创作者中心改坏现有公开主页抓取。

## 5. 当前维护重点

已完成：

- P0 来源标记。
- 公开主页报告和桌面文案补“公开主页”概念。
- 创作者中心只读检查命令。
- 只读检查项目级 npm 入口和固定报告文件。
- 创作者中心数据结构概览命令。
- 创作者中心目标页默认覆盖首页、作品管理、评论管理、弹幕管理和私信管理。
- 创作者中心作品管理列表初版命令 `skill-creator-works`。
- 创作者中心评论管理列表初版命令 `skill-creator-comments`。
- 创作者中心作品/评论汇总初版命令 `skill-creator-harvest`。
- 统一 runner 和桌面任务服务已接入 `creator-harvest`。
- 桌面计划页、任务历史页和仪表盘已显示“抖音创作者中心抓取”。
- 创作者中心汇总到 SCRM 行的 dry-run 映射预览。
- 公开主页与创作者中心补字段策略文档和机器可读 `merge_policy`。
- 账号保护和补字段计划产物 `creator-scrm-supplement-plan.json`。
- 历史补充表导入脚本已移除；当前状态是作品/评论写主表，弹幕明细统一进 `scrm_danmaku`。
- 抖音弹幕统一表 dry-run 入口已接入：`node scripts/import-danmaku-to-scrm.js --platform douyin --input samples/douyin/<date>/creator-harvest.json`。
- 抖音弹幕统一表正式写入已验证：`2026-05-02` 的 `creator-harvest.json` 现已稳定输出 `11` 条弹幕行，并与弹幕管理页实际可见的 `11` 条记录对齐；统一写入 `scrm_danmaku` 后得到 `11` 条 `origin_type = 2` 记录，重复执行 `--apply` 后总行数保持不变。
- `okrtest.scrm_douyin_creator_danmaku` 已回收；删除前后 `scrm_danmaku` 保持 `origin_type = 2` 的 `11` 条抖音弹幕不变，说明旧表删除未影响统一主表。
- 创作者中心弹幕真实抓取已验证：同账号前台样本通过 `account_guard` 后，`creator-harvest.json` 中 33 条弹幕行会按 `danmaku_id` 去重为 11 条唯一记录，并统一导入 `scrm_danmaku`。
- 创作者中心弹幕目标映射已修正：`danmaku/manage/list` 现在优先按目标作品的明文 `aweme_id` 请求，不再把同一批 11 条弹幕重复挂到 4 条作品上。
- 创作者中心历史补充表链路已被默认主链路取代。
- 自己账号 `scrm_file` 主表 merge 预演入口已接入：`node scripts/preview-douyin-main-table-merge.js`。
- 自己账号 `scrm_file` 主表正式写库入口已接入：`node scripts/import-douyin-main-table-file-to-scrm.js`。
- `2026-05-02` 的真实双源预演已验证：同账号前台样本 `samples/douyin/2026-05-02/maomaoqiu/harvest.json` 与创作者中心样本存在 `4/4` 的 `aweme_id` 交集，`account_guard` 可直接通过。
- 同一轮真实双源预演也证明：4 条作品全部至少存在一处字段冲突；当前冲突摘要已经可直接从 `douyin-main-table-file-preview-report.json` 读取，主要集中在 `count_play`、`front_img_url`，以及少量 `title`、`duration`、`count_danmaku`、`count_collect`。
- `file_type` 冲突已确认是归一化 bug 而不是业务规则差异：创作者中心样本里的 `image_text` 现在会正确映射成主表 `file_type=2`，不再作为 apply 前阻塞项。
- `scrm_file` 的冲突字段裁决表现已写入 [抖音主表写入策略](douyin-main-table-write-strategy.md)，并同步输出到 `douyin-main-table-file-preview-report.json.field_resolution_policy`。
- `douyin:creator:file:write --apply` 已在 `okrtest.scrm_file` 做过真实写库：4 条作品全部匹配当前 payload，重复执行后主表总行数保持 `19` 不变。
- 评论主表 readiness 预演入口已接入：`node scripts/preview-douyin-main-table-comment-merge.js`。
- `2026-05-02` 的真实评论双源预演结论已经明确：`account_guard` 通过、作品 `aweme_id` 对齐是 `4/4`；在放大前台抓取配置后，前台评论已达到 `27` 条，和创作者中心的 `29` 条非常接近。两边 `comment_id` 重合仍是 `0`，但按 `work_no + content + created_at + reply_layer` 的语义键已经能对齐 `27/29` 条，剩余 `2` 条是创作者中心独有回复。
- creator 评论昵称字段已经通过 bundle 逆向确认来自 `user_info.screen_name` / `reply_to_user_info.screen_name`；现在 creator 样本里的 `comment_user_name` / `comment_user_photo` 已经完整，前台只需要补 `ip_location`。
- `douyin:creator:comment:write --apply` 已完成真实写库验证：creator-primary 评论集共 `29` 条，语义补齐后仅剩 `2` 条 IP 为空，最终 `matched_current_payload_rows.comments = 29`。
- 同一份 creator-primary 评论输入重复 `--apply` 后，4 条目标作品在 `scrm_comment` 中仍保持 `21 / 2 / 2 / 4 = 29` 条，`matched_current_payload_rows.comments` 继续保持 `29`，说明当前 replace-and-sync 路径对重复执行是稳定的。
- 评论主线现已明确收成：**creator-only 默认可正式写库，public 只作为可选 `ip_location` 补充增强**。不带前台样本时，可通过 `--account-bound` 显式声明账号绑定，当前真实 creator-only `--apply` 也已经验证通过。
- MySQL 5.6 小样本写入已验证；当前评论主线直接写 `scrm_comment`。
- 默认日计划 `npm run daily:douyin` 已经改成创作者中心增量全链路：作品元信息先对比数据库基线，再定向抓评论/弹幕；账号、作品、弹幕、私信和指标统一交给 sink runner 写入，按 `--sink` / 平台配置决定写 `scrm`、`feishu` 或两者。完整慢速校准使用 `npm run daily:douyin:full`。公开主页历史补抓使用 `npm run history:douyin-public`，公开主页日常排障可直接调用 `tasks/daily-douyin-public.json`。
- 公开主页二级回复现场样本已验证：作品 `7631151818891333071` 存在高回复评论，当前扩展回复接口多数返回失败；公开主页评论行已增加 `fetched_reply_count`、`reply_fetch_status`、`reply_fetch_error`，主流程会保留一级评论并暴露降级状态。
- 创作者中心回复样本已验证：本次 4 个作品、25 条一级评论、4 条回复，3 条有回复的一级评论均为 `reply_fetch_status=complete`。
- 创作者中心汇总报告已增加 `counts.reply_fetch_status_counts`，用于直接查看后台回复抓取完整性。
- 创作者中心主表完整写入已验证：4 个作品、29 条评论、4 条回复，重复写入后主表行数保持稳定。
- 桌面任务历史详情已展示创作者中心回复状态：一级评论、回复数、完整/无回复等状态分布。
- 桌面任务报告页已展示“创作者中心回复”面板，顶部统计在创作者中心任务下显示“一级评论 / 回复”。
- 桌面小高度侧栏已验证：`1180×620` 下“配置”入口可点击，装饰区保留且不拦截导航点击。

当前维护重点：

1. 桌面端和计划样本继续按“创作者中心 / 公开主页”拆分，避免默认入口含糊。
2. 如需自动化创作者中心，优先使用 `npm run daily:douyin`，需要慢速校准时使用 `npm run daily:douyin:full`；公开主页批量研究优先使用 `npm run history:douyin-public` 或底层 `tasks/daily-douyin-public.json`。
3. 真实抓取时继续观察公开主页回复接口失败占比，必要时只把公开主页回复作为补充状态，不作为强依赖。
