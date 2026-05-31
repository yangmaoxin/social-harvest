import { applyIntentionAnalysis } from './intention-classifier.js';
import { ensureDatetimeText, ensureInt, ensureText, nowDatetimeText } from './scrm-base.js';

export const MAPPERS = {
  'weixin-channels': {
    platform: 'weixin-channels',
    displayName: 'Weixin Channels',
    originType: 1,
    buildPayload: buildWeixinChannelsPayload,
  },
  douyin: {
    platform: 'douyin',
    displayName: 'Douyin',
    originType: 2,
    buildPayload: buildDouyinPayload,
  },
};

export function getMapper(platform) {
  const mapper = MAPPERS[platform];
  if (!mapper) throw new Error(`Unsupported platform: ${platform}`);
  return mapper;
}

function normalizeDouyinFileType(work = {}) {
  const explicitNumber = ensureInt(work.file_type);
  if (explicitNumber === 2) return 2;
  const explicitText = ensureText(work.file_type).toLowerCase();
  if (explicitText === 'image_text' || explicitText === 'image-text' || explicitText === 'note') return 2;
  const awemeType = ensureInt(work.aweme_type);
  if (awemeType === 68) return 2;
  return 1;
}

export async function buildWeixinChannelsPayload(harvestRows, { limit = 0, classifier = undefined, now = new Date() } = {}) {
  const nowText = nowDatetimeText(now);
  const rows = limit > 0 ? harvestRows.slice(0, limit) : harvestRows;
  const works = [];
  const comments = [];
  const warnings = [];

  for (const work of rows) {
    const workKey = ensureText(work.object_id, 128);
    const coverUrl = ensureText(work.cover_url, 1024);
    const title = ensureText(work.title, 500);
    if (ensureText(work.cover_url).length > 1024) warnings.push(`Work ${work.object_id} cover_url exceeded 1024 and was truncated.`);
    if (ensureText(work.title).length > 500) warnings.push(`Work ${work.object_id} title exceeded 500 and was truncated.`);
    works.push({
      work_no: workKey,
      file_type: ensureInt(work.file_type) === 2 ? 2 : 1,
      origin_type: 1,
      duration: ensureInt(work.duration),
      title,
      front_img_url: coverUrl,
      share_url: ensureText(work.share_url || work.video_link || work.short_url, 1024),
      count_collect: 0,
      count_comment: ensureInt(work.comment_count),
      count_play: ensureInt(work.view_count),
      count_danmaku: 0,
      count_like: ensureInt(work.like_count),
      count_fav: ensureInt(work.fav_count),
      count_share: ensureInt(work.share_count),
      public_at: ensureDatetimeText(work.publish_time) || nowText,
      status: 1,
      created_at: nowText,
    });

    for (const comment of work.comments ?? []) {
      const content = ensureText(comment.text, 1024);
      if (ensureText(comment.text).length > 1024) warnings.push(`Comment ${comment.comment_id} content exceeded 1024 and was truncated.`);
      comments.push({
        comment_id: ensureText(comment.comment_id, 64),
        origin_type: 1,
        comment_user_name: ensureText(comment.author, 128) || null,
        comment_user_photo: ensureText(comment.avatar_url, 1024) || null,
        content,
        intention: 0,
        work_no: ensureText(comment.export_id, 128) || workKey,
        parent_comment_id: ensureText(comment.parent_comment_id, 64),
        root_parent_id: ensureText(comment.root_comment_id, 64),
        reply_to: ensureText(comment.reply_to, 128),
        reply_to_comment_id: ensureText(comment.reply_comment_id, 64),
        ip_location: ensureText(comment.ip_location, 128),
        count_agree: ensureInt(comment.like_count),
        status: 1,
        created_at: ensureDatetimeText(comment.time) || nowText,
      });
    }
  }

  warnings.push(...await applyIntentionAnalysis(comments, { classifier }));
  return { works, comments, warnings };
}

