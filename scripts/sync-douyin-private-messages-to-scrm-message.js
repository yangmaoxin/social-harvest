#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  checkpointPathFor,
  createCheckpoint,
  loadCheckpoint,
  markCheckpointItem,
  normalizeLongTaskOptions,
  resetCheckpoint,
  saveCheckpoint,
} from '../runner/checkpoint.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPENCLI_MAIN_CANDIDATES = [
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'dist', 'src', 'main.js'),
];
const DEFAULT_OPENCLI_MAIN = OPENCLI_MAIN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || OPENCLI_MAIN_CANDIDATES[0];
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const TASK_EVENT_PREFIX = 'TASK_EVENT ';

function emitTaskEvent(event = {}) {
  if (process.env.OPENCLI_TASK_EVENTS !== 'jsonl') return;
  console.error(`${TASK_EVENT_PREFIX}${JSON.stringify({
    type: 'progress',
    status: 'running',
    ...event,
  })}`);
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function setOpenCliArgValue(args = [], name = '', value = '') {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) {
    args[index + 1] = String(value);
  } else {
    args.push(name, String(value));
  }
}

function ensureOpenCliFlag(args = [], name = '') {
  if (!args.includes(name)) args.push(name);
}

export function parseArgs(argv) {
  const options = {
    date: todayText(),
    outputDir: '',
    apply: false,
    exportOnly: false,
    opencliMain: process.env.OPENCLI_MAIN || DEFAULT_OPENCLI_MAIN,
    opencliArgs: ['--limit', '20', '--message_limit', '20', '-f', 'json'],
    diagnosticRecordSampleLimit: '30',
    importArgs: [],
    allMessages: false,
    messageLimitExplicit: false,
    loadHistoryClicksExplicit: false,
    full: false,
    batchSize: 50,
    maxItems: 0,
    resume: true,
    refresh: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') {
      options.date = argv[++index];
    } else if (arg === '--output-dir') {
      options.outputDir = path.resolve(argv[++index]);
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--export-only') {
      options.exportOnly = true;
    } else if (arg === '--limit') {
      options.opencliArgs.push('--limit', argv[++index]);
    } else if (arg === '--all') {
      options.opencliArgs.push('--all');
    } else if (arg === '--message-limit') {
      options.messageLimitExplicit = true;
      options.opencliArgs.push('--message_limit', argv[++index]);
    } else if (arg === '--all-messages') {
      options.allMessages = true;
      options.opencliArgs.push('--all_messages');
    } else if (arg === '--include-outbound') {
      options.opencliArgs.push('--include_outbound');
    } else if (arg === '--thread-rank') {
      options.opencliArgs.push('--thread_rank', argv[++index]);
    } else if (arg === '--thread-keyword') {
      options.opencliArgs.push('--thread_keyword', argv[++index]);
    } else if (arg === '--load-history-clicks') {
      options.loadHistoryClicksExplicit = true;
      options.opencliArgs.push('--load_history_clicks', argv[++index]);
    } else if (arg === '--tab-name') {
      options.opencliArgs.push('--tab_name', argv[++index]);
    } else if (arg === '--record-sample-limit') {
      options.diagnosticRecordSampleLimit = argv[++index];
    } else if (arg === '--url') {
      options.opencliArgs.push('--url', argv[++index]);
    } else if (arg === '--full') {
      options.full = true;
    } else if (arg === '--batch-size') {
      options.batchSize = Number(argv[++index]);
    } else if (arg === '--max-items') {
      options.maxItems = Number(argv[++index]);
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--no-resume') {
      options.resume = false;
    } else if (arg === '--refresh') {
      options.refresh = true;
    } else if (['--host', '--user', '--password', '--database', '--config'].includes(arg)) {
      options.importArgs.push(arg, argv[++index]);
    } else if (arg === '--opencli-main') {
      options.opencliMain = path.resolve(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.full) {
    ensureOpenCliFlag(options.opencliArgs, '--all');
    ensureOpenCliFlag(options.opencliArgs, '--all_messages');
    options.allMessages = true;
  }
  if (options.allMessages) {
    if (!options.messageLimitExplicit) {
      setOpenCliArgValue(options.opencliArgs, '--message_limit', '200');
    }
    if (!options.loadHistoryClicksExplicit) {
      setOpenCliArgValue(options.opencliArgs, '--load_history_clicks', '20');
    }
  }
  if (!hasOpenCliArg(options.opencliArgs, '--tab_name')) {
    setOpenCliArgValue(options.opencliArgs, '--tab_name', '全部');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-douyin-private-messages-to-scrm-message.js [options]

Options:
  --date YYYY-MM-DD      Output under samples/douyin/<date>/, default today
  --output-dir PATH      Override output directory
  --apply                Write into MySQL after dry-run mapping
  --export-only          Only export private-messages-flat.json; skip dry-run/apply import
  --limit N              Inspect at most N visible conversations
  --all                  Inspect more visible conversations
  --message-limit N      Keep at most N visible messages per conversation
  --all-messages         Keep more visible messages per conversation
  --include-outbound     Keep outbound rows for DOM diagnosis
  --thread-rank N        Only inspect one visible conversation rank (1-based)
  --thread-keyword TEXT  Only inspect conversations whose nickname/preview contains text
  --load-history-clicks N
                         Click visible 加载 button this many times before reading messages
  --tab-name NAME        Prefer 全部 / 朋友私信 / 陌生人私信 / 群消息, default 全部
  --record-sample-limit N
                         Diagnostic protobuf sample limit, default 30
  --url URL              Douyin web private message URL, default adapter value
  --full                 Process private-message conversations in checkpointed batches
  --batch-size N         Conversations per full batch, default 50
  --max-items N          Optional full-mode conversation cap
  --resume               Resume from private-messages-checkpoint.json, default true
  --no-resume            Ignore existing private-message checkpoint
  --refresh              Clear private-message checkpoint before running
  --host VALUE           MySQL host
  --user VALUE           MySQL user
  --password VALUE       MySQL password
  --database VALUE       MySQL database name
  --config PATH          Config file, default config.local.json
  --opencli-main PATH    OpenCLI entry, default bundled @jackwener/opencli
`);
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Command failed: node ${args.join(' ')}`).trim());
  }
  return result.stdout || '';
}

