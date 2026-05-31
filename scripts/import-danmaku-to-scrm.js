#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  attachAccountIdToPayload,
  resolveImportAccountId,
  resolveAccountProfilePath,
} from './lib/account-context.js';
import { applyIntentionAnalysis } from './lib/intention-classifier.js';
import {
  ensureTableIndex,
  ensureDatetimeText,
  ensureInt,
  ensureText,
  nowDatetimeText,
  openConnection,
  resolveInputPath,
  ROOT_DIR,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, scrmMediaConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import { buildMediaStartSummary, materializeScrmPayloadMedia } from './lib/scrm-media.js';

export const PLATFORM = 'weixin-channels';
export const DANMAKU_PLATFORMS = {
  'weixin-channels': {
    platform: 'weixin-channels',
    originType: 1,
    inputFilenames: ['danmaku-flat.json'],
  },
  douyin: {
    platform: 'douyin',
    originType: 2,
    inputFilenames: ['creator-harvest.json', 'danmaku-flat.json'],
  },
};
const DANMAKU_TABLE_NAME = 'scrm_danmaku';
const DANMAKU_COLUMNS = [
  ['danmaku_id', 'danmaku_id'],
  ['origin_type', 'origin_type'],
  ['account_id', 'account_id'],
  ['no', 'work_no'],
  ['comment_user_name', 'comment_user_name'],
  ['comment_user_photo', 'comment_user_photo'],
  ['content', 'content'],
  ['intention', 'intention'],
  ['video_timestamp_ms', 'video_timestamp_ms'],
  ['video_timestamp_text', 'video_timestamp_text'],
  ['status', 'status'],
  ['created_at', 'created_at'],
];

function ensureDanmakuDatetimeText(value) {
  const text = ensureDatetimeText(value);
  if (!text) throw new Error('created_at/time must not be empty');
  return text;
}

function formatVideoTimestampText(totalMs) {
  const safeMs = Math.max(0, ensureInt(totalMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((value) => String(value).padStart(2, '0'));
  if (hours > 0) parts.unshift(String(hours).padStart(2, '0'));
  return parts.join(':');
}

function parseVideoTimestampMs(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Math.max(0, Math.trunc(value));
  const text = ensureText(value);
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Math.max(0, Number.parseInt(text, 10));

  const parts = text.split(':').map((item) => item.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || parts.some((item) => !/^\d+$/.test(item))) return 0;
  const nums = parts.map((item) => Number.parseInt(item, 10));
  if (parts.length === 2) {
    const [minutes, seconds] = nums;
    return (minutes * 60 + seconds) * 1000;
  }
  const [hours, minutes, seconds] = nums;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function pickText(row, keys, maxLen = undefined) {
  for (const key of keys) {
    const value = ensureText(row[key], maxLen);
    if (value) return value;
  }
  return '';
}

function normalizeComparableMinute(value) {
  const text = ensureText(value).replace(/\//g, '-').replace('T', ' ');
  if (!text) return '';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return text.slice(0, 16);
}

function normalizeCoverUrlKey(value) {
  const text = ensureText(value, 2048);
  if (!text) return '';
  try {
    const url = new URL(text);
    const stable = new URLSearchParams();
    for (const key of ['m', 'idx', 'picformat', 'scene']) {
      const current = url.searchParams.get(key);
      if (current) stable.set(key, current);
    }
    const suffix = stable.toString();
    return `${url.origin}${url.pathname}${suffix ? `?${suffix}` : ''}`;
  } catch {
    return text.split('&token=')[0];
  }
}

function loadJsonArrayIfExists(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function createEmptyWorkIndexMaps() {
  return {
    byTitleMinute: new Map(),
    byCoverKey: new Map(),
    byTitle: new Map(),
  };
}

function appendWorkIndexRows(index, rows = []) {
  for (const row of rows) {
    const objectId = pickText(row, ['object_id', 'export_id', 'objectId', 'exportId'], 128);
    const title = pickText(row, ['title', 'video_title'], 500);
    if (!objectId || !title) continue;
    const candidate = {
      object_id: objectId,
      title,
      publish_minute: normalizeComparableMinute(pickText(row, ['publish_time', 'video_publish_time', 'public_at'], 32)),
      cover_key: normalizeCoverUrlKey(pickText(row, ['cover_url', 'video_cover_url', 'front_img_url'], 2048)),
    };
    if (candidate.publish_minute) index.byTitleMinute.set(`${candidate.title}\0${candidate.publish_minute}`, candidate.object_id);
    if (candidate.cover_key) index.byCoverKey.set(candidate.cover_key, candidate.object_id);
    const existing = index.byTitle.get(candidate.title) || new Set();
    existing.add(candidate.object_id);
    index.byTitle.set(candidate.title, existing);
  }
  return index;
}

function workIndexCacheKey(rootDir = ROOT_DIR, workIndexPath = '') {
  return `${path.resolve(rootDir)}\0${path.resolve(workIndexPath || '.')}`;
}

const cachedWeixinWorkIndexByKey = new Map();

function buildWeixinSampleWorkIndex(rootDir = ROOT_DIR, workIndexPath = '') {
  const cacheKey = workIndexCacheKey(rootDir, workIndexPath);
  if (cachedWeixinWorkIndexByKey.has(cacheKey)) return cachedWeixinWorkIndexByKey.get(cacheKey);
  const index = createEmptyWorkIndexMaps();
  if (workIndexPath && fs.existsSync(workIndexPath)) {
    appendWorkIndexRows(index, loadJsonArrayIfExists(workIndexPath));
  }
  const sampleRoot = path.join(rootDir, 'samples', 'weixin-channels');
  const dateDirs = fs.existsSync(sampleRoot)
    ? fs.readdirSync(sampleRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  for (const dateDir of dateDirs) {
    for (const filename of ['work-index.json', 'posts.json', 'image-texts.json', 'harvest.json']) {
      if (filename === 'work-index.json' && workIndexPath && path.resolve(sampleRoot, dateDir, filename) === path.resolve(workIndexPath)) continue;
      appendWorkIndexRows(index, loadJsonArrayIfExists(path.join(sampleRoot, dateDir, filename)));
    }
  }
  cachedWeixinWorkIndexByKey.set(cacheKey, index);
  return index;
}

export function resolveDanmakuWorkIndexPath(inputPath = '', explicitPath = '') {
  if (explicitPath) return path.resolve(explicitPath);
  if (inputPath) return path.join(path.dirname(path.resolve(inputPath)), 'work-index.json');
  return '';
}

function isSyntheticDanmakuWorkNo(value) {
  const text = ensureText(value, 128);
  return !text || /^wxvcv_/i.test(text);
}

function resolveWeixinDanmakuWorkNo(row, rootDir = ROOT_DIR, workIndexPath = '') {
  const explicitIds = ['work_no', 'video_no', 'export_id', 'exportId', 'object_id', 'objectId']
    .map((key) => pickText(row, [key], 128))
    .filter(Boolean);
  const trustedId = explicitIds.find((value) => !isSyntheticDanmakuWorkNo(value));
  if (trustedId) return trustedId;

  const current = explicitIds[0] || '';
  const title = pickText(row, ['video_title', 'title'], 500);
  const publishMinute = normalizeComparableMinute(pickText(row, ['video_publish_time', 'publish_time', 'public_at'], 32));
  const coverKey = normalizeCoverUrlKey(pickText(row, ['video_cover_url', 'cover_url', 'front_img_url'], 2048));
  const index = buildWeixinSampleWorkIndex(rootDir, workIndexPath);
  if (coverKey && index.byCoverKey.has(coverKey)) return index.byCoverKey.get(coverKey);
  if (title && publishMinute && index.byTitleMinute.has(`${title}\0${publishMinute}`)) return index.byTitleMinute.get(`${title}\0${publishMinute}`);
  const titleMatches = title ? Array.from(index.byTitle.get(title) || []) : [];
  if (titleMatches.length === 1) return titleMatches[0];
  return current;
}

export function enrichDanmakuRows(rows, { platform = PLATFORM, rootDir = ROOT_DIR, workIndexPath = '' } = {}) {
  if (!Array.isArray(rows)) return [];
  if (platform === 'douyin') {
    const flattened = [];
    for (const row of rows) {
      const awemeId = pickText(row, ['aweme_id', 'video_no', 'work_no'], 128);
      const workDanmaku = Array.isArray(row?.danmaku) ? row.danmaku : null;
      if (!workDanmaku) {
        flattened.push({ ...row });
        continue;
      }
      for (const item of workDanmaku) {
        flattened.push({
          ...item,
          aweme_id: pickText(item, ['aweme_id'], 128) || awemeId,
          work_no: pickText(item, ['work_no', 'video_no'], 128) || awemeId,
          video_no: pickText(item, ['video_no', 'work_no'], 128) || awemeId,
          comment_user_name: pickText(item, ['comment_user_name', 'author'], 128),
          comment_user_photo: pickText(item, ['comment_user_photo', 'avatar_url'], 1024),
          content: pickText(item, ['content', 'text'], 1024),
          video_timestamp_text: pickText(item, ['video_timestamp_text', 'video_time'], 32),
          video_timestamp_ms: item.video_timestamp_ms ?? (ensureInt(item.video_position_seconds) > 0 ? ensureInt(item.video_position_seconds) * 1000 : undefined),
          created_at: pickText(item, ['created_at', 'time', 'create_time'], 19),
        });
      }
    }
    return flattened;
  }
  if (platform !== 'weixin-channels') return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const resolvedWorkNo = resolveWeixinDanmakuWorkNo(row, rootDir, workIndexPath);
    if (isSyntheticDanmakuWorkNo(resolvedWorkNo)) return { ...row };
    return {
      ...row,
      video_no: resolvedWorkNo,
      work_no: resolvedWorkNo,
      export_id: resolvedWorkNo,
      object_id: resolvedWorkNo,
    };
  });
}

export function loadRows(inputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${inputPath} did not contain a JSON array.`);
  return data;
}

export function getDanmakuPlatform(platform = PLATFORM) {
  const key = ensureText(platform) || PLATFORM;
  const config = DANMAKU_PLATFORMS[key];
  if (!config) throw new Error(`Unsupported danmaku platform: ${key}`);
  return config;
}

function resolveDatedInputPath(rootDir, platform, dateArg, filenames) {
  const samplesDir = path.join(rootDir, 'samples', platform);
  if (dateArg) {
    const baseDir = path.resolve(samplesDir, dateArg);
    for (const filename of filenames) {
      const candidate = path.resolve(baseDir, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const datedDirs = fs.readdirSync(samplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!datedDirs.length) throw new Error(`No dated sample directories found under ${samplesDir}`);
  for (const dateDir of datedDirs) {
    const baseDir = path.resolve(samplesDir, dateDir);
    for (const filename of filenames) {
      const candidate = path.resolve(baseDir, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const requestedScope = dateArg ? `${samplesDir}/${dateArg}` : samplesDir;
  throw new Error(`No sample input found for ${platform} under ${requestedScope}; looked for: ${filenames.join(', ')}`);
}

export function resolveDanmakuInputPath(inputArg, dateArg, platform = PLATFORM, rootDir = ROOT_DIR) {
  if (inputArg) return path.resolve(inputArg);
  const platformConfig = getDanmakuPlatform(platform);
  return resolveDatedInputPath(rootDir, platformConfig.platform, dateArg, platformConfig.inputFilenames || ['danmaku-flat.json']);
}

export async function buildPayload(rows, {
  limit = 0,
  classifier = undefined,
  skipIntention = false,
  platform = PLATFORM,
  now = new Date(),
  rootDir = ROOT_DIR,
  workIndexPath = '',
} = {}) {
  const platformConfig = getDanmakuPlatform(platform);
  const nowText = nowDatetimeText(now);
  const enrichedRows = enrichDanmakuRows(rows, { platform, rootDir, workIndexPath });
  const sourceRows = limit > 0 ? enrichedRows.slice(0, limit) : enrichedRows;
  const records = [];
  const warnings = [];

  for (const row of sourceRows) {
    const danmakuId = pickText(row, ['danmaku_id', 'danmakuId'], 128);
    const workNo = pickText(row, ['work_no', 'video_no', 'export_id', 'exportId', 'object_id', 'objectId'], 128);
    const content = pickText(row, ['content', 'text'], 1024);
    const userName = pickText(row, ['comment_user_name', 'sender_name', 'author', 'nickname', 'user_name'], 128) || null;
    const userPhoto = pickText(row, ['comment_user_photo', 'sender_avatar_url', 'avatar_url', 'head_img_url', 'headImgUrl', 'user_avatar_url'], 1024) || null;
    const rawTimestampText = pickText(row, ['video_timestamp_text', 'videoTimestampText', 'video_timestamp', 'frame_time'], 16);
    const rawTimestampMs = row.video_timestamp_ms ?? row.videoTimestampMs ?? row.video_timestamp_milliseconds;
    const videoTimestampMs = rawTimestampMs !== undefined && rawTimestampMs !== null && rawTimestampMs !== ''
      ? parseVideoTimestampMs(rawTimestampMs)
      : parseVideoTimestampMs(rawTimestampText);
    const videoTimestampText = rawTimestampText || formatVideoTimestampText(videoTimestampMs);
    const createdAt = pickText(row, ['created_at', 'time', 'create_time', 'createTime'], 19) || nowText;
    const intention = row.intention === undefined || row.intention === null || row.intention === '' ? 0 : ensureInt(row.intention);

    if (!danmakuId) {
      warnings.push(`Skipped row without danmaku_id: work_no=${workNo || '(empty)'}`);
      continue;
    }
    if (!workNo) {
      warnings.push(`Skipped danmaku ${danmakuId} without work_no/export_id`);
      continue;
    }
    if (!content) {
      warnings.push(`Skipped danmaku ${danmakuId} without content/text`);
      continue;
    }
    if (ensureText(row.content ?? row.text).length > 1024) warnings.push(`Danmaku ${danmakuId} content exceeded 1024 and was truncated.`);
    if (!pickText(row, ['created_at', 'time', 'create_time', 'createTime'], 19)) warnings.push(`Danmaku ${danmakuId} missing time; used import time.`);

    records.push({
      danmaku_id: danmakuId,
      origin_type: platformConfig.originType,
      work_no: workNo,
      comment_user_name: userName,
      comment_user_photo: userPhoto,
      content,
      intention,
      video_timestamp_ms: videoTimestampMs,
      video_timestamp_text: videoTimestampText,
      status: 1,
      created_at: ensureDanmakuDatetimeText(createdAt),
    });
  }

  if (skipIntention) {
    warnings.push('AI intention analysis skipped by --skip-intention; kept intention=0.');
  } else {
    warnings.push(...await applyIntentionAnalysis(records, {
      classifier,
      idKey: 'danmaku_id',
    }));
  }
  return { records, warnings };
}

export function danmakuUniqueKey(record) {
  return [ensureInt(record.origin_type), ensureText(record.danmaku_id)];
}

export function dedupeDanmaku(records) {
  const byKey = new Map();
  const anonymous = [];
  for (const record of records) {
    const [originType, danmakuId] = danmakuUniqueKey(record);
    if (!danmakuId) {
      anonymous.push(record);
      continue;
    }
    byKey.set(`${originType}\0${danmakuId}`, record);
  }
  return [...byKey.values(), ...anonymous];
}

export async function ensureDanmakuSchema(connection) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${DANMAKU_TABLE_NAME}`);
  const existingColumns = new Set(columns.map((row) => String(row.Field || '').trim()).filter(Boolean));
  if (!existingColumns.has('account_id')) {
    await connection.query(`ALTER TABLE ${DANMAKU_TABLE_NAME} ADD COLUMN account_id VARCHAR(191) NOT NULL DEFAULT '' COMMENT '账号唯一标识（抖音号 / 视频号ID 等平台公开账号标识）' AFTER origin_type`);
    existingColumns.add('account_id');
  }
  const requiredColumns = new Set(DANMAKU_COLUMNS.map(([column]) => column));
  const missingColumns = [...requiredColumns].filter((column) => !existingColumns.has(column)).sort();
  if (missingColumns.length) throw new Error(`Missing required ${DANMAKU_TABLE_NAME} columns: ${missingColumns.join(', ')}`);

  const [indexes] = await connection.query(`SHOW INDEX FROM ${DANMAKU_TABLE_NAME}`);
  const partsByKey = new Map();
  for (const row of indexes) {
    if (ensureInt(row.Non_unique) !== 0) continue;
    const parts = partsByKey.get(row.Key_name) ?? [];
    parts.push([ensureInt(row.Seq_in_index), ensureText(row.Column_name)]);
    partsByKey.set(row.Key_name, parts);
  }
  const uniqueColumns = new Set(Array.from(partsByKey.values())
    .map((parts) => parts.sort((left, right) => left[0] - right[0]).map(([, column]) => column).join(',')));
  const uniqueKey = 'origin_type,danmaku_id';
  if (!uniqueColumns.has(uniqueKey)) {
    throw new Error(`Missing required SCRM unique index: ${DANMAKU_TABLE_NAME}: UNIQUE(${uniqueKey})`);
  }
  await ensureTableIndex(connection, DANMAKU_TABLE_NAME, 'idx_origin_account', ['origin_type', 'account_id']);
  return DANMAKU_TABLE_NAME;
}

export function preview(payload, inputPath, apply, platform = PLATFORM) {
  const deduped = dedupeDanmaku(payload.records);
  const summary = {
    platform: getDanmakuPlatform(platform).platform,
    mode: apply ? 'apply' : 'dry-run',
    input: String(inputPath),
    danmaku_rows: payload.records.length,
    write_attempt_rows: deduped.length,
    warnings: payload.warnings,
    danmaku_example: deduped[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`IMPORT_SUMMARY ${JSON.stringify(summary)}`);
}

function buildDanmakuInsertSql(rowCount) {
  const columns = DANMAKU_COLUMNS;
  const dbColumns = columns.map(([column]) => column);
  const rowPlaceholder = `(${dbColumns.map(() => '?').join(', ')})`;
  const updates = dbColumns.filter((column) => !['danmaku_id', 'origin_type'].includes(column));
  return `
INSERT INTO ${DANMAKU_TABLE_NAME} (
  ${dbColumns.join(',\n  ')}
) VALUES
  ${Array.from({ length: rowCount }, () => rowPlaceholder).join(',\n  ')}
ON DUPLICATE KEY UPDATE
  ${updates.map((column) => `${column} = VALUES(${column})`).join(',\n  ')}
`;
}

function flattenRows(rows) {
  return rows.flatMap((row) => DANMAKU_COLUMNS.map(([, key]) => row[key] ?? null));
}

export async function applyImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await connection.beginTransaction();
    const tableName = await ensureDanmakuSchema(connection);
    const rows = dedupeDanmaku(payload.records);
    if (rows.length) {
      await connection.query(buildDanmakuInsertSql(rows.length), flattenRows(rows));
    }
    await connection.commit();
    return { tableName, write_attempt_rows: rows.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

function verificationSelectSql(tableName, placeholders) {
  return `
SELECT
  danmaku_id,
  origin_type,
  account_id,
  no,
  comment_user_name,
  comment_user_photo,
  content,
  intention,
  video_timestamp_ms,
  video_timestamp_text,
  status,
  created_at
FROM ${tableName}
WHERE (origin_type, danmaku_id) IN (${placeholders})
ORDER BY id ASC
`;
}

export async function verifyImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    const tableName = await ensureDanmakuSchema(connection);
    const [[totalRow]] = await connection.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
    const deduped = dedupeDanmaku(payload.records);
    if (!deduped.length) {
      return {
        table_name: tableName,
        total_rows: Number(totalRow.total || 0),
        payload_rows: payload.records.length,
        write_attempt_rows: 0,
        matched_rows: 0,
        records: [],
      };
    }
    const placeholders = deduped.map(() => '(?,?)').join(',');
    const params = deduped.map(danmakuUniqueKey).flat();
    const [records] = await connection.query(verificationSelectSql(tableName, placeholders), params);
    return {
      table_name: tableName,
      total_rows: Number(totalRow.total || 0),
      payload_rows: payload.records.length,
      write_attempt_rows: deduped.length,
      matched_rows: records.length,
      records,
    };
  } finally {
    await connection.end();
  }
}

export function parseArgs(argv) {
  const options = {
    input: '',
    workIndex: '',
    date: '',
    accountId: '',
    accountProfile: '',
    limit: 0,
    apply: false,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    platform: PLATFORM,
    skipIntention: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') options.input = argv[++i];
    else if (arg === '--work-index') options.workIndex = argv[++i];
    else if (arg === '--date') options.date = argv[++i];
    else if (arg === '--account-id') options.accountId = argv[++i];
    else if (arg === '--account-profile') options.accountProfile = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i] || 0);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--platform') options.platform = argv[++i];
    else if (arg === '--skip-intention') options.skipIntention = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/import-danmaku-to-scrm.js [options]

Options:
  --input PATH          Absolute or relative path to danmaku-flat.json or creator-harvest.json
  --work-index PATH     Absolute or relative path to work-index.json; default sibling of input
  --date YYYY-MM-DD     Use the platform default input under samples/<platform>/<date>/
  --account-id VALUE    Explicit real platform account_id for this import, not config alias like main
  --account-profile PATH
                        Explicit account-profile.json path for this import
  --limit N             Only import the first N rows
  --apply               Write into scrm_danmaku
  --platform NAME       Platform key, default weixin-channels; douyin reads creator-harvest.json by default
  --skip-intention      Skip AI intention analysis and keep intention=0 (dry-run only)
  --config PATH         Config file, default config.local.json
  --host HOST           MySQL host override
  --user USER           MySQL user override
  --password PASSWORD   MySQL password override
  --database DB         MySQL database override
`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.apply && options.skipIntention) {
    throw new Error('Refused to apply import with --skip-intention. Dry-run may skip AI intention analysis, but formal writes must attempt classification and only fall back to intention=0 on actual analysis failures.');
  }

  if (options.config) setConfigPath(options.config);
  const inputPath = resolveDanmakuInputPath(options.input, options.date, options.platform);
  const workIndexPath = resolveDanmakuWorkIndexPath(inputPath, options.workIndex);
  const rows = loadRows(inputPath);
  const accountProfilePath = resolveAccountProfilePath({
    platform: getDanmakuPlatform(options.platform).platform,
    inputPath,
    date: options.date,
    accountProfile: options.accountProfile,
  });
  const accountId = resolveImportAccountId({
    platform: getDanmakuPlatform(options.platform).platform,
    explicitAccountId: options.accountId,
    accountProfilePath,
    errorPrefix: `Could not resolve account_id for ${options.platform} danmaku import`,
  });
  const payload = attachAccountIdToPayload(await buildPayload(rows, {
    limit: options.limit,
    classifier: options.skipIntention ? null : undefined,
    skipIntention: options.skipIntention,
    platform: options.platform,
    rootDir: ROOT_DIR,
    workIndexPath,
  }), accountId);

  preview(payload, inputPath, options.apply, options.platform);
  if (!options.apply) return;

  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };

  const mediaPlatform = getDanmakuPlatform(options.platform).platform;
  const mediaConfig = scrmMediaConfigFromSettings();
  console.log(`MEDIA_START ${JSON.stringify(buildMediaStartSummary(mediaPlatform, mediaConfig))}`);
  const mediaResult = await materializeScrmPayloadMedia(payload, {
    platform: mediaPlatform,
    mediaConfig,
  });
  console.log(`MEDIA_SUMMARY ${JSON.stringify(mediaResult.summary)}`);
  await applyImport(dbConfig, payload);
  const verification = await verifyImport(dbConfig, payload);
  console.log(JSON.stringify(verification, null, 2));
  console.log(`IMPORT_VERIFICATION ${JSON.stringify(verification)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
