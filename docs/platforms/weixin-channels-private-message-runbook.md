# 微信视频号私信入库手册

这份文档只覆盖一件事：

- 把微信视频号私信和打招呼消息写入 `scrm_message`

如果你要看完整的作品/评论/私信总流程，回到：

- [weixin-channels-scrm-operator-guide.md](./weixin-channels-scrm-operator-guide.md)

## 1. 当前入口

普通日常不再单独跑私信，统一使用仓库根目录的一线入口：

```bash
npm run daily:weixin-channels
```

下面的脚本只作为内部排障入口。

### 1.1 私信脚本排障

```bash
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```

这条命令会导出 `private-messages-flat.json`，再把对方发来的消息写入 `scrm_message`。

### 1.2 主流程脚本排障

```bash
node scripts/resume-weixin-channels.js --date <YYYY-MM-DD> --import-scrm-message-apply
```

如果还想把作品/评论一起导入，再额外带上：

- `--import-scrm-apply`

## 2. 当前输出文件

当前标准中间产物：

- `samples/weixin-channels/<date>/private-messages-flat.json`

特点：

- 一行一条消息
- 只保留对方发来的消息
- 直接面向 `scrm_message` 入库

## 3. 字段映射

- `comment_id <- message_id`
- `comment_user_name <- sender_name`
- `comment_user_photo <- sender_avatar_url`
- `content <- text`
- `origin_type <- 1`
- `intention <- AI 分析结果（0 未分析 / 1 无意向 / 2 低 / 3 中 / 4 高）`
- `created_at <- time`

## 4. 当前边界

当前只写入：

- 对方发来的私信
- 对方发来的打招呼消息

要启用 AI 意向分析，至少配置：

- `OPENCLI_MODELSCOPE_API_KEY` 或 `MODELSCOPE_API_KEY`

可选配置：

- `OPENCLI_MODELSCOPE_BASE_URL`，默认 `https://api-inference.modelscope.cn/v1`
- `OPENCLI_MODELSCOPE_MODEL`，如果设置，会强制只用这一个模型
- `OPENCLI_MODELSCOPE_MODELS`，可传逗号分隔的模型池；本地配置也支持 `ai.models` 数组

默认模型池会按顺序尝试，前一个模型无响应或报错时自动切到下一个：

- `ZhipuAI/GLM-5`
- `Qwen/Qwen3.5-397B-A17B`
- `Qwen/Qwen3-235B-A22B-Instruct-2507`
- `Qwen/Qwen3-Next-80B-A3B-Instruct`
- `ZhipuAI/GLM-5.1`
- `Qwen/Qwen3.5-35B-A3B`
- `Qwen/Qwen3.5-27B`
- `Qwen/Qwen3-Coder-30B-A3B-Instruct`
- `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`
- `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B`

当前不会写入：

- 我方发出的消息
- 会话级统计字段
- `thread_id/tab` 这类上下文字段

## 5. 最小排错清单

如果跑不出来，优先检查：

1. 浏览器是否登录了微信视频号助手后台
2. 私信页是否真的能看到会话列表
3. `private-messages-flat.json` 是否已经生成
4. 数据库环境变量是否正确
5. `scrm_message` 的唯一索引是否还在

## 6. 现在最推荐的日常用法

先配好仓库根目录的 `config.local.json`，然后直接跑视频号日常：

```bash
npm run daily:weixin-channels
```

如果是在排查私信脚本，才使用统一断点参数：

```bash
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --full --batch-size 50 --apply
```

脚本会写出 `private-messages-checkpoint.json`，按会话 offset 分批续跑；不传 `--refresh` 时默认接着上次位置继续，传 `--refresh` 则清空断点后重新开始。

如果你临时不用 `config.local.json`，再改用环境变量覆盖：

```bash
HARVEST_SCRM_DB_HOST='your-mysql-host' \
HARVEST_SCRM_DB_USER='your-mysql-user' \
HARVEST_SCRM_DB_PASSWORD='your-mysql-password' \
HARVEST_SCRM_DB_NAME='your-database-name' \
node scripts/sync-weixin-channels-private-messages-to-scrm-message.js --date <YYYY-MM-DD> --apply
```
