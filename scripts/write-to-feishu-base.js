#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  attachAccountIdToPayload,
  resolveAccountIdFromRows,
  resolveAccountProfilePath,
  resolveImportAccountId,
} from './lib/account-context.js';
import { FeishuBaseApiClient } from './lib/feishu-base-api.js';
import { uploadDisplayAttachments } from './lib/feishu-base-attachments.js';
import {
  FEISHU_DATASET_NAMES,
  buildFeishuDisplayPlans,
  buildFeishuRows,
  getFeishuDataset,
  tableNameForDataset,
} from './lib/feishu-base-schema.js';
import {
  buildAccountMetricSnapshotPayload,
  buildWorkMetricSnapshotPayload,
  dedupeSnapshots,
  getMetricPlatform,
} from './lib/metric-delta.js';
import { loadHarvestRows, nowDatetimeText, resolveInputPath, ROOT_DIR } from './lib/scrm-base.js';
import { getMapper } from './lib/scrm-mappers.js';
import { feishuBaseConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import {
  buildPayload as buildAccountPayload,
  loadRows as loadAccountRows,
  resolveAccountInputPath,
} from './import-account-to-scrm.js';
import {
  buildPayload as buildDanmakuPayload,
  loadRows as loadDanmakuRows,
  resolveDanmakuInputPath,
  resolveDanmakuWorkIndexPath,
} from './import-danmaku-to-scrm.js';
import {
  buildPayload as buildMessagePayload,
  loadRows as loadMessageRows,
  resolveMessageInputPath,
} from './import-private-messages-to-scrm-message.js';

const DATASET_ALIASES = {
  all: 'all',
  work: 'works',
  works: 'works',
  comment: 'comments',
  comments: 'comments',
  danmaku: 'danmaku',
  message: 'messages',
  messages: 'messages',
  account: 'accounts',
  accounts: 'accounts',
  'metric-snapshot': 'metric_snapshots',
  'metric-snapshots': 'metric_snapshots',
  metric_snapshot: 'metric_snapshots',
  metric_snapshots: 'metric_snapshots',
  'metric-delta': 'metric_delta_events',
  'metric-deltas': 'metric_delta_events',
  'metric-delta-events': 'metric_delta_events',
  metric_delta_events: 'metric_delta_events',
};

function readJsonArray(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${filePath} did not contain a JSON array.`);
  return data;
}

function existingPath(...parts) {
  const filePath = path.resolve(...parts);
  return fs.existsSync(filePath) ? filePath : '';
}

function normalizeDatasetName(value = 'all') {
  const key = String(value || 'all').trim();
  const normalized = DATASET_ALIASES[key];
  if (!normalized) throw new Error(`Unsupported --dataset ${key}. Supported: all, ${FEISHU_DATASET_NAMES.join(', ')}`);
  return normalized;
}

export function parseArgs(argv) {
  const options = {
    platform: '',
    dataset: 'all',
    input: '',
    outputDir: '',
    date: '',
    scope: 'account',
    accountId: '',
    accountProfile: '',
    workIndexPath: '',
    limit: 0,
    apply: false,
    config: '',
    appId: '',
    appSecret: '',
    appToken: '',
    apiBaseUrl: '',
    tablePrefix: '',
    createBase: false,
    baseName: '',
    folderToken: '',
    skipIntention: false,
    displayTables: false,
    displayImages: true,
    refreshDisplayImages: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--platform') options.platform = argv[++i];
    else if (arg === '--dataset') options.dataset = argv[++i];
    else if (arg === '--input') options.input = argv[++i];
    else if (arg === '--output-dir') options.outputDir = argv[++i];
    else if (arg === '--date') options.date = argv[++i];
    else if (arg === '--scope') options.scope = argv[++i];
    else if (arg === '--account-id') options.accountId = argv[++i];
    else if (arg === '--account-profile') options.accountProfile = argv[++i];
    else if (arg === '--work-index') options.workIndexPath = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i] || 0);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--app-id') options.appId = argv[++i];
    else if (arg === '--app-secret') options.appSecret = argv[++i];
    else if (arg === '--app-token') options.appToken = argv[++i];
    else if (arg === '--api-base-url') options.apiBaseUrl = argv[++i];
    else if (arg === '--table-prefix') options.tablePrefix = argv[++i];
    else if (arg === '--create-base') options.createBase = true;
    else if (arg === '--base-name') options.baseName = argv[++i];
    else if (arg === '--folder-token') options.folderToken = argv[++i];
    else if (arg === '--skip-intention') options.skipIntention = true;
    else if (arg === '--display-tables') options.displayTables = true;
    else if (arg === '--skip-display-images') options.displayImages = false;
    else if (arg === '--refresh-display-images') options.refreshDisplayImages = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/write-to-feishu-base.js --platform <platform> [options]

Options:
  --platform NAME          weixin-channels or douyin
  --dataset NAME           all, works, comments, danmaku, messages, accounts,
                           metric-snapshots, metric-delta-events; default all
  --output-dir PATH        Read standard artifacts from one task output directory
  --input PATH             Explicit JSON input for the selected dataset
  --date YYYY-MM-DD        Use samples/<platform>/<date>/... when --input is omitted
  --scope NAME             Metric snapshot scope: account or work; default account
  --account-id VALUE       Stable platform account_id for content/message/danmaku rows
  --account-profile PATH   Explicit account-profile.json path
  --work-index PATH        Weixin danmaku work-index.json path
  --limit N                Only write the first N source rows after normalization
  --skip-intention         Skip AI intention analysis for comments, danmaku, and messages
  --apply                  Write to Feishu Base. Default is dry-run preview only.
  --app-id ID              Feishu app_id. Defaults to config/env.
  --app-secret SECRET      Feishu app_secret. Defaults to config/env.
  --app-token TOKEN        Feishu Bitable app_token. Defaults to config/env.
  --api-base-url URL       Feishu OpenAPI base URL, default https://open.feishu.cn/open-apis
  --create-base            Create a new Base when app_token is missing.
  --base-name NAME         Name for --create-base; default from config or Social Harvest 写入
  --folder-token TOKEN     Optional Feishu folder token for --create-base
  --table-prefix NAME      Table prefix, default harvest
  --display-tables         Also write human-readable monthly display tables,
                           split by platform and month.
  --skip-display-images    Keep display table image URL fields only; do not upload
                           cover/avatar images into Feishu attachment fields.
  --refresh-display-images Re-download and re-upload display table images even
                           when attachment cells already have files.
  --config PATH            Config file, default config.local.json
`);
}

