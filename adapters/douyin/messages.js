import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  fetchDouyinPrivateMessageRows,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesFlatSpec = {
  site: 'douyin',
  name: 'skill-messages-flat',
  description: '只读导出已登录账号的抖音入站单聊私信，跳过自己发送和群聊',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of conversations to inspect' },
    { name: 'all', type: 'boolean', default: false, help: 'Inspect more visible conversations' },
    { name: 'message_limit', type: 'int', default: 20, help: 'Maximum messages per conversation after visible/history loading' },
    { name: 'all_messages', type: 'boolean', default: false, help: 'Keep more loaded messages per conversation; sync script defaults to 200 when not specified' },
    { name: 'include_outbound', type: 'boolean', default: false, help: 'Keep outbound rows for DOM diagnosis' },
    { name: 'thread_rank', type: 'int', default: 0, help: 'Only keep one visible conversation rank (1-based)' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Only keep conversations whose nickname/preview contains this text' },
    { name: 'load_history_clicks', type: 'int', default: 0, help: 'Click the visible 加载 button in the message pane this many times before reading DOM messages' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin web private message URL' },
  ],
  columns: [
    'row_rank',
    'thread_rank',
    'thread_id',
    'thread_nickname',
    'thread_avatar_url',
    'thread_preview_text',
    'thread_latest_timestamp',
    'thread_latest_time',
    'thread_unread_count',
    'thread_message_count',
    'message_rank',
    'message_id',
    'sender_name',
    'sender_avatar_url',
    'direction',
    'text',
    'message_type',
    'timestamp',
    'time',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-flat',
    description: douyinMessagesFlatSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 600,
    args: douyinMessagesFlatSpec.args,
    columns: douyinMessagesFlatSpec.columns,
    func: async (page, kwargs) => fetchDouyinPrivateMessageRows(page, kwargs),
  });
}
