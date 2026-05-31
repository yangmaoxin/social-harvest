#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLAN_BY_SCOPE = {
  douyin: 'tasks/daily-douyin.json',
  'weixin-channels': 'tasks/daily-weixin-channels.json',
  all: 'tasks/daily-all-platforms.json',
};

export function parseArgs(argv) {
  const options = {
    scope: '',
    runnerArgs: [],
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.runnerArgs.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.scope) options.scope = arg;
    else options.runnerArgs.push(arg);
  }
  return options;
}

export function buildTaskRunnerArgs(options = {}) {
  const scope = String(options.scope || '').trim();
  const plan = PLAN_BY_SCOPE[scope];
  if (!plan) throw new Error(`Unsupported daily full scope: ${scope || '(missing)'}`);
  return [
    path.join('scripts', 'task-runner.js'),
    'plan',
    '--display',
    'detailed',
    '--config',
    plan,
    ...(options.runnerArgs || []),
  ];
}

export function printHelp() {
  console.log(`Usage: node scripts/run-daily-full.js <douyin|weixin-channels|all> [-- task-runner args]

Runs the full calibration daily plan through task-runner with detailed display.
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
