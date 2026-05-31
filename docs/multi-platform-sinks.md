# 多平台 Sink 写入

本文定义 Social Harvest “采集结果写到哪里”的使用方式和开发契约。默认写数据库；用户显式指定时，可以任意组合写入飞书多维表格、Google Sheets、Notion、Obsidian 等外部 sink。当前已落地飞书多维表格。

## 目标语义

- 默认行为不变：不传 sink 参数、也不配置平台 sink 时，现有任务继续写 SCRM 数据库。
- `--sink` 是完整目的地声明：`--sink feishu` 表示只写飞书；`--sink scrm --sink feishu` 表示同时写数据库和飞书。
- 每个平台可以在 `platforms.<platform>.sinks` 配置默认目的地，例如 `["scrm"]`、`["feishu"]` 或 `["scrm", "feishu"]`。
- 所有 sink 共用同一套规范化 payload，避免数据库和外部表格字段口径分叉。
- 写入必须幂等：每个 dataset 都有稳定 `source_key`，重复写入应更新已有记录，而不是追加重复行。
- 第一版飞书覆盖：作品、评论、弹幕、私信、账号、metric snapshot、metric delta event。
- 原始写入表只承担同步、幂等和排障职责；面向运营查看时，额外写入“展示表”。

## 日常使用

默认不传 sink 参数时，使用 `platforms.<platform>.sinks`；未配置时只写 SCRM 数据库：

```bash
node scripts/task-runner.js run --platform douyin -- --date <YYYY-MM-DD>
```

显式写飞书：

```bash
# 只写飞书 dry-run
node scripts/task-runner.js run --platform douyin -- --date <YYYY-MM-DD> --sink feishu

# 只写飞书正式写入
node scripts/task-runner.js run --platform douyin -- --date <YYYY-MM-DD> --sink feishu --sink-apply

# 同时写数据库和飞书，正式写入
node scripts/task-runner.js run --platform douyin -- --date <YYYY-MM-DD> --sink scrm --sink feishu --sink-apply
```

如果已经有本地采集产物，也可以直接写飞书 Base：

```bash
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables --apply
```

如果要按同一套声明补写一个或多个 sink，使用统一 sink runner：

```bash
npm run sink:run -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --sink feishu --dataset content --sink-apply
npm run sink:run -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --sink scrm --sink feishu --dataset all --sink-apply
```

日常选择：

| 场景 | 推荐命令 |
| --- | --- |
| 正常采集并入库 | 不传 `--sink` |
| 只写飞书 | `--sink feishu --sink-apply` |
| 数据库和飞书都写 | `--sink scrm --sink feishu --sink-apply` |
| 只补写某类数据 | `--dataset content` / `--dataset messages` / `--dataset metric_snapshots` |
| 已有本地产物，只补写飞书 | `npm run publish:feishu -- ... --display-tables --apply` |
| 调试字段和行数，不实际写入 | 不传 `--apply` / `--sink-apply` |
| 调试图片问题但不上传附件 | `--skip-display-images` |
| 强制重新下载并上传展示图 | `--refresh-display-images` |

## Dataset 契约

| Dataset | 主要来源 | 幂等键 |
| --- | --- | --- |
| `works` | `harvest.json` / `creator-harvest.json` / `works.json` | `platform:origin_type:work_no` |
| `comments` | 内容采集 payload 中的评论 | `platform:origin_type:comment_id` |
| `danmaku` | `danmaku-flat.json` 或抖音 `creator-harvest.json` 内嵌弹幕 | `platform:origin_type:danmaku_id` |
| `messages` | `private-messages-flat.json` | `platform:origin_type:comment_id` |
| `accounts` | `account-profile.json` | `platform:origin_type:account_id` |
| `metric_snapshots` | 账号/作品 metric snapshot payload | `platform:snapshot_hash` |
| `metric_delta_events` | metric delta event JSON | `platform:origin_type:target_scope:target_id:metric_type:from_snapshot_id:to_snapshot_id:sequence_no` |

所有 Feishu 表都必须包含 `source_key` 字段。字段名保持英文 snake_case，便于后续 Google Sheets / Notion / Obsidian 复用。

## 飞书多维表格 v1

