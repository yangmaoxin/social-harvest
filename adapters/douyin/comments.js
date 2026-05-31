import {
  fetchDouyinCommentReplies,
  fetchDouyinComments,
  normalizeDouyinComment,
  normalizeDouyinCommentLimit,
  normalizeDouyinPageLimit,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinCommentsSpec = {
  site: 'douyin',
  name: 'skill-comments',
  description: '抓取指定抖音视频的评论',
  args: [
    { name: 'aweme_id', type: 'string', required: true, positional: true, help: '抖音视频 aweme_id' },
    { name: 'limit', type: 'int', default: 20 },
    { name: 'cursor', type: 'string', default: '0' },
    { name: 'pages', type: 'int', default: 1 },
    { name: 'with_replies', type: 'bool', default: false },
    { name: 'reply_limit', type: 'int', default: 20 },
    { name: 'reply_pages', type: 'int', default: 1 },
  ],
  columns: [
    'comment_id',
    'aweme_id',
    'author',
    'avatar_url',
    'text',
    'time',
    'ip_location',
    'digg_count',
    'reply_count',
    'reply_to',
    'reply_to_comment_id',
    'parent_comment_id',
    'root_comment_id',
    'is_reply',
    'fetched_reply_count',
    'reply_fetch_status',
    'reply_fetch_error',
  ],
};

function extractDouyinCommentAuthorIds(item = {}) {
  const user = item?.user ?? {};
  return {
    sec_uid: String(
      user.sec_uid
      ?? user.secUid
      ?? item.sec_uid
      ?? item.secUid
      ?? item.author_sec_uid
      ?? ''
    ).trim(),
    uid: String(
      user.uid
      ?? user.user_id
      ?? user.userId
      ?? item.uid
      ?? item.user_id
      ?? item.userId
      ?? item.author_uid
      ?? ''
    ).trim(),
  };
}

function isExplicitSelfDouyinComment(item, selfSecUid, selfUid) {
  if (!item || (!selfSecUid && !selfUid)) {
    return false;
  }
  const authorIds = extractDouyinCommentAuthorIds(item);
  return (selfSecUid && authorIds.sec_uid === selfSecUid)
    || (selfUid && authorIds.uid === selfUid);
}

function addNormalizedReply(target, seenIds, reply, awemeId, topLevel, selfSecUid, selfUid) {
  if (isExplicitSelfDouyinComment(reply, selfSecUid, selfUid)) {
    return;
  }
  const normalized = normalizeDouyinComment(reply, awemeId, {
    is_reply: true,
    parent_comment_id: topLevel.comment_id,
    root_comment_id: topLevel.root_comment_id || topLevel.comment_id,
    reply_to_comment_id: topLevel.comment_id,
    reply_to: topLevel.author,
  });
  if (!normalized.comment_id || seenIds.has(normalized.comment_id)) {
    return;
  }
  seenIds.add(normalized.comment_id);
  target.push(normalized);
}

export async function fetchDouyinCommentRows(page, kwargs = {}) {
  const awemeId = String(kwargs.aweme_id ?? '').trim();
  if (!awemeId) {
    throw new Error('aweme_id is required');
  }

  if (typeof page?.goto === 'function') {
    await page.goto('https://www.douyin.com');
    if (typeof page.wait === 'function') {
      await page.wait(2);
    }
  }

  const limit = normalizeDouyinCommentLimit(kwargs.limit ?? 20, 20);
  const pages = normalizeDouyinPageLimit(kwargs.pages ?? 1, 1);
  const rows = await fetchDouyinComments(page, awemeId, {
    limit,
    cursor: kwargs.cursor ?? '0',
    pages,
  });
  const withReplies = kwargs.with_replies === true || String(kwargs.with_replies ?? '').toLowerCase() === 'true';
  const replyLimit = normalizeDouyinCommentLimit(kwargs.reply_limit ?? kwargs.limit ?? 20, 20);
  const replyPages = normalizeDouyinPageLimit(kwargs.reply_pages ?? 1, 1);
  const selfSecUid = String(kwargs.self_sec_uid ?? '').trim();
  const selfUid = String(kwargs.self_uid ?? '').trim();
  const normalized = [];

  for (const item of rows) {
    if (isExplicitSelfDouyinComment(item, selfSecUid, selfUid)) {
      continue;
    }
    const topLevel = normalizeDouyinComment(item, awemeId);
    topLevel.fetched_reply_count = 0;
    topLevel.reply_fetch_status = withReplies ? 'no_replies' : 'not_requested';
    topLevel.reply_fetch_error = '';
    normalized.push(topLevel);

    if (!withReplies) {
      continue;
    }

    const replies = [];
    const inlineReplyCount = Array.isArray(item.reply_comment) ? item.reply_comment.length : 0;
    const seenReplyIds = new Set();
    if (Array.isArray(item.reply_comment)) {
      for (const reply of item.reply_comment) {
        addNormalizedReply(replies, seenReplyIds, reply, awemeId, topLevel, selfSecUid, selfUid);
      }
    }

    if (topLevel.comment_id && topLevel.reply_count > inlineReplyCount) {
      try {
        const fetchedReplies = await fetchDouyinCommentReplies(page, awemeId, topLevel.comment_id, {
          limit: replyLimit,
          pages: replyPages,
        });
        for (const reply of fetchedReplies) {
          addNormalizedReply(replies, seenReplyIds, reply, awemeId, topLevel, selfSecUid, selfUid);
        }
        topLevel.reply_fetch_status = replies.length >= topLevel.reply_count ? 'complete' : 'partial';
      } catch {
        // Douyin's expanded reply endpoint can require a fresher signed browser state.
        // Keep top-level comments and inline replies usable when that endpoint rejects.
        topLevel.reply_fetch_status = replies.length ? 'partial' : 'failed';
        topLevel.reply_fetch_error = 'expanded_reply_request_failed';
      }
    } else if (replies.length) {
      topLevel.reply_fetch_status = 'complete';
    }

    topLevel.fetched_reply_count = replies.length;
    normalized.push(...replies);
  }

  return normalized;
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-comments',
    description: douyinCommentsSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: 'https://www.douyin.com',
    browser: true,
    defaultFormat: 'json',
    args: douyinCommentsSpec.args,
    columns: douyinCommentsSpec.columns,
    func: async (page, kwargs) => fetchDouyinCommentRows(page, kwargs),
  });
}
