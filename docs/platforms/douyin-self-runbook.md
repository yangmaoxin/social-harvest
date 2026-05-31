# 抖音自己账号正式运行手册

这份手册只面向 **自己账号 / 创作者中心主线**。

如果目标是抓别人账号，请不要用这份手册，改看：

- [抖音数据源双方案策略](./douyin-source-strategy.md)

一句话规则：

- **自己账号**：创作者中心主线
- **别人账号**：公开主页主线

---

## 1. 这条主线会写什么

当前正式主线会写入 4 张表：

- `scrm_file`
- `scrm_comment`
- `scrm_danmaku`
- `scrm_message`

对应关系：

| 数据域 | 默认来源 | 目标表 | 备注 |
| --- | --- | --- | --- |
| 作品主档 | 创作者中心主写，公开字段可补 | `scrm_file` | 标题 / 封面 / 发布时间可结合前台样本 |
| 评论主档 | 创作者中心主写 | `scrm_comment` | 默认 creator-only；前台只做可选 IP 补充 |
| 弹幕 | 创作者中心唯一主写 | `scrm_danmaku` | 正式写库时会尝试意向分析 |
| 私信 | 创作者中心唯一主写 | `scrm_message` | 只导出本人账号入站单聊消息 |

---

## 2. 默认正式流程

默认增量日常入口是：

```bash
npm run daily:douyin
```

需要慢速完整校准时使用：

```bash
npm run daily:douyin:full
```

底层完整计划仍然是：

- [tasks/daily-douyin.json](../../tasks/daily-douyin.json)

当前步骤顺序：

1. `doctor`
2. `creator-center`
3. `sink-runner --sink-apply`

`creator-center` 只负责产出 `creator-harvest.json`、`account-profile.json`、`private-messages-flat.json` 等采集文件；SCRM、飞书等写入统一由 sink runner 按 `platforms.douyin.sinks` 分发。

直接运行：

```bash
npm run daily:douyin
```

适合场景：

- 想按默认正式链路完整跑一轮
- 不想手工拆步骤
- 已确认当前登录态就是自己账号

---

## 3. 手工分步运行

如果要单独排查某一步，按下面顺序跑。

### 3.1 抓创作者中心样本

```bash
node scripts/harvest-douyin-creator.js --date <YYYY-MM-DD>
```

产物重点看：

- `samples/douyin/<date>/creator-harvest.json`
- `samples/douyin/<date>/creator-harvest-report.json`

### 3.2 作品主表写入

creator-only 直接写：

```bash
node scripts/import-douyin-main-table-file-to-scrm.js \
  --date <YYYY-MM-DD> \
  --account-bound \
  --apply
```

如需公开字段补充，再额外提供前台样本：

```bash
node scripts/import-douyin-main-table-file-to-scrm.js \
  --date <YYYY-MM-DD> \
  --front-input samples/douyin/<YYYY-MM-DD>/<account-id>/harvest.json \
  --apply
```

### 3.3 评论主表写入

默认 creator-only：

```bash
node scripts/import-douyin-main-table-comment-to-scrm.js \
  --date <YYYY-MM-DD> \
  --account-bound \
  --apply
```

如需补 `ip_location`，显式开启：

```bash
node scripts/import-douyin-main-table-comment-to-scrm.js \
  --date <YYYY-MM-DD> \
  --front-input /tmp/douyin-public-full-comments/<account-id>/harvest.json \
  --supplement-public-ip \
  --apply
```

### 3.4 弹幕写入

```bash
node scripts/import-danmaku-to-scrm.js --platform douyin --date <YYYY-MM-DD> --apply
```

### 3.5 私信导出 / 入库

