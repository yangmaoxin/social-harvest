import fs from 'node:fs';
import path from 'node:path';

import { loadLocalConfig, ROOT_DIR } from './runtime-config.js';
import { ensureText } from './scrm-base.js';

function loadJsonArray(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${filePath} did not contain a JSON array.`);
  return data;
}

export function resolveSiblingAccountProfilePath(inputPath = '') {
  const normalized = ensureText(inputPath);
  if (!normalized) return '';
  return path.join(path.dirname(path.resolve(normalized)), 'account-profile.json');
}

export function resolveAccountProfilePath({
  platform = '',
  inputPath = '',
  date = '',
  accountProfile = '',
  rootDir = ROOT_DIR,
} = {}) {
  if (ensureText(accountProfile)) return path.resolve(accountProfile);
  const siblingPath = resolveSiblingAccountProfilePath(inputPath);
  if (siblingPath && fs.existsSync(siblingPath)) return siblingPath;
  if (ensureText(platform) && ensureText(date)) {
    const datedPath = path.resolve(rootDir, 'samples', platform, date, 'account-profile.json');
    if (fs.existsSync(datedPath)) return datedPath;
  }
  return '';
}

export function loadAccountIdFromProfile(accountProfilePath = '') {
  const normalizedPath = ensureText(accountProfilePath);
  if (!normalizedPath) return '';
  if (!fs.existsSync(normalizedPath)) return '';
  const rows = loadJsonArray(normalizedPath);
  const accountId = ensureText(rows[0]?.account_id, 191);
  if (!accountId) {
    throw new Error(`Account profile did not contain account_id: ${normalizedPath}`);
  }
  return accountId;
}

export function resolveConsistentAccountId(values = [], label = 'account_id') {
  const normalized = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => ensureText(value, 191))
    .filter(Boolean))];
  if (normalized.length > 1) {
    throw new Error(`Found multiple ${label} values in one import: ${normalized.join(', ')}`);
  }
  return normalized[0] || '';
}

export function resolveAccountIdFromRows(rows = [], keys = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const sourceKeys = Array.isArray(keys) ? keys : [];
  return resolveConsistentAccountId(
    sourceRows.flatMap((row) => sourceKeys.map((key) => row?.[key])),
    sourceKeys.join('/') || 'row account_id',
  );
}

function configuredAccountAliasMatches(account = {}, accountId = '') {
  const normalizedAccountId = ensureText(accountId, 191);
  if (!normalizedAccountId || !account || typeof account !== 'object' || Array.isArray(account)) return false;
  return [
    account.id,
    account.name,
    account.label,
  ].map((value) => ensureText(value, 191)).filter(Boolean).includes(normalizedAccountId);
}

export function assertStableAccountId(accountId = '', {
  platform = '',
  source = 'account_id',
} = {}) {
  const normalizedAccountId = ensureText(accountId, 191);
  if (!normalizedAccountId || !ensureText(platform)) return normalizedAccountId;

  const accounts = loadLocalConfig()?.platforms?.[platform]?.accounts;
  if (!Array.isArray(accounts)) return normalizedAccountId;

  const aliasAccount = accounts.find((account) => configuredAccountAliasMatches(account, normalizedAccountId));
  if (!aliasAccount) return normalizedAccountId;

  const configuredAccountId = ensureText(aliasAccount.account_id, 191);
  if (configuredAccountId && configuredAccountId === normalizedAccountId) return normalizedAccountId;

  const replacement = configuredAccountId
    ? `Use the real platform account_id "${configuredAccountId}", or prepare account-profile.json.`
    : `Add platforms.${platform}.accounts[].account_id or prepare account-profile.json.`;
  throw new Error(`Refusing to use ${source} "${normalizedAccountId}" for ${platform} import because it matches a local config account alias, not a stable platform account_id. ${replacement}`);
}

export function resolveImportAccountId({
  platform = '',
  explicitAccountId = '',
  rowAccountId = '',
  accountProfilePath = '',
  errorPrefix = 'Could not resolve account_id',
} = {}) {
  const candidates = [
    ['--account-id', () => explicitAccountId],
    ['row account_id', () => rowAccountId],
    ['account-profile.json account_id', () => loadAccountIdFromProfile(accountProfilePath)],
  ];
  for (const [source, loadValue] of candidates) {
    const accountId = ensureText(loadValue(), 191);
    if (accountId) return assertStableAccountId(accountId, { platform, source });
  }
  throw new Error(`${errorPrefix}. Provide a stable platform account_id or prepare account-profile.json.`);
}

export function attachAccountIdToPayload(payload = {}, accountId = '') {
  const normalizedAccountId = ensureText(accountId, 191);
  if (!normalizedAccountId) throw new Error('account_id is required for SCRM import payload.');
  return {
    ...payload,
    works: Array.isArray(payload.works)
      ? payload.works.map((item) => ({ ...item, account_id: normalizedAccountId }))
      : [],
    comments: Array.isArray(payload.comments)
      ? payload.comments.map((item) => ({ ...item, account_id: normalizedAccountId }))
      : [],
    records: Array.isArray(payload.records)
      ? payload.records.map((item) => ({ ...item, account_id: normalizedAccountId }))
      : [],
  };
}