function runNodeResult(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    command: [process.execPath, ...args],
  };
}

function parseJsonArray(text, label) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function hasOpenCliArg(args = [], name = '') {
  return Array.isArray(args) && args.includes(name);
}

export function getOpenCliArgValue(args = [], name = '', fallback = '') {
  if (!Array.isArray(args)) return fallback;
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return String(args[index + 1] ?? fallback);
}

function withoutOpenCliArgs(args = [], names = []) {
  const removals = new Set(names);
  const valueFlags = new Set([
    '--limit',
    '--thread_keyword',
    '--thread_rank',
  ]);
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (removals.has(arg)) {
      if (valueFlags.has(arg)) index += 1;
      continue;
    }
    output.push(arg);
  }
  return output;
}

function shouldUseCheckpointedFullMessageExport(options = {}) {
  return Boolean(options.full)
    && !hasOpenCliArg(options.opencliArgs, '--thread_keyword')
    && !hasOpenCliArg(options.opencliArgs, '--thread_rank');
}

export function shouldUseIsolatedFullMessageExport(opencliArgs = [], exportedRows = []) {
  return exportedRows.length === 0
    && !hasOpenCliArg(opencliArgs, '--thread_keyword')
    && !hasOpenCliArg(opencliArgs, '--thread_rank');
}

export function isRecoverableOpenCliFullExportFailure(text = '') {
  return /stale page identity|Page not found|Detached while handling command|execution context was destroyed|Target closed|TIMEOUT|timed out/i.test(String(text || ''));
}

