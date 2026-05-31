import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { imageRequestHeaders } from './image-request-headers.js';
import { ensureText } from './scrm-base.js';

const DEFAULT_IMAGE_USER_AGENT = 'Social Harvest/1.0 (+https://github.com)';
const DEFAULT_IMAGE_TIMEOUT_MS = 60_000;
const IMAGE_CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry(fn, {
  retries = 3,
  delayMs = 1200,
} = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const canRetry = /limited|rate|timeout|ECONNRESET|ETIMEDOUT|800004135/i.test(message);
      if (!canRetry || attempt >= retries) break;
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}

function extensionFromContentType(contentType = '') {
  const normalized = ensureText(contentType).split(';')[0].trim().toLowerCase();
  return IMAGE_CONTENT_TYPES.get(normalized) || 'jpg';
}

function safeFilePart(value = '') {
  return ensureText(value)
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

async function localUploadImage(filePath = '') {
  const sourcePath = ensureText(filePath);
  if (!sourcePath) return null;
  const stat = await fs.stat(sourcePath);
  return {
    filePath: sourcePath,
    fileName: path.basename(sourcePath),
    size: stat.size,
    source_url: sourcePath,
  };
}

async function localUploadFile(filePath = '') {
  return localUploadImage(filePath);
}

async function fetchImageBuffer(url, {
  fetchImpl = globalThis.fetch,
  userAgent = DEFAULT_IMAGE_USER_AGENT,
  timeoutMs = Number(process.env.HARVEST_IMAGE_DOWNLOAD_TIMEOUT_MS || DEFAULT_IMAGE_TIMEOUT_MS),
} = {}) {
  if (!fetchImpl) throw new Error('Missing fetch implementation for image download.');
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_IMAGE_TIMEOUT_MS;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: imageRequestHeaders(url, { userAgent }),
      signal: AbortSignal.timeout(effectiveTimeoutMs),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error(`download timeout after ${effectiveTimeoutMs}ms`);
    }
    throw error;
  }
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
  const contentType = response.headers?.get?.('content-type') || '';
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
  };
}

async function compressPreviewImage(buffer, {
  imageKind = 'cover',
  maxSize = imageKind === 'avatar' ? 240 : 1280,
} = {}) {
  return sharp(buffer)
    .rotate()
    .resize({
      width: maxSize,
      height: maxSize,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: imageKind === 'avatar' ? 72 : 85,
      mozjpeg: true,
    })
    .toBuffer();
}

export async function downloadDisplayImage(url, {
  tempDir,
  sourceKey,
  fieldName,
  imageKind = 'cover',
  fetchImpl = globalThis.fetch,
} = {}) {
  const imageUrl = ensureText(url);
  if (!imageUrl) throw new Error('Missing image URL.');
  const outputDir = ensureText(tempDir);
  if (!outputDir) throw new Error('Missing tempDir for image attachment.');
  await fs.mkdir(outputDir, { recursive: true });

  const { buffer, contentType } = await fetchImageBuffer(imageUrl, { fetchImpl });
  let outputBuffer = buffer;
  let extension = extensionFromContentType(contentType);
  try {
    outputBuffer = await compressPreviewImage(buffer, { imageKind });
    extension = 'jpg';
  } catch {
    // Keep the original bytes when the platform returns a format sharp cannot decode.
  }

  const filename = `${safeFilePart(sourceKey)}-${safeFilePart(fieldName)}.${extension}`;
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, outputBuffer);
  return {
    filePath,
    fileName: filename,
    size: outputBuffer.length,
    source_url: imageUrl,
  };
}

