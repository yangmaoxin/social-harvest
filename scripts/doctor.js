#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAuditSummary, collectAuditSnapshot } from './audit-danmaku.js';
import { DEFAULT_CONFIG_PATH, ROOT_DIR, dbConfigFromSettings, getConfigPath, loadLocalConfig, setConfigPath } from './lib/runtime-config.js';
import { openConnection } from './lib/scrm-base.js';
import { runChecks as runScrmPreflightChecks } from './preflight-scrm.js';
import { platformAccounts } from './platform-config.js';

const OPENCLI_MAIN_CANDIDATES = [
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'),
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'dist', 'src', 'main.js'),
];
const DEFAULT_OPENCLI_MAIN = OPENCLI_MAIN_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || OPENCLI_MAIN_CANDIDATES[0];
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const DEFAULT_OPENCLI_DOCTOR_TIMEOUT_MS = 30_000;
const DEFAULT_PLATFORM_CHECK_TIMEOUT_MS = 120_000;
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

function nowIso() {
  return new Date().toISOString();
}

function ok(name, extra = {}) {
  return { name, status: 'ok', checked_at: nowIso(), ...extra };
}

function failed(name, error, extra = {}) {
  return { name, status: 'failed', checked_at: nowIso(), error: error instanceof Error ? error.message : String(error), ...extra };
}

function warning(name, reason, extra = {}) {
  return { name, status: 'warning', checked_at: nowIso(), reason, ...extra };
}

function skipped(name, reason, extra = {}) {
  return { name, status: 'skipped', checked_at: nowIso(), reason, ...extra };
}

