# Platform Docs

这里收纳 Social Harvest 的平台能力、平台 runbook 和新平台接入文档。

当前入口：

- [Platform Capability Matrix](platform-capability-matrix.md)
- [New Platform Checklist](new-platform-checklist.md)
- [Douyin Development Plan](douyin-development-plan.md)
- [Douyin Source Strategy](douyin-source-strategy.md)
- [Douyin Self Runbook](douyin-self-runbook.md)
- [Douyin Main Table Write Strategy](douyin-main-table-write-strategy.md)
- [Douyin Creator Merge Policy](douyin-creator-merge-policy.md)
- [Douyin Danmaku Unification Plan](douyin-danmaku-unification-plan.md)
- [Metric Delta Events Plan](metric-delta-events-plan.md)
- [Metric Delta Runbook](metric-delta-runbook.md)
- [Douyin Crawling Challenges Report](douyin-crawling-challenges-report.md)
- [Weixin Channels SCRM Operator Guide](weixin-channels-scrm-operator-guide.md)
- [Weixin Channels Assistant Runbook](weixin-channels-assistant-runbook.md)
- [Weixin Channels Private Message Runbook](weixin-channels-private-message-runbook.md)

仍保留在 `docs/` 根目录的跨域文档：

- [Canonical SCRM Schema](../canonical-scrm-schema.md)
- [Field Mapping Matrix](../field-mapping-matrix.md)
- [Commands](../commands.md)：当前推荐命令索引；平台参数和验收细节以本目录 runbook 为准。

迁移规则：

- 平台文档移动不和 adapter 代码移动放在同一批。
- 平台能力变化必须同步能力矩阵和命令清单。
- 新平台接入先补 adapter README、样例、mapper 和最小验证。
