#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { enrichDanmakuRows, resolveDanmakuWorkIndexPath } from './import-danmaku-to-scrm.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPENCLI_MAIN_CANDIDATES = [
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'dist', 'src', 'main.js'),
];
const DEFAULT_OPENCLI_MAIN = OPENCLI_MAIN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || OPENCLI_MAIN_CANDIDATES[0];
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const DEFAULT_OUTPUT_BASE = path.join(ROOT_DIR, 'samples', 'weixin-channels');
const TASK_EVENT_PREFIX = 'TASK_EVENT ';
const DEFAULT_DANMAKU_RETRIES = 2;
const DEFAULT_DANMAKU_RETRY_DELAY_MS = 120000;

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
    danmakuRetries: DEFAULT_DANMAKU_RETRIES,
    danmakuRetryDelayMs: DEFAULT_DANMAKU_RETRY_DELAY_MS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') options.date = argv[++index];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--export-only') options.exportOnly = true;
    else if (arg === '--limit') options.opencliArgs.push('--limit', argv[++index]);
    else if (arg === '--work-ids') options.opencliArgs.push('--work-ids', argv[++index]);
    else if (arg === '--work-ids-file') options.opencliArgs.push('--work-ids-file', path.resolve(argv[++index]));
    else if (arg === '--danmaku-retries') options.danmakuRetries = Number(argv[++index] || 0);
    else if (arg === '--danmaku-retry-delay-ms') options.danmakuRetryDelayMs = Number(argv[++index] || 0);
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
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/sync-weixin-channels-danmaku-to-scrm.js [options]

Options:
  --date YYYY-MM-DD      Output under samples/weixin-channels/<date>/, default today
  --output-dir PATH      Override output directory
  --export-only          Only export danmaku-flat.json; skip dry-run/apply import
  --apply                Write into MySQL after dry-run mapping
  --limit N              Only fetch the first N videos with danmaku
  --work-ids VALUE       Comma-separated object_id/export_id values to inspect
  --work-ids-file PATH   JSON file containing work ids or a delta plan
  --danmaku-retries N    Retry danmaku export on platform rate limit, default ${DEFAULT_DANMAKU_RETRIES}
  --danmaku-retry-delay-ms MS
                          Initial wait before retrying a rate-limited export, default ${DEFAULT_DANMAKU_RETRY_DELAY_MS}
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

export function isWeixinChannelsRateLimitError(error) {
  const text = error instanceof Error ? error.message : String(error || '');
  return /请求过于频繁|稍后再试|too\s+frequent|rate\s*limit/i.test(text);
}

