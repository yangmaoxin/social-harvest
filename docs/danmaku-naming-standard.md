# Danmaku Naming Standard

## Canonical Term

This repository uses `danmaku` as the only English term for `弹幕`.

Use these names everywhere:

| Scope | Canonical |
| --- | --- |
| Domain object | `danmaku` |
| Record id | `danmaku_id` |
| Record count | `danmaku_rows` |
| Work aggregate count | `count_danmaku` |
| Main table | `scrm_danmaku` |
| Flat export file | `danmaku-flat.json` |
| Report file | `danmaku-report.json` |

## Rules

1. Code, docs, SQL, JSON fields, npm scripts, and tests must use `danmaku`.
2. Do not introduce `danmu` as a schema, field, file, or script name.
3. Do not introduce `bullet_chat`, `bullet-chats`, or `barrage` in new code.
4. UI text may continue to use Chinese `弹幕`.

## Database Baseline

Canonical database objects:

- `scrm_danmaku`
- `scrm_file.count_danmaku`

## Audit Command

Use the read-only audit command to confirm the canonical schema is complete:

```bash
node scripts/audit-danmaku.js
```

Expected states:

- `ok`: canonical schema is complete
- `failed`: canonical schema is missing required table or column

## Current Repo Checklist

- [x] Canonical term chosen: `danmaku`
- [x] Canonical scripts and docs landed
- [x] Canonical report/output filenames landed
- [x] Canonical read/write paths landed
- [x] Legacy aliases removed from runtime entrypoints
- [x] Canonical database schema is the only supported target
