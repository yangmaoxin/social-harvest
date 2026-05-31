import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  getGlobalTaskDefinition,
  getPlatformDefinition,
  getPlatformTaskDefinition,
  hasGlobalTaskDefinition,
} from '../scripts/lib/platform-registry.js';
import { ROOT_DIR, sinkListForPlatform } from '../scripts/lib/runtime-config.js';
import {
  buildTaskReport,
  buildTaskState,
  collectArtifacts,
  compactHarnessWarnings,
  countersFromPlatformReport,
  elapsedMs,
  evidenceFilesForReport,
  nowIso,
  reproCommandForReport,
  verificationCommandsForReport,
} from './reports.js';
import {
  createChildEventBridge,
  createEventWriter,
  createLineCollector,
  createStructuredOutputWriter,
  emitTaskEvent,
} from './events.js';
import { summarizeTaskOutput } from './platform-output.js';
import {
  loadFailedTaskPlan,
  loadTaskPlan,
  planScopedTaskArgs,
  planSummaryText,
} from './plans.js';
import { filterArgsForCompositeStep } from './arg-forwarding.js';
import { parseSinkOptions, resolveSinkOptions, shouldRunScrmSink } from './sink-options.js';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function hasArg(args, name) {
  return Array.isArray(args) && args.includes(name);
}

function appendOutputDirArg(args, outputDir) {
  if (!outputDir || hasArg(args, '--output-dir')) return args;
  return [...args, '--output-dir', outputDir];
}

function taskOutputArgs(task, args, outputDir) {
  if (task.injectOutputDir === false) return args;
  return appendOutputDirArg(args, outputDir);
}

function taskIdFor(platformId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 17);
  return `${platformId}-${timestamp}`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT_DIR,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

function commandForTask(task) {
  if (task.runner !== 'node') throw new Error(`Unsupported task runner: ${task.runner}`);
  return { command: process.execPath, args: [task.script] };
}

function isScrmWriteTask(task) {
  const capability = String(task?.capability || '');
  return capability.endsWith('-import')
    || capability.startsWith('metric-snapshot')
    || capability.startsWith('metric-delta');
}

function sinkRunnerArgs({
  platformId,
  platformOutputDir,
  sinkOptions,
  taskId,
}) {
  const args = [
    '--platform',
    platformId,
    '--output-dir',
    platformOutputDir,
    '--source-run-id',
    taskId,
    ...sinkOptions.sinkArgs,
  ];
  for (const sink of sinkOptions.sinks || []) args.push('--sink', sink);
  if (sinkOptions.sinkApply) args.push('--sink-apply');
  return args;
}

const PLAN_TASK_DEPENDENCIES = {
  'account-import': ['creator-account'],
  'content-import': ['creator-content'],
  'danmaku-import': ['creator-danmaku'],
  'messages-import': ['creator-messages'],
  'metric-snapshot-account': ['creator-account'],
  'metric-snapshot-work': ['creator-content'],
  'metric-delta-account': ['metric-snapshot-account'],
  'metric-delta-work': ['metric-snapshot-work'],
};

function dependencyStatus(status = '') {
  return status === 'failed' || status === 'skipped';
}

function argValues(args = [], name = '') {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(String(args[index + 1]));
      index += 1;
    }
  }
  return values;
}

function diagnosticBlocksTask(result = {}, platformId = '') {
  if (result.task !== 'diagnostic' || !dependencyStatus(result.status)) return false;
  const platforms = argValues(result.task_args || [], '--platform');
  return platforms.length === 0 || platforms.includes(platformId);
}

function findLastResult(results = [], predicate) {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (predicate(results[index])) return results[index];
  }
  return null;
}

