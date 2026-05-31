import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageField9Attribution,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesField9ProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-field9-probe',
  description: '探测抖音私信候选 field 9 重复项的脱敏结构，不输出正文或原始响应',
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
    'record_rank',
    'record_key_hash',
    'timestamp_candidate',
    'field9_item_rank',
    'field9_hash',
    'field9_value_bytes',
    'part1_hash',
    'part1_value_bytes',
    'part2_hash',
    'part2_kind',
    'part2_value_bytes',
    'part2_json_keys',
    'part2_field_count',
    'part2_field_paths',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-field9-probe',
    description: douyinMessagesField9ProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesField9ProbeSpec.args,
    columns: douyinMessagesField9ProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageField9Attribution(page, kwargs),
  });
}
