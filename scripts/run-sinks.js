#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT_DIR } from './lib/runtime-config.js';

const VALUE_FLAGS = new Set([
  '--app-id',
  '--app-secret',
  '--app-token',
  '--api-base-url',
  '--account-id',
  '--account-profile',
  '--base-name',
  '--config',
  '--database',
  '--folder-token',
  '--host',
  '--password',
  '--table-prefix',
  '--user',
  '--work-index',
]);

const BOOLEAN_FLAGS = new Set([
  '--create-base',
  '--display-tables',
  '--refresh-display-images',
  '--skip-display-images',
  '--skip-intention',
]);

const DATASET_ALIASES = {
  all: ['all'],
  account: ['accounts'],
  accounts: ['accounts'],
  content: ['content'],
  work: ['works'],
  works: ['works'],
  comment: ['comments'],
  comments: ['comments'],
  danmaku: ['danmaku'],
  message: ['messages'],
  messages: ['messages'],
  'metric-snapshot': ['metric_snapshot_account', 'metric_snapshot_work'],
  'metric-snapshots': ['metric_snapshot_account', 'metric_snapshot_work'],
  metric_snapshot: ['metric_snapshot_account', 'metric_snapshot_work'],
  metric_snapshots: ['metric_snapshot_account', 'metric_snapshot_work'],
  'metric-delta': ['metric_delta_account', 'metric_delta_work'],
  'metric-deltas': ['metric_delta_account', 'metric_delta_work'],
  'metric-delta-events': ['metric_delta_account', 'metric_delta_work'],
  metric_delta_events: ['metric_delta_account', 'metric_delta_work'],
  metric_snapshot_account: ['metric_snapshot_account'],
  metric_snapshot_work: ['metric_snapshot_work'],
  metric_delta_account: ['metric_delta_account'],
  metric_delta_work: ['metric_delta_work'],
};

const FEISHU_DATASET_ALIASES = {
  all: ['all'],
  accounts: ['accounts'],
  content: ['works', 'comments'],
  works: ['works'],
  comments: ['comments'],
  danmaku: ['danmaku'],
  messages: ['messages'],
  metric_snapshot_account: ['metric_snapshots'],
  metric_snapshot_work: ['metric_snapshots'],
  metric_delta_account: ['metric_delta_events'],
  metric_delta_work: ['metric_delta_events'],
};

function splitCommaValues(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeDatasets(values = []) {
  const requested = values.length ? values : ['all'];
  const datasets = [];
  for (const value of requested) {
    const aliases = DATASET_ALIASES[String(value || '').trim()];
    if (!aliases) throw new Error(`Unsupported --dataset ${value}`);
    datasets.push(...aliases);
  }
  return unique(datasets);
}

function existingPath(...parts) {
  const filePath = path.resolve(...parts);
  return fs.existsSync(filePath) ? filePath : '';
}

function taggedJson(text = '', tag = '') {
  const prefix = `${tag} `;
  const line = String(text || '').split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return null;
  }
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT_DIR, script), ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error) throw result.error;
  if (result.status) {
    throw new Error((stderr || stdout || `Command failed: node ${script} ${args.join(' ')}`).trim());
  }
  return { stdout, stderr, code: result.status || 0 };
}

function sinkSpecificArgs(args = [], names = []) {
  const nameSet = new Set(names);
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1] || '';
      if (nameSet.has(arg)) output.push(arg, value);
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg) && nameSet.has(arg)) output.push(arg);
  }
  return output;
}

export function parseArgs(argv) {
  const options = {
    platform: '',
    outputDir: '',
    sinks: [],
    datasets: [],
    sinkApply: false,
    sourceRunId: '',
    sinkArgs: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') options.platform = argv[++index] || '';
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index] || '');
    else if (arg === '--sink') options.sinks.push(...splitCommaValues(argv[++index] || ''));
    else if (arg === '--dataset') options.datasets.push(...splitCommaValues(argv[++index] || ''));
    else if (arg === '--sink-apply' || arg === '--apply') options.sinkApply = true;
    else if (arg === '--source-run-id') options.sourceRunId = argv[++index] || '';
    else if (VALUE_FLAGS.has(arg)) options.sinkArgs.push(arg, argv[++index] || '');
    else if (BOOLEAN_FLAGS.has(arg)) options.sinkArgs.push(arg);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.sinks = unique(options.sinks);
  options.datasets = normalizeDatasets(options.datasets);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/run-sinks.js --platform <platform> --output-dir <dir> --sink <sink> [options]

