import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageDirectionScan,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesDirectionScanProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-direction-scan-probe',
  description: '按可见会话 rank 扫描 DOM/API 命中方向签名，帮助定位抖音私信方向字段，不输出正文或原始响应',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'thread_rank_start', type: 'int', default: 1, help: 'First visible conversation rank (1-based)' },
    { name: 'thread_rank_end', type: 'int', default: 5, help: 'Last visible conversation rank (1-based)' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Only scan conversations whose nickname/preview contains this text' },
    { name: 'message_limit', type: 'int', default: 20, help: 'Maximum visible messages per targeted conversation' },
    { name: 'include_outbound', type: 'bool', default: true, help: 'Keep visible outbound messages for direction comparison' },
    { name: 'dom_retry_count', type: 'int', default: 2, help: 'Retry DOM/API matching when either side is still empty' },
    { name: 'record_sample_limit', type: 'int', default: 30, help: 'Maximum candidate records to sample per protobuf response' },
  ],
  columns: [
    'rank',
    'thread_rank',
    'dom_row_count',
    'inbound_dom_count',
    'outbound_dom_count',
    'matched_dom_count',
    'inbound_matched_count',
    'outbound_matched_count',
    'dom_directions',
    'direction_candidate_sets',
    'inbound_direction_candidate_sets',
    'outbound_direction_candidate_sets',
    'matched_field_paths',
    'matched_payload_timestamp_keys',
    'matched_timestamp_delta_seconds',
    'matched_payload_timestamp_delta_seconds',
    'captured_api_count',
    'captured_url_paths',
    'api_row_count',
    'api_inbound_count',
    'api_outbound_count',
    'api_directions',
    'api_source_url_paths',
    'page_state',
    'url_path',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-direction-scan-probe',
    description: douyinMessagesDirectionScanProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 300,
    args: douyinMessagesDirectionScanProbeSpec.args,
    columns: douyinMessagesDirectionScanProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageDirectionScan(page, kwargs),
  });
}
