# Harness Docs

这里收纳 Social Harvest 的 agent-first harness 文档：验证矩阵、失败目录、dry-run runbook 和报告字段。

当前入口：

- [Harness Validation Matrix](harness-validation-matrix.md)
- [Failure Catalog](harness-failure-catalog.md)
- [Diagnostic Dry Run](harness-diagnostic-dry-run.md)
- [Platform Dry Run](harness-platform-dry-run.md)
- [Task Report Agent Fields](harness-report-agent-fields.md)

仍保留在 `docs/` 根目录的跨域契约：

- [Runner Output Contract](../runner-output-contract.md)
- [Task Report Schema](../schemas/task-report.schema.json)

迁移规则：

- runner 输出字段变化时，同步 schema、fixture、输出契约和测试。
- 新失败样本进入 failure catalog。
- 不和 runner 代码移动放在同一批。
