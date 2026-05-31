#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import {
  DEFAULT_CONFIG_PATH,
  ROOT_DIR,
  loadLocalConfig,
  platformAccounts,
  platformConfig,
} from './platform-config.js';
import { DOUYIN_SOURCE_PUBLIC, normalizeDouyinVideo } from '../adapters/douyin/shared.js';
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
const OPENCLI_MAIN_CANDIDATES = [
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'dist', 'src', 'main.js'),
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
];
const DEFAULT_OPENCLI_MAIN = OPENCLI_MAIN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || OPENCLI_MAIN_CANDIDATES[0];
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const DEFAULT_OUTPUT_BASE = path.join(ROOT_DIR, 'samples', 'douyin');
const TASK_EVENT_PREFIX = 'TASK_EVENT ';

function emitTaskEvent(event = {}) {
  if (process.env.OPENCLI_TASK_EVENTS !== 'jsonl') return;
  console.error(`${TASK_EVENT_PREFIX}${JSON.stringify({
    type: 'progress',
    status: 'running',
    ...event,
  })}`);
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
    config: DEFAULT_CONFIG_PATH,
    date: formatShanghaiDate(),
    outputDir: '',
    opencliMain: DEFAULT_OPENCLI_MAIN,
    timeoutSeconds: 1200,
    accountIds: [],
    videoLimit: undefined,
    commentLimit: undefined,
    withReplies: undefined,
    importScrm: false,
    importScrmApply: false,
    refresh: false,
    retryCount: 1,
    workComments: false,
    workCommentLimit: undefined,
    workCommentPages: undefined,
    workReplyLimit: undefined,
    workReplyPages: undefined,
    strictWorkComments: false,
    retryFailedWorkComments: false,
    full: false,
    batchSize: 50,
    maxItems: 0,
    resume: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const longTaskIndex = parseLongTaskFlag(argv, i, options);
    if (longTaskIndex >= i) {
      i = longTaskIndex;
      continue;
    }
    if (arg === '--config') options.config = path.resolve(argv[++i]);
    else if (arg === '--date') options.date = argv[++i];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++i]);
    else if (arg === '--opencli-main') options.opencliMain = path.resolve(argv[++i]);
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++i] || options.timeoutSeconds);
    else if (arg === '--account') options.accountIds.push(argv[++i]);
    else if (arg === '--video-limit') options.videoLimit = Number(argv[++i]);
    else if (arg === '--comment-limit') options.commentLimit = Number(argv[++i]);
    else if (arg === '--with-replies') options.withReplies = true;
    else if (arg === '--without-replies') options.withReplies = false;
    else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--retry') options.retryCount = Number(argv[++i] ?? options.retryCount);
    else if (arg === '--work-comments') options.workComments = true;
    else if (arg === '--work-comment-limit') options.workCommentLimit = Number(argv[++i]);
    else if (arg === '--work-comment-pages') options.workCommentPages = Number(argv[++i]);
    else if (arg === '--work-reply-limit') options.workReplyLimit = Number(argv[++i]);
    else if (arg === '--work-reply-pages') options.workReplyPages = Number(argv[++i]);
    else if (arg === '--strict-work-comments') options.strictWorkComments = true;
    else if (arg === '--retry-failed-work-comments') {
      options.retryFailedWorkComments = true;
      options.workComments = true;
    }
    else if (arg === '--import-scrm') options.importScrm = true;
    else if (arg === '--import-scrm-apply') {
      options.importScrm = true;
      options.importScrmApply = true;
    }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    ...options,
    ...normalizeLongTaskOptions(options),
  };
}

export function resolveAccountRunOptions(account, defaults = {}, cliOptions = {}) {
  return {
    videoLimit: parsePositiveInt(cliOptions.videoLimit ?? account.video_limit ?? defaults.video_limit, 10),
    commentLimit: parsePositiveInt(cliOptions.commentLimit ?? account.comment_limit ?? defaults.comment_limit, 10),
    withReplies: parseBoolean(cliOptions.withReplies ?? account.with_replies ?? defaults.with_replies, true),
    cursor: String(cliOptions.cursor ?? ''),
  };
}

