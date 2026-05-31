import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { ROOT_DIR } from './runtime-config.js';

export { ROOT_DIR };

export const WORK_COLUMNS = [
  ['no', 'work_no'],
  ['origin_type', 'origin_type'],
  ['account_id', 'account_id'],
  ['duration', 'duration'],
  ['title', 'title'],
  ['front_img_url', 'front_img_url'],
  ['share_url', 'share_url'],
  ['count_collect', 'count_collect'],
  ['count_comment', 'count_comment'],
  ['count_play', 'count_play'],
  ['count_like', 'count_like'],
  ['count_fav', 'count_fav'],
  ['count_share', 'count_share'],
  ['public_at', 'public_at'],
  ['status', 'status'],
  ['created_at', 'created_at'],
  ['file_type', 'file_type'],
];
export const WORK_DANMAKU_COLUMNS = [
  ['count_danmaku', 'count_danmaku'],
];

export const COMMENT_COLUMNS = [
  ['comment_id', 'comment_id'],
  ['origin_type', 'origin_type'],
  ['account_id', 'account_id'],
  ['comment_user_name', 'comment_user_name'],
  ['comment_user_photo', 'comment_user_photo'],
  ['content', 'content'],
  ['intention', 'intention'],
  ['no', 'work_no'],
  ['parent_comment_id', 'parent_comment_id'],
  ['root_parent_id', 'root_parent_id'],
  ['reply_to', 'reply_to'],
  ['reply_to_comment_id', 'reply_to_comment_id'],
  ['ip_location', 'ip_location'],
  ['count_agree', 'count_agree'],
  ['status', 'status'],
  ['created_at', 'created_at'],
];

export const FILE_SCHEMA_COLUMNS = {
  account_id: "ALTER TABLE scrm_file ADD COLUMN account_id VARCHAR(191) NOT NULL DEFAULT '' COMMENT '账号唯一标识（抖音号 / 视频号ID 等平台公开账号标识）' AFTER origin_type",
  share_url: "ALTER TABLE scrm_file ADD COLUMN share_url VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '平台分享短链 / 视频链接' AFTER front_img_url",
};

export const COMMENT_SCHEMA_COLUMNS = {
  ip_location: "ALTER TABLE scrm_comment ADD COLUMN ip_location VARCHAR(128) NOT NULL DEFAULT '' AFTER reply_to_comment_id",
  origin_type: 'ALTER TABLE scrm_comment ADD COLUMN origin_type TINYINT NOT NULL DEFAULT 0 AFTER no',
  account_id: "ALTER TABLE scrm_comment ADD COLUMN account_id VARCHAR(191) NOT NULL DEFAULT '' COMMENT '账号唯一标识（抖音号 / 视频号ID 等平台公开账号标识）' AFTER origin_type",
};

export const REQUIRED_UNIQUE_INDEXES = {
  scrm_file: [['no', 'origin_type']],
  scrm_comment: [['origin_type', 'comment_id']],
};

export function ensureText(value, maxLen = undefined) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return maxLen === undefined || text.length <= maxLen ? text : text.slice(0, maxLen);
}

