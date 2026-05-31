#!/usr/bin/env node
import {
  ensureInt,
  ensureText,
  nowDatetimeText,
  openConnection,
} from './lib/scrm-base.js';
import {
  ensureMetricSchema,
  getMetricPlatform,
} from './lib/metric-delta.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

const MAX_LIMIT = 500;

export function parseArgs(argv) {
  const options = {
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    platform: 'douyin',
    scope: '',
    targetId: '',
    metricType: '',
    status: 'normal',
    limit: 50,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--platform') options.platform = argv[++i];
    else if (arg === '--scope') options.scope = argv[++i];
    else if (arg === '--target-id') options.targetId = argv[++i];
    else if (arg === '--metric-type') options.metricType = argv[++i];
    else if (arg === '--status') options.status = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i] || options.limit);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/query-metric-feed.js [options]

Options:
  --platform NAME          Platform key, default douyin
  --scope NAME             Optional target scope filter: account or work
  --target-id ID           Optional target_id filter
  --metric-type TYPE       Optional metric filter: fan, like, share, collect, comment
  --status STATUS          Display status filter, default normal. Use all to disable.
  --limit N                Max rows, default 50, max 500
  --config PATH            Config file, default config.local.json
  --host HOST              MySQL host override
  --user USER              MySQL user override
  --password PASSWORD      MySQL password override
  --database DB            MySQL database override
`);
}

function normalizedLimit(value) {
  const parsed = ensureInt(value);
  if (parsed <= 0) return 50;
  return Math.min(parsed, MAX_LIMIT);
}

export function buildMetricFeedQuery(options = {}) {
  const platform = getMetricPlatform(options.platform || 'douyin');
  const where = ['origin_type = ?'];
  const params = [platform.originType];
  const scope = ensureText(options.scope);
  const targetId = ensureText(options.targetId);
  const metricType = ensureText(options.metricType);
  const status = ensureText(options.status || 'normal');
  const limit = normalizedLimit(options.limit);

  if (scope) {
    if (!['account', 'work'].includes(scope)) throw new Error(`Unsupported metric feed scope: ${scope}`);
    where.push('target_scope = ?');
    params.push(scope);
  }
  if (targetId) {
    where.push('target_id = ?');
    params.push(targetId);
  }
  if (metricType) {
    where.push('metric_type = ?');
    params.push(metricType);
  }
  if (status && status !== 'all') {
    where.push('display_status = ?');
    params.push(status);
  }

  params.push(limit);
  return {
    sql: `
SELECT
  id,
  origin_type,
  target_scope,
  target_id,
  metric_type,
  delta_unit,
  from_snapshot_id,
  to_snapshot_id,
  window_started_at,
  window_ended_at,
  event_time,
  sequence_no,
  sequence_total,
  display_title,
  display_status,
  confidence,
  created_at
FROM scrm_metric_delta_event
WHERE ${where.join('\n  AND ')}
ORDER BY event_time DESC, id DESC
LIMIT ?
`,
    params,
    limit,
  };
}

function datetimeValue(value) {
  if (!value) return '';
  if (value instanceof Date) return nowDatetimeText(value);
  return ensureText(value);
}

export function formatMetricFeedRows(rows = [], platform = 'douyin') {
  const platformKey = getMetricPlatform(platform).platform;
  return rows.map((row) => ({
    id: ensureInt(row.id),
    platform: platformKey,
    origin_type: ensureInt(row.origin_type),
    target_scope: ensureText(row.target_scope),
    target_id: ensureText(row.target_id),
    metric_type: ensureText(row.metric_type),
    delta_unit: ensureInt(row.delta_unit),
    display_title: ensureText(row.display_title),
    display_status: ensureText(row.display_status),
    window_started_at: datetimeValue(row.window_started_at),
    window_ended_at: datetimeValue(row.window_ended_at),
    event_time: datetimeValue(row.event_time),
    sequence_no: ensureInt(row.sequence_no),
    sequence_total: ensureInt(row.sequence_total),
    confidence: ensureText(row.confidence),
    from_snapshot_id: ensureInt(row.from_snapshot_id),
    to_snapshot_id: ensureInt(row.to_snapshot_id),
    created_at: datetimeValue(row.created_at),
  }));
}

export async function queryMetricFeed(connection, options = {}) {
  const query = buildMetricFeedQuery(options);
  const [rows] = await connection.query(query.sql, query.params);
  return formatMetricFeedRows(rows, options.platform);
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await ensureMetricSchema(connection);
    const items = await queryMetricFeed(connection, options);
    const summary = {
      platform: getMetricPlatform(options.platform).platform,
      scope: ensureText(options.scope) || 'all',
      metric_type: ensureText(options.metricType) || 'all',
      status: ensureText(options.status || 'normal'),
      limit: normalizedLimit(options.limit),
      rows: items.length,
      items,
    };
    console.log(JSON.stringify(summary, null, 2));
    console.log(`METRIC_FEED_SUMMARY ${JSON.stringify({
      platform: summary.platform,
      scope: summary.scope,
      metric_type: summary.metric_type,
      status: summary.status,
      limit: summary.limit,
      rows: summary.rows,
    })}`);
  } finally {
    await connection.end();
  }
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
