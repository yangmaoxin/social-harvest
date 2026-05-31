import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  childEventFromLine,
  createLineCollector,
  emitTaskEvent,
  formatDetailedTaskEventBlock,
  formatTaskEventLine,
  normalizeDisplayMode,
  taskEventFromLine,
} from '../../runner/events.js';
import {
  buildTaskState,
  elapsedMs,
  nowIso,
} from '../../runner/reports.js';
import { ROOT_DIR } from './runtime-config.js';

const DEFAULT_HEARTBEAT_MS = 30_000;
const IMPORTANT_CHILD_STEPS = new Set([
  'account-profile-complete',
  'comment-fetch-start',
  'comment-fetch-complete',
  'comment-fetch-failed',
  'complete',
  'creator-harvest-complete',
  'danmaku-fetch-start',
  'danmaku-fetch-complete',
  'danmaku-fetch-failed',
  'export-complete',
]);
const IMPORTANT_CHILD_SOURCES = new Set([
  'stderr-progress',
  'tagged-summary',
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function formatDuration(ms = 0) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) return '0s';
  if (duration < 1000) return `${Math.round(duration)}ms`;
  const seconds = duration / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m${String(restSeconds).padStart(2, '0')}s`;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function shortDailyText(text, max = 72) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export function outputTail(output, limit = 80) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-limit);
}

function appendLine(filePath, line) {
  if (!filePath) return;
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${line}\n`, 'utf8');
}

