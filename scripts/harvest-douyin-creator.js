#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DOUYIN_SOURCE_CREATOR_CENTER } from '../adapters/douyin/shared.js';
import { copyRuntimeDouyinAdapter } from './sync-douyin-runtime-comments.js';
import { ROOT_DIR } from './lib/runtime-config.js';
import { createChunkDecoder, withUtf8FriendlyEnv } from './lib/stdio-text.js';
import {
  checkpointCursor,
  checkpointPathFor,
  createCheckpoint,
  loadCheckpoint,
  markCheckpointItem,
  normalizeLongTaskOptions,
  parseLongTaskFlag,
  resetCheckpoint,
  saveCheckpoint,
  setCheckpointCursors,
} from '../runner/checkpoint.js';

const __filename = fileURLToPath(import.meta.url);
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const OPENCLI_MAIN_CANDIDATES = [
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'dist', 'src', 'main.js'),
];
const DEFAULT_OPENCLI_MAIN = OPENCLI_MAIN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || OPENCLI_MAIN_CANDIDATES[0];
const DEFAULT_OUTPUT_BASE = path.join(ROOT_DIR, 'samples', 'douyin');
const DEFAULT_USER_OPENCLI_DIR = path.join(os.homedir(), '.opencli');
const WORKSPACE_OPENCLI_DIR = path.join(ROOT_DIR, 'workspace', 'OpenCLI');
const TASK_EVENT_PREFIX = 'TASK_EVENT ';
const OPENCLI_PROGRESS_PREFIX = 'OPENCLI_PROGRESS ';

function emitTaskEvent(event = {}) {
  if (process.env.OPENCLI_TASK_EVENTS !== 'jsonl') return;
  console.error(`${TASK_EVENT_PREFIX}${JSON.stringify({
    type: 'progress',
    status: 'running',
    ...event,
  })}`);
}

function creatorHarvestDetailFromOptions(options = {}) {
  return {
    work_limit: parsePositiveInt(options.workLimit, 50),
    comment_work_limit: parsePositiveInt(options.commentWorkLimit, 50),
    comment_limit: parsePositiveInt(options.commentLimit, 50),
    comment_pages: parsePositiveInt(options.commentPages, 20),
    danmaku_work_limit: parsePositiveInt(options.danmakuWorkLimit, 20),
    danmaku_limit: parsePositiveInt(options.danmakuLimit, 50),
    danmaku_pages: parsePositiveInt(options.danmakuPages, 20),
    with_replies: Boolean(options.withReplies),
    reply_limit: parsePositiveInt(options.replyLimit, 50),
    reply_pages: parsePositiveInt(options.replyPages, 20),
  };
}

function creatorHarvestDetailFromReport(report = {}) {
  const counts = report.counts && typeof report.counts === 'object' ? report.counts : {};
  const summary = report.summary && typeof report.summary === 'object' ? report.summary : {};
  return {
    work_rows: Number(counts.work_rows || summary.work_count || 0),
    comment_rows: Number(counts.comment_rows || 0),
    top_level_comment_rows: Number(counts.top_level_comment_rows || 0),
    reply_comment_rows: Number(counts.reply_comment_rows || 0),
    danmaku_rows: Number(counts.danmaku_rows || 0),
    comment_target_count: Number(summary.comment_target_count || 0),
    matched_comment_target_count: Number(summary.matched_comment_target_count || 0),
    failed_comment_target_count: Number(summary.failed_comment_target_count || 0),
    danmaku_target_count: Number(summary.danmaku_target_count || 0),
    matched_danmaku_target_count: Number(summary.matched_danmaku_target_count || 0),
    failed_danmaku_target_count: Number(summary.failed_danmaku_target_count || 0),
  };
}

function syncRuntimeAdapters() {
  const results = [];
  const userSync = copyRuntimeDouyinAdapter({ opencliDir: DEFAULT_USER_OPENCLI_DIR });
  if (userSync) results.push(userSync.directory);
  const workspaceSync = copyRuntimeDouyinAdapter({
    opencliDir: WORKSPACE_OPENCLI_DIR,
    requireExistingRoot: true,
  });
  if (workspaceSync) results.push(workspaceSync.directory);
  return results;
}

