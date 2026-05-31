import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageApiFlatScan,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesApiScanProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-api-scan-probe',
  description: '按可见会话 rank 扫描抖音私信接口导出摘要，帮助快速定位哪些会话当前存在入站消息',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'thread_rank_start', type: 'int', default: 1, help: 'First visible conversation rank (1-based)' },
    { name: 'thread_rank_end', type: 'int', default: 5, help: 'Last visible conversation rank (1-based)' },
    { name: 'record_sample_limit', type: 'int', default: 80, help: 'Maximum candidate records to sample per protobuf response' },
  ],
  columns: [
    'rank',
    'thread_rank',
    'requested_thread_nickname',
    'thread_nickname',
    'api_row_count',
    'inbound_count',
    'outbound_count',
    'directions',
    'first_time',
    'last_time',
    'source_url_paths',
    'errors',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-api-scan-probe',
    description: douyinMessagesApiScanProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 300,
    args: douyinMessagesApiScanProbeSpec.args,
    columns: douyinMessagesApiScanProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageApiFlatScan(page, kwargs),
  });
}
