#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  acquireMetricJobLock,
  buildMetricDeltaEventsFromSnapshots,
  ensureMetricSchema,
  getMetricPlatform,
  metricDefinitionsForScope,
  syncMetricDeltaEvents,
} from './lib/metric-delta.js';
import {
  ensureText,
  nowDatetimeText,
  openConnection,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

export function parseArgs(argv) {
  const options = {
    apply: false,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    input: '',
    platform: 'douyin',
    scope: 'account',
    targetId: '',
    toSourceRunId: '',
    recentWindows: 0,
    ownerId: `${os.hostname()}:${process.pid}`,
    lockTtlSeconds: 300,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--input') options.input = argv[++i];
    else if (arg === '--platform') options.platform = argv[++i];
    else if (arg === '--scope') options.scope = argv[++i];
    else if (arg === '--target-id') options.targetId = argv[++i];
    else if (arg === '--to-source-run-id') options.toSourceRunId = argv[++i];
    else if (arg === '--recent-windows') options.recentWindows = Number(argv[++i] || 0);
    else if (arg === '--owner-id') options.ownerId = argv[++i];
    else if (arg === '--lock-ttl-seconds') options.lockTtlSeconds = Number(argv[++i] || 300);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/generate-metric-delta-events.js [options]

Options:
  --platform NAME          Platform key, default douyin
  --scope NAME             Snapshot scope: account or work, default account
  --target-id ID           Optional target_id filter
  --to-source-run-id ID    Only generate windows whose newer snapshot has this source_run_id
  --recent-windows N       Only inspect the latest N adjacent windows per target, default all
  --owner-id ID            Job lock owner id, default hostname:pid
  --lock-ttl-seconds N     Job lock TTL, default 300
  --apply                  Write delta events. Default is dry-run preview only.
  --config PATH            Config file, default config.local.json
  --host HOST              MySQL host override
  --user USER              MySQL user override
  --password PASSWORD      MySQL password override
  --database DB            MySQL database override
  --input PATH             Dry-run from a local scrm_metric_snapshot JSON array without connecting to MySQL
`);
}

function loadSnapshotsFromInput(inputPath) {
  const resolvedPath = path.resolve(inputPath);
  const data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${resolvedPath} did not contain a JSON array.`);
  return data;
}

function buildSnapshotQuery(options) {
  const where = [
    'origin_type = ?',
    'target_scope = ?',
  ];
  const params = [
    getMetricPlatform(options.platform).originType,
    options.scope,
  ];
  if (options.targetId) {
    where.push('target_id = ?');
    params.push(options.targetId);
  }

  return {
    sql: `
SELECT *
FROM scrm_metric_snapshot
WHERE ${where.join('\n  AND ')}
ORDER BY origin_type ASC, target_scope ASC, target_id ASC, captured_at ASC, id ASC
`,
    params,
  };
}

async function loadSnapshots(connection, options) {
  if (options.toSourceRunId) return loadSnapshotsForSourceRun(connection, options);
  const query = buildSnapshotQuery(options);
  const [rows] = await connection.query(query.sql, query.params);
  return rows;
}

async function loadSnapshotsForSourceRun(connection, options) {
  const platform = getMetricPlatform(options.platform);
  const where = [
    'origin_type = ?',
    'target_scope = ?',
    'source_run_id = ?',
  ];
  const params = [
    platform.originType,
    options.scope,
    options.toSourceRunId,
  ];
  if (options.targetId) {
    where.push('target_id = ?');
    params.push(options.targetId);
  }
  const [currentRows] = await connection.query(`
SELECT *
FROM scrm_metric_snapshot
WHERE ${where.join('\n  AND ')}
ORDER BY origin_type ASC, target_scope ASC, target_id ASC, captured_at ASC, id ASC
`, params);

  const rows = [];
  const seenIds = new Set();
  for (const current of currentRows) {
    const [previousRows] = await connection.query(`
SELECT *
FROM scrm_metric_snapshot
WHERE origin_type = ?
  AND target_scope = ?
  AND target_id = ?
  AND (captured_at < ? OR (captured_at = ? AND id < ?))
ORDER BY captured_at DESC, id DESC
LIMIT 1
`, [
      current.origin_type,
      current.target_scope,
      current.target_id,
      current.captured_at,
      current.captured_at,
      current.id,
    ]);
    for (const row of [previousRows[0], current].filter(Boolean)) {
      const id = Number(row.id || 0);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      rows.push(row);
    }
  }
  return rows.sort((left, right) => {
    const scope = String(left.target_scope || '').localeCompare(String(right.target_scope || ''));
    if (scope !== 0) return scope;
    const target = String(left.target_id || '').localeCompare(String(right.target_id || ''));
    if (target !== 0) return target;
    const capturedAt = String(left.captured_at || '').localeCompare(String(right.captured_at || ''));
    if (capturedAt !== 0) return capturedAt;
    return Number(left.id || 0) - Number(right.id || 0);
  });
}

function preview(events, snapshots, options) {
  const summary = {
    platform: getMetricPlatform(options.platform).platform,
    target_scope: options.scope,
    mode: options.apply ? 'apply' : 'dry-run',
    snapshot_rows: snapshots.length,
    event_rows: events.length,
    to_source_run_id: options.toSourceRunId || '',
    recent_windows: Number(options.recentWindows || 0),
    event_example: events[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`METRIC_DELTA_SUMMARY ${JSON.stringify(summary)}`);
}

async function generate(dbConfig, options) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  let transactionStarted = false;
  try {
    await ensureMetricSchema(connection);

    if (!options.apply) {
      const snapshots = await loadSnapshots(connection, options);
      const events = buildMetricDeltaEventsFromSnapshots(snapshots, {
        metrics: metricDefinitionsForScope(options.scope, options.platform),
        now: new Date(),
        toSourceRunId: options.toSourceRunId,
        recentWindows: options.recentWindows,
      });
      preview(events, snapshots, options);
      console.log('Dry-run only. Re-run with --apply to write metric delta events into MySQL.');
      return { snapshots, events, applied: false };
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const lockName = `metric_delta_generate:${getMetricPlatform(options.platform).platform}:${options.scope}`;
    const locked = await acquireMetricJobLock(
      connection,
      lockName,
      ensureText(options.ownerId, 128),
      new Date(),
      options.lockTtlSeconds,
    );
    if (!locked) {
      await connection.rollback();
      throw new Error(`Metric delta job lock is held by another owner: ${lockName}`);
    }

    const snapshots = await loadSnapshots(connection, options);
    const events = buildMetricDeltaEventsFromSnapshots(snapshots, {
      metrics: metricDefinitionsForScope(options.scope, options.platform),
      now: new Date(),
      toSourceRunId: options.toSourceRunId,
      recentWindows: options.recentWindows,
    });
    preview(events, snapshots, options);

    const result = await syncMetricDeltaEvents(connection, events);
    await connection.commit();
    transactionStarted = false;

    const appliedSummary = {
      platform: getMetricPlatform(options.platform).platform,
      target_scope: options.scope,
      generated_rows: events.length,
      checked_rows: result.checked_rows,
      write_attempt_rows: result.write_attempt_rows,
      inserted_rows: result.inserted_rows,
      duplicate_rows: result.duplicate_rows,
      to_source_run_id: options.toSourceRunId || '',
      recent_windows: Number(options.recentWindows || 0),
      applied_at: nowDatetimeText(),
    };
    console.log(JSON.stringify(appliedSummary, null, 2));
    console.log(`METRIC_DELTA_APPLIED ${JSON.stringify(appliedSummary)}`);
    console.log('Metric delta events applied successfully.');
    return { snapshots, events, applied: true };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback failures.
      }
    }
    throw error;
  } finally {
    await connection.end();
  }
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const metrics = metricDefinitionsForScope(options.scope, options.platform);

  if (options.input) {
    if (options.apply) throw new Error('--input is only supported for dry-run metric delta preview.');
    const snapshots = loadSnapshotsFromInput(options.input);
    const events = buildMetricDeltaEventsFromSnapshots(snapshots, {
      metrics,
      now: new Date(),
      toSourceRunId: options.toSourceRunId,
      recentWindows: options.recentWindows,
    });
    preview(events, snapshots, options);
    console.log('Dry-run only. Re-run without --input and with --apply to write metric delta events into MySQL.');
    return;
  }

  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };
  await generate(dbConfig, options);
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
