import { cli, Strategy } from '@jackwener/opencli/registry';

import { collectPostComments, fetchPostList, parsePositiveInt } from './shared.js';

cli({
  site: 'weixin-channels',
  name: 'harvest',
  description: '获取微信视频号助手后台作品流、封面和对应评论',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 1800,
  defaultFormat: 'json',
  args: [
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of posts to fetch across pages' },
    { name: 'all-posts', type: 'boolean', default: false, help: 'Fetch all posts by paging until exhausted' },
    { name: 'comment-limit', type: 'int', default: 20, help: 'Number of top-level comments per post across pages' },
    { name: 'all-comments', type: 'boolean', default: false, help: 'Fetch all top-level comments per post by paging until exhausted' },
    { name: 'with-replies', type: 'boolean', default: true, help: 'Fetch nested replies for each top-level comment' },
    { name: 'reply-limit', type: 'int', default: 20, help: 'Maximum nested replies per top-level comment across pages' },
    { name: 'all-replies', type: 'boolean', default: false, help: 'Fetch all nested replies for each top-level comment' },
    { name: 'only-unread', type: 'boolean', default: false, help: 'Only return posts with unread comments' },
    { name: 'fav-only', type: 'boolean', default: false, help: 'Only fetch selected/favorite comments' },
    { name: 'for-mcn', type: 'boolean', default: false, help: 'Use MCN endpoint variants' },
  ],
  columns: [
    'rank',
    'object_id',
    'title',
    'cover_url',
    'publish_timestamp',
    'publish_time',
    'fav_count',
    'share_count',
    'comment_count',
    'fetched_comment_count',
  ],
  func: async (page, kwargs) => {
    const allPosts = Boolean(kwargs['all-posts']);
    const allComments = Boolean(kwargs['all-comments']);
    const postLimit = allPosts ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs.limit, 10, { min: 1, max: 5000 });
    const commentLimit = allComments ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs['comment-limit'], 20, { min: 1, max: 5000 });

    const posts = await fetchPostList(page, {
      ...kwargs,
      all: allPosts,
      limit: postLimit,
    });

    const results = [];
    for (const [index, post] of posts.entries()) {
      const comments = await collectPostComments(page, post.object_id, {
        limit: commentLimit,
        all: allComments,
        'with-replies': kwargs['with-replies'],
        'reply-limit': kwargs['reply-limit'],
        'all-replies': kwargs['all-replies'],
        'fav-only': kwargs['fav-only'],
        'for-mcn': kwargs['for-mcn'],
      });

      results.push({
        ...post,
        rank: index + 1,
        fetched_comment_count: comments.length,
        comments,
      });
    }

    return results;
  },
});
