# Runner

当前统一 runner CLI 入口是 `scripts/task-runner.js`，runner 内核已抽到本目录。

`scripts/task-runner.js` 现在是薄 CLI 入口。用户一线采集走 `daily:*` / `history:*`，排障或内部编排才直接调用它：

- `node scripts/task-runner.js list`
- `node scripts/task-runner.js run`
- `node scripts/task-runner.js plan`

迁移原则：

- 先移动可复用纯逻辑，再移动 CLI 入口。
- 保留 `scripts/task-runner.js` 作为稳定 CLI 入口。
- 每次移动后同步 schema、fixture、文档和测试。
- 具体拆分顺序见 [Runner Extraction Plan](extraction-plan.md)。

当前已落地：

- `reports.js`：`task-state.json`、`task-report.json`、artifacts、counters、repro/verification/evidence 字段构建。
- `platform-output.js`：抖音、视频号、diagnostic/import stdout 与平台报告摘要。
- `plans.js`：计划任务 JSON 解析、计划内任务参数整理和计划摘要文本。
- `events.js`：runner 事件输出、child stdout/stderr 进度解析和运行中状态桥接。
- `arg-forwarding.js`：composite task 的平台参数白名单和转发规则。
- `executor.js`：单任务执行、计划执行、子进程启动和状态/报告写入。

最小验证：

```bash
npm run test -- scripts/task-runner.test.js
node scripts/task-runner.js list --json
node scripts/task-runner.js plan --config tasks/smoke-douyin-public.json --output-dir samples/tasks/smoke-douyin-public-demo
```
