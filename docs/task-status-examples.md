# 任务状态样例

这份文档说明桌面端需要如何理解失败、部分成功、取消和警告状态。固定 JSON 样例见 [Runner 输出契约](runner-output-contract.md)。

## 1. 状态定义

| 状态 | 含义 | UI 主动作 |
| --- | --- | --- |
| `success` | 任务完成，无阻塞问题 | 查看报告、重跑 |
| `warning` | 任务完成，但存在需要注意的警告 | 查看警告、按需重跑 |
| `partial` | 部分任务完成，部分失败 | 查看失败项、重跑失败项 |
| `failed` | 任务失败，没有完成关键目标 | 查看原因、修复后重跑 |
| `cancelled` | 用户取消或系统主动终止 | 查看已生成产物、重跑 |

## 2. Warning

适用场景：

- 抖音私信导出 0 条，但页面探针产物已写出。
- 作品级评论增强失败，但主作品抓取成功。
- 诊断检查存在非阻塞警告。

UI 展示：

- 状态色使用黄色。
- 第一屏显示 `summary_text`。
- `warnings` 作为独立列表展示。
- 主按钮为“查看警告”和“打开输出目录”。

## 3. Partial

适用场景：

- 多账号中部分账号失败。
- 多平台计划中部分平台失败。
- 作品评论增强只成功了一部分。

UI 展示：

- 状态色使用黄色或橙色。
- 展示成功计数和失败计数。
- 如果报告提供失败样本，显示“重跑失败项”。
- 不把 partial 展示成完全失败。

## 4. Failed

适用场景：

- 配置缺失。
- Chrome/OpenCLI 不可连接。
- 平台登录态失效。
- 数据库连接或唯一索引检查失败。
- 子进程非 0 退出。

UI 展示：

- 状态色使用红色。
- 第一屏展示 `error` 和 `summary_text`。
- `next_actions` 放在错误下方。
- 提供“打开报告”“打开输出目录”“重跑”。

## 5. Cancelled

适用场景：

- 用户点击取消。
- Main 进程因互斥或关闭应用终止子进程。

UI 展示：

- 状态色使用中性灰。
- 展示已运行时长。
- 保留已生成 artifacts。
- 提供“重跑”，不自动删除输出目录。

## 6. Fixture

| 状态 | 报告样例 |
| --- | --- |
| warning | warning-task-report.json |
| partial | partial-task-report.json |
| failed | failed-task-report.json |
| cancelled | cancelled-task-report.json |
