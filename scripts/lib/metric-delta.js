import crypto from 'node:crypto';
import os from 'node:os';

import {
  ensureInt,
  ensureText,
  loadTableColumns,
  loadUniqueIndexColumns,
  nowDatetimeText,
} from './scrm-base.js';

export const METRIC_PLATFORMS = {
  douyin: {
    platform: 'douyin',
    originType: 2,
  },
  'weixin-channels': {
    platform: 'weixin-channels',
    originType: 1,
  },
};

export const METRIC_SNAPSHOT_COLUMNS = [
  ['origin_type', 'origin_type'],
  ['target_scope', 'target_scope'],
  ['target_id', 'target_id'],
  ['source', 'source'],
  ['source_run_id', 'source_run_id'],
  ['device_id', 'device_id'],
  ['capture_bucket', 'capture_bucket'],
  ['snapshot_hash', 'snapshot_hash'],
  ['fans_count', 'fans_count'],
  ['like_count', 'like_count'],
  ['share_count', 'share_count'],
  ['collect_count', 'collect_count'],
  ['comment_count', 'comment_count'],
  ['following_count', 'following_count'],
  ['video_count', 'video_count'],
  ['captured_at', 'captured_at'],
  ['raw_payload_json', 'raw_payload_json'],
  ['created_at', 'created_at'],
];

export const METRIC_DELTA_EVENT_COLUMNS = [
  ['origin_type', 'origin_type'],
  ['target_scope', 'target_scope'],
  ['target_id', 'target_id'],
  ['metric_type', 'metric_type'],
  ['delta_unit', 'delta_unit'],
  ['from_snapshot_id', 'from_snapshot_id'],
  ['to_snapshot_id', 'to_snapshot_id'],
  ['window_started_at', 'window_started_at'],
  ['window_ended_at', 'window_ended_at'],
  ['event_time', 'event_time'],
  ['sequence_no', 'sequence_no'],
  ['sequence_total', 'sequence_total'],
  ['display_title', 'display_title'],
  ['display_status', 'display_status'],
  ['confidence', 'confidence'],
  ['created_at', 'created_at'],
];

export const METRIC_SCHEMA_CONTRACTS = {
  scrm_metric_snapshot: {
    columns: [
      'id',
      ...METRIC_SNAPSHOT_COLUMNS.map(([column]) => column),
    ],
    uniqueIndexes: [['snapshot_hash']],
  },
  scrm_metric_delta_event: {
    columns: [
      'id',
      ...METRIC_DELTA_EVENT_COLUMNS.map(([column]) => column),
    ],
    uniqueIndexes: [['from_snapshot_id', 'to_snapshot_id', 'metric_type', 'sequence_no']],
  },
  scrm_job_lock: {
    columns: ['lock_name', 'owner_id', 'locked_until', 'updated_at'],
    uniqueIndexes: [['lock_name']],
  },
};

export const ACCOUNT_METRICS = [
  ['fan', 'fans_count', '关注+1'],
  ['like', 'like_count', '点赞+1'],
];

export const WORK_METRICS = [
  ['share', 'share_count', '分享+1'],
];

export const WEIXIN_CHANNELS_ACCOUNT_METRICS = [
  ['fan', 'fans_count', '关注+1'],
];

export const WEIXIN_CHANNELS_WORK_METRICS = [
  ['like', 'like_count', '点赞+1'],
  ['share', 'share_count', '分享+1'],
];

function datetimeText(value) {
  if (value instanceof Date) return nowDatetimeText(value);
  return ensureText(value);
}

function metricDatetimeMs(value) {
  if (value instanceof Date) return value.getTime();
  const text = datetimeText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match.map(Number);
    return new Date(year, month - 1, day, hour, minute, second).getTime();
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? NaN : parsed;
}

