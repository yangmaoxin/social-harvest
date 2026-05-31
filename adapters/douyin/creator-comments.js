import {
  DOUYIN_CREATOR_COMMENT_MANAGE_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  formatDouyinTimestamp,
  normalizeDouyinCommentLimit,
  normalizeDouyinPageLimit,
  normalizeDouyinVideoLimit,
} from './shared.js';
import { preserveCreatorJsonLargeIdValues } from './creator-works.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinCreatorCommentsSpec = {
  site: 'douyin',
  name: 'skill-creator-comments',
  description: '抓取抖音创作者中心评论管理列表，输出后台评论基础字段',
  args: [
    { name: 'item_id', type: 'string', required: true, positional: true, help: 'Creator comment-management item_id, or auto to use the page\'s select-work list first' },
    { name: 'aweme_id', type: 'string', default: '', help: 'Public aweme_id from skill-creator-works, used by the newer creator comment list path' },
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_COMMENT_MANAGE_URL, help: 'Douyin creator comment management URL' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum comments per page' },
    { name: 'cursor', type: 'string', default: '0', help: 'cursor value for creator comment list' },
    { name: 'pages', type: 'int', default: 1, help: 'Maximum top-level comment pages' },
    { name: 'sort', type: 'string', default: '', help: 'Creator center comment sort option' },
    { name: 'with_replies', type: 'bool', default: false, help: 'Also fetch reply rows for each top-level comment' },
    { name: 'reply_limit', type: 'int', default: 20, help: 'Maximum replies per page' },
    { name: 'reply_pages', type: 'int', default: 1, help: 'Maximum reply pages per top-level comment' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
  ],
  columns: [
    'data_source',
    'rank',
    'comment_id',
    'item_id',
    'author',
    'author_uid',
    'author_sec_uid',
    'avatar_url',
    'text',
    'time',
    'create_time',
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
    'has_more',
    'next_cursor',
    'source_url_path',
  ],
};

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function firstArrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value[0];
  }
  return '';
}

function normalizeCreatorCommentRow(comment = {}, index = 0, context = {}) {
  const user = comment.user && typeof comment.user === 'object' ? comment.user : {};
  const userInfo = comment.user_info && typeof comment.user_info === 'object' ? comment.user_info : {};
  const replyToUserInfo = comment.reply_to_user_info && typeof comment.reply_to_user_info === 'object' ? comment.reply_to_user_info : {};
  const createTime = firstNonEmpty(comment.create_time, comment.createTime, comment.timestamp, comment.time);
  const commentId = firstNonEmpty(comment.comment_id, comment.cid, comment.id);
  const rootCommentId = context.is_reply
    ? firstNonEmpty(context.root_comment_id, comment.root_comment_id, context.parent_comment_id, commentId)
    : firstNonEmpty(comment.root_comment_id, commentId);
  return {
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    rank: index + 1,
    comment_id: commentId,
    item_id: firstNonEmpty(context.item_id, comment.item_id, comment.aweme_id),
    author: firstNonEmpty(
      user.nickname,
      user.name,
      user.screen_name,
      userInfo.nickname,
      userInfo.name,
      userInfo.screen_name,
      userInfo.user_name,
      comment.user_name,
      comment.author,
    ),
    author_uid: firstNonEmpty(
      user.uid,
      user.user_id,
      userInfo.uid,
      userInfo.user_id,
      comment.user_id,
      comment.uid,
    ),
    author_sec_uid: firstNonEmpty(
      user.sec_uid,
      user.secUid,
      userInfo.sec_uid,
      userInfo.secUid,
      comment.sec_uid,
      comment.secUid,
    ),
    avatar_url: firstNonEmpty(
      firstArrayValue(
        user.avatar_thumb?.url_list,
        user.avatar_medium?.url_list,
        user.avatar_larger?.url_list,
        userInfo.avatar_thumb?.url_list,
        userInfo.avatar_medium?.url_list,
        userInfo.avatar_larger?.url_list,
      ),
      user.avatar_url,
      userInfo.avatar_url,
    ),
    text: firstNonEmpty(comment.text, comment.comment_text, comment.content),
    time: formatDouyinTimestamp(createTime),
    create_time: String(createTime),
    ip_location: firstNonEmpty(comment.ip_label, comment.ip_location, comment.ipLocation),
    digg_count: firstNumber(comment.digg_count, comment.diggCount, comment.like_count),
    reply_count: firstNumber(comment.reply_count, comment.reply_comment_total, comment.replyCount),
    reply_to: firstNonEmpty(
      context.reply_to,
      comment.reply_to_user_name,
      replyToUserInfo.nickname,
      replyToUserInfo.name,
      replyToUserInfo.screen_name,
      replyToUserInfo.user_name,
    ),
    reply_to_comment_id: firstNonEmpty(context.reply_to_comment_id, comment.reply_to_comment_id, comment.reply_id),
    parent_comment_id: firstNonEmpty(context.parent_comment_id),
    root_comment_id: rootCommentId,
    is_reply: Boolean(context.is_reply),
    fetched_reply_count: 0,
    reply_fetch_status: context.is_reply ? '' : 'not_requested',
    reply_fetch_error: '',
    has_more: Boolean(context.has_more),
    next_cursor: String(context.next_cursor ?? ''),
    source_url_path: String(context.source_url_path || ''),
  };
}

