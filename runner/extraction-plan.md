# Runner Extraction Plan

更新日期：2026-05-15

这份文档记录 `scripts/task-runner.js` 迁到 `runner/` 的拆分顺序、完成标准和当前结果。现在 `scripts/task-runner.js` 是薄 CLI 入口。

## 当前边界

迁移前，`scripts/task-runner.js` 同时承担四类职责：

| 职责 | 当前内容 | 风险 |
| --- | --- | --- |
| CLI 入口 | `list`、`run`、`plan`、help 和参数解析 | 一线 npm scripts 和文档通过它间接运行任务 |
| 任务执行 | 启动 Node 子进程、桥接 stdout/stderr、写事件和状态 | 改动会影响 CLI 任务运行、计划任务和失败恢复 |
| 报告生成 | `task-state.json`、`task-report.json`、artifacts、next actions | 字段变更会影响 schema、fixture、operator skill 和报告读取 |
| 平台输出摘要 | 抖音、视频号、diagnostic/import 输出解析 | 改动容易造成 report counters 和 summary 漂移 |

外部依赖的稳定入口：

- `package.json` 的 `daily:*` / `history:*` 一线入口。
- 排障文档中的 `node scripts/task-runner.js list|run|plan`。
- `scripts/task-runner.test.js` 的具名导入。
- 文档和 runbook 中的 `scripts/task-runner.js` CLI 入口。

## 目标模块

最终目标是让 `scripts/task-runner.js` 只保留薄 CLI 入口，其余逻辑落到 `runner/`。

| 目标文件 | 建议职责 | 首批是否移动 |
| --- | --- | --- |
| `runner/events.js` | `emitTaskEvent`、`childEventFromLine`、child stdout/stderr 事件桥接 | 已完成 |
| `runner/reports.js` | `buildTaskState`、`buildTaskReport`、artifacts、counters、repro/verification/evidence 字段 | 已完成 |
| `runner/platform-output.js` | `summarizeTaskOutput`、`summarizePlatformOutput` 和各平台 stdout/report 摘要 | 已完成 |
| `runner/plans.js` | `loadTaskPlan`、`planScopedTaskArgs`、plan summary 和 plan 参数整理 | 已完成 |
| `runner/arg-forwarding.js` | composite task 的平台参数白名单和转发规则 | 已完成 |
| `runner/executor.js` | `runPlatformTask`、`runTaskPlan`、`runCommand` | 已完成 |
| `scripts/task-runner.js` | CLI 参数解析、help、兼容 re-export、`main()` | 已保留 |

## 拆分顺序

1. 抽 `runner/reports.js`。
   只移动纯 report/state helper，`scripts/task-runner.js` 继续 re-export 原有具名 API。
2. 抽 `runner/platform-output.js`。
   只移动 stdout/report 摘要函数，不改变 counters、summary_text 和 warnings 输出。
3. 抽 `runner/plans.js`。
   只移动 plan 解析和参数整理，`runTaskPlan` 暂时不动。
4. 抽 `runner/events.js`。
   等 report 和 plan 都稳定后，再移动事件桥接，避免同时改 stdout 流和报告字段。
5. 最后抽 `runner/executor.js`。
   这是唯一会触碰子进程执行、输出目录、事件文件写入的批次，必须单独验证。

## 保持不变

- 一线 npm scripts 继续通过 `node scripts/task-runner.js ...` 间接运行任务。
- 排障和内部编排继续直接调用 `node scripts/task-runner.js ...`。
- `scripts/task-runner.test.js` 的导入路径先不变，通过 re-export 保持兼容。
- `task-report.json` 字段和 `docs/schemas/task-report.schema.json` 不因目录迁移而改变。

## 当前进展

- [x] Batch 1：已抽 `runner/reports.js`，`scripts/task-runner.js` 继续 re-export `buildTaskState` 和 `buildTaskReport`。
- [x] Batch 2：已抽 `runner/platform-output.js`，`scripts/task-runner.js` 继续 re-export `summarizeTaskOutput` 和 `summarizePlatformOutput`。
- [x] Batch 3：已抽 `runner/plans.js`，`runTaskPlan` 执行循环仍留在 CLI 入口。
- [x] Batch 4：已抽 `runner/events.js`，并用 diagnostic 任务验证事件和状态链路。
- [x] Batch 5：已抽 `runner/executor.js`，`scripts/task-runner.js` 已退为薄 CLI 入口。
- [x] Batch 6：已抽 `runner/arg-forwarding.js`，让 composite 参数转发规则从执行器中独立出来。

## 每批验证

每个抽取批次至少运行：

```bash
npm run test -- scripts/task-runner.test.js
node scripts/task-runner.js list --json
git diff --check
```

触碰执行器或事件桥接时追加：

```bash
node scripts/task-runner.js plan --config tasks/smoke-douyin-public.json --output-dir samples/tasks/smoke-douyin-public-demo
```

如果改动了 report 字段，还必须同步：

- `docs/schemas/task-report.schema.json`
- `test-support/fixtures/runner/*-task-report.json`
- `docs/runner-output-contract.md`
- `docs/harness/harness-report-agent-fields.md`

## 完成定义

runner 内核抽取完成必须同时满足：

- `scripts/task-runner.js` 只保留 CLI、help、参数入口和兼容 re-export。
- `runner/` 中模块职责清晰，没有依赖桌面源码。
- 所有 npm scripts、桌面 task service、operator skill 仍能沿用原命令。
- `task-report.json`、`task-state.json`、`task-events.jsonl` 行为不漂移。
- validation matrix 中 runner 相关验证全部通过。
