#!/usr/bin/env node
import fs from 'node:fs';

import {
  buildAccountMetricSnapshotPayload,
  buildWorkMetricSnapshotPayload,
  dedupeSnapshots,
  ensureMetricSchema,
  getMetricPlatform,
  syncMetricSnapshots,
} from './lib/metric-delta.js';
import {
  openConnection,
  resolveInputPath,
  ROOT_DIR,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

function loadRows(inputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${inputPath} did not contain a JSON array.`);
  return data;
}

function resolveMetricInputPath(inputArg, dateArg, platform, scope) {
  const platformKey = getMetricPlatform(platform).platform;
  if (scope === 'account') return resolveInputPath(ROOT_DIR, platform, inputArg, dateArg, 'account-profile.json');
  if (scope === 'work') {
    const filename = platformKey === 'weixin-channels' ? 'works.json' : 'creator-harvest.json';
    return resolveInputPath(ROOT_DIR, platform, inputArg, dateArg, filename);
  }
  throw new Error(`Unsupported metric snapshot scope: ${scope}`);
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
    platform: 'douyin',
    scope: 'account',
    sourceRunId: '',
    deviceId: '',
    capturedAt: '',
    captureBucketMinutes: 1,
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
    else if (arg === '--scope') options.scope = argv[++i];
    else if (arg === '--source-run-id') options.sourceRunId = argv[++i];
    else if (arg === '--device-id') options.deviceId = argv[++i];
    else if (arg === '--captured-at') options.capturedAt = argv[++i];
    else if (arg === '--capture-bucket-minutes') options.captureBucketMinutes = Number(argv[++i] || 1);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/import-metric-snapshot-to-scrm.js [options]

Options:
  --platform NAME              Platform key, default douyin
  --scope NAME                 Snapshot scope: account or work, default account
  --input PATH                 Absolute or relative path to the source JSON
  --date YYYY-MM-DD            Use samples/<platform>/<date>/<scope default file>
                              account: account-profile.json; douyin work: creator-harvest.json; weixin work: works.json
  --limit N                    Only import the first N rows
  --captured-at DATETIME       Override captured_at used for snapshot and bucket
  --capture-bucket-minutes N   Capture bucket size, default 1
  --source-run-id ID           Optional source run id
  --device-id ID               Optional device id
  --apply                      Write to MySQL. Default is dry-run preview only.
  --config PATH                Config file, default config.local.json
  --host HOST                  MySQL host override
  --user USER                  MySQL user override
  --password PASSWORD          MySQL password override
  --database DB                MySQL database override
`);
}

function preview(payload, inputPath, apply) {
  const snapshots = dedupeSnapshots(payload.snapshots);
  const summary = {
    platform: payload.platform,
    target_scope: payload.target_scope,
    mode: apply ? 'apply' : 'dry-run',
    input: String(inputPath),
    snapshot_rows: payload.snapshots.length,
    write_attempt_rows: snapshots.length,
    warnings: payload.warnings,
    snapshot_example: snapshots[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`METRIC_SNAPSHOT_SUMMARY ${JSON.stringify(summary)}`);
}

async function applySnapshots(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await connection.beginTransaction();
    await ensureMetricSchema(connection);
    const result = await syncMetricSnapshots(connection, payload.snapshots);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const inputPath = resolveMetricInputPath(options.input, options.date, options.platform, options.scope);
  const rows = loadRows(inputPath);
  const buildPayload = options.scope === 'work'
    ? buildWorkMetricSnapshotPayload
    : buildAccountMetricSnapshotPayload;
  const payload = buildPayload(rows, {
    platform: options.platform,
    limit: options.limit,
    capturedAt: options.capturedAt,
    captureBucketMinutes: options.captureBucketMinutes,
    sourceRunId: options.sourceRunId,
    deviceId: options.deviceId,
  });
  preview(payload, inputPath, options.apply);

  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply to write metric snapshots into MySQL.');
    return;
  }

  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };
  const result = await applySnapshots(dbConfig, payload);
  const summary = {
    platform: payload.platform,
    target_scope: payload.target_scope,
    write_attempt_rows: result.write_attempt_rows,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`METRIC_SNAPSHOT_APPLIED ${JSON.stringify(summary)}`);
  console.log('Metric snapshots applied successfully.');
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