function normalizeCreatorCommentListResponse(data = {}, options = {}) {
  const comments = Array.isArray(data.comment_info_list)
    ? data.comment_info_list
    : Array.isArray(data.comments)
      ? data.comments
      : [];
  const limit = normalizeDouyinCommentLimit(options.limit ?? comments.length, 20);
  const context = {
    item_id: options.item_id,
    has_more: Boolean(data.has_more),
    next_cursor: data.cursor ?? data.next_cursor ?? data.offset ?? '',
    source_url_path: options.source_url_path || '',
    is_reply: Boolean(options.is_reply),
    parent_comment_id: options.parent_comment_id || '',
    root_comment_id: options.root_comment_id || '',
    reply_to_comment_id: options.reply_to_comment_id || '',
    reply_to: options.reply_to || '',
  };
  return comments
    .map((comment, index) => normalizeCreatorCommentRow(comment, index, context))
    .filter((row) => row.comment_id)
    .slice(0, limit);
}

function buildCreatorCommentRequest(path, params) {
  return { path, params };
}

async function fetchCreatorCommentPage(page, request) {
  const result = await page.evaluate(`
    (async () => {
      const request = ${JSON.stringify(request)};
      const preserveLargeIds = ${preserveCreatorJsonLargeIdValues.toString()};
      const safeJson = async (response) => {
        const text = await response.text();
        try { return JSON.parse(preserveLargeIds(text)); } catch {}
        try { return JSON.parse(text); } catch { return null; }
      };
      const parsed = new URL(request.path, window.location.origin);
      for (const [key, value] of Object.entries(request.params || {})) {
        if (value === null || value === undefined || value === '') continue;
        parsed.searchParams.set(key, String(value));
      }
      const response = await fetch(parsed.toString(), { credentials: 'include' });
      const data = await safeJson(response);
      return {
        ok: response.ok,
        status: response.status,
        source_url_path: parsed.origin + parsed.pathname,
        data,
      };
    })()
  `);
  if (!result?.ok || !result?.data) {
    throw new Error(`douyin creator comment request failed: ${result?.status || 'unknown'}`);
  }
  return result;
}

function normalizeCreatorCommentTargetRow(item = {}, index = 0, context = {}) {
  return {
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    rank: index + 1,
    item_id: firstNonEmpty(item.item_id, item.id),
    aweme_id: firstNonEmpty(item.item_id_plain, item.aweme_id, item.item_id, item.id),
    title: firstNonEmpty(item.title, item.item_title, item.desc),
    create_time: firstNonEmpty(item.create_time),
    publish_time: formatDouyinTimestamp(item.create_time),
    comment_count: firstNumber(item.comment_count),
    creator_comment_target_has_more: Boolean(context.has_more),
    creator_comment_target_next_cursor: String(context.next_cursor ?? ''),
  };
}

