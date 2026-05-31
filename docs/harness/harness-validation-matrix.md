# Social Harvest Harness Validation Matrix

更新日期：2026-05-25

这份矩阵定义不同改动类型的最小验证口径。目标是让 agent 和人都能用同一套标准判断“这次改动真的完成了”，避免靠感觉收尾。

## 使用规则

- 每次改动先判断属于哪一类，再跑对应的“最小验证”。
- 如果改动跨多类，合并对应验证。
- 如果当前环境不能运行某条命令，交付时必须说明原因和替代证据。
- 跑测试、构建、打包前先执行 `npm run check`，确认 Node 版本满足 `package.json` 的 `engines.node`。

## 改动类型矩阵

| 改动类型 | 最小验证 | 扩展验证 | 必须同步 |
| --- | --- | --- | --- |
| Harness / agent 流程 | `npm run check` | 用通用 agent runbook 或 operator skill 走一次 diagnostic dry-run 和平台 dry-run 复盘 | `docs/agent-runbook.md`、`docs/README.md`、相关 skill reference |
| Runner task / 计划执行 | `npm run test -- scripts/task-runner.test.js` | `node scripts/task-runner.js list --json`、`node scripts/task-runner.js plan --config tasks/smoke-douyin-public.json --output-dir samples/tasks/smoke-douyin-public-demo` | `docs/runner-output-contract.md`、`tasks/*.json` |
| Runner 内核抽取 | `npm run test -- scripts/task-runner.test.js`、`git diff --check` | `node scripts/task-runner.js list --json`；触碰执行器时追加 smoke plan | `runner/extraction-plan.md`、`docs/repository-structure.md` |
| 平台脚本 | 对应脚本单测，例如 `npm run test -- scripts/harvest-douyin.test.js` | 平台诊断：`node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/platform-diagnostic -- --check-platforms --platform douyin`；最小采集：`node scripts/task-runner.js run --platform douyin --task public-content --output-dir samples/tasks/douyin-public-smoke -- --video-limit 1 --comment-limit 1 --without-replies --retry 0` | `docs/commands.md`、平台 runbook |
| OpenCLI adapter | 对应 adapter 单测，例如 `npm run test:douyin` | `node scripts/sync-adapter.js <platform>` 后跑最小 opencli 命令 | `adapters/<platform>/README.md`、`docs/platforms/platform-capability-matrix.md` |
| SCRM mapper / importer | mapper/importer 单测 | dry-run report + 用户明确要求同步时的小样本正式写入验证 | `docs/canonical-scrm-schema.md`、`docs/field-mapping-matrix.md` |
| 失败归类 / 恢复建议 | `npm run test -- scripts/task-runner.test.js scripts/doctor.test.js` | 用真实失败样本回放 task report | `docs/harness/harness-failure-catalog.md` 或对应 runbook |
| 文档-only | `git diff --check` | 链接和命令人工抽查 | `docs/README.md` 如入口变更 |
| 目录结构整理 | `git diff --check` | 相关路径引用搜索，例如 `rg -n "scripts/task-runner|daily:|history:" README.md docs package.json scripts runner` | `docs/repository-structure.md`、`README.md`、`docs/README.md` |
| Skill-only | 检查 `SKILL.md` frontmatter 和 reference 链接 | 用一个真实 prompt 走完整流程 | `scripts/install-social-harvest-skills.js` 如安装方式变更 |

## 当前 P0 验收目标

Social Harvest CLI-first 主线的 P0 完成标准：

1. README 和文档入口明确 Social Harvest 是 CLI-first 工具。
2. `npm run check` 能报告 Node、OpenCLI、config、Chrome 基础状态。
3. `skills/social-harvest-operator/SKILL.md` 能路由日常运行、历史全量、失败恢复和新平台接入。
4. `npm run` 的一线菜单只暴露 `check`、`daily:*`、`history:*`、`publish:feishu`、`sink:run`、`share:run` 和交付/测试命令。
