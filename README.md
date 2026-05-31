# Social Harvest

[中文文档](README.zh-CN.md)

Social Harvest is an AI-friendly CLI for social media operations data. It turns collection workflows for Douyin and Weixin Channels into repeatable commands, then writes structured content, comments, replies, danmaku, private messages, metrics, and media metadata into SCRM systems, Feishu Base, or local reports.

The project is designed for daily operator workflows: check the environment, sync today's data, backfill history, read structured reports, and recover failed steps without asking users to remember long command lines.

## Highlights

- **Clear frontline commands**: `check`, `daily:*`, `history:*`, and `daily:failed` cover the common operating loop.
- **AI-friendly workflow**: agent prompts, runbooks, command cards, and structured task reports help local AI agents run the tool and summarize results.
- **Structured artifacts**: each task can produce `daily-report.json`, `task-report.json`, `task-events.jsonl`, `task-state.json`, and checkpoints.
- **Multi-platform collection**: supports owned Douyin accounts, public Douyin profiles, and Weixin Channels assistant workflows.
- **Multiple output targets**: supports SCRM / MySQL writes, Feishu Base publishing, and a shared sink runner.
- **Resumable runs**: history and full-sync tasks use checkpoints, and failed steps can be retried from task reports.
- **Readable terminal output**: human-facing progress stays concise while raw events and diagnostics are written to report files.

## Platform Coverage

| Platform | Owned Account | Public Profile | Comments / Replies | Danmaku | Private Messages | SCRM Sync | History Backfill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Douyin | Supported | Supported | Supported | Supported | Supported | Supported | Supported |
| Weixin Channels | Supported | N/A | Supported | Supported | Supported | Supported | Supported |

## Quick Start

Social Harvest requires Node.js 24.x.

```bash
node -v
npm install --omit=dev
npm run check
```

Social Harvest uses `@jackwener/opencli` from project dependencies. Users do not need to install `opencli` globally or prepare a separate OpenCLI repository.

## Configuration

Create a local config file:

```bash
cp config.example.json config.local.json
```

Then fill in the values for your environment:

- SCRM / MySQL connection
- Feishu application settings, optional
- AI service settings, optional
- platform account aliases and runtime options

`config.local.json` is local and private. Do not commit it. See [docs/config-reference.md](docs/config-reference.md) for the full configuration reference.

## Common Commands

| Goal | Command |
| --- | --- |
| Check environment, config, and login state | `npm run check` |
| Run daily Douyin sync | `npm run daily:douyin` |
| Run daily Weixin Channels sync | `npm run daily:weixin-channels` |
| Run all daily platform syncs | `npm run daily:all` |
| Backfill owned Douyin account history | `npm run history:douyin` |
| Backfill public Douyin profile history | `npm run history:douyin-public` |
| Backfill Weixin Channels history | `npm run history:weixin-channels` |
| Retry failed steps from a report | `npm run daily:failed -- samples/tasks/<task>/daily-report.json` |
| Publish existing artifacts to Feishu Base | `npm run publish:feishu -- <options>` |
| Write existing artifacts to configured sinks | `npm run sink:run -- <options>` |
| Share progress to a remote status page | `npm run share:run -- <sender options> -- <collection command>` |

Use `daily:*` for normal incremental work. Use `history:*` only when you explicitly need historical backfill or a full catch-up run.

## AI Operator Workflow

You can hand this repository to a local AI agent and ask:

```text
Check whether Social Harvest is ready to run today.
```

or:

```text
Sync today's Douyin data and tell me how many records were written.
```

Useful entry points for AI-assisted operation:

- [docs/ai-operator-prompt.md](docs/ai-operator-prompt.md)
- [docs/user-ai-command-card.md](docs/user-ai-command-card.md)
- [docs/agent-runbook.md](docs/agent-runbook.md)
- [docs/user-first-run.md](docs/user-first-run.md)

## Task Outputs

Task reports are usually written under `samples/tasks/`:

- `daily-report.json`
- `task-report.json`
- `task-events.jsonl`
- `task-state.json`
- `checkpoint.json`

Operators and AI agents should summarize from report files first instead of relying only on terminal logs.

## Documentation

| Topic | Document |
| --- | --- |
| First run | [docs/user-first-run.md](docs/user-first-run.md) |
| Command reference | [docs/commands.md](docs/commands.md) |
| Configuration | [docs/config-reference.md](docs/config-reference.md) |
| AI operation | [docs/ai-operator-prompt.md](docs/ai-operator-prompt.md), [docs/agent-runbook.md](docs/agent-runbook.md) |
| Platform capabilities | [docs/platforms/platform-capability-matrix.md](docs/platforms/platform-capability-matrix.md) |
| SCRM / Feishu writes | [docs/multi-platform-sinks.md](docs/multi-platform-sinks.md) |
| Troubleshooting | [docs/faq.md](docs/faq.md), [docs/advanced-diagnostics.md](docs/advanced-diagnostics.md) |

See [docs/README.md](docs/README.md) for the full documentation index.

## Repository Layout

```text
social-harvest/
├── adapters/      # Platform OpenCLI adapters
├── docs/          # User guides, AI runbooks, platform notes, and sink docs
├── runner/        # Task execution, events, reports, and checkpoints
├── samples/       # Local task output folder
├── scripts/       # CLI entries, platform workflows, sink writes, diagnostics
└── tasks/         # Example runner task plans
```

## Contributing

Bug reports, feature requests, and documentation improvements are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Do not commit `config.local.json`, secrets, cookies, private messages, real media files, or production database exports. See [SECURITY.md](SECURITY.md) for details.

## License

Apache-2.0. See [LICENSE](LICENSE).
