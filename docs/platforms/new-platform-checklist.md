# 新平台接入清单

这份文档面向“准备新增第三个平台、第四个平台的人”。

目标不是解释每一步的原理，而是给出一份可以照着执行的清单，避免漏改文件、漏补文档、漏接入库。

建议每次新增平台时，都把这份清单当成最终验收表。

## 一、先确认范围

在写代码前，先把下面 5 个问题说清楚：

1. 这个平台是后台站点还是公开 Web 站点
2. 登录态来自哪里
3. 最小可用命令是什么
4. 最终业务需要的是内容、评论、弹幕、私信，还是其中的组合
5. 最终数据是否要进入 `scrm_file` / `scrm_comment`

如果这 5 个问题还说不清，先不要急着写适配器。

## 二、适配器目录

至少创建：

```text
adapters/<platform>/
```

建议最小文件集合：

- `README.md`
- `shared.js`
- `posts.js`
- `comments.js`
- 内容聚合命令，例如兼容现有产物约定的 `harvest.js`
- `shared.test.js`

如果平台需要“输入解析”这一层，再补：

- `resolve-user.js`

## 三、先做最小可用链路

建议顺序：

1. 先做 `shared.js`
2. 先打通 `posts.js`
3. 再做 `comments.js`
4. 最后做内容聚合命令，例如 `harvest.js`

不要一上来就做特别重的聚合逻辑。

## 四、平台 README

必须补：

- `adapters/<platform>/README.md`

建议按这个顺序写：

1. 平台简介
2. 当前能力
3. 使用前准备
4. 快速开始
5. 输出字段说明
6. 样例与 SCRM 导入
7. 代码结构
8. 已知限制
9. 怎么继续开发

参考：

- templates/adapter-template/README.md
- [adapters/weixin-channels/README.md](../../adapters/weixin-channels/README.md)
- [adapters/douyin/README.md](../../adapters/douyin/README.md)

## 五、样例文件

本地跑通时，真实运行产物默认落到：

```text
samples/<platform>/<date>/
```

默认这类运行产物不会进入版本管理。只有当它要作为固定回归样例时，才复制到 `test-support/fixtures/<platform>/...`，并在测试或 fixture 说明里注明用途。

建议至少有：

- `harvest.json`
- `posts.json`
- `comments-flat.json`

如果没有真实样例，后面做字段对照、入库和回归都会很痛苦。

## 六、字段整理

新增平台时，至少同步看这两份文档：

- [canonical-scrm-schema.md](../canonical-scrm-schema.md)
- [field-mapping-matrix.md](../field-mapping-matrix.md)

最小检查项：

- 作品主键是否明确
- 评论主键是否明确
- 评论所属作品字段是否明确
- 时间字段是否已格式化
- 封面字段是否已归一
- 头像字段是否已归一
- 回复关系字段是否已归一

## 七、测试

至少补：

- 字段归一化测试
- 时间格式化测试
- 回复关系测试

建议命名保持和现有平台一致：

- `shared.test.js`
- 其他需要时再补命令级测试

## 八、同步到 OpenCLI 联调

把适配器同步到本地工作副本：

```bash
node scripts/sync-adapter.js <platform>
```

OpenCLI `1.7.16+` 会在 manifest 构建时校验 adapter 元数据。同步前先确认：

- 每个 `cli({...})` 都声明 `access: 'read'` 或 `access: 'write'`。
- 每个 `{ positional: true }` 参数都有非空 `help`。

然后进入 `workspace/OpenCLI`：

```bash
npm run build
```

再跑真实命令验证。

## 九、平台能力矩阵

新增平台后必须更新：

- [platform-capability-matrix.md](./platform-capability-matrix.md)

至少补：

- 平台状态
- 认证方式
- 已实现命令
- 是否支持内容聚合产物，现有兼容文件名通常是 `harvest.json`
- 是否支持回复链
- 是否支持 `sink: scrm`
- 真实样例路径

## 十、SCRM mapper

如果这个平台最终要写入 SCRM，必须新增：

- `scripts/lib/scrm-mappers.js` 中的平台 mapper

至少确认：

- 视频能映射到 `scrm_file`
- 评论能映射到 `scrm_comment`
- 回复关系字段不会丢

平台主流程应产出规范化 datasets，并接入统一 sink runner：

```bash
npm run sink:run -- --platform <platform> --output-dir samples/tasks/<task>/<platform> --sink scrm --sink-apply
```

`node scripts/import-to-scrm.js --platform <platform> --date <YYYY-MM-DD>` 仍可作为 SCRM 底层导入器用于排障和兼容验证，但不应成为新平台的一线流程入口。

## 十一、项目级文档入口

新增平台后，建议至少更新这些入口：

- [README.md](../../README.md)
- [platform-capability-matrix.md](./platform-capability-matrix.md)
- [field-mapping-matrix.md](../field-mapping-matrix.md)

如果平台字段或流程有明显特殊性，再补独立文档。

## 十二、最终验收

建议把下面这份作为完成定义：

- 适配器源码已在 `adapters/<platform>/`
- 平台 README 已完成
- 至少一批真实样例已落盘
- 测试已通过
- OpenCLI 联调已通过
- 平台能力矩阵已更新
- 字段对照文档已更新
- 如果需要 `sink: scrm`，mapper 已完成
- 如果需要 `sink: scrm`，sink runner dry-run 已通过

## 十三、最短执行路径

如果你想最快做出一个新平台，按这条路径走：

1. 建目录
2. 做 `shared.js`
3. 做 `posts.js`
4. 做 `comments.js`
5. 做内容聚合命令
6. 补 `README.md`
7. 补样例
8. 补测试
9. 补 mapper
10. 更新矩阵文档
