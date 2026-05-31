import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageProtobufBranchAttribution,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesProtobufBranchProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-protobuf-branch-probe',
  description: '汇总抖音私信候选记录内 protobuf-like 分支的脱敏深层结构，不输出正文或原始响应',
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
    'branch_field_path',
    'branch_hash',
    'branch_value_bytes',
    'branch_field_count',
    'branch_field_paths',
    'descendant_field_count',
    'descendant_length_delimited_count',
    'descendant_protobuf_branch_count',
    'descendant_utf8_text_count',
    'descendant_human_phrase_count',
    'descendant_json_leaf_count',
    'descendant_cjk_leaf_count',
    'descendant_value_kinds',
    'descendant_field_paths',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-protobuf-branch-probe',
    description: douyinMessagesProtobufBranchProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesProtobufBranchProbeSpec.args,
    columns: douyinMessagesProtobufBranchProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageProtobufBranchAttribution(page, kwargs),
  });
}
