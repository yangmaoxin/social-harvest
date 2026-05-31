#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  attachAccountIdToPayload,
  resolveImportAccountId,
  resolveAccountIdFromRows,
  resolveAccountProfilePath,
} from './lib/account-context.js';
import {
  applyImport,
  ensureImportSchema,
  loadHarvestRows,
  loadExistingWorkShareUrls,
  openConnection,
  preview,
  resolveInputPath,
  ROOT_DIR,
  verifyImport,
} from './lib/scrm-base.js';
import { dbConfigFromSettings, scrmMediaConfigFromSettings, setConfigPath } from './lib/runtime-config.js';
import { buildMediaStartSummary, materializeScrmPayloadMedia } from './lib/scrm-media.js';
import { getMapper } from './lib/scrm-mappers.js';

const OPENCLI_DIR_CANDIDATES = [
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli'),
  path.join(ROOT_DIR, 'workspace', 'OpenCLI'),
];
const DEFAULT_OPENCLI_DIR = OPENCLI_DIR_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, 'dist', 'src', 'main.js'))) || OPENCLI_DIR_CANDIDATES[0];
const DEFAULT_USER_ADAPTER_DIR = path.join(os.homedir(), '.opencli', 'clis', 'weixin-channels');
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');

function toJsonable(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(toJsonable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonable(item)]));
  }
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function syncWeixinAdapter(destDir) {
  ensureDir(path.dirname(destDir));
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT_DIR, 'adapters', 'weixin-channels'), destDir, { recursive: true });
}

function opencliEntryFor(opencliDir) {
  return path.join(opencliDir, 'dist', 'src', 'main.js');
}

function hasLocalOpenCliBuild(opencliDir) {
  return Boolean(opencliDir) && fs.existsSync(opencliEntryFor(opencliDir));
}

function runOpenCli(args, { opencliDir = DEFAULT_OPENCLI_DIR, timeoutSeconds = 600 } = {}) {
  return new Promise((resolve, reject) => {
    const useLocalBuild = hasLocalOpenCliBuild(opencliDir);
    const command = useLocalBuild ? process.execPath : 'opencli';
    const commandArgs = useLocalBuild ? [RUN_OPENCLI_SCRIPT, opencliEntryFor(opencliDir), ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        OPENCLI_BROWSER_COMMAND_TIMEOUT: String(timeoutSeconds),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(process.platform === 'win32' && !useLocalBuild ? { shell: true } : {}),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`opencli timed out after ${timeoutSeconds}s: ${args.join(' ')}`));
    }, timeoutSeconds * 1000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`opencli failed with code ${code}: ${stderr || stdout}`));
    });
  });
}

function parseJsonArray(text, label) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error(`${label} did not return a JSON array.`);
  return data;
}

function sourceRowsByObjectId(rows = []) {
  return new Map(rows
    .map((row) => [String(row.object_id || row.objectId || row.export_id || row.exportId || '').trim(), row])
    .filter(([key]) => key));
}

async function fetchWeixinShortLinks(rows, options = {}) {
  if (!rows.length) return [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-short-links-'));
  const inputPath = path.join(tempDir, 'works.json');
  fs.writeFileSync(inputPath, `${JSON.stringify(rows, null, 2)}\n`);
  syncWeixinAdapter(options.userAdapterDir || DEFAULT_USER_ADAPTER_DIR);
  if (hasLocalOpenCliBuild(options.opencliDir || DEFAULT_OPENCLI_DIR)) {
    syncWeixinAdapter(path.join(options.opencliDir || DEFAULT_OPENCLI_DIR, 'clis', 'weixin-channels'));
  }
  const stdout = await runOpenCli([
    'weixin-channels',
    'short-links',
    '--input',
    inputPath,
    '-f',
    'json',
  ], {
    opencliDir: options.opencliDir || DEFAULT_OPENCLI_DIR,
    timeoutSeconds: options.timeoutSeconds || 600,
  });
  return parseJsonArray(stdout, 'weixin-channels short-links');
}

export async function materializeWeixinChannelsShareUrls(payload, harvestRows, dbConfig, options = {}) {
  const summary = {
    platform: 'weixin-channels',
    reused_existing: 0,
    already_in_payload: 0,
    generated: 0,
    skipped_missing_nonce: 0,
    failed: 0,
    requested: 0,
  };
  if (!payload.works.length) return summary;

  const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
  let existingLinks;
  try {
    await ensureImportSchema(connection);
    existingLinks = await loadExistingWorkShareUrls(connection, payload.works);
  } finally {
    await connection.end();
  }

  const sourceByObjectId = sourceRowsByObjectId(harvestRows);
  const targets = [];
  for (const work of payload.works) {
    const key = `${Number(work.origin_type || 0)}\0${String(work.work_no || '').trim()}`;
    const existing = existingLinks.get(key);
    if (existing) {
      work.share_url = existing;
      summary.reused_existing += 1;
      continue;
    }
    if (work.share_url) {
      summary.already_in_payload += 1;
      continue;
    }
    if (Number(work.origin_type || 0) !== 1 || Number(work.file_type || 1) !== 1) continue;
    const source = sourceByObjectId.get(String(work.work_no || '').trim()) || {};
    const objectNonce = String(source.object_nonce || source.objectNonce || '').trim();
    if (!objectNonce) {
      summary.skipped_missing_nonce += 1;
      continue;
    }
    targets.push({
      object_id: work.work_no,
      object_nonce: objectNonce,
      file_type: work.file_type,
      content_type: source.content_type || 'video',
    });
  }

  summary.requested = targets.length;
  const linkRows = await fetchWeixinShortLinks(targets, options);
  const linkByObjectId = new Map(linkRows.map((row) => [String(row.object_id || '').trim(), row]));
  for (const work of payload.works) {
    if (work.share_url) continue;
    const row = linkByObjectId.get(String(work.work_no || '').trim());
    if (!row) continue;
    if (row.status === 'success' && row.share_url) {
      work.share_url = String(row.share_url).trim();
      summary.generated += 1;
    } else {
      summary.failed += 1;
      payload.warnings.push(`Work ${work.work_no} share_url generation failed: ${row.error || 'unknown error'}`);
    }
  }
  return summary;
}

export function parseArgs(argv) {
  const options = {
    platform: '',
    input: '',
    date: '',
    accountId: '',
    accountProfile: '',
    limit: 0,
    apply: false,
    config: '',
    host: '',
    user: '',
    password: '',
    database: '',
    generateShareLinks: true,
    opencliDir: DEFAULT_OPENCLI_DIR,
    userAdapterDir: DEFAULT_USER_ADAPTER_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--platform') options.platform = argv[++i];
    else if (arg === '--input') options.input = argv[++i];
    else if (arg === '--date') options.date = argv[++i];
    else if (arg === '--account-id') options.accountId = argv[++i];
    else if (arg === '--account-profile') options.accountProfile = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i] || 0);
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--user') options.user = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--database') options.database = argv[++i];
    else if (arg === '--skip-share-links') options.generateShareLinks = false;
    else if (arg === '--opencli-dir') options.opencliDir = argv[++i];
    else if (arg === '--user-adapter-dir') options.userAdapterDir = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/import-to-scrm.js --platform <platform> [options]