飞书正式写入直接调用官方 Bitable API，不依赖 `lark-cli` 登录态。项目配置只使用官方命名：

- `app_id` / `app_secret`：飞书企业自建应用凭证，用来换取 `tenant_access_token`。
- `app_token`：目标多维表格 Base 的唯一标识。它不是 API access token。

如果没有现成 `app_token`，可以在正式写入时加 `--create-base`，脚本会先通过 API 创建一个新的 Base，再把返回的 `app_token` 打印出来，后续写回配置复用。

直接写入入口：

```bash
npm run publish:feishu -- --platform douyin --output-dir samples/douyin/<date>/<account> --dataset all
npm run publish:feishu -- --platform douyin --output-dir samples/douyin/<date>/<account> --dataset all --apply
```

配置：

```json
{
  "sinks": {
    "scrm": {
      "type": "mysql",
      "host": "your-mysql-host",
      "user": "your-mysql-user",
      "password": "your-mysql-password",
      "db_name": "your-database-name",
      "media": {
        "backend": "oss",
        "region": "oss-cn-beijing",
        "bucket": "your-oss-bucket",
        "access_key_id": "your-oss-access-key-id",
        "access_key_secret": "your-oss-access-key-secret",
        "prefix": "social-harvest",
        "key_template": "{prefix}/{platform}/{account_id}/{yyyy}/{mm}/{entity_type}/{entity_id}/{image_type}.{ext}",
        "public_base_url": "https://your-oss-bucket.oss-cn-beijing.aliyuncs.com"
      }
    },
    "feishu": {
      "app_id": "cli_xxx",
      "app_secret": "your-feishu-app-secret",
      "app_token": "your-base-app-token",
      "table_prefix": "harvest",
      "base_name": "Social Harvest 写入"
    }
  }
}
```

环境变量覆盖：

- `HARVEST_FEISHU_APP_ID`
- `HARVEST_FEISHU_APP_SECRET`
- `HARVEST_FEISHU_APP_TOKEN`
- `HARVEST_FEISHU_TABLE_PREFIX`

行为：

- dry-run 只生成 `FEISHU_BASE_WRITE_PLAN`，不调用飞书写接口。
- `--apply` / `--sink-apply` 才会写入飞书。
- 写入时直接调用飞书 Bitable API；`tenant_access_token` 由脚本用 `app_id` / `app_secret` 获取并缓存。
- 当前版本可以使用已有 `app_token`，也可以通过 `--create-base` 自动创建新 Base。
- 脚本会自动创建缺失的数据表和字段。
- 表名为 `<table_prefix>_<dataset>`，例如 `harvest_works`。
- 每次写入前按 `source_key` 扫描目标表，已有记录走更新，缺失记录走创建。
- 已有记录更新走官方 `batch_update`，支持每行不同值批量更新。

## SCRM 图片写入

SCRM 数据库需要长期可访问的图片 URL，因此 `sinks.scrm.media` 使用 OSS 作为媒体后端。正式写库前会把作品封面、评论头像、私信头像、弹幕头像和账号头像上传到 OSS，再把 SCRM 图片字段改写成稳定的 `public_base_url + OSS key`。OSS key 默认按平台、平台账号和月份组织：

```text
{prefix}/{platform}/{account_id}/{yyyy}/{mm}/{entity_type}/{entity_id}/{image_type}.{ext}
```

飞书不依赖这套 OSS 配置。只写飞书时，图片仍按飞书展示表逻辑直接上传为飞书附件；同时写 SCRM 和飞书时，SCRM 使用 OSS URL，飞书使用附件字段。

已有 SCRM 数据里的旧平台图片 URL 可以单独回填到 OSS。默认 dry-run，只统计候选行，不下载、不上传、不写库：

```bash
npm run media:smoke-oss
npm run media:backfill-scrm
npm run media:backfill-scrm -- --table comment --limit 100
npm run media:backfill-scrm -- --apply
```

`media:smoke-oss` 只验证 `sinks.scrm.media` 的 OSS 上传权限，不读写数据库。默认上传后删除测试图片；加 `--keep` 可保留测试图片并手动检查 public URL。

如果确定要清空仍无法下载或上传的旧平台 URL，再加 `--clear-failed`。

