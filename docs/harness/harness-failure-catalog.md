# Social Harvest Failure Catalog

更新日期：2026-05-10

这份文档收集 Social Harvest 常见失败类型、最小复现方式和恢复建议。它服务于 agent 和人类共同排障：先分类，再复现，再修复，最后按验证矩阵确认。

## 使用方式

1. 保留失败任务输出目录，不要先删产物。
2. 优先读取 `task-report.json`。
3. 如果报告损坏或缺失，再看 `task-state.json` 和 `task-events.jsonl`。
4. 对照本文找到最接近的失败类型。
5. 跑对应最小复现命令。
6. 修复后按 [Social Harvest Harness Validation Matrix](harness-validation-matrix.md) 验证。

## 失败类型速查

| 类型 | 常见表现 | 最小复现 | 首选恢复 |
| --- | --- | --- | --- |
| `environment.node_version` | npm 脚本、typecheck、构建行为异常 | `npm run check` | `nvm use 24` 后重跑 |
| `environment.opencli_missing` | `opencli: command not found` 或 unknown runtime | `npm run check`、`opencli --version` | 使用项目 npm scripts、`npx opencli` 或安装/sync adapter |
| `environment.opencli_override` | 本地 adapter 覆盖 packaged adapter | `node scripts/task-runner.js run --task diagnostic` | 先确认是否是项目需要的用户级 runtime adapter；不要自动 reset。若只是单个文件名 shadow 官方命令，优先改名/备份冲突文件 |
| `browser.chrome_unavailable` | 无法连接 Chrome、插件不可用 | `node scripts/task-runner.js run --task diagnostic` | 打开 Chrome、确认 OpenCLI 插件和登录态 |
| `diagnostic.platform_login_skipped` | diagnostic 未检查平台登录态 | `node scripts/task-runner.js run --task diagnostic` | 需要采集前补跑 `--check-platforms` |
| `platform.login_required` | 平台页面跳登录、接口返回未授权 | `node scripts/task-runner.js run --task diagnostic -- --check-platforms` | 在 Chrome 手动登录对应平台后重跑 |
| `platform.selector_or_api_changed` | 抓取 0 条、字段缺失、DOM/API probe 异常 | 对应平台最小脚本或 OpenCLI 命令 | 用 adapter workflow 最小 patch 并同步 |
| `database.config_invalid` | 连接数据库失败、库名/账号/密码错误 | `node scripts/task-runner.js run --task diagnostic` | 修 `config.local.json`，不在日志暴露密钥 |
| `database.schema_missing` | 缺唯一索引、缺列、写库前检查失败 | 对应 importer dry-run | 按 `docs/sql/` 和 schema 文档补表结构 |
| `report.missing_or_damaged` | `task-report.json` 不存在或 JSON 损坏 | 查看输出目录和 `task-events.jsonl` | 修 runner 汇总逻辑，补 fixture / test |
| `task.concurrent_session` | 重复点击或并发任务抢 Chrome 会话 | 查看 task lock / 运行状态 | 等当前任务结束，必要时做任务锁修复 |
| `scrm.apply_risk` | 用户明确要求不写库，但任务准备正式入库 | importer dry-run report | 停止写入计划，切到 dry-run / preview |

## 类型详情

### `environment.node_version`

判定信号：

- 当前 Node 不满足 `package.json` 的 `engines.node`。
- 本项目当前要求 `>=24 <25`。

复现：

```bash
npm run check
```

恢复：

```bash
source ~/.nvm/nvm.sh
nvm use 24
npm run check
```

验证：

- preflight 中 `node-version` 为 `passed`。

### `environment.opencli_missing`

判定信号：

- `opencli` 不在 PATH。
- OpenCLI 命令缺失，例如 adapter 未同步导致 unknown command。

复现：

```bash
npm run check
opencli --version
```

恢复：

- 优先使用项目 npm scripts，不直接假设全局 `opencli`。
- 修改 adapter 后运行：

```bash
node scripts/sync-adapter.js <platform>
```

验证：

- `npm run check` 的 `opencli` check 通过或给出明确 fallback。
- 最小 OpenCLI 命令可运行。

### `environment.opencli_override`

判定信号：

- `task-report.json` 的 `harness_warnings` 出现 `environment.opencli_override`。
- OpenCLI doctor 输出 `Local adapter overrides shadow packaged adapters`。

复现：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/diagnostic-demo
```

恢复：

- 如果正在开发 adapter，或该站点依赖用户级 runtime adapter，保留 override，并在报告里记录这是预期状态。
- 如果只是单个本地文件名 shadow 了官方 packaged 命令，优先改名并备份冲突文件。
- 如果确实要验证 packaged OpenCLI 行为，先备份本地 adapter，再 reset：

```bash
mkdir -p ~/.opencli/backups
cp -R ~/.opencli/clis/<site> ~/.opencli/backups/<site>-<YYYYMMDD-HHMMSS>
opencli adapter reset <site>
```

验证：

- 重跑 diagnostic 后，`harness_warnings` 不再出现 `environment.opencli_override`。
- 如果仍出现，检查 `~/.opencli/clis` 是否还有对应站点本地副本。

### `browser.chrome_unavailable`

判定信号：

- 诊断报告提示 Chrome 未连接。
- OpenCLI 浏览器插件不可用。
- 平台脚本无法打开或控制页面。

复现：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/diagnostic-demo
```

