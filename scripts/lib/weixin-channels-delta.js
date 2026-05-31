import fs from 'node:fs';
import path from 'node:path';

import {
  ensureInt,
  ensureText,
  loadTableColumns,
  openConnection,
} from './scrm-base.js';

export const WEIXIN_CHANNELS_ORIGIN_TYPE = 1;

export function loadJsonArray(filePath, label = filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${label} must contain a JSON array.`);
  return data;
}

export function normalizeWeixinWork(row = {}) {
  return {
    object_id: ensureText(row.object_id || row.objectId || row.work_no || row.no, 128),
    title: ensureText(row.title, 500),
    comment_count: ensureInt(row.comment_count ?? row.count_comment),
    danmaku_count: ensureInt(row.danmaku_count ?? row.count_danmaku),
    like_count: ensureInt(row.like_count ?? row.count_like),
    share_count: ensureInt(row.share_count ?? row.count_share),
    publish_time: ensureText(row.publish_time || row.public_at),
    publish_timestamp: ensureText(row.publish_timestamp),
    raw: row,
  };
}

function dateValueOfWork(work = {}) {
  const timestamp = Number(work.publish_timestamp || 0);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  }
  const text = ensureText(work.publish_time);
  if (!text) return null;
  const parsed = new Date(text.replace(/\//g, '-').replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isRecentWork(work = {}, days = 0, now = new Date()) {
  const recentDays = ensureInt(days);
  if (recentDays <= 0) return false;
  const dateValue = dateValueOfWork(work);
  if (!dateValue) return false;
  return now.getTime() - dateValue.getTime() <= recentDays * 24 * 60 * 60 * 1000;
}

function uniqueWorkIds(works = []) {
  return [...new Set(works.map((work) => ensureText(work.object_id, 128)).filter(Boolean))];
}

function sqlPlaceholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query('SHOW TABLES LIKE ?', [tableName]);
  return rows.length > 0;
}

export async function loadWeixinChannelsDbBaseline(dbConfig, works = []) {
  const workIds = uniqueWorkIds(works);
  if (!workIds.length) return new Map();
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    const fileColumns = await loadTableColumns(connection, 'scrm_file');
    const hasUpdatedAt = fileColumns.has('updated_at');
    const hasCountDanmaku = fileColumns.has('count_danmaku');
    const hasDanmakuTable = await tableExists(connection, 'scrm_danmaku');
    const danmakuColumns = hasDanmakuTable ? await loadTableColumns(connection, 'scrm_danmaku') : new Set();
    const danmakuWorkColumn = danmakuColumns.has('work_no') ? 'work_no' : (danmakuColumns.has('no') ? 'no' : '');
    const groupColumns = ['f.no', 'f.origin_type', 'f.account_id', 'f.count_comment'];
    if (hasCountDanmaku) groupColumns.push('f.count_danmaku');
    if (hasUpdatedAt) groupColumns.push('f.updated_at');
    const [rows] = await connection.query(`
SELECT
  f.no AS work_no,
  f.origin_type,
  f.account_id,
  f.count_comment,
  ${hasCountDanmaku ? 'f.count_danmaku' : '0 AS count_danmaku'},
  ${hasUpdatedAt ? 'f.updated_at' : 'NULL AS updated_at'},
  (SELECT COUNT(c.id) FROM scrm_comment c WHERE c.no = f.no AND c.origin_type = f.origin_type) AS total_comment_rows,
  (SELECT COUNT(c.id) FROM scrm_comment c WHERE c.no = f.no AND c.origin_type = f.origin_type AND c.parent_comment_id = '') AS top_level_comment_rows,
  (SELECT COUNT(c.id) FROM scrm_comment c WHERE c.no = f.no AND c.origin_type = f.origin_type AND c.parent_comment_id <> '') AS reply_comment_rows,
  ${hasDanmakuTable && danmakuWorkColumn ? `(SELECT COUNT(d.id) FROM scrm_danmaku d WHERE CONVERT(d.${danmakuWorkColumn} USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(f.no USING utf8mb4) COLLATE utf8mb4_unicode_ci AND d.origin_type = f.origin_type)` : '0'} AS danmaku_rows
FROM scrm_file f
WHERE f.origin_type = ?
  AND f.no IN (${sqlPlaceholders(workIds.length)})
GROUP BY ${groupColumns.join(', ')}
`, [WEIXIN_CHANNELS_ORIGIN_TYPE, ...workIds]);
    return new Map(rows.map((row) => [ensureText(row.work_no, 128), {
      work_no: ensureText(row.work_no, 128),
      origin_type: ensureInt(row.origin_type),
      account_id: ensureText(row.account_id, 191),
      count_comment: ensureInt(row.count_comment),
      count_danmaku: ensureInt(row.count_danmaku),
      updated_at: row.updated_at ? String(row.updated_at) : '',
      total_comment_rows: ensureInt(row.total_comment_rows),
      top_level_comment_rows: ensureInt(row.top_level_comment_rows),
      reply_comment_rows: ensureInt(row.reply_comment_rows),
      danmaku_rows: ensureInt(row.danmaku_rows),
    }]));
  } finally {
    await connection.end();
  }
}

export function buildWeixinChannelsDeltaPlan({
  works = [],
  baselineByWorkId = new Map(),
  recentRecheckDays = 0,
  now = new Date(),
} = {}) {
  const normalizedWorks = works.map(normalizeWeixinWork).filter((work) => work.object_id);
  const changedWorks = [];
  const unchangedWorks = [];

  for (const work of normalizedWorks) {
    const baseline = baselineByWorkId.get(work.object_id) || null;
    const commentReasons = [];
    const danmakuReasons = [];
    const recent = isRecentWork(work, recentRecheckDays, now);
    if (!baseline) {
      if (work.comment_count > 0 || recent) commentReasons.push('new_work');
      if (work.danmaku_count > 0 || recent) danmakuReasons.push('new_work');
    } else {
      if (work.comment_count > ensureInt(baseline.count_comment)) commentReasons.push('comment_count_increased');
      if (work.comment_count > 0 && recent) commentReasons.push('recent_work_recheck');
      if (work.danmaku_count > ensureInt(baseline.count_danmaku)) danmakuReasons.push('danmaku_count_increased');
      if (work.danmaku_count > 0 && ensureInt(baseline.danmaku_rows) === 0) danmakuReasons.push('missing_danmaku_details');
      if (work.danmaku_count > 0 && ensureInt(baseline.danmaku_rows) < Math.min(work.danmaku_count, ensureInt(baseline.count_danmaku))) {
        danmakuReasons.push('db_danmaku_rows_below_baseline_count');
      }
      if (work.danmaku_count > 0 && recent) danmakuReasons.push('recent_work_recheck');
    }
    const reasons = [...new Set([...commentReasons, ...danmakuReasons])];

    const item = {
      object_id: work.object_id,
      title: work.title,
      current: {
        comment_count: work.comment_count,
        danmaku_count: work.danmaku_count,
        like_count: work.like_count,
        share_count: work.share_count,
        publish_time: work.publish_time,
      },
      baseline,
      reasons,
      comment_reasons: commentReasons,
      danmaku_reasons: danmakuReasons,
      should_fetch_comments: commentReasons.length > 0,
      should_fetch_danmaku: danmakuReasons.length > 0,
    };
    if (reasons.length > 0) changedWorks.push(item);
    else unchangedWorks.push(item);
  }

  return {
    generated_at: now.toISOString(),
    platform: 'weixin-channels',
    baseline_source: 'database',
    recent_recheck_days: ensureInt(recentRecheckDays),
    totals: {
      works: normalizedWorks.length,
      changed_works: changedWorks.length,
      unchanged_works: unchangedWorks.length,
      comment_works: changedWorks.filter((work) => work.should_fetch_comments).length,
      danmaku_works: changedWorks.filter((work) => work.should_fetch_danmaku).length,
    },
    work_ids: changedWorks.map((work) => work.object_id),
    comment_work_ids: changedWorks.filter((work) => work.should_fetch_comments).map((work) => work.object_id),
    danmaku_work_ids: changedWorks.filter((work) => work.should_fetch_danmaku).map((work) => work.object_id),
    changed_works: changedWorks,
    unchanged_works: unchangedWorks,
  };
}

export function writeDeltaPlan(filePath, plan) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}