export function ensureInt(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number.parseInt(Number(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ensureDatetimeText(value) {
  const text = ensureText(value);
  if (!text) return null;
  if (/^\d{10}$/.test(text)) return nowDatetimeText(new Date(Number(text) * 1000));
  if (/^\d{13}$/.test(text)) return nowDatetimeText(new Date(Number(text)));
  let normalized = text.replace(/\//g, '-').replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    normalized = `${normalized}:00`;
  }
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`Invalid datetime text: ${text}`);
  }
  return normalized;
}

export function nowDatetimeText(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(':');
}

export function loadHarvestRows(inputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${inputPath} did not contain a JSON array.`);
  return data;
}

export function resolveInputPath(rootDir, platform, inputArg, dateArg, filename = 'harvest.json') {
  const samplesDir = path.join(rootDir, 'samples', platform);
  if (inputArg) return path.resolve(inputArg);
  if (dateArg) return path.resolve(samplesDir, dateArg, filename);
  const datedDirs = fs.readdirSync(samplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!datedDirs.length) throw new Error(`No dated sample directories found under ${samplesDir}`);
  return path.resolve(samplesDir, datedDirs[datedDirs.length - 1], filename);
}

export function buildPayloadWorkReport(payload) {
  const commentStats = new Map();
  for (const work of payload.works) {
    commentStats.set(work.work_no, { top_level_comments: 0, reply_comments: 0 });
  }
  for (const comment of payload.comments) {
    const workNo = comment.work_no;
    const stats = commentStats.get(workNo) ?? { top_level_comments: 0, reply_comments: 0 };
    if (ensureText(comment.parent_comment_id)) stats.reply_comments += 1;
    else stats.top_level_comments += 1;
    commentStats.set(workNo, stats);
  }
  const workMap = new Map(payload.works.map((work) => [work.work_no, work]));
  return Array.from(commentStats.entries()).map(([workNo, stats]) => {
    const work = workMap.get(workNo) ?? {};
    return {
      work_no: workNo,
      title: work.title || '',
      top_level_comments: stats.top_level_comments,
      reply_comments: stats.reply_comments,
      total_comment_rows: stats.top_level_comments + stats.reply_comments,
      count_comment_field: work.count_comment || 0,
      count_share_field: work.count_share || 0,
    };
  });
}

export async function ensureTableIndex(connection, tableName, keyName, columns) {
  const existing = await loadUniqueIndexColumns(connection, tableName);
  const [rows] = await connection.query(`SHOW INDEX FROM ${tableName}`);
  const existingByName = new Map();
  for (const row of rows) {
    const currentKeyName = ensureText(row.Key_name);
    const currentColumn = ensureText(row.Column_name);
    if (!currentKeyName || !currentColumn) continue;
    const parts = existingByName.get(currentKeyName) ?? [];
    parts.push([ensureInt(row.Seq_in_index), currentColumn]);
    existingByName.set(currentKeyName, parts);
  }
  const target = columns.join(',');
  if (Array.from(existing.values()).some((value) => value.join(',') === target)) return;
  if (existingByName.has(keyName)) return;
  const quotedColumns = columns.map((column) => `\`${column}\``).join(', ');
  await connection.query(`ALTER TABLE ${tableName} ADD KEY ${keyName} (${quotedColumns})`);
}

export function preview(payload, inputPath, apply, platform) {
  const summary = {
    platform,
    mode: apply ? 'apply' : 'dry-run',
    input: String(inputPath),
    work_rows: payload.works.length,
    comment_rows: payload.comments.length,
    warnings: payload.warnings,
    work_report: buildPayloadWorkReport(payload),
    work_example: payload.works[0] || null,
    comment_example: payload.comments[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`IMPORT_SUMMARY ${JSON.stringify(summary)}`);
}

export async function openConnection(host, user, password, database) {
  const missing = Object.entries({ host, user, password, database })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`Missing DB connection fields: ${missing.join(', ')}`);
  return mysql.createConnection({
    host,
    user,
    password,
    database,
    charset: 'utf8mb4',
    namedPlaceholders: false,
  });
}

function buildBulkInsertSql(tableName, columns, updateColumns) {
  const dbColumns = columns.map(([dbColumn]) => dbColumn);
  const placeholders = `(${dbColumns.map(() => '?').join(', ')})`;
  return (rowCount) => `
INSERT INTO ${tableName} (
  ${dbColumns.join(',\n  ')}
) VALUES
  ${Array.from({ length: rowCount }, () => placeholders).join(',\n  ')}
ON DUPLICATE KEY UPDATE
  ${updateColumns.map((column) => (String(column).includes('=') ? column : `${column} = VALUES(${column})`)).join(',\n  ')}
`;
}

function flattenRows(rows, columns) {
  return rows.flatMap((row) => columns.map(([, key]) => row[key] ?? null));
}

const buildCommentInsertSql = buildBulkInsertSql('scrm_comment', COMMENT_COLUMNS, [
  'origin_type',
  'account_id',
  'comment_user_name',
  'comment_user_photo',
  'content',
  'intention',
  'no',
  'parent_comment_id',
  'root_parent_id',
  'reply_to',
  'reply_to_comment_id',
  'ip_location',
  'count_agree',
  'status',
  'created_at',
]);

