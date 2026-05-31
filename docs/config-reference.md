# 配置文件说明

配置文件分两份：

- `config.example.json`
  模板文件，可以提交到仓库。
- `config.local.json`
  本机真实配置，放数据库密码、API Key、真实账号，不建议提交。

JSON 不支持 `//` 注释，所以配置文件里只保留一条 `_comment` 指向本文档。程序读取配置时会忽略 `_comment`。

## 顶层结构

```json
{
  "ai": {},
  "sinks": {},
  "default_sinks": ["scrm"],
  "platforms": {}
}
```

- `ai`
  评论和私信的意向分析配置。
- `platforms`
  各平台的抓取配置。现在只配置抖音账号；微信视频号依赖已登录后台，无需配置账号。
- `sinks`
  写入目标配置。`sinks.scrm` 用于 SCRM 数据库；`sinks.feishu` 用于飞书多维表格。
- `default_sinks`
  平台未显式配置 `sinks` 时使用的默认写入目的地。默认建议 `["scrm"]`，保持老任务只写数据库。

## sinks.scrm

```json
{
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
}
```

- `type`
  数据库 sink 类型。当前固定为 `mysql`。
- `host`
  MySQL 地址，可以是域名或 IP。
- `user`
  MySQL 用户名。
- `password`
  MySQL 密码。
- `db_name`
  要写入的数据库名。
- `media`
  SCRM 数据库需要稳定图片地址时使用的媒体配置。当前支持阿里云 OSS；飞书附件直传不依赖这里。

可用环境变量覆盖：

- `HARVEST_SCRM_DB_HOST`
- `HARVEST_SCRM_DB_USER`
- `HARVEST_SCRM_DB_PASSWORD`
- `HARVEST_SCRM_DB_NAME`

### sinks.scrm.media

- `backend`
  媒体后端。当前固定为 `oss`。
- `region`
  OSS 区域，例如 `oss-cn-beijing`。
- `bucket`
  OSS bucket 名称。
- `access_key_id`
  阿里云 AccessKey ID。只放在 `config.local.json` 或环境变量，不要提交。
- `access_key_secret`
  阿里云 AccessKey Secret。只放在 `config.local.json` 或环境变量，不要提交。
- `prefix`
  OSS key 的统一根目录，默认建议 `social-harvest`。
- `key_template`
  OSS key 模板。默认按平台、平台账号和月份组织：`{prefix}/{platform}/{account_id}/{yyyy}/{mm}/{entity_type}/{entity_id}/{image_type}.{ext}`。
- `public_base_url`
  业务系统读取图片时使用的稳定域名。可以是 OSS bucket 域名、CDN 域名或自定义域名。

SCRM 正式写库前会把作品封面、评论头像、私信头像、弹幕头像和账号头像上传到 OSS，并把数据库图片字段改写成 `public_base_url + OSS key`。如果同一个 OSS key 已存在，会复用已有对象，不重复上传。图片下载或上传失败时，不会把原平台鉴权 URL 写入 SCRM，而是清空对应图片字段并在运行输出里写入 `MEDIA_SUMMARY` warning。

已有数据库里的旧平台图片 URL 可以用 backfill 命令迁到 OSS。默认 dry-run，只统计候选行，不下载、不上传、不写库：

```bash
npm run media:smoke-oss
npm run media:backfill-scrm
npm run media:backfill-scrm -- --table file --limit 20
npm run media:backfill-scrm -- --apply
```

`media:smoke-oss` 会上传一个极小 PNG 验证 OSS 配置和写入权限，默认验证后删除；如需保留测试图片用于手动打开 URL，使用 `npm run media:smoke-oss -- --keep`。

如需把仍然无法下载或上传的旧平台 URL 清空，显式加 `--clear-failed`：

```bash
npm run media:backfill-scrm -- --apply --clear-failed
```

媒体环境变量覆盖：

- `HARVEST_SCRM_MEDIA_BACKEND`
- `HARVEST_SCRM_OSS_REGION`
- `HARVEST_SCRM_OSS_BUCKET`
- `HARVEST_SCRM_OSS_ACCESS_KEY_ID`
- `HARVEST_SCRM_OSS_ACCESS_KEY_SECRET`
- `HARVEST_SCRM_OSS_PREFIX`
- `HARVEST_SCRM_OSS_KEY_TEMPLATE`
- `HARVEST_SCRM_OSS_PUBLIC_BASE_URL`

这些字段会被导入脚本用于写入：

