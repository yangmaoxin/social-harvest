import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

export const FINDER_HELPER_BASE = '/cgi-bin/mmfinderassistant-bin';
export const FINDER_INTERACTION_HELPER_BASE = '/micro/interaction/cgi-bin/mmfinderassistant-bin';
export const FINDER_CONTENT_HELPER_BASE = '/micro/content/cgi-bin/mmfinderassistant-bin';
export const FINDER_ORIGIN = 'https://channels.weixin.qq.com';
export const POST_LIST_URL = 'https://channels.weixin.qq.com/platform/post/list?';
export const IMAGE_TEXT_LIST_URL = 'https://channels.weixin.qq.com/platform/post/finderNewLifePostList';
export const COMMENT_URL = 'https://channels.weixin.qq.com/platform/interaction/comment';
export const BULLET_CHAT_URL = 'https://channels.weixin.qq.com/platform/interaction/bulletChat';
export const PRIVATE_MSG_URL = 'https://channels.weixin.qq.com/platform/private_msg';
export const PROGRESS_PREFIX = 'OPENCLI_PROGRESS ';
export const IMAGE_TEXT_LIST_API_PATHS = [
  `${FINDER_ORIGIN}${FINDER_CONTENT_HELPER_BASE}/post/post_list`,
  '/post/finder_new_life_post_list',
  '/post/new_life_post_list',
  '/post/newlife_post_list',
  '/post/finderNewLifePostList',
];
export const PRIVATE_MESSAGE_TAB_LABELS = {
  private: '私信',
  greeting: '打招呼消息',
};

export function parsePositiveInt(raw, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function collectWorkIds(value, ids = new Set()) {
  if (!value) return ids;
  if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const text = cleanText(part);
      if (text) ids.add(text);
    }
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkIds(item, ids);
    return ids;
  }
  if (typeof value === 'object') {
    for (const key of ['object_id', 'objectId', 'work_no', 'workNo', 'video_no', 'videoNo', 'export_id', 'exportId', 'id']) {
      if (value[key]) collectWorkIds(value[key], ids);
    }
    for (const key of ['work_ids', 'workIds', 'danmaku_work_ids', 'danmakuWorkIds', 'works', 'changed_works', 'changedWorks']) {
      if (value[key]) collectWorkIds(value[key], ids);
    }
  }
  return ids;
}

function loadWorkIdFilterFromArgs(kwargs = {}) {
  const ids = collectWorkIds(kwargs['work-ids'] ?? kwargs.workIds);
  const filePath = cleanText(kwargs['work-ids-file'] ?? kwargs.workIdsFile);
  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new CliError('WORK_IDS_FILE_NOT_FOUND', `work ids file not found: ${resolved}`);
    collectWorkIds(JSON.parse(fs.readFileSync(resolved, 'utf8')), ids);
  }
  return ids.size ? ids : null;
}

function matchingWorkIds(video = {}, filter = null) {
  if (!filter) return [];
  return ['work_no', 'video_no', 'export_id', 'object_id']
    .map((key) => cleanText(video[key]))
    .filter((value, index, values) => value && values.indexOf(value) === index && filter.has(value));
}

function shouldEmitProgress() {
  return /^(1|true|jsonl)$/i.test(String(process.env.OPENCLI_PROGRESS_EVENTS || ''));
}

function shouldDebugBulletChats() {
  return /^(1|true)$/i.test(String(process.env.OPENCLI_DEBUG_BULLET_CHAT || ''));
}

function formatProgressMessage(event) {
  switch (event.type) {
    case 'navigate':
      return `进入页面: ${event.page}`;
    case 'api-request':
      return `请求接口: ${event.path}`;
    case 'api-response':
      return `接口返回: ${event.path} status=${event.status} ok=${event.ok}`;
    case 'post-page':
      return `作品流第 ${event.currentPage} 页返回 ${event.receivedCount} 条`;
    case 'post-list-complete':
      return `作品流抓取完成，共 ${event.totalPosts} 条`;
    case 'image-text-page':
      return `图文列表第 ${event.currentPage} 页返回 ${event.receivedCount} 条`;
    case 'image-text-list-complete':
      return `图文列表抓取完成，共 ${event.totalImageTexts} 条`;
    case 'comment-detail':
      return `解析作品详情: ${event.exportId}`;
    case 'comment-page':
      return `评论分页第 ${event.pageNumber} 页返回 ${event.receivedCount} 条`;
    case 'comment-item':
      return `抓到一级评论 ${event.commentId || ''}`.trim();
    case 'reply-page':
      return `回复分页第 ${event.pageNumber} 页返回 ${event.receivedCount} 条`;
    case 'reply-progress':
      return `评论 ${event.commentId || ''} 已抓 ${event.accumulatedReplies} 条回复`;
    case 'comments-complete':
      return `作品 ${event.exportId} 评论抓取完成，共 ${event.totalTopLevel} 条一级评论`;
    case 'private-message-tab':
      return `切换私信标签: ${event.tabLabel}`;
    case 'private-message-thread':
      return `抓到${event.tabLabel}会话 ${event.nickname || event.threadId || ''}`.trim();
    case 'private-messages-complete':
      return `私信抓取完成，共 ${event.totalThreads} 个会话`;
    case 'danmaku-video':
      return `抓到弹幕视频 ${event.title || event.videoNo || ''}，共 ${event.bulletCount || 0} 条弹幕`.trim();
    case 'danmaku-complete':
      return `弹幕抓取完成，共 ${event.totalVideos || 0} 个视频、${event.totalRows || 0} 条弹幕`;
    default:
      return '';
  }
}

export function emitProgress(event, callback) {
  const enriched = {
    adapter: 'weixin-channels',
    ts: new Date().toISOString(),
    ...event,
  };
  if (typeof callback === 'function') callback(enriched);
  if (!shouldEmitProgress()) return enriched;
  const record = {
    ...enriched,
    message: enriched.message || formatProgressMessage(enriched),
  };
  process.stderr.write(`${PROGRESS_PREFIX}${JSON.stringify(record)}\n`);
  return record;
}

function formatDateInBeijing(date) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export function formatTimestamp(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return formatDateInBeijing(value);
  }
  if (typeof value === 'string') {
    const text = cleanText(value);
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return text;
    const raw = Number(text);
    if (!Number.isFinite(raw) || raw <= 0) {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return text;
      return formatDateInBeijing(parsed);
    }
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    return formatDateInBeijing(d);
  }
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return '';
  const ms = raw > 1e12 ? raw : raw * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateInBeijing(d);
}

export function pickFirst(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? cleanText(value) : value;
    if (text !== '' && text !== null && text !== undefined) return text;
  }
  return '';
}

function buildStableSyntheticId(prefix, parts = []) {
  const seed = parts
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join('\u241f');
  const digest = createHash('sha1').update(seed || prefix).digest('hex').slice(0, 24);
  return `${prefix}${digest}`;
}

export function parseVideoTimestampText(value) {
  const text = cleanText(value);
  if (!text) return 0;
  const parts = text.split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return ((minutes * 60) + seconds) * 1000;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
  }
  return 0;
}

function normalizeBulletVideoNo(video = {}) {
  return pickFirst(
    video.object_id,
    video.export_id,
    video.video_no,
    video.work_no,
    buildStableSyntheticId('wxvcv_', [
      video.title,
      video.publish_time,
      video.cover_url,
    ]),
  );
}

export function buildBulletCommentId(videoNo, row = {}) {
  return buildStableSyntheticId('wxvcb_', [
    videoNo,
    row.content,
    row.video_timestamp_text,
    row.comment_user_name,
    row.created_at,
  ]);
}

function normalizeComparableMinute(value) {
  const text = cleanText(value).replace(/\//g, '-').replace('T', ' ');
  if (!text) return '';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return text.slice(0, 16);
}

function buildBulletRowSignature(row = {}) {
  return [
    cleanText(row.content),
    cleanText(row.video_timestamp_text || row.videoTimestampText),
    cleanText(row.comment_user_name || row.commentUserName),
    normalizeComparableMinute(row.created_at || row.createdAt),
  ].join('\u241f');
}

function collectBulletChatRowCandidates(value, rows = [], seen = new Set(), depth = 0) {
  if (!value || depth > 6) return rows;
  if (typeof value !== 'object') return rows;
  if (seen.has(value)) return rows;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectBulletChatRowCandidates(item, rows, seen, depth + 1);
    return rows;
  }

  const videoTimestampText = cleanText(pickFirst(
    value.video_timestamp_text,
    value.videoTimestampText,
    value.playTimeText,
    value.timeText,
    value.offsetText,
    value.positionText,
  ));
  const rawTimestampMs = pickFirst(
    value.video_timestamp_ms,
    value.videoTimestampMs,
    value.playTimeMs,
    value.playTime,
    value.offsetMs,
    value.offset,
    value.positionMs,
  );
  const videoTimestampMs = videoTimestampText
    ? parseVideoTimestampText(videoTimestampText)
    : (Number.isFinite(Number(rawTimestampMs)) ? Number(rawTimestampMs) : 0);
  const normalizedTimestampText = videoTimestampText
    || (videoTimestampMs > 0
      ? [
        Math.floor(videoTimestampMs / 60000),
        Math.floor((videoTimestampMs % 60000) / 1000),
      ].map((part) => String(part).padStart(2, '0')).join(':')
      : '');
  const row = {
    bullet_comment_id: cleanText(pickFirst(value.bullet_comment_id, value.bulletCommentId, value.commentId, value.id)),
    content: cleanText(pickFirst(value.content, value.text, value.commentContent, value.bulletCommentContent)),
    comment_user_name: cleanText(pickFirst(
      value.comment_user_name,
      value.commentUserName,
      value.userInfo?.nickname,
      value.userInfo?.nickName,
      value.nickname,
      value.nickName,
      value.author,
      value.userName,
    )),
    comment_user_photo: cleanText(pickFirst(
      value.comment_user_photo,
      value.commentUserPhoto,
      value.userInfo?.headImgUrl,
      value.userInfo?.avatarUrl,
      value.userInfo?.avatar,
      value.headImgUrl,
      value.avatarUrl,
      value.avatar,
      value.headUrl,
      value.userAvatarUrl,
    )),
    video_timestamp_text: normalizedTimestampText,
    video_timestamp_ms: videoTimestampMs,
    created_at: formatTimestamp(pickFirst(
      value.created_at,
      value.createdAt,
      value.time,
      value.createTime,
      value.create_time,
      value.commentCreatetime,
      value.commentCreateTime,
    )) || cleanText(pickFirst(value.created_at, value.createdAt, value.time)),
  };
  if (row.content && (row.comment_user_name || row.comment_user_photo || row.video_timestamp_text || row.created_at)) {
    rows.push(row);
  }

  for (const entry of Object.values(value)) {
    collectBulletChatRowCandidates(entry, rows, seen, depth + 1);
  }
  return rows;
}

