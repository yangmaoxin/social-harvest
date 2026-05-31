#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  console.log(`Usage: node scripts/import-douyin-content-to-scrm.js [options]

Options:
  --input PATH          Import harvest.json or creator-harvest.json
  --date YYYY-MM-DD     Use samples/douyin/<date>/harvest.json for public content
  --front-input PATH    Existing public-profile harvest.json for creator merge
  --front-date DATE     Use samples/douyin/<date>/harvest.json for creator merge
  --limit N             Only process the first N works
  --apply               Write to MySQL. Default is dry-run preview only.
  --config PATH         Config file, default config.local.json
  --host HOST           MySQL host override
  --user USER           MySQL user override
  --password PASS       MySQL password override
  --database DB         MySQL database override

This command is the stable Douyin content-import runner entry.
It dispatches public harvest.json to the public importer, and creator-harvest.json
to the creator work/comment importers.
`);
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || '' : '';
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function withoutPlatformArg(argv) {
  const next = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      index += 1;
      continue;
    }
    next.push(arg);
  }
  return next;
}

function creatorArgs(argv) {
  const allowedValueArgs = new Set([
    '--input',
    '--date',
    '--front-input',
    '--front-date',
    '--output-dir',
    '--limit',
    '--config',
    '--host',
    '--user',
    '--password',
    '--database',
  ]);
  const allowedFlags = new Set(['--apply', '--account-bound']);
  const next = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      index += 1;
      continue;
    }
    if (allowedValueArgs.has(arg)) {
      next.push(arg, argv[++index] || '');
      continue;
    }
    if (allowedFlags.has(arg)) {
      next.push(arg);
      continue;
    }
    if (arg === '--supplement-public-ip') continue;
    throw new Error(`Unknown argument for Douyin creator content import: ${arg}`);
  }
  if (!hasFlag(next, '--account-bound')) next.push('--account-bound');
  return next;
}

function commentArgs(argv) {
  const next = creatorArgs(argv);
  if (hasFlag(argv, '--supplement-public-ip')) next.push('--supplement-public-ip');
  return next;
}

function runNodeScript(script, args) {
  const result = spawnSync(process.execPath, [path.join(ROOT_DIR, script), ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}

function isCreatorInput(argv) {
  const input = optionValue(argv, '--input');
  if (input) return path.basename(input) === 'creator-harvest.json';
  return hasFlag(argv, '--creator');
}

function main(argv) {
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    printHelp();
    return;
  }
  if (!isCreatorInput(argv)) {
    runNodeScript('scripts/import-to-scrm.js', ['--platform', 'douyin', ...withoutPlatformArg(argv)]);
    return;
  }
  runNodeScript('scripts/import-douyin-main-table-file-to-scrm.js', creatorArgs(argv));
  runNodeScript('scripts/import-douyin-main-table-comment-to-scrm.js', commentArgs(argv));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
