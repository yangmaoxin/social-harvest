import { cli, Strategy } from '@jackwener/opencli/registry';

import { flattenBulletChats } from './shared.js';

cli({
  site: 'weixin-channels',
  name: 'danmaku-flat',
  description: '扁平导出微信视频号助手后台弹幕明细，适合入库和分析',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 900,
  defaultFormat: 'json',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of videos with danmaku to inspect' },
    { name: 'all', type: 'boolean', default: false, help: 'Inspect all visible videos with danmaku' },
    { name: 'work-ids', type: 'string', default: '', help: 'Comma-separated object_id/export_id values to inspect' },
    { name: 'work-ids-file', type: 'string', default: '', help: 'JSON file containing work ids or a delta plan' },
  ],
  columns: [
    'row_rank',
    'video_rank',
    'video_title',
    'content',
    'comment_user_name',
    'video_timestamp_text',
    'created_at',
  ],
  func: async (page, kwargs) => flattenBulletChats(page, kwargs),
});
