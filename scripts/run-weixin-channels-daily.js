#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDailyRunner,
  readJson,
  shortDailyText,
  writeJson,
} from './lib/daily-runner.js';
import { sinkListForPlatform } from './lib/runtime-config.js';
import { parseSinkOptions, resolveSinkOptions } from '../runner/sink-options.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const STEP_LABELS = {
  diagnostic: '检查本地配置、浏览器和视频号登录态',
  metadata: '抓取作品元信息，建立本轮增量基线',
  'account-harvest': '抓取账号主体信息',
  'delta-plan': '对比数据库基线，生成评论/弹幕定向抓取计划',
  'metadata-sink': '写入账号主体、作品元信息和指标',
  'delta-comments': '只抓需要更新的作品评论和回复',
  'delta-comments-sink': '写入本轮增量评论/回复',
  'danmaku-export': '只导出需要更新的作品弹幕',
  'danmaku-sink': '写入本轮增量弹幕',
  'messages-export': '导出私信和打招呼消息',
  'messages-sink': '写入私信和打招呼消息',
};

const REASON_LABELS = {
  new_work: '新作品',
  comment_count_increased: '评论数增长',
  danmaku_count_increased: '弹幕数增长',
  recent_work_recheck: '近期复查',
  missing_danmaku_details: '缺少弹幕明细',
  db_danmaku_rows_below_baseline_count: '数据库弹幕明细少于基线',
};

function shanghaiRunStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseExtraArgs(argv, startIndex) {
  return argv.slice(startIndex + 1);
}

