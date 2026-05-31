#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDailyRunner,
  writeJson,
} from './lib/daily-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const STEP_LABELS = {
  'weixin-channels': '运行视频号增量日常',
  douyin: '运行抖音增量日常',
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

export function parseArgs(argv) {
  const options = {
    outputDir: '',
    help: false,
    passThrough: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.passThrough.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '--output-dir') options.outputDir = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.passThrough.push(arg);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/run-daily-all.js [--output-dir PATH] [-- daily args]

Runs the default incremental daily workflow for all supported first-line platforms.
`);
}

function childReportPath(outputRoot, platformId) {
  return path.join(outputRoot, platformId, 'daily-report.json');
}

function collectChildReports(outputRoot) {
  return ['weixin-channels', 'douyin']
    .map((platformId) => {
      const reportPath = childReportPath(outputRoot, platformId);
      if (!fs.existsSync(reportPath)) return null;
      return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    })
    .filter(Boolean);
}

export async function run(options) {
  const outputRoot = path.resolve(options.outputDir || path.join(
    ROOT_DIR,
    'samples',
    'tasks',
    `daily-all-${shanghaiRunStamp()}`,
  ));
  const reportPath = path.join(outputRoot, 'daily-report.json');
  const report = {
    status: 'running',
    started_at: new Date().toISOString(),
    platform: 'all',
    mode: 'incremental-daily-all',
    output_dir: outputRoot,
    steps: [],
    child_reports: [],
  };
  const daily = createDailyRunner({
    outputDir: outputRoot,
    report,
    reportPath,
    platform: 'all',
    platformLabel: '全平台',
    stepLabels: STEP_LABELS,
    heartbeatHints: {
      'weixin-channels': '视频号增量日常仍在处理',
      douyin: '抖音增量日常仍在处理',
    },
  });

  try {
    fs.mkdirSync(outputRoot, { recursive: true });
    daily.info('全平台增量日常启动');
    daily.info(`输出目录：${outputRoot}`);

    await daily.runStep('weixin-channels', [
      path.join('scripts', 'run-weixin-channels-daily.js'),
      '--output-dir',
      path.join(outputRoot, 'weixin-channels'),
      ...options.passThrough,
    ]);
    await daily.runStep('douyin', [
      path.join('scripts', 'run-douyin-daily.js'),
      '--output-dir',
      path.join(outputRoot, 'douyin'),
      ...options.passThrough,
    ]);

    report.child_reports = collectChildReports(outputRoot);
    daily.finish('success', {
      child_reports: report.child_reports.length,
    });
    writeJson(reportPath, report);
    writeJson(path.join(outputRoot, 'task-report.json'), report);
    return { report, reportPath };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.child_reports = collectChildReports(outputRoot);
    daily.finish('failed', {
      child_reports: report.child_reports.length,
    });
    writeJson(reportPath, report);
    writeJson(path.join(outputRoot, 'task-report.json'), report);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) printHelp();
    else await run(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
