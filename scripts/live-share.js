import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  childEventFromLine,
  createLineCollector,
  formatDetailedTaskEventBlock,
  isRawJsonLikeLine,
  isStructuredEventLine,
} from '../runner/events.js';

const DEFAULT_LOG_PATH = '/scrm/terminal/events';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 800;
const TASK_EVENT_PREFIX = 'TASK_EVENT ';
const OPENCLI_PROGRESS_PREFIX = 'OPENCLI_PROGRESS ';

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function generatedTaskId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 17);
  return `terminal-${stamp}`;
}

function defaultSpoolFile() {
  return path.join(process.cwd(), '.harvest-terminal-log-spool.jsonl');
}

function parseNonNegativeInt(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.floor(next) : fallback;
}

export function parseArgs(argv) {
  const splitIndex = argv.indexOf('--');
  const optionArgs = splitIndex >= 0 ? argv.slice(0, splitIndex) : argv;
  const commandArgs = splitIndex >= 0 ? argv.slice(splitIndex + 1) : [];
  const options = {
    server: process.env.HARVEST_OPS_TERMINAL_SERVER || '',
    taskId: process.env.HARVEST_OPS_TERMINAL_TASK_ID || generatedTaskId(),
    deviceId: process.env.HARVEST_OPS_TERMINAL_DEVICE_ID || os.hostname(),
    spoolFile: process.env.HARVEST_OPS_TERMINAL_SPOOL_FILE || defaultSpoolFile(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retryAttempts: DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    cwd: process.cwd(),
    help: false,
    passthrough: false,
    includeRawOutput: false,
    quiet: false,
  };

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (arg === '--server') options.server = optionArgs[++i] || '';
    else if (arg === '--task-id') options.taskId = optionArgs[++i] || options.taskId;
    else if (arg === '--device-id') options.deviceId = optionArgs[++i] || options.deviceId;
    else if (arg === '--spool-file') options.spoolFile = optionArgs[++i] || options.spoolFile;
    else if (arg === '--timeout-ms') options.timeoutMs = parseNonNegativeInt(optionArgs[++i], options.timeoutMs);
    else if (arg === '--retry-attempts') options.retryAttempts = parseNonNegativeInt(optionArgs[++i], options.retryAttempts);
    else if (arg === '--retry-delay-ms') options.retryDelayMs = parseNonNegativeInt(optionArgs[++i], options.retryDelayMs);
    else if (arg === '--cwd') options.cwd = optionArgs[++i] || options.cwd;
    else if (arg === '--passthrough') options.passthrough = true;
    else if (arg === '--include-raw-output') options.includeRawOutput = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (commandArgs.length > 0) {
    options.command = commandArgs[0];
    options.commandArgs = commandArgs.slice(1);
  } else {
    options.command = '';
    options.commandArgs = [];
  }
  return options;
}

export function terminalLogUrl(options) {
  if (!options.server) throw new Error('Missing --server or HARVEST_OPS_TERMINAL_SERVER.');
  return `${trimTrailingSlash(options.server)}${DEFAULT_LOG_PATH}`;
}

function parsePrefixedJsonLine(line, prefix) {
  const text = String(line || '').trim();
  if (!text.startsWith(prefix)) return null;
  try {
    return JSON.parse(text.slice(prefix.length));
  } catch {
    return null;
  }
}

function levelFromStructuredEvent(event = {}, fallbackLevel = 'info') {
  const text = [
    event.level,
    event.status,
    event.type,
    event.step,
    event.message,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  if (/\b(error|failed|fail|api-error)\b|失败|错误/.test(text)) return 'error';
  if (/\b(warn|warning)\b|警告/.test(text)) return 'warn';
  return fallbackLevel;
}

function levelFromLine(line, stream) {
  const text = String(line || '');
  if (/TASK_EVENT |OPENCLI_PROGRESS /.test(text)) {
    const event = parsePrefixedJsonLine(text, TASK_EVENT_PREFIX) || parsePrefixedJsonLine(text, OPENCLI_PROGRESS_PREFIX) || {};
    return levelFromStructuredEvent(event, stream === 'stderr' ? 'info' : 'info');
  }
  if (/error|failed|exception|traceback|失败|错误/i.test(text)) return 'error';
  if (/warn|warning|警告/i.test(text)) return 'warn';
  return 'info';
}

function messageFromStructuredLine(line, stream) {
  const taskEvent = parsePrefixedJsonLine(line, TASK_EVENT_PREFIX);
  if (taskEvent) return displayMessageFromTaskEvent(taskEvent) || taskEvent.message || line;

  const childEvent = childEventFromLine(line, { stream });
  if (childEvent?.message) {
    return displayMessageFromChildEvent(childEvent);
  }
  return line;
}

function displayMessageFromTaskEvent(event = {}) {
  return formatDetailedTaskEventBlock(event);
}

function displayMessageFromChildEvent(event = {}) {
  return formatDetailedTaskEventBlock({
    status: event.status || 'running',
    step: event.step || 'progress',
    source: event.source || 'child',
    message: event.message || '任务进度更新',
    detail: event.detail || {},
  });
}

function printStatus(options, message) {
  if (options.quiet) return;
  console.error(`[live-share] ${message}`);
}

function printSharedDisplay(options, payload) {
  if (options.quiet || !payload?.message) return;
  console.error(payload.message);
}

export function buildTerminalLogPayload(line, options = {}, meta = {}) {
  const rawLine = String(line ?? '');
  if (!rawLine.trim()) return null;
  const stream = meta.stream || 'stdout';
  const message = isStructuredEventLine(rawLine)
    ? messageFromStructuredLine(rawLine.trim(), stream)
    : rawLine.trimEnd();
  if (!String(message || '').trim()) return null;
  return {
    device_id: options.deviceId,
    task_id: options.taskId,
    level: meta.level || levelFromLine(rawLine, stream),
    message,
    occurred_at: meta.occurredAt || nowIso(),
  };
}

function buildDisplayPayload(message, options = {}, meta = {}) {
  const text = String(message || '').trim();
  if (!text) return null;
  return {
    device_id: options.deviceId,
    task_id: options.taskId,
    level: meta.level || 'info',
    message: text,
    occurred_at: meta.occurredAt || nowIso(),
  };
}

export function shouldForwardLine(line, options = {}, meta = {}) {
  const rawLine = String(line ?? '');
  if (!rawLine.trim()) return false;
  if (isStructuredEventLine(rawLine)) return true;
  if (isRawJsonLikeLine(rawLine)) return Boolean(options.includeRawOutput);
  if (meta.stream === 'stderr') return true;
  return Boolean(options.includeRawOutput);
}

export async function postTerminalLog(payload, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetch || fetch)(terminalLogUrl(options), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
      const data = text ? JSON.parse(text) : {};
      if (typeof data.code === 'number' && data.code !== 0) {
        throw new Error(`API code ${data.code}: ${data.message || text}`);
      }
      return data;
    } catch (error) {
      if (error instanceof SyntaxError) return { raw: text };
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function postTerminalLogWithStats(payload, options = {}) {
  const data = await postTerminalLog(payload, options);
  options.stats.sent += 1;
  return data;
}

function appendSpool(spoolFile, payload) {
  if (!spoolFile) return;
  fs.mkdirSync(path.dirname(spoolFile), { recursive: true });
  fs.appendFileSync(spoolFile, `${JSON.stringify(payload)}\n`);
}

function readSpool(spoolFile) {
  if (!spoolFile || !fs.existsSync(spoolFile)) return [];
  return fs.readFileSync(spoolFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function sendWithRetry(payload, options) {
  const attempts = Math.max(1, options.retryAttempts || 1);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await postTerminalLogWithStats(payload, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && options.retryDelayMs > 0) {
        await sleep(options.retryDelayMs * attempt);
      }
    }
  }
  appendSpool(options.spoolFile, payload);
  if (options.stats) options.stats.spooled += 1;
  throw lastError;
}

async function drainSpool(options) {
  const pending = readSpool(options.spoolFile);
  if (pending.length === 0) return;
  const failed = [];
  for (const payload of pending) {
    try {
      await sendWithRetry(payload, { ...options, spoolFile: '' });
    } catch {
      failed.push(payload);
    }
  }
  if (failed.length === 0) {
    fs.rmSync(options.spoolFile, { force: true });
    return;
  }
  fs.writeFileSync(options.spoolFile, failed.map((payload) => JSON.stringify(payload)).join('\n') + '\n');
}

function printHelp() {
  console.log(`Usage:
  npm run share:run -- --server http://127.0.0.1:8001 --task-id demo --device-id win-office -- <command> [args...]

Options:
  --server <url>          Go backend base URL. Example: http://127.0.0.1:8001
  --task-id <id>          Remote task ID shown in SCRM terminal log page
  --device-id <id>        Device ID shown in SCRM terminal log page
  --spool-file <path>     Failed log spool file. Default: .harvest-terminal-log-spool.jsonl
  --passthrough           Print child stdout/stderr locally while forwarding
  --include-raw-output    Also forward plain stdout lines. Defaults off to avoid large JSON reports.
  --quiet                 Hide local forwarder status lines.
`);
}

export async function runTerminalLogForwarder(argv = process.argv.slice(2), runtime = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!options.command) throw new Error('Missing command after --.');
  if (!options.server) throw new Error('Missing --server or HARVEST_OPS_TERMINAL_SERVER.');

  const effectiveOptions = {
    ...options,
    fetch: runtime.fetch || fetch,
    stats: {
      sent: 0,
      spooled: 0,
      suppressed: 0,
    },
  };
  const enqueue = [];
  const sendPayload = (payload, sendOptions = {}) => {
    if (!payload) return null;
    if (sendOptions.localDisplay !== false) printSharedDisplay(options, payload);
    const job = sendWithRetry(payload, effectiveOptions).catch((error) => {
      console.error(`[live-share] failed to send log, spooled: ${error instanceof Error ? error.message : String(error)}`);
    });
    enqueue.push(job);
    return job;
  };

  await drainSpool(effectiveOptions);
  printStatus(options, `starting task ${options.taskId} on ${options.deviceId}`);
  printStatus(options, `forwarding display events to ${terminalLogUrl(options)}`);
  if (!options.includeRawOutput) {
    printStatus(options, 'plain stdout is hidden by default; add --include-raw-output only for debugging');
  }
  sendPayload(buildDisplayPayload(
    formatDetailedTaskEventBlock({
      status: 'running',
      step: 'start',
      message: `远端详细展示已启动：任务 ${options.taskId}，设备 ${options.deviceId}`,
      detail: { phase_label: '实时分享' },
    }),
    options,
    { level: 'info' },
  ));

  const child = spawn(options.command, options.commandArgs, {
    cwd: options.cwd,
    env: {
      ...process.env,
      OPENCLI_TASK_EVENTS: 'jsonl',
      OPENCLI_PROGRESS_EVENTS: 'jsonl',
    },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  printStatus(options, `child command spawned: ${options.command} ${options.commandArgs.join(' ')}`.trim());

  const stdoutLines = createLineCollector((line) => {
    if (!shouldForwardLine(line, options, { stream: 'stdout' })) {
      if (String(line || '').trim()) effectiveOptions.stats.suppressed += 1;
      return;
    }
    const payload = buildTerminalLogPayload(line, options, { stream: 'stdout' });
    if (!payload) return;
    if (options.passthrough) console.log(line);
    sendPayload(payload);
  });
  const stderrLines = createLineCollector((line) => {
    if (!shouldForwardLine(line, options, { stream: 'stderr' })) return;
    const payload = buildTerminalLogPayload(line, options, { stream: 'stderr' });
    if (!payload) return;
    if (options.passthrough) console.error(line);
    sendPayload(payload);
  });

  child.stdout.on('data', (chunk) => stdoutLines.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderrLines.push(chunk.toString()));

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  stdoutLines.flush();
  stderrLines.flush();

  await Promise.allSettled(enqueue);
  sendPayload(buildTerminalLogPayload(
    formatDetailedTaskEventBlock({
      status: exitCode === 0 ? 'success' : 'error',
      step: 'complete',
      message: `远端详细展示结束：退出码 ${exitCode}，已发送 ${effectiveOptions.stats.sent} 条，暂存 ${effectiveOptions.stats.spooled} 条，隐藏 stdout ${effectiveOptions.stats.suppressed} 行`,
      detail: { phase_label: '实时分享' },
    }),
    options,
    { level: exitCode === 0 ? 'info' : 'error' },
  ));
  await Promise.allSettled(enqueue);
  printStatus(
    options,
    `finished with exit code ${exitCode}; sent ${effectiveOptions.stats.sent}, spooled ${effectiveOptions.stats.spooled}, hidden stdout ${effectiveOptions.stats.suppressed}`,
  );
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTerminalLogForwarder().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
