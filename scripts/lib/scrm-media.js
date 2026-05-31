import path from 'node:path';

import OSS from 'ali-oss';

import { imageRequestHeaders } from './image-request-headers.js';
import { ensureText } from './scrm-base.js';

export const DEFAULT_OSS_KEY_TEMPLATE = '{prefix}/{platform}/{account_id}/{yyyy}/{mm}/{entity_type}/{entity_id}/{image_type}.{ext}';

const DEFAULT_IMAGE_USER_AGENT = 'Social Harvest/1.0';
const CONTENT_TYPE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

function trimSlash(value = '') {
  return ensureText(value).replace(/\/+$/g, '');
}

function normalizeTemplateValue(value = '') {
  return ensureText(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'unknown';
}

function extensionFromContentType(contentType = '') {
  const normalized = ensureText(contentType).split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS.get(normalized) || '';
}

function extensionFromUrl(url = '') {
  try {
    const { pathname } = new URL(url);
    const extension = path.extname(pathname).replace(/^\./, '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(extension)
      ? (extension === 'jpeg' ? 'jpg' : extension)
      : '';
  } catch {
    return '';
  }
}

function dateParts(value = '', now = new Date()) {
  const candidate = ensureText(value);
  const parsed = candidate ? new Date(candidate.replace(' ', 'T')) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
  return {
    yyyy: String(date.getFullYear()),
    mm: String(date.getMonth() + 1).padStart(2, '0'),
  };
}

export function isHttpImageUrl(value = '') {
  return /^https?:\/\//i.test(ensureText(value));
}

export function isAlreadyPublicMediaUrl(url = '', mediaConfig = {}) {
  const baseUrl = trimSlash(mediaConfig.publicBaseUrl);
  return Boolean(baseUrl && ensureText(url).startsWith(`${baseUrl}/`));
}

export function validateOssMediaConfig(mediaConfig = {}) {
  if (!mediaConfig.backend) return { enabled: false };
  if (mediaConfig.backend !== 'oss') throw new Error(`Unsupported SCRM media backend: ${mediaConfig.backend}`);
  const missing = [
    ['region', mediaConfig.region],
    ['bucket', mediaConfig.bucket],
    ['access_key_id', mediaConfig.accessKeyId],
    ['access_key_secret', mediaConfig.accessKeySecret],
    ['public_base_url', mediaConfig.publicBaseUrl],
  ].filter(([, value]) => !ensureText(value)).map(([key]) => key);
  if (missing.length) throw new Error(`Missing SCRM OSS media config fields: ${missing.join(', ')}`);
  return { enabled: true };
}

export function renderOssKey({
  mediaConfig = {},
  platform = '',
  accountId = '',
  entityType = '',
  entityId = '',
  imageType = '',
  ext = 'jpg',
  dateValue = '',
  now = new Date(),
} = {}) {
  const { yyyy, mm } = dateParts(dateValue, now);
  const values = {
    prefix: normalizeTemplateValue(mediaConfig.prefix || 'social-harvest'),
    platform: normalizeTemplateValue(platform),
    account_id: normalizeTemplateValue(accountId),
    yyyy,
    mm,
    entity_type: normalizeTemplateValue(entityType),
    entity_id: normalizeTemplateValue(entityId),
    image_type: normalizeTemplateValue(imageType),
    ext: normalizeTemplateValue(ext || 'jpg'),
  };
  const template = ensureText(mediaConfig.keyTemplate) || DEFAULT_OSS_KEY_TEMPLATE;
  return template.replace(/\{([a-z_]+)\}/g, (match, key) => values[key] ?? match);
}

export function publicUrlForOssKey(mediaConfig = {}, key = '') {
  return `${trimSlash(mediaConfig.publicBaseUrl)}/${ensureText(key).replace(/^\/+/g, '')}`;
}

export function buildMediaStartSummary(platform = '', mediaConfig = {}) {
  return {
    platform,
    target: 'scrm',
    backend: mediaConfig.backend || '',
    configured: Boolean(mediaConfig.backend),
  };
}

export function ossKeyFromPublicMediaUrl(url = '', mediaConfig = {}) {
  const sourceUrl = ensureText(url);
  const baseUrl = trimSlash(mediaConfig.publicBaseUrl);
  if (!baseUrl || !sourceUrl.startsWith(`${baseUrl}/`)) return '';
  try {
    const source = new URL(sourceUrl);
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/g, '');
    if (source.origin !== base.origin) return '';
    if (basePath && !source.pathname.startsWith(`${basePath}/`)) return '';
    const keyPath = basePath ? source.pathname.slice(basePath.length + 1) : source.pathname.replace(/^\/+/g, '');
    return decodeURIComponent(keyPath);
  } catch {
    return sourceUrl.slice(baseUrl.length + 1).split(/[?#]/)[0];
  }
}

export function publicUrlForScrmImageJob(url = '', job = {}, {
  mediaConfig = {},
  ext = '',
  now = new Date(),
} = {}) {
  const key = renderOssKey({
    mediaConfig,
    platform: job.platform,
    accountId: job.accountId,
    entityType: job.entityType,
    entityId: job.entityId,
    imageType: job.imageType,
    dateValue: job.dateValue,
    ext: ext || extensionFromUrl(url) || 'jpg',
    now,
  });
  return publicUrlForOssKey(mediaConfig, key);
}

export function isExpectedPublicMediaUrl(url = '', job = {}, options = {}) {
  return isAlreadyPublicMediaUrl(url, options.mediaConfig)
    && ensureText(url) === publicUrlForScrmImageJob(url, job, options);
}

export async function downloadImageBuffer(url, {
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_IMAGE_USER_AGENT,
} = {}) {
  if (!fetchImpl) throw new Error('Missing fetch implementation for image download.');
  const response = await fetchImpl(url, {
    headers: imageRequestHeaders(url, { userAgent }),
  });
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
  const contentType = response.headers?.get?.('content-type') || '';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
  };
}

export function createOssClient(mediaConfig = {}) {
  return new OSS({
    region: mediaConfig.region,
    accessKeyId: mediaConfig.accessKeyId,
    accessKeySecret: mediaConfig.accessKeySecret,
    bucket: mediaConfig.bucket,
  });
}

async function ossObjectExists(client, key) {
  if (typeof client.head !== 'function') return false;
  try {
    await client.head(key);
    return true;
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.code);
    if (status === 404 || /NoSuchKey|NotFound/i.test(String(error?.name || error?.message || error))) return false;
    throw error;
  }
}

async function uploadImageToOss(url, job, {
  mediaConfig,
  client,
  fetchImpl,
  now = new Date(),
} = {}) {
  if (isExpectedPublicMediaUrl(url, job, { mediaConfig, now })) {
    return { url, skippedExisting: true, skipReason: 'already_public_url' };
  }
  const sourceKey = ossKeyFromPublicMediaUrl(url, mediaConfig);
  if (sourceKey) {
    const ext = extensionFromUrl(url) || 'jpg';
    const key = renderOssKey({
      mediaConfig,
      platform: job.platform,
      accountId: job.accountId,
      entityType: job.entityType,
      entityId: job.entityId,
      imageType: job.imageType,
      dateValue: job.dateValue,
      ext,
      now,
    });
    const publicUrl = publicUrlForOssKey(mediaConfig, key);
    if (sourceKey === key || await ossObjectExists(client, key)) {
      return {
        url: publicUrl,
        skippedExisting: true,
        skipReason: sourceKey === key ? 'already_public_url' : 'existing_oss_object',
      };
    }
    if (typeof client.copy === 'function') {
      await client.copy(key, sourceKey);
      return { url: publicUrl, skippedExisting: false };
    }
  }
  const image = await downloadImageBuffer(url, { fetchImpl });
  const ext = extensionFromContentType(image.contentType) || extensionFromUrl(url) || 'jpg';
  const key = renderOssKey({
    mediaConfig,
    platform: job.platform,
    accountId: job.accountId,
    entityType: job.entityType,
    entityId: job.entityId,
    imageType: job.imageType,
    dateValue: job.dateValue,
    ext,
    now,
  });
  const publicUrl = publicUrlForOssKey(mediaConfig, key);
  if (await ossObjectExists(client, key)) {
    return { url: publicUrl, skippedExisting: true, skipReason: 'existing_oss_object' };
  }
  await client.put(key, image.buffer, {
    headers: image.contentType ? { 'Content-Type': image.contentType } : undefined,
  });
  return { url: publicUrl, skippedExisting: false };
}

export async function materializeScrmImageUrl(url, job, {
  mediaConfig = {},
  client = undefined,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const configStatus = validateOssMediaConfig(mediaConfig);
  if (!configStatus.enabled) {
    return { status: 'skipped', reason: 'SCRM media backend is not configured.', url: ensureText(url) };
  }
  if (!isHttpImageUrl(url)) {
    return { status: 'skipped', reason: 'Image URL is empty or not HTTP(S).', url: ensureText(url) };
  }
  const ossClient = client || createOssClient(mediaConfig);
  const result = await uploadImageToOss(ensureText(url), job, {
    mediaConfig,
    client: ossClient,
    fetchImpl,
    now,
  });
  return {
    status: result.skippedExisting ? 'skipped_existing' : 'uploaded',
    url: result.url,
  };
}

function buildMediaJobs(payload = {}, platform = '') {
  const jobs = [];
  for (const work of payload.works || []) {
    jobs.push({
      row: work,
      field: 'front_img_url',
      platform,
      accountId: work.account_id,
      entityType: 'work',
      entityId: work.work_no || work.no,
      imageType: 'cover',
      dateValue: work.public_at || work.created_at,
    });
  }
  for (const comment of payload.comments || []) {
    jobs.push({
      row: comment,
      field: 'comment_user_photo',
      platform,
      accountId: comment.account_id,
      entityType: 'comment',
      entityId: comment.comment_id,
      imageType: 'avatar',
      dateValue: comment.created_at,
    });
  }
  for (const record of payload.records || []) {
    if ('account_photo' in record) {
      jobs.push({
        row: record,
        field: 'account_photo',
        platform,
        accountId: record.account_id,
        entityType: 'account',
        entityId: record.account_id,
        imageType: 'avatar',
        dateValue: record.updated_at || record.created_at,
      });
    }
    if ('comment_user_photo' in record) {
      jobs.push({
        row: record,
        field: 'comment_user_photo',
        platform,
        accountId: record.account_id,
        entityType: record.danmaku_id ? 'danmaku' : 'message',
        entityId: record.danmaku_id || record.comment_id,
        imageType: 'avatar',
        dateValue: record.created_at,
      });
    }
  }
  return jobs;
}

export async function materializeScrmPayloadMedia(payload = {}, {
  platform = '',
  mediaConfig = {},
  client = undefined,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const configStatus = validateOssMediaConfig(mediaConfig);
  if (!configStatus.enabled) {
    return {
      payload,
      summary: {
        status: 'skipped',
        reason: 'SCRM media backend is not configured.',
        skipped_reasons: { backend_not_configured: 1 },
      },
    };
  }

  const ossClient = client || createOssClient(mediaConfig);
  const jobs = buildMediaJobs(payload, platform)
    .filter((job) => isHttpImageUrl(job.row?.[job.field]));
  const summary = {
    status: 'ok',
    backend: mediaConfig.backend,
    attempted: 0,
    uploaded: 0,
    skipped_existing: 0,
    skipped_reasons: {
      already_public_url: 0,
      existing_oss_object: 0,
    },
    failed: 0,
    warnings: [],
  };

  for (const job of jobs) {
    const sourceUrl = ensureText(job.row[job.field]);
    if (isExpectedPublicMediaUrl(sourceUrl, job, { mediaConfig, now })) {
      summary.skipped_existing += 1;
      summary.skipped_reasons.already_public_url += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      const uploaded = await uploadImageToOss(sourceUrl, job, {
        mediaConfig,
        client: ossClient,
        fetchImpl,
        now,
      });
      job.row[job.field] = uploaded.url;
      if (uploaded.skippedExisting) {
        summary.skipped_existing += 1;
        if (uploaded.skipReason && summary.skipped_reasons[uploaded.skipReason] !== undefined) {
          summary.skipped_reasons[uploaded.skipReason] += 1;
        }
        continue;
      }
      summary.uploaded += 1;
    } catch (error) {
      job.row[job.field] = '';
      summary.failed += 1;
      summary.warnings.push(`Failed to materialize ${job.entityType}:${job.entityId}:${job.imageType}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (summary.failed > 0) summary.status = 'warning';
  return { payload, summary };
}
