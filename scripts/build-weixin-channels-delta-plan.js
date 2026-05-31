#!/usr/bin/env node
import path from 'node:path';

import {
  buildWeixinChannelsDeltaPlan,
  loadJsonArray,
  loadWeixinChannelsDbBaseline,
  normalizeWeixinWork,
  writeDeltaPlan,
} from './lib/weixin-channels-delta.js';
import { dbConfigFromSettings, setConfigPath } from './lib/runtime-config.js';

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function parseArgs(argv) {
  const options = {
    works: '',
    output: '',
    recentRecheckDays: 3,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--works') options.works = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--recent-recheck-days') options.recentRecheckDays = parseNonNegativeInt(argv[++i], 3);
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/build-weixin-channels-delta-plan.js --works <works.json> [options]

Options:
  --works PATH               Metadata-only works.json from weixin-channels
  --output PATH              Output delta plan path, default beside works.json
  --recent-recheck-days N    Re-fetch recent works even without count increase, default 3
  --config PATH              Config file, default config.local.json
  --host HOST                MySQL host override
  --user USER                MySQL user override
  --password PASSWORD        MySQL password override
  --database DB              MySQL database override
`);
}

export async function run(options) {
  if (!options.works) throw new Error('--works is required');
  if (options.config) setConfigPath(options.config);

  const worksPath = path.resolve(options.works);
  const outputPath = path.resolve(options.output || path.join(path.dirname(worksPath), 'delta-plan.json'));
  const works = loadJsonArray(worksPath, worksPath).map(normalizeWeixinWork);
  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };

  const baselineByWorkId = await loadWeixinChannelsDbBaseline(dbConfig, works);
  const plan = buildWeixinChannelsDeltaPlan({
    works,
    baselineByWorkId,
    recentRecheckDays: options.recentRecheckDays,
    now: new Date(),
  });
  writeDeltaPlan(outputPath, plan);

  const summary = {
    input: worksPath,
    output: outputPath,
    baseline_source: plan.baseline_source,
    recent_recheck_days: plan.recent_recheck_days,
    works: plan.totals.works,
    changed_works: plan.totals.changed_works,
    comment_works: plan.totals.comment_works,
    danmaku_works: plan.totals.danmaku_works,
    unchanged_works: plan.totals.unchanged_works,
    reason_counts: plan.changed_works.reduce((counts, work) => {
      for (const reason of work.reasons) counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {}),
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`WEIXIN_CHANNELS_DELTA_PLAN ${JSON.stringify(summary)}`);
  return { plan, outputPath, summary };
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
