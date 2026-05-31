# Social Harvest Platform Dry Run

更新日期：2026-05-10

这份 runbook 用来验证 Social Harvest 的平台级 harness 闭环：

```text
agent preflight -> platform diagnostic -> small platform task -> task-report.json -> 验证结论
```

它不做正式 SCRM 写入，适合在 runner、报告字段、平台脚本或 operator skill 改动后确认链路仍然可用。

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
- `node-version` 满足 `>=24 <25`。
- `opencli`、`config`、`chrome` 检查通过。

### 3. 跑平台登录/API 诊断

以抖音为例：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/social-harvest-douyin-platform-diagnostic -- --check-platforms --platform douyin
```

完成标准：

- `task-report.json` 的 `status` 为 `success`。
- `platform_report.failed_checks` 为 `0`。
- `doctor-report.json` 中对应平台检查为 `ok`。
- 如出现 `harness_warnings`，按报告里的 `next_actions` 判断是否阻断后续任务。

### 4. 跑最小平台采集 dry-run

以抖音公开内容为例：

```bash
node scripts/task-runner.js run --platform douyin --task public-content --output-dir samples/tasks/social-harvest-douyin-public-dry-run -- --video-limit 1 --comment-limit 1 --without-replies --retry 0
```

也可以使用不含 `--apply` 的 smoke plan：

```bash
node scripts/task-runner.js plan --config tasks/smoke-douyin-public.json --output-dir samples/tasks/smoke-douyin-public-demo
```

完成标准：

- `task-report.json` 的 `status` 为 `success`。
- `summary_text` 能直接说明采集结果。
- `counters.accounts`、`counters.works`、`counters.comments` 有合理值。
- `repro_command` 可复现本次任务。
- `evidence_files` 至少包含 `task-report.json`、`task-events.jsonl`、平台汇总文件。
- 任务报告或平台报告显示未正式写库。

## 本轮样本结论

在 2026-05-10 的本机 dry-run 中：

- `diagnostic --check-platforms --platform douyin` 成功，平台公开采集 API 检查通过。
- 抖音最小公开内容采集成功，产出 1 个账号、1 个作品、1 条评论。
- 抖音公开采集报告中 `imported` 为 `false`，`import_applied` 为 `false`。
- `task-report.json` 给出了 `repro_command`、`verification_commands`、`evidence_files` 和 `suggested_skill`。
- 已新增 `tasks/smoke-douyin-public.json`，作为不含正式写库参数的计划任务 smoke 入口。

本轮输出目录：

- `samples/tasks/social-harvest-douyin-platform-diagnostic`
- `samples/tasks/social-harvest-douyin-public-dry-run`

## 后续判断

平台 dry-run 成功后，才进入更高风险步骤：

- 扩大 `--video-limit` / `--comment-limit`。
- 跑 importer dry-run。
- 如果是开发验证语境，人工确认字段和行数后再考虑底层 `--apply`；如果是用户明确要求同步，则按正式同步计划写入。