export function buildDouyinPrivateMessageThreadKeywords(threadRows = []) {
  const seen = new Set();
  const keywords = [];
  const scoreKeyword = (value) => (/消息|电话|说|等会|喜欢|哈哈|[，。！？!?]/.test(String(value || '')) ? 0 : 1);
  for (const row of Array.isArray(threadRows) ? threadRows : []) {
    const nickname = String(row?.thread_nickname || '').replace(/\s+/g, ' ').trim();
    if (!nickname || nickname.length > 40) continue;
    if (/^(全选|全部|通知|网址|抖音|全部私信|朋友私信|陌生人私信|群消息)$/.test(nickname)) continue;
    if (seen.has(nickname)) continue;
    seen.add(nickname);
    keywords.push(nickname);
  }
  return keywords.sort((left, right) => scoreKeyword(left) - scoreKeyword(right));
}

export function dedupePrivateMessageRows(rows = []) {
  const seen = new Set();
  const output = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [
      row?.message_id || '',
      row?.thread_id || row?.thread_nickname || '',
      row?.direction || '',
      row?.text || '',
      row?.timestamp || row?.time || '',
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output.map((row, index) => ({
    ...row,
    row_rank: index + 1,
  }));
}

function readExistingPrivateMessageRows(outputPath = '') {
  if (!outputPath || !fs.existsSync(outputPath)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function privateMessageCheckpointTargetKeywords(threadKeywords = [], longTask = {}) {
  if (!longTask.maxItems) return threadKeywords;
  return threadKeywords.slice(0, longTask.maxItems);
}

function nextPrivateMessageBatchKeywords(threadKeywords = [], checkpoint = {}, longTask = {}) {
  const completed = checkpoint?.completed_items && typeof checkpoint.completed_items === 'object'
    ? checkpoint.completed_items
    : {};
  const failed = checkpoint?.failed_items && typeof checkpoint.failed_items === 'object'
    ? checkpoint.failed_items
    : {};
  return privateMessageCheckpointTargetKeywords(threadKeywords, longTask)
    .filter((keyword) => !completed[keyword] && !failed[keyword])
    .slice(0, longTask.batchSize);
}

function buildPrivateMessageCheckpoint({
  current = null,
  longTask = {},
  threadKeywords = [],
  status = 'running',
} = {}) {
  const targetKeywords = privateMessageCheckpointTargetKeywords(threadKeywords, longTask);
  const completedItems = current?.completed_items || {};
  const failedItems = current?.failed_items || {};
  const completedCount = targetKeywords.filter((keyword) => completedItems[keyword]).length;
  const failedCount = targetKeywords.filter((keyword) => failedItems[keyword]).length;
  return {
    ...(current || createCheckpoint({
      platform: 'douyin',
      task: 'creator-messages',
      full: true,
      batchSize: longTask.batchSize,
      maxItems: longTask.maxItems,
    })),
    platform: 'douyin',
    task: 'creator-messages',
    mode: 'full',
    batch_size: longTask.batchSize,
    max_items: longTask.maxItems,
    status,
    has_more: completedCount + failedCount < targetKeywords.length,
    completed_count: completedCount,
    failed_count: failedCount,
    total_count: targetKeywords.length,
  };
}

export function parseTaggedJson(text, tag) {
  const prefix = `${tag} `;
  const line = String(text || '').split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return null;
  return JSON.parse(line.slice(prefix.length));
}

export function buildPrivateMessagesReport({
  apply = false,
  outputPath = '',
  probePath = '',
  diagnosticFiles = {},
  diagnosticWarnings = [],
  checkpointFile = '',
  checkpoint = null,
  exportedRows = [],
  importOutput = '',
} = {}) {
  const importSummary = parseTaggedJson(importOutput, 'IMPORT_SUMMARY');
  const importVerification = parseTaggedJson(importOutput, 'IMPORT_VERIFICATION');
  const verification = importVerification?.verification || {};
  return {
    platform: 'douyin',
    data_source: 'douyin_creator_center',
    status: apply ? 'imported' : 'dry-run',
    apply,
    output_file: outputPath,
    probe_file: probePath,
    diagnostic_files: diagnosticFiles,
    checkpoint_file: checkpointFile,
    checkpoint_status: checkpoint?.status || '',
    checkpoint_has_more: Boolean(checkpoint?.has_more),
    checkpoint_completed_count: Number(checkpoint?.completed_count || 0),
    checkpoint_total_count: Number(checkpoint?.total_count || 0),
    exported_rows: exportedRows.length,
    message_rows: Number(importSummary?.message_rows || 0),
    write_attempt_rows: Number(importSummary?.write_attempt_rows || 0),
    matched_current_payload_rows: Number(verification.matched_current_payload_rows || 0),
    warnings: [
      ...(Array.isArray(importSummary?.warnings) ? importSummary.warnings : []),
      ...(Array.isArray(diagnosticWarnings) ? diagnosticWarnings : []),
    ],
    import_summary: importSummary,
    import_verification: importVerification,
  };
}

export function run(options) {
  if (!fs.existsSync(options.opencliMain)) {
    throw new Error(`OpenCLI entry not found: ${options.opencliMain}. Build workspace/OpenCLI first, or pass --opencli-main PATH.`);
  }

  runNode([path.join(ROOT_DIR, 'scripts', 'sync-douyin-runtime-comments.js')]);

  const outputDir = options.outputDir || path.join(ROOT_DIR, 'samples', 'douyin', options.date);
  const outputPath = path.join(outputDir, 'private-messages-flat.json');
  const probePath = path.join(outputDir, 'private-messages-probe.json');
  const recordProbePath = path.join(outputDir, 'private-messages-record-probe.json');
  const recordProbeErrorPath = path.join(outputDir, 'private-messages-record-probe.error.json');
  const protobufBranchProbePath = path.join(outputDir, 'private-messages-protobuf-branch-probe.json');
  const protobufBranchProbeErrorPath = path.join(outputDir, 'private-messages-protobuf-branch-probe.error.json');
  const reportPath = path.join(outputDir, 'private-messages-report.json');
  const threadListPath = path.join(outputDir, 'private-messages-thread-list.json');
  const privateCheckpointPath = checkpointPathFor(outputDir, 'private-messages-checkpoint.json');
  const longTask = normalizeLongTaskOptions(options);
  fs.mkdirSync(outputDir, { recursive: true });
  let privateCheckpoint = null;

  emitTaskEvent({
    step: 'export',
    message: '开始导出抖音入站私信',
    detail: {
      output_file: outputPath,
      apply: Boolean(options.apply),
    },
  });
  const diagnosticFiles = {};
  let exportedRows = [];

  if (shouldUseCheckpointedFullMessageExport(options)) {
    if (longTask.refresh) resetCheckpoint(privateCheckpointPath);
    privateCheckpoint = longTask.resume ? loadCheckpoint(privateCheckpointPath) : null;
    if (privateCheckpoint) {
      emitTaskEvent({
        step: 'resume-detected',
        message: `发现抖音私信断点，已完成 ${Number(privateCheckpoint.completed_count || 0)} 个会话`,
        detail: {
          checkpoint_file: privateCheckpointPath,
          completed_count: Number(privateCheckpoint.completed_count || 0),
          failed_count: Number(privateCheckpoint.failed_count || 0),
        },
      });
    }

    emitTaskEvent({
      step: 'export',
      message: '抖音私信全量模式启动，开始读取会话列表',
      detail: {
        thread_list_file: threadListPath,
        checkpoint_file: privateCheckpointPath,
        batch_size: longTask.batchSize,
      },
    });
    const tabName = getOpenCliArgValue(options.opencliArgs, '--tab_name', '');
    const threadListArgs = [
      RUN_OPENCLI_SCRIPT,
      options.opencliMain,
      'douyin',
      'skill-messages-thread-list-probe',
      ...(tabName ? ['--tab_name', tabName] : []),
      '-f',
      'json',
    ];
    const threadListOutput = runNode(threadListArgs, {
      env: {
        ...process.env,
        OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '180',
      },
    });
    fs.writeFileSync(threadListPath, threadListOutput);
    diagnosticFiles.thread_list = threadListPath;
    const threadRows = parseJsonArray(threadListOutput, 'douyin skill-messages-thread-list-probe output');
    const threadKeywords = buildDouyinPrivateMessageThreadKeywords(threadRows);
    privateCheckpoint = buildPrivateMessageCheckpoint({
      current: privateCheckpoint,
      longTask,
      threadKeywords,
      status: 'running',
    });
    privateCheckpoint = saveCheckpoint(privateCheckpointPath, privateCheckpoint);
    const batchKeywords = nextPrivateMessageBatchKeywords(threadKeywords, privateCheckpoint, longTask);
    const baseArgs = withoutOpenCliArgs(options.opencliArgs, ['--all', '--thread_keyword', '--thread_rank']);
    const isolatedRows = [];
    emitTaskEvent({
      step: 'batch-start',
      message: batchKeywords.length
        ? `抖音私信第 ${Number(privateCheckpoint.current_batch || 0) + 1} 批开始：${batchKeywords.length} 个会话`
        : '抖音私信全量断点已完成，本轮没有新的会话需要处理',
      detail: {
        checkpoint_file: privateCheckpointPath,
        batch_size: longTask.batchSize,
        batch_threads: batchKeywords.length,
        total_threads: Number(privateCheckpoint.total_count || 0),
        completed_threads: Number(privateCheckpoint.completed_count || 0),
      },
    });
    for (const keyword of batchKeywords) {
      const candidates = [keyword];
      const shortKeyword = Array.from(keyword).slice(0, 3).join('');
      if (shortKeyword && shortKeyword !== keyword) candidates.push(shortKeyword);
      let matched = false;
      let lastError = '';
      for (const candidate of candidates) {
        const result = runNodeResult([
          RUN_OPENCLI_SCRIPT,
          options.opencliMain,
          'douyin',
          'skill-messages-flat',
          ...baseArgs,
          '--thread_keyword',
          candidate,
        ], {
          env: {
            ...process.env,
            OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '180',
          },
        });
        if (!result.ok) {
          lastError = (result.stderr || result.stdout).trim();
          console.error(`[checkpoint] thread="${keyword}" candidate="${candidate}" failed: ${lastError}`);
          continue;
        }
        const rows = parseJsonArray(result.stdout, `douyin isolated private message output for ${candidate}`);
        if (rows.length === 0) continue;
        isolatedRows.push(...rows);
        matched = true;
        privateCheckpoint = markCheckpointItem(privateCheckpoint, keyword, {
          fetched_at: new Date().toISOString(),
          keyword: candidate,
          row_count: rows.length,
        });
        privateCheckpoint = buildPrivateMessageCheckpoint({
          current: privateCheckpoint,
          longTask,
          threadKeywords,
          status: 'running',
        });
        privateCheckpoint = saveCheckpoint(privateCheckpointPath, privateCheckpoint);
        console.error(`[checkpoint] thread="${keyword}" candidate="${candidate}" exported ${rows.length} rows.`);
        break;
      }
      if (!matched) {
        privateCheckpoint = markCheckpointItem(privateCheckpoint, keyword, {
          fetched_at: new Date().toISOString(),
          error: lastError || 'exported 0 rows',
        }, 'failed');
        privateCheckpoint = saveCheckpoint(privateCheckpointPath, privateCheckpoint);
        console.error(`[checkpoint] thread="${keyword}" exported 0 rows.`);
      }
    }
    exportedRows = dedupePrivateMessageRows([
      ...readExistingPrivateMessageRows(outputPath),
      ...isolatedRows,
    ]);
    const hasRemainingBatch = nextPrivateMessageBatchKeywords(threadKeywords, privateCheckpoint, longTask).length > 0;
    const finalCheckpointStatus = hasRemainingBatch
      ? 'running'
      : Object.keys(privateCheckpoint?.failed_items || {}).length
        ? 'partial'
        : 'complete';
    privateCheckpoint = buildPrivateMessageCheckpoint({
      current: {
        ...privateCheckpoint,
        current_batch: Number(privateCheckpoint?.current_batch || 0) + (batchKeywords.length ? 1 : 0),
      },
      longTask,
      threadKeywords,
      status: finalCheckpointStatus,
    });
    privateCheckpoint = saveCheckpoint(privateCheckpointPath, privateCheckpoint);
    fs.writeFileSync(outputPath, `${JSON.stringify(exportedRows, null, 2)}\n`);
    emitTaskEvent({
      step: 'export-complete',
      message: privateCheckpoint.has_more
        ? `抖音私信本批完成：累计导出 ${exportedRows.length} 条，下次会继续剩余会话`
        : finalCheckpointStatus === 'partial'
          ? `抖音私信全量部分完成：累计导出 ${exportedRows.length} 条，部分会话失败已记录`
          : `抖音私信全量完成：累计导出 ${exportedRows.length} 条`,
      detail: {
        output_file: outputPath,
        checkpoint_file: privateCheckpointPath,
        exported_rows: exportedRows.length,
        batch_threads: batchKeywords.length,
        thread_count: Number(privateCheckpoint.total_count || threadKeywords.length),
        completed_threads: Number(privateCheckpoint.completed_count || 0),
        failed_threads: Number(privateCheckpoint.failed_count || 0),
        has_more: Boolean(privateCheckpoint.has_more),
      },
    });
  } else {
    console.error(`[1/2] Exporting douyin skill-messages-flat to ${outputPath}`);
    const exportCommand = [
      RUN_OPENCLI_SCRIPT,
      options.opencliMain,
      'douyin',
      'skill-messages-flat',
      ...options.opencliArgs,
    ];
    const exportResult = runNodeResult(exportCommand, {
      env: {
        ...process.env,
        OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '180',
      },
    });
    let exported = exportResult.stdout;
    if (!exportResult.ok) {
      const errorText = exportResult.stderr || exportResult.stdout;
      if (shouldUseIsolatedFullMessageExport(options.opencliArgs, [])
        && isRecoverableOpenCliFullExportFailure(errorText)) {
        console.error(`[fallback] Direct private-message export failed recoverably: ${String(errorText).trim()}`);
        exported = '[]';
      } else {
        throw new Error((errorText || `Command failed: node ${exportCommand.join(' ')}`).trim());
      }
    }
    fs.writeFileSync(outputPath, exported);
    exportedRows = parseJsonArray(exported, 'douyin skill-messages-flat output');
    if (shouldUseIsolatedFullMessageExport(options.opencliArgs, exportedRows)) {
      emitTaskEvent({
        step: 'export',
        message: '抖音私信全量直接导出 0 条，切换到会话隔离导出',
        detail: {
          thread_list_file: threadListPath,
        },
      });
      console.error('[fallback] Direct full export returned 0 rows; trying isolated per-thread export.');
      const tabName = getOpenCliArgValue(options.opencliArgs, '--tab_name', '');
      const threadListArgs = [
        RUN_OPENCLI_SCRIPT,
        options.opencliMain,
        'douyin',
        'skill-messages-thread-list-probe',
        ...(tabName ? ['--tab_name', tabName] : []),
        '-f',
        'json',
      ];
      const threadListOutput = runNode(threadListArgs, {
        env: {
          ...process.env,
          OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '180',
        },
      });
      fs.writeFileSync(threadListPath, threadListOutput);
      diagnosticFiles.thread_list = threadListPath;
      const threadRows = parseJsonArray(threadListOutput, 'douyin skill-messages-thread-list-probe output');
      const threadKeywords = buildDouyinPrivateMessageThreadKeywords(threadRows);
      const baseArgs = withoutOpenCliArgs(options.opencliArgs, ['--all', '--thread_keyword', '--thread_rank']);
      const isolatedRows = [];
      for (const keyword of threadKeywords) {
        const candidates = [keyword];
        const shortKeyword = Array.from(keyword).slice(0, 3).join('');
        if (shortKeyword && shortKeyword !== keyword) candidates.push(shortKeyword);
        let matched = false;
        for (const candidate of candidates) {
          const result = runNodeResult([
            RUN_OPENCLI_SCRIPT,
            options.opencliMain,
            'douyin',
            'skill-messages-flat',
            ...baseArgs,
            '--thread_keyword',
            candidate,
          ], {
            env: {
              ...process.env,
              OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '180',
            },
          });
          if (!result.ok) {
            console.error(`[fallback] thread="${keyword}" candidate="${candidate}" failed: ${(result.stderr || result.stdout).trim()}`);
            continue;
          }
          const rows = parseJsonArray(result.stdout, `douyin isolated private message output for ${candidate}`);
          if (rows.length === 0) continue;
          isolatedRows.push(...rows);
          matched = true;
          console.error(`[fallback] thread="${keyword}" candidate="${candidate}" exported ${rows.length} rows.`);
          break;
        }
        if (!matched) {
          console.error(`[fallback] thread="${keyword}" exported 0 rows.`);
        }
      }
      exportedRows = dedupePrivateMessageRows(isolatedRows);
      fs.writeFileSync(outputPath, `${JSON.stringify(exportedRows, null, 2)}\n`);
      emitTaskEvent({
        step: 'export-complete',
        message: `抖音私信会话隔离导出完成：${exportedRows.length} 条`,
        detail: {
          output_file: outputPath,
          exported_rows: exportedRows.length,
          thread_count: threadKeywords.length,
        },
      });
    }
  }
  const accountProfilePath = path.join(outputDir, 'account-profile.json');
  if (!fs.existsSync(accountProfilePath)) {
    console.error(`[profile] Exporting douyin creator account profile to ${accountProfilePath}`);
    runNode([
      path.join(ROOT_DIR, 'scripts', 'harvest-douyin-account.js'),
      '--output-dir',
      outputDir,
    ]);
  }
  emitTaskEvent({
    step: 'export-complete',
    message: `抖音私信导出完成：${exportedRows.length} 条`,
    detail: {
      output_file: outputPath,
      exported_rows: exportedRows.length,
    },
  });
  let wroteProbe = false;
  const diagnosticWarnings = [];
  if (exportedRows.length === 0) {
    emitTaskEvent({
      step: 'probe',
      message: '抖音私信导出 0 条，开始写诊断文件',
      detail: {
        probe_file: probePath,
      },
    });
    const probeOutput = runNode([
      RUN_OPENCLI_SCRIPT,
      options.opencliMain,
      'douyin',
      'skill-messages-probe',
      '-f',
      'json',
    ]);
    fs.writeFileSync(probePath, probeOutput);
    wroteProbe = true;
    diagnosticFiles.page_probe = probePath;
    const probeRows = parseJsonArray(probeOutput, 'douyin skill-messages-probe output');
    const probe = probeRows[0] || {};
    emitTaskEvent({
      step: 'probe',
      message: '抖音私信页面诊断完成',
      detail: {
        probe_file: probePath,
        login_hint: Boolean(probe.has_login_hint),
        message_hint: Boolean(probe.has_message_hint),
        page_unavailable: Boolean(probe.page_unavailable),
        left_candidates: Number(probe.visible_left_candidate_count || 0),
        message_candidates: Number(probe.visible_message_candidate_count || 0),
      },
    });
    console.error(`[probe] wrote ${probePath}`);
    console.error(`[probe] url=${probe.current_url || ''} login_hint=${Boolean(probe.has_login_hint)} message_hint=${Boolean(probe.has_message_hint)} page_unavailable=${Boolean(probe.page_unavailable)} left_candidates=${Number(probe.visible_left_candidate_count || 0)} message_candidates=${Number(probe.visible_message_candidate_count || 0)}`);
    if (!probe.has_login_hint
      && !probe.page_unavailable
      && (Number(probe.visible_left_candidate_count || 0) > 0 || Number(probe.visible_message_candidate_count || 0) > 0)) {
      diagnosticWarnings.push({
        category: 'douyin-private-message-dom-empty',
        message: '抖音私信页面可见会话或消息候选，但本轮没有解析出网页端可见的入站私信正文。',
        next_actions: [
          '确认右侧会话中是否存在网页可见的真实文字消息',
          '提示“请打开抖音 app 查看”的 app-only 消息属于产品边界，当前不会抓取，也不算缺失',
          '如需定位单个会话，可使用 --thread-rank 或 --thread-keyword 单独调试',
        ],
      });
    }

    const diagnosticSpecs = [
      {
        name: 'record_probe',
        successPath: recordProbePath,
        errorPath: recordProbeErrorPath,
        command: [
          RUN_OPENCLI_SCRIPT,
          options.opencliMain,
          'douyin',
          'skill-messages-record-probe',
          '--record_sample_limit',
          options.diagnosticRecordSampleLimit,
          '-f',
          'json',
        ],
      },
      {
        name: 'protobuf_branch_probe',
        successPath: protobufBranchProbePath,
        errorPath: protobufBranchProbeErrorPath,
        command: [
          RUN_OPENCLI_SCRIPT,
          options.opencliMain,
          'douyin',
          'skill-messages-protobuf-branch-probe',
          '--record_sample_limit',
          options.diagnosticRecordSampleLimit,
          '-f',
          'json',
        ],
      },
    ];
    for (const spec of diagnosticSpecs) {
      const result = runNodeResult(spec.command);
      if (result.ok) {
        fs.writeFileSync(spec.successPath, result.stdout);
        diagnosticFiles[spec.name] = spec.successPath;
        emitTaskEvent({
          step: 'probe',
          message: `抖音私信诊断完成：${spec.name}`,
          detail: {
            file: spec.successPath,
          },
        });
        console.error(`[probe] wrote ${spec.successPath}`);
      } else {
        fs.writeFileSync(spec.errorPath, `${JSON.stringify({
          ok: false,
          status: result.status,
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
        }, null, 2)}\n`);
        diagnosticFiles[`${spec.name}_error`] = spec.errorPath;
        emitTaskEvent({
          step: 'probe',
          status: 'warning',
          message: `抖音私信诊断失败：${spec.name}`,
          detail: {
            file: spec.errorPath,
            status: result.status,
          },
        });
        console.error(`[probe] wrote ${spec.errorPath}`);
      }
    }
  }

  if (options.exportOnly) {
    const report = buildPrivateMessagesReport({
      apply: false,
      outputPath,
      probePath: wroteProbe ? probePath : '',
      diagnosticFiles,
      diagnosticWarnings,
      checkpointFile: shouldUseCheckpointedFullMessageExport(options) ? privateCheckpointPath : '',
      checkpoint: privateCheckpoint,
      exportedRows,
      importOutput: '',
    });
    report.status = 'exported';
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    emitTaskEvent({
      step: 'complete',
      message: `抖音私信导出完成：${report.exported_rows} 条`,
      detail: {
        report_file: reportPath,
        output_file: outputPath,
        exported_rows: report.exported_rows,
        apply: false,
      },
    });
    console.error(`[report] wrote ${reportPath}`);
    return { outputPath, reportPath, report };
  }
  emitTaskEvent({
    step: 'import',
    message: '开始导入抖音私信到 scrm_message',
    detail: {
      input_file: outputPath,
      apply: Boolean(options.apply),
    },
  });
  console.error('[2/2] Importing douyin private messages into scrm_message');
  const importOutput = runNode([
    path.join(ROOT_DIR, 'scripts', 'import-private-messages-to-scrm-message.js'),
    '--platform',
    'douyin',
    '--input',
    outputPath,
    ...(options.apply ? ['--apply'] : []),
    ...options.importArgs,
  ]);
  process.stdout.write(importOutput);
  const report = buildPrivateMessagesReport({
    apply: options.apply,
    outputPath,
    probePath: wroteProbe ? probePath : '',
    diagnosticFiles,
    diagnosticWarnings,
    checkpointFile: shouldUseCheckpointedFullMessageExport(options) ? privateCheckpointPath : '',
    checkpoint: privateCheckpoint,
    exportedRows,
    importOutput,
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  emitTaskEvent({
    step: 'complete',
    message: `抖音私信任务完成：导出 ${report.exported_rows} 条，准备写入 ${report.write_attempt_rows} 条`,
    detail: {
      report_file: reportPath,
      output_file: outputPath,
      exported_rows: report.exported_rows,
      write_attempt_rows: report.write_attempt_rows,
      matched_current_payload_rows: report.matched_current_payload_rows,
      apply: Boolean(options.apply),
    },
  });
  console.error(`[report] wrote ${reportPath}`);
  return { outputPath, reportPath, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      run(options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
