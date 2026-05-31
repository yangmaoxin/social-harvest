#!/usr/bin/env node
import { ensureRequiredUniqueIndexes, openConnection } from './lib/scrm-base.js';
import { ensureDanmakuSchema } from './import-danmaku-to-scrm.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import { ensureMessageSchema } from './import-private-messages-to-scrm-message.js';
import { ensureMetricSchema } from './lib/metric-delta.js';

function nowIso() {
  return new Date().toISOString();
}

function checkOk(name, extra = {}) {
  return { name, status: 'ok', checked_at: nowIso(), ...extra };
}

function checkSkipped(name, reason) {
  return { name, status: 'skipped', checked_at: nowIso(), reason };
}

function checkFailed(name, error) {
  return { name, status: 'failed', checked_at: nowIso(), error: error instanceof Error ? error.message : String(error) };
}

function loadDbConfig(overrides = {}) {
  const values = { ...dbConfigFromSettings(), ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value)) };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  return [values, missing];
}

export async function runChecks({
  requireFileCommentDb = false,
  requireMessageDb = false,
  requireDanmakuDb = false,
  requireMetricDb = false,
  dbOverrides = {},
} = {}) {
  const report = { enabled: true, status: 'ok', checks: [] };
  if (!requireFileCommentDb && !requireMessageDb && !requireDanmakuDb && !requireMetricDb) {
    report.status = 'skipped';
    report.checks.push(checkSkipped('scrm-db', '本轮未请求正式写入 SCRM，跳过数据库预检'));
    return report;
  }

  const [dbConfig, missing] = loadDbConfig(dbOverrides);
  if (missing.length) {
    report.checks.push(checkFailed('scrm-db-config', `Missing DB connection fields: ${missing.join(', ')}`));
    report.status = 'failed';
    return report;
  }
  report.checks.push(checkOk('scrm-db-config', { fields: Object.keys(dbConfig).sort() }));

  let connection;
  try {
    connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
    report.checks.push(checkOk('scrm-db-connect', { database: dbConfig.database }));
    if (requireFileCommentDb) {
      await ensureRequiredUniqueIndexes(connection);
      report.checks.push(checkOk('scrm-file-comment-schema'));
    } else {
      report.checks.push(checkSkipped('scrm-file-comment-schema', '本轮未请求 scrm_file/scrm_comment 正式写入'));
    }

    if (requireMessageDb) {
      await ensureMessageSchema(connection);
      report.checks.push(checkOk('scrm-message-schema'));
    } else {
      report.checks.push(checkSkipped('scrm-message-schema', '本轮未请求 scrm_message 正式写入'));
    }

    if (requireDanmakuDb) {
      const tableName = await ensureDanmakuSchema(connection);
      report.checks.push(checkOk('scrm-danmaku-schema', { table_name: tableName }));
    } else {
      report.checks.push(checkSkipped('scrm-danmaku-schema', '本轮未请求 scrm_danmaku 正式写入'));
    }

    if (requireMetricDb) {
      await ensureMetricSchema(connection);
      report.checks.push(checkOk('scrm-metric-schema'));
    } else {
      report.checks.push(checkSkipped('scrm-metric-schema', '本轮未请求 metric snapshot/delta 正式写入'));
    }
  } catch (error) {
    report.checks.push(checkFailed('scrm-db-schema', error));
    report.status = 'failed';
  } finally {
    if (connection) await connection.end();
  }

  if (report.checks.some((check) => check.status === 'failed')) report.status = 'failed';
  return report;
}

export function parseArgs(argv) {
  const options = {
    requireFileCommentDb: false,
    requireMessageDb: false,
    requireDanmakuDb: false,
    requireMetricDb: false,
    config: '',
    dbOverrides: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--require-file-comment-db') options.requireFileCommentDb = true;
    else if (arg === '--require-message-db') options.requireMessageDb = true;
    else if (arg === '--require-danmaku-db') options.requireDanmakuDb = true;
    else if (arg === '--require-metric-db') options.requireMetricDb = true;
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.dbOverrides.host = argv[++i];
    else if (arg === '--user') options.dbOverrides.user = argv[++i];
    else if (arg === '--password') options.dbOverrides.password = argv[++i];
    else if (arg === '--database') options.dbOverrides.database = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/preflight-scrm.js [options]

Options:
  --require-file-comment-db  Require scrm_file/scrm_comment config and indexes
  --require-message-db       Require scrm_message config, columns and unique index
  --require-danmaku-db       Require scrm_danmaku config, columns and unique index
  --require-metric-db        Require metric snapshot/delta/lock tables and unique indexes
  --config PATH              Config file, default config.local.json
  --host HOST                MySQL host override
  --user USER                MySQL user override
  --password PASSWORD        MySQL password override
  --database DB              MySQL database override
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    if (options.config) setConfigPath(options.config);
    runChecks(options).then((report) => {
      console.log(JSON.stringify(report, null, 2));
      console.log(`SCRM_PREFLIGHT ${JSON.stringify(report)}`);
      if (report.status === 'failed') process.exitCode = 1;
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
