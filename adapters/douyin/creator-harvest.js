import {
  DOUYIN_SOURCE_CREATOR_CENTER,
  normalizeDouyinCommentLimit,
  normalizeDouyinPageLimit,
  normalizeDouyinVideoLimit,
} from './shared.js';
import { fetchDouyinCreatorDanmakuRows, fetchDouyinCreatorDanmakuTargets } from './creator-danmaku.js';
import { fetchDouyinCreatorCommentRows, fetchDouyinCreatorCommentTargets } from './creator-comments.js';
import { fetchDouyinCreatorWorkRows } from './creator-works.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;
const OPENCLI_PROGRESS_PREFIX = 'OPENCLI_PROGRESS ';

function emitProgress(event = {}) {
  if (process.env.OPENCLI_PROGRESS_EVENTS !== 'jsonl') return;
  console.error(`${OPENCLI_PROGRESS_PREFIX}${JSON.stringify({
    type: 'creator-harvest',
    stage: 'creator-harvest',
    status: 'running',
    ...event,
  })}`);
}

export const douyinCreatorHarvestSpec = {
  site: 'douyin',
  name: 'skill-creator-harvest',
  description: '汇总抖音创作者中心作品管理、评论管理和弹幕管理数据',
  args: [
    { name: 'work_limit', type: 'int', default: 20, help: 'Maximum creator works to return' },
    { name: 'work_cursor', type: 'string', default: '0', help: 'Creator works pagination cursor' },
    { name: 'comment_work_limit', type: 'int', default: 5, help: 'Maximum creator comment targets to fetch comments for' },
    { name: 'comment_work_cursor', type: 'string', default: '0', help: 'Creator comment target pagination cursor' },
    { name: 'comment_limit', type: 'int', default: 20, help: 'Maximum comments per target' },
    { name: 'comment_pages', type: 'int', default: 1, help: 'Maximum comment pages per target' },
    { name: 'danmaku_work_limit', type: 'int', default: 5, help: 'Maximum creator danmaku targets to fetch danmaku for' },
    { name: 'danmaku_work_cursor', type: 'string', default: '0', help: 'Creator danmaku target pagination cursor' },
    { name: 'danmaku_limit', type: 'int', default: 20, help: 'Maximum danmaku rows per target' },
    { name: 'danmaku_pages', type: 'int', default: 1, help: 'Maximum danmaku pages per target' },
    { name: 'with_replies', type: 'bool', default: false, help: 'Also fetch reply rows for each top-level comment' },
    { name: 'reply_limit', type: 'int', default: 20, help: 'Maximum replies per page' },
    { name: 'reply_pages', type: 'int', default: 1, help: 'Maximum reply pages per top-level comment' },
    { name: 'comment_cursor_map', type: 'string', default: '', help: 'JSON map of work ID to creator comment cursor' },
    { name: 'reply_cursor_map', type: 'string', default: '', help: 'JSON map of comment ID to creator reply cursor' },
    { name: 'danmaku_offset_map', type: 'string', default: '', help: 'JSON map of work ID to creator danmaku offset' },
    { name: 'metadata_only', type: 'bool', default: false, help: 'Only fetch creator work metadata, skip comment and danmaku details' },
    { name: 'work_ids', type: 'string', default: '', help: 'JSON array or comma list of aweme_id/item_id values to keep' },
    { name: 'comment_work_ids', type: 'string', default: '', help: 'JSON array or comma list of aweme_id/item_id values to fetch comments for' },
    { name: 'danmaku_work_ids', type: 'string', default: '', help: 'JSON array or comma list of aweme_id/item_id values to fetch danmaku for' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after each page load' },
  ],
  notes: [
    '先抓作品管理列表，再抓评论管理页和弹幕管理页作品列表。',
    '评论管理页的作品 ID 可能是签名 ID，汇总时按 aweme_id / item_id_plain 尽量关联。',
    '弹幕管理页按作品顺序映射 item_id，再补抓对应弹幕列表。',
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

function firstPositiveNumber(...values) {
  const fallback = firstNumber(...values);
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return fallback;
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

export function parseWorkIdSet(value) {
  if (!value) return new Set();
  if (Array.isArray(value)) return new Set(value.map((item) => firstNonEmpty(item)).filter(Boolean));
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return new Set(parsed.map((item) => firstNonEmpty(item)).filter(Boolean));
  } catch {
    // Fall through to comma-separated parsing.
  }
  return new Set(String(value).split(',').map((item) => firstNonEmpty(item)).filter(Boolean));
}

function targetCursorKey(target = {}) {
  return firstNonEmpty(target.aweme_id, target.item_id, target.title);
}

function buildCreatorWorkKeySet(work = {}) {
  return new Set([
    firstNonEmpty(work.aweme_id),
    firstNonEmpty(work.item_id),
  ].filter(Boolean));
}

function findMatchingWork(commentTarget = {}, works = []) {
  const targetKeys = new Set([
    firstNonEmpty(commentTarget.aweme_id),
    firstNonEmpty(commentTarget.item_id),
  ].filter(Boolean));
  return works.find((work) => {
    const workKeys = buildCreatorWorkKeySet(work);
    for (const key of targetKeys) {
      if (workKeys.has(key)) return true;
    }
    return false;
  }) || null;
}

function matchesWorkIds(target = {}, workIds = new Set()) {
  if (!workIds.size) return true;
  return [firstNonEmpty(target.aweme_id), firstNonEmpty(target.item_id)]
    .filter(Boolean)
    .some((key) => workIds.has(key));
}

export function filterCreatorTargetsByWorkIds(targets = [], workIds = new Set()) {
  if (!workIds.size) return targets;
  return targets.filter((target) => matchesWorkIds(target, workIds));
}

function initialCreatorWorkRow(work = {}) {
  return {
    ...work,
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    comments: [],
    danmaku: [],
    creator_comment_item_id: '',
    creator_comment_aweme_id: '',
    creator_comment_count: 0,
    creator_comment_target_has_more: false,
    creator_comment_target_next_cursor: '',
    creator_danmaku_item_id: '',
    creator_danmaku_aweme_id: '',
    creator_danmaku_count: 0,
    creator_danmaku_target_has_more: false,
    creator_danmaku_target_next_cursor: '',
    creator_harvest_errors: [],
  };
}

function mergeCommentTargetIntoWork(work, commentTarget = {}) {
  if (!commentTarget?.item_id && !commentTarget?.aweme_id) return work;
  return {
    ...work,
    creator_comment_item_id: firstNonEmpty(commentTarget.item_id),
    creator_comment_aweme_id: firstNonEmpty(commentTarget.aweme_id),
    creator_comment_title: firstNonEmpty(commentTarget.title),
    creator_comment_count: Number(commentTarget.comment_count || 0),
    creator_comment_target_has_more: Boolean(commentTarget.creator_comment_target_has_more),
    creator_comment_target_next_cursor: firstNonEmpty(commentTarget.creator_comment_target_next_cursor),
  };
}

function mergeDanmakuTargetIntoWork(work, danmakuTarget = {}) {
  if (!danmakuTarget?.item_id && !danmakuTarget?.aweme_id) return work;
  const metrics = work?.metrics && typeof work.metrics === 'object' ? work.metrics : {};
  const creatorDanmakuCount = firstPositiveNumber(
    metrics.danmaku_count,
    metrics.bullet_count,
    danmakuTarget.danmaku_count,
    Array.isArray(work?.danmaku) ? work.danmaku.length : 0,
    work?.creator_danmaku_count,
  );
  return {
    ...work,
    creator_danmaku_item_id: firstNonEmpty(danmakuTarget.item_id),
    creator_danmaku_aweme_id: firstNonEmpty(danmakuTarget.aweme_id),
    creator_danmaku_title: firstNonEmpty(danmakuTarget.title),
    creator_danmaku_count: creatorDanmakuCount,
    creator_danmaku_target_has_more: Boolean(danmakuTarget.creator_danmaku_target_has_more),
    creator_danmaku_target_next_cursor: firstNonEmpty(danmakuTarget.creator_danmaku_target_next_cursor),
  };
}

export async function fetchDouyinCreatorHarvestRows(page, kwargs = {}) {
  const workLimit = normalizeDouyinVideoLimit(kwargs.work_limit ?? 20, 20);
  const commentWorkLimit = normalizeDouyinVideoLimit(kwargs.comment_work_limit ?? 5, 5);
  const commentLimit = normalizeDouyinCommentLimit(kwargs.comment_limit ?? 20, 20);
  const commentPages = normalizeDouyinPageLimit(kwargs.comment_pages ?? 1, 1);
  const danmakuWorkLimit = normalizeDouyinVideoLimit(kwargs.danmaku_work_limit ?? 5, 5);
  const danmakuLimit = normalizeDouyinCommentLimit(kwargs.danmaku_limit ?? 20, 20);
  const danmakuPages = normalizeDouyinPageLimit(kwargs.danmaku_pages ?? 1, 1);
  const replyLimit = normalizeDouyinCommentLimit(kwargs.reply_limit ?? kwargs.comment_limit ?? 20, 20);
  const replyPages = normalizeDouyinPageLimit(kwargs.reply_pages ?? 1, 1);
  const withReplies = kwargs.with_replies === true || String(kwargs.with_replies ?? '').toLowerCase() === 'true';
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));
  const workCursor = String(kwargs.work_cursor ?? kwargs.cursor ?? '0');
  const commentWorkCursor = String(kwargs.comment_work_cursor ?? '0');
  const danmakuWorkCursor = String(kwargs.danmaku_work_cursor ?? '0');
  const commentCursorMap = parseJsonMap(kwargs.comment_cursor_map);
  const replyCursorMap = parseJsonMap(kwargs.reply_cursor_map);
  const danmakuOffsetMap = parseJsonMap(kwargs.danmaku_offset_map);
  const metadataOnly = kwargs.metadata_only === true || String(kwargs.metadata_only ?? '').toLowerCase() === 'true';
  const workIds = parseWorkIdSet(kwargs.work_ids);
  const hasCommentWorkIdFilter = kwargs.comment_work_ids !== undefined && String(kwargs.comment_work_ids || '').trim() !== '';
  const hasDanmakuWorkIdFilter = kwargs.danmaku_work_ids !== undefined && String(kwargs.danmaku_work_ids || '').trim() !== '';
  const commentWorkIds = parseWorkIdSet(kwargs.comment_work_ids);
  const danmakuWorkIds = parseWorkIdSet(kwargs.danmaku_work_ids);
  const commentTargetIds = hasCommentWorkIdFilter ? commentWorkIds : workIds;
  const danmakuTargetIds = hasDanmakuWorkIdFilter ? danmakuWorkIds : workIds;

  emitProgress({
    step: 'work-list-start',
    message: `开始扫描抖音创作者中心作品列表，目标 ${workLimit} 条`,
    total_works: workLimit,
  });
  const works = await fetchDouyinCreatorWorkRows(page, {
    limit: workLimit,
    cursor: workCursor,
    wait_seconds: waitSeconds,
  });
  emitProgress({
    step: 'work-list-complete',
    status: 'success',
    message: `作品列表扫描完成，拿到 ${works.length} 条作品`,
    work_rows: works.length,
    total_works: works.length,
  });

  const scopedWorks = filterCreatorTargetsByWorkIds(works, workIds);
  if (metadataOnly) {
    emitProgress({
      step: 'creator-harvest-complete',
      status: 'success',
      message: `抖音创作者中心元信息抓取完成：作品 ${scopedWorks.length}`,
      work_rows: scopedWorks.length,
      comment_rows: 0,
      danmaku_rows: 0,
    });
    return scopedWorks.map((work) => ({
      ...initialCreatorWorkRow(work),
      creator_harvest_summary: {
        work_count: scopedWorks.length,
        comment_target_count: 0,
        matched_comment_target_count: 0,
        failed_comment_target_count: 0,
        danmaku_target_count: 0,
        matched_danmaku_target_count: 0,
        failed_danmaku_target_count: 0,
      },
    }));
  }

  emitProgress({
    step: 'comment-target-start',
    message: `开始扫描评论管理作品列表，目标 ${commentWorkLimit} 个评论对象`,
    comment_target_count: commentWorkLimit,
  });
  const commentTargets = await fetchDouyinCreatorCommentTargets(page, {
    limit: commentWorkLimit,
    cursor: commentWorkCursor,
    wait_seconds: waitSeconds,
  });
  emitProgress({
    step: 'comment-target-complete',
    status: 'success',
    message: `评论对象扫描完成，拿到 ${commentTargets.length} 个对象`,
    comment_target_count: commentTargets.length,
  });

  emitProgress({
    step: 'danmaku-target-start',
    message: `开始扫描弹幕管理作品列表，目标 ${danmakuWorkLimit} 个弹幕对象`,
    danmaku_target_count: danmakuWorkLimit,
  });
  const danmakuTargets = await fetchDouyinCreatorDanmakuTargets(page, {
    limit: danmakuWorkLimit,
    cursor: danmakuWorkCursor,
    wait_seconds: waitSeconds,
  });
  emitProgress({
    step: 'danmaku-target-complete',
    status: 'success',
    message: `弹幕对象扫描完成，拿到 ${danmakuTargets.length} 个对象`,
    danmaku_target_count: danmakuTargets.length,
  });

  const rows = scopedWorks.map(initialCreatorWorkRow);

  const matchedCommentWorkIndexes = new Set();
  const matchedDanmakuWorkIndexes = new Set();
  const commentFailures = [];
  const danmakuFailures = [];

  const selectedCommentTargets = hasCommentWorkIdFilter && !commentTargetIds.size
    ? []
    : filterCreatorTargetsByWorkIds(commentTargets, commentTargetIds).slice(0, commentWorkLimit);
  for (const [targetIndex, target] of selectedCommentTargets.entries()) {
    const matchedWork = findMatchingWork(target, rows);
    const rowIndex = matchedWork ? rows.indexOf(matchedWork) : -1;
    emitProgress({
      step: 'comment-fetch-start',
      message: `开始抓评论 ${targetIndex + 1}/${selectedCommentTargets.length}：${firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品'}`,
      current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
      current_work_index: targetIndex + 1,
      total_works: selectedCommentTargets.length,
      comment_target_count: selectedCommentTargets.length,
    });
    try {
      const comments = await fetchDouyinCreatorCommentRows(page, {
        item_id: target.item_id,
        aweme_id: target.aweme_id,
        limit: commentLimit,
        pages: commentPages,
        cursor: commentCursorMap[targetCursorKey(target)] ?? '0',
        with_replies: withReplies,
        reply_limit: replyLimit,
        reply_pages: replyPages,
        reply_cursor_map: replyCursorMap,
        wait_seconds: waitSeconds,
        onProgress: (progress) => emitProgress({
          step: progress.step || 'comment-page',
          message: progress.message || '评论页已返回',
          current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
          current_work_index: targetIndex + 1,
          total_works: selectedCommentTargets.length,
          comment_page: Number(progress.pageNumber || 0),
          received_count: Number(progress.receivedCount || 0),
          accumulatedTopLevel: Number(progress.accumulatedTopLevel || 0),
          accumulatedReplies: Number(progress.accumulatedReplies || 0),
        }),
      });
      if (rowIndex >= 0) {
        rows[rowIndex] = {
          ...mergeCommentTargetIntoWork(rows[rowIndex], target),
          comments,
        };
        matchedCommentWorkIndexes.add(rowIndex);
      } else {
        rows.push({
          data_source: DOUYIN_SOURCE_CREATOR_CENTER,
          rank: rows.length + 1,
          aweme_id: firstNonEmpty(target.aweme_id),
          item_id: '',
          title: firstNonEmpty(target.title),
          desc: '',
          file_type: '',
          aweme_type: '',
          creator_type: '',
          visibility: '',
          status_value: '',
          create_time: firstNonEmpty(target.create_time),
          publish_time: firstNonEmpty(target.publish_time),
          cover_url: '',
          share_url: '',
          play_count: 0,
          digg_count: 0,
          comment_count: Number(target.comment_count || comments.length || 0),
          share_count: 0,
          collect_count: 0,
          metrics: {},
          danmaku: [],
          has_more: false,
          next_cursor: '',
          source_url_path: '',
          ...mergeCommentTargetIntoWork({}, target),
          comments,
          creator_harvest_errors: ['creator_comment_target_unmatched_to_work_list'],
        });
      }
      emitProgress({
        step: 'comment-fetch-complete',
        status: 'success',
        message: `评论抓取完成 ${targetIndex + 1}/${selectedCommentTargets.length}：${firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品'}，共 ${comments.length} 条`,
        current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
        current_work_index: targetIndex + 1,
        total_works: selectedCommentTargets.length,
        comment_rows: comments.length,
        matched_comment_target_count: matchedCommentWorkIndexes.size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      commentFailures.push({
        item_id: firstNonEmpty(target.item_id),
        aweme_id: firstNonEmpty(target.aweme_id),
        error: message,
      });
      if (rowIndex >= 0) {
        rows[rowIndex] = {
          ...mergeCommentTargetIntoWork(rows[rowIndex], target),
          creator_harvest_errors: [...(rows[rowIndex].creator_harvest_errors || []), message],
        };
        matchedCommentWorkIndexes.add(rowIndex);
      }
      emitProgress({
        step: 'comment-fetch-failed',
        status: 'warning',
        message: `评论抓取失败 ${targetIndex + 1}/${selectedCommentTargets.length}：${firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品'}，${message}`,
        current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
        current_work_index: targetIndex + 1,
        total_works: selectedCommentTargets.length,
        failed_comment_target_count: commentFailures.length,
      });
    }
  }

  const selectedDanmakuTargets = hasDanmakuWorkIdFilter && !danmakuTargetIds.size
    ? []
    : filterCreatorTargetsByWorkIds(danmakuTargets, danmakuTargetIds).slice(0, danmakuWorkLimit);
  for (const [targetIndex, target] of selectedDanmakuTargets.entries()) {
    const matchedWork = findMatchingWork(target, rows);
    const rowIndex = matchedWork ? rows.indexOf(matchedWork) : -1;
    emitProgress({
      step: 'danmaku-fetch-start',
      message: `开始抓弹幕 ${targetIndex + 1}/${selectedDanmakuTargets.length}：${firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品'}`,
      current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
      current_work_index: targetIndex + 1,
      total_works: selectedDanmakuTargets.length,
      danmaku_target_count: selectedDanmakuTargets.length,
    });
    try {
      const danmaku = await fetchDouyinCreatorDanmakuRows(page, {
        item_id: target.item_id,
        limit: danmakuLimit,
        pages: danmakuPages,
        offset: danmakuOffsetMap[targetCursorKey(target)] ?? 0,
        wait_seconds: waitSeconds,
        onProgress: (progress) => emitProgress({
          step: progress.step || 'danmaku-page',
          message: progress.message || '弹幕页已返回',
          current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
          current_work_index: targetIndex + 1,
          total_works: selectedDanmakuTargets.length,
          danmaku_page: Number(progress.pageNumber || 0),
          received_count: Number(progress.receivedCount || 0),
          accumulatedRows: Number(progress.accumulatedRows || 0),
        }),
      });
      if (rowIndex >= 0) {
        rows[rowIndex] = {
          ...mergeDanmakuTargetIntoWork(rows[rowIndex], target),
          danmaku,
        };
        matchedDanmakuWorkIndexes.add(rowIndex);
      } else {
        rows.push({
          data_source: DOUYIN_SOURCE_CREATOR_CENTER,
          rank: rows.length + 1,
          aweme_id: firstNonEmpty(target.aweme_id),
          item_id: '',
          title: firstNonEmpty(target.title),
          desc: '',
          file_type: '',
          aweme_type: '',
          creator_type: '',
          visibility: '',
          status_value: '',
          create_time: firstNonEmpty(target.create_time),
          publish_time: firstNonEmpty(target.publish_time),
          cover_url: '',
          share_url: '',
          play_count: 0,
          digg_count: 0,
          comment_count: 0,
          share_count: 0,
          collect_count: 0,
          metrics: {},
          comments: [],
          has_more: false,
          next_cursor: '',
          source_url_path: '',
          ...mergeDanmakuTargetIntoWork({}, target),
          danmaku,
          creator_harvest_errors: ['creator_danmaku_target_unmatched_to_work_list'],
        });
      }
      emitProgress({
        step: 'danmaku-fetch-complete',
        status: 'success',
        message: `弹幕抓取完成 ${targetIndex + 1}/${selectedDanmakuTargets.length}：${firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品'}，共 ${danmaku.length} 条`,
        current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
        current_work_index: targetIndex + 1,
        total_works: selectedDanmakuTargets.length,
        danmaku_rows: danmaku.length,
        matched_danmaku_target_count: matchedDanmakuWorkIndexes.size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      danmakuFailures.push({
        item_id: firstNonEmpty(target.item_id),
        aweme_id: firstNonEmpty(target.aweme_id),
        error: message,
      });
      if (rowIndex >= 0) {
        rows[rowIndex] = {
          ...mergeDanmakuTargetIntoWork(rows[rowIndex], target),
          creator_harvest_errors: [...(rows[rowIndex].creator_harvest_errors || []), message],
        };
        matchedDanmakuWorkIndexes.add(rowIndex);
      }
      emitProgress({
        step: 'danmaku-fetch-failed',
        status: 'warning',
        message: `弹幕抓取失败 ${targetIndex + 1}/${selectedDanmakuTargets.length}：${firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品'}，${message}`,
        current_work: firstNonEmpty(target.title, target.aweme_id, target.item_id) || '未命名作品',
        current_work_index: targetIndex + 1,
        total_works: selectedDanmakuTargets.length,
        failed_danmaku_target_count: danmakuFailures.length,
      });
    }
  }

  const totalComments = rows.reduce((sum, row) => sum + (Array.isArray(row.comments) ? row.comments.length : 0), 0);
  const totalDanmaku = rows.reduce((sum, row) => sum + (Array.isArray(row.danmaku) ? row.danmaku.length : 0), 0);
  emitProgress({
    step: 'creator-harvest-complete',
    status: commentFailures.length || danmakuFailures.length ? 'warning' : 'success',
    message: `抖音创作者中心抓取完成：作品 ${rows.length}，评论 ${totalComments}，弹幕 ${totalDanmaku}`,
    work_rows: rows.length,
    comment_rows: totalComments,
    danmaku_rows: totalDanmaku,
    failed_comment_target_count: commentFailures.length,
    failed_danmaku_target_count: danmakuFailures.length,
  });

  return rows.map((row) => ({
    ...row,
    creator_harvest_summary: {
      work_count: works.length,
      comment_target_count: commentTargets.length,
      matched_comment_target_count: matchedCommentWorkIndexes.size,
      failed_comment_target_count: commentFailures.length,
      danmaku_target_count: danmakuTargets.length,
      matched_danmaku_target_count: matchedDanmakuWorkIndexes.size,
      failed_danmaku_target_count: danmakuFailures.length,
    },
  }));
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-harvest',
    description: douyinCreatorHarvestSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: 'https://creator.douyin.com/creator-micro/home',
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 1200,
    args: douyinCreatorHarvestSpec.args,
    func: async (page, kwargs) => fetchDouyinCreatorHarvestRows(page, kwargs),
  });
}
