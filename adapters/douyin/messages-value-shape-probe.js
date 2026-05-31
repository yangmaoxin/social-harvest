import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageValueShapeAttribution,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesValueShapeProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-value-shape-probe',
  description: '扫描抖音候选消息记录中 length-delimited 字段的脱敏形态，不输出正文或原始响应',
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
    'field_path',
    'value_hash',
    'value_kind',
    'value_bytes',
    'value_shape',
    'char_count',
    'charset',
    'has_space',
    'has_cjk',
    'has_emoji',
    'digit_ratio',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-value-shape-probe',
    description: douyinMessagesValueShapeProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesValueShapeProbeSpec.args,
    columns: douyinMessagesValueShapeProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageValueShapeAttribution(page, kwargs),
  });
}