export function commentUniqueKey(comment) {
  return [ensureInt(comment.origin_type), ensureText(comment.comment_id)];
}

export function dedupeComments(comments) {
  const byKey = new Map();
  const anonymous = [];
  for (const comment of comments) {
    const [originType, commentId] = commentUniqueKey(comment);
    if (!commentId) {
      anonymous.push(comment);
      continue;
    }
    byKey.set(`${originType}\0${commentId}`, comment);
  }
  return [...byKey.values(), ...anonymous];
}

export async function syncWorks(connection, works) {
  if (!works.length) return;
  const existingColumns = await loadTableColumns(connection, 'scrm_file');
  const danmakuColumns = WORK_DANMAKU_COLUMNS.filter(([column]) => existingColumns.has(column));
  const workColumns = [...WORK_COLUMNS, ...danmakuColumns];
  const updateColumns = [
    'account_id',
    'duration',
    'title',
    'front_img_url',
    'share_url = IF(VALUES(share_url) <> \'\', VALUES(share_url), share_url)',
    'count_collect',
    'count_comment',
    'count_play',
    ...danmakuColumns.map(([column]) => column),
    'count_like',
    'count_fav',
    'count_share',
    'public_at',
    'status',
    'file_type',
  ];
  const buildSql = buildBulkInsertSql('scrm_file', workColumns, updateColumns);
  await connection.query(buildSql(works.length), flattenRows(works, workColumns));
}

export async function loadExistingWorkShareUrls(connection, works = []) {
  const pairs = works
    .map((work) => [ensureInt(work.origin_type), ensureText(work.work_no)])
    .filter(([, workNo]) => workNo);
  if (!pairs.length) return new Map();
  const placeholders = pairs.map(() => '(?, ?)').join(', ');
  const params = pairs.flat();
  const [rows] = await connection.query(
    `SELECT origin_type, no AS work_no, share_url FROM scrm_file WHERE (origin_type, no) IN (${placeholders})`,
    params,
  );
  return new Map(rows.map((row) => [
    `${ensureInt(row.origin_type)}\0${ensureText(row.work_no)}`,
    ensureText(row.share_url, 1024),
  ]));
}

export async function syncComments(connection, comments) {
  const rows = dedupeComments(comments);
  if (!rows.length) return;
  await connection.query(buildCommentInsertSql(rows.length), flattenRows(rows, COMMENT_COLUMNS));
}

