#!/usr/bin/env node
import { spawn } from 'node:child_process';

import { ensureInt, ensureText, openConnection } from './lib/scrm-base.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

export async function fetchMissingIpCommentRecords(connection, { limit = 0 } = {}) {
  let sql = `
SELECT c.comment_id, c.origin_type, c.no AS work_no, c.ip_location
FROM scrm_comment c
INNER JOIN (
  SELECT no AS work_no, origin_type, MAX(id) AS id
  FROM scrm_file
  WHERE origin_type = 2
  GROUP BY no, origin_type
) latest_v ON latest_v.work_no = c.no AND latest_v.origin_type = c.origin_type
WHERE c.comment_id <> ''
  AND c.origin_type = 2
  AND c.no <> ''
  AND c.ip_location = ''
ORDER BY c.id ASC
`;
  const params = [];
  if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  const [rows] = await connection.query(sql, params);
  return rows.map((row) => ({
    comment_id: String(row.comment_id),
    origin_type: ensureInt(row.origin_type),
    work_no: String(row.work_no),
    ip_location: String(row.ip_location || ''),
  }));
}

export function groupRecordsByWork(records, { videoLimit = 0 } = {}) {
  const grouped = new Map();
  for (const record of records) {
    const rows = grouped.get(record.work_no) ?? [];
    rows.push(record);
    grouped.set(record.work_no, rows);
  }
  const entries = Array.from(grouped.entries());
  return Object.fromEntries(videoLimit > 0 ? entries.slice(0, videoLimit) : entries);
}

export function runOpenCliComments(opencliBin, workNo, commentLimit, commandTimeout) {
  const args = [
    'douyin',
    'skill-comments',
    workNo,
    '--limit',
    String(commentLimit),
    '--with_replies',
    'true',
    '-f',
    'json',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(opencliBin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), commandTimeout * 1000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${opencliBin} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
        return;
      }
      const rows = JSON.parse(stdout);
      if (!Array.isArray(rows)) reject(new Error(`Expected JSON array from ${opencliBin} ${args.join(' ')}`));
      else resolve(rows);
    });
  });
}

export function buildIpUpdates(recordsByVideo, fetchedCommentsByVideo) {
  const updates = [];
  const skippedVideos = [];
  for (const [workNo, records] of Object.entries(recordsByVideo)) {
    const fetchedRows = fetchedCommentsByVideo[workNo];
    if (fetchedRows === undefined) {
      skippedVideos.push(workNo);
      continue;
    }
    const ipByCommentId = new Map(
      fetchedRows
        .map((row) => [ensureText(row.comment_id), ensureText(row.ip_location)])
        .filter(([commentId, ipLocation]) => commentId && ipLocation),
    );
    for (const record of records) {
      const ipLocation = ipByCommentId.get(record.comment_id) || '';
      if (!ipLocation) continue;
      updates.push({
        work_no: record.work_no,
        comment_id: record.comment_id,
        origin_type: record.origin_type ?? 2,
        ip_location: ipLocation,
      });
    }
  }
  return [updates, skippedVideos];
}

export function summarize(records, groupedRecords, fetchedCommentsByVideo, updates, skippedVideos) {
  const matchedKeys = new Set(updates.map((row) => `${row.origin_type ?? 2}\0${row.work_no}\0${row.comment_id}`));
  const matchedRows = matchedKeys.size;
  return {
    scanned_rows: records.length,
    candidate_videos: Object.keys(groupedRecords).length,
    fetched_videos: Object.keys(fetchedCommentsByVideo).length,
    matched_rows: matchedRows,
    updated_rows: matchedRows,
    unmatched_rows: Math.max(0, records.length - matchedRows),
    skipped_videos: skippedVideos,
  };
}

export async function applyUpdates(connection, updates) {
  if (!updates.length) return 0;
  for (const update of updates) {
    await connection.query(
      `UPDATE scrm_comment
SET ip_location = ?
WHERE origin_type = ?
  AND no = ?
  AND comment_id = ?`,
      [update.ip_location, ensureInt(update.origin_type), update.work_no, update.comment_id],
    );
  }
  return updates.length;
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    limit: 0,
    videoLimit: 0,
    commentLimit: 50,
    commandTimeout: 120,
    opencliBin: 'opencli',
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--limit') options.limit = Number(argv[++i] || 0);
    else if (arg === '--video-limit') options.videoLimit = Number(argv[++i] || 0);
    else if (arg === '--comment-limit') options.commentLimit = Number(argv[++i] || 50);
    else if (arg === '--command-timeout') options.commandTimeout = Number(argv[++i] || 120);
    else if (arg === '--opencli-bin') options.opencliBin = argv[++i];
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
  console.log(`Usage: node scripts/backfill-douyin-ip-from-db.js [options]

Options:
  --apply                Write matched ip_location values back to MySQL.
  --limit N              Only process the first N missing-IP comment rows.
  --video-limit N        Only fetch the first N candidate videos after grouping.
  --comment-limit N      Top-level comments to fetch per video.
  --command-timeout N    Timeout in seconds for each opencli command.
  --opencli-bin PATH     OpenCLI executable name or path.
  --config PATH          Config file, default config.local.json.
`);
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
  let payload;
  try {
    await connection.beginTransaction();
    const records = await fetchMissingIpCommentRecords(connection, { limit: options.limit });
    const groupedRecords = groupRecordsByWork(records, { videoLimit: options.videoLimit });
    const fetchedCommentsByVideo = {};
    const fetchErrors = {};
    for (const workNo of Object.keys(groupedRecords)) {
      try {
        fetchedCommentsByVideo[workNo] = await runOpenCliComments(options.opencliBin, workNo, options.commentLimit, options.commandTimeout);
      } catch (error) {
        fetchErrors[workNo] = error instanceof Error ? error.message : String(error);
      }
    }
    const [updates, skippedVideos] = buildIpUpdates(groupedRecords, fetchedCommentsByVideo);
    const summary = summarize(records, groupedRecords, fetchedCommentsByVideo, updates, skippedVideos);
    const appliedCount = options.apply ? await applyUpdates(connection, updates) : 0;
    if (options.apply) await connection.commit();
    else await connection.rollback();
    const topIpLocations = {};
    for (const update of updates) {
      topIpLocations[update.ip_location] = (topIpLocations[update.ip_location] || 0) + 1;
    }
    payload = {
      mode: options.apply ? 'apply' : 'dry-run',
      limit: options.limit,
      video_limit: options.videoLimit,
      comment_limit: options.commentLimit,
      command_timeout: options.commandTimeout,
      summary: {
        ...summary,
        updated_rows: options.apply ? appliedCount : summary.updated_rows,
      },
      top_ip_locations: Object.fromEntries(Object.entries(topIpLocations).sort((left, right) => right[1] - left[1]).slice(0, 10)),
      fetch_errors: fetchErrors,
      update_example: updates[0] || null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
  console.log(JSON.stringify(payload, null, 2));
  console.log(`DOUYIN_IP_BACKFILL_SUMMARY ${JSON.stringify(payload)}`);
  console.log(options.apply ? 'Backfill applied successfully.' : 'Dry-run only. Re-run with --apply to write into MySQL.');
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
