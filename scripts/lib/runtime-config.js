import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, 'config.local.json');

const KEY_ALIASES = {
  HARVEST_SCRM_DB_HOST: ['sinks.scrm.host'],
  HARVEST_SCRM_DB_USER: ['sinks.scrm.user'],
  HARVEST_SCRM_DB_PASSWORD: ['sinks.scrm.password'],
  HARVEST_SCRM_DB_NAME: ['sinks.scrm.db_name'],
  HARVEST_SCRM_MEDIA_BACKEND: ['sinks.scrm.media.backend'],
  HARVEST_SCRM_OSS_REGION: ['sinks.scrm.media.region'],
  HARVEST_SCRM_OSS_BUCKET: ['sinks.scrm.media.bucket'],
  HARVEST_SCRM_OSS_ACCESS_KEY_ID: ['sinks.scrm.media.access_key_id'],
  HARVEST_SCRM_OSS_ACCESS_KEY_SECRET: ['sinks.scrm.media.access_key_secret'],
  HARVEST_SCRM_OSS_PREFIX: ['sinks.scrm.media.prefix'],
  HARVEST_SCRM_OSS_KEY_TEMPLATE: ['sinks.scrm.media.key_template'],
  HARVEST_SCRM_OSS_PUBLIC_BASE_URL: ['sinks.scrm.media.public_base_url'],
  OPENCLI_MODELSCOPE_API_KEY: ['ai.api_key', 'ai.ApiKey'],
  MODELSCOPE_API_KEY: ['ai.api_key', 'ai.ApiKey'],
  OPENCLI_MODELSCOPE_BASE_URL: ['ai.base_url', 'ai.BaseUrl'],
  OPENCLI_MODELSCOPE_MODEL: ['ai.model', 'ai.Model'],
  OPENCLI_MODELSCOPE_MODELS: ['ai.models', 'ai.Models'],
  OPENCLI_MODELSCOPE_SSL_VERIFY: ['ai.ssl_verify', 'ai.SslVerify'],
  OPENCLI_MODELSCOPE_CA_FILE: ['ai.ca_file', 'ai.CaFile'],
  OPENCLI_INTENTION_AI_TIMEOUT_SECONDS: ['ai.timeout_seconds', 'ai.TimeoutSeconds'],
  OPENCLI_INTENTION_AI_BATCH_SIZE: ['ai.batch_size', 'ai.BatchSize'],
  OPENCLI_INTENTION_AI_ENABLED: ['ai.enabled', 'ai.Enabled'],
  HARVEST_FEISHU_APP_ID: ['sinks.feishu.app_id'],
  HARVEST_FEISHU_APP_SECRET: ['sinks.feishu.app_secret'],
  HARVEST_FEISHU_APP_TOKEN: ['sinks.feishu.app_token'],
  HARVEST_FEISHU_API_BASE_URL: ['sinks.feishu.api_base_url'],
  HARVEST_FEISHU_BASE_NAME: ['sinks.feishu.base_name'],
  HARVEST_FEISHU_TABLE_PREFIX: ['sinks.feishu.table_prefix'],
};

let configPath = process.env.HARVEST_OPS_CONFIG
  ? path.resolve(process.env.HARVEST_OPS_CONFIG)
  : DEFAULT_CONFIG_PATH;
let cachedConfig;

export function setConfigPath(nextPath) {
  configPath = nextPath ? path.resolve(nextPath) : DEFAULT_CONFIG_PATH;
  cachedConfig = undefined;
}

export function getConfigPath() {
  return configPath;
}

export function loadLocalConfig() {
  if (cachedConfig !== undefined) return cachedConfig;
  if (!fs.existsSync(configPath)) {
    cachedConfig = {};
    return cachedConfig;
  }
  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  cachedConfig = data;
  return cachedConfig;
}

function getNested(data, dottedPath) {
  let current = data;
  for (const part of dottedPath.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function configValue(name) {
  const config = loadLocalConfig();
  for (const alias of KEY_ALIASES[name] ?? []) {
    const value = getNested(config, alias);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function setting(name, defaultValue = undefined) {
  const envValue = process.env[name];
  if (envValue !== undefined && envValue !== '') return String(envValue);
  const value = configValue(name);
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value);
}

export function settingList(name) {
  const envValue = process.env[name];
  if (envValue !== undefined && envValue !== '') {
    return envValue.split(',').map((item) => item.trim()).filter(Boolean);
  }
  const value = configValue(name);
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeConfigList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function sinkListForPlatform(platformId = '', fallback = ['scrm']) {
  const config = loadLocalConfig();
  const platformSinks = platformId ? normalizeConfigList(getNested(config, `platforms.${platformId}.sinks`)) : [];
  if (platformSinks.length) return [...new Set(platformSinks)];
  const defaultSinks = normalizeConfigList(config.default_sinks);
  if (defaultSinks.length) return [...new Set(defaultSinks)];
  return [...new Set(fallback)];
}

export function dbConfigFromSettings() {
  return {
    host: (setting('HARVEST_SCRM_DB_HOST') || '').trim(),
    user: (setting('HARVEST_SCRM_DB_USER') || '').trim(),
    password: (setting('HARVEST_SCRM_DB_PASSWORD') || '').trim(),
    database: (setting('HARVEST_SCRM_DB_NAME') || '').trim(),
  };
}

export function scrmMediaConfigFromSettings() {
  return {
    backend: (setting('HARVEST_SCRM_MEDIA_BACKEND') || '').trim(),
    region: (setting('HARVEST_SCRM_OSS_REGION') || '').trim(),
    bucket: (setting('HARVEST_SCRM_OSS_BUCKET') || '').trim(),
    accessKeyId: (setting('HARVEST_SCRM_OSS_ACCESS_KEY_ID') || '').trim(),
    accessKeySecret: (setting('HARVEST_SCRM_OSS_ACCESS_KEY_SECRET') || '').trim(),
    prefix: (setting('HARVEST_SCRM_OSS_PREFIX', 'social-harvest') || '').trim(),
    keyTemplate: (setting(
      'HARVEST_SCRM_OSS_KEY_TEMPLATE',
      '{prefix}/{platform}/{account_id}/{yyyy}/{mm}/{entity_type}/{entity_id}/{image_type}.{ext}',
    ) || '').trim(),
    publicBaseUrl: (setting('HARVEST_SCRM_OSS_PUBLIC_BASE_URL') || '').trim(),
  };
}

export function feishuBaseConfigFromSettings() {
  const appToken = (setting('HARVEST_FEISHU_APP_TOKEN') || '').trim();
  return {
    appId: (setting('HARVEST_FEISHU_APP_ID') || '').trim(),
    appSecret: (setting('HARVEST_FEISHU_APP_SECRET') || '').trim(),
    appToken,
    apiBaseUrl: (setting('HARVEST_FEISHU_API_BASE_URL', 'https://open.feishu.cn/open-apis') || '').trim(),
    baseName: (setting('HARVEST_FEISHU_BASE_NAME', 'Social Harvest 写入') || '').trim(),
    tablePrefix: (setting('HARVEST_FEISHU_TABLE_PREFIX', 'harvest') || '').trim(),
  };
}