恢复：

- 打开 Chrome。
- 确认 OpenCLI 插件启用。
- 避免同时跑多个会抢 Chrome 会话的任务。

验证：

- diagnostic 的 `task-report.json` 成功生成，且 Chrome / OpenCLI 相关检查通过。

### `diagnostic.platform_login_skipped`

判定信号：

- diagnostic 成功，但 `harness_warnings` 出现 `diagnostic.platform_login_skipped`。
- `doctor-report.json` 中 `platform-login-checks` 为 `skipped`。

复现：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/diagnostic-demo
```

恢复：

- 准备跑真实平台采集前，补跑平台登录检查：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/platform-diagnostic -- --check-platforms
```

验证：

- 平台登录检查通过后，再进入对应平台的小范围 dry-run。

### `platform.login_required`

判定信号：

- 平台页面跳登录。
- 创作者后台接口返回未授权。
- 抓取结果为 0 且 probe 显示登录态缺失。

复现：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/platform-diagnostic -- --check-platforms
```

恢复：

- 在本机 Chrome 手动登录对应平台。
- 不保存或提交用户 profile / cookie。
- 登录后重新跑最小任务。

验证：

- 对应平台 diagnostic 通过。
- 小范围 `--limit` 或 `--work-limit` 任务能产出有效报告。

### `platform.selector_or_api_changed`

判定信号：

- OpenCLI 命令成功退出但字段为空。
- DOM/API probe 和正式命令字段不一致。
- 页面结构变化导致 selector 失效。

复现：

```bash
node scripts/sync-adapter.js <platform>
```

然后在本地 OpenCLI 工作副本跑最小命令。

恢复：

- 只修对应 adapter 命令。
- 保留失败样本或 probe 输出。
- 补 adapter 单测或 fixture。

验证：

```bash
npm run test:<platform>
```

### `database.config_invalid`

判定信号：

- MySQL 连接失败。
- `config.local.json` 缺失数据库字段。
- 密码/账号/库名不正确。

复现：

```bash
node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/db-diagnostic
```

恢复：

- 修 `config.local.json`。
- 不在报告或日志里输出明文密码。

验证：

- diagnostic 数据库检查通过。

### `database.schema_missing`

判定信号：

- importer 报缺列、缺唯一索引或表不存在。
- 正式 `--apply` 前 preflight 阻断。

复现：

```bash
npm run sink:run -- --platform <platform> --output-dir samples/tasks/<task>/<platform> --sink scrm
node scripts/import-to-scrm.js --platform <platform> --date <YYYY-MM-DD>
```

恢复：

- 对照 `../sql/` 和 `../canonical-scrm-schema.md` 补表结构。
- 先用 dry-run 确认 schema 通过；如果用户要求同步，再跑正式写库计划。

验证：

- dry-run 通过。
- 若需要正式写库，重复 `--apply` 应保持幂等。

### `report.missing_or_damaged`

判定信号：

- 输出目录存在，但 `task-report.json` 不存在或 JSON 损坏。
- 桌面历史页只能显示损坏报告。

复现：

- 读取失败输出目录。
- 检查 `task-events.jsonl` 是否完整。

恢复：

- 修 runner 汇总逻辑。
- 补 schema / fixture / test。

验证：

```bash
npm run test -- scripts/task-runner.test.js
```

### `task.concurrent_session`

判定信号：

- 重复启动任务。
- 多个任务同时抢 Chrome / OpenCLI 会话。

复现：

- 查看当前任务状态。
- 检查是否存在运行中任务。

恢复：

- 等当前任务完成。
- 必要时补任务锁和队列状态。

验证：

- 重复点击不会启动第二个真实任务。

### `scrm.apply_risk`

判定信号：

- 用户明确说“试跑”“不要写入”时，任务却准备正式 `--apply`。
- 输入产物不明确或 account guard 未通过。

复现：

- 先跑 importer dry-run。

恢复：

- 检查 report、行数、account guard、幂等策略。
- 如果用户要正式同步，改跑正式计划；如果用户要试运行，切回不写库计划。

验证：

- dry-run 通过。
- 正式写库后重复执行不产生重复行。

## 待补真实样本

| 日期 | 平台 | 失败类型 | 输出目录 | 处理状态 |
| --- | --- | --- | --- | --- |
| 2026-05-10 | 全局 diagnostic | `environment.opencli_override`、`diagnostic.platform_login_skipped` | `samples/tasks/social-harvest-diagnostic-agent-fields` | 已映射为 `harness_warnings`，未阻断任务 |
