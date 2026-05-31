# 视频号助手正式运行手册

这份手册只面向 **微信视频号助手后台主线**。

目标是回答四件事：

1. 正式怎么跑
2. 会写哪些表
3. 什么时候单独跑私信 / 弹幕
4. 跑完后看哪些表验收

如果你只关心私信，直接看：

- [微信视频号私信流程](./weixin-channels-private-message-runbook.md)

如果你想看更完整的字段映射和边界说明，再回到：

- [微信视频号抓取与 SCRM 入库操作手册](./weixin-channels-scrm-operator-guide.md)

---

## 1. 这条主线会写什么

视频号助手正式主线会写入 4 张表：

- `scrm_file`
- `scrm_comment`
- `scrm_danmaku`
- `scrm_message`

对应关系：

| 数据域 | 默认来源 | 目标表 | 备注 |
| --- | --- | --- | --- |
| 作品 / 图文主档 | 视频号助手主流程 | `scrm_file` | 视频和图文统一写入 |
| 评论 / 回复 | 视频号助手主流程 | `scrm_comment` | 回复关系一起写入 |
| 弹幕 | 视频号助手弹幕导出 | `scrm_danmaku` | 可挂在主流程里，也可单独跑 |
| 私信 / 打招呼 | 视频号助手私信导出 | `scrm_message` | 可挂在主流程里，也可单独跑 |

---

## 2. 默认正式流程

当前最推荐的正式命令是：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --refresh
```

这条命令默认会按顺序执行：

1. 抓作品、图文、评论、回复
2. 导出 `danmaku-flat.json`
3. 导出 `private-messages-flat.json`
4. 正式写入：
   - `scrm_file`
   - `scrm_comment`
   - `scrm_danmaku`
   - `scrm_message`

适合场景：

- 想按当前正式主流程完整跑一轮
- 想让作品 / 评论 / 弹幕 / 私信一起落库
- 已确认浏览器登录态正常

---

## 3. 当前日计划和正式主流程的区别

当前计划文件：

- [tasks/daily-weixin-channels.json](../../tasks/daily-weixin-channels.json)

它现在已经是**正式日常全流程计划**，步骤是：

1. `doctor`
2. `harvest --refresh`

这意味着它会沿主流程一起完成：

- 作品 / 评论 / 回复抓取与入库
- 弹幕导出与 `scrm_danmaku` 入库
- 私信导出与 `scrm_message` 入库

所以现在要区分的是：

- **正式日常主流程**：用 `npm run daily:weixin-channels`
- **完整慢流程校准**：用 `npm run daily:weixin-channels:full`

两者差别主要在抓取范围：

- `daily:weixin-channels` 是默认增量日常，步骤完整，评论/弹幕只定向抓新增、计数增长或近期复查对象
- `daily:weixin-channels:full` 是完整慢流程校准，用于排查漏抓或重新校准，不是历史翻页全量
- `node scripts/task-runner.js run --platform weixin-channels --task creator-content ...` 只在排障单个底层任务时使用
- 报告页现在会把主流程拆成“稿件 / 弹幕 / 私信 / 主流程总览”四块，方便复盘每一段是否真正完成

---

## 4. 手工分步运行

如果要单独排查某一步，按下面分开跑。

### 4.1 主流程：作品 / 评论 / 回复

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --refresh
```

如果你这轮只想抓样本，不正式写 `scrm_file` / `scrm_comment`：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- \
  --date <YYYY-MM-DD> \
  --refresh \
  --no-import-scrm
```

### 4.2 私信脚本排障

```bash
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

### 4.3 弹幕脚本排障

```bash
node scripts/sync-weixin-channels-danmaku-to-scrm.js --date <YYYY-MM-DD> --apply
```

### 4.4 已有样本时单独导入

主线优先使用统一 sink runner：

```bash
npm run sink:run -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --sink scrm --sink-apply
```

下面这些是 SCRM 底层导入器，主要用于排障和兼容验证。