export async function buildDouyinPayload(harvestRows, { limit = 0, classifier = undefined, now = new Date() } = {}) {
  const nowText = nowDatetimeText(now);
  const rows = limit > 0 ? harvestRows.slice(0, limit) : harvestRows;
  const works = [];
  const comments = [];
  const danmaku = [];
  const warnings = [];

  for (const work of rows) {
    const workKey = ensureText(work.aweme_id, 128);
    const coverUrl = ensureText(work.cover_url, 1024);
    const title = ensureText(work.title, 500);
    if (ensureText(work.cover_url).length > 1024) warnings.push(`Work ${work.aweme_id} cover_url exceeded 1024 and was truncated.`);
    if (ensureText(work.title).length > 500) warnings.push(`Work ${work.aweme_id} title exceeded 500 and was truncated.`);
    const danmakuCount = ensureInt(work.creator_danmaku_count || work.danmaku_count || work.danmaku?.length);
    works.push({
      work_no: workKey,
      file_type: normalizeDouyinFileType(work),
      origin_type: 2,
      duration: ensureInt(work.duration),
      title,
      front_img_url: coverUrl,
      share_url: ensureText(work.share_url || work.video_link || work.short_url, 1024),
      count_collect: ensureInt(work.collect_count),
      count_comment: ensureInt(work.comment_count),
      count_play: ensureInt(work.play_count || work.view_count),
      count_danmaku: danmakuCount,
      count_like: ensureInt(work.digg_count || work.like_count),
      count_fav: ensureInt(work.fav_count),
      count_share: ensureInt(work.share_count),
      public_at: ensureDatetimeText(work.create_time || work.publish_time) || nowText,
      status: 1,
      created_at: nowText,
    });

    for (const comment of work.comments ?? []) {
      const content = ensureText(comment.text, 1024);
      if (ensureText(comment.text).length > 1024) warnings.push(`Comment ${comment.comment_id} content exceeded 1024 and was truncated.`);
      comments.push({
        comment_id: ensureText(comment.comment_id, 64),
        origin_type: 2,
        comment_user_name: ensureText(comment.author, 128) || null,
        comment_user_photo: ensureText(comment.avatar_url, 1024) || null,
        content,
        intention: 0,
        work_no: ensureText(comment.aweme_id, 128) || workKey,
        parent_comment_id: ensureText(comment.parent_comment_id, 64),
        root_parent_id: ensureText(comment.root_parent_id || comment.root_comment_id, 64),
        reply_to: ensureText(comment.reply_to, 128),
        reply_to_comment_id: ensureText(comment.reply_to_comment_id, 64),
        ip_location: ensureText(comment.ip_location, 128),
        count_agree: ensureInt(comment.digg_count || comment.like_count),
        status: 1,
        created_at: ensureDatetimeText(comment.time) || nowText,
      });
    }

    for (const item of work.danmaku ?? []) {
      const content = ensureText(item.text, 1024);
      if (ensureText(item.text).length > 1024) warnings.push(`Danmaku ${item.danmaku_id} content exceeded 1024 and was truncated.`);
      danmaku.push({
        danmaku_id: ensureText(item.danmaku_id, 64),
        origin_type: 2,
        work_no: ensureText(item.aweme_id, 128) || workKey,
        item_id: ensureText(item.item_id, 128) || ensureText(work.creator_danmaku_item_id || work.item_id, 128),
        author: ensureText(item.author, 128) || null,
        author_uid: ensureText(item.author_uid, 128) || null,
        author_sec_uid: ensureText(item.author_sec_uid, 256) || null,
        avatar_url: ensureText(item.avatar_url, 1024) || null,
        content,
        count_agree: ensureInt(item.digg_count || item.like_count),
        video_time: ensureText(item.video_time, 32),
        video_position_seconds: ensureInt(item.video_position_seconds),
        created_at: ensureDatetimeText(item.time || item.create_time) || nowText,
      });
    }
  }

  warnings.push(...await applyIntentionAnalysis(comments, { classifier }));
  return { works, comments, danmaku, warnings };
}