```bash
node scripts/sync-douyin-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

抖音私信只采集创作者中心网页端可见正文；提示“请打开抖音 app 查看”的 app-only 消息会跳过，不作为缺失。

如果用户明确要求“全量私信”，优先使用 runner 的断点模式：

```bash
node scripts/task-runner.js run --display detailed --platform douyin --task creator-messages --output-dir samples/tasks/douyin-messages-full -- --full --batch-size 20 --message-limit 500 --all-messages
```

该模式会在输出目录写 `private-messages-checkpoint.json`。每完成一个会话就保存一次断点；下次不传 `--refresh` 时默认续跑，传 `--refresh` 表示重置后从头开始。

---

## 4. 什么时候用 `--account-bound`

`--account-bound` 的意思是：

> 你明确知道当前创作者中心登录态就是目标账号，不再要求前台样本参与 `account_guard`。

建议使用时机：

- 只跑 creator-only 主线
- 没准备前台样本
- 这是本人账号的正式日常任务

不建议盲用的时机：

- 你不确定当前登录的是不是目标账号
- 样本目录可能混了别的账号
- 你正准备做双源字段校验

简单判断：

- **日常自己账号正式跑**：可以用
- **排查双源字段冲突**：优先不给，先让 `account_guard` 正常校验

---

## 5. 什么时候补评论 IP

评论主表默认按 creator-only 跑，**不把前台评论当硬依赖**。

只有在下面情况，才建议加 `--supplement-public-ip`：

- 业务确实需要 `ip_location`
- 愿意额外准备前台评论样本
- 接受仍可能有少量 creator 独有回复没有 IP

不需要补 IP 的情况：

- 只是日常入库
- 当前主要看评论内容、昵称、头像、回复关系
- 不想让前台评论链路影响 creator 主线稳定性

当前已知现实：

- creator 评论主线已经能稳定拿到：
  - `comment_user_name`
  - `comment_user_photo`
- 前台当前最主要的补充价值就是：
  - `ip_location`

---

## 6. 报告怎么看

### 6.1 总计划报告

计划运行后看：

- `samples/tasks/<task-id>/task-report.json`

报告页现在会把抖音 creator 主线拆成：

- `creator-content`
- `creator-account`
- `account-import`
- `content-import`
- `creator-danmaku`
- `danmaku-import`
- `metric-snapshot-*`
- `metric-delta-*`
- `creator-messages`
- `messages-import`

重点看：

- 每一步状态
- 每一步写入条数
- 每一步子报告

### 6.2 评论 IP 补充报告

如果跑的是 `content-import`，报告会直接显示：

- 是否启用前台 IP 补充
- 有 IP 多少条
- 缺 IP 多少条
- 可语义补位多少条
- creator 独有多少条

判断方式：

- `creator-only`：说明当前没用前台补 IP
- `IP on`：说明这次显式启用了前台 IP 补充

---

## 7. 验收清单

正式跑完一轮后，最少核这几项。

### 7.1 `scrm_file`

确认：

- 目标作品条数符合预期
- `no = aweme_id`
- 图文作品 `file_type = 2`
- 作品标题、封面、发布时间没有明显错位

### 7.2 `scrm_comment`

确认：

- 评论总数符合预期
- `comment_user_name`、`comment_user_photo` 非空比例正常
- 回复关系存在：
  - `parent_comment_id`
  - `root_parent_id`
  - `reply_to_comment_id`
- 如启用前台补 IP，再看：
  - `ip_location` 非空条数是否明显上升

### 7.3 `scrm_danmaku`

确认：

- 条数与页面实际可见弹幕对齐
- `comment_user_name`、`comment_user_photo` 非空
- `intention` 不是整批都被主动跳过

### 7.4 `scrm_message`

确认：

- 导出的都是本人账号入站单聊消息
- 没把自己发出的消息混进去
- 行数增长合理

---

## 8. 常见决策

### 场景 A：只想稳定跑正式主线

直接跑：

```bash
npm run daily:douyin
```

### 场景 B：只想跑 creator，不想依赖前台

用：

- `creator-content`
- `sink-runner --sink scrm --sink-apply`

### 场景 C：评论还想补 IP

额外准备前台样本，再加：

- `--front-input ...`
- `--supplement-public-ip`

### 场景 D：要检查是不是同一个账号

不要急着加 `--account-bound`，先跑带前台样本的 preview / import，让 `account_guard` 自己判断。

---

## 9. 当前边界

这份手册描述的是 **当前已经验证通过的正式主线**。

当前不阻塞主线的增强项：

- 评论 IP 更多补齐策略
- 前台更多自动化辅助策略
- 更细的报告/告警产品化

也就是说：

**现在已经可以按这份手册正式跑抖音自己账号主线。**