function blockingPlanDependency(results = [], platformId = '', taskName = '') {
  const diagnostic = findLastResult(results, (result) => diagnosticBlocksTask(result, platformId));
  if (diagnostic) {
    return {
      platform: diagnostic.platform || '',
      task: diagnostic.task,
      status: diagnostic.status,
      label: diagnostic.task_label || diagnostic.task,
    };
  }
  const dependencies = PLAN_TASK_DEPENDENCIES[taskName] || [];
  for (const dependency of dependencies) {
    const result = findLastResult(results, (item) => (
      item.platform === platformId
      && item.task === dependency
      && dependencyStatus(item.status)
    ));
    if (result) {
      return {
        platform: platformId,
        task: dependency,
        status: result.status,
        label: result.task_label || dependency,
      };
    }
  }
  return null;
}

function buildSkippedPlanTaskReport({
  taskId,
  platformId = '',
  platformLabel = '',
  taskName = '',
  taskLabel = '',
  outputDir = '',
  platformOutputDir = '',
  eventFile = '',
  stateFile = '',
  reportFile = '',
  eventWriter,
  planArgs = [],
  dependency = null,
}) {
  const timestamp = nowIso();
  const dependencyLabel = dependency?.label || dependency?.task || '上游步骤';
  const summaryText = `${platformLabel ? `${platformLabel} ` : ''}${taskLabel}已跳过：依赖步骤 ${dependencyLabel} ${dependency?.status || '未完成'}。`;
  const event = emitTaskEvent({
    task_id: taskId,
    platform: platformId,
    platform_label: platformLabel,
    task: taskName,
    task_label: taskLabel,
    status: 'skipped',
    step: 'dependency-skipped',
    type: 'status',
    source: 'runner',
    message: summaryText,
    output_dir: platformOutputDir,
    detail: {
      dependency,
    },
  }, eventWriter);
  const artifacts = collectArtifacts({ outputDir, platformOutputDir, eventFile, stateFile, reportFile });
  return {
    task_id: taskId,
    platform: platformId,
    platform_label: platformLabel,
    task: taskName,
    task_label: taskLabel,
    status: 'skipped',
    started_at: event.timestamp || timestamp,
    finished_at: event.timestamp || timestamp,
    duration_ms: 0,
    output_dir: outputDir,
    platform_output_dir: platformOutputDir,
    task_events_file: eventFile,
    task_state_file: stateFile,
    task_report_file: reportFile,
    platform_report: null,
    counters: countersFromPlatformReport(null),
    summary_text: summaryText,
    artifacts,
    recoverable: true,
    retriable: true,
    requires_human_action: false,
    next_actions: ['修复或补跑上游失败步骤后，再补跑本步骤。'],
    repro_command: reproCommandForReport({
      platformId,
      taskName,
      outputDir,
      taskArgs: planArgs,
    }),
    verification_commands: verificationCommandsForReport({ taskName, status: 'skipped' }),
    evidence_files: evidenceFilesForReport({ outputDir, artifacts }),
    suggested_skill: 'social-harvest-operator',
    harness_warnings: [],
    error: '',
    skip_reason: 'dependency_failed',
    skipped_by: dependency,
    task_args: planArgs.map(String),
    rerun_args: planArgs.map(String),
    stdout_bytes: 0,
    stderr_bytes: 0,
  };
}

export function applyImplicitScrmApplyForSink(task, args = [], sinkOptions = {}) {
  const taskArgs = Array.isArray(args) ? args.map(String) : [];
  return taskArgs;
}

async function runTaskCommand(task, args, ioOptions = {}) {
  const invocation = commandForTask(task);
  return runCommand(invocation.command, [...invocation.args, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      OPENCLI_TASK_EVENTS: 'jsonl',
      OPENCLI_PROGRESS_EVENTS: 'jsonl',
      ...(ioOptions.env || {}),
    },
    onStdout: ioOptions.onStdout,
    onStderr: ioOptions.onStderr,
  });
}