function resolveContentInputPath(options) {
  if (options.input) return path.resolve(options.input);
  if (options.outputDir) {
    const outputDir = path.resolve(options.outputDir);
    return existingPath(outputDir, 'harvest.json')
      || existingPath(outputDir, 'creator-harvest.json')
      || existingPath(outputDir, 'works.json');
  }
  return resolveInputPath(ROOT_DIR, options.platform, '', options.date);
}

async function buildContentDatasets(options) {
  const mapper = getMapper(options.platform);
  const inputPath = resolveContentInputPath(options);
  const harvestRows = loadHarvestRows(inputPath);
  let payload = await mapper.buildPayload(harvestRows, {
    limit: options.limit,
    classifier: options.skipIntention ? null : undefined,
  });
  try {
    const accountIdFromRows = options.platform === 'douyin'
      ? resolveAccountIdFromRows(harvestRows, ['account_id', 'unique_id'])
      : '';
    const accountProfilePath = resolveAccountProfilePath({
      platform: options.platform,
      inputPath,
      date: options.date,
      accountProfile: options.accountProfile,
    });
    const accountId = resolveImportAccountId({
      platform: options.platform,
      explicitAccountId: options.accountId,
      rowAccountId: accountIdFromRows,
      accountProfilePath,
      errorPrefix: `Could not resolve account_id for ${options.platform} Feishu content import`,
    });
    payload = attachAccountIdToPayload(payload, accountId);
  } catch (error) {
    payload.warnings = [...(payload.warnings || []), error instanceof Error ? error.message : String(error)];
  }
  return [
    { dataset: 'works', inputPath, rows: payload.works || [], warnings: payload.warnings || [] },
    { dataset: 'comments', inputPath, rows: payload.comments || [], warnings: payload.warnings || [] },
  ];
}

