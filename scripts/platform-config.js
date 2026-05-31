import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_CONFIG_PATH = process.env.HARVEST_OPS_CONFIG
  ? path.resolve(process.env.HARVEST_OPS_CONFIG)
  : path.join(ROOT_DIR, 'config.local.json');

export function loadLocalConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  return data;
}

export function platformConfig(config, platform) {
  return config?.platforms?.[platform] ?? {};
}

export function sanitizeAccountId(value, fallback = 'account') {
  const text = String(value ?? '').trim();
  const sanitized = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return sanitized || fallback;
}

export function normalizePlatformAccount(account, index = 0) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new Error(`platform account at index ${index} must be an object.`);
  }
  const id = sanitizeAccountId(
    account.id ?? account.name ?? account.label ?? account.sec_uid ?? account.identifier,
    `account-${index + 1}`,
  );
  return {
    ...account,
    id,
    label: String(account.label ?? account.name ?? id),
    enabled: account.enabled !== false,
  };
}

export function platformAccounts(config, platform, options = {}) {
  const accounts = platformConfig(config, platform).accounts ?? [];
  if (!Array.isArray(accounts)) {
    throw new Error(`platforms.${platform}.accounts must be an array.`);
  }

  const selectedIds = new Set((options.accountIds ?? []).map((id) => String(id)));
  return accounts
    .map((account, index) => ({
      raw: account,
      normalized: normalizePlatformAccount(account, index),
    }))
    .filter(({ normalized }) => normalized.enabled)
    .filter(({ raw, normalized }) => selectedIds.size === 0 || accountSelectionKeys(raw, normalized).some((key) => selectedIds.has(key)))
    .map(({ normalized }) => normalized);
}

function accountSelectionKeys(raw, normalized) {
  return [
    normalized.id,
    raw?.id,
    raw?.label,
    raw?.name,
    raw?.sec_uid,
    raw?.identifier,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
}