export async function loadTableColumns(connection, tableName) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM ${tableName}`);
  return new Set(rows.map((row) => String(row.Field || '').trim()).filter(Boolean));
}

export async function loadUniqueIndexColumns(connection, tableName) {
  const [rows] = await connection.query(`SHOW INDEX FROM ${tableName}`);
  const partsByKey = new Map();
  for (const row of rows) {
    if (ensureInt(row.Non_unique) !== 0) continue;
    const keyName = ensureText(row.Key_name);
    const columnName = ensureText(row.Column_name);
    if (!keyName || !columnName) continue;
    const parts = partsByKey.get(keyName) ?? [];
    parts.push([ensureInt(row.Seq_in_index), columnName]);
    partsByKey.set(keyName, parts);
  }
  const result = new Map();
  for (const [keyName, parts] of partsByKey.entries()) {
    result.set(keyName, parts.sort((left, right) => left[0] - right[0]).map(([, column]) => column));
  }
  return result;
}

export async function ensureRequiredUniqueIndexes(connection) {
  const missing = [];
  for (const [tableName, requiredIndexes] of Object.entries(REQUIRED_UNIQUE_INDEXES)) {
    const existing = new Set(Array.from((await loadUniqueIndexColumns(connection, tableName)).values()).map((columns) => columns.join(',')));
    for (const requiredColumns of requiredIndexes) {
      if (!existing.has(requiredColumns.join(','))) {
        missing.push(`${tableName}: UNIQUE(${requiredColumns.join(', ')})`);
      }
    }
  }
  if (missing.length) throw new Error(`Missing required SCRM unique indexes: ${missing.join('; ')}`);
}

export async function ensureCommentSchema(connection) {
  const fileColumns = await loadTableColumns(connection, 'scrm_file');
  for (const [columnName, ddl] of Object.entries(FILE_SCHEMA_COLUMNS)) {
    if (fileColumns.has(columnName)) continue;
    await connection.query(ddl);
    fileColumns.add(columnName);
  }

  const existingColumns = await loadTableColumns(connection, 'scrm_comment');
  for (const [columnName, ddl] of Object.entries(COMMENT_SCHEMA_COLUMNS)) {
    if (existingColumns.has(columnName)) continue;
    await connection.query(ddl);
    existingColumns.add(columnName);
  }
  if (existingColumns.has('ip_location')) {
    await connection.query("UPDATE scrm_comment SET ip_location = '' WHERE ip_location IS NULL");
    await connection.query("ALTER TABLE scrm_comment MODIFY COLUMN ip_location VARCHAR(128) NOT NULL DEFAULT ''");
  }

  await ensureTableIndex(connection, 'scrm_file', 'idx_origin_account', ['origin_type', 'account_id']);
  await ensureTableIndex(connection, 'scrm_comment', 'idx_origin_account', ['origin_type', 'account_id']);
}

export async function ensureImportSchema(connection) {
  await ensureCommentSchema(connection);
  await ensureRequiredUniqueIndexes(connection);
}

export async function applyImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await connection.beginTransaction();
    await ensureImportSchema(connection);
    await syncWorks(connection, payload.works);
    await syncComments(connection, payload.comments);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

export async function verifyImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    const [[fileTotal]] = await connection.query('SELECT COUNT(*) AS total FROM scrm_file');
    const [[commentTotal]] = await connection.query('SELECT COUNT(*) AS total FROM scrm_comment');
    let works = [];
    const dedupedComments = dedupeComments(payload.comments);
    if (payload.works.length) {
      const workNos = [...new Set(payload.works.map((work) => work.work_no))].sort();
      const originTypes = [...new Set(payload.works.map((work) => ensureInt(work.origin_type)))].sort();
      const noPlaceholders = workNos.map(() => '?').join(',');
      const originPlaceholders = originTypes.map(() => '?').join(',');
      const [workRows] = await connection.query(`
SELECT
  v.work_no,
  v.origin_type,
  v.account_id,
  v.title,
  v.share_url,
  v.count_comment,
  SUM(CASE WHEN c.parent_comment_id = '' THEN 1 ELSE 0 END) AS top_level_comments,
  SUM(CASE WHEN c.parent_comment_id <> '' THEN 1 ELSE 0 END) AS reply_comments,
  COUNT(c.id) AS total_comment_rows
FROM (
  SELECT id, no AS work_no, origin_type, account_id, title, share_url, count_comment
  FROM scrm_file
  WHERE no IN (${noPlaceholders})
    AND origin_type IN (${originPlaceholders})
) v
LEFT JOIN scrm_comment c ON c.no = v.work_no AND c.origin_type = v.origin_type
GROUP BY v.work_no, v.origin_type, v.title, v.count_comment
ORDER BY v.id ASC
`, [...workNos, ...originTypes]);
      works = workRows;
    }

    let matchedCommentRows = 0;
    const commentKeys = dedupedComments
      .map(commentUniqueKey)
      .filter(([, commentId]) => commentId);
    if (commentKeys.length) {
      const placeholders = commentKeys.map(() => '(?,?)').join(',');
      const params = commentKeys.flat();
      const [[row]] = await connection.query(
        `SELECT COUNT(*) AS total FROM scrm_comment WHERE (origin_type, comment_id) IN (${placeholders})`,
        params,
      );
      matchedCommentRows = Number(row.total || 0);
    }

    return {
      database_file_total: Number(fileTotal.total || 0),
      database_comment_total: Number(commentTotal.total || 0),
      payload_work_rows: payload.works.length,
      payload_comment_rows: payload.comments.length,
      write_attempt_work_rows: payload.works.length,
      write_attempt_comment_rows: dedupedComments.length,
      matched_work_rows: works.length,
      matched_comment_rows: matchedCommentRows,
      works,
    };
  } finally {
    await connection.end();
  }
}