async function buildAccountDataset(options) {
  const inputPath = options.input
    ? path.resolve(options.input)
    : options.outputDir
      ? existingPath(options.outputDir, 'account-profile.json')
      : resolveAccountInputPath('', options.date, options.platform);
  if (!inputPath) return null;
  const rows = loadAccountRows(inputPath);
  const payload = await buildAccountPayload(rows, { limit: options.limit, platform: options.platform });
  return { dataset: 'accounts', inputPath, rows: payload.records || [], warnings: payload.warnings || [] };
}

async function buildDanmakuDataset(options) {
  const inputPath = options.input
    ? path.resolve(options.input)
    : options.outputDir
      ? (existingPath(options.outputDir, 'danmaku-flat.json') || existingPath(options.outputDir, 'creator-harvest.json'))
      : resolveDanmakuInputPath('', options.date, options.platform);
  if (!inputPath) return null;
  const rows = loadDanmakuRows(inputPath);
  let payload = await buildDanmakuPayload(rows, {
    limit: options.limit,
    platform: options.platform,
    skipIntention: options.skipIntention,
    workIndexPath: options.workIndexPath || resolveDanmakuWorkIndexPath(inputPath),
  });
  try {
    const accountProfilePath = resolveAccountProfilePath({
      platform: options.platform,
      inputPath,
      date: options.date,
      accountProfile: options.accountProfile,
    });
    const accountId = resolveImportAccountId({
      platform: options.platform,
      explicitAccountId: options.accountId,
      accountProfilePath,
      errorPrefix: `Could not resolve account_id for ${options.platform} Feishu danmaku import`,
    });
    payload = attachAccountIdToPayload(payload, accountId);
  } catch (error) {
    payload.warnings = [...(payload.warnings || []), error instanceof Error ? error.message : String(error)];
  }
  return { dataset: 'danmaku', inputPath, rows: payload.records || [], warnings: payload.warnings || [] };
}

async function buildMessagesDataset(options) {
  const inputPath = options.input
    ? path.resolve(options.input)
    : options.outputDir
      ? existingPath(options.outputDir, 'private-messages-flat.json')
      : resolveMessageInputPath('', options.date, options.platform);
  if (!inputPath) return null;
  const rows = loadMessageRows(inputPath);
  let payload = await buildMessagePayload(rows, {
    limit: options.limit,
    platform: options.platform,
    classifier: options.skipIntention ? null : undefined,
  });
  try {
    const accountProfilePath = resolveAccountProfilePath({
      platform: options.platform,
      inputPath,
      date: options.date,
      accountProfile: options.accountProfile,
    });
    const accountId = resolveImportAccountId({
      platform: options.platform,
      explicitAccountId: options.accountId,
      accountProfilePath,
      errorPrefix: `Could not resolve account_id for ${options.platform} Feishu message import`,
    });
    payload = attachAccountIdToPayload(payload, accountId);
  } catch (error) {
    payload.warnings = [...(payload.warnings || []), error instanceof Error ? error.message : String(error)];
  }
  return { dataset: 'messages', inputPath, rows: payload.records || [], warnings: payload.warnings || [] };
}

function metricSnapshotInputPath(options, scope) {
  if (options.input) return path.resolve(options.input);
  if (options.outputDir) {
    const outputDir = path.resolve(options.outputDir);
    return scope === 'account'
      ? existingPath(outputDir, 'account-profile.json')
      : existingPath(outputDir, options.platform === 'weixin-channels' ? 'works.json' : 'creator-harvest.json');
  }
  if (scope === 'account') return resolveInputPath(ROOT_DIR, options.platform, '', options.date, 'account-profile.json');
  return resolveInputPath(ROOT_DIR, options.platform, '', options.date, options.platform === 'weixin-channels' ? 'works.json' : 'creator-harvest.json');
}

function buildMetricSnapshotDataset(options, scope = options.scope) {
  const inputPath = metricSnapshotInputPath(options, scope);
  if (!inputPath) return null;
  const rows = readJsonArray(inputPath);
  const buildPayload = scope === 'work' ? buildWorkMetricSnapshotPayload : buildAccountMetricSnapshotPayload;
  const payload = buildPayload(rows, {
    platform: options.platform,
    limit: options.limit,
    capturedAt: options.capturedAt,
  });
  return {
    dataset: 'metric_snapshots',
    inputPath,
    rows: dedupeSnapshots(payload.snapshots || []),
    warnings: payload.warnings || [],
  };
}