async function runCompositeTaskSteps({
  platform,
  task,
  platformArgs,
  platformOutputDir,
  eventWriter,
  taskId,
  stdoutLines,
  stderrLines,
  stdoutDisplayLines,
  stderrDisplayLines,
  onStdout,
  onStderr,
  env,
}) {
  let stdout = '';
  let stderr = '';
  const steps = Array.isArray(task.steps) ? task.steps : [];
  if (!steps.length) throw new Error(`Composite task "${task.id}" must define steps.`);

  for (const [index, step] of steps.entries()) {
    const childTask = getPlatformTaskDefinition(platform.id, step.task);
    if (env?.HARVEST_OPS_SKIP_SCRM_WRITE === '1' && isScrmWriteTask(childTask)) {
      emitTaskEvent({
        task_id: taskId,
        platform: platform.id,
        platform_label: platform.label,
        task: task.id,
        task_label: task.label || task.id,
        status: 'success',
        step: 'composite-step-skipped',
        message: `${platform.label} ${childTask.label || childTask.id}已跳过（未声明 sink: scrm）`,
        output_dir: platformOutputDir,
        detail: {
          child_task: childTask.id,
          child_task_label: childTask.label || childTask.id,
          step_index: index + 1,
          step_count: steps.length,
          reason: 'scrm sink not selected',
        },
      }, eventWriter);
      continue;
    }
    const filteredStepArgs = [
      ...(childTask.defaultArgs || []),
      ...(Array.isArray(step.defaultArgs) ? step.defaultArgs : []),
      ...filterArgsForCompositeStep(platform.id, step, platformArgs),
    ];
    const scopedStepArgs = childTask.injectOutputDir === false
      ? planScopedTaskArgs(platform.id, childTask.id, filteredStepArgs, platformOutputDir)
      : filteredStepArgs;
    const stepArgs = taskOutputArgs(
      childTask,
      scopedStepArgs,
      platformOutputDir,
    );
    emitTaskEvent({
      task_id: taskId,
      platform: platform.id,
      platform_label: platform.label,
      task: task.id,
      task_label: task.label || task.id,
      status: 'running',
      step: 'composite-step-start',
      message: `${platform.label} ${childTask.label || childTask.id}开始运行（${index + 1}/${steps.length}）`,
      output_dir: platformOutputDir,
      detail: {
        child_task: childTask.id,
        child_task_label: childTask.label || childTask.id,
        step_index: index + 1,
        step_count: steps.length,
      },
    }, eventWriter);
    const result = await runTaskCommand(childTask, stepArgs, {
      env,
      onStdout: (text) => {
        stdout += text;
        stdoutLines.push(text);
        if (onStdout) onStdout(text);
        else stdoutDisplayLines.push(text);
      },
      onStderr: (text) => {
        stderr += text;
        stderrLines.push(text);
        if (onStderr) onStderr(text);
        else stderrDisplayLines.push(text);
      },
    });
    stdout += result.stdout && !stdout.endsWith(result.stdout) ? result.stdout : '';
    stderr += result.stderr && !stderr.endsWith(result.stderr) ? result.stderr : '';
    emitTaskEvent({
      task_id: taskId,
      platform: platform.id,
      platform_label: platform.label,
      task: task.id,
      task_label: task.label || task.id,
      status: 'success',
      step: 'composite-step-complete',
      message: `${platform.label} ${childTask.label || childTask.id}完成（${index + 1}/${steps.length}）`,
      output_dir: platformOutputDir,
      detail: {
        child_task: childTask.id,
        child_task_label: childTask.label || childTask.id,
        step_index: index + 1,
        step_count: steps.length,
      },
    }, eventWriter);
  }

  return { stdout, stderr, code: 0 };
}