export function parseArgs(argv) {
  const parsedSinkOptions = parseSinkOptions(argv);
  const options = {
    outputDir: '',
    recentRecheckDays: 3,
    metadataWorkLimit: 0,
    commentLimit: 0,
    help: false,
    extraResumeArgs: [],
    sinkOptions: {
      ...resolveSinkOptions(parsedSinkOptions, { defaultSinks: sinkListForPlatform('weixin-channels') }),
      sinkApply: true,
    },
  };

  const taskArgs = parsedSinkOptions.taskArgs;
  for (let i = 0; i < taskArgs.length; i += 1) {
    const arg = taskArgs[i];
    if (arg === '--') {
      options.extraResumeArgs = parseExtraArgs(taskArgs, i);
      break;
    }
    if (arg === '--output-dir') options.outputDir = taskArgs[++i];
    else if (arg === '--recent-recheck-days') options.recentRecheckDays = parseNonNegativeInt(taskArgs[++i], 3);
    else if (arg === '--metadata-work-limit') options.metadataWorkLimit = parseNonNegativeInt(taskArgs[++i], 0);
    else if (arg === '--comment-limit') options.commentLimit = parseNonNegativeInt(taskArgs[++i], 0);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function stepLabel(name) {
  return STEP_LABELS[name] || name;
}

function countReasons(plan = {}) {
  const counts = new Map();
  for (const work of plan.changed_works || []) {
    for (const reason of work.reasons || []) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function formatDeltaPlanSummary(plan = {}) {
  const totals = plan.totals || {};
  const lines = [
    `[daily] 增量计划：作品 ${Number(totals.works || 0)} 篇，需更新 ${Number(totals.changed_works || 0)} 篇，评论 ${Number(totals.comment_works || 0)} 篇，弹幕 ${Number(totals.danmaku_works || 0)} 篇，跳过 ${Number(totals.unchanged_works || 0)} 篇`,
  ];
  const reasons = countReasons(plan)
    .map(([reason, count]) => `${REASON_LABELS[reason] || reason} ${count}`)
    .join('，');
  if (reasons) lines.push(`[daily] 更新原因：${reasons}`);
  const examples = (plan.changed_works || [])
    .slice(0, 3)
    .map((work) => shortDailyText(work.title || work.object_id, 56))
    .filter(Boolean);
  if (examples.length) {
    const suffix = (plan.changed_works || []).length > examples.length ? '（仅展示前 3 篇）' : '';
    lines.push(`[daily] 本轮涉及作品：${examples.join('；')}${suffix}`);
  }
  return lines;
}

function stepHeartbeatHint(name, report = {}) {
  const totals = report.delta_plan?.totals || {};
  if (name === 'metadata') return '正在读取作品列表和平台统计数';
  if (name === 'delta-comments' || name === 'delta-comments-sink') {
    return `评论目标 ${Number(totals.comment_works || 0)} 篇，仍在处理`;
  }
  if (name === 'danmaku-export' || name === 'danmaku-sink') {
    return `弹幕目标 ${Number(totals.danmaku_works || 0)} 篇，仍在处理`;
  }
  if (name === 'metadata-sink') return '账号、作品元信息和指标写入仍在处理';
  if (name === 'messages-export' || name === 'messages-sink') return '私信链路仍在处理';
  if (name.includes('sink')) return 'sink 写入和校验仍在处理';
  return `${stepLabel(name)}仍在处理`;
}

function sinkStepArgs(platform, outputDir, sinkOptions = {}, {
  sourceRunId = '',
  datasets = ['all'],
  extraArgs = [],
} = {}) {
  return [
    path.join('scripts', 'run-sinks.js'),
    '--platform',
    platform,
    '--output-dir',
    outputDir,
    '--source-run-id',
    sourceRunId,
    ...datasets.flatMap((dataset) => ['--dataset', dataset]),
    ...(sinkOptions.sinkArgs || []),
    ...extraArgs,
    ...(sinkOptions.sinks || []).flatMap((sink) => ['--sink', sink]),
    ...(sinkOptions.sinkApply ? ['--sink-apply'] : []),
  ];
}

export function printHelp() {
  console.log(`Usage: node scripts/run-weixin-channels-daily.js [options] [-- extra resume args]

Incremental daily flow for weixin-channels:
  1. run the same platform diagnostic gate as normal daily
  2. fetch metadata-only works.json and compare it with the SCRM DB baseline
  3. fetch comments only for changed/new/recent works
  4. write normalized datasets through the configured sink runner

Options:
  --output-dir PATH             Output root, default samples/tasks/daily-weixin-channels-<stamp>
  --recent-recheck-days N       Re-fetch recent works even without count increase, default 3
  --metadata-work-limit N       Limit metadata works for smoke runs
  --comment-limit N             Limit comments per changed work
  --sink NAME                   Destination sink. Repeatable or comma-separated.
  --sink-apply                  Apply sink writes, enabled by default for this daily command.
`);
}

export async function run(options) {
  const outputRoot = path.resolve(options.outputDir || path.join(
    ROOT_DIR,
    'samples',
    'tasks',
    `daily-weixin-channels-${shanghaiRunStamp()}`,
  ));
  const metadataDir = path.join(outputRoot, 'metadata');
  const deltaDir = path.join(outputRoot, 'delta');
  const planPath = path.join(outputRoot, 'delta-plan.json');
  const commentPlanPath = path.join(outputRoot, 'comment-work-ids.json');
  const danmakuPlanPath = path.join(outputRoot, 'danmaku-work-ids.json');
  const reportPath = path.join(outputRoot, 'daily-report.json');
  const report = {
    status: 'running',
    started_at: new Date().toISOString(),
    platform: 'weixin-channels',
    mode: 'incremental-daily',
    baseline_source: 'database',
    output_dir: outputRoot,
    metadata_dir: metadataDir,
    delta_dir: deltaDir,
    delta_plan_file: planPath,
    steps: [],
  };
  const daily = createDailyRunner({
    outputDir: outputRoot,
    report,
    reportPath,
    platform: 'weixin-channels',
    platformLabel: '视频号',
    stepLabels: STEP_LABELS,
    heartbeatHints: Object.fromEntries(
      Object.keys(STEP_LABELS).map((name) => [name, () => stepHeartbeatHint(name, report)]),
    ),
  });
  try {
    fs.mkdirSync(outputRoot, { recursive: true });
    daily.info('视频号增量日常启动');
    daily.info(`输出目录：${outputRoot}`);
    daily.info(`近期复查窗口：${options.recentRecheckDays} 天`);
    await daily.runStep('diagnostic', [
      path.join('scripts', 'doctor.js'),
      '--json',
      '--check-platforms',
      '--platform',
      'weixin-channels',
    ]);

    await daily.runStep('metadata', [
      path.join('scripts', 'resume-weixin-channels.js'),
      '--metadata-only',
      '--refresh',
      '--output-dir',
      metadataDir,
      ...(options.metadataWorkLimit > 0 ? ['--work-limit', String(options.metadataWorkLimit)] : []),
      ...options.extraResumeArgs,
    ]);

    await daily.runStep('account-harvest', [
      path.join('scripts', 'harvest-weixin-channels-account.js'),
      '--output-dir',
      metadataDir,
    ]);

    await daily.runStep('delta-plan', [
      path.join('scripts', 'build-weixin-channels-delta-plan.js'),
      '--works',
      path.join(metadataDir, 'works.json'),
      '--output',
      planPath,
      '--recent-recheck-days',
      String(options.recentRecheckDays),
    ]);
    report.delta_plan = readJson(planPath, {});
    daily.printLines(formatDeltaPlanSummary(report.delta_plan));
    writeJson(commentPlanPath, report.delta_plan.comment_work_ids || report.delta_plan.work_ids || []);
    writeJson(danmakuPlanPath, report.delta_plan.danmaku_work_ids || report.delta_plan.work_ids || []);

    await daily.runStep('metadata-sink', sinkStepArgs('weixin-channels', metadataDir, options.sinkOptions, {
      sourceRunId: `${report.task_id}:metadata`,
      datasets: ['accounts', 'content', 'metric_snapshots', 'metric_delta_events'],
    }));

    if (Number(report.delta_plan?.totals?.comment_works || 0) > 0) {
      await daily.runStep('delta-comments', [
        path.join('scripts', 'resume-weixin-channels.js'),
        '--content-only',
        '--work-ids-file',
        commentPlanPath,
        '--skip-preflight',
        '--skip-startup-preflight',
        '--output-dir',
        deltaDir,
        ...(options.commentLimit > 0 ? ['--comment-limit', String(options.commentLimit)] : []),
        ...options.extraResumeArgs,
      ]);
      await daily.runStep('delta-comments-sink', sinkStepArgs('weixin-channels', deltaDir, options.sinkOptions, {
        sourceRunId: `${report.task_id}:delta-comments`,
        datasets: ['content'],
        extraArgs: ['--account-profile', path.join(metadataDir, 'account-profile.json')],
      }));
    } else {
      daily.skipStep('delta-comments', 'No changed comment works in delta plan.');
      daily.skipStep('delta-comments-sink', 'No changed comment works in delta plan.');
    }

    if (Number(report.delta_plan?.totals?.danmaku_works || 0) > 0) {
      await daily.runStep('danmaku-export', [
        path.join('scripts', 'sync-weixin-channels-danmaku-to-scrm.js'),
        '--output-dir',
        metadataDir,
        '--export-only',
        '--work-ids-file',
        danmakuPlanPath,
      ]);
      await daily.runStep('danmaku-sink', sinkStepArgs('weixin-channels', metadataDir, options.sinkOptions, {
        sourceRunId: `${report.task_id}:danmaku`,
        datasets: ['danmaku'],
      }));
    } else {
      daily.skipStep('danmaku-export', 'No changed danmaku works in delta plan.');
      daily.skipStep('danmaku-sink', 'No changed danmaku works in delta plan.');
    }

    await daily.runStep('messages-export', [
      path.join('scripts', 'sync-weixin-channels-private-messages-to-scrm-message.js'),
      '--output-dir',
      metadataDir,
      '--export-only',
    ]);
    await daily.runStep('messages-sink', sinkStepArgs('weixin-channels', metadataDir, options.sinkOptions, {
      sourceRunId: `${report.task_id}:messages`,
      datasets: ['messages'],
    }));

    daily.finish('success');
    return { report, reportPath };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    daily.finish('failed');
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      await run(options);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