function buildMetricDeltaDataset(options) {
  const inputPath = options.input
    ? path.resolve(options.input)
    : options.outputDir
      ? existingPath(options.outputDir, 'metric-delta-events.json')
      : '';
  if (!inputPath) return null;
  return {
    dataset: 'metric_delta_events',
    inputPath,
    rows: readJsonArray(inputPath),
    warnings: [],
  };
}

export async function loadDatasets(options) {
  const dataset = normalizeDatasetName(options.dataset);
  if (!options.platform) throw new Error('--platform is required');
  getMetricPlatform(options.platform);

  if (dataset === 'works' || dataset === 'comments') {
    return (await buildContentDatasets(options)).filter((item) => item.dataset === dataset);
  }
  if (dataset === 'accounts') return [await buildAccountDataset(options)].filter(Boolean);
  if (dataset === 'danmaku') return [await buildDanmakuDataset(options)].filter(Boolean);
  if (dataset === 'messages') return [await buildMessagesDataset(options)].filter(Boolean);
  if (dataset === 'metric_snapshots') return [buildMetricSnapshotDataset(options)].filter(Boolean);
  if (dataset === 'metric_delta_events') return [buildMetricDeltaDataset(options)].filter(Boolean);

  const contentDatasets = await buildContentDatasets(options);
  const candidates = [
    ...contentDatasets,
    await buildAccountDataset(options),
    await buildDanmakuDataset(options),
    await buildMessagesDataset(options),
    buildMetricSnapshotDataset({ ...options, input: '' }, 'account'),
    buildMetricSnapshotDataset({ ...options, input: '' }, 'work'),
    buildMetricDeltaDataset(options),
  ];
  return candidates.filter(Boolean);
}

export function buildWritePlan(datasets, {
  platform,
  tablePrefix = 'harvest',
  writtenAt = nowDatetimeText(),
  displayTables = false,
} = {}) {
  const rawPlan = datasets.map((item) => ({
    dataset: item.dataset,
    table_name: tableNameForDataset(item.dataset, tablePrefix),
    input: item.inputPath,
    source_rows: item.rows.length,
    rows: buildFeishuRows(item.dataset, item.rows, { platform, importedAt: writtenAt }),
    field_count: getFeishuDataset(item.dataset).fields.length,
    warnings: item.warnings || [],
  }));
  if (!displayTables) return rawPlan;
  return [
    ...rawPlan,
    ...buildFeishuDisplayPlans(datasets, {
      platform,
      tablePrefix,
      importedAt: writtenAt,
    }),
  ];
}

