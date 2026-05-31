# Social Harvest Manifest

Generated at: 2026-05-31T05:52:05.204Z

This repository is for the Social Harvest CLI workflow. It intentionally excludes local secrets, caches, build output, browser profiles, real run samples, and local OpenCLI workspaces.

## Included

- .nvmrc
- AGENTS.md
- CHANGELOG.md
- CONTRIBUTING.md
- config.example.json
- package-lock.json
- package.json
- SECURITY.md
- adapters/
- runner/
- tasks/
- docs/ public allowlist
- scripts/ public allowlist
- .github/ issue and pull request templates
- samples/README.md

## Not Included

- local-only task code
- release generator scripts
- *.test.js
- test-support/
- templates/
- docs/archive/
- docs/design/
- docs/plans/
- config.local.json
- node_modules/
- .git/
- dist/
- out/
- workspace/
- backups/
- real samples/tasks run output
- Chrome profile, cookies, database passwords, AI keys

## First Run

Ask a local AI agent from this folder:

```text
Help me install and configure Social Harvest. First check the environment and do not write to the business system yet.
```

Then let the agent follow docs/user-first-run.md and docs/agent-runbook.md.

For this Agent-first CLI package, install runtime dependencies with:

```bash
npm install --omit=dev
```