Options:
  --sink NAME              Destination sink. Repeatable or comma-separated.
  --dataset NAME           Dataset to write. Repeatable or comma-separated, default all.
  --sink-apply             Write selected sinks. Default is dry-run.
  --source-run-id ID       Stable run id for metric snapshots.
  --config PATH            Config file for sink writers.
  --host/--user/--password/--database
                           SCRM MySQL overrides.
  --app-id/--app-secret/--app-token
                           Feishu API overrides.
  --display-tables         Also write Feishu display tables.
`);
}

function scrmDbArgs(sinkArgs = []) {
  return sinkSpecificArgs(sinkArgs, ['--config', '--host', '--user', '--password', '--database']);
}

function feishuArgs(sinkArgs = []) {
  return sinkSpecificArgs(sinkArgs, [
    '--app-id',
    '--app-secret',
    '--app-token',
    '--api-base-url',
    '--account-id',
    '--account-profile',
    '--base-name',
    '--config',
    '--create-base',
    '--display-tables',
    '--folder-token',
    '--refresh-display-images',
    '--skip-display-images',
    '--skip-intention',
    '--table-prefix',
    '--work-index',
  ]);
}

function contentInputPath(platform, outputDir) {
  if (platform === 'douyin') {
    return existingPath(outputDir, 'creator-harvest.json') || existingPath(outputDir, 'harvest.json');
  }
  return existingPath(outputDir, 'harvest.json') || existingPath(outputDir, 'works.json');
}

function workMetricInputPath(platform, outputDir) {
  return platform === 'douyin'
    ? existingPath(outputDir, 'creator-harvest.json')
    : existingPath(outputDir, 'works.json');
}

function accountProfileArg(outputDir, sinkArgs = []) {
  const accountProfile = existingPath(outputDir, 'account-profile.json');
  if (accountProfile) return ['--account-profile', accountProfile];
  const fromArgs = sinkSpecificArgs(sinkArgs, ['--account-profile']);
  return fromArgs.length ? fromArgs.slice(0, 2) : [];
}

function matchesDataset(commandDataset, requestedDatasets = ['all']) {
  if (requestedDatasets.includes('all') || requestedDatasets.includes(commandDataset)) return true;
  if (commandDataset === 'content') {
    return requestedDatasets.includes('works') || requestedDatasets.includes('comments');
  }
  return false;
}

export function scrmImportCommands({ platform, outputDir, apply, sourceRunId, sinkArgs, datasets = ['all'] }) {
  const commands = [];
  const dbArgs = scrmDbArgs(sinkArgs);
  const applyArgs = apply ? ['--apply'] : [];
  const accountPath = existingPath(outputDir, 'account-profile.json');
  const contentPath = contentInputPath(platform, outputDir);
  const danmakuPath = existingPath(outputDir, 'danmaku-flat.json')
    || (platform === 'douyin' ? existingPath(outputDir, 'creator-harvest.json') : '');
  const messagePath = existingPath(outputDir, 'private-messages-flat.json');
  const workMetricPath = workMetricInputPath(platform, outputDir);

  if (accountPath) {
    commands.push({
      dataset: 'accounts',
      script: 'scripts/import-account-to-scrm.js',
      args: ['--platform', platform, '--input', accountPath, ...applyArgs, ...dbArgs],
      summaryTags: ['IMPORT_SUMMARY', 'IMPORT_VERIFICATION'],
    });
  }

  if (contentPath) {
    commands.push({
      dataset: 'content',
      script: platform === 'douyin' ? 'scripts/import-douyin-content-to-scrm.js' : 'scripts/import-to-scrm.js',
      args: [
        ...(platform === 'douyin' ? [] : ['--platform', platform]),
        '--input',
        contentPath,
        ...accountProfileArg(outputDir, sinkArgs),
        ...applyArgs,
        ...dbArgs,
      ],
      summaryTags: ['IMPORT_SUMMARY', 'IMPORT_VERIFICATION'],
    });
  }

  if (danmakuPath) {
    commands.push({
      dataset: 'danmaku',
      script: 'scripts/import-danmaku-to-scrm.js',
      args: ['--platform', platform, '--input', danmakuPath, ...accountProfileArg(outputDir, sinkArgs), ...applyArgs, ...dbArgs],
      summaryTags: ['IMPORT_SUMMARY', 'IMPORT_VERIFICATION'],
    });
  }

  if (messagePath) {
    commands.push({
      dataset: 'messages',
      script: 'scripts/import-private-messages-to-scrm-message.js',
      args: ['--platform', platform, '--input', messagePath, ...accountProfileArg(outputDir, sinkArgs), ...applyArgs, ...dbArgs],
      summaryTags: ['IMPORT_SUMMARY', 'IMPORT_VERIFICATION'],
    });
  }

  if (accountPath) {
    const accountRunId = `${sourceRunId}:metric-snapshot-account`;
    commands.push({
      dataset: 'metric_snapshot_account',
      script: 'scripts/import-metric-snapshot-to-scrm.js',
      args: [
        '--platform',
        platform,
        '--scope',
        'account',
        '--input',
        accountPath,
        '--source-run-id',
        accountRunId,
        ...applyArgs,
        ...dbArgs,
      ],
      summaryTags: ['METRIC_SNAPSHOT_SUMMARY', 'METRIC_SNAPSHOT_APPLIED'],
    });
    if (apply) {
      commands.push({
        dataset: 'metric_delta_account',
        script: 'scripts/generate-metric-delta-events.js',
        args: ['--platform', platform, '--scope', 'account', '--to-source-run-id', accountRunId, '--apply', ...dbArgs],
        summaryTags: ['METRIC_DELTA_SUMMARY', 'METRIC_DELTA_APPLIED'],
      });
    }
  }

  if (workMetricPath) {
    const workRunId = `${sourceRunId}:metric-snapshot-work`;
    commands.push({
      dataset: 'metric_snapshot_work',
      script: 'scripts/import-metric-snapshot-to-scrm.js',
      args: [
        '--platform',
        platform,
        '--scope',
        'work',
        '--input',
        workMetricPath,
        '--source-run-id',
        workRunId,
        ...applyArgs,
        ...dbArgs,
      ],
      summaryTags: ['METRIC_SNAPSHOT_SUMMARY', 'METRIC_SNAPSHOT_APPLIED'],
    });
    if (apply) {
      commands.push({
        dataset: 'metric_delta_work',
        script: 'scripts/generate-metric-delta-events.js',
        args: ['--platform', platform, '--scope', 'work', '--to-source-run-id', workRunId, '--apply', ...dbArgs],
        summaryTags: ['METRIC_DELTA_SUMMARY', 'METRIC_DELTA_APPLIED'],
      });
    }
  }

  return commands.filter((command) => matchesDataset(command.dataset, datasets));
}

async function runScrmSink(options) {
  const sourceRunId = options.sourceRunId || `sink:${options.platform}:${path.basename(options.outputDir)}`;
  const commands = scrmImportCommands({
    platform: options.platform,
    outputDir: options.outputDir,
    apply: options.sinkApply,
    sourceRunId,
    sinkArgs: options.sinkArgs,
    datasets: options.datasets,
  });
  const results = [];
  for (const command of commands) {
    const result = runNodeScript(command.script, command.args);
    const tagged = {};
    for (const tag of command.summaryTags || []) tagged[tag] = taggedJson(result.stdout, tag);
    results.push({
      sink: 'scrm',
      dataset: command.dataset,
      script: command.script,
      mode: options.sinkApply ? 'apply' : 'dry-run',
      tagged,
    });
  }
  return {
    sink: 'scrm',
    mode: options.sinkApply ? 'apply' : 'dry-run',
    command_count: commands.length,
    source_run_id: sourceRunId,
    results,
  };
}

async function runFeishuSink(options) {
  const datasets = options.datasets.includes('all')
    ? ['all']
    : unique(options.datasets.flatMap((dataset) => FEISHU_DATASET_ALIASES[dataset] || []));
  const results = [];
  for (const dataset of datasets) {
    const args = [
      '--platform',
      options.platform,
      '--dataset',
      dataset,
      '--output-dir',
      options.outputDir,
      ...feishuArgs(options.sinkArgs),
      ...(options.sinkApply ? ['--apply'] : []),
    ];
    const result = runNodeScript('scripts/write-to-feishu-base.js', args);
    results.push({
      dataset,
      tagged: {
        FEISHU_BASE_WRITE_PLAN: taggedJson(result.stdout, 'FEISHU_BASE_WRITE_PLAN'),
        FEISHU_BASE_WRITE_APPLIED: taggedJson(result.stdout, 'FEISHU_BASE_WRITE_APPLIED'),
      },
    });
  }
  return {
    sink: 'feishu',
    mode: options.sinkApply ? 'apply' : 'dry-run',
    results,
  };
}

export async function run(options) {
  if (!options.platform) throw new Error('--platform is required');
  if (!options.outputDir) throw new Error('--output-dir is required');
  if (!options.sinks.length) throw new Error('--sink is required');
  const results = [];
  if (options.sinks.includes('scrm')) results.push(await runScrmSink(options));
  if (options.sinks.includes('feishu')) results.push(await runFeishuSink(options));
  const summary = {
    platform: options.platform,
    output_dir: options.outputDir,
    mode: options.sinkApply ? 'apply' : 'dry-run',
    sinks: options.sinks,
    datasets: options.datasets,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`SINK_RUN_SUMMARY ${JSON.stringify(summary)}`);
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  await run(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