export async function applyWritePlan(plan, {
  appId,
  appSecret,
  appToken,
  apiBaseUrl,
  tablePrefix = 'harvest',
  createBase = false,
  baseName = 'Social Harvest 写入',
  folderToken = '',
  client = null,
  displayImages = true,
  refreshDisplayImages = false,
  attachmentTempDir = '',
} = {}) {
  const feishu = client || new FeishuBaseApiClient({ appId, appSecret, appToken, apiBaseUrl });
  let createdBase = null;
  if (!feishu.appToken && createBase) {
    createdBase = await feishu.createBase(baseName, { folderToken });
    feishu.appToken = createdBase.app_token;
  }
  const results = [];
  for (const item of plan) {
    const dataset = getFeishuDataset(item.dataset);
    const table = await feishu.ensureTable(item.table_name || tableNameForDataset(item.dataset, tablePrefix));
    const fieldSpecs = item.fields || dataset.fields;
    const fields = await feishu.ensureFields(table.tableId || table.table_name, fieldSpecs);
    const views = item.views?.length ? await feishu.ensureViews(table.tableId || table.table_name, item.views) : null;
    const write = await feishu.upsertRows(table.tableId || table.table_name, item.rows);
    const orphanRecordIds = item.dataset?.startsWith('display_')
      ? await feishu.listRecordsMissingSourceKey(table.tableId || table.table_name)
      : [];
    if (orphanRecordIds.length) await feishu.deleteRecords(table.tableId || table.table_name, orphanRecordIds);
    const attachmentResult = displayImages && item.attachments?.length
      ? await uploadDisplayAttachments(feishu, table.tableId || table.table_name, item.attachments, {
        tempDir: attachmentTempDir || path.join(os.tmpdir(), 'social-harvest-feishu-attachments'),
        refresh: refreshDisplayImages,
      })
      : null;
    results.push({
      dataset: item.dataset,
      table_name: item.table_name,
      table_id: table.tableId,
      table_created: table.created,
      fields_created: fields.created,
      views_created: views?.created || [],
      views_configured: views?.configured || [],
      view_warnings: views?.warnings || [],
      orphan_records_deleted: orphanRecordIds.length,
      source_rows: item.source_rows,
      write_attempt_rows: item.rows.length,
      attachment_attempt_rows: attachmentResult?.attempted || 0,
      attachment_uploaded_rows: attachmentResult?.uploaded || 0,
      attachment_skipped_existing_rows: attachmentResult?.skipped_existing || 0,
      attachment_failed_rows: attachmentResult?.failed || 0,
      attachment_warnings: attachmentResult?.warnings || [],
      ...write,
    });
  }
  return { app_token: feishu.appToken, created_base: createdBase, results };
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const settings = feishuBaseConfigFromSettings();
  const effective = {
    ...options,
    appId: options.appId || settings.appId,
    appSecret: options.appSecret || settings.appSecret,
    appToken: options.appToken || settings.appToken,
    apiBaseUrl: options.apiBaseUrl || settings.apiBaseUrl,
    tablePrefix: options.tablePrefix || settings.tablePrefix || 'harvest',
    baseName: options.baseName || settings.baseName || 'Social Harvest 写入',
  };
  const datasets = await loadDatasets(effective);
  const plan = buildWritePlan(datasets, {
    platform: effective.platform,
    tablePrefix: effective.tablePrefix,
    displayTables: effective.displayTables,
  });
  const summary = {
    platform: effective.platform,
    mode: effective.apply ? 'apply' : 'dry-run',
    api_configured: Boolean(effective.appId && effective.appSecret),
    app_token_configured: Boolean(effective.appToken),
    create_base: Boolean(effective.createBase),
    base_name: effective.createBase ? effective.baseName : '',
    table_prefix: effective.tablePrefix,
    display_tables: Boolean(effective.displayTables),
    display_images: Boolean(effective.displayTables && effective.displayImages),
    refresh_display_images: Boolean(effective.refreshDisplayImages),
    datasets: plan.map((item) => ({
      dataset: item.dataset,
      table_name: item.table_name,
      input: item.input,
      source_rows: item.source_rows,
      write_attempt_rows: item.rows.length,
      field_count: item.field_count,
      attachment_count: item.attachments?.length || 0,
      warnings: item.warnings,
      row_example: item.rows[0] || null,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`FEISHU_BASE_WRITE_PLAN ${JSON.stringify(summary)}`);
  if (!effective.apply) {
    console.log('Dry-run only. Re-run with --apply to write into Feishu Base.');
    return { summary, applied: false };
  }
  if (!effective.appToken && !effective.createBase) {
    throw new Error('Missing Feishu app_token. Set HARVEST_FEISHU_APP_TOKEN, sinks.feishu.app_token, --app-token, or pass --create-base.');
  }
  if (!effective.appId || !effective.appSecret) {
    throw new Error('Missing Feishu API credentials. Set HARVEST_FEISHU_APP_ID and HARVEST_FEISHU_APP_SECRET, or sinks.feishu.app_id/app_secret.');
  }
  const results = await applyWritePlan(plan, effective);
  const applied = {
    platform: effective.platform,
    mode: 'apply',
    app_token: results.app_token,
    created_base: results.created_base,
    table_prefix: effective.tablePrefix,
    results: results.results,
  };
  console.log(JSON.stringify(applied, null, 2));
  console.log(`FEISHU_BASE_WRITE_APPLIED ${JSON.stringify(applied)}`);
  console.log('Feishu Base write applied successfully.');
  return { summary, applied };
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
