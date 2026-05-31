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
export const ORIGIN_TYPE = 1;
export const MESSAGE_PLATFORMS = {
  'weixin-channels': {
    platform: 'weixin-channels',
    originType: 1,
  },
  douyin: {
    platform: 'douyin',
    originType: 2,
  },
};

const MESSAGE_COLUMNS = [
  ['comment_id', 'comment_id'],
  ['account_id', 'account_id'],
  ['comment_user_name', 'comment_user_name'],
  ['comment_user_photo', 'comment_user_photo'],
  ['content', 'content'],
  ['origin_type', 'origin_type'],
  ['intention', 'intention'],
  ['created_at', 'created_at'],
];

function normalizeMessageDatetimeText(value, now = new Date()) {
  const raw = ensureText(value);
  const match = raw.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return raw;

  const [, month, day, hour, minute, second = '00'] = match;
  return [
    `${now.getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    `${hour.padStart(2, '0')}:${minute}:${second}`,
  ].join(' ');
}

function ensureMessageDatetimeText(value, now = new Date()) {
  const text = ensureDatetimeText(normalizeMessageDatetimeText(value, now));
  if (!text) throw new Error('created_at/time must not be empty');
  return text;
}

export function loadRows(inputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${inputPath} did not contain a JSON array.`);
  return data;
}

export function getMessagePlatform(platform = PLATFORM) {
  const key = ensureText(platform) || PLATFORM;
  const config = MESSAGE_PLATFORMS[key];
  if (!config) throw new Error(`Unsupported private message platform: ${key}`);
  return config;
}

export function resolveMessageInputPath(inputArg, dateArg, platform = PLATFORM) {
  return resolveInputPath(ROOT_DIR, getMessagePlatform(platform).platform, inputArg, dateArg, 'private-messages-flat.json');
}

export async function buildPayload(rows, { limit = 0, classifier = undefined, platform = PLATFORM, now = new Date() } = {}) {
  const platformConfig = getMessagePlatform(platform);
  const nowText = nowDatetimeText(now);
  const sourceRows = limit > 0 ? rows.slice(0, limit) : rows;
  const records = [];
  const warnings = [];

  for (const row of sourceRows) {
    const direction = ensureText(row.direction).toLowerCase();
    if (direction && direction !== 'inbound') continue;
    const commentId = ensureText(row.message_id, 64);
    const content = ensureText(row.text, 1024);
    const senderName = ensureText(row.sender_name, 128) || null;
    const avatarUrl = ensureText(row.sender_avatar_url, 1024) || ensureText(row.thread_avatar_url, 1024) || null;

    if (!commentId) {
      warnings.push(`Skipped row without message_id: thread_id=${row.thread_id}`);
      continue;
    }
    if (!content) {
      warnings.push(`Skipped row without text: message_id=${commentId}`);
      continue;
    }
    if (ensureText(row.text).length > 1024) warnings.push(`Message ${commentId} content exceeded 1024 and was truncated.`);
    if (ensureText(row.sender_name).length > 128) warnings.push(`Message ${commentId} sender_name exceeded 128 and was truncated.`);
    if (ensureText(row.sender_avatar_url || row.thread_avatar_url).length > 1024) warnings.push(`Message ${commentId} avatar url exceeded 1024 and was truncated.`);
    const createdAt = ensureText(row.time || row.thread_latest_time) || nowText;
    if (!ensureText(row.time || row.thread_latest_time)) warnings.push(`Message ${commentId} missing time; used import time.`);

    records.push({
      comment_id: commentId,
      comment_user_name: senderName,
      comment_user_photo: avatarUrl,
      content,
      origin_type: platformConfig.originType,
      intention: 0,
      created_at: ensureMessageDatetimeText(createdAt, now),
    });
  }

  warnings.push(...await applyIntentionAnalysis(records, { classifier }));
  return { records, warnings };
}

export function messageUniqueKey(record) {
  return [ensureInt(record.origin_type), ensureText(record.comment_id)];
}

export function dedupeMessages(records) {
  const byKey = new Map();
  const anonymous = [];
  for (const record of records) {
    const [originType, commentId] = messageUniqueKey(record);
    if (!commentId) {
      anonymous.push(record);
      continue;
    }
    byKey.set(`${originType}\0${commentId}`, record);
  }
  return [...byKey.values(), ...anonymous];
}

export async function ensureMessageSchema(connection) {
  const [columns] = await connection.query('SHOW COLUMNS FROM scrm_message');
  const existingColumns = new Set(columns.map((row) => String(row.Field || '').trim()).filter(Boolean));
  if (!existingColumns.has('account_id')) {
    await connection.query("ALTER TABLE scrm_message ADD COLUMN account_id VARCHAR(191) NOT NULL DEFAULT '' COMMENT '账号唯一标识（抖音号 / 视频号ID 等平台公开账号标识）' AFTER origin_type");
    existingColumns.add('account_id');
  }
  const requiredColumns = new Set([
    'comment_id',
    'account_id',
    'comment_user_name',
    'comment_user_photo',
    'content',
    'origin_type',
    'intention',
    'created_at',
  ]);
  const missingColumns = [...requiredColumns].filter((column) => !existingColumns.has(column)).sort();
  if (missingColumns.length) {
    throw new Error(`Missing required scrm_message columns: ${missingColumns.join(', ')}`);
  }

  const [indexes] = await connection.query('SHOW INDEX FROM scrm_message');
  const partsByKey = new Map();
  for (const row of indexes) {
    if (ensureInt(row.Non_unique) !== 0) continue;
    const parts = partsByKey.get(row.Key_name) ?? [];
    parts.push([ensureInt(row.Seq_in_index), ensureText(row.Column_name)]);
    partsByKey.set(row.Key_name, parts);
  }
  const uniqueColumns = new Set(Array.from(partsByKey.values())
    .map((parts) => parts.sort((left, right) => left[0] - right[0]).map(([, column]) => column).join(',')));
  if (!uniqueColumns.has('origin_type,comment_id')) {
    throw new Error('Missing required SCRM unique index: scrm_message: UNIQUE(origin_type, comment_id)');
  }
  await ensureTableIndex(connection, 'scrm_message', 'idx_origin_account', ['origin_type', 'account_id']);
}