### 展示表

原始表字段保持英文 snake_case，便于数据库、Google Sheets、Notion、Obsidian 等 sink 复用；展示表则使用中文字段，服务运营查看和人工处理。

飞书里有三层对象：

- 原始表：程序同步用，字段接近数据库和统一 payload，主要用于幂等、排障和后续跨 sink 复用。
- 展示表：人查看和运营处理用，按平台、月份、场景拆分，字段是中文业务名。
- 视图：同一张展示表的不同看法。`内容画册` 是内容展示表的画册视图，不是另一张表。

展示表采用“映射壳”模式，不复制整份原始数据：

- 脚本只写 `source_key`、`原始表source_key`、月份、来源类型、主标题/昵称，以及 `跟进状态`、`备注`、`进入创作池` 等人工运营字段。
- 播放数、点赞数、发布时间、封面图链接、用户头像、意向等级等展示字段用飞书公式从原始表映射读取。
- 因此原始表后续被正常 upsert 更新时，展示表里的公式字段会跟随变化；展示表本身不改变原始写入流程。

开启展示表：

```bash
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables --apply
```

拆表规则：

- 按平台和月份拆表，展示表使用中文业务名，表名格式为 `<平台> <YYYY-MM> <场景>`。
- 示例：`视频号 2026-05 内容`、`抖音 2026-05 线索`。
- `内容` 来自 `works`，按作品发布时间分月。
- `线索` 来自 `comments`、`messages` 和 `danmaku`，按互动时间分月。
- `账号` 来自 `accounts`，按更新时间分月。
- 内容表现字段使用面向运营动作的文案：`重点复盘`、`表现不错`、`正常观察`；避免使用难以判断下一步动作的分层名称。
- 展示表里的时间字段统一显示为 `YYYY-MM-DD HH:mm`，避免暴露时间戳或飞书默认格式。
- 展示表里的平台字段显示业务名，例如 `视频号`、`抖音`；原始平台码只保留在原始数据表。
- 展示表字段顺序优先服务阅读：采集字段和计算字段在前，人工运营字段在后；`备注` 固定放在最后。
- 展示表会为头像和封面额外创建附件字段：内容表 `封面图`、线索表 `用户头像`、账号表 `头像`。脚本会下载原始 URL、压缩为预览图，再上传到飞书附件字段；原始 URL 字段继续保留用于追溯。
- 附件上传默认是增量的：同一展示表、同一 `source_key`、同一附件字段里已有文件时，会跳过下载和上传；如果本次抓到的新图片 URL 和“来源链接”标记不同，只更新来源链接字段，不重传附件。很多平台封面和头像 URL 是临时签名地址，完整 URL 变化不代表图片内容变化。
- 内容展示表会自动维护 `内容画册` 视图：每篇内容一张卡片平铺展示，用 `封面图` 做卡片封面，只露出 `内容表现`、`发布时间`、`互动量` 等少量字段，并按 `互动量`、`发布时间` 倒序排列。它用于浏览内容库；表格视图继续用于排查、批量编辑和字段维护。

图片策略：

- 头像、封面图：展示层写入压缩后的飞书附件字段，避免原平台 URL 过期，也避免附件表过快膨胀。
- 正文图片：如后续采集到正文多图，保留原始大小上传附件，不做压缩。
- 如只想保留图片 URL、不上传附件，可加 `--skip-display-images`。
- 如需要强制刷新已存在的附件，可加 `--refresh-display-images`。
- 附件数量按“平台 + 月份”分表分摊，避免单表 20,000 附件上限过早触达。

展示表仍包含 `source_key` 和 `原始表source_key`，用于幂等更新和回查原始表；不要人工修改这两个字段。

自动维护项：

- 自动创建缺失的原始表、展示表和字段。
- 自动维护内容展示表的 `内容画册` 视图，包括封面字段、可见字段和排序。
- 自动清理展示表里缺失 `source_key` 的孤立记录，避免画册出现空白卡片或公式错误。
- 自动按 `source_key` upsert，不因重复全量写入追加重复行。
- 自动按 `source_key` + 附件字段是否已有文件判断附件是否需要重新上传；不按完整图片 URL 判断。

