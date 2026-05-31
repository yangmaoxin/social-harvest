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
  diagnostic: '检查本地配置、浏览器和抖音登录态',
  metadata: '抓取作品元信息，建立本轮增量基线',
  'account-harvest': '抓取账号主体信息',
  'delta-plan': '对比数据库基线，生成评论/弹幕定向抓取计划',
  'metadata-sink': '写入账号主体、作品元信息和指标',
  'delta-details': '只抓需要更新的作品评论、回复和弹幕',
  'delta-sink': '写入本轮增量评论、回复和弹幕',
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
    metadataWorkLimit: 50,
    commentLimit: 0,
    help: false,
    extraCreatorArgs: [],
    sinkOptions: {
      ...resolveSinkOptions(parsedSinkOptions, { defaultSinks: sinkListForPlatform('douyin') }),
      sinkApply: true,
    },
  };

  const taskArgs = parsedSinkOptions.taskArgs;
  for (let i = 0; i < taskArgs.length; i += 1) {
    const arg = taskArgs[i];
    if (arg === '--') {
      options.extraCreatorArgs = parseExtraArgs(taskArgs, i);
      break;
    }
    if (arg === '--output-dir') options.outputDir = taskArgs[++i];
    else if (arg === '--recent-recheck-days') options.recentRecheckDays = parseNonNegativeInt(taskArgs[++i], 3);
    else if (arg === '--metadata-work-limit') options.metadataWorkLimit = parseNonNegativeInt(taskArgs[++i], 50);
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
  if (name === 'delta-details') {
    return `评论目标 ${Number(totals.comment_works || 0)} 篇，弹幕目标 ${Number(totals.danmaku_works || 0)} 篇，仍在采集`;
  }
  if (name === 'delta-sink') {
    return `评论目标 ${Number(totals.comment_works || 0)} 篇，弹幕目标 ${Number(totals.danmaku_works || 0)} 篇，写入仍在处理`;
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
  console.log(`Usage: node scripts/run-douyin-daily.js [options] [-- extra creator args]

Incremental daily flow for douyin:
  1. run the same platform diagnostic gate as normal daily
  2. fetch metadata-only creator-harvest.json and compare it with the SCRM DB baseline
  3. fetch comments/danmaku only for changed/new/recent works
  4. write normalized datasets through the configured sink runner

Options:
  --output-dir PATH             Output root, default samples/tasks/daily-douyin-<stamp>
  --recent-recheck-days N       Re-fetch recent works even without count increase, default 3
  --metadata-work-limit N       Metadata works to inspect, default 50
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
    `daily-douyin-${shanghaiRunStamp()}`,
  ));
  const metadataDir = path.join(outputRoot, 'metadata');
  const deltaDir = path.join(outputRoot, 'delta');
  const planPath = path.join(outputRoot, 'delta-plan.json');
  const workPlanPath = path.join(outputRoot, 'work-ids.json');
  const commentPlanPath = path.join(outputRoot, 'comment-work-ids.json');
  const danmakuPlanPath = path.join(outputRoot, 'danmaku-work-ids.json');
  const reportPath = path.join(outputRoot, 'daily-report.json');
  const report = {
    status: 'running',
    started_at: new Date().toISOString(),
    platform: 'douyin',
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
    platform: 'douyin',
    platformLabel: '抖音',
    stepLabels: STEP_LABELS,
    heartbeatHints: Object.fromEntries(
      Object.keys(STEP_LABELS).map((name) => [name, () => stepHeartbeatHint(name, report)]),
    ),
  });
  try {
    fs.mkdirSync(outputRoot, { recursive: true });
    daily.info('抖音增量日常启动');
    daily.info(`输出目录：${outputRoot}`);
    daily.info(`近期复查窗口：${options.recentRecheckDays} 天`);

    await daily.runStep('diagnostic', [
      path.join('scripts', 'doctor.js'),
      '--json',
      '--check-platforms',
      '--platform',
      'douyin',
    ]);

    await daily.runStep('metadata', [
      path.join('scripts', 'harvest-douyin-creator.js'),
      '--metadata-only',
      '--output-dir',
      metadataDir,
      '--work-limit',
      String(options.metadataWorkLimit),
      ...options.extraCreatorArgs,
    ]);

    await daily.runStep('account-harvest', [
      path.join('scripts', 'harvest-douyin-account.js'),
      '--output-dir',
      metadataDir,
    ]);

    await daily.runStep('delta-plan', [
      path.join('scripts', 'build-douyin-delta-plan.js'),
      '--works',
      path.join(metadataDir, 'creator-harvest.json'),
      '--output',
      planPath,
      '--recent-recheck-days',
      String(options.recentRecheckDays),
    ]);
    report.delta_plan = readJson(planPath, {});
    daily.printLines(formatDeltaPlanSummary(report.delta_plan));
    writeJson(workPlanPath, report.delta_plan.work_ids || []);
    writeJson(commentPlanPath, report.delta_plan.comment_work_ids || []);
    writeJson(danmakuPlanPath, report.delta_plan.danmaku_work_ids || []);

    await daily.runStep('metadata-sink', sinkStepArgs('douyin', metadataDir, options.sinkOptions, {
      sourceRunId: `${report.task_id}:metadata`,
      datasets: ['accounts', 'content', 'metric_snapshots', 'metric_delta_events'],
    }));

    const shouldFetchDetails = Number(report.delta_plan?.totals?.comment_works || 0) > 0
      || Number(report.delta_plan?.totals?.danmaku_works || 0) > 0;
    const deltaSinkDatasets = [
      ...(Number(report.delta_plan?.totals?.comment_works || 0) > 0 ? ['content'] : []),
      ...(Number(report.delta_plan?.totals?.danmaku_works || 0) > 0 ? ['danmaku'] : []),
    ];
    if (shouldFetchDetails) {
      await daily.runStep('delta-details', [
        path.join('scripts', 'harvest-douyin-creator.js'),
        '--output-dir',
        deltaDir,
        '--work-limit',
        String(Math.max(1, options.metadataWorkLimit)),
        '--comment-work-limit',
        String(Math.max(1, options.metadataWorkLimit)),
        '--danmaku-work-limit',
        String(Math.max(1, options.metadataWorkLimit)),
        '--work-ids-file',
        workPlanPath,
        '--comment-work-ids-file',
        commentPlanPath,
        '--danmaku-work-ids-file',
        danmakuPlanPath,
        ...(options.commentLimit > 0 ? ['--comment-limit', String(options.commentLimit)] : []),
        ...options.extraCreatorArgs,
      ]);
      await daily.runStep('delta-sink', sinkStepArgs('douyin', deltaDir, options.sinkOptions, {
        sourceRunId: `${report.task_id}:delta`,
        datasets: deltaSinkDatasets,
      }));
    } else {
      daily.skipStep('delta-details', 'No changed comment or danmaku works in delta plan.');
      daily.skipStep('delta-sink', 'No changed comment or danmaku works in delta plan.');
    }

    await daily.runStep('messages-export', [
      path.join('scripts', 'sync-douyin-private-messages-to-scrm-message.js'),
      '--output-dir',
      metadataDir,
      '--message-limit',
      '50',
      '--export-only',
    ]);
    await daily.runStep('messages-sink', sinkStepArgs('douyin', metadataDir, options.sinkOptions, {
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