- `scrm_file`
- `scrm_comment`
- `scrm_message`
- `scrm_danmaku`

## ai

```json
{
  "base_url": "https://api-inference.modelscope.cn/v1",
  "api_key": "your-modelscope-token",
  "models": ["ZhipuAI/GLM-5"],
  "model": "ZhipuAI/GLM-5",
  "enabled": true,
  "ssl_verify": true,
  "ca_file": "",
  "timeout_seconds": 30,
  "batch_size": 20
}
```

- `base_url`
  OpenAI 兼容接口地址。当前默认是 ModelScope。
- `api_key`
  AI 服务 Key。
- `models`
  候选模型池。按数组顺序尝试；前一个模型失败时会尝试下一个。
- `model`
  首选模型。通常填模型池里的第一个即可。
- `enabled`
  是否启用 AI 意向分析。设为 `false` 时跳过 AI，评论/私信不会自动分类。
- `ssl_verify`
  是否校验 HTTPS 证书。生产建议 `true`；本地证书问题排查时可以临时设为 `false`。
- `ca_file`
  自定义 CA 证书路径。不需要时留空。
- `timeout_seconds`
  单次 AI 请求超时时间，单位秒。
- `batch_size`
  每批送给 AI 分类的评论/私信数量。

意向分析结果会写到 `intention` 字段：

- `0` 未分析
- `1` 无意向
- `2` 低意向
- `3` 中意向
- `4` 高意向

## sinks.feishu

飞书写入直接调用官方 Bitable API。`app_id` / `app_secret` 用来换取 `tenant_access_token`；`app_token` 是目标多维表格 Base 的唯一标识，不是 API access token。

```json
{
  "app_id": "cli_xxx",
  "app_secret": "your-feishu-app-secret",
  "app_token": "your-base-app-token",
  "table_prefix": "harvest",
  "base_name": "Social Harvest 写入",
  "api_base_url": "https://open.feishu.cn/open-apis"
}
```

- `app_id`
  飞书企业自建应用 ID。也可以用环境变量 `HARVEST_FEISHU_APP_ID` 覆盖。
- `app_secret`
  飞书企业自建应用密钥。只放在 `config.local.json` 或环境变量，不要提交。也可以用环境变量 `HARVEST_FEISHU_APP_SECRET` 覆盖。
- `app_token`
  飞书多维表格 Base 的 `app_token` 标识，也就是 Base URL 里 `/base/<token>` 的 `<token>`。也可以用环境变量 `HARVEST_FEISHU_APP_TOKEN` 覆盖。没有现成 Base 时，可以用 `--create-base` 创建，创建成功后把返回的 `app_token` 写回配置。
- `table_prefix`
  自动创建表时使用的前缀。默认 `harvest`，例如 `harvest_works`、`harvest_comments`。
- `base_name`
  `--create-base` 时新建多维表格的名称。
- `api_base_url`
  可选。飞书 OpenAPI 地址，默认 `https://open.feishu.cn/open-apis`。通常不用改。

可用环境变量覆盖：

- `HARVEST_FEISHU_APP_ID`
- `HARVEST_FEISHU_APP_SECRET`
- `HARVEST_FEISHU_APP_TOKEN`
- `HARVEST_FEISHU_TABLE_PREFIX`
- `HARVEST_FEISHU_BASE_NAME`
- `HARVEST_FEISHU_API_BASE_URL`

飞书写入命令默认 dry-run，不会写入飞书：

```bash
npm run publish:feishu -- --platform douyin --output-dir samples/douyin/<date>/<account> --dataset all
```

正式写入必须显式加 `--apply`：

```bash
npm run publish:feishu -- --platform douyin --output-dir samples/douyin/<date>/<account> --dataset all --apply
```

如果要同时写入面向运营查看的中文展示表，加 `--display-tables`：

```bash
npm run publish:feishu -- --platform weixin-channels --output-dir samples/tasks/<task>/weixin-channels --dataset all --display-tables --apply
```

展示表会把封面和头像写入飞书附件字段。默认是增量上传：同一展示表、同一 `source_key`、同一附件字段里已有文件时，会跳过下载和上传；即使本次抓到的图片 URL 变了，也只更新来源链接字段。很多平台图片 URL 是临时签名地址，不要用完整 URL 作为“是否同一张图”的判断依据。相关开关：

- `--skip-display-images`
  只写图片 URL，不上传封面/头像附件。