export function resolveAccountSecUid(account) {
  const secUid = String(account.sec_uid || '').trim();
  if (secUid) return secUid;
  const identifier = String(account.identifier || '').trim();
  if (/^MS4w/i.test(identifier)) return identifier;
  const match = identifier.match(/\/user\/([^/?#]+)/);
  if (match?.[1]) return match[1];
  throw new Error(`douyin account "${account.id}" must provide sec_uid or a /user/<sec_uid> identifier.`);
}

export function buildHarvestArgs(account, runOptions) {
  const secUid = resolveAccountSecUid(account);
  return [
    'douyin',
    'skill-harvest',
    '--sec_uid',
    secUid,
    '--video_limit',
    String(runOptions.videoLimit),
    ...(runOptions.cursor ? ['--cursor', String(runOptions.cursor)] : []),
    '--comment_limit',
    String(runOptions.commentLimit),
    '--comment_pages',
    '1',
    '--comment_reply_limit',
    String(runOptions.commentLimit),
    '--comment_reply_pages',
    '1',
    '--with_replies',
    String(Boolean(runOptions.withReplies)),
    '-f',
    'json',
  ];
}

function resolveConfiguredDouyinAccountId(account = {}) {
  const explicit = String(account.account_id || '').trim();
  if (explicit) return explicit;
  const identifier = String(account.identifier || '').trim();
  if (!identifier) return '';
  if (/^https?:\/\//i.test(identifier)) return '';
  if (/^MS4w/i.test(identifier)) return '';
  return identifier;
}

export function buildWorkCommentsArgs(work, runOptions) {
  const awemeId = String(work.aweme_id || '').trim();
  if (!awemeId) throw new Error('aweme_id is required for work comment enrichment.');
  const args = [
    'douyin',
    'skill-comments',
    awemeId,
    '--limit',
    String(runOptions.commentLimit),
    '--with_replies',
    String(Boolean(runOptions.withReplies)),
    '-f',
    'json',
  ];
  if (runOptions.commentPages) {
    args.splice(args.length - 2, 0, '--pages', String(runOptions.commentPages));
  }
  if (runOptions.withReplies && runOptions.replyLimit) {
    args.splice(args.length - 2, 0, '--reply_limit', String(runOptions.replyLimit));
  }
  if (runOptions.withReplies && runOptions.replyPages) {
    args.splice(args.length - 2, 0, '--reply_pages', String(runOptions.replyPages));
  }
  return args;
}

function syntheticCommentId(awemeId, comment, index) {
  const digest = crypto
    .createHash('sha1')
    .update(`${awemeId}\0${comment.nickname || comment.author || ''}\0${comment.text || ''}\0${index}`)
    .digest('hex')
    .slice(0, 16);
  return `${awemeId}:top:${digest}`;
}

export function normalizeOpenCliUserVideo(row, index = 0) {
  const normalizedVideo = normalizeDouyinVideo(row);
  const awemeId = String(normalizedVideo.aweme_id || row.aweme_id || row.id || '').trim();
  const topComments = Array.isArray(row.comments)
    ? row.comments
    : Array.isArray(row.top_comments)
      ? row.top_comments
      : [];
  return {
    ...normalizedVideo,
    aweme_id: awemeId || `douyin-row-${index + 1}`,
    uid: String(row.uid || '').trim(),
    sec_uid: String(row.sec_uid || '').trim(),
    unique_id: String(row.unique_id || '').trim(),
    nickname: String(row.nickname || '').trim(),
    profile_url: String(row.profile_url || '').trim(),
    comment_count: Number(row.comment_count || topComments.length || 0),
    has_more: Boolean(row.has_more),
    next_cursor: String(row.next_cursor || ''),
    comments: topComments.map((comment, commentIndex) => normalizeCommentRow(comment, awemeId, commentIndex)),
  };
}

export function normalizeOpenCliUserVideos(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => normalizeOpenCliUserVideo(row, index));
}

function normalizeCommentRow(comment, awemeId, fallbackIndex = 0) {
  return {
    data_source: comment.data_source || comment.source || DOUYIN_SOURCE_PUBLIC,
    comment_id: comment.comment_id || comment.cid || syntheticCommentId(awemeId, comment, fallbackIndex),
    aweme_id: comment.aweme_id || awemeId,
    author: comment.author || comment.nickname || '',
    avatar_url: comment.avatar_url || '',
    text: comment.text || '',
    time: comment.time || '',
    ip_location: comment.ip_location || '',
    digg_count: Number(comment.digg_count || 0),
    reply_count: Number(comment.reply_count || 0),
    reply_to: comment.reply_to || '',
    reply_to_comment_id: comment.reply_to_comment_id || '',
    parent_comment_id: comment.parent_comment_id || '',
    root_comment_id: comment.root_comment_id || '',
    is_reply: Boolean(comment.is_reply),
    fetched_reply_count: Number(comment.fetched_reply_count || 0),
    reply_fetch_status: comment.reply_fetch_status || '',
    reply_fetch_error: comment.reply_fetch_error || '',
  };
}

function commentContentKey(comment) {
  return [
    String(comment.aweme_id || ''),
    String(comment.author || '').trim(),
    String(comment.text || '').trim(),
    String(Boolean(comment.is_reply)),
  ].join('\0');
}

export function mergeWorkComments(existingComments = [], fetchedComments = [], awemeId = '') {
  const byId = new Map();
  const syntheticIdByContent = new Map();

  for (const comment of existingComments) {
    const normalized = normalizeCommentRow(comment, awemeId, byId.size);
    if (!normalized.comment_id) continue;
    byId.set(normalized.comment_id, normalized);
    if (String(normalized.comment_id).includes(':top:')) {
      syntheticIdByContent.set(commentContentKey(normalized), normalized.comment_id);
    }
  }

  for (const comment of fetchedComments) {
    const normalized = normalizeCommentRow(comment, awemeId, byId.size);
    if (!normalized.comment_id) continue;
    const syntheticId = syntheticIdByContent.get(commentContentKey(normalized));
    if (syntheticId && syntheticId !== normalized.comment_id) {
      byId.delete(syntheticId);
      syntheticIdByContent.delete(commentContentKey(normalized));
    }
    byId.set(normalized.comment_id, normalized);
  }
  return Array.from(byId.values());
}

export function mergeDouyinHarvestRowsByAwemeId(existing = [], incoming = []) {
  const byAwemeId = new Map();
  for (const row of existing) {
    const key = String(row?.aweme_id || '').trim();
    if (key) byAwemeId.set(key, row);
  }
  for (const row of incoming) {
    const key = String(row?.aweme_id || '').trim();
    if (!key) continue;
    byAwemeId.set(key, { ...(byAwemeId.get(key) || {}), ...row });
  }
  return Array.from(byAwemeId.values());
}

function hasDouyinPublicMore(checkpoint = {}, accounts = []) {
  return accounts.some((account) => checkpointCursor(checkpoint, `accounts.${account.id}.has_more`, false) === true);
}

export function buildWorkCommentsRecoveryHint(errorMessage = '') {
  const message = String(errorMessage ?? '');
  if (!message.includes("unknown command 'skill-comments'")
    && !message.includes("unknown command 'comments'")
    && !message.includes('error: unknown command')) {
    return '';
  }

  return 'Run node scripts/sync-douyin-runtime-comments.js to expose douyin runtime adapters in the local OpenCLI runtime.';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
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

function countComments(rows) {
  return rows.reduce((total, row) => total + (Array.isArray(row.comments) ? row.comments.length : 0), 0);
}

function countImageTexts(rows) {
  return rows.filter((row) => Number(row.file_type) === 2).length;
}

export function buildDouyinRunReport({
  account,
  runOptions,
  command,
  harvestPath,
  rows = [],
  importOutputFile = '',
  importSummary = '',
  imported = false,
  importApplied = false,
  failureSamplesFile = '',
  attempt = 1,
  maxAttempts = 1,
  resumedFromExisting = false,
  startedAt,
  finishedAt,
  status = 'success',
  error = '',
}) {
  return {
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    platform: 'douyin',
    data_source: DOUYIN_SOURCE_PUBLIC,
    account: {
      id: account.id,
      label: account.label,
    },
    command,
    attempt,
    max_attempts: maxAttempts,
    resumed_from_existing: resumedFromExisting,
    run_options: {
      video_limit: runOptions.videoLimit,
      comment_limit: runOptions.commentLimit,
      with_comments: Boolean(runOptions.withReplies),
    },
    output: {
      harvest_file: harvestPath,
      import_output_file: importOutputFile,
      failure_samples_file: failureSamplesFile,
    },
    counts: {
      work_rows: rows.length,
      comment_rows: countComments(rows),
      image_text_rows: countImageTexts(rows),
    },
    import: {
      enabled: imported,
      applied: importApplied,
      summary: importSummary,
    },
    comment_enrichment: rows.comment_enrichment || null,
    ...(error ? { error } : {}),
  };
}

export function collectDouyinFailureSamples(report) {
  const account = report?.account || {};
  const samples = [];
  if (report?.status === 'failed' && report.error) {
    samples.push({
      scope: 'account',
      account_id: account.id || '',
      label: account.label || '',
      command: report.command || '',
      attempt: report.attempt || 1,
      max_attempts: report.max_attempts || 1,
      error: report.error,
    });
  }

  const enrichmentErrors = Array.isArray(report?.comment_enrichment?.errors)
    ? report.comment_enrichment.errors
    : [];
  for (const item of enrichmentErrors) {
    samples.push({
      scope: 'work_comments',
      account_id: account.id || '',
      label: account.label || '',
      aweme_id: item.aweme_id || '',
      command: item.command || '',
      error: item.error || '',
      ...(item.recovery ? { recovery: item.recovery } : {}),
    });
  }
  return samples;
}

export function collectFailedWorkCommentAwemeIds(failureSamples) {
  const samples = Array.isArray(failureSamples?.samples) ? failureSamples.samples : [];
  return [...new Set(samples
    .filter((item) => item?.scope === 'work_comments')
    .map((item) => String(item.aweme_id || '').trim())
    .filter(Boolean))];
}

function syncFailureSamples(failureSamplesPath, report) {
  const samples = collectDouyinFailureSamples(report);
  if (samples.length === 0) {
    if (fs.existsSync(failureSamplesPath)) fs.unlinkSync(failureSamplesPath);
    return '';
  }
  writeJson(failureSamplesPath, {
    generated_at: new Date().toISOString(),
    platform: 'douyin',
    account: report.account,
    samples,
  });
  return failureSamplesPath;
}

export function reportMatchesRunOptions(report, runOptions) {
  return Number(report?.run_options?.video_limit) === Number(runOptions.videoLimit)
    && Number(report?.run_options?.comment_limit) === Number(runOptions.commentLimit)
    && Boolean(report?.run_options?.with_comments) === Boolean(runOptions.withReplies);
}

export function reportSatisfiesImportRequest(report, options) {
  if (!options.importScrm) return true;
  return Boolean(report?.import?.enabled) === true
    && Boolean(report?.import?.applied) === Boolean(options.importScrmApply);
}

export function reportSatisfiesWorkCommentsRequest(report, options, runOptions) {
  if (!options.workComments) return true;
  const enrichment = report?.comment_enrichment;
  const expectedLimit = parsePositiveInt(options.workCommentLimit ?? runOptions.commentLimit, runOptions.commentLimit);
  const expectedPages = parsePositiveInt(options.workCommentPages ?? 1, 1);
  const expectedReplyLimit = parsePositiveInt(options.workReplyLimit ?? expectedLimit, expectedLimit);
  const expectedReplyPages = parsePositiveInt(options.workReplyPages ?? 1, 1);
  const baseMatches = Boolean(enrichment?.enabled) === true
    && enrichment?.status === 'ok'
    && Number(enrichment?.limit_per_page) === expectedLimit
    && Number(enrichment?.max_pages) === expectedPages;
  if (!baseMatches) return false;
  if (!runOptions.withReplies) return true;
  return Number(enrichment?.reply_limit_per_page) === expectedReplyLimit
    && Number(enrichment?.max_reply_pages) === expectedReplyPages;
}

export function canReuseSuccessfulHarvest(report, harvestPath, runOptions, options = {}) {
  return report?.status === 'success'
    && reportMatchesRunOptions(report, runOptions)
    && reportSatisfiesWorkCommentsRequest(report, options, runOptions)
    && fs.existsSync(harvestPath);
}

function summaryFromReport(report, reportPath, status = report.status) {
  return {
    account_id: report.account?.id || '',
    label: report.account?.label || '',
    status,
    harvest_file: report.output?.harvest_file || '',
    report_file: reportPath,
    work_rows: Number(report.counts?.work_rows || 0),
    comment_rows: Number(report.counts?.comment_rows || 0),
    image_text_rows: Number(report.counts?.image_text_rows || 0),
    imported: Boolean(report.import?.enabled),
    import_applied: Boolean(report.import?.applied),
    import_output_file: report.output?.import_output_file || '',
    failure_samples_file: report.output?.failure_samples_file && fs.existsSync(report.output.failure_samples_file)
      ? report.output.failure_samples_file
      : '',
    import_summary: report.import?.summary || '',
    comment_enrichment_status: report.comment_enrichment?.status || '',
    data_source: report.data_source || DOUYIN_SOURCE_PUBLIC,
    resumed_from_existing: true,
  };
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
    const timer = options.timeoutSeconds
      ? setTimeout(() => child.kill('SIGTERM'), options.timeoutSeconds * 1000)
      : null;
    child.stdout.on('data', (chunk) => { stdout += stdoutDecoder.decode(chunk); });
    child.stderr.on('data', (chunk) => { stderr += stderrDecoder.decode(chunk); });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      stdout += stdoutDecoder.flush();
      stderr += stderrDecoder.flush();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

async function importHarvest(inputPath, apply) {
  const args = [
    'scripts/import-to-scrm.js',
    '--platform',
    'douyin',
    '--input',
    inputPath,
  ];
  if (apply) args.push('--apply');
  return runCommand(process.execPath, args, {
    cwd: ROOT_DIR,
    timeoutSeconds: 1800,
  });
}

async function enrichRowsWithWorkComments(rows, runOptions, options, accountDir) {
  const commentLimit = parsePositiveInt(options.workCommentLimit ?? runOptions.commentLimit, runOptions.commentLimit);
  const commentPages = parsePositiveInt(options.workCommentPages ?? 1, 1);
  const replyLimit = parsePositiveInt(options.workReplyLimit ?? commentLimit, commentLimit);
  const replyPages = parsePositiveInt(options.workReplyPages ?? 1, 1);
  const report = {
    enabled: Boolean(options.workComments),
    status: options.workComments ? 'skipped' : 'disabled',
    limit_per_page: options.workComments ? commentLimit : null,
    max_pages: options.workComments ? commentPages : null,
    reply_limit_per_page: options.workComments && runOptions.withReplies ? replyLimit : null,
    max_reply_pages: options.workComments && runOptions.withReplies ? replyPages : null,
    total_works: rows.length,
    fetched_works: 0,
    failed_works: 0,
    skipped_works: 0,
    comment_rows: countComments(rows),
    errors: [],
  };
  if (!options.workComments) return { rows, report };

  const targetAwemeIds = options.targetAwemeIds instanceof Set ? options.targetAwemeIds : null;
  const enrichedRows = [];
  emitTaskEvent({
    step: 'work-comments',
    message: `开始作品级评论增强，共 ${rows.length} 条作品`,
    detail: {
      total_works: rows.length,
      comment_limit: commentLimit,
      comment_pages: commentPages,
      reply_limit: replyLimit,
      reply_pages: replyPages,
    },
  });
  for (const work of rows) {
    if (!work.aweme_id) {
      report.skipped_works += 1;
      enrichedRows.push(work);
      continue;
    }
    if (targetAwemeIds && !targetAwemeIds.has(String(work.aweme_id))) {
      report.skipped_works += 1;
      enrichedRows.push(work);
      continue;
    }
    const args = buildWorkCommentsArgs(work, {
      ...runOptions,
      commentLimit,
      commentPages,
      replyLimit,
      replyPages,
    });
    const commandLabel = `node ${options.opencliMain} ${args.join(' ')}`;
    try {
      emitTaskEvent({
        step: 'work-comments',
        message: `抓取作品评论：${work.aweme_id}`,
        detail: {
          aweme_id: work.aweme_id,
          fetched_works: report.fetched_works,
          failed_works: report.failed_works,
          skipped_works: report.skipped_works,
          total_works: rows.length,
        },
      });
      const { stdout, stderr } = await runCommand(process.execPath, [RUN_OPENCLI_SCRIPT, options.opencliMain, ...args], {
        cwd: ROOT_DIR,
        timeoutSeconds: options.timeoutSeconds,
        env: {
          ...process.env,
          OPENCLI_BROWSER_COMMAND_TIMEOUT: String(options.timeoutSeconds),
        },
      });
      const fetched = JSON.parse(stdout);
      const comments = mergeWorkComments(work.comments || [], Array.isArray(fetched) ? fetched : [], work.aweme_id);
      if (stderr.trim()) {
        fs.appendFileSync(path.join(accountDir, 'comments.stderr.log'), `${stderr.trim()}\n`);
      }
      enrichedRows.push({ ...work, comments, comment_count: Math.max(Number(work.comment_count || 0), comments.length) });
      report.fetched_works += 1;
      emitTaskEvent({
        step: 'work-comments',
        message: `作品评论抓取完成：${work.aweme_id}`,
        detail: {
          aweme_id: work.aweme_id,
          comment_rows: comments.length,
          fetched_works: report.fetched_works,
          failed_works: report.failed_works,
          skipped_works: report.skipped_works,
          total_works: rows.length,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const recovery = buildWorkCommentsRecoveryHint(errorMessage);
      report.failed_works += 1;
      report.errors.push({
        aweme_id: work.aweme_id,
        command: commandLabel,
        error: errorMessage,
        ...(recovery ? { recovery } : {}),
      });
      enrichedRows.push(work);
      emitTaskEvent({
        step: 'work-comments',
        status: 'warning',
        message: `作品评论抓取失败：${work.aweme_id}`,
        detail: {
          aweme_id: work.aweme_id,
          error: errorMessage,
          fetched_works: report.fetched_works,
          failed_works: report.failed_works,
          skipped_works: report.skipped_works,
          total_works: rows.length,
        },
      });
      if (options.strictWorkComments) throw error;
    }
  }

  report.comment_rows = countComments(enrichedRows);
  if (report.fetched_works > 0 && report.failed_works === 0) report.status = 'ok';
  else if (report.fetched_works > 0) report.status = 'partial';
  else if (report.failed_works > 0) report.status = 'warning';
  else report.status = 'skipped';
  emitTaskEvent({
    step: 'work-comments',
    status: report.status === 'ok' || report.status === 'skipped' ? 'running' : 'warning',
    message: `作品级评论增强完成：${report.status}`,
    detail: report,
  });
  return { rows: enrichedRows, report };
}

async function retryFailedWorkComments({
  account,
  runOptions,
  options,
  accountDir,
  harvestPath,
  reportPath,
  failureSamplesPath,
}) {
  const failureSamples = readJsonIfExists(failureSamplesPath);
  const awemeIds = collectFailedWorkCommentAwemeIds(failureSamples);
  if (awemeIds.length === 0) {
    throw new Error(`No work comment failures found for ${account.id}. Expected ${failureSamplesPath}`);
  }
  const rows = readJsonIfExists(harvestPath);
  if (!Array.isArray(rows)) {
    throw new Error(`Cannot retry failed work comments without an existing harvest file: ${harvestPath}`);
  }

  const startedAt = new Date().toISOString();
  console.error(`[douyin] retrying failed work comments for ${account.id}: ${awemeIds.join(', ')}`);
  const enrichment = await enrichRowsWithWorkComments(rows, runOptions, {
    ...options,
    workComments: true,
    targetAwemeIds: new Set(awemeIds),
  }, accountDir);
  const nextRows = enrichment.rows;
  nextRows.comment_enrichment = {
    ...enrichment.report,
    mode: 'retry_failed_work_comments',
    target_aweme_ids: awemeIds,
  };
  writeJson(harvestPath, nextRows);

  let importOutput = '';
  const importOutputFile = options.importScrm
    ? path.join(accountDir, options.importScrmApply ? 'import-apply.log' : 'import-dry-run.log')
    : '';
  if (options.importScrm) {
    const result = await importHarvest(harvestPath, options.importScrmApply);
    importOutput = result.stdout;
    fs.writeFileSync(importOutputFile, result.stdout);
  }
  const importSummary = importOutput.split(/\r?\n/).find((line) => line.startsWith('IMPORT_SUMMARY ')) ?? '';
  const report = buildDouyinRunReport({
    account,
    runOptions,
    command: `retry failed work comments: ${awemeIds.join(', ')}`,
    harvestPath,
    rows: nextRows,
    importOutputFile,
    importSummary,
    imported: options.importScrm,
    importApplied: options.importScrmApply,
    failureSamplesFile: failureSamplesPath,
    attempt: 1,
    maxAttempts: 1,
    resumedFromExisting: true,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  writeJson(reportPath, report);
  syncFailureSamples(failureSamplesPath, report);
  return summaryFromReport(report, reportPath);
}

async function runConfiguredDouyinHarvestOnce(inputOptions) {
  const options = { ...inputOptions };
  const config = loadLocalConfig(options.config);
  const douyinConfig = platformConfig(config, 'douyin');
  const accounts = platformAccounts(config, 'douyin', { accountIds: options.accountIds });
  if (accounts.length === 0) {
    throw new Error('No enabled douyin accounts configured. Add platforms.douyin.accounts to config.local.json.');
  }
  if (!fs.existsSync(options.opencliMain)) {
    throw new Error(`OpenCLI entry not found: ${options.opencliMain}`);
  }

  const outputRoot = options.outputDir || path.join(DEFAULT_OUTPUT_BASE, options.date);
  ensureDir(outputRoot);
  const longTask = normalizeLongTaskOptions(options);
  const checkpointFile = checkpointPathFor(outputRoot);
  let checkpoint = null;
  if (longTask.full) {
    if (longTask.refresh || !longTask.resume) resetCheckpoint(checkpointFile);
    checkpoint = longTask.resume ? loadCheckpoint(checkpointFile) : null;
    if (checkpoint) {
      emitTaskEvent({
        step: 'resume-detected',
        message: `发现上次断点，将从第 ${Number(checkpoint.current_batch || 0) + 1} 批继续`,
        output_dir: outputRoot,
        checkpoint_file: checkpointFile,
        detail: checkpoint,
      });
    } else {
      checkpoint = createCheckpoint({
        platform: 'douyin',
        task: 'public-content',
        full: true,
        batchSize: longTask.batchSize,
        maxItems: longTask.maxItems,
      });
    }
    if (options.videoLimit === undefined) {
      const completedBefore = Number(checkpoint.completed_count || 0);
      const remainingItems = longTask.maxItems > 0 ? Math.max(0, longTask.maxItems - completedBefore) : longTask.batchSize;
      options.videoLimit = longTask.maxItems > 0 ? Math.min(longTask.batchSize, remainingItems) : longTask.batchSize;
    }
    checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    emitTaskEvent({
      step: 'full-start',
      message: `全量采集已启动：每批 ${longTask.batchSize} 个${longTask.maxItems ? `，最多 ${longTask.maxItems} 个` : ''}`,
      output_dir: outputRoot,
      checkpoint_file: checkpointFile,
      detail: checkpoint,
    });
    emitTaskEvent({
      step: 'batch-start',
      message: `第 ${Number(checkpoint.current_batch || 0) + 1} 批开始`,
      output_dir: outputRoot,
      checkpoint_file: checkpointFile,
      detail: {
        ...checkpoint,
        current_batch: Number(checkpoint.current_batch || 0) + 1,
      },
    });
  }
  emitTaskEvent({
    step: 'start',
    message: `抖音任务开始，共 ${accounts.length} 个账号`,
    detail: {
      output_dir: outputRoot,
      account_count: accounts.length,
      import_scrm: Boolean(options.importScrm),
      import_apply: Boolean(options.importScrmApply),
    },
  });

  const summary = [];
  const retryCount = Number.isFinite(Number(options.retryCount)) ? Math.max(0, Math.floor(Number(options.retryCount))) : 0;
  const maxAttempts = retryCount + 1;
  if (checkpoint && longTask.maxItems > 0 && Number(checkpoint.completed_count || 0) >= longTask.maxItems) {
    checkpoint = saveCheckpoint(checkpointFile, {
      ...checkpoint,
      has_more: false,
      status: 'complete',
    });
    emitTaskEvent({
      step: 'full-complete',
      status: 'success',
      message: `已达到全量上限 ${longTask.maxItems} 个作品`,
      output_dir: outputRoot,
      checkpoint_file: checkpointFile,
      detail: checkpoint,
    });
    const summaryPath = path.join(outputRoot, 'index.json');
    writeJson(summaryPath, summary);
    return { outputRoot, summaryPath, summary };
  }
  const saveAccountCheckpoint = (account, patch = {}, status = 'completed') => {
    if (!checkpoint) return;
    checkpoint = markCheckpointItem(checkpoint, account.id, {
      label: account.label || '',
      fetched_at: new Date().toISOString(),
      ...patch,
    }, status);
    checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    emitTaskEvent({
      step: 'checkpoint-saved',
      status: 'success',
      message: '断点已保存，下次可以继续',
      output_dir: outputRoot,
      checkpoint_file: checkpointFile,
      detail: checkpoint,
    });
  };
  const saveHarvestCheckpoint = (account, rows = []) => {
    if (!checkpoint) return;
    const nextCursor = rows.find((row) => row.next_cursor)?.next_cursor || '';
    const hasMore = rows.some((row) => row.has_more);
    for (const row of rows) {
      const awemeId = String(row.aweme_id || '').trim();
      if (!awemeId) continue;
      checkpoint = markCheckpointItem(checkpoint, `${account.id}:${awemeId}`, {
        account_id: account.id,
        label: account.label || '',
        title: row.title || '',
        fetched_at: new Date().toISOString(),
      });
    }
    checkpoint = setCheckpointCursors(checkpoint, {
      [`accounts.${account.id}.works`]: nextCursor,
      [`accounts.${account.id}.has_more`]: hasMore,
    });
    checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    emitTaskEvent({
      step: 'checkpoint-saved',
      status: 'success',
      message: hasMore ? `账号 ${account.id} 断点已保存，下次从下一批作品继续` : `账号 ${account.id} 已经没有更多作品`,
      output_dir: outputRoot,
      checkpoint_file: checkpointFile,
      detail: checkpoint,
    });
  };
  for (const account of accounts) {
    const runOptions = resolveAccountRunOptions(account, douyinConfig, options);
    if (checkpoint) {
      runOptions.cursor = String(checkpointCursor(checkpoint, `accounts.${account.id}.works`, '') || '');
    }
    const accountDir = path.join(outputRoot, account.id);
    const harvestPath = path.join(accountDir, 'harvest.json');
    const batchHarvestPath = path.join(accountDir, 'harvest-batch.json');
    const reportPath = path.join(accountDir, 'run-report.json');
    const failureSamplesPath = path.join(accountDir, 'failure-samples.json');
    ensureDir(accountDir);

    if (options.retryFailedWorkComments) {
      emitTaskEvent({
        step: 'retry-failed-work-comments',
        message: `重跑失败作品评论：${account.id}`,
        detail: {
          account_id: account.id,
          label: account.label || '',
        },
      });
      summary.push(await retryFailedWorkComments({
        account,
        runOptions,
        options,
        accountDir,
        harvestPath,
        reportPath,
        failureSamplesPath,
      }));
      continue;
    }

    const existingReport = !options.refresh && !longTask.full ? readJsonIfExists(reportPath) : null;
    if (existingReport && canReuseSuccessfulHarvest(existingReport, harvestPath, runOptions, options)) {
      if (reportSatisfiesImportRequest(existingReport, options)) {
        console.error(`[douyin] skipping ${account.id} (${account.label}); existing successful run-report found`);
        emitTaskEvent({
          step: 'skip',
          message: `跳过账号 ${account.id}，已有成功报告`,
          detail: {
            account_id: account.id,
            label: account.label || '',
            report_file: reportPath,
          },
        });
        summary.push(summaryFromReport(existingReport, reportPath, 'skipped'));
        saveAccountCheckpoint(account, { skipped: true });
        continue;
      }

      if (options.importScrm) {
        console.error(`[douyin] reusing ${account.id} (${account.label}) harvest.json for import`);
        emitTaskEvent({
          step: 'reuse-import',
          message: `复用账号 ${account.id} 已有 harvest.json 入库`,
          detail: {
            account_id: account.id,
            label: account.label || '',
            harvest_file: harvestPath,
            apply: Boolean(options.importScrmApply),
          },
        });
        const startedAt = new Date().toISOString();
        const rows = readJsonIfExists(harvestPath) || [];
        const importOutputFile = path.join(accountDir, options.importScrmApply ? 'import-apply.log' : 'import-dry-run.log');
        const result = await importHarvest(harvestPath, options.importScrmApply);
        fs.writeFileSync(importOutputFile, result.stdout);
        const importSummary = result.stdout.split(/\r?\n/).find((line) => line.startsWith('IMPORT_SUMMARY ')) ?? '';
        const report = buildDouyinRunReport({
          account,
          runOptions,
          command: existingReport.command || '',
          harvestPath,
          rows,
          importOutputFile,
          importSummary,
          imported: true,
          importApplied: options.importScrmApply,
          failureSamplesFile: failureSamplesPath,
          attempt: 1,
          maxAttempts: 1,
          resumedFromExisting: true,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        writeJson(reportPath, report);
        syncFailureSamples(failureSamplesPath, report);
        emitTaskEvent({
          step: 'account-complete',
          message: `账号 ${account.id} 处理完成：${report.status}`,
          detail: {
            account_id: account.id,
            label: account.label || '',
            report_file: reportPath,
            work_rows: report.counts?.work_rows || 0,
            comment_rows: report.counts?.comment_rows || 0,
          },
        });
        summary.push(summaryFromReport(report, reportPath));
        saveAccountCheckpoint(account);
        continue;
      }
    }

    console.error(`[douyin] harvesting ${account.id} (${account.label})`);
    emitTaskEvent({
      step: 'account-harvest',
      message: `开始抓取账号 ${account.id}`,
      detail: {
        account_id: account.id,
        label: account.label || '',
        video_limit: runOptions.videoLimit,
        comment_limit: runOptions.commentLimit,
        with_replies: Boolean(runOptions.withReplies),
      },
    });
    let lastError = null;
    let commandLabel = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = new Date().toISOString();
      try {
        if (attempt > 1) {
          console.error(`[douyin] retrying ${account.id} (${attempt}/${maxAttempts})`);
          emitTaskEvent({
            step: 'retry',
            message: `账号 ${account.id} 第 ${attempt}/${maxAttempts} 次重试`,
            detail: {
              account_id: account.id,
              attempt,
              max_attempts: maxAttempts,
            },
          });
        }
        const args = buildHarvestArgs(account, runOptions);
        commandLabel = `node ${options.opencliMain} ${args.join(' ')}`;
        emitTaskEvent({
          step: 'opencli-harvest',
          message: `调用 OpenCLI 抓取账号 ${account.id}`,
          detail: {
            account_id: account.id,
            attempt,
            max_attempts: maxAttempts,
          },
        });
        const { stdout, stderr } = await runCommand(process.execPath, [RUN_OPENCLI_SCRIPT, options.opencliMain, ...args], {
          cwd: ROOT_DIR,
          timeoutSeconds: options.timeoutSeconds,
          env: {
            ...process.env,
            OPENCLI_BROWSER_COMMAND_TIMEOUT: String(options.timeoutSeconds),
          },
        });
        let batchRows = [];
        try {
          batchRows = normalizeOpenCliUserVideos(JSON.parse(stdout));
        } catch (error) {
          throw new Error(`OpenCLI output for douyin account "${account.id}" was not JSON: ${error.message}`);
        }
        const configuredAccountId = resolveConfiguredDouyinAccountId(account);
        batchRows = batchRows.map((row) => ({
          ...row,
          account_id: String(row.account_id || row.unique_id || configuredAccountId || '').trim(),
        }));
        emitTaskEvent({
          step: 'normalize',
          message: `账号 ${account.id} 作品结构归一化完成，共 ${batchRows.length} 条`,
          detail: {
            account_id: account.id,
            work_rows: batchRows.length,
          },
        });

        const enrichment = await enrichRowsWithWorkComments(batchRows, runOptions, options, accountDir);
        batchRows = enrichment.rows;
        batchRows.comment_enrichment = enrichment.report;
        let rows = batchRows;
        if (longTask.full) {
          writeJson(batchHarvestPath, batchRows);
          const existingRows = readJsonIfExists(harvestPath);
          rows = mergeDouyinHarvestRowsByAwemeId(Array.isArray(existingRows) ? existingRows : [], batchRows);
          rows.comment_enrichment = enrichment.report;
        }

        writeJson(harvestPath, rows);
        if (stderr.trim()) {
          fs.writeFileSync(path.join(accountDir, 'harvest.stderr.log'), stderr);
        }

        let importOutput = '';
        const importOutputFile = options.importScrm
          ? path.join(accountDir, options.importScrmApply ? 'import-apply.log' : 'import-dry-run.log')
          : '';
        if (options.importScrm) {
          emitTaskEvent({
            step: 'import',
            message: `开始导入账号 ${account.id} 抓取结果`,
            detail: {
              account_id: account.id,
              harvest_file: harvestPath,
              apply: Boolean(options.importScrmApply),
            },
          });
          const result = await importHarvest(harvestPath, options.importScrmApply);
          importOutput = result.stdout;
          fs.writeFileSync(importOutputFile, result.stdout);
        }
        const importSummary = importOutput.split(/\r?\n/).find((line) => line.startsWith('IMPORT_SUMMARY ')) ?? '';
        const report = buildDouyinRunReport({
          account,
          runOptions,
          command: commandLabel,
          harvestPath,
          rows,
          importOutputFile,
          importSummary,
          imported: options.importScrm,
          importApplied: options.importScrmApply,
          failureSamplesFile: failureSamplesPath,
          attempt,
          maxAttempts,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        writeJson(reportPath, report);
        syncFailureSamples(failureSamplesPath, report);
        emitTaskEvent({
          step: 'account-complete',
          message: `账号 ${account.id} 抓取完成：作品 ${report.counts.work_rows}，评论 ${report.counts.comment_rows}`,
          detail: {
            account_id: account.id,
            label: account.label || '',
            report_file: reportPath,
            work_rows: report.counts.work_rows,
            comment_rows: report.counts.comment_rows,
            image_text_rows: report.counts.image_text_rows,
            imported: Boolean(options.importScrm),
            import_apply: Boolean(options.importScrmApply),
          },
        });

        summary.push({
          account_id: account.id,
          label: account.label,
          status: report.status,
          data_source: report.data_source,
          harvest_file: harvestPath,
          report_file: reportPath,
          work_rows: report.counts.work_rows,
          comment_rows: report.counts.comment_rows,
          image_text_rows: report.counts.image_text_rows,
          imported: options.importScrm,
          import_applied: options.importScrmApply,
          import_output_file: importOutputFile,
          failure_samples_file: fs.existsSync(failureSamplesPath) ? failureSamplesPath : '',
          import_summary: importSummary,
          comment_enrichment_status: report.comment_enrichment?.status || '',
        });
        saveHarvestCheckpoint(account, batchRows);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const report = buildDouyinRunReport({
          account,
          runOptions,
          command: commandLabel,
          harvestPath,
          imported: options.importScrm,
          importApplied: options.importScrmApply,
          failureSamplesFile: failureSamplesPath,
          attempt,
          maxAttempts,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: 'failed',
          error: errorMessage,
        });
        writeJson(reportPath, report);
        syncFailureSamples(failureSamplesPath, report);
        emitTaskEvent({
          step: 'account-failed',
          status: 'warning',
          message: `账号 ${account.id} 抓取失败：${errorMessage}`,
          detail: {
            account_id: account.id,
            label: account.label || '',
            attempt,
            max_attempts: maxAttempts,
            report_file: reportPath,
            error: errorMessage,
          },
        });
        saveAccountCheckpoint(account, { error: errorMessage }, 'failed');
        if (attempt >= maxAttempts) throw error;
      }
    }
    if (lastError) throw lastError;
  }

  const summaryPath = path.join(outputRoot, 'index.json');
  writeJson(summaryPath, summary);
  if (checkpoint) {
    const currentBatch = Number(checkpoint.current_batch || 0) + 1;
    const hasMore = hasDouyinPublicMore(checkpoint, accounts);
    const reachedMaxItems = longTask.maxItems > 0 && Number(checkpoint.completed_count || 0) >= longTask.maxItems;
    const status = (!hasMore || reachedMaxItems) ? 'complete' : 'running';
    checkpoint = saveCheckpoint(checkpointFile, {
      ...checkpoint,
      current_batch: currentBatch,
      has_more: hasMore && !reachedMaxItems,
      status,
    });
    emitTaskEvent({
      step: 'batch-complete',
      status: 'success',
      message: `第 ${currentBatch} 批完成，本批 ${summary.length} 个账号`,
      output_dir: outputRoot,
      checkpoint_file: checkpointFile,
      detail: {
        ...checkpoint,
        batch_items: summary.length,
      },
    });
    if (status === 'complete') {
      emitTaskEvent({
        step: 'full-complete',
        status: 'success',
        message: reachedMaxItems ? `已达到全量上限 ${longTask.maxItems} 个作品` : '抖音公开主页已经没有更多作品',
        output_dir: outputRoot,
        checkpoint_file: checkpointFile,
        detail: checkpoint,
      });
    }
  }
  emitTaskEvent({
    step: 'complete',
    message: `抖音任务完成，共 ${summary.length} 个账号结果`,
    detail: {
      summary_file: summaryPath,
      account_count: summary.length,
      work_rows: summary.reduce((sum, row) => sum + Number(row.work_rows || 0), 0),
      comment_rows: summary.reduce((sum, row) => sum + Number(row.comment_rows || 0), 0),
    },
  });
  return { outputRoot, summaryPath, summary };
}

async function importFullDouyinHarvest(options, outputRoot) {
  const config = loadLocalConfig(options.config);
  const douyinConfig = platformConfig(config, 'douyin');
  const accounts = platformAccounts(config, 'douyin', { accountIds: options.accountIds });
  const summary = [];
  for (const account of accounts) {
    const accountDir = path.join(outputRoot, account.id);
    const harvestPath = path.join(accountDir, 'harvest.json');
    const reportPath = path.join(accountDir, 'run-report.json');
    const failureSamplesPath = path.join(accountDir, 'failure-samples.json');
    const rows = readJsonIfExists(harvestPath);
    if (!Array.isArray(rows)) {
      throw new Error(`Cannot import full douyin harvest without aggregated harvest file: ${harvestPath}`);
    }

    const runOptions = resolveAccountRunOptions(account, douyinConfig, options);
    const startedAt = new Date().toISOString();
    const importOutputFile = path.join(accountDir, options.importScrmApply ? 'import-apply.log' : 'import-dry-run.log');
    emitTaskEvent({
      step: 'import',
      message: `全量采集完成，开始导入账号 ${account.id} 的聚合结果`,
      detail: {
        account_id: account.id,
        harvest_file: harvestPath,
        apply: Boolean(options.importScrmApply),
      },
    });
    const result = await importHarvest(harvestPath, options.importScrmApply);
    fs.writeFileSync(importOutputFile, result.stdout);
    const importSummary = result.stdout.split(/\r?\n/).find((line) => line.startsWith('IMPORT_SUMMARY ')) ?? '';
    const report = buildDouyinRunReport({
      account,
      runOptions,
      command: 'full harvest import: reuse aggregated harvest.json',
      harvestPath,
      rows,
      importOutputFile,
      importSummary,
      imported: true,
      importApplied: options.importScrmApply,
      failureSamplesFile: failureSamplesPath,
      attempt: 1,
      maxAttempts: 1,
      resumedFromExisting: true,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    writeJson(reportPath, report);
    syncFailureSamples(failureSamplesPath, report);
    summary.push(summaryFromReport(report, reportPath));
  }
  const summaryPath = path.join(outputRoot, 'index.json');
  writeJson(summaryPath, summary);
  emitTaskEvent({
    step: 'complete',
    message: `抖音全量导入完成，共 ${summary.length} 个账号结果`,
    detail: {
      summary_file: summaryPath,
      account_count: summary.length,
      work_rows: summary.reduce((sum, row) => sum + Number(row.work_rows || 0), 0),
      comment_rows: summary.reduce((sum, row) => sum + Number(row.comment_rows || 0), 0),
    },
  });
  return { outputRoot, summaryPath, summary };
}

export async function runConfiguredDouyinHarvest(options) {
  const longTask = normalizeLongTaskOptions(options);
  if (!longTask.full || options.retryFailedWorkComments) {
    return runConfiguredDouyinHarvestOnce(options);
  }

  const outputRoot = options.outputDir || path.join(DEFAULT_OUTPUT_BASE, options.date);
  const checkpointFile = checkpointPathFor(outputRoot);
  const loopLimit = longTask.maxItems > 0
    ? Math.ceil(longTask.maxItems / Math.max(1, longTask.batchSize)) + 2
    : 1000;
  let result = null;

  for (let batchIndex = 0; batchIndex < loopLimit; batchIndex += 1) {
    result = await runConfiguredDouyinHarvestOnce({
      ...options,
      importScrm: false,
      importScrmApply: false,
      refresh: batchIndex === 0 ? options.refresh : false,
    });
    const checkpoint = loadCheckpoint(checkpointFile);
    if (!checkpoint || checkpoint.status === 'complete' || checkpoint.has_more === false) break;
    if (batchIndex === loopLimit - 1) {
      throw new Error(`Douyin full harvest stopped after ${loopLimit} batches to avoid an endless loop. Check ${checkpointFile}.`);
    }
  }

  if (options.importScrm) {
    return importFullDouyinHarvest(options, outputRoot);
  }
  return result;
}

export function printHelp() {
  console.log(`Usage: node scripts/harvest-douyin.js [options]

Harvest all enabled Douyin accounts from config.local.json.

Options:
  --config PATH             Config file, default config.local.json
  --date YYYY-MM-DD         Output date folder in Asia/Shanghai, default today
  --output-dir PATH         Override output directory
  --opencli-main PATH       OpenCLI entry, default bundled @jackwener/opencli
  --account ID              Only run one configured account; may be repeated
  --video-limit N           Override configured video_limit
  --comment-limit N         Override configured comment_limit
  --full                    Explicit full harvest mode with checkpointing
  --batch-size N            Full-mode batch size, default 50
  --max-items N             Full-mode safety cap, default unlimited
  --no-resume               Ignore existing checkpoint in full mode
  --with-replies            Override configured with_replies to true
  --without-replies         Override configured with_replies to false
  --refresh                 Ignore existing successful run-report.json and re-fetch
  --retry N                 Retry failed account harvest N times, default 1
  --work-comments           Try to fetch comments per work via douyin skill-comments
  --work-comment-limit N    Per-work comment limit for --work-comments, default --comment-limit
  --work-comment-pages N    Per-work comment pages for --work-comments, default 1
  --work-reply-limit N      Per-comment reply limit for --with-replies + --work-comments, default --work-comment-limit
  --work-reply-pages N      Per-comment reply pages for --with-replies + --work-comments, default 1
  --strict-work-comments    Fail the account when per-work comment enrichment fails
  --retry-failed-work-comments
                            Reuse harvest.json and only retry work IDs listed in failure-samples.json
  --timeout SECONDS         OpenCLI timeout per account, default 1200
  --import-scrm             Run SCRM importer in dry-run mode per account
  --import-scrm-apply       Run SCRM importer and write into MySQL per account
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await runConfiguredDouyinHarvest(options);
  console.log(JSON.stringify({
    output_root: result.outputRoot,
    summary_file: result.summaryPath,
    accounts: result.summary,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