function sleepSync(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (delay <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
}

export function runNodeWithRateLimitRetry(args, {
  retries = DEFAULT_DANMAKU_RETRIES,
  retryDelayMs = DEFAULT_DANMAKU_RETRY_DELAY_MS,
  onRetry,
} = {}) {
  const maxRetries = Math.max(0, Number(retries) || 0);
  let attempt = 0;
  while (true) {
    try {
      return runNode(args);
    } catch (error) {
      if (!isWeixinChannelsRateLimitError(error) || attempt >= maxRetries) throw error;
      attempt += 1;
      const delayMs = Math.max(0, Number(retryDelayMs) || 0) * attempt;
      onRetry?.({ attempt, maxRetries, delayMs, error });
      sleepSync(delayMs);
    }
  }
}

function parseJsonArray(text, label) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseTaggedJson(text, tag) {
  const prefix = `${tag} `;
  const line = String(text || '').split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return null;
  return JSON.parse(line.slice(prefix.length));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

export function buildDanmakuReport({
  apply = false,
  exportOnly = false,
  outputPath = '',
  exportedRows = [],
  importOutput = '',
} = {}) {
  const importSummary = parseTaggedJson(importOutput, 'IMPORT_SUMMARY');
  const importVerification = parseTaggedJson(importOutput, 'IMPORT_VERIFICATION');
  const danmakuRows = Number(importSummary?.danmaku_rows ?? 0);
  return {
    platform: 'weixin-channels',
    status: exportOnly ? 'exported' : apply ? 'imported' : 'dry-run',
    apply,
    export_only: exportOnly,
    output_file: outputPath,
    exported_rows: exportedRows.length,
    danmaku_rows: exportOnly ? exportedRows.length : danmakuRows,
    write_attempt_rows: Number(importSummary?.write_attempt_rows || 0),
    matched_current_payload_rows: Number(importVerification?.matched_rows || 0),
    warnings: Array.isArray(importSummary?.warnings) ? importSummary.warnings : [],
    import_summary: importSummary,
    import_verification: importVerification,
  };
}
export const buildBulletChatsReport = buildDanmakuReport;

export function run(options) {
  if (!fs.existsSync(options.opencliMain)) {
    throw new Error(`OpenCLI entry not found: ${options.opencliMain}. Build workspace/OpenCLI first, or pass --opencli-main PATH.`);
  }

  const outputDir = resolveWeixinOutputDir(options);
  const outputPath = path.join(outputDir, 'danmaku-flat.json');
  const reportPath = path.join(outputDir, 'danmaku-report.json');
  const workIndexPath = resolveDanmakuWorkIndexPath(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  emitTaskEvent({
    step: 'export',
    message: '开始导出微信视频号弹幕',
    detail: {
      output_file: outputPath,
      apply: Boolean(options.apply),
      export_only: Boolean(options.exportOnly),
    },
  });
  console.error(`[1/2] Exporting weixin-channels danmaku to ${outputPath}`);
  const exported = runNodeWithRateLimitRetry([
    RUN_OPENCLI_SCRIPT,
    options.opencliMain,
    'weixin-channels',
    'danmaku-flat',
    ...options.opencliArgs,
  ], {
    retries: options.danmakuRetries,
    retryDelayMs: options.danmakuRetryDelayMs,
    onRetry: ({ attempt, maxRetries, delayMs, error }) => {
      const seconds = Math.round(delayMs / 1000);
      console.error(`[rate-limit] weixin-channels danmaku export was rate-limited; retry ${attempt}/${maxRetries} after ${seconds}s.`);
      emitTaskEvent({
        step: 'export-rate-limited',
        message: `微信视频号弹幕导出触发限流，${seconds} 秒后重试（${attempt}/${maxRetries}）`,
        detail: {
          retry_attempt: attempt,
          retry_count: maxRetries,
          retry_delay_ms: delayMs,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    },
  });
  const exportedRows = enrichDanmakuRows(
    parseJsonArray(exported, 'weixin-channels danmaku-flat output'),
    { platform: 'weixin-channels', rootDir: ROOT_DIR, workIndexPath },
  );
  writeJsonFile(outputPath, exportedRows);
  emitTaskEvent({
    step: 'export-complete',
    message: `微信视频号弹幕导出完成：${exportedRows.length} 条`,
    detail: {
      output_file: outputPath,
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
      message: '开始导入微信视频号弹幕到 scrm_danmaku',
      detail: {
        input_file: outputPath,
        apply: Boolean(options.apply),
      },
    });
    console.error('[2/2] Importing weixin-channels danmaku into scrm_danmaku');
    importOutput = runNode([
      path.join(ROOT_DIR, 'scripts', 'import-danmaku-to-scrm.js'),
      '--platform',
      'weixin-channels',
      '--input',
      outputPath,
      '--work-index',
      workIndexPath,
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
        ? `微信视频号弹幕入库完成：准备写入 ${Number(importSummary.write_attempt_rows || 0)} 条`
        : `微信视频号弹幕 dry-run 完成：准备写入 ${Number(importSummary.write_attempt_rows || 0)} 条`,
      detail: {
        danmaku_rows: Number(importSummary.danmaku_rows || 0),
        write_attempt_rows: Number(importSummary.write_attempt_rows || 0),
        matched_current_payload_rows: Number(importVerification.matched_rows || 0),
        apply: Boolean(options.apply),
      },
    });
  }

  const report = buildDanmakuReport({
    apply: options.apply,
    exportOnly: options.exportOnly,
    outputPath,
    exportedRows,
    importOutput,
  });
  writeJsonFile(reportPath, report);
  emitTaskEvent({
    step: 'complete',
    message: options.exportOnly
      ? `微信视频号弹幕导出完成：${report.exported_rows} 条`
      : `微信视频号弹幕任务完成：导出 ${report.exported_rows} 条，准备写入 ${report.write_attempt_rows} 条`,
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

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
