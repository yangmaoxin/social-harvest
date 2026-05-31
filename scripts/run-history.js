#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_HISTORY_ARGS = ['--full', '--batch-size', '50', '--max-items', '1000'];
const SUPPORTED_PLATFORMS = new Set(['douyin', 'weixin-channels']);

export function parseArgs(argv) {
  const options = {
    platform: '',
    task: '',
    runnerArgs: [],
    taskArgs: [],
    help: false,
  };
  let afterSeparator = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      afterSeparator = true;
      continue;
    }
    if (afterSeparator) {
      options.taskArgs.push(arg);
      continue;
    }
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--task') options.task = argv[++index] || '';
    else if (arg === '--output-dir') options.runnerArgs.push(arg, argv[++index] || '');
    else if (!options.platform) options.platform = arg;
    else if (arg.startsWith('-')) {
      options.taskArgs.push(arg);
      if (argv[index + 1] && !argv[index + 1].startsWith('-')) options.taskArgs.push(argv[++index]);
    }
    else if (!options.task) options.task = arg;
    else options.taskArgs.push(arg);
  }
  return options;
}

export function buildTaskRunnerArgs(options = {}) {
  const platform = String(options.platform || '').trim();
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Unsupported history platform: ${platform || '(missing)'}`);
  return [
    path.join('scripts', 'task-runner.js'),
    'run',
    '--display',
    'detailed',
    '--platform',
    platform,
    ...(options.task ? ['--task', options.task] : []),
    ...(options.runnerArgs || []),
    '--',
    ...DEFAULT_HISTORY_ARGS,
    ...(options.taskArgs || []),
  ];
}

export function printHelp() {
  console.log(`Usage: node scripts/run-history.js <douyin|weixin-channels> [task] [--task TASK] [--output-dir PATH] [-- task args]

Runs a history backfill through task-runner with detailed display and default safety limits.
Default task args: ${DEFAULT_HISTORY_ARGS.join(' ')}
`);
}

export function runCommand(args) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) printHelp();
    else await runCommand(buildTaskRunnerArgs(options));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