Options:
  --platform NAME       Platform name, e.g. weixin-channels or douyin
  --input PATH          Absolute or relative path to harvest.json
  --date YYYY-MM-DD     Use samples/<platform>/<date>/harvest.json
  --account-id VALUE    Explicit real platform account_id for this import, not config alias like main
  --account-profile PATH
                        Explicit account-profile.json path for this import
  --limit N             Only import the first N works
  --apply               Write to MySQL. Default is dry-run preview only.
  --config PATH         Config file, default config.local.json
  --host HOST           MySQL host override
  --user USER           MySQL user override
  --password PASSWORD   MySQL password override
  --database DB         MySQL database override
  --skip-share-links    Do not generate missing Weixin Channels short links
  --opencli-dir PATH    OpenCLI package/workspace directory for short-link generation
  --user-adapter-dir PATH
                        Runtime adapter directory, default ~/.opencli/clis/weixin-channels
`);
}

export async function run(options) {
  if (options.config) setConfigPath(options.config);
  if (!options.platform) throw new Error('--platform is required');
  const mapper = getMapper(options.platform);
  const inputPath = resolveInputPath(ROOT_DIR, options.platform, options.input, options.date);
  const harvestRows = loadHarvestRows(inputPath);
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
    errorPrefix: `Could not resolve account_id for ${options.platform} import`,
  });
  const payload = attachAccountIdToPayload(
    await mapper.buildPayload(harvestRows, { limit: options.limit }),
    accountId,
  );
  preview(payload, inputPath, options.apply, options.platform);
  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply to write into MySQL.');
    return;
  }

  const settingsConfig = dbConfigFromSettings();
  const dbConfig = {
    host: options.host || settingsConfig.host,
    user: options.user || settingsConfig.user,
    password: options.password || settingsConfig.password,
    database: options.database || settingsConfig.database,
  };
  if (options.platform === 'weixin-channels' && options.generateShareLinks) {
    const shareLinkSummary = await materializeWeixinChannelsShareUrls(payload, harvestRows, dbConfig, {
      opencliDir: options.opencliDir,
      userAdapterDir: options.userAdapterDir,
    });
    console.log(`SHARE_LINK_SUMMARY ${JSON.stringify(shareLinkSummary)}`);
  }
  const mediaConfig = scrmMediaConfigFromSettings();
  console.log(`MEDIA_START ${JSON.stringify(buildMediaStartSummary(options.platform, mediaConfig))}`);
  const mediaResult = await materializeScrmPayloadMedia(payload, {
    platform: options.platform,
    mediaConfig,
  });
  console.log(`MEDIA_SUMMARY ${JSON.stringify(mediaResult.summary)}`);
  await applyImport(dbConfig, payload);
  const report = await verifyImport(dbConfig, payload);
  const verificationSummary = toJsonable({
    platform: options.platform,
    verification: {
      database_total: {
        scrm_file: report.database_file_total,
        scrm_comment: report.database_comment_total,
      },
      payload_rows: {
        works: report.payload_work_rows,
        comments: report.payload_comment_rows,
      },
      write_attempt_rows: {
        works: report.write_attempt_work_rows,
        comments: report.write_attempt_comment_rows,
      },
      matched_current_payload_rows: {
        works: report.matched_work_rows,
        comments: report.matched_comment_rows,
      },
      works: report.works,
    },
  });
  console.log(JSON.stringify(verificationSummary, null, 2));
  console.log(`IMPORT_VERIFICATION ${JSON.stringify(verificationSummary)}`);
  console.log('Import applied successfully.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    run(options).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