function selectCreatorCommentItem(data = {}) {
  const items = Array.isArray(data.item_info_list) ? data.item_info_list : [];
  return items.find((item) => Number(item?.comment_count) > 0) || items[0] || null;
}

function parseJsonMap(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function fetchDouyinCreatorCommentTargets(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_COMMENT_MANAGE_URL);
  const limit = normalizeDouyinVideoLimit(kwargs.limit ?? 20, 20);
  const cursor = String(kwargs.cursor ?? '0');
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator comment targets.');
  }

  const result = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
    '/aweme/v1/creator/item/list',
    { cursor, count: limit },
  ));
  const items = Array.isArray(result.data?.item_info_list) ? result.data.item_info_list : [];
  const hasMore = result.data?.has_more === true || Number(result.data?.has_more ?? result.data?.hasMore ?? 0) > 0;
  const nextCursor = result.data?.cursor ?? result.data?.next_cursor ?? result.data?.max_cursor ?? '';
  return items
    .map((item, index) => normalizeCreatorCommentTargetRow(item, index, {
      has_more: hasMore,
      next_cursor: hasMore ? nextCursor : '',
    }))
    .filter((row) => row.item_id || row.aweme_id)
    .slice(0, limit);
}

async function resolveCreatorCommentTarget(page, itemId, awemeId) {
  if (itemId !== 'auto') {
    return {
      item_id: itemId,
      aweme_id: firstNonEmpty(awemeId, itemId),
    };
  }

  const result = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
    '/aweme/v1/creator/item/list',
    { cursor: '', count: 20 },
  ));
  const item = selectCreatorCommentItem(result.data);
  const resolvedItemId = firstNonEmpty(item?.item_id, item?.id);
  if (!resolvedItemId) {
    throw new Error('douyin creator comment item list is empty');
  }
  return {
    item_id: resolvedItemId,
    aweme_id: firstNonEmpty(awemeId, item?.item_id_plain, item?.aweme_id, resolvedItemId),
  };
}

