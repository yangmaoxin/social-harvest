import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageFieldAttribution,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesFieldProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-field-probe',
  description: '归因抖音私信 protobuf 候选消息字段，不输出私信正文或原始响应',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'record_sample_limit', type: 'int', default: 30, help: 'Maximum candidate records to sample per protobuf response' },
    { name: 'limit', type: 'int', default: 10, help: 'Maximum deduped API entries to inspect' },
  ],
  columns: [
    'rank',
    'current_url',
    'title',
    'url_path',
    'status',
    'response_byte_length',
    'candidate_path',
    'record_count',
    'sampled_record_count',
    'field_path',
    'field_no',
    'depth',
    'wire_type',
    'value_type',
    'count',
    'record_coverage',
    'value_bytes_min',
    'value_bytes_max',
    'numeric_min',
    'numeric_max',
    'timestamp_min',
    'timestamp_max',
    'enum_values',
    'string_like_count',
    'nested_count',
    'redacted_hash_samples',
    'role_candidates',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-field-probe',
    description: douyinMessagesFieldProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesFieldProbeSpec.args,
    columns: douyinMessagesFieldProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageFieldAttribution(page, kwargs),
  });
}
