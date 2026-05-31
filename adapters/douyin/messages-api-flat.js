import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  fetchDouyinPrivateMessageApiRows,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesApiFlatSpec = {
  site: 'douyin',
  name: 'skill-messages-api-flat',
  description: '实验性导出抖音私信接口版可见消息，当前优先面向朋友私信对照 DOM 结果',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Maximum API message rows to return' },
    { name: 'include_outbound', type: 'boolean', default: false, help: 'Keep outbound rows for DOM/API comparison' },
    { name: 'thread_rank', type: 'int', default: 1, help: 'Prefer one visible conversation rank (1-based)' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Prefer conversations whose nickname/preview contains this text' },
    { name: 'conversation_clicks', type: 'int', default: 1, help: 'Maximum visible conversation candidates to click' },
    { name: 'load_history_clicks', type: 'int', default: 0, help: 'Click the visible 加载 button in the message pane this many times before reading API history' },
    { name: 'tab_name', type: 'string', default: '朋友私信', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'refresh', type: 'boolean', default: false, help: 'Reload private-message page before probing API rows' },
    { name: 'record_sample_limit', type: 'int', default: 80, help: 'Maximum candidate protobuf records to sample per response' },
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
  ],
  columns: [
    'row_rank',
    'thread_rank',
    'thread_id',
    'thread_nickname',
    'message_rank',
    'api_record_rank',
    'message_id',
    'sender_name',
    'direction',
    'content_source',
    'interaction_source',
    'direction_source',
    'direction_signal_sources',
    'direction_signal_hits',
    'direction_signal_score',
    'direction_signal_opposite_score',
    'direction_candidate_values',
    'text',
    'message_type',
    'timestamp',
    'time',
    'source_url_path',
    'candidate_path',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-api-flat',
    description: douyinMessagesApiFlatSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 300,
    args: douyinMessagesApiFlatSpec.args,
    columns: douyinMessagesApiFlatSpec.columns,
    func: async (page, kwargs) => fetchDouyinPrivateMessageApiRows(page, kwargs),
  });
}
