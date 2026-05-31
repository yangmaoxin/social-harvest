#!/usr/bin/env node
import {
  ensureInt,
  ensureText,
  openConnection,
} from './lib/scrm-base.js';
import {
  dbConfigFromSettings,
  scrmMediaConfigFromSettings,
  setConfigPath,
} from './lib/runtime-config.js';
import {
  createOssClient,
  isExpectedPublicMediaUrl,
  isHttpImageUrl,
  materializeScrmImageUrl,
  validateOssMediaConfig,
} from './lib/scrm-media.js';

export const MEDIA_BACKFILL_TARGETS = {
  file: {
    table: 'scrm_file',
    field: 'front_img_url',
    entityType: 'work',
    entityIdColumn: 'no',
    dateExpression: 'COALESCE(public_at, created_at)',
    selectColumns: ['id', 'origin_type', 'account_id', 'no', 'front_img_url', 'public_at', 'created_at'],
  },
  comment: {
    table: 'scrm_comment',
    field: 'comment_user_photo',
    entityType: 'comment',
    entityIdColumn: 'comment_id',
    dateExpression: 'created_at',
    selectColumns: ['id', 'origin_type', 'account_id', 'comment_id', 'comment_user_photo', 'created_at'],
  },
  message: {
    table: 'scrm_message',
    field: 'comment_user_photo',
    entityType: 'message',
    entityIdColumn: 'comment_id',
    dateExpression: 'created_at',
    selectColumns: ['id', 'origin_type', 'account_id', 'comment_id', 'comment_user_photo', 'created_at'],
  },
  danmaku: {
    table: 'scrm_danmaku',
    field: 'comment_user_photo',
    entityType: 'danmaku',
    entityIdColumn: 'danmaku_id',
    dateExpression: 'created_at',
    selectColumns: ['id', 'origin_type', 'account_id', 'danmaku_id', 'comment_user_photo', 'created_at'],
  },
  account: {
    table: 'scrm_account',
    field: 'account_photo',
    entityType: 'account',
    entityIdColumn: 'account_id',
    dateExpression: 'COALESCE(updated_at, created_at)',
    selectColumns: ['id', 'origin_type', 'account_id', 'account_photo', 'created_at', 'updated_at'],
  },
};