- `--refresh-display-images`
  忽略已有附件，重新下载并上传展示图。

平台任务里也可以组合外部 sink：

```bash
# 只写飞书 dry-run
node scripts/task-runner.js run --platform douyin -- --sink feishu

# 只写飞书正式写入
node scripts/task-runner.js run --platform douyin -- --sink feishu --sink-apply

# 同时写数据库和飞书
node scripts/task-runner.js run --platform douyin -- --sink scrm --sink feishu --sink-apply
```

底层统一入口是 `npm run sink:run`，平台 runner 会自动调用它；只有在已有输出目录、想手动补写多个 sink 时才需要直接使用：

```bash
npm run sink:run -- --platform douyin --output-dir samples/tasks/<task>/douyin --sink scrm --sink feishu --sink-apply
npm run sink:run -- --platform douyin --output-dir samples/tasks/<task>/douyin --sink feishu --dataset messages --sink-apply
```

`--dataset` 可选，用来补写局部规范化数据集，例如 `content`、`danmaku`、`messages`、`accounts`、`metric_snapshots`、`metric_delta_events`；不传时默认 `all`。

## platforms

```json
{
  "douyin": {
    "sinks": ["scrm"],
    "video_limit": 10,
    "comment_limit": 10,
    "with_replies": true,
    "accounts": []
  }
}
```

`platforms` 用来放各平台自己的抓取配置。`sinks` 是该平台默认写入目的地；不配置时使用顶层 `default_sinks`，再没有则默认 `["scrm"]`。如果某个平台日常只需要飞书，可以配置为 `["feishu"]`；如果数据库和飞书都要写，配置为 `["scrm", "feishu"]`。

新增小红书之类的平台时可以加成：

```json
{
  "platforms": {
    "xiaohongshu": {
      "accounts": []
    }
  }
}
```

目前微信视频号不放账号配置，因为它走视频号助手后台登录态。

## platforms.douyin

- `video_limit`
  每个账号默认抓多少条作品。作品包括视频和图文。
- `comment_limit`
  每条作品默认抓多少条一级评论。
- `with_replies`
  是否抓接口里直接带回来的二级回复。
- `accounts`
  要抓取的抖音账号列表。

如果账号里也配置了 `video_limit`、`comment_limit`、`with_replies`，账号里的值会覆盖抖音平台默认值。

## 抖音账号字段

```json
{
  "id": "main",
  "label": "主账号",
  "account_id": "23032383075",
  "sec_uid": "MS4wLjABAAAA...",
  "video_limit": 5,
  "comment_limit": 5,
  "with_replies": true,
  "enabled": true
}
```

- `id`
  账号 ID，也会用作输出目录名。建议只用英文、数字、短横线，比如 `main`、`image-text-account`。
- `label`
  给人看的账号名称，不影响抓取。
- `account_id`
  可选。推荐填写平台对外唯一账号标识，例如抖音号。公开作品链路正式入库 `scrm_file` / `scrm_comment` 时，如果样本里没能自动解析出抖音号，会回退使用这里的值作为账号归属。
- `sec_uid`
  抖音公开接口使用的稳定用户标识。推荐配置这个，最稳定。
- `identifier`
  可选。没有 `sec_uid` 时可以配置用户主页链接或抖音号文本，但稳定性不如 `sec_uid`。
- `video_limit`
  可选。只覆盖当前账号每次抓多少条作品。
- `comment_limit`
  可选。只覆盖当前账号每条作品抓多少条一级评论。
- `with_replies`
  可选。只覆盖当前账号是否抓二级回复。
- `enabled`
  可选。`true` 或不写表示启用；`false` 表示批量抓取时跳过这个账号。

账号最小配置：

```json
{
  "id": "main",
  "label": "主账号",
  "sec_uid": "MS4wLjABAAAA..."
}
```

## 运行方式

按配置抓所有启用的抖音账号：

```bash
node scripts/harvest-douyin.js --date <YYYY-MM-DD>
```

抓完并 dry-run 入库：

```bash
node scripts/harvest-douyin.js --date <YYYY-MM-DD> --import-scrm
```

抓完并真正写库：

```bash
node scripts/harvest-douyin.js --date <YYYY-MM-DD> --import-scrm-apply
```

只跑某一个账号：

```bash
node scripts/harvest-douyin.js --account image-text-account --import-scrm
```

输出目录：

```text
samples/douyin/<date>/<account-id>/harvest.json
samples/douyin/<date>/index.json
```