function deterministicRatio(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

function estimateMetricEventTime(previous, current, metricType, sequenceNo, sequenceTotal, fallbackText) {
  const startMs = metricDatetimeMs(previous.captured_at);
  const endMs = metricDatetimeMs(current.captured_at);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return fallbackText;

  const bucketSize = 1 / Math.max(1, sequenceTotal);
  const seed = [
    current.origin_type,
    current.target_scope,
    current.target_id,
    metricType,
    previous.id,
    current.id,
    sequenceNo,
    sequenceTotal,
  ].join('\0');
  const ratio = ((sequenceNo - 1) * bucketSize) + (deterministicRatio(seed) * bucketSize);
  return nowDatetimeText(new Date(startMs + Math.floor((endMs - startMs) * ratio)));
}

function toJsonable(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(toJsonable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonable(item)]));
  }
  return value;
}

export function getMetricPlatform(platform = '') {
  const key = ensureText(platform);
  const config = METRIC_PLATFORMS[key];
  if (!config) throw new Error(`Unsupported metric platform: ${key}`);
  return config;
}

export function floorDateToBucket(date = new Date(), minutes = 1) {
  const bucketMinutes = Math.max(1, ensureInt(minutes) || 1);
  const bucketMs = bucketMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
}

export function buildSnapshotHash(snapshot) {
  const fields = [
    snapshot.origin_type,
    snapshot.target_scope,
    snapshot.target_id,
    snapshot.capture_bucket,
    snapshot.fans_count,
    snapshot.like_count,
    snapshot.share_count,
    snapshot.collect_count,
    snapshot.comment_count,
    snapshot.following_count,
    snapshot.video_count,
  ];
  return crypto.createHash('sha256').update(fields.map((field) => ensureText(field)).join('\0')).digest('hex');
}

export function buildAccountMetricSnapshotPayload(rows, options = {}) {
  const platform = getMetricPlatform(options.platform || 'douyin');
  const now = options.now || new Date();
  const capturedAt = options.capturedAt ? new Date(options.capturedAt) : now;
  if (Number.isNaN(capturedAt.getTime())) throw new Error(`Invalid capturedAt: ${options.capturedAt}`);

  const nowText = nowDatetimeText(now);
  const capturedAtText = nowDatetimeText(capturedAt);
  const captureBucket = nowDatetimeText(floorDateToBucket(capturedAt, options.captureBucketMinutes || 1));
  const source = ensureText(options.source || `${platform.platform}_creator_account`, 64);
  const sourceRunId = ensureText(options.sourceRunId || `${source}:${capturedAtText}`, 128);
  const deviceId = ensureText(options.deviceId || os.hostname(), 128);
  const sourceRows = options.limit > 0 ? rows.slice(0, options.limit) : rows;
  const snapshots = [];
  const warnings = [];

  for (const row of sourceRows) {
    const targetId = ensureText(row.account_id, 191);
    if (!targetId) {
      warnings.push('Skipped account metric row without account_id.');
      continue;
    }

    const snapshot = {
      origin_type: platform.originType,
      target_scope: 'account',
      target_id: targetId,
      source,
      source_run_id: sourceRunId,
      device_id: deviceId,
      capture_bucket: captureBucket,
      snapshot_hash: '',
      fans_count: Math.max(0, ensureInt(row.fans_count)),
      like_count: Math.max(0, ensureInt(row.like_count)),
      share_count: 0,
      collect_count: 0,
      comment_count: 0,
      following_count: Math.max(0, ensureInt(row.following_count)),
      video_count: Math.max(0, ensureInt(row.video_count)),
      captured_at: capturedAtText,
      raw_payload_json: JSON.stringify(toJsonable(row)),
      created_at: nowText,
    };
    snapshot.snapshot_hash = buildSnapshotHash(snapshot);
    snapshots.push(snapshot);
  }

  return {
    platform: platform.platform,
    target_scope: 'account',
    snapshots,
    warnings,
  };
}