export function formatShanghaiDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|y)$/i.test(String(value));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseArgs(argv) {
  const options = {
    date: formatShanghaiDate(),
    outputDir: '',
    opencliMain: DEFAULT_OPENCLI_MAIN,
    timeoutSeconds: 1200,
    workLimit: 50,
    commentWorkLimit: 50,
    commentLimit: 50,
    commentPages: 20,
    danmakuWorkLimit: 20,
    danmakuLimit: 50,
    danmakuPages: 20,
    withReplies: true,
    replyLimit: 50,
    replyPages: 20,
    metadataOnly: false,
    workIdsFile: '',
    commentWorkIdsFile: '',
    danmakuWorkIdsFile: '',
    full: false,
    batchSize: 50,
    maxItems: 0,
    resume: true,
    refresh: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const longTaskIndex = parseLongTaskFlag(argv, index, options);
    if (longTaskIndex >= index) {
      index = longTaskIndex;
      continue;
    }
    if (arg === '--date') options.date = argv[++index];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--opencli-main') options.opencliMain = path.resolve(argv[++index]);
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++index] || options.timeoutSeconds);
    else if (arg === '--work-limit') {
      options.workLimit = Number(argv[++index]);
      options.workLimitExplicit = true;
    }
    else if (arg === '--work-cursor') options.workCursor = argv[++index];
    else if (arg === '--comment-work-limit') {
      options.commentWorkLimit = Number(argv[++index]);
      options.commentWorkLimitExplicit = true;
    }
    else if (arg === '--comment-work-cursor') options.commentWorkCursor = argv[++index];
    else if (arg === '--comment-limit') options.commentLimit = Number(argv[++index]);
    else if (arg === '--comment-pages') options.commentPages = Number(argv[++index]);
    else if (arg === '--danmaku-work-limit') {
      options.danmakuWorkLimit = Number(argv[++index]);
      options.danmakuWorkLimitExplicit = true;
    }
    else if (arg === '--danmaku-work-cursor') options.danmakuWorkCursor = argv[++index];
    else if (arg === '--danmaku-limit') options.danmakuLimit = Number(argv[++index]);
    else if (arg === '--danmaku-pages') options.danmakuPages = Number(argv[++index]);
    else if (arg === '--with-replies') options.withReplies = true;
    else if (arg === '--without-replies') options.withReplies = false;
    else if (arg === '--reply-limit') options.replyLimit = Number(argv[++index]);
    else if (arg === '--reply-pages') options.replyPages = Number(argv[++index]);
    else if (arg === '--metadata-only') options.metadataOnly = true;
    else if (arg === '--work-ids-file') options.workIdsFile = path.resolve(argv[++index]);
    else if (arg === '--comment-work-ids-file') options.commentWorkIdsFile = path.resolve(argv[++index]);
    else if (arg === '--danmaku-work-ids-file') options.danmakuWorkIdsFile = path.resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printHelp() {
  console.log(`
Usage:
  node scripts/harvest-douyin-creator.js --date <YYYY-MM-DD> [options]

Options:
  --output-dir DIR              Output directory, default samples/douyin/<date>
  --work-limit N                Creator work rows to fetch, default 50
  --work-cursor CURSOR          Creator works pagination cursor, normally managed by --full checkpoint
  --comment-work-limit N        Creator comment targets to fetch, default 50
  --comment-work-cursor CURSOR  Creator comment target pagination cursor, normally managed by --full checkpoint
  --comment-limit N             Comments per target page, default 50
  --comment-pages N             Comment pages per target, default 20
  --danmaku-work-limit N        Creator danmaku targets to fetch, default 20
  --danmaku-work-cursor CURSOR  Creator danmaku target pagination cursor, normally managed by --full checkpoint
  --danmaku-limit N             Danmaku rows per target page, default 50
  --danmaku-pages N             Danmaku pages per target, default 20
  --with-replies                Fetch reply rows, default true
  --without-replies             Disable reply fetching
  --reply-limit N               Replies per page, default 50
  --reply-pages N               Reply pages per comment, default 20
  --metadata-only               Only fetch creator work metadata
  --work-ids-file PATH          JSON array of aweme_id/item_id values to keep
  --comment-work-ids-file PATH  JSON array of aweme_id/item_id values to fetch comments for
  --danmaku-work-ids-file PATH  JSON array of aweme_id/item_id values to fetch danmaku for
  --full                        Explicit full harvest mode with checkpointing
  --batch-size N                Full-mode batch size, default 50
  --max-items N                 Full-mode safety cap, default unlimited
  --no-resume                   Ignore existing checkpoint in full mode
  --refresh                     Clear checkpoint before a full-mode run
`);
}