export async function runPlatformTask(platformId, platformArgs = [], options = {}) {
  const platform = platformId ? getPlatformDefinition(platformId) : null;
  const task = platform
    ? getPlatformTaskDefinition(platform.id, options.task || '')
    : getGlobalTaskDefinition(options.task || '');
  const taskScopeId = platform ? `${platform.id}-${task.id}` : task.id;
  const taskId = options.taskId || taskIdFor(taskScopeId);
  const outputDir = options.outputDir || path.join(ROOT_DIR, 'samples', 'tasks', taskId);
  const platformOutputDir = options.platformOutputDir || path.join(outputDir, platform?.id || task.id);
  const eventFile = options.eventFile || path.join(outputDir, 'task-events.jsonl');
  const stateFile = options.stateFile || path.join(outputDir, 'task-state.json');
  const reportFile = options.reportFile || path.join(outputDir, 'task-report.json');
  const display = options.display || 'compact';
  const eventWriter = options.eventWriter || createEventWriter(eventFile, console.error, { display });
  const sinkOptions = resolveSinkOptions(parseSinkOptions(platformArgs), {
    defaultSinks: platform ? sinkListForPlatform(platform.id) : [],
  });
  const taskPlatformArgs = applyImplicitScrmApplyForSink(task, sinkOptions.taskArgs, sinkOptions);
  const effectiveArgs = task.runner === 'composite'
    ? taskPlatformArgs.map(String)
    : taskOutputArgs(task, [...(task.defaultArgs || []), ...taskPlatformArgs], platformOutputDir);
  const startedAt = nowIso();
  const platformLabel = platform?.label || '';
  const taskLabel = task.label || task.id;
  const recentEvents = [];
  ensureDir(platformOutputDir);
  const startEvent = emitTaskEvent({
    task_id: taskId,
    platform: platform?.id || '',
    platform_label: platformLabel,
    task: task.id,
    task_label: taskLabel,
    status: 'running',
    step: 'start',
    message: `${platformLabel ? `${platformLabel} ` : ''}${taskLabel}开始运行`,
    output_dir: platformOutputDir,
  }, eventWriter);
  recentEvents.push(startEvent);
  writeJson(stateFile, buildTaskState({
    taskId,
    platformId: platform?.id || '',
    platformLabel,
    taskName: task.id,
    taskLabel,
    status: 'running',
    step: 'start',
    message: startEvent.message,
    outputDir,
    platformOutputDir,
    eventFile,
    stateFile,
    reportFile,
    startedAt,
    recentEvents,
  }));
  const bridgeChildEvent = createChildEventBridge({
    taskId,
    platform,
    task,
    outputDir,
    platformOutputDir,
    eventFile,
    stateFile,
    reportFile,
    startedAt,
    eventWriter,
    recentEvents,
  });
  const stdoutLines = createLineCollector((line) => bridgeChildEvent(line, 'stdout'));
  const stderrLines = createLineCollector((line) => bridgeChildEvent(line, 'stderr'));
  const stdoutDisplayLines = createStructuredOutputWriter(process.stdout, undefined, { displayPlain: false });
  const stderrDisplayLines = createStructuredOutputWriter(process.stderr, undefined, {
    displayPlain: display === 'compact',
  });
  try {
    const result = task.runner === 'composite'
      ? await runCompositeTaskSteps({
        platform,
        task,
        platformArgs: effectiveArgs,
        platformOutputDir,
        eventWriter,
        taskId,
        stdoutLines,
        stderrLines,
        stdoutDisplayLines,
        stderrDisplayLines,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
        env: {
          ...(options.env || {}),
          ...(!shouldRunScrmSink(sinkOptions) ? { HARVEST_OPS_SKIP_SCRM_WRITE: '1' } : {}),
        },
      })
      : await runTaskCommand(task, effectiveArgs, {
        env: {
          ...(options.env || {}),
          ...(!shouldRunScrmSink(sinkOptions) ? { HARVEST_OPS_SKIP_SCRM_WRITE: '1' } : {}),
        },
        onStdout: (text) => {
          stdoutLines.push(text);
          if (options.onStdout) options.onStdout(text);
          else stdoutDisplayLines.push(text);
        },
        onStderr: (text) => {
          stderrLines.push(text);
          if (options.onStderr) options.onStderr(text);
          else stderrDisplayLines.push(text);
        },
      });
    if (platform && !options.disableSinks && !isScrmWriteTask(task) && sinkOptions.sinks.length) {
      const sinkTask = {
        id: 'sink-runner',
        label: '统一 sink 写入',
        runner: 'node',
        script: path.join(ROOT_DIR, 'scripts', 'run-sinks.js'),
      };
      emitTaskEvent({
        task_id: taskId,
        platform: platform.id,
        platform_label: platformLabel,
        task: task.id,
        task_label: taskLabel,
        status: 'running',
        step: 'sink-runner-start',
        message: `${platformLabel} sink ${sinkOptions.sinkApply ? '写入' : '预演'}开始：${sinkOptions.sinks.join(', ')}`,
        output_dir: platformOutputDir,
      }, eventWriter);
      const sinkResult = await runTaskCommand(sinkTask, sinkRunnerArgs({
        platformId: platform.id,
        platformOutputDir,
        sinkOptions,
        taskId,
      }), {
        env: options.env,
        onStdout: (text) => {
          stdoutLines.push(text);
          if (options.onStdout) options.onStdout(text);
          else stdoutDisplayLines.push(text);
        },
        onStderr: (text) => {
          stderrLines.push(text);
          if (options.onStderr) options.onStderr(text);
          else stderrDisplayLines.push(text);
        },
      });
      result.stdout += sinkResult.stdout;
      result.stderr += sinkResult.stderr;
      emitTaskEvent({
        task_id: taskId,
        platform: platform.id,
        platform_label: platformLabel,
        task: task.id,
        task_label: taskLabel,
        status: 'success',
        step: 'sink-runner-complete',
        message: `${platformLabel} sink ${sinkOptions.sinkApply ? '写入' : '预演'}完成：${sinkOptions.sinks.join(', ')}`,
        output_dir: platformOutputDir,
      }, eventWriter);
    }
    stdoutLines.flush();
    stderrLines.flush();
    if (!options.onStdout) stdoutDisplayLines.flush();
    if (!options.onStderr) stderrDisplayLines.flush();
    const platformReport = summarizeTaskOutput({
      platformId: platform?.id || '',
      taskId: task.id,
      outputDir: platformOutputDir,
      stdout: result.stdout,
      task,
    });
    const finishedAt = nowIso();
    const report = buildTaskReport({
      taskId,
      platformId: platform?.id || '',
      platformLabel,
      taskName: task.id,
      taskLabel,
      status: 'success',
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      platformReport,
      startedAt,
      finishedAt,
      stdout: result.stdout,
      stderr: result.stderr,
      taskArgs: effectiveArgs,
    });
    writeJson(reportFile, report);
    const completeEvent = emitTaskEvent({
      task_id: taskId,
      platform: platform?.id || '',
      platform_label: platformLabel,
      task: task.id,
      task_label: taskLabel,
      status: 'success',
      step: 'complete',
      message: report.summary_text,
      detail: countersFromPlatformReport(platformReport),
      report_file: reportFile,
    }, eventWriter);
    recentEvents.push(completeEvent);
    writeJson(stateFile, buildTaskState({
      taskId,
      platformId: platform?.id || '',
      platformLabel,
      taskName: task.id,
      taskLabel,
      status: 'success',
      step: 'complete',
      message: report.summary_text,
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      startedAt,
      finishedAt,
      platformReport,
      recentEvents,
    }));
    return report;
  } catch (error) {
    stdoutLines.flush();
    stderrLines.flush();
    if (!options.onStdout) stdoutDisplayLines.flush();
    if (!options.onStderr) stderrDisplayLines.flush();
    const message = error instanceof Error ? error.message : String(error);
    const platformReport = summarizeTaskOutput({
      platformId: platform?.id || '',
      taskId: task.id,
      outputDir: platformOutputDir,
      task,
    });
    const finishedAt = nowIso();
    const report = buildTaskReport({
      taskId,
      platformId: platform?.id || '',
      platformLabel,
      taskName: task.id,
      taskLabel,
      status: 'failed',
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      platformReport,
      startedAt,
      finishedAt,
      error: message,
      taskArgs: effectiveArgs,
    });
    writeJson(reportFile, report);
    const failedEvent = emitTaskEvent({
      task_id: taskId,
      platform: platform?.id || '',
      platform_label: platformLabel,
      task: task.id,
      task_label: taskLabel,
      status: 'failed',
      step: 'complete',
      report_file: reportFile,
      error: message,
      message: report.summary_text,
      detail: countersFromPlatformReport(platformReport),
    }, eventWriter);
    recentEvents.push(failedEvent);
    writeJson(stateFile, buildTaskState({
      taskId,
      platformId: platform?.id || '',
      platformLabel,
      taskName: task.id,
      taskLabel,
      status: 'failed',
      step: 'complete',
      message: report.summary_text,
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      startedAt,
      finishedAt,
      platformReport,
      error: message,
      recentEvents,
    }));
    if (error && typeof error === 'object') {
      error.taskReport = report;
    }
    throw error;
  }
}