function firstMetricInt(row, fields = []) {
  const metrics = row?.metrics && typeof row.metrics === 'object' ? row.metrics : {};
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && value !== '') return Math.max(0, ensureInt(value));
  }
  for (const field of fields) {
    const value = metrics?.[field];
    if (value !== undefined && value !== null && value !== '') return Math.max(0, ensureInt(value));
  }
  return 0;
}

export function buildWorkMetricSnapshotPayload(rows, options = {}) {
  const platform = getMetricPlatform(options.platform || 'douyin');
  const now = options.now || new Date();
  const capturedAt = options.capturedAt ? new Date(options.capturedAt) : now;
  if (Number.isNaN(capturedAt.getTime())) throw new Error(`Invalid capturedAt: ${options.capturedAt}`);

  const nowText = nowDatetimeText(now);
  const capturedAtText = nowDatetimeText(capturedAt);
  const captureBucket = nowDatetimeText(floorDateToBucket(capturedAt, options.captureBucketMinutes || 1));
  const source = ensureText(options.source || `${platform.platform}_creator_work`, 64);
  const sourceRunId = ensureText(options.sourceRunId || `${source}:${capturedAtText}`, 128);
  const deviceId = ensureText(options.deviceId || os.hostname(), 128);
  const sourceRows = options.limit > 0 ? rows.slice(0, options.limit) : rows;
  const snapshots = [];
  const warnings = [];

  for (const row of sourceRows) {
    const targetId = ensureText(row.aweme_id || row.creator_comment_aweme_id || row.object_id || row.export_id, 191);
    if (!targetId) {
      warnings.push('Skipped work metric row without target id.');
      continue;
    }

    const snapshot = {
      origin_type: platform.originType,
      target_scope: 'work',
      target_id: targetId,
      source,
      source_run_id: sourceRunId,
      device_id: deviceId,
      capture_bucket: captureBucket,
      snapshot_hash: '',
      fans_count: 0,
      like_count: firstMetricInt(row, ['digg_count', 'like_count', 'digg', 'like', 'diggCount']),
      share_count: firstMetricInt(row, ['share_count', 'share', 'share_cnt', 'shareCount']),
      collect_count: firstMetricInt(row, ['collect_count', 'fav_count', 'favorite_count', 'collect', 'favorite', 'fav', 'collect_cnt', 'collectCount', 'favCount']),
      comment_count: firstMetricInt(row, ['creator_comment_count', 'comment_count', 'comment', 'comment_cnt', 'commentCount']),
      following_count: 0,
      video_count: 0,
      captured_at: capturedAtText,
      raw_payload_json: JSON.stringify(toJsonable(row)),
      created_at: nowText,
    };
    snapshot.snapshot_hash = buildSnapshotHash(snapshot);
    snapshots.push(snapshot);
  }

  return {
    platform: platform.platform,
    target_scope: 'work',
    snapshots,
    warnings,
  };
}

export function metricDefinitionsForScope(scope, platform = 'douyin') {
  const targetScope = ensureText(scope);
  const platformKey = getMetricPlatform(platform).platform;
  if (platformKey === 'weixin-channels' && targetScope === 'account') return WEIXIN_CHANNELS_ACCOUNT_METRICS;
  if (platformKey === 'weixin-channels' && targetScope === 'work') return WEIXIN_CHANNELS_WORK_METRICS;
  if (targetScope === 'account') return ACCOUNT_METRICS;
  if (targetScope === 'work') return WORK_METRICS;
  throw new Error(`Unsupported metric delta scope: ${targetScope}`);
}

export function dedupeSnapshots(snapshots) {
  const byHash = new Map();
  for (const snapshot of snapshots) {
    byHash.set(ensureText(snapshot.snapshot_hash), snapshot);
  }
  return [...byHash.values()].filter((snapshot) => snapshot.snapshot_hash);
}