export function platformFromOriginType(originType) {
  const value = ensureInt(originType);
  if (value === 1) return 'weixin-channels';
  if (value === 2) return 'douyin';
  return `origin-${value || 'unknown'}`;
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    clearFailed: false,
    limit: 0,
    table: 'all',
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--clear-failed') options.clearFailed = true;
    else if (arg === '--limit') options.limit = Number(argv[++i] || 0);
    else if (arg === '--table') options.table = argv[++i] || 'all';
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/backfill-scrm-media-to-oss.js [options]

Options:
  --apply              Write uploaded OSS URLs back to MySQL. Default is dry-run.
  --clear-failed       With --apply, clear image fields that still cannot be downloaded/uploaded.
  --limit N            Process at most N candidate rows per target table.
  --table NAME         One of all, file, comment, message, danmaku, account. Default all.
  --config PATH        Config file, default config.local.json.
  --host HOST          MySQL host override.
  --user USER          MySQL user override.
  --password PASSWORD  MySQL password override.
  --database DB        MySQL database override.
`);
}

export function resolveTargets(name = 'all') {
  const normalized = ensureText(name) || 'all';
  if (normalized === 'all') return Object.entries(MEDIA_BACKFILL_TARGETS);
  const target = MEDIA_BACKFILL_TARGETS[normalized];
  if (!target) {
    throw new Error(`Unsupported table target "${normalized}". Supported: all, ${Object.keys(MEDIA_BACKFILL_TARGETS).join(', ')}`);
  }
  return [[normalized, target]];
}

export function buildSelectSql(target, { limit = 0 } = {}) {
  const sql = [
    `SELECT ${target.selectColumns.join(', ')}`,
    `FROM ${target.table}`,
    `WHERE ${target.field} <> ''`,
    `  AND ${target.field} LIKE 'http%'`,
    'ORDER BY id ASC',
  ];
  const params = [];
  if (limit > 0) {
    sql.push('LIMIT ?');
    params.push(limit);
  }
  return [sql.join('\n'), params];
}

export function rowToMediaJob(row, target) {
  return {
    platform: platformFromOriginType(row.origin_type),
    accountId: row.account_id,
    entityType: target.entityType,
    entityId: row[target.entityIdColumn],
    imageType: target.entityType === 'work' ? 'cover' : 'avatar',
    dateValue: row.public_at || row.updated_at || row.created_at,
  };
}

export async function loadCandidateRows(connection, target, options = {}) {
  const [sql, params] = buildSelectSql(target, options);
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function updateMediaField(connection, target, rowId, value) {
  const [result] = await connection.query(
    `UPDATE ${target.table} SET ${target.field} = ? WHERE id = ?`,
    [value, rowId],
  );
  return Number(result?.affectedRows || 0);
}

export async function backfillTarget(connection, targetName, target, {
  apply = false,
  clearFailed = false,
  limit = 0,
  mediaConfig,
  ossClient,
  fetchImpl = globalThis.fetch,
} = {}) {
  const rows = await loadCandidateRows(connection, target, { limit });
  const summary = {
    target: targetName,
    table: target.table,
    field: target.field,
    scanned_rows: rows.length,
    candidates: 0,
    uploaded: 0,
    skipped_existing: 0,
    failed: 0,
    updated_rows: 0,
    cleared_rows: 0,
    warnings: [],
    examples: [],
  };

  for (const row of rows) {
    const sourceUrl = ensureText(row[target.field]);
    if (!isHttpImageUrl(sourceUrl)) continue;
    const mediaJob = rowToMediaJob(row, target);
    if (isExpectedPublicMediaUrl(sourceUrl, mediaJob, { mediaConfig })) {
      summary.skipped_existing += 1;
      continue;
    }
    summary.candidates += 1;
    if (!apply) {
      if (summary.examples.length < 3) {
        summary.examples.push({
          id: row.id,
          entity_id: ensureText(row[target.entityIdColumn]),
          from: sourceUrl,
          to: '',
          status: 'planned',
        });
      }
      continue;
    }
    try {
      const result = await materializeScrmImageUrl(sourceUrl, mediaJob, {
        mediaConfig,
        client: ossClient,
        fetchImpl,
      });
      if (result.status === 'skipped_existing') summary.skipped_existing += 1;
      else summary.uploaded += 1;
      if (result.url && result.url !== sourceUrl) {
        summary.updated_rows += await updateMediaField(connection, target, row.id, result.url);
      }
      if (summary.examples.length < 3) {
        summary.examples.push({
          id: row.id,
          entity_id: ensureText(row[target.entityIdColumn]),
          from: sourceUrl,
          to: result.url,
          status: result.status,
        });
      }
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      summary.warnings.push(`${target.table}#${row.id}: ${message}`);
      if (clearFailed) {
        summary.cleared_rows += await updateMediaField(connection, target, row.id, '');
      }
    }
  }

  return summary;
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const mediaConfig = scrmMediaConfigFromSettings();
  validateOssMediaConfig(mediaConfig);
  const ossClient = createOssClient(mediaConfig);
  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  let report;
  try {
    await connection.beginTransaction();
    const results = [];
    for (const [targetName, target] of resolveTargets(options.table)) {
      results.push(await backfillTarget(connection, targetName, target, {
        apply: options.apply,
        clearFailed: options.clearFailed,
        limit: options.limit,
        mediaConfig,
        ossClient,
      }));
    }
    if (options.apply) await connection.commit();
    else await connection.rollback();
    report = {
      mode: options.apply ? 'apply' : 'dry-run',
      clear_failed: Boolean(options.clearFailed),
      limit: options.limit,
      targets: results,
      totals: {
        scanned_rows: results.reduce((sum, item) => sum + item.scanned_rows, 0),
        candidates: results.reduce((sum, item) => sum + item.candidates, 0),
        uploaded: results.reduce((sum, item) => sum + item.uploaded, 0),
        skipped_existing: results.reduce((sum, item) => sum + item.skipped_existing, 0),
        failed: results.reduce((sum, item) => sum + item.failed, 0),
        updated_rows: results.reduce((sum, item) => sum + item.updated_rows, 0),
        cleared_rows: results.reduce((sum, item) => sum + item.cleared_rows, 0),
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`SCRM_MEDIA_BACKFILL_SUMMARY ${JSON.stringify(report)}`);
  console.log(options.apply ? 'SCRM media backfill applied successfully.' : 'Dry-run only. Re-run with --apply to write OSS URLs into MySQL.');
  return report;
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
