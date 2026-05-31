#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const FIXED_CAPTURED_AT = '2026-05-12 10:00:00';

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function runNode(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }

  return result.stdout;
}

function summaryFromOutput(stdout, prefix) {
  const line = stdout.split(/\r?\n/).find((item) => item.startsWith(`${prefix} `));
  assertCondition(Boolean(line), `Missing ${prefix} in command output.`);
  return JSON.parse(line.slice(prefix.length + 1));
}

function metricPlatform(platform) {
  if (platform === 'douyin') return { originType: 2 };
  if (platform === 'weixin-channels') return { originType: 1 };
  throw new Error(`Unsupported smoke platform: ${platform}`);
}

function snapshot({
  id,
  platform,
  scope,
  targetId,
  capturedAt,
  fansCount = 0,
  likeCount = 0,
  shareCount = 0,
  collectCount = 0,
  commentCount = 0,
}) {
  return {
    id,
    origin_type: metricPlatform(platform).originType,
    target_scope: scope,
    target_id: targetId,
    captured_at: capturedAt,
    fans_count: fansCount,
    like_count: likeCount,
    share_count: shareCount,
    collect_count: collectCount,
    comment_count: commentCount,
  };
}

function writeSmokeFixtures(tempDir) {
  const fixtures = {
    douyinAccountInput: path.join(tempDir, 'douyin-account.json'),
    douyinWorkInput: path.join(tempDir, 'douyin-work.json'),
    weixinAccountInput: path.join(tempDir, 'weixin-account.json'),
    weixinWorkInput: path.join(tempDir, 'weixin-work.json'),
    douyinAccountSnapshots: path.join(tempDir, 'douyin-account-snapshots.json'),
    douyinWorkSnapshots: path.join(tempDir, 'douyin-work-snapshots.json'),
    weixinAccountSnapshots: path.join(tempDir, 'weixin-account-snapshots.json'),
    weixinWorkSnapshots: path.join(tempDir, 'weixin-work-snapshots.json'),
  };

  writeJson(fixtures.douyinAccountInput, [{
    account_id: 'metric-smoke-douyin-account',
    fans_count: 10,
    like_count: 3,
    following_count: 1,
    video_count: 2,
  }]);
  writeJson(fixtures.douyinWorkInput, [{
    aweme_id: 'metric-smoke-douyin-work',
    digg_count: 1,
    share_count: 2,
    collect_count: 3,
    comment_count: 4,
  }]);
  writeJson(fixtures.weixinAccountInput, [{
    account_id: 'metric-smoke-weixin-account',
    fans_count: 20,
    video_count: 5,
  }]);
  writeJson(fixtures.weixinWorkInput, [{
    object_id: 'metric-smoke-weixin-work',
    like_count: 5,
    share_count: 1,
    fav_count: 2,
    comment_count: 3,
  }]);

  writeJson(fixtures.douyinAccountSnapshots, [
    snapshot({ id: 1, platform: 'douyin', scope: 'account', targetId: 'metric-smoke-douyin-account', capturedAt: '2026-05-12 10:00:00', fansCount: 1, likeCount: 5 }),
    snapshot({ id: 2, platform: 'douyin', scope: 'account', targetId: 'metric-smoke-douyin-account', capturedAt: '2026-05-12 10:05:00', fansCount: 2, likeCount: 7 }),
  ]);
  writeJson(fixtures.douyinWorkSnapshots, [
    snapshot({ id: 3, platform: 'douyin', scope: 'work', targetId: 'metric-smoke-douyin-work', capturedAt: '2026-05-12 10:00:00', likeCount: 1, shareCount: 0 }),
    snapshot({ id: 4, platform: 'douyin', scope: 'work', targetId: 'metric-smoke-douyin-work', capturedAt: '2026-05-12 10:05:00', likeCount: 99, shareCount: 2 }),
  ]);
  writeJson(fixtures.weixinAccountSnapshots, [
    snapshot({ id: 5, platform: 'weixin-channels', scope: 'account', targetId: 'metric-smoke-weixin-account', capturedAt: '2026-05-12 10:00:00', fansCount: 10, likeCount: 100 }),
    snapshot({ id: 6, platform: 'weixin-channels', scope: 'account', targetId: 'metric-smoke-weixin-account', capturedAt: '2026-05-12 10:05:00', fansCount: 11, likeCount: 200 }),
  ]);
  writeJson(fixtures.weixinWorkSnapshots, [
    snapshot({ id: 7, platform: 'weixin-channels', scope: 'work', targetId: 'metric-smoke-weixin-work', capturedAt: '2026-05-12 10:00:00', likeCount: 1, shareCount: 0 }),
    snapshot({ id: 8, platform: 'weixin-channels', scope: 'work', targetId: 'metric-smoke-weixin-work', capturedAt: '2026-05-12 10:05:00', likeCount: 3, shareCount: 1 }),
  ]);

  return fixtures;
}