### 常见问题

**画册里出现空白卡片或“计算时出现错误”**

通常是展示表里存在缺失 `source_key` 的孤立记录，或人工改坏了 `source_key` / `原始表source_key`。重新执行一次带 `--display-tables --apply` 的飞书写入会自动清理缺 `source_key` 的孤立记录。仍然异常时，先检查展示表对应行的 `source_key` 和 `原始表source_key` 是否为空或被改动。

**卡片下面空白很多**

优先检查画册视图的卡片配置。脚本会把 `内容画册` 限制为少量字段：`标题`、`内容表现`、`发布时间`、`互动量`。如果手工把正文、播放数、点赞数、评论数等大量字段加回卡片，可视区域会变长，看起来就会很空。

**图片 URL 字段有值，但画册不显示图片**

飞书画册封面需要附件字段，不会直接把普通 URL 字段渲染成封面。展示表会把封面和头像下载后上传到附件字段。默认写入会复用同一 `source_key` 行里已有的附件，即使平台返回了新的临时 URL 也不会重传；如果需要重新生成附件，使用 `--refresh-display-images`。

**为什么既有原始表又有展示表**

原始表负责稳定同步，不适合人直接阅读；展示表负责运营浏览和人工标记。展示表只写少量映射字段和人工字段，播放数、发布时间、图片链接等由公式从原始表读取，所以原始表更新后展示表会跟随刷新。

**哪些字段可以人工改**

只改人工运营字段，例如 `跟进状态`、`进入创作池`、`备注`。不要修改 `source_key`、`原始表source_key`、月份、平台、作品 ID 这类同步定位字段。

API 能力映射：

| 能力 | API |
| --- | --- |
| 获取访问令牌 | `POST /auth/v3/tenant_access_token/internal` |
| 创建目标 Base | `POST /base/v3/bases` |
| 查表 / 建表 | `GET/POST /bitable/v1/apps/:app_token/tables` |
| 查字段 / 建字段 | `GET/POST /bitable/v1/apps/:app_token/tables/:table_id/fields` |
| 扫描已有记录 | `GET /bitable/v1/apps/:app_token/tables/:table_id/records` |
| 批量新增 | `POST /bitable/v1/apps/:app_token/tables/:table_id/records/batch_create` |
| 批量更新 | `POST /bitable/v1/apps/:app_token/tables/:table_id/records/batch_update` |
| 补偿删除 | `POST /bitable/v1/apps/:app_token/tables/:table_id/records/batch_delete` |

## 已落地的 runner 集成

- `--sink <name>` 从平台任务参数中剥离，不会误传给采集或数据库入库脚本。
- 显式传 `--sink` 时，传入列表就是本次完整目的地列表；没有 `scrm` 就不会写数据库。
- 不传 `--sink` 时，runner 会读取 `platforms.<platform>.sinks`；未配置时默认 `["scrm"]`。
- `scripts/run-sinks.js` 是统一 sink runner；SCRM 数据库和飞书都从这里分发写入。
- `--sink-apply` 控制 sink 正式写入；不传时所有 sink 都只 dry-run。
- 平台任务成功后统一执行 sink runner；任一 sink 失败时，本次 runner 报告会标记失败。

## 后续集成

由于 MySQL 和 Feishu 没有共享事务，不能承诺真正分布式事务。实现文档里“全部成功才提交”统一解释为补偿式一致性；如果补偿失败，报告中必须输出 `needs_manual_reconcile` 和 record/table 明细。

后续新增 Google Sheets、Notion、Obsidian 等 sink 时，应复用当前完整 `--sink <sink>` 目的地声明和 `platforms.<platform>.sinks` 默认配置；不要给每个平台各自发明一套开关。

## 验收清单

- 默认 DB 入库命令不受影响。
- Feishu dry-run 能展示每个 dataset 的输入文件、源行数、写入行数、字段数、样例行。
- Feishu apply 能自动建表/补字段，并对同一输入重复执行时保持行数稳定。
- 无 `app_token` 时 dry-run 可用；apply 需要 `app_token` 或 `--create-base`。
- 新增 sink 只能通过统一 dataset payload 扩展，不直接读取平台原始 JSON 写入目标系统。