export function normalizePostItem(item = {}, index = 0) {
  const media = Array.isArray(item?.desc?.media) ? item.desc.media[0] ?? {} : {};
  const stats = item?.stat || item?.stats || item?.data || {};
  const publishTimestamp = pickFirst(
    item.createTime,
    item.create_time,
    item.publishTime,
    item.publish_time,
    item.objectCreateTime,
  );
  return {
    rank: index + 1,
    object_id: pickFirst(item.objectId, item.finderObjectId, item.exportId, item.id),
    object_nonce: pickFirst(item.objectNonce, item.nonceId, media.objectNonce),
    title: pickFirst(
      item?.desc?.description,
      item?.objectDesc?.description,
      item.description,
      item.title,
      item?.feedTitle,
    ),
    media_type: pickFirst(item?.desc?.mediaType, item.mediaType, media.mediaType),
    cover_url: pickFirst(
      media.coverUrl,
      media.thumbUrl,
      item.coverUrl,
      item.thumbUrl,
      item.coverImgUrl,
      '',
    ),
    duration: pickFirst(media.videoPlayLen, media.duration, item.duration, ''),
    publish_timestamp: publishTimestamp === '' ? '' : String(publishTimestamp),
    publish_time: formatTimestamp(publishTimestamp),
    view_count: pickFirst(
      item.readCount,
      item.readNum,
      item.browseCount,
      item.playCount,
      stats.readCount,
      stats.browseCount,
      '',
    ),
    like_count: pickFirst(item.likeCount, item.likeNum, stats.likeCount, ''),
    fav_count: pickFirst(
      item.favCount,
      item.fav_count,
      item.favoriteCount,
      item.favorite_count,
      item.collectCount,
      item.collect_count,
      stats.favCount,
      stats.fav_count,
      stats.favoriteCount,
      stats.collectCount,
      '',
    ),
    share_count: pickFirst(
      item.forwardCount,
      item.forward_count,
      item.shareCount,
      item.share_count,
      stats.forwardCount,
      stats.forward_count,
      stats.shareCount,
      stats.share_count,
      '',
    ),
    comment_count: pickFirst(item.commentCount, item.comment_count, item.allCommentCount, stats.commentCount, ''),
    unread_comment_count: pickFirst(item.unreadcommentCount, item.unreadCommentCount, ''),
    visible: pickFirst(item.visibleType, item.visible, ''),
  };
}

export async function fetchObjectShortLink(page, work = {}, options = {}) {
  const exportId = pickFirst(work.object_id, work.objectId, work.export_id, work.exportId, work.work_no, work.no);
  const nonceId = pickFirst(work.object_nonce, work.objectNonce, work.nonce_id, work.nonceId);
  if (!exportId) {
    throw new CliError('MISSING_EXPORT_ID', 'Cannot generate Weixin Channels short link without object_id/exportId.');
  }
  if (!nonceId) {
    throw new CliError('MISSING_NONCE_ID', `Cannot generate Weixin Channels short link for ${exportId} without object_nonce/nonceId.`);
  }
  const scene = Number(options.scene || work.scene || work.link_scene || 0)
    || (Number(work.file_type) === 2 || work.content_type === 'image_text' ? 10 : 40);
  const data = await fetchFinderApi(page, '/post/get_object_short_link', {
    exportId,
    nonceId,
    scene,
  }, {
    stage: options.stage || 'short-link',
    exportId,
    onProgress: options.onProgress,
  });
  const shortUrl = pickFirst(data?.shortUrl, data?.short_url, data?.url);
  if (!shortUrl) {
    throw new CliError('SHORT_LINK_EMPTY', `Weixin Channels short link API returned no shortUrl for ${exportId}.`);
  }
  return {
    object_id: exportId,
    object_nonce: nonceId,
    scene,
    share_url: shortUrl,
    short_url: shortUrl,
  };
}

