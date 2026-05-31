import fs from 'node:fs';
import path from 'node:path';

import { getPlatformTaskDefinition } from '../scripts/lib/platform-registry.js';

function hasArg(args, name) {
  return Array.isArray(args) && args.includes(name);
}

function firstExistingPath(baseDir, filenames) {
  const candidates = filenames.map((filename) => path.join(baseDir, filename));
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || '';
}

function planScopedInputPath(platformId, task, platformOutputDir) {
  if (!platformId || !platformOutputDir) return '';
  if (task.capability === 'content-import') {
    return firstExistingPath(platformOutputDir, platformId === 'douyin'
      ? ['harvest.json', 'creator-harvest.json']
      : ['harvest.json']);
  }
  if (task.capability === 'danmaku-import') {
    return firstExistingPath(platformOutputDir, platformId === 'douyin'
      ? ['creator-harvest.json', 'danmaku-flat.json']
      : ['danmaku-flat.json']);
  }
  if (task.capability === 'messages-import') {
    return firstExistingPath(platformOutputDir, ['private-messages-flat.json']);
  }
  if (task.capability === 'account-import') {
    return firstExistingPath(platformOutputDir, ['account-profile.json']);
  }
  if (task.capability === 'metric-snapshot-account') {
    return firstExistingPath(platformOutputDir, ['account-profile.json']);
  }
  if (task.capability === 'metric-snapshot-work') {
    return firstExistingPath(platformOutputDir, platformId === 'douyin'
      ? ['creator-harvest.json']
      : ['works.json']);
  }
  return '';
}

export function planScopedTaskArgs(platformId, taskName, args = [], platformOutputDir = '') {
  const argList = Array.isArray(args) ? args.map(String) : [];
  if (!platformId || !taskName || hasArg(argList, '--input') || hasArg(argList, '--date')) return argList;
  const task = getPlatformTaskDefinition(platformId, taskName);
  const inputPath = planScopedInputPath(platformId, task, platformOutputDir);
  return inputPath ? [...argList, '--input', inputPath] : argList;
}

function importModeRank(label = '') {
  if (label === '正式入库') return 3;
  if (label === '入库预演') return 2;
  if (label === '本地产物') return 1;
  return 0;
}

function taskImportModeLabel({
  platformId = '',
  taskName = '',
  args = [],
} = {}) {
  const argList = Array.isArray(args) ? args.map(String) : [];
  if (argList.includes('--sink-apply')) return '正式入库';
  if (argList.includes('--import-scrm-apply') || argList.includes('--import-scrm-message-apply') || argList.includes('--apply')) return '正式入库';
  if (argList.includes('--import-scrm') || argList.includes('--import-scrm-message')) return '入库预演';
  if (['creator-content', 'creator-account', 'creator-danmaku', 'creator-messages'].includes(taskName)) return '本地产物';
  if (['content-import', 'account-import', 'danmaku-import', 'messages-import'].includes(taskName)) return '正式入库';
  if (['metric-snapshot-account', 'metric-snapshot-work', 'metric-delta-account', 'metric-delta-work'].includes(taskName)) return '正式入库';
  if (['creator-file-write', 'creator-comment-write', 'creator-danmaku-write'].includes(taskName)) return '正式入库';
  if (taskName === 'private-messages' && ['douyin', 'weixin-channels'].includes(platformId)) return '正式入库';
  if (taskName === 'creator-harvest') return '本地产物';
  if (taskName === 'harvest' && platformId === 'weixin-channels') return '正式入库';
  if (taskName === 'harvest') return '本地产物';
  return '';
}

function planImportModeLabel(planTasks = []) {
  let winner = '';
  for (const task of planTasks) {
    const mode = taskImportModeLabel({
      platformId: String(task.platform || ''),
      taskName: String(task.task || task.id || ''),
      args: Array.isArray(task.args) ? task.args : [],
    });
    if (importModeRank(mode) > importModeRank(winner)) winner = mode;
  }
  return winner || '按自动化';
}

export function planSummaryText(plan, results = []) {
  const failedCount = results.filter((result) => result.status === 'failed').length;
  const skippedCount = results.filter((result) => result.status === 'skipped').length;
  const successCount = results.length - failedCount - skippedCount;
  const mode = planImportModeLabel(plan.tasks);
  if (failedCount > 0 || skippedCount > 0) {
    const skippedText = skippedCount > 0 ? `，跳过 ${skippedCount} 项` : '';
    return `任务计划 ${plan.id} 部分成功：${mode}，成功 ${successCount} 项，失败 ${failedCount} 项${skippedText}。`;
  }
  return `任务计划 ${plan.id} 完成：${mode}，成功 ${successCount} 项，失败 0 项。`;
}

function splitShellWords(command = '') {
  const words = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '\'' || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

function taskArgsFromReproCommand(command = '') {
  const words = splitShellWords(command);
  const markerIndex = words.indexOf('--');
  return markerIndex >= 0 ? words.slice(markerIndex + 1) : [];
}

function failedTaskArgs(result = {}) {
  const args = Array.isArray(result.rerun_args)
    ? result.rerun_args.map(String)
    : Array.isArray(result.task_args)
    ? result.task_args.map(String)
    : taskArgsFromReproCommand(String(result.repro_command || ''));
  if (args.includes('<redacted>')) {
    throw new Error(`Cannot rerun failed task "${result.task || result.task_id || 'unknown'}" because its args contain redacted secrets.`);
  }
  return args;
}

function failedTaskItem(result = {}) {
  const taskName = String(result.task || '');
  if (!taskName) return null;
  const item = { task: taskName };
  const platformId = String(result.platform || '');
  if (platformId) item.platform = platformId;
  const args = failedTaskArgs(result);
  if (args.length) item.args = args;
  return item;
}

export function loadFailedTaskPlan(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const failedResults = Array.isArray(report.results)
    ? report.results.filter((result) => ['failed', 'skipped'].includes(result?.status))
    : ['failed', 'skipped'].includes(report?.status)
      ? [report]
      : [];
  const tasks = failedResults
    .map(failedTaskItem)
    .filter(Boolean);
  if (!tasks.length) throw new Error(`${reportPath} does not contain failed or skipped tasks to rerun.`);
  return {
    id: `${report.plan_id || report.task_id || path.basename(reportPath, path.extname(reportPath))}-failed-rerun`,
    concurrency: 'sequential',
    tasks,
  };
}

export function loadTaskPlan(planPath) {
  const data = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${planPath} must contain a JSON object.`);
  }
  const tasks = Array.isArray(data.platforms)
    ? data.platforms
    : Array.isArray(data.tasks)
      ? data.tasks
      : [];
  if (!tasks.length) throw new Error(`${planPath} must contain platforms[] or tasks[].`);
  return {
    id: data.id || path.basename(planPath, path.extname(planPath)),
    concurrency: data.concurrency || 'sequential',
    tasks,
  };
}
