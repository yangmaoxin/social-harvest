#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createDailyRunner,
} from './lib/daily-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

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
    reportPath: '',
    outputDir: '',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') options.outputDir = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.reportPath) options.reportPath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/run-daily-failed.js <daily-report.json|task-report.json> [--output-dir PATH]

For incremental daily reports, reruns failed steps from the saved command args.
For legacy runner plan reports, delegates to task-runner --failed-from.
`);
}

function readReport(reportPath) {
  if (!reportPath) throw new Error('Missing report path.');
  return JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'));
}

function isIncrementalDailyReport(report = {}) {
  return String(report.mode || '').startsWith('incremental-daily') && Array.isArray(report.steps);
}

function stepArgs(step = {}) {
  const args = Array.isArray(step.args) ? step.args.map(String) : [];
  if (args[0] === process.execPath || path.basename(args[0] || '') === path.basename(process.execPath)) {
    return args.slice(1);
  }
  return args;
}

function failedDailySteps(report = {}) {
  return (report.steps || [])
    .filter((step) => step?.status === 'failed')
    .filter((step) => stepArgs(step).length > 0);
}

function delegateToTaskRunner(reportPath, outputDir = '') {
  const args = [
    path.join('scripts', 'task-runner.js'),
    'plan',
    '--display',
    'detailed',
    '--failed-from',
    path.resolve(reportPath),
  ];
  if (outputDir) args.push('--output-dir', path.resolve(outputDir));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(0);
      else reject(new Error(`task-runner failed with exit code ${code}`));
    });
  });
}

export async function run(options) {
  const reportPath = path.resolve(options.reportPath);
  const sourceReport = readReport(reportPath);
  if (!isIncrementalDailyReport(sourceReport)) {
    await delegateToTaskRunner(reportPath, options.outputDir);
    return { delegated: true };
  }

  const failedSteps = failedDailySteps(sourceReport);
  if (!failedSteps.length) {
    throw new Error(`${reportPath} does not contain failed daily steps to rerun.`);
  }

  const outputRoot = path.resolve(options.outputDir || path.join(
    ROOT_DIR,
    'samples',
    'tasks',
    `${sourceReport.task_id || path.basename(path.dirname(reportPath)) || 'daily'}-failed-rerun-${shanghaiRunStamp()}`,
  ));
  const rerunReportPath = path.join(outputRoot, 'daily-report.json');
  const report = {
    status: 'running',
    started_at: new Date().toISOString(),
    platform: sourceReport.platform || '',
    mode: 'incremental-daily-failed-rerun',
    source_report: reportPath,
    output_dir: outputRoot,
    steps: [],
  };
  const daily = createDailyRunner({
    outputDir: outputRoot,
    report,
    reportPath: rerunReportPath,
    platform: sourceReport.platform || '',
    platformLabel: sourceReport.platform || '日常',
    stepLabels: Object.fromEntries(
      (sourceReport.steps || []).map((step) => [step.name, step.name]),
    ),
  });

  try {
    fs.mkdirSync(outputRoot, { recursive: true });
    daily.info(`失败补跑启动：来源 ${reportPath}`);
    for (const step of failedSteps) {
      await daily.runStep(step.name, stepArgs(step));
    }
    daily.finish('success');
    return { report, reportPath: rerunReportPath };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    daily.finish('failed');
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
