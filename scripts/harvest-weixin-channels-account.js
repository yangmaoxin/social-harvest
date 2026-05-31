#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ROOT_DIR } from './lib/runtime-config.js';
import { createChunkDecoder, withUtf8FriendlyEnv } from './lib/stdio-text.js';

const __filename = fileURLToPath(import.meta.url);
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const OPENCLI_MAIN_CANDIDATES = [
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'dist', 'src', 'main.js'),
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
];
const DEFAULT_OPENCLI_MAIN = OPENCLI_MAIN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || OPENCLI_MAIN_CANDIDATES[0];
const DEFAULT_OUTPUT_BASE = path.join(ROOT_DIR, 'samples', 'weixin-channels');
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

export function parseArgs(argv) {
  const options = {
    date: formatShanghaiDate(),
    outputDir: '',
    opencliMain: DEFAULT_OPENCLI_MAIN,
    timeoutSeconds: 300,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') options.date = argv[++index];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--opencli-main') options.opencliMain = path.resolve(argv[++index]);
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++index] || options.timeoutSeconds);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`
Usage:
  node scripts/harvest-weixin-channels-account.js --date <YYYY-MM-DD> [options]

Options:
  --output-dir DIR     Output directory, default samples/weixin-channels/<date>
  --opencli-main PATH  Override OpenCLI main entry
  --timeout SECONDS    Timeout seconds, default 300
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function resolveAccountOutputDir(options) {
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
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

function parseJsonOutput(stdout) {
  const parsed = JSON.parse(String(stdout || '').trim());
  return Array.isArray(parsed) ? parsed : [];
}

export async function runWeixinChannelsAccount(options) {
  const outputDir = resolveAccountOutputDir(options);
  const outputFile = path.join(outputDir, 'account-profile.json');
  const reportFile = path.join(outputDir, 'account-profile-report.json');
  ensureDir(outputDir);

  emitTaskEvent({
    step: 'account-profile',
    message: '开始导出微信视频号账号主体信息',
    detail: {
      output_file: outputFile,
      timeout_seconds: Number(options.timeoutSeconds || 300),
    },
  });
  const result = await runCommand('node', [
    RUN_OPENCLI_SCRIPT,
    options.opencliMain,
    'weixin-channels',
    'account-profile',
    '-f',
    'json',
  ], {
    timeoutMs: Number(options.timeoutSeconds || 300) * 1000,
  });

  const rows = parseJsonOutput(result.stdout);
  emitTaskEvent({
    step: 'account-profile-exported',
    message: `微信视频号账号主体导出完成：${rows.length} 条`,
    detail: {
      output_file: outputFile,
      account_rows: rows.length,
      account_id: rows[0]?.account_id || '',
      account_name: rows[0]?.account_name || '',
      fans_count: Number(rows[0]?.fans_count || 0),
    },
  });
  const report = {
    status: rows[0]?.account_id ? 'complete' : 'partial',
    platform: 'weixin-channels',
    output_file: outputFile,
    report_file: reportFile,
    count: rows.length,
    account_id: rows[0]?.account_id || '',
    warnings: rows[0]?.account_id ? [] : ['No account_id extracted from weixin channels account APIs.'],
  };
  writeJson(outputFile, rows);
  writeJson(reportFile, report);
  emitTaskEvent({
    step: 'account-profile-complete',
    status: report.status === 'complete' ? 'success' : 'warning',
    message: report.status === 'complete'
      ? `微信视频号账号主体任务完成：账号 ${report.account_id}`
      : '微信视频号账号主体任务部分完成：未解析到 account_id',
    detail: {
      report_file: reportFile,
      output_file: outputFile,
      account_rows: report.count,
      account_id: report.account_id,
      warnings: report.warnings,
    },
  });
  return { rows, report, outputFile, reportFile };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const result = await runWeixinChannelsAccount(options);
  console.log(JSON.stringify(result.report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
