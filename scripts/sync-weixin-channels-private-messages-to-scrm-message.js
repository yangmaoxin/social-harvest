#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkpointPathFor,
  createCheckpoint,
  loadCheckpoint,
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
const DEFAULT_OUTPUT_BASE = path.join(ROOT_DIR, 'samples', 'weixin-channels');
const RUNTIME_ADAPTER_DIR = path.join(os.homedir(), '.opencli', 'clis', 'weixin-channels');
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

export function parseArgs(argv) {
  const options = {
    date: todayText(),
    outputDir: '',
    apply: false,
    exportOnly: false,
    opencliMain: process.env.OPENCLI_MAIN || DEFAULT_OPENCLI_MAIN,
    opencliArgs: ['--all', '-f', 'json'],
    importArgs: [],
    help: false,
    full: false,
    batchSize: 50,
    maxItems: 0,
    resume: true,
    refresh: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') options.date = argv[++index];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--export-only') options.exportOnly = true;
    else if (arg === '--limit') options.opencliArgs.push('--limit', argv[++index]);
    else if (arg === '--tab') options.opencliArgs.push('--tab', argv[++index]);
    else if (arg === '--message-limit') options.opencliArgs.push('--message-limit', argv[++index]);
    else if (arg === '--all-messages') options.opencliArgs.push('--all-messages');
    else if (arg === '--full') options.full = true;
    else if (arg === '--batch-size') options.batchSize = Number(argv[++index]);
    else if (arg === '--max-items') options.maxItems = Number(argv[++index]);
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--no-resume') options.resume = false;
    else if (arg === '--refresh') options.refresh = true;
    else if (['--host', '--user', '--password', '--database', '--config'].includes(arg)) {
      options.importArgs.push(arg, argv[++index]);
    } else if (arg === '--opencli-main') {
      options.opencliMain = path.resolve(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.full && !options.opencliArgs.includes('--all-messages')) {
    options.opencliArgs.push('--all-messages');
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/sync-weixin-channels-private-messages-to-scrm-message.js [options]

Options:
  --date YYYY-MM-DD      Output under samples/weixin-channels/<date>/, default today
  --output-dir PATH      Override output directory
  --export-only          Only export private-messages-flat.json; skip dry-run/apply import
  --apply                Write into MySQL after dry-run mapping
  --limit N              Only fetch the first N conversations
  --tab VALUE            private | greeting | both
  --message-limit N      Keep at most N messages per conversation
  --all-messages         Keep all visible messages per conversation
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

function syncRuntimeAdapter() {
  const sourceDir = path.join(ROOT_DIR, 'adapters', 'weixin-channels');
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(path.dirname(RUNTIME_ADAPTER_DIR), { recursive: true });
  fs.rmSync(RUNTIME_ADAPTER_DIR, { recursive: true, force: true });
  fs.cpSync(sourceDir, RUNTIME_ADAPTER_DIR, { recursive: true });
}

function setOpenCliArgValue(args = [], name = '', value = '') {
  const index = args.indexOf(name);
  if (index >= 0 && index + 1 < args.length) {
    args[index + 1] = String(value);
  } else {
    args.push(name, String(value));
  }
}

function withoutOpenCliArgs(args = [], names = []) {
  const removals = new Set(names);
  const valueFlags = new Set([
    '--limit',
    '--tab',
    '--message-limit',
    '--thread-offset',
    '--thread-limit',
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

function parseJsonArray(text, label) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function countHarvestThreads(groups = []) {
  return (Array.isArray(groups) ? groups : []).reduce((sum, group) => {
    if (Array.isArray(group?.threads)) return sum + group.threads.length;
    return sum + Number(group?.thread_count || 0);
  }, 0);
}

function countHarvestMessages(groups = []) {
  return (Array.isArray(groups) ? groups : []).reduce((sum, group) => {
    if (Array.isArray(group?.threads)) {
      return sum + group.threads.reduce((innerSum, thread) => innerSum + Number(thread?.message_count || 0), 0);
    }
    return sum + Number(group?.fetched_message_count || 0);
  }, 0);
}

function harvestThreadItems(groups = []) {
  const items = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const thread of Array.isArray(group?.threads) ? group.threads : []) {
      const key = String(thread?.thread_id || `${thread?.tab || group?.tab || ''}:${thread?.nickname || ''}`).trim();
      if (!key) continue;
      items.push({
        key,
        tab: thread?.tab || group?.tab || '',
        nickname: thread?.nickname || '',
        fetched_at: new Date().toISOString(),
        message_count: Number(thread?.message_count || 0),
      });
    }
  }
  return items;
}

function mergeCompletedItems(current = {}, items = []) {
  const completed = { ...(current?.completed_items || {}) };
  for (const item of items) {
    completed[item.key] = {
      status: 'completed',
      tab: item.tab,
      nickname: item.nickname,
      fetched_at: item.fetched_at,
      message_count: item.message_count,
    };
  }
  return completed;
}

export function parseTaggedJson(text, tag) {
  const prefix = `${tag} `;
  const line = String(text || '').split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return null;
  return JSON.parse(line.slice(prefix.length));
}

export function buildPrivateMessagesReport({
  apply = false,
  exportOnly = false,
  outputPath = '',
  checkpointFile = '',
  checkpoint = null,
  exportedRows = [],
  importOutput = '',
  warnings = [],
} = {}) {
  const importSummary = parseTaggedJson(importOutput, 'IMPORT_SUMMARY');
  const importVerification = parseTaggedJson(importOutput, 'IMPORT_VERIFICATION');
  const verification = importVerification?.verification || {};
  return {
    platform: 'weixin-channels',
    status: exportOnly ? 'exported' : apply ? 'imported' : 'dry-run',
    apply,
    export_only: exportOnly,
    output_file: outputPath,
    checkpoint_file: checkpointFile,
    checkpoint_status: checkpoint?.status || '',
    checkpoint_has_more: Boolean(checkpoint?.has_more),
    checkpoint_completed_count: Number(checkpoint?.completed_count || 0),
    checkpoint_total_count: Number(checkpoint?.total_count || 0),
    exported_rows: exportedRows.length,
    message_rows: exportOnly ? exportedRows.length : Number(importSummary?.message_rows || 0),
    write_attempt_rows: Number(importSummary?.write_attempt_rows || 0),
    matched_current_payload_rows: Number(verification.matched_current_payload_rows || 0),
    warnings: [
      ...(Array.isArray(importSummary?.warnings) ? importSummary.warnings : []),
      ...(Array.isArray(warnings) ? warnings : []),
    ],
    import_summary: importSummary,
    import_verification: importVerification,
  };
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function resolveWeixinOutputDir(options) {
  if (!options.outputDir) return path.join(DEFAULT_OUTPUT_BASE, options.date);
  if (samePath(options.outputDir, DEFAULT_OUTPUT_BASE)) {
    return path.join(DEFAULT_OUTPUT_BASE, options.date);
  }
  return options.outputDir;
}

export function run(options) {
  if (!fs.existsSync(options.opencliMain)) {
    throw new Error(`OpenCLI entry not found: ${options.opencliMain}. Build workspace/OpenCLI first, or pass --opencli-main PATH.`);
  }

  syncRuntimeAdapter();

  const outputDir = resolveWeixinOutputDir(options);
  const outputPath = path.join(outputDir, 'private-messages-flat.json');
  const reportPath = path.join(outputDir, 'private-messages-report.json');
  const privateCheckpointPath = checkpointPathFor(outputDir, 'private-messages-checkpoint.json');
  const longTask = normalizeLongTaskOptions(options);
  fs.mkdirSync(outputDir, { recursive: true });
  let privateCheckpoint = null;

  emitTaskEvent({
    step: 'export',
    message: '开始导出微信视频号私信',
    detail: {
      output_file: outputPath,
      apply: Boolean(options.apply),
      export_only: Boolean(options.exportOnly),
    },
  });
  let exportedRows = [];
  if (options.full) {
    if (longTask.refresh) resetCheckpoint(privateCheckpointPath);
    privateCheckpoint = longTask.resume ? loadCheckpoint(privateCheckpointPath) : null;
    if (!privateCheckpoint) {
      privateCheckpoint = createCheckpoint({
        platform: 'weixin-channels',
        task: 'creator-messages',
        full: true,
        batchSize: longTask.batchSize,
        maxItems: longTask.maxItems,
      });
    }

    const completedOffset = Number(privateCheckpoint.completed_count || 0);
    const remainingByMax = longTask.maxItems
      ? Math.max(0, longTask.maxItems - completedOffset)
      : longTask.batchSize;
    const batchSize = Math.min(longTask.batchSize, remainingByMax);
    const baseArgs = withoutOpenCliArgs(options.opencliArgs, ['--limit', '--thread-offset', '--thread-limit']);

    if (batchSize <= 0) {
      privateCheckpoint = saveCheckpoint(privateCheckpointPath, {
        ...privateCheckpoint,
        platform: 'weixin-channels',
        task: 'creator-messages',
        mode: 'full',
        batch_size: longTask.batchSize,
        max_items: longTask.maxItems,
        has_more: false,
        status: 'complete',
        total_count: Number(privateCheckpoint.total_count || longTask.maxItems || completedOffset),
      });
      exportedRows = readExistingPrivateMessageRows(outputPath);
      fs.writeFileSync(outputPath, `${JSON.stringify(exportedRows, null, 2)}\n`, 'utf8');
    } else {
      const batchArgs = [...baseArgs];
      setOpenCliArgValue(batchArgs, '--thread-offset', completedOffset);
      setOpenCliArgValue(batchArgs, '--thread-limit', batchSize);
      console.error(`[1/2] Exporting weixin-channels private-messages batch offset=${completedOffset} limit=${batchSize} to ${outputPath}`);
      const harvestOutput = runNode([
        RUN_OPENCLI_SCRIPT,
        options.opencliMain,
        'weixin-channels',
        'private-messages-harvest',
        ...batchArgs,
      ]);
      const harvestGroups = parseJsonArray(harvestOutput, 'weixin-channels private-messages-harvest output');
      const batchThreadCount = countHarvestThreads(harvestGroups);
      const batchHarvestMessageCount = countHarvestMessages(harvestGroups);
      let batchRows = [];
      if (batchThreadCount > 0) {
        const exported = runNode([
          RUN_OPENCLI_SCRIPT,
          options.opencliMain,
          'weixin-channels',
          'private-messages-flat',
          ...batchArgs,
        ]);
        batchRows = parseJsonArray(exported, 'weixin-channels private-messages-flat output');
        if (batchRows.length === 0 && batchHarvestMessageCount > 0) {
          console.error('[retry] weixin-channels private-messages-flat returned 0 rows while harvest had messages; retrying once.');
          const retried = runNode([
            RUN_OPENCLI_SCRIPT,
            options.opencliMain,
            'weixin-channels',
            'private-messages-flat',
            ...batchArgs,
          ]);
          batchRows = parseJsonArray(retried, 'weixin-channels private-messages-flat retry output');
        }
      }
      exportedRows = dedupePrivateMessageRows([
        ...(longTask.refresh && completedOffset === 0 ? [] : readExistingPrivateMessageRows(outputPath)),
        ...batchRows,
      ]);
      const nextCompleted = completedOffset + batchThreadCount;
      const reachedMax = Boolean(longTask.maxItems && nextCompleted >= longTask.maxItems);
      const hasMore = batchThreadCount >= batchSize && !reachedMax;
      const nextTotalCount = hasMore
        ? (longTask.maxItems || Number(privateCheckpoint.total_count || 0))
        : nextCompleted;
      const checkpointWarnings = [
        ...(Array.isArray(privateCheckpoint.warnings) ? privateCheckpoint.warnings : []),
        ...(batchThreadCount > 0 && batchHarvestMessageCount > 0 && batchRows.length === 0 ? [{
          category: 'weixin-private-message-flat-empty',
          message: `微信视频号私信聚合结果显示本批 ${batchThreadCount} 个会话有 ${batchHarvestMessageCount} 条消息，但扁平导出仍为 0 条。`,
        }] : []),
      ];
      privateCheckpoint = saveCheckpoint(privateCheckpointPath, {
        ...privateCheckpoint,
        platform: 'weixin-channels',
        task: 'creator-messages',
        mode: 'full',
        batch_size: longTask.batchSize,
        max_items: longTask.maxItems,
        current_batch: Number(privateCheckpoint.current_batch || 0) + (batchThreadCount > 0 ? 1 : 0),
        next_cursor: String(nextCompleted),
        has_more: hasMore,
        status: hasMore ? 'running' : 'complete',
        completed_count: nextCompleted,
        total_count: nextTotalCount,
        completed_items: mergeCompletedItems(privateCheckpoint, harvestThreadItems(harvestGroups)),
        warnings: checkpointWarnings,
      });
      fs.writeFileSync(outputPath, `${JSON.stringify(exportedRows, null, 2)}\n`, 'utf8');
    }
  } else {
    console.error(`[1/2] Exporting weixin-channels private-messages-flat to ${outputPath}`);
    const exported = runNode([
      RUN_OPENCLI_SCRIPT,
      options.opencliMain,
      'weixin-channels',
      'private-messages-flat',
      ...options.opencliArgs,
    ]);
    fs.writeFileSync(outputPath, exported, 'utf8');
    exportedRows = parseJsonArray(exported, 'weixin-channels private-messages-flat output');
  }
  emitTaskEvent({
    step: 'export-complete',
    message: privateCheckpoint?.has_more
      ? `微信视频号私信本批完成：累计导出 ${exportedRows.length} 条，下次会继续剩余会话`
      : `微信视频号私信导出完成：${exportedRows.length} 条`,
    detail: {
      output_file: outputPath,
      checkpoint_file: options.full ? privateCheckpointPath : '',
      checkpoint_has_more: Boolean(privateCheckpoint?.has_more),
      checkpoint_completed_count: Number(privateCheckpoint?.completed_count || 0),
      exported_rows: exportedRows.length,
    },
  });

  let importOutput = '';
  if (!options.exportOnly) {
    const accountProfilePath = path.join(outputDir, 'account-profile.json');
    if (!fs.existsSync(accountProfilePath)) {
      console.error(`[profile] Exporting weixin-channels account profile to ${accountProfilePath}`);
      runNode([
        path.join(ROOT_DIR, 'scripts', 'harvest-weixin-channels-account.js'),
        '--output-dir',
        outputDir,
      ]);
    }
    emitTaskEvent({
      step: 'import',
      message: '开始导入微信视频号私信到 scrm_message',
      detail: {
        input_file: outputPath,
        apply: Boolean(options.apply),
      },
    });
    console.error('[2/2] Importing weixin-channels private messages into scrm_message');
    importOutput = runNode([
      path.join(ROOT_DIR, 'scripts', 'import-private-messages-to-scrm-message.js'),
      '--platform',
      'weixin-channels',
      '--input',
      outputPath,
      ...(options.apply ? ['--apply'] : []),
      ...options.importArgs,
    ]);
    process.stdout.write(importOutput);
    const importSummary = parseTaggedJson(importOutput, 'IMPORT_SUMMARY') || {};
    const importVerification = parseTaggedJson(importOutput, 'IMPORT_VERIFICATION') || {};
    emitTaskEvent({
      step: 'import-complete',
      status: options.apply ? 'success' : 'running',
      message: options.apply
        ? `微信视频号私信入库完成：准备写入 ${Number(importSummary.write_attempt_rows || 0)} 条`
        : `微信视频号私信 dry-run 完成：准备写入 ${Number(importSummary.write_attempt_rows || 0)} 条`,
      detail: {
        message_rows: Number(importSummary.message_rows || 0),
        write_attempt_rows: Number(importSummary.write_attempt_rows || 0),
        matched_current_payload_rows: Number(importVerification.verification?.matched_current_payload_rows || 0),
        apply: Boolean(options.apply),
      },
    });
  }

  const report = buildPrivateMessagesReport({
    apply: options.apply,
    exportOnly: options.exportOnly,
    outputPath,
    checkpointFile: options.full ? privateCheckpointPath : '',
    checkpoint: privateCheckpoint,
    exportedRows,
    importOutput,
    warnings: privateCheckpoint?.warnings || [],
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  emitTaskEvent({
    step: 'complete',
    message: options.exportOnly
      ? `微信视频号私信导出完成：${report.exported_rows} 条`
      : `微信视频号私信任务完成：导出 ${report.exported_rows} 条，准备写入 ${report.write_attempt_rows} 条`,
    detail: {
      report_file: reportPath,
      output_file: outputPath,
      exported_rows: report.exported_rows,
      write_attempt_rows: report.write_attempt_rows,
      matched_current_payload_rows: report.matched_current_payload_rows,
      apply: Boolean(options.apply),
      export_only: Boolean(options.exportOnly),
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