export function parseArgs(argv) {
  const options = {
    config: '',
    opencliBin: '',
    opencliMain: DEFAULT_OPENCLI_MAIN,
    opencliDoctorTimeoutMs: DEFAULT_OPENCLI_DOCTOR_TIMEOUT_MS,
    platformCheckTimeoutMs: DEFAULT_PLATFORM_CHECK_TIMEOUT_MS,
    checkPlatforms: false,
    platforms: [],
    requireDb: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') options.config = path.resolve(argv[++i]);
    else if (arg === '--opencli-bin') options.opencliBin = argv[++i];
    else if (arg === '--opencli-main') options.opencliMain = path.resolve(argv[++i]);
    else if (arg === '--opencli-doctor-timeout') options.opencliDoctorTimeoutMs = Number(argv[++i]) * 1000;
    else if (arg === '--platform-check-timeout') options.platformCheckTimeoutMs = Number(argv[++i]) * 1000;
    else if (arg === '--check-platforms') options.checkPlatforms = true;
    else if (arg === '--platform') options.platforms.push(argv[++i]);
    else if (arg === '--require-db') options.requireDb = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/doctor.js [options]

Options:
  --config PATH          Config file, default config.local.json
  --opencli-bin PATH     OpenCLI executable; default uses --opencli-main with node
  --opencli-main PATH    OpenCLI entry, default bundled @jackwener/opencli
  --opencli-doctor-timeout SECONDS
                        Timeout for OpenCLI doctor, default 30
  --check-platforms      Run lightweight platform login/API checks
  --platform ID          Limit platform checks; may be repeated
  --platform-check-timeout SECONDS
                        Timeout for each platform check, default 120
  --require-db           Treat missing DB config/schema as failure
  --json                 Print JSON only
`);
}

export function chromeCandidates(platform = process.platform, homeDir = os.homedir(), env = process.env) {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app',
      path.join(homeDir, 'Applications', 'Google Chrome.app'),
    ];
  }
  if (platform === 'win32') {
    return [
      env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
}

export function requiredNodeRange(packageJsonPath = PACKAGE_JSON_PATH) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const raw = String(pkg?.engines?.node || '').trim();
    const minMatch = raw.match(/>=\s*(\d+)/);
    const maxMatch = raw.match(/<\s*(\d+)/);
    return {
      raw: raw || '>=24 <25',
      minMajor: minMatch ? Number(minMatch[1]) : 24,
      maxExclusiveMajor: maxMatch ? Number(maxMatch[1]) : 25,
    };
  } catch {
    return {
      raw: '>=24 <25',
      minMajor: 24,
      maxExclusiveMajor: 25,
    };
  }
}

export function checkNodeVersion(version = process.versions.node, range = requiredNodeRange()) {
  const major = Number(String(version).split('.')[0]);
  if (major >= range.minMajor && major < range.maxExclusiveMajor) {
    return ok('node-version', { version, required: range.raw });
  }
  return failed('node-version', `Node.js ${range.raw} required, current ${version}`, {
    version,
    required: range.raw,
  });
}

export function checkFileExists(name, filePath) {
  return fs.existsSync(filePath)
    ? ok(name, { path: filePath })
    : failed(name, `Not found: ${filePath}`, { path: filePath });
}

export function checkChrome() {
  const candidates = chromeCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found
    ? ok('chrome', { path: found })
    : failed('chrome', 'Google Chrome not found in common install paths.', { candidates });
}

export function checkDbConfig(requireDb = false) {
  const dbConfig = dbConfigFromSettings();
  const missing = Object.entries(dbConfig).filter(([, value]) => !value).map(([key]) => key);
  if (!missing.length) return ok('scrm-db-config', { fields: Object.keys(dbConfig).sort() });
  return requireDb
    ? failed('scrm-db-config', `Missing DB connection fields: ${missing.join(', ')}`)
    : skipped('scrm-db-config', `Missing DB connection fields: ${missing.join(', ')}`);
}

function runCommand(command, args, { timeoutMs = DEFAULT_OPENCLI_DOCTOR_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function openCliInvocation(options = {}, opencliArgs = []) {
  const opencliMain = options.opencliMain || DEFAULT_OPENCLI_MAIN;
  if (options.opencliBin) {
    return {
      command: options.opencliBin,
      args: opencliArgs,
      label: `${options.opencliBin} ${opencliArgs.join(' ')}`.trim(),
    };
  }
  if (!fs.existsSync(opencliMain)) return null;
  return {
    command: process.execPath,
    args: [RUN_OPENCLI_SCRIPT, opencliMain, ...opencliArgs],
    label: `node ${opencliMain} ${opencliArgs.join(' ')}`.trim(),
  };
}

function statusFromDoctorLine(line) {
  const match = line.match(/^\[(OK|FAIL|WARN|WARNING|ERROR)\]\s*([^:]+):\s*(.*)$/i);
  if (!match) return null;
  const rawStatus = match[1].toLowerCase();
  return {
    name: match[2].trim().toLowerCase().replace(/\s+/g, '-'),
    status: rawStatus === 'ok' ? 'ok' : rawStatus === 'warn' || rawStatus === 'warning' ? 'warning' : 'failed',
    detail: match[3].trim(),
  };
}

export function parseOpenCliDoctorOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines.find((line) => /^opencli\s+v/i.test(line));
  const versionMatch = firstLine?.match(/^opencli\s+v([^\s]+)/i);
  const components = {};
  const issues = [];
  let inIssues = false;

  for (const line of lines) {
    if (/^issues:?$/i.test(line)) {
      inIssues = true;
      continue;
    }
    if (inIssues) {
      issues.push(line.replace(/^[-•]\s*/, ''));
      continue;
    }
    const parsed = statusFromDoctorLine(line);
    if (parsed) components[parsed.name] = { status: parsed.status, detail: parsed.detail };
  }

  return {
    version: versionMatch?.[1] || '',
    components,
    issues,
    raw: lines.join('\n'),
  };
}

export async function checkOpenCliDoctor(options = {}) {
  const opencliMain = options.opencliMain || DEFAULT_OPENCLI_MAIN;
  const timeoutMs = options.opencliDoctorTimeoutMs || DEFAULT_OPENCLI_DOCTOR_TIMEOUT_MS;
  const invocation = openCliInvocation(options, ['doctor']);

  if (!invocation) {
    return skipped('opencli-doctor', 'OpenCLI entry is missing; skip browser bridge diagnostics.', { path: opencliMain });
  }

  try {
    const result = await runCommand(invocation.command, invocation.args, { timeoutMs });
    const parsed = parseOpenCliDoctorOutput(`${result.stdout}\n${result.stderr}`);
    const hasFailedComponent = Object.values(parsed.components).some((component) => component.status === 'failed');
    const extra = {
      command: invocation.label,
      exit_code: result.code,
      version: parsed.version,
      components: parsed.components,
      issues: parsed.issues,
    };
    if (result.code === 0 && !hasFailedComponent) return ok('opencli-doctor', extra);
    return failed('opencli-doctor', `OpenCLI doctor failed with exit code ${result.code}`, extra);
  } catch (error) {
    return failed('opencli-doctor', error);
  }
}

function parseJsonRows(stdout) {
  const parsed = JSON.parse(stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function runOpenCliJsonCheck(options, opencliArgs) {
  const invocation = openCliInvocation(options, opencliArgs);
  if (!invocation) {
    throw new Error(`OpenCLI entry not found: ${options.opencliMain || DEFAULT_OPENCLI_MAIN}`);
  }
  const timeoutMs = options.platformCheckTimeoutMs || DEFAULT_PLATFORM_CHECK_TIMEOUT_MS;
  const result = await runCommand(invocation.command, invocation.args, {
    timeoutMs,
    env: {
      ...process.env,
      OPENCLI_BROWSER_COMMAND_TIMEOUT: String(Math.ceil(timeoutMs / 1000)),
    },
  });
  if (result.code !== 0) {
    throw new Error(`${invocation.label} failed with code ${result.code}\n${result.stderr || result.stdout}`);
  }
  return {
    command: invocation.label,
    rows: parseJsonRows(result.stdout),
  };
}

export async function checkWeixinChannelsLogin(options = {}) {
  try {
    const posts = await runOpenCliJsonCheck(options, ['weixin-channels', 'posts', '--limit', '1', '-f', 'json']);
    const firstWork = posts.rows.find((row) => row?.object_id);
    const checks = [{
      name: 'posts-api',
      status: 'ok',
      rows: posts.rows.length,
    }];
    if (firstWork?.object_id) {
      try {
        const comments = await runOpenCliJsonCheck(options, ['weixin-channels', 'comments', firstWork.object_id, '--limit', '1', '-f', 'json']);
        checks.push({
          name: 'comments-api',
          status: 'ok',
          rows: comments.rows.length,
          object_id: firstWork.object_id,
        });
      } catch (error) {
        checks.push({
          name: 'comments-api',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          object_id: firstWork.object_id,
        });
        return warning('platform:weixin-channels-login', '作品接口可用，但评论接口轻量检查失败。', {
          platform: 'weixin-channels',
          command: posts.command,
          checks,
        });
      }
    } else {
      checks.push({
        name: 'comments-api',
        status: 'skipped',
        reason: '作品列表为空，无法选择样本作品检查评论接口',
      });
    }
    return ok('platform:weixin-channels-login', {
      platform: 'weixin-channels',
      command: posts.command,
      checks,
    });
  } catch (error) {
    return failed('platform:weixin-channels-login', error, { platform: 'weixin-channels' });
  }
}

function firstDouyinAccount(config) {
  const accounts = platformAccounts(config, 'douyin');
  return accounts.find((account) => account.sec_uid || account.identifier) || null;
}

export async function checkDouyinLogin(options = {}) {
  const config = loadLocalConfig();
  try {
    const checks = [];
    const account = firstDouyinAccount(config);
    if (account?.sec_uid) {
      try {
        const harvest = await runOpenCliJsonCheck(options, [
          'douyin',
          'skill-harvest',
          '--sec_uid',
          String(account.sec_uid),
          '--video_limit',
          '1',
          '--comment_limit',
          '1',
          '--with_replies',
          'false',
          '-f',
          'json',
        ]);
        checks.push({
          name: 'public-harvest-api',
          status: 'ok',
          rows: harvest.rows.length,
          account_id: account.id,
        });
        return ok('platform:douyin-login', {
          platform: 'douyin',
          command: harvest.command,
          account_id: account.id,
          account_label: account.label,
          checks,
        });
      } catch (error) {
        checks.push({
          name: 'public-harvest-api',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          account_id: account.id,
        });
        return warning('platform:douyin-login', '抖音配置账号公开作品聚合接口轻量检查失败。', {
          platform: 'douyin',
          account_id: account.id,
          account_label: account.label,
          checks,
        });
      }
    }
    checks.push({
      name: 'public-harvest-api',
      status: 'skipped',
      reason: 'No enabled douyin account with sec_uid is configured.',
    });
    return warning('platform:douyin-login', '未配置可用于抖音轻量检查的 sec_uid。', {
      platform: 'douyin',
      checks,
    });
  } catch (error) {
    return failed('platform:douyin-login', error, {
      platform: 'douyin',
    });
  }
}

export async function checkPlatformLogins(options = {}) {
  if (!options.checkPlatforms) {
    return [skipped('platform-login-checks', 'Add --check-platforms to run lightweight platform login/API checks.')];
  }
  const selected = new Set(options.platforms || []);
  const checks = [];
  if (!selected.size || selected.has('weixin-channels')) checks.push(await checkWeixinChannelsLogin(options));
  if (!selected.size || selected.has('douyin')) checks.push(await checkDouyinLogin(options));
  for (const platform of selected) {
    if (!['weixin-channels', 'douyin'].includes(platform)) {
      checks.push(skipped(`platform:${platform}-login`, `Unsupported platform login check: ${platform}`, { platform }));
    }
  }
  return checks;
}

export async function checkDanmakuSchema(dbConfig = {}) {
  try {
    const connection = await openConnection(dbConfig.host, dbConfig.user, dbConfig.password, dbConfig.database);
    try {
      const snapshot = await collectAuditSnapshot(connection);
      const summary = buildAuditSummary(snapshot);
      const extra = {
        database: dbConfig.database,
        snapshot,
        errors: summary.errors,
        warnings: summary.warnings,
      };
      if (summary.status === 'ok') return ok('scrm-danmaku-schema', extra);
      if (summary.status === 'warning') return warning('scrm-danmaku-schema', summary.warnings.join(' '), extra);
      return failed('scrm-danmaku-schema', summary.errors.join(' '), extra);
    } finally {
      await connection.end();
    }
  } catch (error) {
    return failed('scrm-danmaku-schema', error);
  }
}

export async function runDoctor(options = {}) {
  if (options.config) setConfigPath(options.config);
  const activeConfigPath = options.config || getConfigPath();
  const openCliEntryCheck = options.opencliBin
    ? ok('opencli-bin', { command: options.opencliBin })
    : checkFileExists('opencli-main', options.opencliMain || DEFAULT_OPENCLI_MAIN);
  const checks = [
    checkNodeVersion(),
    checkFileExists('config-file', activeConfigPath || DEFAULT_CONFIG_PATH),
    openCliEntryCheck,
    checkChrome(),
    checkDbConfig(Boolean(options.requireDb)),
  ];

  const dbConfigCheck = checks.find((check) => check.name === 'scrm-db-config');
  if (dbConfigCheck?.status === 'ok') {
    const dbConfig = dbConfigFromSettings();
    const preflight = await runScrmPreflightChecks({
      requireFileCommentDb: true,
      requireMessageDb: true,
    });
    checks.push(...preflight.checks.map((check) => ({ ...check, name: `scrm-preflight:${check.name}` })));
    checks.push(await checkDanmakuSchema(dbConfig));
  } else {
    checks.push(skipped('scrm-preflight', 'Database config is incomplete.'));
    checks.push(skipped('scrm-danmaku-schema', 'Database config is incomplete.'));
  }

  checks.push(await checkOpenCliDoctor(options));
  checks.push(...await checkPlatformLogins(options));

  const status = checks.some((check) => check.status === 'failed')
    ? 'failed'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ok';
  return {
    status,
    checked_at: nowIso(),
    checks,
  };
}

function printHuman(report) {
  console.log(`Doctor status: ${report.status}`);
  for (const check of report.checks) {
    const detail = check.error || check.reason || check.path || check.database || '';
    console.log(`${check.status.toUpperCase().padEnd(7)} ${check.name}${detail ? ` - ${detail}` : ''}`);
    if (check.components && typeof check.components === 'object') {
      for (const [name, component] of Object.entries(check.components)) {
        console.log(`        ${name}: ${component.status}${component.detail ? ` - ${component.detail}` : ''}`);
      }
    }
    if (Array.isArray(check.checks) && check.checks.length) {
      for (const item of check.checks) {
        const itemDetail = item.error || item.reason || (Number.isFinite(item.rows) ? `${item.rows} rows` : '');
        console.log(`        ${item.name}: ${item.status}${itemDetail ? ` - ${itemDetail}` : ''}`);
      }
    }
    if (Array.isArray(check.issues) && check.issues.length) {
      for (const issue of check.issues) console.log(`        issue: ${issue}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    runDoctor(options).then((report) => {
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printHuman(report);
      if (report.status === 'failed') process.exitCode = 1;
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
