# Task Report Agent Fields Proposal

更新日期：2026-05-10

这份文档定义 `task-report.json` 已落地的第一批 agent-friendly 字段。目标不是替代现有报告，而是让 agent 在读完报告后能更少猜测下一步。

## 背景

当前 `task-report.json` 已经有：

- `status`
- `summary_text`
- `artifacts`
- `recoverable`
- `next_actions`
- `error`
- `platform_report`

这些字段适合 UI 和人类阅读，但 agent 在恢复失败或继续验证时，还需要更明确的复现命令、验证命令、是否需要人工介入和证据文件。

本轮 diagnostic dry-run 发现的缺口：

- 成功报告没有告诉 agent 下一条验证命令。
- OpenCLI doctor stdout 中出现 “local adapter overrides shadow packaged adapters” issue，但 runner 摘要里没有升级为 warning。
- `next_actions` 在 success 时为空，agent 需要自己推断后续要做什么。

## 已落地字段

### `repro_command`

用途：复现本次任务的最小命令。

示例：

```json
{
  "repro_command": "node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/diagnostic-demo"
}
```

规则：

- 应尽量使用 npm scripts。
- 不包含密钥、cookie、密码。
- 如果命令包含本地绝对路径，优先转成相对路径或 `<path>` 占位。

### `verification_commands`

用途：告诉 agent 修复或运行后最小应该跑哪些验证。

示例：

```json
{
  "verification_commands": [
    "npm run check",
    "npm run test -- scripts/task-runner.test.js"
  ]
}
```

规则：

- 命令来自 [Social Harvest Harness Validation Matrix](harness-validation-matrix.md)。
- 数量保持少，优先 1-3 条。
- 用户明确要求“同步”时，真实写库计划是默认路径；只有用户明确要求试跑/预览/不写入时，才给 dry-run 验证命令。

### `retriable`

用途：标记是否值得不改代码直接重试。

示例：

```json
{
  "retriable": true
}
```

建议：

| 失败类型 | retriable |
| --- | --- |
| 网络瞬断、Chrome 短暂断连 | `true` |
| 平台登录态过期 | `false`，需要人工登录 |
| schema 缺失 | `false`，需要补表结构 |
| report 损坏 | `false`，需要修 runner |

### `requires_human_action`

用途：标记是否必须人类先介入。

示例：

```json
{
  "requires_human_action": true
}
```

典型需要人工介入：

- 平台登录。
- 用户要求试运行后，又临时改成正式写库。
- 数据库权限或表结构变更。
- 删除本地 adapter override。

### `evidence_files`

用途：列出 agent 下一步应该打开的证据文件。

示例：

```json
{
  "evidence_files": [
    "task-events.jsonl",
    "diagnostic/doctor-report.json"
  ]
}
```

规则：

- 相对 `output_dir`。
- 优先列结构化 JSON / JSONL。
- 长 stdout 不直接塞进报告。

### `suggested_skill`

用途：提示 agent 下一步适合使用哪个 skill。

示例：

```json
{
  "suggested_skill": "social-harvest-operator"
}
```

其他可能值：

- `opencli-autofix`
- `opencli-adapter-author`
- `opencli-browser`

### `harness_warnings`

用途：承载不影响任务成功、但会影响后续稳定性的 harness 级 warning。

示例：

```json
{
  "harness_warnings": [
    {
      "category": "environment.opencli_override",
      "message": "Local adapter overrides shadow packaged adapters.",
      "next_actions": [
        "Confirm whether the local adapter is a required project runtime adapter before resetting it.",
        "If only a local file shadows a packaged command, rename or back up that file first."
      ]
    }
  ]
}
```

适合放入 `harness_warnings` 的情况：

- 本地 adapter override。
- diagnostic 跳过平台登录检查。
- 当前任务是 dry-run，尚未正式写库。
- 使用了 fallback 路径或本地覆盖。

## 实现状态

1. 已在 runner report 构造处增加 `repro_command` 和 `verification_commands`。
2. 已把 OpenCLI doctor 的 `issues` 映射到 `harness_warnings`。
3. 已给失败分类补 `retriable` 和 `requires_human_action`。
4. 已更新 schema、fixtures、`../runner-output-contract.md` 和测试。

## 完成标准

- agent 读到成功报告时，知道下一步验证命令。
- agent 读到失败报告时，知道是否能重试、是否需要人类动作、该打开哪些证据文件。
- UI 不需要立刻展示全部新字段，但不能因为新增字段报错。