function isRawJsonLikeText(text = '') {
  const value = String(text || '').trim();
  return value.startsWith('{') || /^[\[]\s*[{"]/.test(value);
}

function shouldDisplayDailyEvent(event = {}) {
  const source = String(event.source || '');
  const step = String(event.step || '');
  const status = String(event.status || 'running');
  if (source === 'daily-runner') return true;
  if (['failed', 'error', 'warning'].includes(status)) return true;
  if (isRawJsonLikeText(event.message)) return false;
  if (IMPORTANT_CHILD_SOURCES.has(source)) return true;
  if (IMPORTANT_CHILD_STEPS.has(step)) return true;
  return false;
}

function createDailyEventWriter(eventFile, {
  display = 'detailed',
  displayWriter = console.error,
} = {}) {
  const displayMode = normalizeDisplayMode(display);
  const recentDisplayKeys = new Map();
  return (line) => {
    appendLine(eventFile, line);
    if (displayMode === 'silent') return;
    if (displayMode === 'jsonl') {
      displayWriter(line);
      return;
    }
    const event = taskEventFromLine(line);
    if (!event) {
      if (!isRawJsonLikeText(line)) displayWriter(line);
      return;
    }
    if (!shouldDisplayDailyEvent(event)) return;
    const displayEvent = event.source === 'tagged-summary'
      ? { ...event, detail: {} }
      : event;
    const formatted = displayMode === 'detailed'
      ? (formatDetailedTaskEventBlock(displayEvent) || formatTaskEventLine(displayEvent))
      : formatTaskEventLine(displayEvent);
    const displayKey = `${event.step || ''}:${event.status || ''}:${event.message || ''}`;
    const now = Date.now();
    if (recentDisplayKeys.has(displayKey) && now - recentDisplayKeys.get(displayKey) < 2000) return;
    recentDisplayKeys.set(displayKey, now);
    for (const [key, seenAt] of recentDisplayKeys) {
      if (now - seenAt > 5000) recentDisplayKeys.delete(key);
    }
    if (formatted) displayWriter(formatted);
  };
}

export function extractTaggedJson(output) {
  const tagged = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s+(\{.*\})$/);
    if (!match) continue;
    if (match[1] === 'TASK_EVENT' || match[1] === 'OPENCLI_PROGRESS') continue;
    try {
      tagged[match[1]] = JSON.parse(match[2]);
    } catch {
      tagged[match[1]] = null;
    }
  }
  return tagged;
}

function heartbeatIntervalMs() {
  return parsePositiveInt(process.env.HARVEST_DAILY_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS);
}

function taskIdFromOutputDir(outputDir = '', fallbackPlatform = 'daily') {
  const base = path.basename(outputDir || '').trim();
  if (base) return base;
  return `${fallbackPlatform}-${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 17)}`;
}

function eventDetailForStep(step = {}) {
  return {
    duration_ms: step.duration_ms,
    tagged: step.tagged || {},
  };
}

export function createDailyRunner({
  outputDir,
  report,
  reportPath,
  platform = '',
  platformLabel = '',
  stepLabels = {},
  heartbeatHints = {},
  display = 'detailed',
  displayWriter = console.error,
} = {}) {
  const taskId = report?.task_id || taskIdFromOutputDir(outputDir, platform || 'daily');
  const eventFile = path.join(outputDir, 'task-events.jsonl');
  const stateFile = path.join(outputDir, 'task-state.json');
  const taskReportFile = path.join(outputDir, 'task-report.json');
  const eventWriter = createDailyEventWriter(eventFile, { display, displayWriter });
  const recentEvents = [];
  const startedAt = report?.started_at || nowIso();

  if (report) {
    report.task_id = taskId;
    report.task_events_file = eventFile;
    report.task_state_file = stateFile;
    report.task_report_file = taskReportFile;
    report.daily_report_file = reportPath;
  }

  function stepLabel(name) {
    return stepLabels[name] || name;
  }

  function heartbeatHint(name) {
    if (typeof heartbeatHints[name] === 'function') return heartbeatHints[name](report);
    if (heartbeatHints[name]) return heartbeatHints[name];
    if (name.includes('metric')) return '指标快照和 +1/+N 事件仍在处理';
    if (name.includes('import')) return '入库和校验仍在处理';
    return `${stepLabel(name)}仍在处理`;
  }

  function writeState({
    status = 'running',
    step = 'progress',
    message = '',
    finishedAt = '',
    error = '',
  } = {}) {
    writeJson(stateFile, buildTaskState({
      taskId,
      platformId: platform,
      platformLabel,
      taskName: 'daily-incremental',
      taskLabel: `${platformLabel || platform}增量日常`,
      status,
      step,
      message,
      outputDir,
      platformOutputDir: outputDir,
      eventFile,
      stateFile,
      reportFile: taskReportFile,
      startedAt,
      finishedAt,
      error,
      recentEvents,
    }));
  }

  function emitDailyEvent(event) {
    const emitted = emitTaskEvent({
      task_id: taskId,
      platform,
      platform_label: platformLabel,
      task: 'daily-incremental',
      task_label: `${platformLabel || platform}增量日常`,
      type: 'progress',
      source: 'daily-runner',
      output_dir: outputDir,
      ...event,
    }, eventWriter);
    recentEvents.push(emitted);
    if (recentEvents.length > 20) recentEvents.shift();
    writeState({
      status: event.status || 'running',
      step: event.step || 'progress',
      message: event.message || '',
      error: event.error || '',
    });
    return emitted;
  }

  function info(message, detail = {}) {
    return emitDailyEvent({
      status: 'running',
      step: 'daily-info',
      message,
      detail,
    });
  }

  function printLines(lines) {
    for (const line of lines) info(line);
  }

  function skipStep(name, reason) {
    const step = {
      name,
      status: 'skipped',
      reason,
      started_at: nowIso(),
      duration_ms: 0,
    };
    report.steps.push(step);
    emitDailyEvent({
      status: 'skipped',
      step: 'daily-step-skipped',
      message: `SKIP ${name}: ${stepLabel(name)} - ${reason}`,
      detail: { daily_step: name, reason },
    });
    return step;
  }

  async function runStep(name, args) {
    const startedAtDate = new Date();
    const step = {
      name,
      args: [process.execPath, ...args],
      started_at: startedAtDate.toISOString(),
      status: 'running',
      duration_ms: 0,
      tagged: {},
    };
    report.steps.push(step);
    emitDailyEvent({
      status: 'running',
      step: 'daily-step-start',
      message: `START ${name}: ${stepLabel(name)}`,
      detail: { daily_step: name },
    });

    let output = '';
    let lastProgressMessage = '';
    const heartbeat = setInterval(() => {
      const elapsed = formatDuration(Date.now() - startedAtDate.getTime());
      emitDailyEvent({
        status: 'running',
        step: 'daily-step-heartbeat',
        message: `RUN ${name}: 已运行 ${elapsed}，${lastProgressMessage || heartbeatHint(name)}`,
        detail: {
          daily_step: name,
          elapsed_ms: Date.now() - startedAtDate.getTime(),
        },
      });
    }, heartbeatIntervalMs());

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          OPENCLI_TASK_EVENTS: process.env.OPENCLI_TASK_EVENTS || 'jsonl',
          OPENCLI_PROGRESS_EVENTS: process.env.OPENCLI_PROGRESS_EVENTS || 'jsonl',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const handleLine = (line, stream) => {
        const childEvent = childEventFromLine(line, { stream });
        if (!childEvent) return;
        lastProgressMessage = childEvent.message || lastProgressMessage;
        emitDailyEvent({
          status: childEvent.status || 'running',
          step: childEvent.step || 'progress',
          type: childEvent.type || 'progress',
          source: childEvent.source || 'child',
          message: childEvent.message || '任务进度更新',
          detail: {
            daily_step: name,
            ...(childEvent.detail && typeof childEvent.detail === 'object' ? childEvent.detail : {}),
          },
        });
      };
      const stdoutLines = createLineCollector((line) => handleLine(line, 'stdout'));
      const stderrLines = createLineCollector((line) => handleLine(line, 'stderr'));
      const finishCollectors = () => {
        stdoutLines.flush();
        stderrLines.flush();
        clearInterval(heartbeat);
      };
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        stdoutLines.push(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        stderrLines.push(text);
      });
      child.on('error', (error) => {
        finishCollectors();
        step.status = 'failed';
        step.duration_ms = Date.now() - startedAtDate.getTime();
        step.error = error.message;
        emitDailyEvent({
          status: 'failed',
          step: 'daily-step-complete',
          message: `FAIL ${name}: ${stepLabel(name)} (${formatDuration(step.duration_ms)})`,
          error: error.message,
          detail: { daily_step: name, ...eventDetailForStep(step) },
        });
        reject(error);
      });
      child.on('close', (code) => {
        finishCollectors();
        step.duration_ms = Date.now() - startedAtDate.getTime();
        step.exit_code = code;
        step.tagged = extractTaggedJson(output);
        if (code !== 0) step.output_tail = outputTail(output);
        if (code === 0) {
          step.status = 'success';
          emitDailyEvent({
            status: 'success',
            step: 'daily-step-complete',
            message: `OK ${name}: ${stepLabel(name)} (${formatDuration(step.duration_ms)})`,
            detail: { daily_step: name, ...eventDetailForStep(step) },
          });
          resolve(step);
        } else {
          step.status = 'failed';
          const error = new Error(`${name} failed with exit code ${code}`);
          step.error = error.message;
          emitDailyEvent({
            status: 'failed',
            step: 'daily-step-complete',
            message: `FAIL ${name}: ${stepLabel(name)} (${formatDuration(step.duration_ms)})`,
            error: error.message,
            detail: { daily_step: name, ...eventDetailForStep(step) },
          });
          reject(error);
        }
      });
    });
  }

  function finish(status, summary = {}) {
    report.status = status;
    report.finished_at = nowIso();
    report.duration_ms = elapsedMs(report.started_at, report.finished_at);
    report.summary = {
      total_steps: report.steps.length,
      successful_steps: report.steps.filter((step) => step.status === 'success').length,
      failed_steps: report.steps.filter((step) => step.status === 'failed').length,
      delta_changed_works: Number(report.delta_plan?.totals?.changed_works || 0),
      delta_comment_works: Number(report.delta_plan?.totals?.comment_works || 0),
      delta_danmaku_works: Number(report.delta_plan?.totals?.danmaku_works || 0),
      delta_unchanged_works: Number(report.delta_plan?.totals?.unchanged_works || 0),
      ...summary,
    };
    writeJson(reportPath, report);
    writeJson(taskReportFile, report);
    const summaryMessage = status === 'success'
      ? `完成：成功 ${report.summary.successful_steps} 步，失败 ${report.summary.failed_steps} 步，评论作品 ${report.summary.delta_comment_works} 篇，弹幕作品 ${report.summary.delta_danmaku_works} 篇，用时 ${formatDuration(report.duration_ms)}`
      : `失败：成功 ${report.summary.successful_steps} 步，失败 ${report.summary.failed_steps} 步，用时 ${formatDuration(report.duration_ms)}`;
    const message = `${summaryMessage}，报告：${reportPath}`;
    emitDailyEvent({
      status,
      step: 'complete',
      message,
      report_file: taskReportFile,
      detail: report.summary,
    });
    writeState({
      status,
      step: 'complete',
      message,
      finishedAt: report.finished_at,
      error: report.error || '',
    });
    return report;
  }

  writeState({
    status: 'running',
    step: 'start',
    message: `${platformLabel || platform}增量日常开始运行`,
  });

  return {
    eventFile,
    stateFile,
    taskReportFile,
    info,
    printLines,
    runStep,
    skipStep,
    finish,
  };
}