async function runSinkRunnerReport({
  taskId,
  platform,
  outputDir,
  platformOutputDir,
  eventFile,
  stateFile,
  reportFile,
  sinkOptions,
  display = 'compact',
  env = {},
}) {
  const startedAt = nowIso();
  const task = {
    id: 'sink-runner',
    label: '统一 sink 写入',
    runner: 'node',
    script: path.join(ROOT_DIR, 'scripts', 'run-sinks.js'),
  };
  const eventWriter = createEventWriter(eventFile, console.error, { display });
  emitTaskEvent({
    task_id: taskId,
    platform: platform.id,
    platform_label: platform.label,
    task: task.id,
    task_label: task.label,
    status: 'running',
    step: 'sink-runner-start',
    message: `${platform.label} sink ${sinkOptions.sinkApply ? '写入' : '预演'}开始：${sinkOptions.sinks.join(', ')}`,
    output_dir: platformOutputDir,
  }, eventWriter);
  try {
    const result = await runTaskCommand(task, sinkRunnerArgs({
      platformId: platform.id,
      platformOutputDir,
      sinkOptions,
      taskId,
    }), { env });
    const finishedAt = nowIso();
    const report = buildTaskReport({
      taskId,
      platformId: platform.id,
      platformLabel: platform.label,
      taskName: task.id,
      taskLabel: task.label,
      status: 'success',
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      platformReport: summarizeTaskOutput({
        platformId: platform.id,
        taskId: task.id,
        outputDir: platformOutputDir,
        stdout: result.stdout,
        task,
      }),
      startedAt,
      finishedAt,
      stdout: result.stdout,
      stderr: result.stderr,
      taskArgs: sinkRunnerArgs({
        platformId: platform.id,
        platformOutputDir,
        sinkOptions,
        taskId,
      }),
    });
    emitTaskEvent({
      task_id: taskId,
      platform: platform.id,
      platform_label: platform.label,
      task: task.id,
      task_label: task.label,
      status: 'success',
      step: 'sink-runner-complete',
      message: `${platform.label} sink ${sinkOptions.sinkApply ? '写入' : '预演'}完成：${sinkOptions.sinks.join(', ')}`,
      report_file: reportFile,
    }, eventWriter);
    return report;
  } catch (error) {
    const finishedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const report = buildTaskReport({
      taskId,
      platformId: platform.id,
      platformLabel: platform.label,
      taskName: task.id,
      taskLabel: task.label,
      status: 'failed',
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      startedAt,
      finishedAt,
      error: message,
      taskArgs: sinkRunnerArgs({
        platformId: platform.id,
        platformOutputDir,
        sinkOptions,
        taskId,
      }),
    });
    emitTaskEvent({
      task_id: taskId,
      platform: platform.id,
      platform_label: platform.label,
      task: task.id,
      task_label: task.label,
      status: 'failed',
      step: 'sink-runner-complete',
      error: message,
      message: report.summary_text,
      report_file: reportFile,
    }, eventWriter);
    return report;
  }
}

