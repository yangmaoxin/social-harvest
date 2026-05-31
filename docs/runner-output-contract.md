# 任务 Runner 输出契约

这份文档固定桌面端读取 runner 产物的字段边界。桌面端只能依赖这里定义的契约，不直接解析平台 stdout。

## 1. 文件

每个任务输出目录至少包含：

| 文件 | 用途 |
| --- | --- |
| `task-events.jsonl` | 实时事件流和历史回放 |
| `task-state.json` | 当前状态快照 |
| `task-report.json` | 结束报告 |

平台脚本仍可输出自己的 `run-report.json`、`private-messages-report.json` 等文件，但 UI 第一层只依赖 runner 汇总后的统一产物。

## 2. Schema

Schema 文件：

- [task-event.schema.json](schemas/task-event.schema.json)
- [task-state.schema.json](schemas/task-state.schema.json)
- [task-report.schema.json](schemas/task-report.schema.json)

状态枚举：

- `pending`
- `running`
- `success`
- `warning`
- `partial`
- `failed`
- `cancelled`

## 3. Fixture

UI 开发优先使用这些固定样例：

| 状态 | `task-state.json` | `task-report.json` |
| --- | --- | --- |
| success | success-task-state.json | success-task-report.json |
| warning | warning-task-state.json | warning-task-report.json |
| failed | failed-task-state.json | failed-task-report.json |
| partial | partial-task-state.json | partial-task-report.json |
| cancelled | cancelled-task-state.json | cancelled-task-report.json |

## 4. 兼容规则

- 新增字段可以追加，不能改名或删除已公开字段。
- 状态值只能使用枚举里的值。
- `summary_text` 必须是一句可以直接展示给用户的摘要。
- `next_actions` 必须是用户可执行的下一步建议。
- 失败报告可以追加 `failure_category` 和 `failure_title`；UI 应优先展示归类后的标题、摘要和 `next_actions`，原始 `error` 放在高级信息里。
- `repro_command` 必须是可复现当前任务的最小 npm 命令，不承载密码、cookie、token 等敏感值。
- `verification_commands` 必须是修复或继续前的最小验证命令，优先来自 [Harness Validation Matrix](harness/harness-validation-matrix.md)。
- `retriable` 表示是否值得不改配置/代码直接重试；`requires_human_action` 表示是否需要先由人处理登录、配置、权限或本地 override。
- `evidence_files` 使用相对 `output_dir` 的路径，优先列 JSON / JSONL 证据文件。
- `suggested_skill` 给后续 agent 路由使用；默认可用 `social-harvest-operator`。
- `harness_warnings` 只放不阻断本次任务、但会影响后续稳定性的环境或编排 warning。
- `artifacts[*].path` 必须是文件或目录路径。
- `warnings` 只放需要用户注意但不阻止任务完成的事项。
- `error` 只放最终失败原因，不承载长日志。

## 5. UI 读取优先级

运行中：

1. 读 `task-state.json` 展示当前状态。
2. 增量读 `task-events.jsonl` 展示事件流。
3. 不读取 stdout。

结束后：

1. 读 `task-report.json` 展示报告。
2. 根据 `artifacts` 打开平台报告或输出目录。
3. 原始 JSON 只放在高级展开区。

## 6. 变更流程

改动 runner 输出字段时必须同步：

1. 更新 schema。
2. 更新 fixture。
3. 更新本文件说明。
4. 更新相关测试。
5. 确认桌面端 UI 没有依赖旧字段。
