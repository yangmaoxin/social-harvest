import { cli, Strategy } from '@jackwener/opencli/registry';

import { fetchImageTextList } from './shared.js';

cli({
  site: 'weixin-channels',
  name: 'image-texts',
  description: '获取微信视频号助手后台的图文列表',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 300,
  args: [
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of image-text posts to fetch across pages' },
    { name: 'all', type: 'boolean', default: false, help: 'Fetch all image-text posts by paging until exhausted' },
    { name: 'only-unread', type: 'boolean', default: false, help: 'Only return posts with unread comments' },
    { name: 'for-mcn', type: 'boolean', default: false, help: 'Use MCN endpoint variants' },
    { name: 'api-path', type: 'string', default: '', help: 'Override the image-text list API path when the backend changes' },
  ],
  columns: [
    'rank',
    'object_id',
    'title',
    'cover_url',
    'image_count',
    'image_urls',
    'publish_timestamp',
    'publish_time',
    'media_type',
    'view_count',
    'like_count',
    'fav_count',
    'share_count',
    'comment_count',
    'unread_comment_count',
  ],
  func: async (page, kwargs) => {
    return fetchImageTextList(page, kwargs);
  },
});
