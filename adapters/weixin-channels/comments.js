import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  collectPostComments,
} from './shared.js';

cli({
  site: 'weixin-channels',
  name: 'comments',
  description: '获取微信视频号助手后台某条作品的评论',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 600,
  args: [
    { name: 'export-id', positional: true, required: true, help: 'Work export/object ID from `opencli weixin-channels posts`' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments to fetch across pages' },
    { name: 'all', type: 'boolean', default: false, help: 'Fetch all top-level comments by paging until exhausted' },
    { name: 'last-buff', default: '', help: 'Pagination cursor returned by the previous page' },
    { name: 'with-replies', type: 'boolean', default: false, help: 'Fetch nested replies for each top-level comment' },
    { name: 'reply-limit', type: 'int', default: 20, help: 'Maximum nested replies per top-level comment across pages' },
    { name: 'all-replies', type: 'boolean', default: false, help: 'Fetch all nested replies for each top-level comment' },
    { name: 'fav-only', type: 'boolean', default: false, help: 'Only fetch selected/favorite comments' },
    { name: 'for-mcn', type: 'boolean', default: false, help: 'Use MCN comment endpoint' },
  ],
  columns: [
    'rank',
    'comment_id',
    'export_id',
    'parent_comment_id',
    'author',
    'avatar_url',
    'reply_to',
    'text',
    'like_count',
    'reply_count',
    'is_reply',
    'comment_timestamp',
    'time',
  ],
  func: async (page, kwargs) => {
    const exportId = String(kwargs['export-id'] || '').trim();
    return collectPostComments(page, exportId, kwargs);
  },
});
