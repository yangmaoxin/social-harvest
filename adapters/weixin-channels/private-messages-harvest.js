import { cli, Strategy } from '@jackwener/opencli/registry';

import { harvestPrivateMessages } from './shared.js';

cli({
  site: 'weixin-channels',
  name: 'private-messages-harvest',
  description: '聚合导出微信视频号助手后台私信和打招呼消息',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 900,
  defaultFormat: 'json',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of conversations to fetch across selected tabs' },
    { name: 'all', type: 'boolean', default: false, help: 'Fetch all visible conversations across the selected tabs' },
    { name: 'tab', default: 'both', help: 'private | greeting | both' },
    { name: 'with-messages', type: 'boolean', default: true, help: 'Open each conversation and collect message details' },
    { name: 'message-limit', type: 'int', default: 50, help: 'Maximum messages to keep per conversation' },
    { name: 'all-messages', type: 'boolean', default: false, help: 'Keep all visible messages per conversation' },
    { name: 'thread-offset', type: 'int', default: 0, help: 'Skip this many conversations after sorting' },
    { name: 'thread-limit', type: 'int', default: 0, help: 'Keep at most this many conversations after offset; 0 uses limit/all' },
  ],
  columns: [
    'rank',
    'tab_label',
    'thread_count',
    'fetched_message_count',
    'latest_time',
  ],
  func: async (page, kwargs) => harvestPrivateMessages(page, kwargs),
});
