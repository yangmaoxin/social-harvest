import path from 'node:path';

import { classifyTaskFailure } from '../scripts/lib/failure-classifier.js';
import { ROOT_DIR } from '../scripts/lib/runtime-config.js';

export function nowIso() {
  return new Date().toISOString();
}

export function elapsedMs(startedAt, finishedAt = nowIso()) {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function shortText(text, max = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function artifact(label, filePath, type = 'file') {
  if (!filePath) return null;
  return { label, type, path: filePath };
}

function compactArtifacts(items) {
  const seen = new Set();
  return items
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.type}:${item.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function slashPath(filePath) {
  return String(filePath || '').replaceAll(path.sep, '/');
}

function relativePathForCommand(filePath) {
  if (!filePath) return '';
  const value = String(filePath);
  if (!path.isAbsolute(value)) return slashPath(value);
  const relative = path.relative(ROOT_DIR, value);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return slashPath(relative);
  return value;
}

function relativeEvidencePath(filePath, outputDir) {
  if (!filePath) return '';
  const value = String(filePath);
  if (!outputDir) return relativePathForCommand(value);
  const relative = path.relative(outputDir, value);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return slashPath(relative);
  return relativePathForCommand(value);
}

function shellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function isSensitiveArgName(arg) {
  return /(?:password|passwd|secret|token|cookie|key)$/i.test(String(arg || '').replace(/^--?/, ''));
}

function sanitizedTaskArgsForRepro(args = []) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (arg === '--output-dir') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--output-dir=')) continue;
    const [name, value] = arg.split('=', 2);
    if (arg.startsWith('--') && value !== undefined && isSensitiveArgName(name)) {
      result.push(`${name}=<redacted>`);
      continue;
    }
    if (arg.startsWith('--') && isSensitiveArgName(arg)) {
      result.push(arg, '<redacted>');
      index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
}

export function reproCommandForReport({
  platformId = '',
  taskName = '',
  outputDir = '',
  taskArgs = [],
  planPath = '',
  failedFrom = '',
} = {}) {
  const parts = planPath
    ? ['node', 'scripts/task-runner.js', 'plan', '--config', relativePathForCommand(planPath)]
    : failedFrom
      ? ['node', 'scripts/task-runner.js', 'plan', '--failed-from', relativePathForCommand(failedFrom)]
      : ['node', 'scripts/task-runner.js', 'run'];
  if (!planPath && !failedFrom && platformId) parts.push('--platform', platformId);
  if (!planPath && !failedFrom && taskName) parts.push('--task', taskName);
  if (outputDir) parts.push('--output-dir', relativePathForCommand(outputDir));
  const safeArgs = sanitizedTaskArgsForRepro(taskArgs);
  if (!planPath && !failedFrom && safeArgs.length) parts.push('--', ...safeArgs);
  return parts.map(shellArg).join(' ');
}

export function verificationCommandsForReport({ taskName = '', status = '' } = {}) {
  const commands = ['npm run check'];
  if (taskName === 'diagnostic') {
    commands.push('node scripts/task-runner.js run --task diagnostic --output-dir samples/tasks/diagnostic-demo');
  }
  commands.push('npm run test -- scripts/task-runner.test.js');
  if (status === 'failed') commands.push('node scripts/task-runner.js run --task diagnostic');
  return [...new Set(commands)];
}

export function evidenceFilesForReport({ outputDir = '', artifacts = [] } = {}) {
  const seen = new Set();
  return artifacts
    .filter((item) => item?.type !== 'directory')
    .map((item) => relativeEvidencePath(item.path, outputDir))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function opencliIssueText(platformReport = null) {
  return [
    ...(Array.isArray(platformReport?.issues) ? platformReport.issues : []),
    ...(Array.isArray(platformReport?.warnings) ? platformReport.warnings : []),
  ].join('\n');
}

function harnessWarningsForReport({ platformReport = null, taskName = '' } = {}) {
  const warnings = [];
  const issueText = opencliIssueText(platformReport);
  if (/Local adapter overrides shadow packaged adapters/i.test(issueText)) {
    warnings.push({
      category: 'environment.opencli_override',
      message: 'Local adapter overrides shadow packaged adapters.',
      next_actions: [
        'Confirm whether the local adapter is a required project runtime adapter before resetting it.',
        'If only a local file shadows a packaged command, rename or back up that file first.',
        'Review local ~/.opencli/clis overrides before comparing packaged OpenCLI behavior.',
      ],
    });
  }
  if (taskName === 'diagnostic' && /platform-login-checks[\s\S]{0,400}?skipped/i.test(issueText)) {
    warnings.push({
      category: 'diagnostic.platform_login_skipped',
      message: 'Platform login checks were skipped.',
      next_actions: [
        'Run `node scripts/task-runner.js run --task diagnostic -- --check-platforms` before platform collection tasks.',
      ],
    });
  }
  return warnings;
}

export function compactHarnessWarnings(warnings = []) {
  const seen = new Set();
  return warnings
    .filter((warning) => warning && typeof warning === 'object')
    .filter((warning) => {
      const key = `${warning.category || ''}:${warning.message || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function retriableForReport({ status = '', failure = null } = {}) {
  if (status !== 'failed') return false;
  if (!failure) return true;
  return ['chrome_unreachable', 'opencli_unavailable', 'platform_access_unavailable', 'unknown'].includes(failure.category);
}

function requiresHumanActionForReport({ failure = null, harnessWarnings = [] } = {}) {
  if (failure && ['platform_not_logged_in', 'account_missing', 'database_unavailable', 'ai_unavailable'].includes(failure.category)) {
    return true;
  }
  return harnessWarnings.some((warning) => warning.category === 'environment.opencli_override');
}

function suggestedSkillForReport({ failure = null, harnessWarnings = [] } = {}) {
  if (failure && ['opencli_unavailable', 'platform_access_unavailable', 'unknown'].includes(failure.category)) return 'opencli-autofix';
  if (harnessWarnings.some((warning) => warning.category === 'environment.opencli_override')) return 'opencli-autofix';
  return 'social-harvest-operator';
}

export function countersFromPlatformReport(report = {}) {
  const data = report || {};
  const creatorReplyStatusCounts = data.creator_harvest_reply_fetch_status_counts
    || data.counts?.reply_fetch_status_counts
    || {};
  return {
    accounts: Number(data.account_count || 0),
    works: Number(data.work_rows || 0),
    comments: Number(data.comment_rows || 0),
    danmaku: Number(data.danmaku_rows || 0),
    harvest_status: data.harvest_status || data.status || '',
    private_messages_status: data.private_messages_status || '',
    danmaku_status: data.danmaku_status || '',
    creator_harvest_danmaku_rows: Number(data.creator_harvest_danmaku_rows || data.counts?.danmaku_rows || 0),
    creator_harvest_top_level_comments: Number(data.creator_harvest_top_level_comment_rows || data.counts?.top_level_comment_rows || 0),
    creator_harvest_reply_comments: Number(data.creator_harvest_reply_comment_rows || data.counts?.reply_comment_rows || 0),
    creator_harvest_reply_fetch_status_counts: creatorReplyStatusCounts,
    comment_ip_supplement_enabled: Number(data.supplement_public_ip_enabled ? 1 : 0),
    comment_ip_filled: Number(data.comment_ip_filled_rows || 0),
    comment_ip_missing: Number(data.comment_ip_missing_rows || 0),
    comment_semantic_overlap: Number(data.semantic_overlapping_comment_candidates || 0),
    comment_semantic_creator_only: Number(data.semantic_creator_only_comment_candidates || 0),
    metric_snapshots: Number(data.metric_snapshot_rows || 0),
    metric_delta_events: Number(data.metric_delta_rows || 0),
    private_messages: Number(data.private_messages_rows || 0),
    checks: Number(data.checks || 0),
    failed_checks: Number(data.failed_checks || 0),
    warning_checks: Number(data.warning_checks || 0),
  };
}

export function collectArtifacts({
  outputDir = '',
  platformOutputDir = '',
  eventFile = '',
  stateFile = '',
  reportFile = '',
  platformReport = null,
} = {}) {
  return compactArtifacts([
    artifact('任务输出目录', outputDir, 'directory'),
    artifact('平台输出目录', platformOutputDir, 'directory'),
    artifact('任务事件', eventFile),
    artifact('任务状态', stateFile),
    artifact('任务报告', reportFile),
    artifact('私信报告', platformReport?.private_messages_report_file),
    artifact('弹幕报告', platformReport?.danmaku_report_file),
    artifact('平台报告', platformReport?.report_file),
    artifact('平台汇总', platformReport?.summary_file),
  ]);
}

function summaryTextForReport({
  status = '',
  platformLabel = '',
  taskName = '',
  taskLabel = '',
  platformReport = null,
  error = '',
  failure = null,
} = {}) {
  const label = platformLabel ? `${platformLabel} ${taskLabel}` : taskLabel;
  if (failure && failure.category !== 'unknown') return `${label}失败：${failure.title}。${failure.description}`;
  if (error) return `${label}失败：${shortText(error.split('\n')[0])}`;
  if (!platformReport) return `${label} ${status}`;
  if (taskName === 'diagnostic') {
    return `运行前检查${platformReport.status || status}：检查 ${platformReport.checks || 0} 项，失败 ${platformReport.failed_checks || 0} 项，警告 ${platformReport.warning_checks || 0} 项。`;
  }
  const counters = countersFromPlatformReport(platformReport);
  if (taskName === 'content-import') {
    const supplementEnabled = counters.comment_ip_supplement_enabled > 0;
    const parts = [`评论 ${counters.comments}`];
    if (supplementEnabled) {
      parts.push(`有 IP ${counters.comment_ip_filled}`);
      if (counters.comment_ip_missing > 0) parts.push(`仍缺 IP ${counters.comment_ip_missing}`);
    } else if (counters.comment_ip_missing > 0) {
      parts.push(`缺 IP ${counters.comment_ip_missing}`);
    }
    if (counters.comment_semantic_overlap > 0) {
      parts.push(`可语义补位 ${counters.comment_semantic_overlap}`);
    }
    return `${label}${status === 'success' ? '完成' : status}：${parts.join('，')}。`;
  }
  if (taskName === 'metric-snapshot-account' || taskName === 'metric-snapshot-work') {
    return `${label}${status === 'success' ? '完成' : status}：指标快照 ${counters.metric_snapshots}。`;
  }
  if (taskName === 'metric-delta-account' || taskName === 'metric-delta-work') {
    return `${label}${status === 'success' ? '完成' : status}：新增指标事件 ${counters.metric_delta_events}。`;
  }
  const parts = [];
  if (counters.accounts) parts.push(`账号 ${counters.accounts}`);
  if (counters.works) parts.push(`作品 ${counters.works}`);
  if (counters.creator_harvest_top_level_comments) {
    parts.push(`评论 ${counters.creator_harvest_top_level_comments}`);
  } else if (counters.comments) {
    parts.push(`评论 ${counters.comments}`);
  }
  if (counters.creator_harvest_reply_comments) parts.push(`回复 ${counters.creator_harvest_reply_comments}`);
  if (counters.creator_harvest_danmaku_rows) parts.push(`弹幕 ${counters.creator_harvest_danmaku_rows}`);
  if (counters.private_messages) parts.push(`私信 ${counters.private_messages}`);
  if (counters.danmaku) parts.push(`弹幕 ${counters.danmaku}`);
  if (counters.metric_snapshots) parts.push(`指标快照 ${counters.metric_snapshots}`);
  if (counters.metric_delta_events) parts.push(`新增指标事件 ${counters.metric_delta_events}`);
  if (!parts.length && platformReport.status) parts.push(`状态 ${platformReport.status}`);
  return `${label}${status === 'success' ? '完成' : status}：${parts.join('，') || '无新增统计'}。`;
}

function nextActionsForReport({ status = '', taskName = '', error = '', platformReport = null, failure = null } = {}) {
  if (status === 'success') {
    const warnings = Array.isArray(platformReport?.warnings) ? platformReport.warnings : [];
    const actions = warnings.length ? ['查看 warnings，确认是否需要重跑或补数据。'] : [];
    if (taskName === 'content-import') {
      const counters = countersFromPlatformReport(platformReport);
      if (!counters.comment_ip_supplement_enabled && counters.comment_ip_missing > 0) {
        actions.push('如需补评论 IP，可提供前台样本并启用“补评论 IP”选项。');
      } else if (counters.comment_ip_supplement_enabled && counters.comment_ip_missing > 0) {
        actions.push('仍有少量评论缺少 IP，通常是创作者中心独有回复；如无强依赖可接受为空。');
      }
    }
    return actions;
  }
  if (failure) return failure.nextActions;
  if (error) return ['查看 task-report.json 的 error 字段。', '查看 task-events.jsonl 和平台输出目录中的报告文件。'];
  return [];
}

function failureFields(failure) {
  if (!failure) return {};
  return {
    failure_category: failure.category,
    failure_title: failure.title,
  };
}

export function buildTaskState({
  taskId,
  platformId = '',
  platformLabel = '',
  taskName = '',
  taskLabel = '',
  status,
  step,
  message = '',
  outputDir,
  platformOutputDir,
  eventFile,
  stateFile,
  reportFile,
  startedAt,
  updatedAt = nowIso(),
  finishedAt = '',
  platformReport = null,
  error = '',
  recentEvents = [],
} = {}) {
  const failure = error ? classifyTaskFailure({ error, platformReport }) : null;
  const artifacts = collectArtifacts({
    outputDir,
    platformOutputDir,
    eventFile,
    stateFile,
    reportFile,
    platformReport,
  });
  return {
    task_id: taskId,
    platform: platformId,
    platform_label: platformLabel,
    task: taskName,
    task_label: taskLabel,
    status,
    step,
    message,
    started_at: startedAt,
    updated_at: updatedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt ? elapsedMs(startedAt, finishedAt) : 0,
    output_dir: outputDir,
    platform_output_dir: platformOutputDir,
    task_events_file: eventFile,
    task_state_file: stateFile,
    task_report_file: reportFile,
    counters: countersFromPlatformReport(platformReport),
    warnings: Array.isArray(platformReport?.warnings) ? platformReport.warnings : [],
    error,
    ...failureFields(failure),
    artifacts,
    recent_events: recentEvents.slice(-20),
  };
}

export function buildTaskReport({
  taskId,
  platformId = '',
  platformLabel = '',
  taskName = '',
  taskLabel = '',
  status,
  outputDir,
  platformOutputDir,
  eventFile,
  stateFile,
  reportFile,
  platformReport = null,
  startedAt,
  finishedAt,
  stdout = '',
  stderr = '',
  error = '',
  taskArgs = [],
} = {}) {
  const failure = error ? classifyTaskFailure({ error, stderr, platformReport }) : null;
  const artifacts = collectArtifacts({
    outputDir,
    platformOutputDir,
    eventFile,
    stateFile,
    reportFile,
    platformReport,
  });
  const harnessWarnings = harnessWarningsForReport({ platformReport, taskName });
  return {
    task_id: taskId,
    platform: platformId,
    platform_label: platformLabel,
    task: taskName,
    task_label: taskLabel,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: elapsedMs(startedAt, finishedAt),
    output_dir: outputDir,
    platform_output_dir: platformOutputDir,
    task_events_file: eventFile,
    task_state_file: stateFile,
    task_report_file: reportFile,
    platform_report: platformReport,
    counters: countersFromPlatformReport(platformReport),
    summary_text: summaryTextForReport({
      status,
      platformLabel,
      taskName,
      taskLabel,
      platformReport,
      error,
      failure,
    }),
    artifacts,
    recoverable: failure?.recoverable ?? status === 'failed',
    retriable: retriableForReport({ status, failure }),
    requires_human_action: requiresHumanActionForReport({ failure, harnessWarnings }),
    next_actions: nextActionsForReport({ status, taskName, error, platformReport, failure }),
    repro_command: reproCommandForReport({
      platformId,
      taskName,
      outputDir,
      taskArgs,
    }),
    verification_commands: verificationCommandsForReport({ taskName, status }),
    evidence_files: evidenceFilesForReport({ outputDir, artifacts }),
    suggested_skill: suggestedSkillForReport({ failure, harnessWarnings }),
    harness_warnings: harnessWarnings,
    error,
    ...failureFields(failure),
    task_args: sanitizedTaskArgsForRepro(taskArgs),
    stdout_bytes: Buffer.byteLength(stdout || ''),
    stderr_bytes: Buffer.byteLength(stderr || ''),
  };
}