function readWorkIdsFile(filePath) {
  if (!filePath) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${filePath} must contain a JSON array.`);
  return [...new Set(data.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function buildCreatorHarvestOpenCliArgs(options = {}) {
  const workIds = options.workIds || readWorkIdsFile(options.workIdsFile);
  const commentWorkIds = options.commentWorkIds || readWorkIdsFile(options.commentWorkIdsFile);
  const danmakuWorkIds = options.danmakuWorkIds || readWorkIdsFile(options.danmakuWorkIdsFile);
  return [
    'douyin',
    'skill-creator-harvest',
    '-f',
    'json',
    '--work_limit',
    String(parsePositiveInt(options.workLimit, 50)),
    ...(options.workCursor ? ['--work_cursor', String(options.workCursor)] : []),
    '--comment_work_limit',
    String(parsePositiveInt(options.commentWorkLimit, 50)),
    ...(options.commentWorkCursor ? ['--comment_work_cursor', String(options.commentWorkCursor)] : []),
    '--comment_limit',
    String(parsePositiveInt(options.commentLimit, 50)),
    '--comment_pages',
    String(parsePositiveInt(options.commentPages, 20)),
    '--danmaku_work_limit',
    String(parsePositiveInt(options.danmakuWorkLimit, 20)),
    ...(options.danmakuWorkCursor ? ['--danmaku_work_cursor', String(options.danmakuWorkCursor)] : []),
    '--danmaku_limit',
    String(parsePositiveInt(options.danmakuLimit, 50)),
    '--danmaku_pages',
    String(parsePositiveInt(options.danmakuPages, 20)),
    '--with_replies',
    String(Boolean(options.withReplies)),
    '--reply_limit',
    String(parsePositiveInt(options.replyLimit, 50)),
    '--reply_pages',
    String(parsePositiveInt(options.replyPages, 20)),
    ...(options.metadataOnly ? ['--metadata_only', 'true'] : []),
    ...(workIds.length ? ['--work_ids', JSON.stringify(workIds)] : []),
    ...(commentWorkIds.length ? ['--comment_work_ids', JSON.stringify(commentWorkIds)] : []),
    ...(danmakuWorkIds.length ? ['--danmaku_work_ids', JSON.stringify(danmakuWorkIds)] : []),
    ...(options.commentCursorMap ? ['--comment_cursor_map', JSON.stringify(options.commentCursorMap)] : []),
    ...(options.replyCursorMap ? ['--reply_cursor_map', JSON.stringify(options.replyCursorMap)] : []),
    ...(options.danmakuOffsetMap ? ['--danmaku_offset_map', JSON.stringify(options.danmakuOffsetMap)] : []),
  ];
}

export function mergeCreatorHarvestRowsByWorkId(existing = [], incoming = []) {
  const byWorkId = new Map();
  for (const row of existing) {
    const key = String(row?.aweme_id || row?.item_id || row?.title || '').trim();
    if (key) byWorkId.set(key, row);
  }
  for (const row of incoming) {
    const key = String(row?.aweme_id || row?.item_id || row?.title || '').trim();
    if (!key) continue;
    byWorkId.set(key, mergeCreatorHarvestRow(byWorkId.get(key), row));
  }
  return Array.from(byWorkId.values());
}

function creatorWorkCursorKey(row = {}) {
  return String(row.aweme_id || row.item_id || row.id || row.title || '').trim();
}

function mergeRowsByKey(existing = [], incoming = [], keyFn) {
  const byKey = new Map();
  for (const row of existing) {
    const key = keyFn(row);
    if (key) byKey.set(key, row);
  }
  for (const row of incoming) {
    const key = keyFn(row);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) || {}), ...row });
  }
  return Array.from(byKey.values());
}

function commentMergeKey(row = {}) {
  return String(row.comment_id || `${row.is_reply ? 'reply' : 'comment'}:${row.parent_comment_id || row.root_comment_id || ''}:${row.author || ''}:${row.text || ''}:${row.create_time || ''}`).trim();
}

function danmakuMergeKey(row = {}) {
  return String(row.danmaku_id || `${row.text || ''}:${row.create_time || ''}:${row.video_position_seconds || ''}`).trim();
}

function mergeCreatorHarvestRow(existing = {}, incoming = {}) {
  const hasComments = Array.isArray(existing.comments) || Array.isArray(incoming.comments);
  const hasDanmaku = Array.isArray(existing.danmaku) || Array.isArray(incoming.danmaku);
  const comments = mergeRowsByKey(
    Array.isArray(existing.comments) ? existing.comments : [],
    Array.isArray(incoming.comments) ? incoming.comments : [],
    commentMergeKey,
  );
  const danmaku = mergeRowsByKey(
    Array.isArray(existing.danmaku) ? existing.danmaku : [],
    Array.isArray(incoming.danmaku) ? incoming.danmaku : [],
    danmakuMergeKey,
  );
  const errors = [
    ...new Set([
      ...(Array.isArray(existing.creator_harvest_errors) ? existing.creator_harvest_errors : []),
      ...(Array.isArray(incoming.creator_harvest_errors) ? incoming.creator_harvest_errors : []),
    ]),
  ];
  const next = {
    ...existing,
    ...incoming,
  };
  if (hasComments) next.comments = comments;
  if (hasDanmaku) next.danmaku = danmaku;
  if (errors.length) next.creator_harvest_errors = errors;
  return next;
}

export function collectCreatorDetailCursors(rows = []) {
  const cursors = {};
  for (const row of rows) {
    const workKey = creatorWorkCursorKey(row);
    if (!workKey) continue;

    const comments = Array.isArray(row.comments) ? row.comments : [];
    const topLevelComments = comments.filter((comment) => !comment.is_reply);
    const lastTopLevelComment = topLevelComments[topLevelComments.length - 1];
    if (lastTopLevelComment) {
      cursors[`creator.comments_by_item.${workKey}`] = String(lastTopLevelComment.next_cursor || '');
      cursors[`creator.comments_by_item.${workKey}.has_more`] = Boolean(lastTopLevelComment.has_more);
    }

    const repliesByParent = new Map();
    for (const reply of comments.filter((comment) => comment.is_reply)) {
      const parentKey = String(reply.parent_comment_id || reply.root_comment_id || reply.reply_to_comment_id || '').trim();
      if (parentKey) repliesByParent.set(parentKey, reply);
    }
    for (const [parentKey, reply] of repliesByParent.entries()) {
      cursors[`creator.replies_by_comment.${parentKey}`] = String(reply.next_cursor || '');
      cursors[`creator.replies_by_comment.${parentKey}.has_more`] = Boolean(reply.has_more);
    }

    const danmaku = Array.isArray(row.danmaku) ? row.danmaku : [];
    const lastDanmaku = danmaku[danmaku.length - 1];
    if (lastDanmaku) {
      cursors[`creator.danmaku_by_item.${workKey}`] = String(lastDanmaku.next_offset || '');
      cursors[`creator.danmaku_by_item.${workKey}.has_more`] = Boolean(lastDanmaku.has_more);
    }
  }
  return cursors;
}

export function extractCreatorDetailCursorMaps(checkpoint = {}) {
  const cursors = checkpoint?.cursors && typeof checkpoint.cursors === 'object' ? checkpoint.cursors : {};
  const maps = {
    commentCursorMap: {},
    replyCursorMap: {},
    danmakuOffsetMap: {},
  };
  for (const [key, value] of Object.entries(cursors)) {
    if (key.endsWith('.has_more') || !value) continue;
    if (key.startsWith('creator.comments_by_item.') && cursors[`${key}.has_more`] === true) {
      maps.commentCursorMap[key.slice('creator.comments_by_item.'.length)] = value;
    } else if (key.startsWith('creator.replies_by_comment.') && cursors[`${key}.has_more`] === true) {
      maps.replyCursorMap[key.slice('creator.replies_by_comment.'.length)] = value;
    } else if (key.startsWith('creator.danmaku_by_item.') && cursors[`${key}.has_more`] === true) {
      maps.danmakuOffsetMap[key.slice('creator.danmaku_by_item.'.length)] = value;
    }
  }
  return Object.fromEntries(Object.entries(maps).filter(([, map]) => Object.keys(map).length > 0));
}

function hasPendingCreatorDetailCursors(checkpoint = {}) {
  return Object.keys(extractCreatorDetailCursorMaps(checkpoint)).length > 0;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function resolveCreatorOutputDir(options) {
  if (!options.outputDir) return path.join(DEFAULT_OUTPUT_BASE, options.date);
  if (samePath(options.outputDir, DEFAULT_OUTPUT_BASE)) {
    return path.join(DEFAULT_OUTPUT_BASE, options.date);
  }
  return options.outputDir;
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT_DIR,
      env: withUtf8FriendlyEnv(options.env ?? process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const stdoutDecoder = createChunkDecoder();
    const stderrDecoder = createChunkDecoder();
    const timer = options.timeoutMs
      ? setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command} ${args.join(' ')}`));
      }, options.timeoutMs)
      : null;
    child.stdout.on('data', (chunk) => {
      const text = stdoutDecoder.decode(chunk);
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.decode(chunk);
      stderr += text;
      options.onStderr?.(text);
    });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const stdoutTail = stdoutDecoder.flush();
      const stderrTail = stderrDecoder.flush();
      if (stdoutTail) {
        stdout += stdoutTail;
        options.onStdout?.(stdoutTail);
      }
      if (stderrTail) {
        stderr += stderrTail;
        options.onStderr?.(stderrTail);
      }
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

