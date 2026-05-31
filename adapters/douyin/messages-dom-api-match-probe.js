import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageDomApiMatch,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesDomApiMatchProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-dom-api-match-probe',
  description: '对照 DOM 可见私信 hash 与 imapi protobuf 候选字段 hash，不输出正文或原始响应',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'refresh', type: 'boolean', default: false, help: 'Reload private-message page before matching DOM messages to API traffic' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'limit', type: 'int', default: 5, help: 'Maximum visible conversations to inspect' },
    { name: 'message_limit', type: 'int', default: 20, help: 'Maximum visible messages per conversation' },
    { name: 'thread_rank', type: 'int', default: 0, help: 'Only keep one visible conversation rank (1-based)' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Only keep conversations whose nickname/preview contains this text' },
    { name: 'load_history_clicks', type: 'int', default: 0, help: 'Click the visible 加载 button in the message pane this many times before matching DOM/API history' },
    { name: 'include_outbound', type: 'bool', default: true, help: 'Keep visible outbound messages for direction comparison' },
    { name: 'dom_retry_count', type: 'int', default: 2, help: 'Retry DOM/API matching when either side is still empty' },
    { name: 'record_sample_limit', type: 'int', default: 30, help: 'Maximum candidate records to sample per protobuf response' },
    { name: 'api_limit', type: 'int', default: 10, help: 'Maximum deduped API entries to inspect' },
  ],
  columns: [
    'rank',
    'dom_message_rank',
    'dom_row_count',
    'page_state',
    'captured_api_count',
    'captured_url_paths',
    'dom_text_hash',
    'dom_text_length',
    'dom_sender_hash',
    'dom_time',
    'dom_direction',
    'api_match_count',
    'matched_field_paths',
    'matched_record_ranks',
    'matched_value_shapes',
    'matched_value_bytes',
    'matched_direction_candidate_sets',
    'matched_timestamp_candidates',
    'matched_payload_timestamp_candidates',
    'matched_payload_timestamp_keys',
    'matched_timestamp_delta_seconds',
    'matched_payload_timestamp_delta_seconds',
    'inbound_only_peer_hash_candidates',
    'outbound_only_peer_hash_candidates',
    'inbound_only_metadata_hash_candidates',
    'outbound_only_metadata_hash_candidates',
    'inbound_only_field9_part1_hashes',
    'outbound_only_field9_part1_hashes',
    'inbound_only_field9_part2_hashes',
    'outbound_only_field9_part2_hashes',
    'candidate_path',
    'record_count',
    'sampled_record_count',
    'url_path',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-dom-api-match-probe',
    description: douyinMessagesDomApiMatchProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 300,
    args: douyinMessagesDomApiMatchProbeSpec.args,
    columns: douyinMessagesDomApiMatchProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageDomApiMatch(page, kwargs),
  });
}
