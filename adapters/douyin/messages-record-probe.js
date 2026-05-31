import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageRecordAttribution,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesRecordProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-record-probe',
  description: '按候选消息记录输出抖音私信 protobuf 脱敏字段对照，不输出正文或原始响应',
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
    'message_id_hash',
    'timestamp_candidate',
    'timestamp_field_path',
    'direction_candidate_values',
    'payload_field_path',
    'payload_value_bytes',
    'payload_timestamp_candidate',
    'payload_timestamp_key',
    'payload_text_hash',
    'payload_text_key',
    'peer_hash_candidates',
    'metadata_hash_candidates',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-record-probe',
    description: douyinMessagesRecordProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesRecordProbeSpec.args,
    columns: douyinMessagesRecordProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageRecordAttribution(page, kwargs),
  });
}