export function preview(payload, inputPath, apply, platform = PLATFORM) {
  const deduped = dedupeMessages(payload.records);
  const summary = {
    platform: getMessagePlatform(platform).platform,
    mode: apply ? 'apply' : 'dry-run',
    input: String(inputPath),
    message_rows: payload.records.length,
    write_attempt_rows: deduped.length,
    warnings: payload.warnings,
    message_example: deduped[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`IMPORT_SUMMARY ${JSON.stringify(summary)}`);
}

function buildMessageInsertSql(rowCount) {
  const dbColumns = MESSAGE_COLUMNS.map(([column]) => column);
  const rowPlaceholder = `(${dbColumns.map(() => '?').join(', ')})`;
  return `
INSERT INTO scrm_message (
  ${dbColumns.join(',\n  ')}
) VALUES
  ${Array.from({ length: rowCount }, () => rowPlaceholder).join(',\n  ')}
ON DUPLICATE KEY UPDATE
  comment_user_name = VALUES(comment_user_name),
  comment_user_photo = VALUES(comment_user_photo),
  content = VALUES(content),
  intention = VALUES(intention),
  created_at = VALUES(created_at)
`;
}

export async function applyImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await connection.beginTransaction();
    await ensureMessageSchema(connection);
    const rows = dedupeMessages(payload.records);
    if (rows.length) {
      await connection.query(
        buildMessageInsertSql(rows.length),
        rows.flatMap((row) => MESSAGE_COLUMNS.map(([, key]) => row[key] ?? null)),
      );
    }
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
    const [[totalRow]] = await connection.query('SELECT COUNT(*) AS total FROM scrm_message');
    const deduped = dedupeMessages(payload.records);
    if (!deduped.length) {
      return {
        total_rows: Number(totalRow.total || 0),
        payload_rows: payload.records.length,
        write_attempt_rows: 0,
        matched_rows: 0,
        records: [],
      };
    }
    const placeholders = deduped.map(() => '(?,?)').join(',');
    const params = deduped.map(messageUniqueKey).flat();
    const [records] = await connection.query(`
SELECT comment_id, comment_user_name, comment_user_photo, content, origin_type, intention, created_at
     , account_id
FROM scrm_message
WHERE (origin_type, comment_id) IN (${placeholders})
ORDER BY id ASC
`, params);
    return {
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
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') options.input = argv[++i];
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
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/import-private-messages-to-scrm-message.js [options]

Options:
  --platform NAME       weixin-channels or douyin, default weixin-channels
  --input PATH          Absolute or relative path to private-messages-flat.json
  --date YYYY-MM-DD     Use samples/<platform>/<date>/private-messages-flat.json
  --account-id VALUE    Explicit real platform account_id for this import, not config alias like main
  --account-profile PATH
                        Explicit account-profile.json path for this import
  --limit N             Only import the first N inbound messages
  --apply               Write to MySQL. Default is dry-run preview only.
  --config PATH         Config file, default config.local.json
  --host HOST           MySQL host override
  --user USER           MySQL user override
  --password PASSWORD   MySQL password override
  --database DB         MySQL database override
`);
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const platform = getMessagePlatform(options.platform).platform;
  const inputPath = resolveMessageInputPath(options.input, options.date, platform);
  const rows = loadRows(inputPath);
  const accountProfilePath = resolveAccountProfilePath({
    platform,
    inputPath,
    date: options.date,
    accountProfile: options.accountProfile,
  });
  const accountId = resolveImportAccountId({
    platform,
    explicitAccountId: options.accountId,
    accountProfilePath,
    errorPrefix: `Could not resolve account_id for ${platform} private-message import`,
  });
  const payload = attachAccountIdToPayload(
    await buildPayload(rows, { limit: options.limit, platform }),
    accountId,
  );
  preview(payload, inputPath, options.apply, platform);
  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply to write into MySQL.');
    return;
  }
  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };
  const mediaConfig = scrmMediaConfigFromSettings();
  console.log(`MEDIA_START ${JSON.stringify(buildMediaStartSummary(platform, mediaConfig))}`);
  const mediaResult = await materializeScrmPayloadMedia(payload, {
    platform,
    mediaConfig,
  });
  console.log(`MEDIA_SUMMARY ${JSON.stringify(mediaResult.summary)}`);
  await applyImport(dbConfig, payload);
  const report = await verifyImport(dbConfig, payload);
  const verificationSummary = {
    platform,
    verification: {
      scrm_message_total: report.total_rows,
      payload_rows: report.payload_rows,
      write_attempt_rows: report.write_attempt_rows,
      matched_current_payload_rows: report.matched_rows,
      records: report.records,
    },
  };
  console.log(JSON.stringify(verificationSummary, null, 2));
  console.log(`IMPORT_VERIFICATION ${JSON.stringify(verificationSummary)}`);
  console.log('Import applied successfully.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    run(options).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