export async function fetchObjectShortLinks(page, works = [], options = {}) {
  await gotoFinderPage(page, POST_LIST_URL);
  const rows = [];
  for (const [index, work] of works.entries()) {
    const objectId = pickFirst(work.object_id, work.objectId, work.export_id, work.exportId, work.work_no, work.no);
    const objectNonce = pickFirst(work.object_nonce, work.objectNonce, work.nonce_id, work.nonceId);
    try {
      const link = await fetchObjectShortLink(page, work, options);
      rows.push({
        rank: index + 1,
        object_id: link.object_id,
        object_nonce: link.object_nonce,
        scene: link.scene,
        share_url: link.share_url,
        status: 'success',
        error: '',
      });
    } catch (error) {
      rows.push({
        rank: index + 1,
        object_id: objectId,
        object_nonce: objectNonce,
        scene: Number(options.scene || work.scene || 0) || 0,
        share_url: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

function extractUrlFromImageLike(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return pickFirst(
    value.url,
    value.urlList?.[0],
    value.url_list?.[0],
    value.coverUrl,
    value.cover_url,
    value.thumbUrl,
    value.thumb_url,
    value.imageUrl,
    value.image_url,
    value.picUrl,
    value.pic_url,
    value.mediaUrl,
    value.media_url,
    '',
  );
}

export function extractImageUrls(item = {}) {
  const candidates = [
    item.images,
    item.imageList,
    item.image_list,
    item.picList,
    item.pic_list,
    item.pictureList,
    item.picture_list,
    item.mediaList,
    item.media_list,
    item?.desc?.media,
    item?.objectDesc?.media,
  ];
  const urls = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      const url = extractUrlFromImageLike(entry);
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

export function normalizeImageTextPostItem(item = {}, index = 0) {
  const base = normalizePostItem(item, index);
  const imageUrls = extractImageUrls(item);
  const mediaType = pickFirst(base.media_type, item.mediaType, item?.desc?.mediaType, '');
  const duration = pickFirst(base.duration, item.duration, '');
  const isVideoLike = Number(mediaType) === 4 || Number(duration) > 0;
  const publishTimestamp = pickFirst(
    item.createTime,
    item.create_time,
    item.publishTime,
    item.publish_time,
    item.objectCreateTime,
  );
  return {
    ...base,
    object_id: pickFirst(base.object_id, item.exportId, item.objectId, item.finderObjectId, item.feedId, item.id),
    title: pickFirst(
      base.title,
      item.content,
      item.text,
      item?.note?.content,
      item?.note?.title,
    ),
    file_type: isVideoLike ? 1 : 2,
    image_count: isVideoLike ? 0 : imageUrls.length,
    image_urls: isVideoLike ? [] : imageUrls,
    media_type: mediaType,
    cover_url: pickFirst(base.cover_url, imageUrls[0], item.coverUrl, item.thumbUrl, ''),
    duration: isVideoLike ? duration : '',
    publish_timestamp: publishTimestamp === '' ? base.publish_timestamp : String(publishTimestamp),
    publish_time: formatTimestamp(publishTimestamp) || base.publish_time,
  };
}

function normalizeBulletChatVideo(video = {}, index = 0) {
  const objectId = pickFirst(video.object_id, video.export_id);
  const videoNo = normalizeBulletVideoNo(video);
  const workNo = pickFirst(video.work_no, objectId, video.export_id, videoNo);
  const exportId = pickFirst(video.export_id, objectId, videoNo);
  const normalizedObjectId = pickFirst(objectId, exportId, videoNo);
  const rows = Array.isArray(video.rows) ? video.rows : [];
  const normalizedRows = rows
    .map((row, rowIndex) => {
      const content = cleanText(row.content);
      const videoTimestampText = cleanText(row.video_timestamp_text || row.videoTimestampText);
      const commentUserName = cleanText(row.comment_user_name || row.commentUserName);
      const createdAt = cleanText(row.created_at || row.createdAt);
      if (!content || !videoTimestampText || !createdAt) return null;
      const normalized = {
        bullet_rank: rowIndex + 1,
        content,
        comment_user_name: commentUserName,
        comment_user_photo: cleanText(row.comment_user_photo || row.commentUserPhoto),
        video_timestamp_text: videoTimestampText,
        video_timestamp_ms: parseVideoTimestampText(videoTimestampText),
        created_at: createdAt,
      };
      return {
        ...normalized,
        bullet_comment_id: cleanText(row.bullet_comment_id || row.bulletCommentId) || buildBulletCommentId(workNo, normalized),
      };
    })
    .filter(Boolean);

  return {
    video_rank: index + 1,
    video_no: pickFirst(video.video_no, workNo, videoNo),
    work_no: workNo,
    export_id: exportId,
    object_id: normalizedObjectId,
    video_title: cleanText(video.title),
    video_cover_url: cleanText(video.cover_url || video.coverUrl),
    video_publish_time: cleanText(video.publish_time || video.publishTime),
    video_bullet_comment_count: Number(video.bullet_comment_count ?? video.bulletCommentCount ?? normalizedRows.length) || normalizedRows.length,
    rows: normalizedRows,
  };
}

export function extractPostList(payload = {}) {
  const candidates = [
    payload?.list,
    payload?.objectList,
    payload?.object_list,
    payload?.postList,
    payload?.post_list,
    payload?.feedList,
    payload?.feed_list,
    payload?.newLifePostList,
    payload?.new_life_post_list,
    payload?.finderNewLifePostList,
    payload?.finder_new_life_post_list,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

export function normalizeCommentItem(item = {}, exportId = '', parent = null, index = 0) {
  const commentTimestamp = pickFirst(
    item.commentCreatetime,
    item.commentCreateTime,
    item.comment_create_time,
    item.createTime,
    item.create_time,
    item.commentTime,
    item.comment_time,
    item.timestamp,
  );
  return {
    rank: index + 1,
    comment_id: pickFirst(item.commentId, item.id),
    export_id: exportId,
    parent_comment_id: parent ? pickFirst(parent.commentId, parent.id) : '',
    root_comment_id: pickFirst(item.rootCommentId, parent ? pickFirst(parent.commentId, parent.id) : '', ''),
    author: pickFirst(item.commentNickname, item.nickname, item.author, item.username),
    avatar_url: pickFirst(
      item.commentHeadurl,
      item.commentHeadUrl,
      item.headUrl,
      item.headurl,
      item.avatar,
      item.avatarUrl,
      '',
    ),
    reply_to: pickFirst(item.replyNickname, item.replyToNickname, parent ? pickFirst(parent.commentNickname, parent.nickname) : ''),
    text: pickFirst(item.content, item.commentContent, item.text, item.comment),
    like_count: pickFirst(item.commentLikeCount, item.likeCount, item.like_count, 0),
    reply_count: pickFirst(item.replyCount, item.reply_count, item.subCommentCount, 0),
    reply_comment_id: pickFirst(item.replyCommentId, ''),
    is_reply: Boolean(parent || (item.replyCommentId && item.replyCommentId !== '0')),
    visible_flag: pickFirst(item.visibleFlag, ''),
    comment_timestamp: commentTimestamp === '' ? '' : String(commentTimestamp),
    time: formatTimestamp(commentTimestamp),
  };
}

function isExplicitSelfComment(item = {}, selfUsername = '') {
  const explicitSelfFlag = pickFirst(
    item.isSelf,
    item.fromSelf,
    item.selfFlag,
    item.is_self,
    item.from_self,
    null,
  );
  if (explicitSelfFlag === true || explicitSelfFlag === 1 || explicitSelfFlag === '1' || explicitSelfFlag === 'true') {
    return true;
  }

  if (!selfUsername) return false;
  const commentUsername = cleanText(pickFirst(
    item.commentUsername,
    item.commentUserName,
    item.username,
    item.userName,
    item.finderUsername,
    item.finderUserName,
    '',
  ));
  return Boolean(commentUsername) && commentUsername === selfUsername;
}

export function normalizePrivateMessageItem(item = {}, thread = null, index = 0) {
  const messageTimestamp = pickFirst(
    item.ts,
    item.messageTimestamp,
    item.timestamp,
    item.createTime,
    item.create_time,
    item.time,
    item.displayTime,
  );
  const textContent = pickFirst(
    item?.textMsg?.content,
    item.text,
    item.content,
    item.rawContent,
    item.previewText,
    '',
  );
  const normalizedDirection = String(
    pickFirst(item.direction, item.senderRole, item.fromSelf ? 'outbound' : item.isSelf ? 'outbound' : 'inbound'),
  ).toLowerCase();
  const direction = /^(outbound|send|sent|self|mine)$/.test(normalizedDirection) ? 'outbound' : 'inbound';

  return {
    rank: index + 1,
    message_id: pickFirst(item.messageId, item.id, item.clientMsgId, item.svrMsgId, ''),
    thread_id: pickFirst(item.threadId, thread?.thread_id, ''),
    tab: pickFirst(item.tab, thread?.tab, ''),
    sender_name: pickFirst(item.senderName, item.sender, item.author, direction === 'outbound' ? '我' : thread?.nickname),
    direction,
    text: textContent,
    message_type: pickFirst(item.messageType, item.type, item.kind, item.msgType, item.bizType, 'text'),
    timestamp: messageTimestamp === '' ? '' : String(messageTimestamp),
    time: formatTimestamp(messageTimestamp),
  };
}

export function normalizePrivateMessageThread(item = {}, tab = 'private', index = 0) {
  const latestTimestamp = pickFirst(
    item.latestTimestamp,
    item.timestamp,
    item.latestTime,
    item.time,
    item.displayTime,
  );
  const messages = Array.isArray(item.messages) ? item.messages : [];
  const normalized = {
    rank: index + 1,
    thread_id: pickFirst(item.threadId, item.sessionId, item.id, item.conversationId, item.nickname || `thread-${index + 1}`),
    tab,
    tab_label: PRIVATE_MESSAGE_TAB_LABELS[tab] || tab,
    nickname: pickFirst(item.nickname, item.name, item.title, ''),
    avatar_url: pickFirst(item.avatarUrl, item.avatar, item.headImgUrl, item.headUrl, ''),
    preview_text: pickFirst(item.previewText, item.preview, item.lastMessageText, item.rejectMsg, ''),
    latest_timestamp: latestTimestamp === '' ? '' : String(latestTimestamp),
    latest_time: formatTimestamp(latestTimestamp) || pickFirst(item.displayTime, item.timeText, ''),
    unread_count: pickFirst(item.unreadCount, item.unread, ''),
    messages: [],
  };

  normalized.messages = messages.map((message, messageIndex) => (
    normalizePrivateMessageItem({
      ...message,
      threadId: normalized.thread_id,
      tab,
    }, normalized, messageIndex)
  ));
  normalized.message_count = normalized.messages.length;
  return normalized;
}

function normalizePrivateMessageTab(raw = 'both') {
  const value = cleanText(raw).toLowerCase();
  if (['private', 'dm', 'message', 'messages', '私信'].includes(value)) return 'private';
  if (['greeting', 'greet', 'hello', '打招呼', '打招呼消息'].includes(value)) return 'greeting';
  return 'both';
}

function resolvePrivateMessageTabs(raw = 'both') {
  const normalized = normalizePrivateMessageTab(raw);
  if (normalized === 'private') return ['private'];
  if (normalized === 'greeting') return ['greeting'];
  return ['private', 'greeting'];
}

function tabFromPrivateMessageSessionType(sessionType) {
  const value = Number(sessionType || 0);
  if (value === 2) return 'greeting';
  if (value > 0) return 'private';
  return 'unknown';
}

function chunkArray(values = [], size = 30) {
  const list = Array.isArray(values) ? values : [];
  const chunkSize = Math.max(1, Number(size) || 30);
  const chunks = [];
  for (let index = 0; index < list.length; index += chunkSize) {
    chunks.push(list.slice(index, index + chunkSize));
  }
  return chunks;
}

function sortPrivateMessages(messages = []) {
  return [...messages].sort((left, right) => {
    const leftSeq = Number(left?.seq || 0);
    const rightSeq = Number(right?.seq || 0);
    if (!leftSeq && rightSeq) return 1;
    if (leftSeq && !rightSeq) return -1;
    if (leftSeq || rightSeq) return leftSeq - rightSeq;
    return Number(left?.ts || 0) - Number(right?.ts || 0);
  });
}

function inferPrivateMessageDirection(message = {}, { peerUsername = '', selfUsername = '' } = {}) {
  const normalizedDirection = cleanText(pickFirst(
    message.direction,
    message.senderRole,
    message.fromSelf ? 'outbound' : '',
    message.isSelf ? 'outbound' : '',
    message.sendMsgFlag ? 'outbound' : '',
  )).toLowerCase();
  if (/^(outbound|send|sent|self|mine)$/.test(normalizedDirection)) return 'outbound';
  if (/^(inbound|recv|receive|received|peer|other)$/.test(normalizedDirection)) return 'inbound';

  const fromUsername = cleanText(pickFirst(message.fromUsername, message.fromUserName, ''));
  const toUsername = cleanText(pickFirst(message.toUsername, message.toUserName, ''));
  if (selfUsername) {
    if (fromUsername && fromUsername === selfUsername) return 'outbound';
    if (toUsername && toUsername === selfUsername) return 'inbound';
  }
  if (peerUsername) {
    if (fromUsername && fromUsername === peerUsername) return 'inbound';
    if (toUsername && toUsername === peerUsername) return 'outbound';
    if (fromUsername && fromUsername !== peerUsername) return 'outbound';
  }

  const fromUserType = Number(pickFirst(message.fromUserType, message.userType, 0));
  if (fromUserType === 2) return 'outbound';
  if (fromUserType === 1) return 'inbound';

  return 'inbound';
}

export async function scrapePrivateMessageThreadsFromDom(page, options = {}) {
  const tab = normalizePrivateMessageTab(options.tab);
  const tabLabel = PRIVATE_MESSAGE_TAB_LABELS[tab] || tab;
  const limit = options.limit === Infinity ? Number.MAX_SAFE_INTEGER : parsePositiveInt(options.limit, 20, { min: 1, max: 5000 });
  const messageLimit = options.messageLimit === Infinity ? Number.MAX_SAFE_INTEGER : parsePositiveInt(options.messageLimit, 50, { min: 1, max: 5000 });

  emitProgress({
    type: 'private-message-tab',
    stage: 'private-message-list',
    tab,
    tabLabel,
  }, options.onProgress);

  const rawThreads = await page.evaluate(`
    (async () => {
      const limit = ${JSON.stringify(limit)};
      const messageLimit = ${JSON.stringify(messageLimit)};
      const includeMessages = ${JSON.stringify(Boolean(options.includeMessages))};
      const tab = ${JSON.stringify(tab)};
      const tabLabel = ${JSON.stringify(tabLabel)};
      const privateApiPattern = '/cgi-bin/mmfinderassistant-bin/private-msg/';

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const splitLines = (text) => String(text ?? '')
        .split(/\\n+/)
        .map((line) => normalize(line))
        .filter(Boolean);
      const matchTimeLike = (text) => /^(\\d{2}:\\d{2}|\\d{2}月\\d{2}日|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{2}月\\d{2}日 \\d{2}:\\d{2})$/.test(text);
      const getInteractionIframe = () => Array.from(document.querySelectorAll('iframe')).find((node) => {
        try {
          return String(node.contentWindow?.location?.href || '').includes('/micro/interaction/');
        } catch {
          return false;
        }
      }) || null;
      const iframe = getInteractionIframe();
      const interactionWindow = iframe?.contentWindow || window;
      const doc = interactionWindow.document || document;
      const isVisible = (node) => {
        if (!node || node.nodeType !== 1 || typeof node.getBoundingClientRect !== 'function') return false;
        const view = node.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const uniqueLines = (node) => Array.from(new Set(splitLines(node?.innerText || node?.textContent || '')));
      const installPrivateCapture = (targetWindow) => {
        if (!targetWindow) return;
        const arrName = '__opencli_private_msg_capture';
        const errName = '__opencli_private_msg_capture_errors';
        const parseJson = (text) => {
          if (typeof text !== 'string' || !text.trim()) return null;
          try { return JSON.parse(text); } catch { return null; }
        };
        const shouldCapture = (url) => typeof url === 'string' && url.includes(privateApiPattern);
        if (!targetWindow[arrName]) targetWindow[arrName] = [];
        if (!targetWindow[errName]) targetWindow[errName] = [];
        const pushEntry = (entry) => {
          targetWindow[arrName].push({
            url: String(entry.url || ''),
            method: String(entry.method || 'GET').toUpperCase(),
            requestBody: entry.requestBody ?? null,
            responseBody: entry.responseBody ?? null,
            responsePreview: entry.responsePreview ?? '',
            responseStatus: entry.responseStatus ?? null,
            capturedAt: Date.now(),
          });
        };
        if (!targetWindow.__opencli_private_msg_capture_fetch) {
          targetWindow.__opencli_private_msg_capture_fetch = targetWindow.fetch.bind(targetWindow);
          targetWindow.fetch = async function(...args) {
            const req = args[0];
            const init = args[1] || {};
            const url = typeof req === 'string' ? req : (req && req.url) || '';
            const method = init.method || (req && req.method) || 'GET';
            const bodyText = typeof init.body === 'string' ? init.body : null;
            const response = await targetWindow.__opencli_private_msg_capture_fetch.apply(this, args);
            if (shouldCapture(url)) {
              try {
                const clone = response.clone();
                const preview = await clone.text();
                pushEntry({
                  url,
                  method,
                  requestBody: parseJson(bodyText),
                  responseBody: parseJson(preview),
                  responsePreview: preview.slice(0, 4000),
                  responseStatus: response.status,
                });
              } catch (error) {
                targetWindow[errName].push({ url, error: String(error) });
              }
            }
            return response;
          };
        }
        if (!targetWindow.__opencli_private_msg_capture_xhr_open) {
          targetWindow.__opencli_private_msg_capture_xhr_open = targetWindow.XMLHttpRequest.prototype.open;
          targetWindow.__opencli_private_msg_capture_xhr_send = targetWindow.XMLHttpRequest.prototype.send;
          targetWindow.XMLHttpRequest.prototype.open = function(method, url) {
            Object.defineProperty(this, '__opencli_private_msg_capture_url', { value: String(url || ''), writable: true, configurable: true });
            Object.defineProperty(this, '__opencli_private_msg_capture_method', { value: String(method || 'GET').toUpperCase(), writable: true, configurable: true });
            return targetWindow.__opencli_private_msg_capture_xhr_open.apply(this, arguments);
          };
          targetWindow.XMLHttpRequest.prototype.send = function(body) {
            this.addEventListener('load', function() {
              const url = this.__opencli_private_msg_capture_url || '';
              if (!shouldCapture(url)) return;
              try {
                const responseText = typeof this.responseText === 'string' ? this.responseText : '';
                pushEntry({
                  url,
                  method: this.__opencli_private_msg_capture_method || 'GET',
                  requestBody: typeof body === 'string' ? parseJson(body) : null,
                  responseBody: parseJson(responseText),
                  responsePreview: responseText.slice(0, 4000),
                  responseStatus: this.status,
                });
              } catch (error) {
                targetWindow[errName].push({ url, error: String(error) });
              }
            });
            return targetWindow.__opencli_private_msg_capture_xhr_send.apply(this, arguments);
          };
        }
      };
      const readPrivateCapture = (targetWindow) => {
        const arrName = '__opencli_private_msg_capture';
        if (!targetWindow) return [];
        const rows = Array.isArray(targetWindow[arrName]) ? targetWindow[arrName].slice() : [];
        targetWindow[arrName] = [];
        return rows;
      };
      const findTabNode = () => {
        const nodes = Array.from(doc.querySelectorAll('button, [role="tab"], div, span, a'));
        const viewportWidth = doc.defaultView?.innerWidth || window.innerWidth || 0;
        return nodes
          .filter((node) => isVisible(node) && normalize(node.textContent) === tabLabel)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { node, rect };
          })
          .sort((left, right) => {
            const leftMainPanel = left.rect.left > viewportWidth * 0.18 ? 0 : 1;
            const rightMainPanel = right.rect.left > viewportWidth * 0.18 ? 0 : 1;
            if (leftMainPanel !== rightMainPanel) return leftMainPanel - rightMainPanel;
            return left.rect.top - right.rect.top;
          })[0]?.node || null;
      };
      const findConversationCards = () => {
        const tabNode = findTabNode();
        const tabRect = tabNode?.getBoundingClientRect() || { bottom: 0 };
        const leftBoundary = (doc.defaultView?.innerWidth || window.innerWidth) * 0.42;
        const avatarNodes = Array.from(doc.querySelectorAll('img'))
          .filter((node) => {
            if (!isVisible(node)) return false;
            const rect = node.getBoundingClientRect();
            return rect.left < leftBoundary && rect.top > tabRect.bottom + 40 && rect.width >= 24 && rect.height >= 24;
          });
        const seen = new Set();
        const cards = [];
        for (const avatar of avatarNodes) {
          let node = avatar;
          let candidate = null;
          for (let depth = 0; depth < 6 && node?.parentElement; depth += 1) {
            node = node.parentElement;
            if (!isVisible(node)) continue;
            const rect = node.getBoundingClientRect();
            if (rect.left >= leftBoundary || rect.width < 160 || rect.width > leftBoundary + 120 || rect.height < 48 || rect.height > 180) continue;
            const unique = uniqueLines(node);
            if (unique.length < 2 || unique.length > 5) continue;
            if (!unique.some((text) => matchTimeLike(text))) continue;
            candidate = node;
            break;
          }
          if (!candidate) continue;
          const rect = candidate.getBoundingClientRect();
          const unique = uniqueLines(candidate);
          const nickname = unique.find((text) => text.length <= 24 && !matchTimeLike(text));
          const preview = unique.find((text) => text !== nickname && text.length <= 80 && !matchTimeLike(text));
          const timeText = unique.find((text) => matchTimeLike(text)) || '';
          if (!nickname || !preview) continue;
          const key = [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height), nickname].join(':');
          if (seen.has(key)) continue;
          seen.add(key);
          cards.push({
            node: candidate,
            nickname,
            previewText: preview,
            timeText,
            avatarUrl: avatar.src || candidate.querySelector('img')?.src || '',
          });
        }
        return cards.sort((a, b) => a.node.getBoundingClientRect().top - b.node.getBoundingClientRect().top);
      };
      const pickResponseData = (row) => row?.responseBody?.data || row?.responseBody || null;
      const flattenSessionInfo = (payload) => {
        const list = payload?.sessionInfo;
        return Array.isArray(list) && list.length > 0 ? list[0] || null : null;
      };
      const flattenMessages = (payload) => {
        if (Array.isArray(payload?.msg)) return payload.msg;
        if (Array.isArray(payload?.msgList)) return payload.msgList;
        if (Array.isArray(payload?.messages)) return payload.messages;
        return [];
      };
      const findMessageNodes = () => {
        const rightBoundary = (doc.defaultView?.innerWidth || window.innerWidth) * 0.38;
        const excludedText = /^(私信管理|私信|打招呼消息|全部私信|共\\d+个|视频号助手.*|关于腾讯微信视频号运营规范问题咨询|发送)$/;
        const candidates = Array.from(doc.querySelectorAll('div, p, span, li, article, section'))
          .filter((node) => isVisible(node));
        const rows = [];
        for (const node of candidates) {
          const rect = node.getBoundingClientRect();
          if (rect.left < rightBoundary || rect.width < 24 || rect.width > 720 || rect.height < 20 || rect.height > 140) continue;
          const text = normalize(node.textContent);
          if (!text || text.length > 200 || excludedText.test(text)) continue;
          const childRepeatsText = Array.from(node.children || []).some((child) => isVisible(child) && normalize(child.textContent) === text);
          if (childRepeatsText) continue;
          rows.push({ text, left: rect.left, top: rect.top });
        }
        const deduped = [];
        const seen = new Set();
        for (const row of rows.sort((a, b) => a.top - b.top)) {
          const key = [row.text, Math.round(row.top / 8), row.left > rightBoundary * 1.6 ? 'right' : 'left'].join(':');
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(row);
        }
        return deduped.slice(-messageLimit);
      };
      const sanitizeMessageText = (text, threadNickname) => {
        let value = normalize(text);
        if (!value) return '';
        value = value
          .replace(/不再接收对方消息.*$/g, '')
          .replace(/投诉.*$/g, '')
          .replace(/扫描二维码后.*$/g, '')
          .replace(/©\\s*1998-\\d{4}\\s*Tencent Inc\\. All Rights Reserved\\./g, '')
          .replace(/你可以向对方打招呼，对方未回复前只能发送1条消息/g, '')
          .trim();
        if (threadNickname) {
          const escaped = threadNickname.replace(/[|\\\\{}()[\\]^$+*?.-]/g, '\\\\$&');
          value = value
            .replace(new RegExp('^' + escaped), '')
            .replace(new RegExp(escaped + '$'), '')
            .trim();
        }
        value = value.replace(/[\\u4e00-\\u9fa5A-Za-z0-9_.·-]+\\s+(男|女)\\s+[\\u4e00-\\u9fa5A-Za-z]+(?:\\s+[\\u4e00-\\u9fa5A-Za-z]+){1,3}$/g, '').trim();
        if (!value || value === threadNickname) return '';
        return value;
      };
      const buildThreadFromApiRows = (rows, fallbackThread) => {
        const sessionInfoRow = [...rows].reverse().find((row) => row.url.includes('/private-msg/get-session-info'));
        const newMsgRow = [...rows].reverse().find((row) => row.url.includes('/private-msg/get-new-msg'));
        const sessionInfo = flattenSessionInfo(pickResponseData(sessionInfoRow));
        const apiMessages = flattenMessages(pickResponseData(newMsgRow));
        const peerUsername = normalize(sessionInfo?.username || '');
        const nickname = normalize(sessionInfo?.nickname || fallbackThread?.nickname || '');
        const messages = apiMessages.map((item, index) => {
          const fromUsername = normalize(item?.fromUsername || '');
          const senderIsPeer = peerUsername && fromUsername === peerUsername;
          return {
            messageId: String(item?.svrMsgId || item?.clientMsgId || item?.id || index + 1),
            direction: senderIsPeer ? 'inbound' : 'outbound',
            senderName: senderIsPeer ? nickname : '我',
            text: normalize(item?.textMsg?.content || item?.rawContent || item?.content || ''),
            messageType: item?.msgType || item?.bizType || 'text',
            timestamp: item?.ts ?? '',
          };
        }).filter((item) => item.text);
        return {
          threadId: normalize(sessionInfo?.sessionId || apiMessages[0]?.sessionId || fallbackThread?.threadId || ''),
          nickname,
          avatarUrl: normalize(sessionInfo?.headImgUrl || fallbackThread?.avatarUrl || ''),
          previewText: messages[messages.length - 1]?.text || normalize(fallbackThread?.previewText || sessionInfo?.rejectMsg || ''),
          latestTimestamp: messages[messages.length - 1]?.timestamp || '',
          messages: messages.slice(-messageLimit),
        };
      };

      installPrivateCapture(interactionWindow);

      const tabNode = findTabNode();
      if (tabNode) {
        tabNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(800);
        readPrivateCapture(interactionWindow);
      }

      let cards = findConversationCards();
      for (let guard = 0; guard < 12 && cards.length < limit; guard += 1) {
        const scroller = cards[0]?.node?.parentElement || doc.scrollingElement || doc.documentElement;
        if (!scroller) break;
        const before = cards.length;
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(600);
        cards = findConversationCards();
        if (cards.length <= before) break;
      }

      const threads = [];
      for (const card of cards.slice(0, limit)) {
        card.node.click?.();
        card.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        card.node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        card.node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(900);
        const captured = readPrivateCapture(interactionWindow);
        const thread = {
          threadId: normalize(card.nickname) || '',
          tab,
          nickname: card.nickname,
          avatarUrl: card.avatarUrl,
          previewText: card.previewText,
          displayTime: card.timeText,
          messages: [],
        };
        const apiThread = buildThreadFromApiRows(captured, thread);
        thread.threadId = apiThread.threadId || thread.threadId;
        thread.nickname = apiThread.nickname || thread.nickname;
        thread.avatarUrl = apiThread.avatarUrl || thread.avatarUrl;
        thread.previewText = apiThread.previewText || thread.previewText;
        thread.latestTimestamp = apiThread.latestTimestamp || '';
        if (includeMessages && apiThread.messages.length > 0) {
          thread.messages = apiThread.messages;
        } else if (includeMessages) {
          thread.messages = findMessageNodes()
            .map((row) => ({
              ...row,
              text: sanitizeMessageText(row.text, thread.nickname),
            }))
            .filter((row) => row.text)
            .map((row, index) => ({
              messageId: String(thread.threadId || thread.nickname || 'thread') + '-dom-' + String(index + 1),
              direction: row.left > (doc.defaultView?.innerWidth || window.innerWidth) * 0.68 ? 'outbound' : 'inbound',
              text: row.text,
              messageType: 'text',
            }));
        }
        threads.push(thread);
      }

      return threads;
    })()
  `);

  return (Array.isArray(rawThreads) ? rawThreads : []).map((item, index) => normalizePrivateMessageThread(item, tab, index));
}

export async function fetchPrivateMessageThreadsFromApi(page, options = {}) {
  const includeMessages = options.includeMessages !== false;
  const limit = options.limit === Infinity ? Number.MAX_SAFE_INTEGER : parsePositiveInt(options.limit, 20, { min: 1, max: 5000 });
  const messageLimit = options.messageLimit === Infinity ? Number.MAX_SAFE_INTEGER : parsePositiveInt(options.messageLimit, 50, { min: 1, max: 5000 });
  let selfUsername = '';

  const allMessages = [];
  const seenSeq = new Set();
  let cookie = '';
  let hasMore = true;

  while (hasMore) {
    const data = await fetchFinderInteractionApi(page, '/private-msg/get-history-msg', {
      cookie,
    }, {
      stage: 'private-message-history',
      onProgress: options.onProgress,
    });
    const rows = Array.isArray(data?.msg) ? data.msg : [];
    for (const row of rows) {
      const seqKey = pickFirst(row?.seq, row?.svrMsgId, row?.msgId, `${row?.sessionId || ''}:${row?.ts || ''}:${row?.rawContent || ''}`);
      if (seqKey && seenSeq.has(seqKey)) continue;
      if (seqKey) seenSeq.add(seqKey);
      allMessages.push(row);
    }
    hasMore = Boolean(data?.isContinue);
    const nextCookie = pickFirst(data?.cookie, cookie, '');
    if (!hasMore || nextCookie === cookie) break;
    cookie = nextCookie;
  }

  let continueNewMsg = true;
  while (continueNewMsg) {
    const data = await fetchFinderInteractionApi(page, '/private-msg/get-new-msg', {
      cookie,
    }, {
      stage: 'private-message-new-msg',
      onProgress: options.onProgress,
    });
    const rows = Array.isArray(data?.msg) ? data.msg : [];
    for (const row of rows) {
      const seqKey = pickFirst(row?.seq, row?.svrMsgId, row?.msgId, `${row?.sessionId || ''}:${row?.ts || ''}:${row?.rawContent || ''}`);
      if (seqKey && seenSeq.has(seqKey)) continue;
      if (seqKey) seenSeq.add(seqKey);
      allMessages.push(row);
    }
    continueNewMsg = Boolean(data?.isContinue);
    const nextCookie = pickFirst(data?.cookie, cookie, '');
    if (!continueNewMsg || nextCookie === cookie) break;
    cookie = nextCookie;
  }

  const sessionMap = new Map();
  for (const row of allMessages) {
    const sessionId = pickFirst(row?.sessionId, '');
    if (!sessionId) continue;
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        threadId: sessionId,
        tab: tabFromPrivateMessageSessionType(row?.sessionType),
        sessionType: Number(row?.sessionType || 0),
        messages: [],
      });
    }
    sessionMap.get(sessionId).messages.push(row);
  }

  let threads = Array.from(sessionMap.values()).map((entry) => {
    const sortedMessages = sortPrivateMessages(entry.messages);
    const latestMessage = sortedMessages[sortedMessages.length - 1] || null;
    return {
      threadId: entry.threadId,
      sessionId: entry.threadId,
      tab: entry.tab,
      sessionType: entry.sessionType,
      latestTimestamp: latestMessage?.ts || '',
      previewText: pickFirst(latestMessage?.textMsg?.content, latestMessage?.rawContent, latestMessage?.content, ''),
      messages: includeMessages ? sortedMessages.slice(-(messageLimit === Number.MAX_SAFE_INTEGER ? sortedMessages.length : messageLimit)) : [],
    };
  });

  threads.sort((left, right) => Number(right?.latestTimestamp || 0) - Number(left?.latestTimestamp || 0));
  threads = threads.slice(0, limit);

  for (const group of chunkArray(threads.map((thread) => thread.threadId), 30)) {
    if (group.length === 0) continue;
    const data = await fetchFinderInteractionApi(page, '/private-msg/get-session-info', {
      sessionId: group,
    }, {
      stage: 'private-message-session-info',
      onProgress: options.onProgress,
    });
    const sessionInfos = Array.isArray(data?.sessionInfo) ? data.sessionInfo : [];
    const infoMap = new Map(sessionInfos.map((item) => [pickFirst(item?.sessionId, ''), item]));
    threads = threads.map((thread) => {
      const info = infoMap.get(thread.threadId);
      return info ? {
        ...thread,
        ...info,
      } : thread;
    });
  }

  try {
    const data = await fetchFinderInteractionApi(page, '/private-msg/get-finder-username', {}, {
      stage: 'private-message-finder-username',
      onProgress: options.onProgress,
    });
    selfUsername = cleanText(pickFirst(
      data?.finderUsername,
      data?.username,
      data?.finder_username,
      data?.finderUserName,
      '',
    ));
  } catch (error) {
    selfUsername = '';
  }

  return threads.map((thread, index) => {
    const peerUsername = cleanText(pickFirst(thread?.username, ''));
    const normalizedMessages = (Array.isArray(thread.messages) ? thread.messages : []).map((message) => {
      const direction = inferPrivateMessageDirection(message, { peerUsername, selfUsername });
      return {
        ...message,
        direction,
        senderName: direction === 'outbound' ? '我' : thread.nickname,
      };
    });
    return normalizePrivateMessageThread({
      ...thread,
      messages: normalizedMessages,
    }, thread.tab, index);
  });
}

export async function collectPrivateMessages(page, kwargs = {}) {
  const all = Boolean(kwargs.all);
  const limit = all ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs.limit, 20, { min: 1, max: 5000 });
  const threadOffset = Math.max(0, Number(kwargs['thread-offset'] ?? kwargs.thread_offset ?? 0) || 0);
  const threadLimit = Math.max(0, Number(kwargs['thread-limit'] ?? kwargs.thread_limit ?? 0) || 0);
  const fetchLimit = threadLimit > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, threadOffset + threadLimit)
    : limit;
  const allMessages = Boolean(kwargs['all-messages']);
  const messageLimit = allMessages ? Infinity : parsePositiveInt(kwargs['message-limit'], 50, { min: 1, max: 5000 });
  const tabs = resolvePrivateMessageTabs(kwargs.tab);

  await gotoFinderPage(page, PRIVATE_MSG_URL);

  const domHeads = [];
  for (const tab of tabs) {
    const tabHeads = await scrapePrivateMessageThreadsFromDom(page, {
      tab,
      limit: fetchLimit,
      messageLimit,
      includeMessages: kwargs['with-messages'] !== false,
      onProgress: kwargs.onProgress,
    });
    domHeads.push(...tabHeads);
  }

  const domTabByNickname = new Map(domHeads.map((thread) => [thread.nickname, thread.tab]));
  const domThreadByNickname = new Map(domHeads.map((thread) => [thread.nickname, thread]));
  const domOrderByKey = new Map(domHeads.map((thread, index) => [`${thread.tab}:${thread.nickname}`, index]));

  let rows = [];
  try {
    rows = await fetchPrivateMessageThreadsFromApi(page, {
      tab: kwargs.tab,
      limit: fetchLimit,
      messageLimit,
      includeMessages: kwargs['with-messages'] !== false,
      onProgress: kwargs.onProgress,
    });
    rows = rows
      .map((thread) => {
        const domTab = domTabByNickname.get(thread.nickname);
        const domHead = domThreadByNickname.get(thread.nickname);
        const resolvedTab = domTab || thread.tab;
        return {
          ...thread,
          tab: resolvedTab,
          tab_label: PRIVATE_MESSAGE_TAB_LABELS[resolvedTab] || thread.tab_label,
          preview_text: domHead?.preview_text || thread.preview_text,
          latest_time: domHead?.latest_time || thread.latest_time,
          messages: Array.isArray(thread.messages)
            ? thread.messages.map((message) => ({ ...message, tab: resolvedTab }))
            : [],
        };
      })
      .filter((thread) => tabs.includes(thread.tab));
  } catch (error) {
    rows = [];
  }

  if (rows.length > 0) {
    for (const domThread of domHeads) {
      if (rows.some((thread) => thread.nickname === domThread.nickname && thread.tab === domThread.tab)) continue;
      rows.push(domThread);
    }
  } else {
    rows = domHeads;
  }

  rows = rows
    .filter((thread) => tabs.includes(thread.tab))
    .sort((left, right) => {
      const leftOrder = domOrderByKey.get(`${left.tab}:${left.nickname}`);
      const rightOrder = domOrderByKey.get(`${right.tab}:${right.nickname}`);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        if (leftOrder === undefined) return 1;
        if (rightOrder === undefined) return -1;
        return leftOrder - rightOrder;
      }
      return Number(right?.latest_timestamp || 0) - Number(left?.latest_timestamp || 0);
    })
    .slice(threadOffset, threadLimit > 0 ? threadOffset + threadLimit : threadOffset + limit)
    .map((thread, index) => ({
      ...thread,
      rank: threadOffset + index + 1,
    }));

  for (const thread of rows) {
    emitProgress({
      type: 'private-message-thread',
      stage: 'private-message-list',
      tab: thread.tab,
      tabLabel: thread.tab_label,
      threadId: thread.thread_id,
      nickname: thread.nickname,
    }, kwargs.onProgress);
  }

  emitProgress({
    type: 'private-messages-complete',
    stage: 'private-message-list',
    totalThreads: rows.length,
    tabs,
  }, kwargs.onProgress);
  return rows;
}

export async function harvestPrivateMessages(page, kwargs = {}) {
  const requestedTabs = resolvePrivateMessageTabs(kwargs.tab);
  const threads = await collectPrivateMessages(page, kwargs);
  const groups = [];

  for (const tab of requestedTabs) {
    const tabThreads = threads.filter((thread) => thread.tab === tab);
    if (tabThreads.length === 0) continue;
    const latestThread = tabThreads.reduce((current, candidate) => {
      if (!current) return candidate;
      return Number(candidate?.latest_timestamp || 0) > Number(current?.latest_timestamp || 0) ? candidate : current;
    }, null);
    groups.push({
      rank: groups.length + 1,
      tab,
      tab_label: PRIVATE_MESSAGE_TAB_LABELS[tab] || tab,
      thread_count: tabThreads.length,
      fetched_message_count: tabThreads.reduce((sum, thread) => sum + Number(thread?.message_count || 0), 0),
      latest_timestamp: latestThread?.latest_timestamp || '',
      latest_time: latestThread?.latest_time || '',
      threads: tabThreads,
    });
  }

  return groups;
}

export async function flattenPrivateMessages(page, kwargs = {}) {
  const threads = await collectPrivateMessages(page, kwargs);
  return threads.flatMap((thread) => {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    return messages.map((message, index) => ({
      row_rank: 0,
      thread_rank: thread.rank,
      thread_id: thread.thread_id,
      thread_tab: thread.tab,
      thread_tab_label: thread.tab_label,
      thread_nickname: thread.nickname,
      thread_avatar_url: thread.avatar_url,
      thread_preview_text: thread.preview_text,
      thread_latest_timestamp: thread.latest_timestamp,
      thread_latest_time: thread.latest_time,
      thread_unread_count: thread.unread_count,
      thread_message_count: thread.message_count,
      message_rank: index + 1,
      message_id: message.message_id,
      sender_name: message.sender_name,
      sender_avatar_url: message.direction === 'inbound' ? thread.avatar_url : '',
      direction: message.direction,
      text: message.text,
      message_type: message.message_type,
      timestamp: message.timestamp,
      time: message.time,
    })).filter((row) => row.direction === 'inbound');
  }).map((row, index) => ({
    ...row,
    row_rank: index + 1,
  }));
}

function extractBulletFeedVideos(payload = {}, startIndex = 0) {
  const items = extractPostList(payload);
  return items.map((item, index) => {
    const normalized = normalizePostItem(item, startIndex + index);
    const objectId = pickFirst(item.objectId, item.exportId, normalized.object_id);
    return {
      title: normalized.title,
      publish_time: normalized.publish_time,
      cover_url: normalized.cover_url,
      bullet_comment_count: Number(pickFirst(
        item.bulletCommentCount,
        item.bullet_comment_count,
        item.videoBulletCommentCount,
        item.video_bullet_comment_count,
        0,
      )) || 0,
      video_no: objectId || '',
      work_no: objectId || '',
      export_id: pickFirst(item.exportId, objectId),
      object_id: pickFirst(item.objectId, item.exportId, normalized.object_id),
    };
  });
}

function extractBulletDetailRows(payload = {}) {
  const directLists = [
    payload?.list,
    payload?.rows,
    payload?.comment,
    payload?.comments,
    payload?.bulletCommentList,
    payload?.bullet_comment_list,
    payload?.bulletChatList,
    payload?.bullet_chat_list,
    payload?.bulletComments,
    payload?.bullet_comments,
  ].filter(Array.isArray);
  const rawRows = directLists.length
    ? directLists.flatMap((list) => list.flatMap((item) => collectBulletChatRowCandidates(item, [])))
    : collectBulletChatRowCandidates(payload, []);
  const byKey = new Map();
  for (const row of rawRows) {
    const key = cleanText(row.bullet_comment_id) || buildBulletRowSignature(row);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

async function fetchBulletChatDetailRows(page, video = {}, options = {}) {
  const expectedRows = Number(video.bullet_comment_count || video.bulletCommentCount || 0) || 0;
  const rows = [];
  let lastBuffer = '';
  let pageNumber = 1;
  while (!expectedRows || rows.length < expectedRows) {
    const data = await fetchFinderInteractionApi(page, '/bullet-chat/bullet-chat-list', {
      feedExportId: pickFirst(video.export_id, video.object_id, video.video_no, video.work_no),
      order: 0,
      lastBuffer,
    }, {
      stage: 'bullet-chat-detail',
      onProgress: options.onProgress,
    });
    const pageRows = extractBulletDetailRows(data);
    emitProgress({
      type: 'bullet-chat-detail-page',
      stage: 'bullet-chat-detail',
      videoNo: pickFirst(video.video_no, video.work_no, video.object_id, video.export_id),
      pageNumber,
      receivedCount: pageRows.length,
      accumulatedRows: rows.length,
    }, options.onProgress);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    if (!hasMoreResults(data, pageRows)) break;
    const nextCursor = extractNextCursor(data);
    if (!nextCursor || nextCursor === lastBuffer) break;
    lastBuffer = String(nextCursor);
    pageNumber += 1;
  }
  return rows;
}

export async function collectBulletChats(page, kwargs = {}) {
  const all = Boolean(kwargs.all);
  const limit = all ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs.limit, 20, { min: 1, max: 5000 });
  const workIdFilter = loadWorkIdFilterFromArgs(kwargs);
  const targetLimit = workIdFilter ? workIdFilter.size : limit;
  const matchedTargetIds = new Set();

  await gotoFinderPage(page, BULLET_CHAT_URL);

  const mergedVideos = [];
  let currentPage = 1;
  while (mergedVideos.length < targetLimit) {
    const pageSize = 50;
    const data = await fetchFinderInteractionApi(page, '/bullet-chat/feed-list', {
      currentPage,
      pageSize,
    }, {
      stage: 'bullet-chat-feed',
      onProgress: kwargs.onProgress,
    });
    const allPageVideos = extractBulletFeedVideos(data, mergedVideos.length);
    emitProgress({
      type: 'bullet-chat-page',
      stage: 'bullet-chat-feed',
      currentPage,
      pageSize,
      receivedCount: allPageVideos.length,
      accumulatedVideos: mergedVideos.length,
      all,
      limit,
    }, kwargs.onProgress);
    if (allPageVideos.length === 0) break;
    const pageVideos = workIdFilter
      ? allPageVideos.filter((video) => matchingWorkIds(video, workIdFilter).length > 0)
      : allPageVideos;
    for (const video of pageVideos) {
      for (const id of matchingWorkIds(video, workIdFilter)) matchedTargetIds.add(id);
      const rows = await fetchBulletChatDetailRows(page, video, {
        onProgress: kwargs.onProgress,
      });
      if (!rows.length) continue;
      mergedVideos.push({
        ...video,
        rows,
      });
      if (mergedVideos.length >= targetLimit) break;
    }
    if (mergedVideos.length >= targetLimit) break;
    if (workIdFilter && matchedTargetIds.size >= workIdFilter.size) break;
    if (allPageVideos.length < pageSize || !hasMoreResults(data, allPageVideos)) break;
    currentPage += 1;
  }

  if (shouldDebugBulletChats()) {
    console.error(`OPENCLI_BULLET_DEBUG ${JSON.stringify({
      api_video_count: mergedVideos.length,
      first_merged_video: mergedVideos[0] || null,
    })}`);
  }
  const videos = mergedVideos
    .map((video, index) => normalizeBulletChatVideo(video, index))
    .filter((video) => Array.isArray(video.rows) && video.rows.length > 0)
    .slice(0, targetLimit);

  for (const video of videos) {
    emitProgress({
      type: 'danmaku-video',
      stage: 'danmaku-list',
      title: video.video_title,
      videoNo: video.video_no,
      bulletCount: video.rows.length,
    }, kwargs.onProgress);
  }

  emitProgress({
    type: 'danmaku-complete',
    stage: 'danmaku-list',
    totalVideos: videos.length,
    totalRows: videos.reduce((sum, video) => sum + video.rows.length, 0),
  }, kwargs.onProgress);
  return videos;
}

export async function flattenBulletChats(page, kwargs = {}) {
  const videos = await collectBulletChats(page, kwargs);
  return videos
    .flatMap((video) => video.rows.map((row) => ({
      video_rank: video.video_rank,
      video_no: video.video_no,
      work_no: video.work_no,
      export_id: video.export_id,
      object_id: video.object_id,
      video_title: video.video_title,
      video_cover_url: video.video_cover_url,
      video_publish_time: video.video_publish_time,
      video_danmaku_count: video.video_bullet_comment_count,
      danmaku_rank: row.bullet_rank,
      danmaku_id: row.bullet_comment_id,
      content: row.content,
      comment_user_name: row.comment_user_name,
      comment_user_photo: row.comment_user_photo,
      video_timestamp_text: row.video_timestamp_text,
      video_timestamp_ms: row.video_timestamp_ms,
      created_at: row.created_at,
    })))
    .map((row, index) => ({
      ...row,
      row_rank: index + 1,
    }));
}

export function extractNextCursor(payload = {}) {
  return pickFirst(
    payload.lastBuff,
    payload.last_buff,
    payload.nextLastBuff,
    payload.next_last_buff,
    payload.nextCursor,
    payload.next_cursor,
    payload.cursor,
    payload.continuation,
    payload.continuationToken,
    payload.lastBuffer,
    payload.nextLastBuffer,
    '',
  );
}

export function hasMoreResults(payload = {}, list = []) {
  const explicit = pickFirst(
    payload.hasMore,
    payload.has_more,
    payload.more,
    payload.isContinue,
    payload.continueFlag,
    null,
  );
  if (typeof explicit === 'boolean') return explicit;
  if (explicit === 1 || explicit === '1') return true;
  if (explicit === 0 || explicit === '0') return false;
  return Boolean(extractNextCursor(payload) && list.length > 0);
}

export async function gotoFinderPage(page, url) {
  if (!page) {
    throw new CliError('BROWSER_REQUIRED', 'Weixin Channels adapters require a browser session');
  }
  emitProgress({
    type: 'navigate',
    stage: 'browser',
    page: url,
  });
  await page.goto(url);
  await page.wait({ time: 2 });
}

export async function fetchFinderApi(page, path, payload = {}, options = {}) {
  emitProgress({
    type: 'api-request',
    stage: options.stage || 'api',
    path,
    pageNumber: options.pageNumber,
    exportId: options.exportId,
    commentId: options.commentId,
    request: payload,
  }, options.onProgress);
  const url = path.startsWith('http') ? path : `${FINDER_ORIGIN}${FINDER_HELPER_BASE}${path}`;
  const body = JSON.stringify(payload);
  let result;
  try {
    result = await page.evaluate(`
      (async () => {
        const url = ${JSON.stringify(url)};
        const payload = ${body};
        const bodyText = document.body?.innerText || '';
        const href = location.href;
        const loginBlocked = /登录|扫码登录|请先登录/.test(bodyText) && /channels\\.weixin\\.qq\\.com/.test(href);
        const forbidden = /无权限|暂无权限|访问受限|环境异常|去验证/.test(bodyText);
        let response;
        let text = '';
        try {
          response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              'Accept': 'application/json, text/plain, */*',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(payload),
          });
          text = await response.text();
        } catch (error) {
          return {
            ok: false,
            status: 0,
            loginBlocked,
            forbidden,
            href,
            bodyText,
            error: error instanceof Error ? error.message : String(error),
            text: '',
          };
        }

        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          return {
            ok: response.ok,
            status: response.status,
            loginBlocked,
            forbidden,
            href,
            bodyText,
            error: error instanceof Error ? error.message : String(error),
            text,
          };
        }

        return {
          ok: response.ok,
          status: response.status,
          loginBlocked,
          forbidden,
          href,
          bodyText,
          json,
          text,
        };
      })()
    `);
  } catch (error) {
    emitProgress({
      type: 'api-error',
      stage: options.stage || 'api',
      path,
      pageNumber: options.pageNumber,
      exportId: options.exportId,
      commentId: options.commentId,
      error: error instanceof Error ? error.message : String(error),
    }, options.onProgress);
    throw error;
  }

  if (!result) {
    emitProgress({
      type: 'api-error',
      stage: options.stage || 'api',
      path,
      pageNumber: options.pageNumber,
      exportId: options.exportId,
      commentId: options.commentId,
      error: 'empty response',
    }, options.onProgress);
    throw new CliError('EMPTY_RESPONSE', `Weixin Channels API ${path} returned an empty response`);
  }

  if (result.loginBlocked) {
    throw new AuthRequiredError('channels.weixin.qq.com', 'Please log in to Weixin Channels Helper in the browser first');
  }

  if (result.forbidden) {
    emitProgress({
      type: 'api-error',
      stage: options.stage || 'api',
      path,
      pageNumber: options.pageNumber,
      exportId: options.exportId,
      commentId: options.commentId,
      error: 'access blocked',
      status: result.status || 0,
    }, options.onProgress);
    throw new CliError('ACCESS_BLOCKED', 'Weixin Channels Helper blocked access on the current page');
  }

  if (!result.ok || !result.json) {
    emitProgress({
      type: 'api-error',
      stage: options.stage || 'api',
      path,
      pageNumber: options.pageNumber,
      exportId: options.exportId,
      commentId: options.commentId,
      error: result.error || 'request failed',
      status: result.status || 0,
    }, options.onProgress);
    throw new CliError(
      'REQUEST_FAILED',
      `Weixin Channels API ${path} failed with status ${result.status || 0}: ${result.error || 'unknown error'}`,
    );
  }

  const unwrapped = unwrapFinderResponse(path, result.json);
  emitProgress({
    type: 'api-response',
    stage: options.stage || 'api',
    path,
    pageNumber: options.pageNumber,
    exportId: options.exportId,
    commentId: options.commentId,
    status: result.status,
    ok: result.ok,
  }, options.onProgress);
  return unwrapped;
}

export async function fetchFinderInteractionApi(page, path, payload = {}, options = {}) {
  emitProgress({
    type: 'api-request',
    stage: options.stage || 'interaction-api',
    path,
    request: payload,
  }, options.onProgress);
  const url = path.startsWith('http') ? path : `${FINDER_ORIGIN}${FINDER_INTERACTION_HELPER_BASE}${path}`;
  const body = JSON.stringify(payload);
  let result;
  try {
    result = await page.evaluate(`
      (async () => {
        const url = ${JSON.stringify(url)};
        const payload = ${body};
        const bodyText = document.body?.innerText || '';
        const href = location.href;
        const loginBlocked = /登录|扫码登录|请先登录/.test(bodyText) && /channels\\.weixin\\.qq\\.com/.test(href);
        const forbidden = /无权限|暂无权限|访问受限|环境异常|去验证/.test(bodyText);
        let response;
        let text = '';
        try {
          response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              'Accept': 'application/json, text/plain, */*',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(payload),
          });
          text = await response.text();
        } catch (error) {
          return {
            ok: false,
            status: 0,
            loginBlocked,
            forbidden,
            href,
            bodyText,
            error: error instanceof Error ? error.message : String(error),
            text: '',
          };
        }

        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          return {
            ok: response.ok,
            status: response.status,
            loginBlocked,
            forbidden,
            href,
            bodyText,
            error: error instanceof Error ? error.message : String(error),
            text,
          };
        }

        return {
          ok: response.ok,
          status: response.status,
          loginBlocked,
          forbidden,
          href,
          bodyText,
          json,
          text,
        };
      })()
    `);
  } catch (error) {
    emitProgress({
      type: 'api-error',
      stage: options.stage || 'interaction-api',
      path,
      error: error instanceof Error ? error.message : String(error),
    }, options.onProgress);
    throw error;
  }

  if (!result) {
    throw new CliError('EMPTY_RESPONSE', `Weixin Channels interaction API ${path} returned an empty response`);
  }
  if (result.loginBlocked) {
    throw new AuthRequiredError('channels.weixin.qq.com', 'Please log in to Weixin Channels Helper in the browser first');
  }
  if (result.forbidden) {
    throw new CliError('ACCESS_BLOCKED', 'Weixin Channels Helper interaction page blocked access on the current page');
  }
  if (!result.ok || !result.json) {
    throw new CliError(
      'REQUEST_FAILED',
      `Weixin Channels interaction API ${path} failed with status ${result.status || 0}: ${result.error || 'unknown error'}`,
    );
  }

  const unwrapped = unwrapFinderResponse(path, result.json);
  emitProgress({
    type: 'api-response',
    stage: options.stage || 'interaction-api',
    path,
    status: result.status,
    ok: result.ok,
  }, options.onProgress);
  return unwrapped;
}

export function unwrapFinderResponse(path, payload) {
  const errCode = Number(payload?.errCode ?? payload?.errcode ?? 0);
  const baseErrCode = Number(
    payload?.data?.baseResp?.errcode ??
      payload?.data?.baseResp?.errCode ??
      payload?.baseResp?.errcode ??
      payload?.baseResp?.errCode ??
      0,
  );
  const errMsg =
    payload?.message ||
    payload?.errmsg ||
    payload?.errMsg ||
    payload?.data?.baseResp?.errmsg ||
    payload?.data?.baseResp?.errMsg ||
    payload?.baseResp?.errmsg ||
    payload?.baseResp?.errMsg ||
    '';

  if (errCode !== 0 || baseErrCode !== 0) {
    const message = cleanText(errMsg) || `Weixin Channels API ${path} returned errCode=${errCode}, baseErrCode=${baseErrCode}`;
    if (/登录|login|auth/i.test(message)) {
      throw new AuthRequiredError('channels.weixin.qq.com', message);
    }
    throw new CliError('API_ERROR', message);
  }

  return payload?.data ?? payload;
}

export async function fetchCommentReplies(page, exportId, comment, replyLimit = 20, options = {}) {
  const pageSize = parsePositiveInt(replyLimit, 20, { min: 1, max: 100 });
  const maxItems = replyLimit === Infinity ? Infinity : pageSize;
  const rows = [];
  let lastBuff = '';
  let pageNumber = 1;
  const commentId = pickFirst(comment.commentId, comment.id);
  let filteredSelfCount = 0;

  while (rows.length < maxItems) {
    const data = await fetchFinderApi(page, '/comment/comment_list', {
      exportId,
      rootCommentId: commentId,
      commentSelection: false,
      lastBuff,
      pageSize: Math.min(pageSize, maxItems === Infinity ? pageSize : maxItems - rows.length),
    }, {
      stage: 'reply-list',
      pageNumber,
      exportId,
      commentId,
      onProgress: options.onProgress,
    });
    const replies = Array.isArray(data?.comment) ? data.comment : [];
    emitProgress({
      type: 'reply-page',
      stage: 'reply-list',
      pageNumber,
      exportId,
      commentId,
      receivedCount: replies.length,
      accumulatedReplies: rows.length,
    }, options.onProgress);
    if (replies.length === 0) break;
    const inboundReplies = replies.filter((item) => !isExplicitSelfComment(item, options.selfUsername));
    const pageFilteredSelfCount = replies.length - inboundReplies.length;
    filteredSelfCount += pageFilteredSelfCount;
    const nextCursor = extractNextCursor(data);
    const hasMore = hasMoreResults(data, replies);
    emitProgress({
      type: 'reply-page-diagnostics',
      stage: 'reply-list',
      pageNumber,
      exportId,
      commentId,
      receivedCount: replies.length,
      keptCount: inboundReplies.length,
      filteredSelfCount: pageFilteredSelfCount,
      hasMore,
      nextCursor: nextCursor || '',
      currentCursor: lastBuff,
    }, options.onProgress);
    rows.push(...inboundReplies.map((item, index) => normalizeCommentItem(item, exportId, comment, rows.length + index)));
    emitProgress({
      type: 'reply-progress',
      stage: 'reply-list',
      pageNumber,
      exportId,
      commentId,
      accumulatedReplies: rows.length,
    }, options.onProgress);
    if (!hasMore) break;
    if (!nextCursor || nextCursor === lastBuff) break;
    lastBuff = String(nextCursor);
    pageNumber += 1;
  }

  return {
    rows: maxItems === Infinity ? rows : rows.slice(0, maxItems),
    filteredSelfCount,
  };
}

export async function fetchPostList(page, kwargs = {}) {
  let currentPage = parsePositiveInt(kwargs.page, 1, { min: 1, max: 9999 });
  const all = Boolean(kwargs.all);
  const limit = all ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs.limit, 20, { min: 1, max: 5000 });

  await gotoFinderPage(page, POST_LIST_URL);

  const rows = [];
  while (rows.length < limit) {
    const pageSize = Math.min(50, limit - rows.length);
    const pageNumber = currentPage;
    const data = await fetchFinderApi(page, '/post/post_list', {
      currentPage: pageNumber,
      pageSize,
      onlyUnread: Boolean(kwargs['only-unread']),
      needAllCommentCount: true,
      forMcn: Boolean(kwargs['for-mcn']),
    }, {
      stage: 'post-list',
      pageNumber,
      onProgress: kwargs.onProgress,
    });

    const list = Array.isArray(data?.list) ? data.list : [];
    emitProgress({
      type: 'post-page',
      stage: 'post-list',
      currentPage: pageNumber,
      pageSize,
      receivedCount: list.length,
      accumulatedPosts: rows.length,
      all,
      limit,
    }, kwargs.onProgress);
    if (list.length === 0) break;
    rows.push(...list.map((item, index) => normalizePostItem(item, rows.length + index)));
    if (list.length < pageSize || !all) break;
    currentPage += 1;
  }

  emitProgress({
    type: 'post-list-complete',
    stage: 'post-list',
    totalPosts: rows.slice(0, limit).length,
    all,
    limit,
  }, kwargs.onProgress);
  return rows.slice(0, limit);
}

async function fetchImageTextListPage(page, paths, payload, options = {}) {
  let lastError = null;
  let firstEmpty = null;
  for (const path of paths) {
    try {
      const data = await fetchFinderApi(page, path, payload, {
        ...options,
        path,
      });
      const list = extractPostList(data);
      if (list.length > 0 || paths.length === 1) {
        return { data, list, path };
      }
      firstEmpty ||= { data, list, path };
    } catch (error) {
      lastError = error;
    }
  }

  if (firstEmpty) return firstEmpty;
  if (lastError) throw lastError;
  throw new CliError(
    'EMPTY_IMAGE_TEXT_LIST',
    `Weixin Channels image-text list returned no rows from candidate APIs: ${paths.join(', ')}`,
  );
}

export async function fetchImageTextList(page, kwargs = {}) {
  let currentPage = parsePositiveInt(kwargs.page, 1, { min: 1, max: 9999 });
  const all = Boolean(kwargs.all);
  const limit = all ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs.limit, 20, { min: 1, max: 5000 });
  const configuredPath = cleanText(kwargs['api-path']);
  const paths = configuredPath ? [configuredPath] : IMAGE_TEXT_LIST_API_PATHS;

  await gotoFinderPage(page, IMAGE_TEXT_LIST_URL);

  const rows = [];
  while (rows.length < limit) {
    const pageSize = Math.min(50, limit - rows.length);
    const pageNumber = currentPage;
    const { list, path } = await fetchImageTextListPage(page, paths, {
      currentPage: pageNumber,
      pageSize,
      onlyUnread: Boolean(kwargs['only-unread']),
      needAllCommentCount: true,
      forMcn: Boolean(kwargs['for-mcn']),
    }, {
      stage: 'image-text-list',
      pageNumber,
      onProgress: kwargs.onProgress,
    });

    emitProgress({
      type: 'image-text-page',
      stage: 'image-text-list',
      currentPage: pageNumber,
      pageSize,
      receivedCount: list.length,
      accumulatedImageTexts: rows.length,
      apiPath: path,
      all,
      limit,
    }, kwargs.onProgress);
    if (list.length === 0) break;
    rows.push(...list.map((item, index) => normalizeImageTextPostItem(item, rows.length + index)));
    if (list.length < pageSize || !all) break;
    currentPage += 1;
  }

  emitProgress({
    type: 'image-text-list-complete',
    stage: 'image-text-list',
    totalImageTexts: rows.slice(0, limit).length,
    all,
    limit,
  }, kwargs.onProgress);
  return rows.slice(0, limit);
}

export async function collectPostComments(page, exportId, kwargs = {}) {
  const all = Boolean(kwargs.all);
  const allReplies = Boolean(kwargs['all-replies'] ?? all);
  const limit = all ? Number.MAX_SAFE_INTEGER : parsePositiveInt(kwargs.limit, 20, { min: 1, max: 5000 });
  const replyLimit = allReplies ? Infinity : parsePositiveInt(kwargs['reply-limit'], 20, { min: 1, max: 1000 });
  const withReplies = Boolean(kwargs['with-replies']);

  await gotoFinderPage(page, COMMENT_URL);

  emitProgress({
    type: 'comment-detail',
    stage: 'comment-detail',
    exportId,
  }, kwargs.onProgress);
  const detail = await fetchFinderApi(page, '/comment/get_feed_detail', {
    exportId,
  }, {
    stage: 'comment-detail',
    exportId,
    onProgress: kwargs.onProgress,
  }).catch(() => null);

  const resolvedExportId = String(
    pickFirst(
      detail?.object?.objectId,
      detail?.objectId,
      exportId,
    ),
  );
  emitProgress({
    type: 'comment-detail-resolved',
    stage: 'comment-detail',
    exportId,
    resolvedExportId,
  }, kwargs.onProgress);

  let selfUsername = '';
  try {
    const selfInfo = await fetchFinderInteractionApi(page, '/private-msg/get-finder-username', {}, {
      stage: 'comment-finder-username',
      exportId: resolvedExportId,
      onProgress: kwargs.onProgress,
    });
    selfUsername = cleanText(pickFirst(
      selfInfo?.finderUsername,
      selfInfo?.username,
      selfInfo?.finder_username,
      selfInfo?.finderUserName,
      '',
    ));
  } catch {
    selfUsername = '';
  }

  const rows = [];
  let lastBuff = String(kwargs['last-buff'] || '');
  let pageNumber = 1;
  let filteredSelfTopLevelComments = 0;
  let filteredSelfReplies = 0;
  while (rows.filter((row) => !row.is_reply).length < limit) {
    const remainingTopLevel = limit - rows.filter((row) => !row.is_reply).length;
    const data = await fetchFinderApi(page, '/comment/comment_list', {
      exportId: resolvedExportId,
      lastBuff,
      pageSize: Math.min(50, remainingTopLevel),
      commentSelection: Boolean(kwargs['fav-only']),
      forMcn: Boolean(kwargs['for-mcn']),
    }, {
      stage: 'comment-list',
      pageNumber,
      exportId: resolvedExportId,
      onProgress: kwargs.onProgress,
    });

    const comments = Array.isArray(data?.comment) ? data.comment : [];
    emitProgress({
      type: 'comment-page',
      stage: 'comment-list',
      pageNumber,
      exportId: resolvedExportId,
      receivedCount: comments.length,
      accumulatedTopLevel: rows.filter((row) => !row.is_reply).length,
      withReplies,
    }, kwargs.onProgress);
    if (comments.length === 0) break;
    const visibleComments = comments.filter((item) => !isExplicitSelfComment(item, selfUsername));
    const pageFilteredSelfCount = comments.length - visibleComments.length;
    filteredSelfTopLevelComments += pageFilteredSelfCount;
    const nextCursor = extractNextCursor(data);
    const hasMore = hasMoreResults(data, comments);
    emitProgress({
      type: 'comment-page-diagnostics',
      stage: 'comment-list',
      pageNumber,
      exportId: resolvedExportId,
      receivedCount: comments.length,
      keptCount: visibleComments.length,
      filteredSelfCount: pageFilteredSelfCount,
      hasMore,
      nextCursor: nextCursor || '',
      currentCursor: lastBuff,
      withReplies,
    }, kwargs.onProgress);
    for (const item of comments) {
      if (rows.filter((row) => !row.is_reply).length >= limit) break;
      if (isExplicitSelfComment(item, selfUsername)) continue;
      rows.push(normalizeCommentItem(item, resolvedExportId, null, rows.length));
      emitProgress({
        type: 'comment-item',
        stage: 'comment-list',
        exportId: resolvedExportId,
        commentId: pickFirst(item.commentId, item.id),
        author: pickFirst(item.commentNickname, item.nickname),
        accumulatedTopLevel: rows.filter((row) => !row.is_reply).length,
      }, kwargs.onProgress);
      if (!withReplies) continue;
      const replyResult = await fetchCommentReplies(page, resolvedExportId, item, replyLimit, {
        onProgress: kwargs.onProgress,
        selfUsername,
      });
      filteredSelfReplies += replyResult.filteredSelfCount;
      rows.push(...replyResult.rows);
    }

    if (!all || !hasMore) break;
    if (!nextCursor || nextCursor === lastBuff) break;
    lastBuff = String(nextCursor);
    pageNumber += 1;
  }

  const normalizedRows = rows.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
  emitProgress({
    type: 'comments-complete',
    stage: 'comment-list',
    exportId: resolvedExportId,
    totalRows: normalizedRows.length,
    totalTopLevel: normalizedRows.filter((row) => !row.is_reply).length,
    totalReplies: normalizedRows.filter((row) => row.is_reply).length,
    filteredSelfTopLevelComments,
    filteredSelfReplies,
  }, kwargs.onProgress);
  return normalizedRows;
}