export async function runTaskPlan(planPath, options = {}) {
  const plan = options.failedFrom ? loadFailedTaskPlan(options.failedFrom) : loadTaskPlan(planPath);
  if (plan.concurrency !== 'sequential') {
    throw new Error('Only sequential task plans are supported for now.');
  }
  const taskId = options.taskId || `${plan.id}-${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 17)}`;
  const outputDir = options.outputDir || path.join(ROOT_DIR, 'samples', 'tasks', taskId);
  const eventFile = path.join(outputDir, 'task-events.jsonl');
  const stateFile = path.join(outputDir, 'task-state.json');
  const reportFile = path.join(outputDir, 'task-report.json');
  const startedAt = nowIso();
  const results = [];
  const platformSinkOptions = new Map();
  writeJson(stateFile, buildTaskState({
    taskId,
    taskName: 'plan',
    taskLabel: '任务计划',
    status: 'running',
    step: 'start',
    message: `任务计划 ${plan.id} 开始运行`,
    outputDir,
    platformOutputDir: outputDir,
    eventFile,
    stateFile,
    reportFile,
    startedAt,
  }));
  for (const task of plan.tasks) {
    if (task.enabled === false) continue;
    const taskName = task.task || '';
    const platformId = task.platform || (hasGlobalTaskDefinition(taskName || task.id) ? '' : task.id);
    if (options.skipDoctor && !platformId && (taskName === 'diagnostic' || task.id === 'diagnostic')) {
      const event = emitTaskEvent({
        task_id: `${plan.id}-global-diagnostic-skipped-${results.length + 1}`,
        platform: '',
        platform_label: '',
        task: 'diagnostic',
        task_label: '运行前检查',
        status: 'success',
        step: 'skip-diagnostic',
        type: 'status',
        source: 'session-gate',
        message: '本次 CLI 会话已通过完整诊断，跳过计划内重复诊断',
        output_dir: outputDir,
      }, createEventWriter(eventFile, console.error, { display: options.display || 'compact' }));
      const artifacts = collectArtifacts({ outputDir, platformOutputDir: outputDir, eventFile, stateFile, reportFile });
      results.push({
        task_id: event.task_id,
        platform: '',
        platform_label: '',
        task: 'diagnostic',
        task_label: '运行前检查',
        status: 'success',
        started_at: event.timestamp,
        finished_at: event.timestamp,
        duration_ms: 0,
        output_dir: outputDir,
        platform_output_dir: outputDir,
        task_events_file: eventFile,
        task_state_file: stateFile,
        task_report_file: reportFile,
        platform_report: null,
        counters: countersFromPlatformReport(null),
        summary_text: event.message,
        artifacts,
        recoverable: false,
        retriable: false,
        requires_human_action: false,
        next_actions: [],
        repro_command: reproCommandForReport({
          taskName: 'diagnostic',
          outputDir,
        }),
        verification_commands: verificationCommandsForReport({ taskName: 'diagnostic', status: 'success' }),
        evidence_files: evidenceFilesForReport({
          outputDir,
          artifacts,
        }),
        suggested_skill: 'social-harvest-operator',
        harness_warnings: [],
        error: '',
        stdout_bytes: 0,
        stderr_bytes: 0,
      });
      continue;
    }
    if (!platformId && !taskName && !task.id) throw new Error('Task item must provide platform, task, or id.');
    const taskToRun = taskName || (!platformId ? task.id : '');
    const platform = platformId ? getPlatformDefinition(platformId) : null;
    const taskDefinition = platform
      ? getPlatformTaskDefinition(platformId, taskToRun)
      : getGlobalTaskDefinition(taskToRun);
    const platformOutputDir = path.join(outputDir, platformId || taskName || task.id);
    const planArgs = Array.isArray(task.args) ? task.args.map(String) : [];
    const blockingDependency = blockingPlanDependency(results, platformId, taskToRun);
    if (blockingDependency) {
      results.push(buildSkippedPlanTaskReport({
        taskId: `${plan.id}-${platformId || 'global'}-${taskToRun || 'default'}-${results.length + 1}`,
        platformId,
        platformLabel: platform?.label || '',
        taskName: taskToRun,
        taskLabel: taskDefinition.label || taskToRun,
        outputDir,
        platformOutputDir,
        eventFile,
        stateFile,
        reportFile,
        eventWriter: createEventWriter(eventFile, console.error, { display: options.display || 'compact' }),
        planArgs,
        dependency: blockingDependency,
      }));
      continue;
    }
    const args = planScopedTaskArgs(
      platformId,
      taskToRun,
      planArgs,
      platformOutputDir,
    );
    if (platform && !isScrmWriteTask(taskDefinition)) {
      const parsedPlanSinkOptions = parseSinkOptions(planArgs);
      if (parsedPlanSinkOptions.explicitSinks || parsedPlanSinkOptions.sinkApply) {
        platformSinkOptions.set(platformId, resolveSinkOptions(parsedPlanSinkOptions, {
          defaultSinks: sinkListForPlatform(platformId),
        }));
      }
    }
    try {
      results.push(await runPlatformTask(platformId, args, {
        ...options,
        task: taskToRun,
        disableSinks: true,
        outputDir,
        eventFile,
        stateFile,
        reportFile,
        platformOutputDir,
        taskId: `${plan.id}-${platformId || 'global'}-${taskToRun || 'default'}-${results.length + 1}`,
      }));
    } catch (error) {
      if (error?.taskReport) {
        results.push(error.taskReport);
        continue;
      }
      throw error;
    }
  }
  for (const [platformId, sinkOptions] of platformSinkOptions.entries()) {
    if (!sinkOptions.sinks.length) continue;
    const hasBlockingResult = results.some((result) => (
      result.platform === platformId
      && ['failed', 'skipped'].includes(result.status)
    ));
    if (hasBlockingResult) continue;
    const platform = getPlatformDefinition(platformId);
    results.push(await runSinkRunnerReport({
      taskId: `${plan.id}-${platformId}-sink-runner-${results.length + 1}`,
      platform,
      outputDir,
      platformOutputDir: path.join(outputDir, platformId),
      eventFile,
      stateFile,
      reportFile,
      sinkOptions,
      display: options.display || 'compact',
      env: options.env || {},
    }));
  }
  const failed = results.filter((result) => result.status === 'failed');
  const skipped = results.filter((result) => result.status === 'skipped');
  const finishedAt = nowIso();
  const artifacts = collectArtifacts({
    outputDir,
    platformOutputDir: outputDir,
    eventFile,
    stateFile,
    reportFile,
  });
  const harnessWarnings = compactHarnessWarnings(results.flatMap((result) => (
    Array.isArray(result.harness_warnings) ? result.harness_warnings : []
  )));
  const report = {
    task_id: taskId,
    plan_id: plan.id,
    status: failed.length || skipped.length ? 'partial' : 'success',
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: elapsedMs(startedAt, finishedAt),
    output_dir: outputDir,
    task_events_file: eventFile,
    task_state_file: stateFile,
    task_report_file: reportFile,
    summary_text: planSummaryText(plan, results),
    artifacts,
    recoverable: failed.length > 0 || skipped.length > 0,
    retriable: failed.some((result) => result.retriable) || skipped.length > 0,
    requires_human_action: results.some((result) => result.requires_human_action),
    next_actions: failed.length || skipped.length
      ? ['查看失败和跳过步骤；已完成步骤的结果已保留，可修复失败项后用 daily:failed 补跑失败及其依赖步骤。']
      : [],
    repro_command: reproCommandForReport({
      outputDir,
      planPath: options.failedFrom ? '' : planPath,
      failedFrom: options.failedFrom || '',
    }),
    verification_commands: verificationCommandsForReport({ taskName: 'plan', status: failed.length || skipped.length ? 'partial' : 'success' }),
    evidence_files: evidenceFilesForReport({ outputDir, artifacts }),
    suggested_skill: results.some((result) => result.suggested_skill === 'opencli-autofix')
      ? 'opencli-autofix'
      : 'social-harvest-operator',
    harness_warnings: harnessWarnings,
    error: '',
    results,
  };
  writeJson(reportFile, report);
  writeJson(stateFile, buildTaskState({
    taskId,
    taskName: 'plan',
    taskLabel: '任务计划',
    status: report.status,
    step: 'complete',
    message: report.summary_text,
    outputDir,
    platformOutputDir: outputDir,
    eventFile,
    stateFile,
    reportFile,
    startedAt,
    finishedAt,
  }));
  return report;
}
