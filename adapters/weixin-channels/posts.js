import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  fetchPostList,
} from './shared.js';

cli({
  site: 'weixin-channels',
  name: 'posts',
  description: '获取微信视频号助手后台的账号作品流',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 300,
  args: [
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of posts to fetch across pages' },
    { name: 'all', type: 'boolean', default: false, help: 'Fetch all posts by paging until exhausted' },
    { name: 'only-unread', type: 'boolean', default: false, help: 'Only return posts with unread comments' },
    { name: 'for-mcn', type: 'boolean', default: false, help: 'Use MCN list endpoint' },
  ],
  columns: [
    'rank',
    'object_id',
    'title',
    'cover_url',
    'publish_timestamp',
    'publish_time',
    'media_type',
    'duration',
    'view_count',
    'like_count',
    'fav_count',
    'share_count',
    'comment_count',
    'unread_comment_count',
  ],
  func: async (page, kwargs) => {
    return fetchPostList(page, kwargs);
  },
});
