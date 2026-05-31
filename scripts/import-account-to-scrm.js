#!/usr/bin/env node
import fs from 'node:fs';

import {
  ensureInt,
  ensureText,
  nowDatetimeText,
  openConnection,
  resolveInputPath,
  ROOT_DIR,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, scrmMediaConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import { buildMediaStartSummary, materializeScrmPayloadMedia } from './lib/scrm-media.js';

export const ACCOUNT_PLATFORMS = {
  'weixin-channels': {
    platform: 'weixin-channels',
    originType: 1,
  },
  douyin: {
    platform: 'douyin',
    originType: 2,
  },
};

const ACCOUNT_COLUMNS = [
  ['account_id', 'account_id'],
  ['origin_type', 'origin_type'],
  ['account_name', 'account_name'],
  ['account_photo', 'account_photo'],
  ['profile_url', 'profile_url'],
  ['fans_count', 'fans_count'],
  ['raw_payload_json', 'raw_payload_json'],
  ['created_at', 'created_at'],
  ['updated_at', 'updated_at'],
];

function toJsonable(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(toJsonable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonable(item)]));
  }
  return value;
}

export function loadRows(inputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${inputPath} did not contain a JSON array.`);
  return data;
}

export function getAccountPlatform(platform = '') {
  const key = ensureText(platform);
  const config = ACCOUNT_PLATFORMS[key];
  if (!config) throw new Error(`Unsupported account platform: ${key}`);
  return config;
}

export function resolveAccountInputPath(inputArg, dateArg, platform) {
  return resolveInputPath(ROOT_DIR, getAccountPlatform(platform).platform, inputArg, dateArg, 'account-profile.json');
}

export async function buildPayload(rows, { limit = 0, platform, now = new Date() } = {}) {
  const platformConfig = getAccountPlatform(platform);
  const nowText = nowDatetimeText(now);
  const sourceRows = limit > 0 ? rows.slice(0, limit) : rows;
  const records = [];
  const warnings = [];

  for (const row of sourceRows) {
    const accountId = ensureText(row.account_id, 191);
    if (!accountId) {
      warnings.push('Skipped row without account_id.');
      continue;
    }
    if (ensureText(row.account_id).length > 191) warnings.push(`Account ${accountId} account_id exceeded 191 and was truncated.`);
    if (ensureText(row.account_name).length > 128) warnings.push(`Account ${accountId} account_name exceeded 128 and was truncated.`);
    if (ensureText(row.account_photo).length > 1024) warnings.push(`Account ${accountId} account_photo exceeded 1024 and was truncated.`);
    if (ensureText(row.profile_url).length > 1024) warnings.push(`Account ${accountId} profile_url exceeded 1024 and was truncated.`);

    records.push({
      account_id: accountId,
      origin_type: platformConfig.originType,
      account_name: ensureText(row.account_name, 128),
      account_photo: ensureText(row.account_photo, 1024),
      profile_url: ensureText(row.profile_url, 1024),
      fans_count: Math.max(0, ensureInt(row.fans_count)),
      raw_payload_json: JSON.stringify(toJsonable(row)),
      created_at: nowText,
      updated_at: nowText,
    });
  }

  return { records, warnings };
}

export function accountUniqueKey(record) {
  return [ensureInt(record.origin_type), ensureText(record.account_id)];
}

export function dedupeAccounts(records) {
  const byKey = new Map();
  const anonymous = [];
  for (const record of records) {
    const [originType, accountId] = accountUniqueKey(record);
    if (!accountId) {
      anonymous.push(record);
      continue;
    }
    byKey.set(`${originType}\0${accountId}`, record);
  }
  return [...byKey.values(), ...anonymous];
}

export async function ensureAccountSchema(connection) {
  const [columns] = await connection.query('SHOW COLUMNS FROM scrm_account');
  const existingColumns = new Set(columns.map((row) => String(row.Field || '').trim()).filter(Boolean));
  const requiredColumns = new Set([
    'account_id',
    'origin_type',
    'account_name',
    'account_photo',
    'profile_url',
    'fans_count',
    'raw_payload_json',
    'created_at',
    'updated_at',
  ]);
  const missingColumns = [...requiredColumns].filter((column) => !existingColumns.has(column)).sort();
  if (missingColumns.length) {
    throw new Error(`Missing required scrm_account columns: ${missingColumns.join(', ')}`);
  }

  const [indexes] = await connection.query('SHOW INDEX FROM scrm_account');
  const partsByKey = new Map();
  for (const row of indexes) {
    if (ensureInt(row.Non_unique) !== 0) continue;
    const parts = partsByKey.get(row.Key_name) ?? [];
    parts.push([ensureInt(row.Seq_in_index), ensureText(row.Column_name)]);
    partsByKey.set(row.Key_name, parts);
  }
  const uniqueColumns = new Set(Array.from(partsByKey.values())
    .map((parts) => parts.sort((left, right) => left[0] - right[0]).map(([, column]) => column).join(',')));
  if (!uniqueColumns.has('origin_type,account_id')) {
    throw new Error('Missing required SCRM unique index: scrm_account: UNIQUE(origin_type, account_id)');
  }
}

export function preview(payload, inputPath, apply, platform) {
  const deduped = dedupeAccounts(payload.records);
  const summary = {
    platform: getAccountPlatform(platform).platform,
    mode: apply ? 'apply' : 'dry-run',
    input: String(inputPath),
    account_rows: payload.records.length,
    write_attempt_rows: deduped.length,
    warnings: payload.warnings,
    account_example: deduped[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`IMPORT_SUMMARY ${JSON.stringify(summary)}`);
}

function buildAccountInsertSql(rowCount) {
  const dbColumns = ACCOUNT_COLUMNS.map(([column]) => column);
  const rowPlaceholder = `(${dbColumns.map(() => '?').join(', ')})`;
  return `
INSERT INTO scrm_account (
  ${dbColumns.join(',\n  ')}
) VALUES
  ${Array.from({ length: rowCount }, () => rowPlaceholder).join(',\n  ')}
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_photo = VALUES(account_photo),
  profile_url = VALUES(profile_url),
  fans_count = VALUES(fans_count),
  raw_payload_json = VALUES(raw_payload_json),
  updated_at = VALUES(updated_at)
`;
}

export async function applyImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await connection.beginTransaction();
    await ensureAccountSchema(connection);
    const rows = dedupeAccounts(payload.records);
    if (rows.length) {
      await connection.query(
        buildAccountInsertSql(rows.length),
        rows.flatMap((row) => ACCOUNT_COLUMNS.map(([, key]) => row[key] ?? null)),
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
    const [[totalRow]] = await connection.query('SELECT COUNT(*) AS total FROM scrm_account');
    const deduped = dedupeAccounts(payload.records);
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
    const params = deduped.map(accountUniqueKey).flat();
    const [records] = await connection.query(`
SELECT account_id, origin_type, account_name, account_photo, profile_url, fans_count, raw_payload_json, created_at, updated_at
FROM scrm_account
WHERE (origin_type, account_id) IN (${placeholders})
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
    limit: 0,
    apply: false,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    platform: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') options.input = argv[++i];
    else if (arg === '--date') options.date = argv[++i];
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
  console.log(`Usage: node scripts/import-account-to-scrm.js --platform <platform> [options]

Options:
  --platform NAME       weixin-channels or douyin
  --input PATH          Absolute or relative path to account-profile.json
  --date YYYY-MM-DD     Use samples/<platform>/<date>/account-profile.json
  --limit N             Only import the first N account rows
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
  if (!options.platform) throw new Error('--platform is required');
  const platform = getAccountPlatform(options.platform).platform;
  const inputPath = resolveAccountInputPath(options.input, options.date, platform);
  const rows = loadRows(inputPath);
  const payload = await buildPayload(rows, { limit: options.limit, platform });
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
      scrm_account_total: report.total_rows,
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

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  await run(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