function parseJsonOutput(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '').trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`Failed to parse creator harvest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function buildCreatorHarvestReport(rows = [], options = {}, files = {}) {
  const comments = rows.flatMap((row) => Array.isArray(row.comments) ? row.comments : []);
  const danmaku = rows.flatMap((row) => Array.isArray(row.danmaku) ? row.danmaku : []);
  const errors = rows.flatMap((row) => Array.isArray(row.creator_harvest_errors) ? row.creator_harvest_errors : []);
  const unmatchedCommentTargetRows = rows.filter((row) => (row.creator_harvest_errors || []).includes('creator_comment_target_unmatched_to_work_list'));
  const unmatchedDanmakuTargetRows = rows.filter((row) => (row.creator_harvest_errors || []).includes('creator_danmaku_target_unmatched_to_work_list'));
  const commentTargetRows = rows.filter((row) => row.creator_comment_item_id || row.creator_comment_aweme_id || (row.creator_harvest_errors || []).includes('creator_comment_target_unmatched_to_work_list'));
  const danmakuTargetRows = rows.filter((row) => row.creator_danmaku_item_id || row.creator_danmaku_aweme_id || (row.creator_harvest_errors || []).includes('creator_danmaku_target_unmatched_to_work_list'));
  const sourcePaths = [...new Set(rows.map((row) => row.source_url_path).filter(Boolean))];
  const commentSourcePaths = [...new Set(comments.map((row) => row.source_url_path).filter(Boolean))];
  const danmakuSourcePaths = [...new Set(danmaku.map((row) => row.source_url_path).filter(Boolean))];
  const topLevelComments = comments.filter((row) => !row.is_reply);
  const replyFetchStatusCounts = topLevelComments.reduce((counts, row) => {
    const status = String(row.reply_fetch_status || 'unknown');
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  return {
    status: errors.length ? 'partial' : 'complete',
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    date: options.date,
    output_file: files.outputFile || '',
    report_file: files.reportFile || '',
    counts: {
      work_rows: rows.length,
      comment_rows: comments.length,
      danmaku_rows: danmaku.length,
      top_level_comment_rows: topLevelComments.length,
      reply_comment_rows: comments.filter((row) => row.is_reply).length,
      rows_with_comments: rows.filter((row) => Array.isArray(row.comments) && row.comments.length > 0).length,
      rows_with_danmaku: rows.filter((row) => Array.isArray(row.danmaku) && row.danmaku.length > 0).length,
      unmatched_comment_target_rows: unmatchedCommentTargetRows.length,
      unmatched_danmaku_target_rows: unmatchedDanmakuTargetRows.length,
      reply_fetch_status_counts: replyFetchStatusCounts,
    },
    summary: {
      work_count: rows.length,
      comment_target_count: commentTargetRows.length,
      matched_comment_target_count: Math.max(0, commentTargetRows.length - unmatchedCommentTargetRows.length),
      failed_comment_target_count: errors.length,
      danmaku_target_count: danmakuTargetRows.length,
      matched_danmaku_target_count: Math.max(0, danmakuTargetRows.length - unmatchedDanmakuTargetRows.length),
      failed_danmaku_target_count: errors.length,
    },
    source_url_paths: sourcePaths,
    comment_source_url_paths: commentSourcePaths,
    danmaku_source_url_paths: danmakuSourcePaths,
    warnings: errors,
  };
}

async function runDouyinCreatorHarvestOnce(inputOptions) {
  const options = { ...inputOptions };
  const outputDir = resolveCreatorOutputDir(options);
  const outputFile = path.join(outputDir, 'creator-harvest.json');
  const batchOutputFile = path.join(outputDir, 'creator-harvest-batch.json');
  const reportFile = path.join(outputDir, 'creator-harvest-report.json');
  ensureDir(outputDir);
  const longTask = normalizeLongTaskOptions(options);
  const checkpointFile = checkpointPathFor(outputDir);
  let checkpoint = null;
  if (longTask.full) {
    if (longTask.refresh || !longTask.resume) resetCheckpoint(checkpointFile);
    checkpoint = longTask.resume ? loadCheckpoint(checkpointFile) : null;
    if (checkpoint) {
      emitTaskEvent({
        step: 'resume-detected',
        message: `发现上次断点，将从第 ${Number(checkpoint.current_batch || 0) + 1} 批继续`,
        output_dir: outputDir,
        checkpoint_file: checkpointFile,
        detail: checkpoint,
      });
    } else {
      checkpoint = createCheckpoint({
        platform: 'douyin',
        task: 'creator-content',
        full: true,
        batchSize: longTask.batchSize,
        maxItems: longTask.maxItems,
      });
    }
    checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    const completedBefore = Number(checkpoint.completed_count || 0);
    const pendingDetailMaps = extractCreatorDetailCursorMaps(checkpoint);
    const hasPendingDetails = Object.keys(pendingDetailMaps).length > 0;
    if (longTask.maxItems > 0 && completedBefore >= longTask.maxItems && !hasPendingDetails) {
      checkpoint = saveCheckpoint(checkpointFile, {
        ...checkpoint,
        has_more: false,
        status: 'complete',
      });
      emitTaskEvent({
        step: 'full-complete',
        status: 'success',
        message: `已达到全量上限 ${longTask.maxItems} 个作品`,
        output_dir: outputDir,
        checkpoint_file: checkpointFile,
        detail: checkpoint,
      });
      const rows = readJsonIfExists(outputFile) || [];
      const report = buildCreatorHarvestReport(Array.isArray(rows) ? rows : [], options, { outputFile, reportFile });
      writeJson(reportFile, report);
      return { rows: Array.isArray(rows) ? rows : [], report, outputFile, reportFile };
    }
    const remainingItems = longTask.maxItems > 0 ? Math.max(0, longTask.maxItems - completedBefore) : longTask.batchSize;
    const batchLimit = longTask.maxItems > 0 ? Math.min(longTask.batchSize, remainingItems) : longTask.batchSize;
    if (!options.workLimitExplicit) options.workLimit = batchLimit;
    if (!options.commentWorkLimitExplicit) options.commentWorkLimit = batchLimit;
    if (!options.danmakuWorkLimitExplicit) options.danmakuWorkLimit = batchLimit;
    options.workCursor = String(checkpointCursor(checkpoint, 'creator.works', '') || '');
    options.commentWorkCursor = String(checkpointCursor(checkpoint, 'creator.comment_targets', '') || '');
    options.danmakuWorkCursor = String(checkpointCursor(checkpoint, 'creator.danmaku_targets', '') || '');
    Object.assign(options, pendingDetailMaps);
    emitTaskEvent({
      step: 'full-start',
      message: `全量采集已启动：每批 ${longTask.batchSize} 个${longTask.maxItems ? `，最多 ${longTask.maxItems} 个` : ''}`,
      output_dir: outputDir,
      checkpoint_file: checkpointFile,
      detail: checkpoint,
    });
    emitTaskEvent({
      step: 'batch-start',
      message: `第 ${Number(checkpoint.current_batch || 0) + 1} 批开始`,
      output_dir: outputDir,
      checkpoint_file: checkpointFile,
      detail: {
        ...checkpoint,
        current_batch: Number(checkpoint.current_batch || 0) + 1,
      },
    });
  }
  syncRuntimeAdapters();

  emitTaskEvent({
    step: 'creator-harvest',
    message: `抖音创作者中心汇总开始：作品目标 ${parsePositiveInt(options.workLimit, 50)}，评论对象 ${parsePositiveInt(options.commentWorkLimit, 50)}，弹幕对象 ${parsePositiveInt(options.danmakuWorkLimit, 20)}`,
    output_dir: outputDir,
    detail: creatorHarvestDetailFromOptions(options),
  });

  const args = [
    RUN_OPENCLI_SCRIPT,
    options.opencliMain,
    ...buildCreatorHarvestOpenCliArgs(options),
  ];
  emitTaskEvent({
    step: 'opencli-command',
    message: '正在打开抖音创作者中心，等待页面返回作品、评论和弹幕数据',
    output_dir: outputDir,
    detail: creatorHarvestDetailFromOptions(options),
  });
  let lastProgressAt = Date.now();
  const startedWaitingAt = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - lastProgressAt < 8000) return;
    emitTaskEvent({
      step: 'waiting',
      message: `还在采集中，页面可能正在加载或翻页，已等待 ${Math.round((Date.now() - startedWaitingAt) / 1000)} 秒`,
      output_dir: outputDir,
      detail: creatorHarvestDetailFromOptions(options),
    });
    lastProgressAt = Date.now();
  }, 5000);
  const result = await runCommand(process.execPath, args, {
    cwd: ROOT_DIR,
    timeoutMs: Number(options.timeoutSeconds || 1200) * 1000,
    onStderr: (text) => {
      if (String(text || '').includes(OPENCLI_PROGRESS_PREFIX)) lastProgressAt = Date.now();
      process.stderr.write(text);
    },
  }).finally(() => clearInterval(heartbeat));
  const batchRows = parseJsonOutput(result.stdout);
  let rows = batchRows;
  if (checkpoint) {
    writeJson(batchOutputFile, batchRows);
    const existingRows = readJsonIfExists(outputFile);
    rows = mergeCreatorHarvestRowsByWorkId(Array.isArray(existingRows) ? existingRows : [], batchRows);
  }
  if (checkpoint) {
    const currentBatch = Number(checkpoint.current_batch || 0) + 1;
    const workNextCursor = batchRows.find((row) => row.next_cursor)?.next_cursor || '';
    const workHasMore = batchRows.some((row) => row.has_more);
    const commentTargetNextCursor = batchRows.find((row) => row.creator_comment_target_next_cursor)?.creator_comment_target_next_cursor || '';
    const commentTargetHasMore = batchRows.some((row) => row.creator_comment_target_has_more);
    const danmakuTargetNextCursor = batchRows.find((row) => row.creator_danmaku_target_next_cursor)?.creator_danmaku_target_next_cursor || '';
    const danmakuTargetHasMore = batchRows.some((row) => row.creator_danmaku_target_has_more);
    const detailCursors = collectCreatorDetailCursors(batchRows);
    checkpoint = {
      ...checkpoint,
      current_batch: currentBatch,
    };
    for (const row of batchRows) {
      checkpoint = markCheckpointItem(
        checkpoint,
        row.aweme_id || row.item_id || row.id || row.title,
        { title: row.title || '', fetched_at: new Date().toISOString() },
      );
    }
    checkpoint = setCheckpointCursors(checkpoint, {
      'creator.works': workNextCursor,
      'creator.works.has_more': workHasMore,
      'creator.comment_targets': commentTargetNextCursor,
      'creator.comment_targets.has_more': commentTargetHasMore,
      'creator.danmaku_targets': danmakuTargetNextCursor,
      'creator.danmaku_targets.has_more': danmakuTargetHasMore,
      ...detailCursors,
    });
    checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    const listHasMore = workHasMore || commentTargetHasMore || danmakuTargetHasMore;
    const reachedMaxItems = longTask.maxItems > 0 && Number(checkpoint.completed_count || 0) >= longTask.maxItems;
    const detailHasMore = hasPendingCreatorDetailCursors(checkpoint);
    const hasMore = (listHasMore && !reachedMaxItems) || detailHasMore;
    const status = hasMore ? 'running' : 'complete';
    checkpoint = saveCheckpoint(checkpointFile, {
      ...checkpoint,
      has_more: hasMore && !reachedMaxItems,
      status,
    });
    emitTaskEvent({
      step: 'batch-complete',
      status: 'success',
      message: `第 ${currentBatch} 批完成，本批 ${batchRows.length} 个作品，累计 ${rows.length} 个作品`,
      output_dir: outputDir,
      checkpoint_file: checkpointFile,
      detail: {
        ...checkpoint,
        batch_items: batchRows.length,
        total_items: rows.length,
      },
    });
    emitTaskEvent({
      step: 'checkpoint-saved',
      status: 'success',
      message: '断点已保存，下次可以继续',
      output_dir: outputDir,
      checkpoint_file: checkpointFile,
      detail: checkpoint,
    });
    if (status === 'complete') {
      emitTaskEvent({
        step: 'full-complete',
        status: 'success',
        message: reachedMaxItems ? `已达到全量上限 ${longTask.maxItems} 个作品，且已处理当前明细断点` : '抖音创作者中心已经没有更多作品和明细页',
        output_dir: outputDir,
        checkpoint_file: checkpointFile,
        detail: checkpoint,
      });
    }
  }
  emitTaskEvent({
    step: 'parse-output',
    status: 'success',
    message: `页面数据已返回，正在整理 ${rows.length} 个作品`,
    output_dir: outputDir,
    detail: { work_rows: rows.length },
  });
  writeJson(outputFile, rows);
  const report = buildCreatorHarvestReport(rows, options, { outputFile, reportFile });
  writeJson(reportFile, report);
  emitTaskEvent({
    step: 'write-artifacts',
    status: 'success',
    message: '采集结果已整理完成，准备进入入库或后续处理',
    output_dir: outputDir,
    report_file: reportFile,
    detail: creatorHarvestDetailFromReport(report),
  });

  emitTaskEvent({
    step: 'creator-harvest',
    status: 'success',
    message: `抖音创作者中心汇总完成：作品 ${report.counts.work_rows}，评论 ${report.counts.comment_rows}，弹幕 ${report.counts.danmaku_rows}`,
    output_dir: outputDir,
    report_file: reportFile,
    detail: creatorHarvestDetailFromReport(report),
  });

  return { rows, report, outputFile, reportFile };
}

export async function runDouyinCreatorHarvest(options) {
  const longTask = normalizeLongTaskOptions(options);
  if (!longTask.full) return runDouyinCreatorHarvestOnce(options);

  const outputDir = resolveCreatorOutputDir(options);
  const checkpointFile = checkpointPathFor(outputDir);
  const loopLimit = longTask.maxItems > 0
    ? Math.ceil(longTask.maxItems / Math.max(1, longTask.batchSize)) + 50
    : 1000;
  let result = null;

  for (let batchIndex = 0; batchIndex < loopLimit; batchIndex += 1) {
    result = await runDouyinCreatorHarvestOnce({
      ...options,
      refresh: batchIndex === 0 ? options.refresh : false,
    });
    const checkpoint = loadCheckpoint(checkpointFile);
    if (!checkpoint || checkpoint.status === 'complete' || checkpoint.has_more === false) break;
    if (batchIndex === loopLimit - 1) {
      throw new Error(`Douyin creator full harvest stopped after ${loopLimit} batches to avoid an endless loop. Check ${checkpointFile}.`);
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exit(0);
    }
    options.workLimit = parsePositiveInt(options.workLimit, 50);
    options.commentWorkLimit = parsePositiveInt(options.commentWorkLimit, 50);
    options.commentLimit = parsePositiveInt(options.commentLimit, 50);
    options.commentPages = parsePositiveInt(options.commentPages, 20);
    options.danmakuWorkLimit = parsePositiveInt(options.danmakuWorkLimit, 20);
    options.danmakuLimit = parsePositiveInt(options.danmakuLimit, 50);
    options.danmakuPages = parsePositiveInt(options.danmakuPages, 20);
    options.replyLimit = parsePositiveInt(options.replyLimit, 50);
    options.replyPages = parsePositiveInt(options.replyPages, 20);
    options.withReplies = parseBoolean(options.withReplies, true);
    Object.assign(options, normalizeLongTaskOptions(options));
    const { report } = await runDouyinCreatorHarvest(options);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
