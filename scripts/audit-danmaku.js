#!/usr/bin/env node
import mysql from 'mysql2/promise';

import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

function nowIso() {
  return new Date().toISOString();
}

export function parseArgs(argv) {
  const options = {
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') options.config = argv[++index];
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--user') options.user = argv[++index];
    else if (arg === '--password') options.password = argv[++index];
    else if (arg === '--database') options.database = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/audit-danmaku.js [options]

Options:
  --config PATH     Config file, default config.local.json
  --host HOST       MySQL host override
  --user USER       MySQL user override
  --password PASS   MySQL password override
  --database DB     MySQL database override

This command is read-only. It checks whether the canonical danmaku schema
is present and ready for runtime use.
`);
}

function mergedDbConfig(options = {}) {
  const settings = dbConfigFromSettings();
  return {
    host: options.host || settings.host,
    user: options.user || settings.user,
    password: options.password || settings.password,
    database: options.database || settings.database,
  };
}

function missingDbFields(dbConfig = {}) {
  return Object.entries(dbConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query('SHOW TABLES LIKE ?', [tableName]);
  return Array.isArray(rows) && rows.length > 0;
}

async function loadColumns(connection, tableName) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM ${tableName}`);
  return new Set(rows.map((row) => String(row.Field || '').trim()).filter(Boolean));
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  const firstValue = row ? Object.values(row)[0] : 0;
  return Number(firstValue || 0);
}

export function buildAuditSummary(snapshot = {}) {
  const errors = [];

  if (!snapshot.scrm_file_exists) errors.push('Missing scrm_file.');
  if (!snapshot.scrm_danmaku_exists) errors.push('Missing scrm_danmaku.');
  if (!snapshot.count_danmaku_column_exists) errors.push('Missing scrm_file.count_danmaku.');

  const status = errors.length > 0 ? 'failed' : 'ok';
  const nextSteps = status === 'ok'
    ? ['Canonical danmaku schema is complete.']
    : ['Apply docs/sql/scrm-danmaku.sql.', 'Re-run node scripts/audit-danmaku.js.'];

  return {
    status,
    schema: 'canonical',
    errors,
    warnings: [],
    next_steps: nextSteps,
  };
}

export async function collectAuditSnapshot(connection) {
  const scrmFileExists = await tableExists(connection, 'scrm_file');
  const scrmDanmakuExists = await tableExists(connection, 'scrm_danmaku');

  let countDanmakuColumnExists = false;
  if (scrmFileExists) {
    const columns = await loadColumns(connection, 'scrm_file');
    countDanmakuColumnExists = columns.has('count_danmaku');
  }

  let danmakuRowCount = 0;
  if (scrmDanmakuExists) {
    danmakuRowCount = await scalar(connection, 'SELECT COUNT(*) AS total FROM scrm_danmaku');
  }

  return {
    checked_at: nowIso(),
    scrm_file_exists: scrmFileExists,
    scrm_danmaku_exists: scrmDanmakuExists,
    count_danmaku_column_exists: countDanmakuColumnExists,
    danmaku_row_count: danmakuRowCount,
  };
}

export async function run(options = {}) {
  if (options.config) setConfigPath(options.config);
  const dbConfig = mergedDbConfig(options);
  const missing = missingDbFields(dbConfig);
  if (missing.length) {
    throw new Error(`Missing DB connection fields: ${missing.join(', ')}`);
  }

  const connection = await mysql.createConnection({ ...dbConfig, charset: 'utf8mb4' });
  try {
    const snapshot = await collectAuditSnapshot(connection);
    const summary = buildAuditSummary(snapshot);
    const report = {
      audit: 'danmaku',
      database: dbConfig.database,
      ...summary,
      snapshot,
    };
    console.log(JSON.stringify(report, null, 2));
    console.log(`DANMAKU_AUDIT ${JSON.stringify(report)}`);
    if (report.status === 'failed') {
      throw new Error(summary.errors.join('; '));
    }
    return report;
  } finally {
    await connection.end();
  }
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