export async function fetchDouyinCreatorCommentRows(page, kwargs = {}) {
  const itemId = String(kwargs.item_id ?? '').trim();
  if (!itemId) {
    throw new Error('item_id is required');
  }
  const awemeId = String(kwargs.aweme_id ?? '').trim();

  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_COMMENT_MANAGE_URL);
  const limit = normalizeDouyinCommentLimit(kwargs.limit ?? 20, 20);
  const pages = normalizeDouyinPageLimit(kwargs.pages ?? 1, 1);
  const replyLimit = normalizeDouyinCommentLimit(kwargs.reply_limit ?? kwargs.limit ?? 20, 20);
  const replyPages = normalizeDouyinPageLimit(kwargs.reply_pages ?? 1, 1);
  const sort = String(kwargs.sort ?? '');
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));
  const withReplies = kwargs.with_replies === true || String(kwargs.with_replies ?? '').toLowerCase() === 'true';
  const replyCursorMap = parseJsonMap(kwargs.reply_cursor_map);
  const onProgress = typeof kwargs.onProgress === 'function' ? kwargs.onProgress : () => {};

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator comments.');
  }

  const target = await resolveCreatorCommentTarget(page, itemId, awemeId);
  const rows = [];
  let cursor = String(kwargs.cursor ?? '0');
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    let result = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
      '/aweme/v1/creator/comment/list',
      { item_id: target.item_id, cursor, count: limit, sort },
    ));
    const pageRows = normalizeCreatorCommentListResponse(result.data, {
      item_id: target.item_id,
      limit,
      source_url_path: result.source_url_path,
    });
    if (pageRows.length === 0) {
      result = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
        '/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/',
        {
          aweme_id: target.aweme_id,
          cursor,
          count: limit,
          sort_options: firstNonEmpty(sort, 0),
          comment_select_options: '0',
          channel_id: 618,
        },
      ));
      pageRows.push(...normalizeCreatorCommentListResponse(result.data, {
        item_id: target.item_id,
        limit,
        source_url_path: result.source_url_path,
      }));
    }
    rows.push(...pageRows);
    onProgress({
      step: 'comment-page',
      message: `评论第 ${pageIndex + 1} 页返回 ${pageRows.length} 条，当前作品累计一级评论 ${rows.filter((row) => !row.is_reply).length} 条`,
      pageNumber: pageIndex + 1,
      receivedCount: pageRows.length,
      accumulatedTopLevel: rows.filter((row) => !row.is_reply).length,
    });

    if (withReplies) {
      for (const comment of pageRows) {
        comment.reply_fetch_status = Number(comment.reply_count || 0) > 0 ? 'failed' : 'no_replies';
        comment.reply_fetch_error = Number(comment.reply_count || 0) > 0 ? 'expanded_reply_request_failed' : '';
        if (Number(comment.reply_count || 0) <= 0) continue;
        let replyCursor = String(replyCursorMap[comment.comment_id] ?? replyCursorMap[comment.root_comment_id] ?? '0');
        for (let replyPageIndex = 0; replyPageIndex < replyPages; replyPageIndex += 1) {
          try {
            const replyRequest = comment.source_url_path.includes('/web/api/third_party/')
              ? buildCreatorCommentRequest(
                '/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/reply/',
                { comment_id: comment.comment_id, item_id: target.aweme_id, cursor: replyCursor, count: replyLimit },
              )
              : buildCreatorCommentRequest(
                '/aweme/v1/creator/comment/reply/list',
                { comment_id: comment.comment_id, cursor: replyCursor, count: replyLimit, sort },
              );
            const replyResult = await fetchCreatorCommentPage(page, replyRequest);
            const replyRows = normalizeCreatorCommentListResponse(replyResult.data, {
              item_id: target.item_id,
              limit: replyLimit,
              source_url_path: replyResult.source_url_path,
              is_reply: true,
              parent_comment_id: comment.comment_id,
              root_comment_id: comment.root_comment_id || comment.comment_id,
              reply_to_comment_id: comment.comment_id,
              reply_to: comment.author,
            });
            rows.push(...replyRows);
            comment.fetched_reply_count += replyRows.length;
            onProgress({
              step: 'reply-page',
              message: `评论回复第 ${replyPageIndex + 1} 页返回 ${replyRows.length} 条，当前作品累计回复 ${rows.filter((row) => row.is_reply).length} 条`,
              pageNumber: replyPageIndex + 1,
              receivedCount: replyRows.length,
              accumulatedReplies: rows.filter((row) => row.is_reply).length,
            });
            comment.reply_fetch_error = '';
            comment.reply_fetch_status = comment.fetched_reply_count >= Number(comment.reply_count || 0)
              ? 'complete'
              : 'partial';
            replyCursor = String(replyResult.data?.cursor ?? replyResult.data?.next_cursor ?? '');
            if (!replyResult.data?.has_more || !replyCursor) break;
          } catch {
            comment.reply_fetch_status = comment.fetched_reply_count ? 'partial' : comment.reply_fetch_status;
            comment.reply_fetch_error = 'expanded_reply_request_failed';
            break;
          }
        }
      }
    }

    cursor = String(result.data?.cursor ?? result.data?.next_cursor ?? '');
    if (!result.data?.has_more || !cursor) break;
  }

  return rows;
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-comments',
    description: douyinCreatorCommentsSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_COMMENT_MANAGE_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinCreatorCommentsSpec.args,
    columns: douyinCreatorCommentsSpec.columns,
    func: async (page, kwargs) => fetchDouyinCreatorCommentRows(page, kwargs),
  });
}