作品 / 评论：

```bash
node scripts/import-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD> --apply
```

私信：

```bash
node scripts/import-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

弹幕：

```bash
node scripts/import-danmaku-to-scrm.js --platform weixin-channels --date <YYYY-MM-DD> --apply
```

---

## 5. 常用开关怎么用

### 5.1 缩小范围排查

适合本地快验：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- \
  --date <YYYY-MM-DD> \
  --post-limit 2 \
  --image-text-limit 2 \
  --work-limit 3 \
  --refresh
```

### 5.2 暂时不写作品 / 评论

```bash
--no-import-scrm
```

### 5.3 暂时不写弹幕

```bash
--no-import-scrm-danmaku
```

### 5.4 暂时不写私信

```bash
--no-import-scrm-message
```

### 5.5 只想看 dry-run，不正式写库

```bash
--import-scrm
--import-scrm-danmaku
--import-scrm-message
```

这几个开关会把对应正式入库降级成 dry-run。

---

## 6. 运行前提

最少需要：

1. `Node.js 24.x`
2. 浏览器已登录微信视频号助手后台
3. 数据库配置已就绪
4. 唯一索引已存在

建议先人工确认这两个页面能打开：

- `https://channels.weixin.qq.com/platform/post/list`
- `https://channels.weixin.qq.com/platform/interaction/comment`

---

## 7. 产物怎么看

默认输出目录：

- `samples/weixin-channels/<date>/`

最重要的文件：

- `harvest.json`
- `works.json`
- `posts.json`
- `image-texts.json`
- `private-messages-flat.json`
- `danmaku-flat.json`
- `progress.json`
- `run-report.json`

如果是完整主流程，优先先看：

- `run-report.json`

它会汇总：

- 作品 / 图文 / 评论 / 回复统计
- 私信导出 / 入库状态
- 弹幕导出 / 入库状态
- 预检状态
- warnings
- 下一步恢复建议

---

## 8. 验收清单

正式跑完一轮后，最少核这几项。

### 8.1 `scrm_file`

确认：

- 作品总数增长合理
- `no` 正常
- `file_type` 区分视频 / 图文正常
- 标题、封面、发布时间无明显错位

### 8.2 `scrm_comment`

确认：

- 评论总数增长合理
- `parent_comment_id`
- `root_parent_id`
- `reply_to_comment_id`
  三层回复关系存在
- `intention` 没有异常大面积为 `0`

### 8.3 `scrm_danmaku`

确认：

- 条数增长合理
- `danmaku_id` 去重正常
- `comment_user_name` / `comment_user_photo` / `content` 正常
- `intention` 不是被主动跳过

### 8.4 `scrm_message`

确认：

- 行数增长合理
- `comment_id` 唯一约束正常工作
- 只写入对方发来的消息
- `intention` 没有异常大面积为 `0`

---

## 9. 常见决策

### 场景 A：想完整跑一轮正式主线

用：

```bash
node scripts/task-runner.js run --platform weixin-channels --task creator-content -- --date <YYYY-MM-DD> --refresh
```

### 场景 B：只想抓样本，不正式写作品 / 评论

用：

```bash
--no-import-scrm
```

### 场景 C：作品 / 评论已经抓好了，只补私信

用：

```bash
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

### 场景 D：作品 / 评论已经抓好了，只补弹幕

用：

```bash
node scripts/sync-weixin-channels-danmaku-to-scrm.js --date <YYYY-MM-DD> --apply
```

### 场景 E：想先看结果再决定要不要写库

优先用：

- `--import-scrm`
- `--import-scrm-danmaku`
- `--import-scrm-message`

把正式写库降成 dry-run。

---

## 10. 当前边界

这份手册描述的是 **当前已经稳定可用的正式主线**。

当前不阻塞主线的增强项：

- 更细的历史/异常可视化
- 更多真实失败样本与恢复建议

也就是说：

**现在已经可以按这份手册正式跑视频号助手主线。**
