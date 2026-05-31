#!/usr/bin/env node
import {
  attachAccountIdToPayload,
  resolveImportAccountId,
  resolveAccountProfilePath,
} from './lib/account-context.js';
import {
  openConnection,
  resolveInputPath,
  ROOT_DIR,
  syncComments,
  verifyImport as verifyScrmImport,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, scrmMediaConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import { buildMediaStartSummary, materializeScrmPayloadMedia } from './lib/scrm-media.js';
import {
  buildDouyinMainTableCommentPreview,
} from './preview-douyin-main-table-comment-merge.js';
import { normalizeCreatorRowsForScrmPreview } from './preview-douyin-creator-harvest-scrm.js';
import { loadHarvestRows } from './lib/scrm-base.js';

function toJsonable(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(toJsonable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonable(item)]));
  }
  return value;
}

function textValue(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function parseImportArgs(argv) {
  const options = {
    input: '',
    date: '',
    frontInput: '',
    frontDate: '',
    accountBound: false,
    supplementPublicIp: false,
    accountId: '',
    accountProfile: '',
    outputDir: '',
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
    else if (arg === '--supplement-public-ip') options.supplementPublicIp = true;
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
  console.log(`Usage: node scripts/import-douyin-main-table-comment-to-scrm.js [options]

Options:
  --input PATH       Absolute or relative path to creator-harvest.json
  --date YYYY-MM-DD  Use samples/douyin/<date>/creator-harvest.json
  --front-input PATH Existing public-profile harvest.json for semantic IP supplement
  --front-date DATE  Use samples/douyin/<date>/harvest.json as public-profile input
  --account-bound    Treat the current creator-center login as explicitly bound to the front account
  --supplement-public-ip  Use semantic-matched public comments to fill creator-empty ip_location
  --account-id VALUE Explicit real platform account_id for this import, not config alias like main
  --account-profile PATH
                    Explicit account-profile.json path for this import
  --limit N          Only process the first N creator works
  --apply            Replace current Douyin scrm_comment rows for the affected works
  --config PATH      Config file, default config.local.json
  --host HOST        MySQL host override
  --user USER        MySQL user override
  --password PASS    MySQL password override
  --database DB      MySQL database override

This command writes Douyin self-account scrm_comment rows using creator-primary merge.
It replaces existing origin_type=2 rows for the affected works before inserting the merged set.
`);
}

export function buildMainTableCommentPayload(preview = {}) {
  const comments = Array.isArray(preview.merged_comments) ? preview.merged_comments : [];
  return {
    works: [],
    comments,
    warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
  };
}

function previewSummary(preview, payload, inputPath, frontInputPath, apply) {
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    input_file: inputPath,
    front_input_file: frontInputPath,
    status: preview.status,
    merge_scope: 'scrm_comment_only',
    account_guard: preview.account_guard,
    counts: {
      creator_comment_candidates: preview.counts?.creator_comment_candidates ?? 0,
      front_comment_candidates: preview.counts?.front_comment_candidates ?? 0,
      semantic_overlapping_comment_candidates: preview.counts?.semantic_overlapping_comment_candidates ?? 0,
      semantic_creator_only_comment_candidates: preview.counts?.semantic_creator_only_comment_candidates ?? 0,
      semantic_front_only_comment_candidates: preview.counts?.semantic_front_only_comment_candidates ?? 0,
      merged_comment_candidates: preview.counts?.merged_comment_candidates ?? payload.comments.length,
      write_attempt_comment_rows: payload.comments.length,
    },
    field_resolution_policy: preview.field_resolution_policy || {},
    identity_health: preview.identity_health || {},
    warnings: payload.warnings || [],
    comment_example: payload.comments[0] || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`IMPORT_SUMMARY ${JSON.stringify(summary)}`);
}

async function replaceCommentsForWorks(connection, originType, workNos = []) {
  const normalized = [...new Set(workNos.map(textValue).filter(Boolean))];
  if (!normalized.length) return 0;
  const placeholders = normalized.map(() => '?').join(',');
  const [result] = await connection.query(
    `DELETE FROM scrm_comment WHERE origin_type = ? AND no IN (${placeholders})`,
    [originType, ...normalized],
  );
  return Number(result?.affectedRows || 0);
}

export async function applyCommentImport(dbConfig, payload) {
  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  try {
    await connection.beginTransaction();
    const workNos = [...new Set((payload.comments || []).map((comment) => textValue(comment.no)).filter(Boolean))];
    const deletedRows = await replaceCommentsForWorks(connection, 2, workNos);
    await syncComments(connection, payload.comments || []);
    await connection.commit();
    return { deletedRows };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  const inputPath = resolveInputPath(ROOT_DIR, 'douyin', options.input, options.date, 'creator-harvest.json');
  const frontInputPath = options.frontInput || options.frontDate
    ? resolveInputPath(ROOT_DIR, 'douyin', options.frontInput, options.frontDate, 'harvest.json')
    : '';
  const creatorRows = normalizeCreatorRowsForScrmPreview(loadHarvestRows(inputPath));
  const frontRows = frontInputPath ? loadHarvestRows(frontInputPath) : [];
  const preview = await buildDouyinMainTableCommentPreview(creatorRows, frontRows, options);
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
    errorPrefix: 'Could not resolve account_id for douyin creator comment import',
  });
  const payload = attachAccountIdToPayload(buildMainTableCommentPayload(preview), accountId);

  previewSummary(preview, payload, inputPath, frontInputPath, options.apply);

  if (preview.status !== 'ready') {
    if (options.apply) throw new Error('Douyin main-table comment merge is not ready to apply.');
    console.log('Dry-run only. Re-run with --apply after comment merge status becomes ready.');
    return { preview, payload };
  }
  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply to replace Douyin scrm_comment rows for the affected works.');
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
  const applyResult = await applyCommentImport(dbConfig, payload);
  const verification = await verifyScrmImport(dbConfig, payload);
  const verificationSummary = toJsonable({
    apply_result: applyResult,
    verification: {
      database_total: {
        scrm_comment: verification.database_comment_total,
      },
      payload_rows: {
        comments: verification.payload_comment_rows,
      },
      write_attempt_rows: {
        comments: verification.write_attempt_comment_rows,
      },
      matched_current_payload_rows: {
        comments: verification.matched_comment_rows,
      },
    },
  });
  console.log(JSON.stringify(verificationSummary, null, 2));
  console.log(`IMPORT_VERIFICATION ${JSON.stringify(verificationSummary)}`);
  console.log('Douyin main-table comment import applied successfully.');
  return { preview, payload, applyResult, verification };
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
