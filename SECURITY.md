# 安全说明

Social Harvest 会接触平台登录态、私信、本地媒体、SCRM 数据库、飞书应用和 AI 服务凭证。请把这个仓库当作敏感运营工具处理。

## 不要提交

- `config.local.json`
- access token、app secret、cookies、session storage 或浏览器 profile
- 私信导出或可识别真实用户的原始数据
- 从真实账号采集下来的本地媒体
- 生产数据库 dump
- `.env` 或机器专属凭证

新增配置字段时，用 [config.example.json](config.example.json) 放占位示例，并同步 [docs/config-reference.md](docs/config-reference.md)。

## 漏洞报告

发现安全问题时，请先私下联系仓库维护者，不要直接开公开 issue。报告里尽量包含：

- 受影响命令、平台或 sink
- 使用脱敏数据的复现步骤
- 可能影响范围
- 已知的缓解建议

## 处理流程

1. 停止受影响任务。
2. 撤销或轮换暴露的凭证。
3. 从工作区移除泄露的本地产物。
4. 共享报告前检查是否包含敏感 payload。
5. 补充回归测试或文档，避免同类问题重复出现。

## 操作者提示

普通终端输出应保持可读，不直接展开原始 JSON。平台 payload、诊断细节和失败详情应进入结构化报告文件，只分享给确实需要的人。