export async function uploadDisplayAttachments(client, tableId, attachmentJobs = [], {
  tempDir,
  fetchImpl = globalThis.fetch,
  refresh = false,
} = {}) {
  const rawJobs = Array.isArray(attachmentJobs) ? attachmentJobs : [];
  if (!rawJobs.length) return { attempted: 0, uploaded: 0, failed: 0, warnings: [] };
  const fieldNamesToRead = [...new Set(rawJobs.flatMap((job) => [
    ensureText(job.field_name),
    ensureText(job.marker_field_name),
  ]).filter(Boolean))];

  const [fields, recordsBySourceKey] = await Promise.all([
    client.listFields(tableId),
    client.listRecordsBySourceKey(tableId, { fieldNames: fieldNamesToRead, fullFields: true }),
  ]);
  const fieldNames = new Set(fields.map((field) => ensureText(field.field_name || field.name)).filter(Boolean));
  const groups = new Map();
  for (const job of rawJobs) {
    const sourceKey = ensureText(job.source_key);
    const fieldName = ensureText(job.field_name);
    const markerFieldName = ensureText(job.marker_field_name);
    const url = ensureText(job.url);
    if (!sourceKey || !fieldName || !url) continue;
    const groupKey = `${sourceKey}\0${fieldName}\0${markerFieldName}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        source_key: sourceKey,
        field_name: fieldName,
        marker_field_name: markerFieldName,
        image_kind: job.image_kind,
        attachment_kind: job.attachment_kind,
        items: [],
      });
    }
    const group = groups.get(groupKey);
    if (!group.items.some((item) => item.url === url)) {
      group.items.push({
        url,
        file_path: ensureText(job.file_path),
      });
    }
  }
  const warnings = [];
  let attempted = 0;
  let uploaded = 0;
  let skippedExisting = 0;

  for (const group of groups.values()) {
    const sourceKey = ensureText(group.source_key);
    const fieldName = ensureText(group.field_name);
    const markerFieldName = ensureText(group.marker_field_name);
    const urls = group.items.map((item) => item.url);
    const markerValue = urls.length > 1 ? JSON.stringify(urls) : ensureText(urls[0]);
    attempted += group.items.length;

    const record = recordsBySourceKey.get(sourceKey);
    if (!record?.id) {
      warnings.push(`Skip ${fieldName} attachment for ${sourceKey}: record not found.`);
      continue;
    }
    if (!fieldNames.has(fieldName)) {
      warnings.push(`Skip ${fieldName} attachment for ${sourceKey}: field not found.`);
      continue;
    }
    const existingMarkerUrl = ensureText(record.fields?.[markerFieldName]);
    if (!refresh && markerFieldName && existingMarkerUrl === markerValue) {
      skippedExisting += group.items.length;
      continue;
    }
    const existingAttachment = record.fields?.[fieldName];
    if (!refresh && Array.isArray(existingAttachment) && existingAttachment.length > 0) {
      if (markerFieldName && existingMarkerUrl !== markerValue) {
        await withRetry(() => client.updateRecordFields(tableId, record.id, {
          [markerFieldName]: markerValue,
        }));
      }
      skippedExisting += group.items.length;
      continue;
    }

    try {
      const fileTokens = [];
      for (const [index, item] of group.items.entries()) {
        const hasLocalFile = Boolean(ensureText(item.file_path));
        if (!hasLocalFile && group.attachment_kind === 'video') {
          throw new Error('local video file is required before uploading to Feishu.');
        }
        const file = hasLocalFile
          ? await localUploadFile(item.file_path)
          : await downloadDisplayImage(item.url, {
            tempDir,
            sourceKey,
            fieldName: `${fieldName}-${index + 1}`,
            imageKind: group.image_kind,
            fetchImpl,
          });
        const fileToken = await withRetry(() => client.uploadMediaAll(file.filePath, {
          fileName: file.fileName,
          size: file.size,
        }));
        fileTokens.push({ file_token: fileToken });
        await sleep(250);
      }
      const fields = { [fieldName]: fileTokens };
      if (markerFieldName) fields[markerFieldName] = markerValue;
      await withRetry(() => client.updateRecordFields(tableId, record.id, fields));
      uploaded += group.items.length;
    } catch (error) {
      warnings.push(`Skip ${fieldName} attachment for ${sourceKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    attempted,
    uploaded,
    skipped_existing: skippedExisting,
    failed: attempted - uploaded - skippedExisting,
    warnings,
  };
}
