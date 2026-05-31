# 实时分享运行过程

这是一个**可选功能**。正常采集不需要使用它；只有用户明确想把运行过程实时同步到 Go 后端和远程页面时，才用 `share:run` 包一层真实命令。

Go 后端接口：

- `POST /scrm/terminal/events`：上报实时展示事件
- `GET /scrm/terminal/events`：分页查询历史事件
- `GET /scrm/terminal/stream`：SSE 实时推送

当前不需要鉴权。

## 基本用法

```bash
npm run share:run -- \
  --server http://127.0.0.1:8001 \
  --task-id weixin-2026-05-13 \
  --device-id remote-win-01 \
  -- \
  npm run daily:weixin-channels
```

`--` 前面是发送器参数，`--` 后面是真正要执行的采集命令。

远端详细展示模式推荐包裹 `daily:*` 或 `history:*` 一线命令。排障时才直接包裹 `node scripts/task-runner.js run ...`。

## 用户怎么对 AI 说

普通用户不需要记住 `share:run`、`--display detailed` 或多个 `--`。建议让用户直接用业务话术：

```text
帮我跑今天的抖音创作者中心数据，并把抓取过程同步到远端页面。
服务器是 http://127.0.0.1:8001，设备名 remote-win-01，任务 ID 用 douyin-creator-今天日期。
本机和远端都要显示详细进度。
```

AI 应该自己转换成：

```bash
npm run share:run -- --server http://127.0.0.1:8001 --task-id douyin-creator-<YYYY-MM-DD> --device-id remote-win-01 -- npm run daily:douyin
```

如果用户只是说“详细看看过程”，但没有说远端页面或服务器同步，不要使用 `share:run`，只用：

```bash
npm run daily:douyin
```

如果用户只是说“跑今天数据”或“同步一下”，不要加远端分享。日常命令默认展示给人看的进度；不要为了隐藏原始 JSON 把已有 `--display detailed` 入口改成 `compact`。

## 命令拼接规则

远端详细展示命令里会有多个 `--`。它们的顺序固定，不要调整：

```text
npm run share:run -- <发送器参数> -- <采集命令>
```

含义：

- 第一个 `--`：把后面的参数传给 `share:run`。
- 第二个 `--`：告诉 `share:run` 后面是真正要执行的采集命令。
- 采集命令：通常是 `npm run daily:*` 或 `npm run history:*`；排障时可以是 `node scripts/task-runner.js run ...`。
- 最后一个 `--`：把日期、刷新、limit 等参数传给具体平台脚本。

这些横线是 AI 和脚本的约定，普通用户不需要理解。

## 上报字段

发送器会按 Go 后端事件契约发送：

```json
{
  "device_id": "remote-win-01",
  "task_id": "weixin-2026-05-13",
  "level": "info",
  "message": "日志内容",
  "occurred_at": "2026-05-13T08:00:00.000Z"
}
```

如果终端行是 `TASK_EVENT {...}` 或 `OPENCLI_PROGRESS {...}`，发送器会先转成前端适合展示的文本再上报，例如：

```text
[12:10:21] 评论第 2 页返回 20 条，当前作品累计一级评论 42 条
[12:10:28] 正在抓第 2/4 个作品的弹幕：《新品发布现场》
```

默认只上报这些实时展示事件和 stderr 里的进度/错误日志，不再上报普通 stdout，也会过滤原始 JSON 形态的行。这样可以避免把采集命令最后输出的大段 JSON 报告推到前端，同时保留人能看懂的详细进度。

## 断网处理

单条日志发送失败后会重试，仍失败则写入本地队列文件：

```text
.harvest-terminal-log-spool.jsonl
```

下次启动发送器时会先尝试补发队列里的日志。

## 常用参数

- `--server`：Go 后端地址，例如 `http://127.0.0.1:8001`
- `--task-id`：这轮任务 ID，前端和后端查询会用它筛选日志
- `--device-id`：远程电脑标识，例如 `remote-win-01`
- `--spool-file`：失败日志本地队列文件
- `--passthrough`：调试时才使用。本机终端也继续显示子命令 stdout/stderr，因此可能看到采集脚本输出的大段 JSON。
- `--include-raw-output`：调试时才使用。连普通 stdout 也一起上报，因此可能把大段 JSON 报告推到前端。
- `--quiet`：隐藏发送器自己的本地状态提示。

默认不要加 `--passthrough` 或 `--include-raw-output`。这样不会显示/推送原始 stdout 和大段 JSON，但本机终端仍会显示和远端页面一致的详细展示消息。

发送器默认会在本地终端同时打印两类内容：

- `[live-share] ...`：发送器自己的本地状态，帮助判断命令是否启动、是否结束。
- `[时间] 正在做什么...`：真正同步给 Go 后端的详细展示消息，本机和远端看到的是同一份内容。

示例：

```text
[live-share] starting task douyin-creator-2026-05-13 on remote-win-01
[live-share] forwarding display events to http://127.0.0.1:8001/scrm/terminal/events
[12:10:01] 远端详细展示已启动：任务 douyin-creator-2026-05-13，设备 remote-win-01
[live-share] child command spawned: npm run daily:douyin
[12:10:12] 正在打开抖音创作者中心，等待作品、评论和弹幕数据返回
[12:10:31] 评论第 1 页返回 20 条，当前作品累计一级评论 20 条
[12:10:45] 本轮采集完成：作品 4，评论 25，回复 4，弹幕 11
[12:10:33] 远端详细展示结束：退出码 0，已发送 6 条，暂存 0 条，隐藏 stdout 42 行
[live-share] finished with exit code 0; sent 6, spooled 0, hidden stdout 42
```

所以远端详细展示模式下，本机和远端都看详细模式；区别只是本机用终端显示，远端用页面显示。