export async function ensureMetricSchema(connection) {
  const missing = [];
  for (const [tableName, contract] of Object.entries(METRIC_SCHEMA_CONTRACTS)) {
    const columns = await loadTableColumns(connection, tableName);
    for (const column of contract.columns) {
      if (!columns.has(column)) missing.push(`${tableName}.${column}`);
    }

    const uniqueIndexColumns = new Set(
      Array.from((await loadUniqueIndexColumns(connection, tableName)).values()).map((parts) => parts.join(',')),
    );
    for (const uniqueColumns of contract.uniqueIndexes) {
      const key = uniqueColumns.join(',');
      if (!uniqueIndexColumns.has(key)) missing.push(`${tableName}: UNIQUE(${uniqueColumns.join(', ')})`);
    }
  }

  if (missing.length) {
    throw new Error(`Metric backend schema is incompatible or incomplete: ${missing.join('; ')}`);
  }
}

function buildBulkInsertSql(tableName, columns, updateClause = 'id = id') {
  const dbColumns = columns.map(([column]) => column);
  const rowPlaceholder = `(${dbColumns.map(() => '?').join(', ')})`;
  return (rowCount) => `
INSERT INTO ${tableName} (
  ${dbColumns.join(',\n  ')}
) VALUES
  ${Array.from({ length: rowCount }, () => rowPlaceholder).join(',\n  ')}
ON DUPLICATE KEY UPDATE
  ${updateClause}
`;
}

function flattenRows(rows, columns) {
  return rows.flatMap((row) => columns.map(([, key]) => row[key] ?? null));
}

export async function syncMetricSnapshots(connection, snapshots) {
  const rows = dedupeSnapshots(snapshots);
  if (!rows.length) return { write_attempt_rows: 0 };
  const sql = buildBulkInsertSql('scrm_metric_snapshot', METRIC_SNAPSHOT_COLUMNS);
  await connection.query(sql(rows.length), flattenRows(rows, METRIC_SNAPSHOT_COLUMNS));
  return { write_attempt_rows: rows.length };
}

export function groupSnapshotsByTarget(snapshots) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    const key = [
      ensureInt(snapshot.origin_type),
      ensureText(snapshot.target_scope),
      ensureText(snapshot.target_id),
    ].join('\0');
    const group = groups.get(key) ?? [];
    group.push(snapshot);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const byCapturedAt = datetimeText(left.captured_at).localeCompare(datetimeText(right.captured_at));
      if (byCapturedAt !== 0) return byCapturedAt;
      return ensureInt(left.id) - ensureInt(right.id);
    });
  }
  return groups;
}

export function buildMetricDeltaEventsFromSnapshots(snapshots, options = {}) {
  const nowText = nowDatetimeText(options.now || new Date());
  const metrics = options.metrics || ACCOUNT_METRICS;
  const toSourceRunId = ensureText(options.toSourceRunId, 128);
  const recentWindows = Math.max(0, ensureInt(options.recentWindows));
  const events = [];

  for (const group of groupSnapshotsByTarget(snapshots).values()) {
    const startIndex = recentWindows > 0 ? Math.max(1, group.length - recentWindows) : 1;
    for (let index = startIndex; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      if (toSourceRunId && ensureText(current.source_run_id, 128) !== toSourceRunId) continue;

      for (const [metricType, countField, displayTitle] of metrics) {
        const delta = ensureInt(current[countField]) - ensureInt(previous[countField]);
        if (delta <= 0) continue;

        for (let sequenceNo = 1; sequenceNo <= delta; sequenceNo += 1) {
          events.push({
            origin_type: ensureInt(current.origin_type),
            target_scope: ensureText(current.target_scope, 32),
            target_id: ensureText(current.target_id, 191),
            metric_type: metricType,
            delta_unit: 1,
            from_snapshot_id: ensureInt(previous.id),
            to_snapshot_id: ensureInt(current.id),
            window_started_at: datetimeText(previous.captured_at),
            window_ended_at: datetimeText(current.captured_at),
            event_time: estimateMetricEventTime(previous, current, metricType, sequenceNo, delta, nowText),
            sequence_no: sequenceNo,
            sequence_total: delta,
            display_title: displayTitle,
            display_status: 'normal',
            confidence: 'snapshot_delta',
            created_at: nowText,
          });
        }
      }
    }
  }

  return events;
}

