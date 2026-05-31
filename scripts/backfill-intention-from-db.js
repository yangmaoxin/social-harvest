#!/usr/bin/env node
import { applyIntentionAnalysis } from './lib/intention-classifier.js';
import { ensureInt, openConnection } from './lib/scrm-base.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

export function selectedTables(options = {}) {
  const tables = [];
  if (options.comments) tables.push('comments');
  if (options.messages) tables.push('messages');
  return tables.length ? tables : ['comments', 'messages'];
}

export async function fetchCommentRecords(connection, { onlyUnknown = false, limit = 0 } = {}) {
  let sql = `
SELECT comment_id, origin_type, no AS work_no, content, intention
FROM scrm_comment
WHERE content <> ''
`;
  const params = [];
  if (onlyUnknown) sql += ' AND intention = 0';
  sql += ' ORDER BY id ASC';
  if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  const [rows] = await connection.query(sql, params);
  return rows.map((row) => ({
    record_key: `${row.origin_type}::${row.work_no}::${row.comment_id}`,
    comment_id: String(row.comment_id),
    origin_type: ensureInt(row.origin_type),
    work_no: String(row.work_no),
    content: String(row.content || ''),
    previous_intention: ensureInt(row.intention),
    intention: ensureInt(row.intention),
  }));
}

export async function fetchMessageRecords(connection, { onlyUnknown = false, limit = 0 } = {}) {
  let sql = `
SELECT comment_id, origin_type, content, intention
FROM scrm_message
WHERE content <> ''
`;
  const params = [];
  if (onlyUnknown) sql += ' AND intention = 0';
  sql += ' ORDER BY id ASC';
  if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  const [rows] = await connection.query(sql, params);
  return rows.map((row) => ({
    record_key: `${row.origin_type}::${row.comment_id}`,
    comment_id: String(row.comment_id),
    origin_type: ensureInt(row.origin_type),
    content: String(row.content || ''),
    previous_intention: ensureInt(row.intention),
    intention: ensureInt(row.intention),
  }));
}

export async function classifyRecords(records, classifier = undefined) {
  return applyIntentionAnalysis(records, { idKey: 'record_key', classifier });
}

export function summarizeRecords(tableName, records, warnings) {
  const intentionCounts = {};
  let changedRows = 0;
  for (const record of records) {
    const intention = ensureInt(record.intention);
    intentionCounts[intention] = (intentionCounts[intention] || 0) + 1;
    if (ensureInt(record.intention) !== ensureInt(record.previous_intention)) changedRows += 1;
  }
  return {
    table_name: tableName,
    scanned_rows: records.length,
    changed_rows: changedRows,
    intention_counts: Object.fromEntries(Object.entries(intentionCounts).sort(([left], [right]) => Number(left) - Number(right))),
    warnings,
  };
}

export async function updateComments(connection, records) {
  const changedRecords = records.filter((record) => ensureInt(record.intention) !== ensureInt(record.previous_intention));
  if (!changedRecords.length) return 0;
  for (const record of changedRecords) {
    await connection.query(
      `UPDATE scrm_comment
SET intention = ?
WHERE origin_type = ?
  AND no = ?
  AND comment_id = ?`,
      [ensureInt(record.intention), ensureInt(record.origin_type), record.work_no, record.comment_id],
    );
  }
  return changedRecords.length;
}

export async function updateMessages(connection, records) {
  const changedRecords = records.filter((record) => ensureInt(record.intention) !== ensureInt(record.previous_intention));
  if (!changedRecords.length) return 0;
  for (const record of changedRecords) {
    await connection.query(
      `UPDATE scrm_message
SET intention = ?
WHERE origin_type = ?
  AND comment_id = ?`,
      [ensureInt(record.intention), ensureInt(record.origin_type), record.comment_id],
    );
  }
  return changedRecords.length;
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    onlyUnknown: false,
    comments: false,
    messages: false,
    limit: 0,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--only-unknown') options.onlyUnknown = true;
    else if (arg === '--comments') options.comments = true;
    else if (arg === '--messages') options.messages = true;
    else if (arg === '--limit') options.limit = Number(argv[++i] || 0);
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
  console.log(`Usage: node scripts/backfill-intention-from-db.js [options]

Options:
  --apply          Write updated intentions back to MySQL. Default is dry-run.
  --only-unknown   Only reclassify rows where intention = 0.
  --comments       Only process scrm_comment.
  --messages       Only process scrm_message.
  --limit N        Only process the first N rows per selected table.
  --config PATH    Config file, default config.local.json.
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
  const tables = selectedTables(options);
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  const summaries = [];
  try {
    await connection.beginTransaction();
    if (tables.includes('comments')) {
      const records = await fetchCommentRecords(connection, { onlyUnknown: options.onlyUnknown, limit: options.limit });
      const warnings = await classifyRecords(records);
      if (options.apply) await updateComments(connection, records);
      summaries.push(summarizeRecords('scrm_comment', records, warnings));
    }
    if (tables.includes('messages')) {
      const records = await fetchMessageRecords(connection, { onlyUnknown: options.onlyUnknown, limit: options.limit });
      const warnings = await classifyRecords(records);
      if (options.apply) await updateMessages(connection, records);
      summaries.push(summarizeRecords('scrm_message', records, warnings));
    }
    if (options.apply) await connection.commit();
    else await connection.rollback();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
  const payload = {
    mode: options.apply ? 'apply' : 'dry-run',
    only_unknown: options.onlyUnknown,
    limit: options.limit,
    tables: summaries,
  };
  console.log(JSON.stringify(payload, null, 2));
  console.log(`INTENTION_BACKFILL_SUMMARY ${JSON.stringify(payload)}`);
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