function smokeSnapshot({ platform, scope, input, expectedRows }) {
  const stdout = runNode(`metric snapshot ${platform}/${scope}`, [
    'scripts/import-metric-snapshot-to-scrm.js',
    '--platform',
    platform,
    '--scope',
    scope,
    '--input',
    input,
    '--captured-at',
    FIXED_CAPTURED_AT,
    '--source-run-id',
    `metric-smoke:${platform}:${scope}`,
    '--device-id',
    'metric-smoke',
  ]);
  const summary = summaryFromOutput(stdout, 'METRIC_SNAPSHOT_SUMMARY');
  assertCondition(summary.mode === 'dry-run', `Expected snapshot smoke to be dry-run for ${platform}/${scope}.`);
  assertCondition(summary.write_attempt_rows === expectedRows, `Unexpected snapshot rows for ${platform}/${scope}: ${summary.write_attempt_rows}`);
  assertCondition(!stdout.includes('METRIC_SNAPSHOT_APPLIED'), `Snapshot smoke unexpectedly applied rows for ${platform}/${scope}.`);
  return summary;
}

function smokeDelta({ platform, scope, input, expectedEvents }) {
  const stdout = runNode(`metric delta ${platform}/${scope}`, [
    'scripts/generate-metric-delta-events.js',
    '--platform',
    platform,
    '--scope',
    scope,
    '--input',
    input,
  ]);
  const summary = summaryFromOutput(stdout, 'METRIC_DELTA_SUMMARY');
  assertCondition(summary.mode === 'dry-run', `Expected delta smoke to be dry-run for ${platform}/${scope}.`);
  assertCondition(summary.event_rows === expectedEvents, `Unexpected delta rows for ${platform}/${scope}: ${summary.event_rows}`);
  assertCondition(!stdout.includes('METRIC_DELTA_APPLIED'), `Delta smoke unexpectedly applied rows for ${platform}/${scope}.`);
  return summary;
}

function runSmoke(options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'social-harvest-metric-smoke-'));
  try {
    const fixtures = writeSmokeFixtures(tempRoot);
    const snapshotSummaries = [
      smokeSnapshot({ platform: 'douyin', scope: 'account', input: fixtures.douyinAccountInput, expectedRows: 1 }),
      smokeSnapshot({ platform: 'douyin', scope: 'work', input: fixtures.douyinWorkInput, expectedRows: 1 }),
      smokeSnapshot({ platform: 'weixin-channels', scope: 'account', input: fixtures.weixinAccountInput, expectedRows: 1 }),
      smokeSnapshot({ platform: 'weixin-channels', scope: 'work', input: fixtures.weixinWorkInput, expectedRows: 1 }),
    ];
    const deltaSummaries = [
      smokeDelta({ platform: 'douyin', scope: 'account', input: fixtures.douyinAccountSnapshots, expectedEvents: 3 }),
      smokeDelta({ platform: 'douyin', scope: 'work', input: fixtures.douyinWorkSnapshots, expectedEvents: 2 }),
      smokeDelta({ platform: 'weixin-channels', scope: 'account', input: fixtures.weixinAccountSnapshots, expectedEvents: 1 }),
      smokeDelta({ platform: 'weixin-channels', scope: 'work', input: fixtures.weixinWorkSnapshots, expectedEvents: 3 }),
    ];

    const summary = {
      status: 'passed',
      mode: 'dry-run',
      database_writes: 0,
      snapshot_cases: snapshotSummaries.length,
      delta_cases: deltaSummaries.length,
      snapshot_rows: snapshotSummaries.reduce((sum, item) => sum + item.write_attempt_rows, 0),
      delta_events: deltaSummaries.reduce((sum, item) => sum + item.event_rows, 0),
    };
    console.log(JSON.stringify(summary, null, 2));
    console.log(`METRIC_SMOKE_SUMMARY ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    if (!options.keep) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { keep: false, help: false };
  for (const arg of argv) {
    if (arg === '--keep') options.keep = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/metric-smoke-test.js [options]

Options:
  --keep       Keep temporary fixture files for debugging
  --help, -h   Show this help
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exit(0);
    }
    runSmoke(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