function metricDeltaEventKey(event = {}) {
  return [
    ensureInt(event.from_snapshot_id),
    ensureInt(event.to_snapshot_id),
    ensureText(event.metric_type, 32),
    ensureInt(event.sequence_no),
  ].join('\0');
}

async function loadExistingMetricDeltaEventKeys(connection, events) {
  const uniqueEvents = [...new Map(events.map((event) => [metricDeltaEventKey(event), event])).values()];
  const existingKeys = new Set();
  const chunkSize = 500;
  for (let index = 0; index < uniqueEvents.length; index += chunkSize) {
    const chunk = uniqueEvents.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap((event) => [
      ensureInt(event.from_snapshot_id),
      ensureInt(event.to_snapshot_id),
      ensureText(event.metric_type, 32),
      ensureInt(event.sequence_no),
    ]);
    const [rows] = await connection.query(`
SELECT from_snapshot_id, to_snapshot_id, metric_type, sequence_no
FROM scrm_metric_delta_event
WHERE (from_snapshot_id, to_snapshot_id, metric_type, sequence_no) IN (${placeholders})
`, params);
    for (const row of rows) {
      existingKeys.add(metricDeltaEventKey(row));
    }
  }
  return existingKeys;
}

export async function syncMetricDeltaEvents(connection, events) {
  if (!events.length) {
    return { checked_rows: 0, write_attempt_rows: 0, inserted_rows: 0, duplicate_rows: 0 };
  }
  const uniqueEvents = [...new Map(events.map((event) => [metricDeltaEventKey(event), event])).values()];
  const existingKeys = await loadExistingMetricDeltaEventKeys(connection, uniqueEvents);
  const missingEvents = uniqueEvents.filter((event) => !existingKeys.has(metricDeltaEventKey(event)));
  if (!missingEvents.length) {
    return {
      checked_rows: events.length,
      write_attempt_rows: 0,
      inserted_rows: 0,
      duplicate_rows: events.length,
    };
  }
  const sql = buildBulkInsertSql('scrm_metric_delta_event', METRIC_DELTA_EVENT_COLUMNS);
  await connection.query(sql(missingEvents.length), flattenRows(missingEvents, METRIC_DELTA_EVENT_COLUMNS));
  const insertedRows = missingEvents.length;
  return {
    checked_rows: events.length,
    write_attempt_rows: missingEvents.length,
    inserted_rows: insertedRows,
    duplicate_rows: Math.max(0, events.length - insertedRows),
  };
}

export async function acquireMetricJobLock(connection, lockName, ownerId, now = new Date(), ttlSeconds = 300) {
  const nowText = nowDatetimeText(now);
  const lockedUntil = nowDatetimeText(new Date(now.getTime() + Math.max(1, ensureInt(ttlSeconds)) * 1000));
  const [rows] = await connection.query('SELECT lock_name, owner_id, locked_until FROM scrm_job_lock WHERE lock_name = ? FOR UPDATE', [lockName]);
  const current = rows[0];
  if (!current) {
    await connection.query(
      'INSERT INTO scrm_job_lock (lock_name, owner_id, locked_until, updated_at) VALUES (?, ?, ?, ?)',
      [lockName, ownerId, lockedUntil, nowText],
    );
    return true;
  }

  const currentLockedUntil = datetimeText(current.locked_until);
  if (currentLockedUntil && currentLockedUntil > nowText) return false;

  await connection.query(
    'UPDATE scrm_job_lock SET owner_id = ?, locked_until = ?, updated_at = ? WHERE lock_name = ?',
    [ownerId, lockedUntil, nowText, lockName],
  );
  return true;
}
