# 参与贡献

感谢你改进 Social Harvest。这个仓库是运营工具，改动标准很直接：行为清楚、范围聚焦、结果可验证。

## 开发环境

使用 Node.js 24.x：

```bash
nvm use 24
npm install
npm run check
```

Social Harvest 默认使用项目依赖里的 OpenCLI。只有开发或调试平台适配器时，才需要额外准备 `workspace/OpenCLI` 工作副本。

## 工作方式

1. 先读附近代码、文档和测试，再改行为。
2. 单次改动只解决一个清晰目标。
3. 优先沿用已有 runner、sink、report 和平台注册表模式。
4. 行为变化要补测试或说明最小手动验证方式。
5. 用户可见命令、配置、输出文件或平台能力变化，要同步文档。

## 命令和脚本规则

- 新增命令编排使用 Node.js。
- 不新增 `.sh`、`.bash`、PowerShell 或 Python 编排脚本，除非明确记录例外原因。
- npm scripts 只暴露稳定的一线用户入口。
- 低层诊断和维护工具可以保留为 `node scripts/<name>.js`。

## 文档同步规则

| 改动 | 同步文档 |
| --- | --- |
| npm script 或用户命令行为 | [docs/commands.md](docs/commands.md) |
| 安装、环境或前置条件 | [docs/getting-started.md](docs/getting-started.md) |
| 配置字段或环境变量 | [docs/config-reference.md](docs/config-reference.md) |
| runner 报告、事件或 checkpoint 字段 | [docs/runner-output-contract.md](docs/runner-output-contract.md) |
| SCRM 字段或映射行为 | [docs/canonical-scrm-schema.md](docs/canonical-scrm-schema.md)、[docs/field-mapping-matrix.md](docs/field-mapping-matrix.md) |
| 平台能力 | [docs/platforms/platform-capability-matrix.md](docs/platforms/platform-capability-matrix.md) 和对应平台 runbook |

## 验证

按改动范围跑最小有效检查：

```bash
npm run check
npm test
npm run docs:check-links
git diff --check
```

平台相关改动追加：

```bash
npm run test:douyin
npm run test:weixin-channels
```

如果因为本地凭证、浏览器状态或平台环境导致无法运行某项检查，请在 PR 里明确说明。

## PR 检查清单

- 改动目标清晰，diff 没有混入无关重构。
- 已说明测试或手动验证方式。
- 用户可见行为已经同步文档。
- 没有提交密钥、cookies、私信、真实媒体文件或生产数据库导出。
- 生成样例要么是固定 fixture，要么不要提交。
