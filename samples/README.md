# Samples Boundary

`samples/` 是本地运行产物目录，不再提交固定回归样例。

固定回归样例统一放在 `test-support/fixtures/`：

- `test-support/fixtures/weixin-channels/`
- `test-support/fixtures/douyin/`
- `test-support/fixtures/runner/`

本地运行产物：

- `samples/<platform>/<date>/`
- `samples/tasks/<task-id>/`
- `progress.json`
- `detailed-history.log`
- 临时抓取出来的 `comments-*.json` / `harvest.json` / `index.json`

这些默认被 `.gitignore` 忽略。只有当某份运行产物要成为新的回归样例时，才复制到 `test-support/fixtures/`，并在相关测试或文档里说明用途。
