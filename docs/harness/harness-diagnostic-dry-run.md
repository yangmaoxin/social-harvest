# Social Harvest Diagnostic Dry Run

更新日期：2026-05-10

这份 runbook 用来验证 Social Harvest 的最小 harness 闭环：

```text
agent preflight -> diagnostic runner -> task-report.json -> 验证结论
```

它不做平台采集，不写 SCRM，适合作为新环境、新 agent 或改动后的第一条验证链路。

## 运行步骤

### 1. 切到 Node 24

```bash
source ~/.nvm/nvm.sh
nvm use 24
```

### 2. 跑 agent preflight

```bash
npm run check
```

完成标准：

- `status` 为 `passed`。
- `node-version` 为 `passed`。
- `opencli`、`config`、`chrome` 至少不是 `failed`。

### 3. 跑 diagnostic runner

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/social-harvest-diagnostic-dry-run
```

完成标准：

- 命令退出码为 `0`。
- 输出目录里存在：
  - `task-events.jsonl`
  - `task-state.json`
  - `task-report.json`
  - `diagnostic/doctor-report.json`

### 4. 读取 task report

```bash
sed -n '1,220p' samples/tasks/social-harvest-diagnostic-dry-run/task-report.json
```

完成标准：

- `status` 为 `success`。
- `summary_text` 可以直接给人看。
- `platform_report.failed_checks` 为 `0`。
- `artifacts` 列出任务报告、任务状态、事件和平台报告。
- `repro_command`、`verification_commands`、`evidence_files` 能支持后续 agent 继续操作。
- `harness_warnings` 如有内容，必须给出明确 `category`、`message` 和 `next_actions`。

## 本轮样本结论

在 2026-05-10 的本机 dry-run 中：

- Node 24.x 下 `npm run check` 通过；当前项目约束是 `>=24 <25`。
- `diagnostic` runner 检查 13 项，失败 0 项，警告 0 项。
- OpenCLI doctor 额外提示本地 adapter override 会遮蔽 packaged adapter，已映射为 `environment.opencli_override`。
- 未带 `--check-platforms` 的诊断会把平台登录检查跳过，已映射为 `diagnostic.platform_login_skipped`。

## 后续平台验证

最小 diagnostic 闭环通过后，再按 [Social Harvest Platform Dry Run](harness-platform-dry-run.md) 跑平台级 dry-run。
