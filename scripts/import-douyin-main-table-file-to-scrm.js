#!/usr/bin/env node
import fs from 'node:fs';

import {
  attachAccountIdToPayload,
  resolveImportAccountId,
  resolveAccountProfilePath,
} from './lib/account-context.js';
import {
  applyImport as applyScrmImport,
  loadHarvestRows,
  resolveInputPath,
  ROOT_DIR,
  verifyImport as verifyScrmImport,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, scrmMediaConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import { buildMediaStartSummary, materializeScrmPayloadMedia } from './lib/scrm-media.js';
import {
  buildDouyinMainTableFilePreview,
  parseArgs as parsePreviewArgs,
  printHelp as printPreviewHelp,
} from './preview-douyin-main-table-merge.js';
import { normalizeCreatorRowsForScrmPreview } from './preview-douyin-creator-harvest-scrm.js';

function toJsonable(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(toJsonable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonable(item)]));
  }
  return value;
}

export function parseArgs(argv) {
  const options = parsePreviewArgs(argv);
  return {
    ...options,
    apply: argv.includes('--apply'),
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
  };
}

export function parseImportArgs(argv) {
  const options = {
    input: '',
    date: '',
    frontInput: '',
    frontDate: '',
    accountBound: false,
    outputDir: '',
    accountId: '',
    accountProfile: '',
    limit: 0,
    apply: false,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--date') options.date = argv[++index];
    else if (arg === '--front-input') options.frontInput = argv[++index];
    else if (arg === '--front-date') options.frontDate = argv[++index];
    else if (arg === '--account-bound') options.accountBound = true;
    else if (arg === '--account-id') options.accountId = argv[++index];
    else if (arg === '--account-profile') options.accountProfile = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--limit') options.limit = Number(argv[++index] || 0);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--config') options.config = argv[++index];
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--user') options.user = argv[++index];
    else if (arg === '--password') options.password = argv[++index];
    else if (arg === '--database') options.database = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/import-douyin-main-table-file-to-scrm.js [options]

Options:
  --input PATH       Absolute or relative path to creator-harvest.json
  --date YYYY-MM-DD  Use samples/douyin/<date>/creator-harvest.json
  --front-input PATH Existing public-profile harvest.json for merge
  --front-date DATE  Use samples/douyin/<date>/harvest.json as public-profile input
  --account-bound    Treat the current creator-center login as explicitly bound to the front account
  --account-id VALUE Explicit real platform account_id for this import, not config alias like main
  --account-profile PATH
                    Explicit account-profile.json path for this import
  --output-dir DIR   Output directory for preview artifacts
  --limit N          Only process the first N creator works
  --apply            Write merged scrm_file rows into MySQL. Default is dry-run preview only.
  --config PATH      Config file, default config.local.json
  --host HOST        MySQL host override
  --user USER        MySQL user override
  --password PASS    MySQL password override
  --database DB      MySQL database override

This command only writes merged Douyin self-account work rows into scrm_file.
It does not write comments or danmaku.
`);
}

export function buildMainTableFilePayload(preview = {}) {
  const works = Array.isArray(preview.works)
    ? preview.works
      .filter((item) => item?.action !== 'hold_until_account_guard_passes')
      .map((item) => item.merged_work)
      .filter(Boolean)
    : [];
  return {
    works,
    comments: [],
    warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
  };
}

function previewSummary(preview, payload, inputPath, frontInputPath, apply) {
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    input_file: inputPath,
    front_input_file: frontInputPath,
    status: preview.status,
    merge_scope: 'scrm_file_only',
    account_guard: preview.account_guard,
    counts: {
      creator_work_candidates: preview.counts?.creator_work_candidates ?? 0,
      front_work_candidates: preview.counts?.front_work_candidates ?? 0,
      merged_work_candidates: preview.counts?.merged_work_candidates ?? 0,
      held_work_candidates: preview.counts?.held_work_candidates ?? 0,
      matched_work_candidates: preview.counts?.matched_work_candidates ?? 0,
      conflicting_work_candidates: preview.counts?.conflicting_work_candidates ?? 0,
      write_attempt_work_rows: payload.works.length,
    },
    conflict_summary: preview.conflict_summary || [],
    field_resolution_policy: preview.field_resolution_policy || {},
    warnings: payload.warnings || [],
    work_example: payload.works[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`IMPORT_SUMMARY ${JSON.stringify(summary)}`);
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const inputPath = resolveInputPath(ROOT_DIR, 'douyin', options.input, options.date, 'creator-harvest.json');
  const frontInputPath = options.frontInput || options.frontDate
    ? resolveInputPath(ROOT_DIR, 'douyin', options.frontInput, options.frontDate, 'harvest.json')
    : '';
  const creatorRows = normalizeCreatorRowsForScrmPreview(loadHarvestRows(inputPath));
  const frontRows = frontInputPath ? loadHarvestRows(frontInputPath) : [];
  const preview = await buildDouyinMainTableFilePreview(creatorRows, frontRows, options);
  const accountProfilePath = resolveAccountProfilePath({
    platform: 'douyin',
    inputPath,
    date: options.date,
    accountProfile: options.accountProfile,
  });
  const accountId = resolveImportAccountId({
    platform: 'douyin',
    explicitAccountId: options.accountId,
    accountProfilePath,
    errorPrefix: 'Could not resolve account_id for douyin creator file import',
  });
  const payload = attachAccountIdToPayload(buildMainTableFilePayload(preview), accountId);

  previewSummary(preview, payload, inputPath, frontInputPath, options.apply);

  if (preview.status !== 'ready') {
    if (options.apply) throw new Error('Douyin main-table file merge is blocked by account guard.');
    console.log('Dry-run only. Re-run with --apply after account guard passes.');
    return { preview, payload };
  }
  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply to write merged scrm_file rows into MySQL.');
    return { preview, payload };
  }

  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };

  const mediaConfig = scrmMediaConfigFromSettings();
  console.log(`MEDIA_START ${JSON.stringify(buildMediaStartSummary('douyin', mediaConfig))}`);
  const mediaResult = await materializeScrmPayloadMedia(payload, {
    platform: 'douyin',
    mediaConfig,
  });
  console.log(`MEDIA_SUMMARY ${JSON.stringify(mediaResult.summary)}`);
  await applyScrmImport(dbConfig, payload);
  const verification = await verifyScrmImport(dbConfig, payload);
  const verificationSummary = toJsonable({
    verification: {
      database_total: {
        scrm_file: verification.database_file_total,
      },
      payload_rows: {
        works: verification.payload_work_rows,
      },
      write_attempt_rows: {
        works: verification.write_attempt_work_rows,
      },
      matched_current_payload_rows: {
        works: verification.matched_work_rows,
      },
      works: verification.works,
    },
  });
  console.log(JSON.stringify(verificationSummary, null, 2));
  console.log(`IMPORT_VERIFICATION ${JSON.stringify(verificationSummary)}`);
  console.log('Douyin main-table file import applied successfully.');
  return { preview, payload, verification };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseImportArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    run(options).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
