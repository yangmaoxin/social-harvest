#!/usr/bin/env node
import mysql from 'mysql2/promise';

import { parseArgs as parseImportArgs, run as runImport } from './import-to-scrm.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

const DEFAULT_INPUT = 'test-support/fixtures/douyin/replies-harvest.json';
const WORK_NO = 'fixture-douyin-work-1';
const ROOT_COMMENT_ID = 'fixture-douyin-root-1';
const REPLY_IDS = ['fixture-douyin-reply-1', 'fixture-douyin-reply-2'];

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    apply: false,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--config') options.config = argv[++index];
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--user') options.user = argv[++index];
    else if (arg === '--password') options.password = argv[++index];
    else if (arg === '--database') options.database = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-douyin-scrm-fixture.js [options]

Options:
  --input PATH      Fixture harvest JSON, default ${DEFAULT_INPUT}
  --apply           Write fixture into MySQL and verify rows. Default is dry-run only.
  --config PATH     Config file, default config.local.json
  --host HOST       MySQL host override
  --user USER       MySQL user override
  --password PASS   MySQL password override
  --database DB     MySQL database override
`);
}

function importArgv(options) {
  const argv = ['--platform', 'douyin', '--input', options.input];
  if (options.apply) argv.push('--apply');
  if (options.config) argv.push('--config', options.config);
  if (options.host) argv.push('--host', options.host);
  if (options.user) argv.push('--user', options.user);
  if (options.password) argv.push('--password', options.password);
  if (options.database) argv.push('--database', options.database);
  return argv;
}

function mergedDbConfig(options) {
  const settings = dbConfigFromSettings();
  return {
    host: options.host || settings.host,
    user: options.user || settings.user,
    password: options.password || settings.password,
    database: options.database || settings.database,
  };
}

export async function loadFixtureRows(dbConfig) {
  const connection = await mysql.createConnection({ ...dbConfig, charset: 'utf8mb4' });
  try {
    const [works] = await connection.query(
      `SELECT no, origin_type, file_type, title, count_comment
       FROM scrm_file
       WHERE no = ? AND origin_type = 2`,
      [WORK_NO],
    );
    const [comments] = await connection.query(
      `SELECT comment_id, origin_type, no, parent_comment_id, root_parent_id, reply_to, reply_to_comment_id, content
       FROM scrm_comment
       WHERE origin_type = 2 AND comment_id IN (?, ?, ?)
       ORDER BY parent_comment_id ASC, comment_id ASC`,
      [ROOT_COMMENT_ID, ...REPLY_IDS],
    );
    return { works, comments };
  } finally {
    await connection.end();
  }
}

export function verifyFixtureRows(rows) {
  const errors = [];
  const work = rows.works[0];
  if (!work) errors.push(`Missing fixture work: ${WORK_NO}`);
  else {
    if (Number(work.origin_type) !== 2) errors.push('Fixture work origin_type is not 2.');
    if (Number(work.count_comment) !== 3) errors.push('Fixture work count_comment is not 3.');
  }

  const commentsById = new Map(rows.comments.map((comment) => [String(comment.comment_id), comment]));
  const root = commentsById.get(ROOT_COMMENT_ID);
  if (!root) errors.push(`Missing root comment: ${ROOT_COMMENT_ID}`);
  else if (String(root.parent_comment_id || '') !== '') errors.push('Root comment parent_comment_id should be empty.');

  for (const replyId of REPLY_IDS) {
    const reply = commentsById.get(replyId);
    if (!reply) {
      errors.push(`Missing reply comment: ${replyId}`);
      continue;
    }
    if (String(reply.parent_comment_id || '') !== ROOT_COMMENT_ID) errors.push(`${replyId} parent_comment_id mismatch.`);
    if (String(reply.root_parent_id || '') !== ROOT_COMMENT_ID) errors.push(`${replyId} root_parent_id mismatch.`);
    if (String(reply.reply_to_comment_id || '') !== ROOT_COMMENT_ID) errors.push(`${replyId} reply_to_comment_id mismatch.`);
    if (String(reply.reply_to || '') !== '一级评论用户') errors.push(`${replyId} reply_to mismatch.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    work_rows: rows.works.length,
    comment_rows: rows.comments.length,
    reply_rows: rows.comments.filter((comment) => String(comment.parent_comment_id || '')).length,
  };
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  await runImport(parseImportArgs(importArgv(options)));
  if (!options.apply) {
    console.log('Fixture dry-run complete. Re-run with --apply to verify database rows.');
    return;
  }

  const rows = await loadFixtureRows(mergedDbConfig(options));
  const verification = verifyFixtureRows(rows);
  console.log(JSON.stringify({ fixture: 'douyin-replies', verification }, null, 2));
  console.log(`DOUYIN_SCRM_FIXTURE_VERIFICATION ${JSON.stringify(verification)}`);
  if (!verification.ok) {
    throw new Error(`Douyin fixture verification failed: ${verification.errors.join('; ')}`);
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
