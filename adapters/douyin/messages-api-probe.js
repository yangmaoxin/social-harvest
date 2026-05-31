import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageApis,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesApiProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-api-probe',
  description: '探测抖音创作者中心私信页 network API 结构，不保存私信正文',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'refresh', type: 'boolean', default: false, help: 'Reload private-message page before probing network traffic' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'thread_rank', type: 'int', default: 0, help: 'Prefer one visible conversation rank when fallback DOM clicking is needed' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Prefer conversations whose nickname/preview contains this text when fallback DOM clicking is needed' },
    { name: 'load_history_clicks', type: 'int', default: 0, help: 'Click the visible 加载 button in the message pane this many times before capturing API history' },
    { name: 'record_sample_limit', type: 'int', default: 30, help: 'Maximum candidate protobuf records to sample per response' },
    { name: 'keep_duplicates', type: 'boolean', default: false, help: 'Keep duplicate API captures for timing-sensitive diagnosis' },
    { name: 'include_message_values', type: 'boolean', default: false, help: 'Experimental: include parsed text/time/direction inside record_samples for one-off diagnosis' },
    { name: 'limit', type: 'int', default: 30, help: 'Maximum deduped API entries to return' },
  ],
  columns: [
    'rank',
    'current_url',
    'title',
    'page_state',
    'captured_count',
    'deduped_count',
    'source',
    'url_path',
    'method',
    'status',
    'response_type',
    'content_type',
    'request_body_type',
    'request_body_byte_length',
    'request_body_hash',
    'response_byte_length',
    'response_body_hash',
    'request_wire_shape',
    'response_wire_shape',
    'query_keys',
    'response_array_paths',
    'response_shape',
    'request_shape',
    'captured_at',
    'capture_phase',
    'capture_phase_index',
    'target_click_index',
    'target_click_label',
    'capture_phase_elapsed_ms',
    'click_result',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-api-probe',
    description: douyinMessagesApiProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesApiProbeSpec.args,
    columns: douyinMessagesApiProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageApis(page, kwargs),
  });
}
