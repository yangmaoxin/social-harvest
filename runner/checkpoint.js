import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_MAX_ITEMS = 0;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|y)$/i.test(String(value));
}

function parsePositiveInt(value, fallback = DEFAULT_BATCH_SIZE) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback = DEFAULT_MAX_ITEMS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function normalizeLongTaskOptions(options = {}) {
  return {
    full: parseBoolean(options.full, false),
    batchSize: parsePositiveInt(options.batchSize ?? options.batch_size, DEFAULT_BATCH_SIZE),
    maxItems: parseNonNegativeInt(options.maxItems ?? options.max_items, DEFAULT_MAX_ITEMS),
    resume: options.resume === undefined ? true : parseBoolean(options.resume, true),
    refresh: parseBoolean(options.refresh, false),
  };
}

export function parseLongTaskFlag(argv = [], index = 0, options = {}) {
  const arg = argv[index];
  if (arg === '--full') {
    options.full = true;
    return index;
  }
  if (arg === '--batch-size') {
    options.batchSize = parsePositiveInt(argv[index + 1], DEFAULT_BATCH_SIZE);
    return index + 1;
  }
  if (arg === '--max-items') {
    options.maxItems = parseNonNegativeInt(argv[index + 1], DEFAULT_MAX_ITEMS);
    return index + 1;
  }
  if (arg === '--resume') {
    options.resume = true;
    return index;
  }
  if (arg === '--no-resume') {
    options.resume = false;
    return index;
  }
  if (arg === '--refresh') {
    options.refresh = true;
    return index;
  }
  return -1;
}

export function parseLongTaskArgs(argv = [], defaults = {}) {
  const options = normalizeLongTaskOptions(defaults);
  const passThrough = [];
  for (let index = 0; index < argv.length; index += 1) {
    const nextIndex = parseLongTaskFlag(argv, index, options);
    if (nextIndex >= index) {
      index = nextIndex;
      continue;
    }
    passThrough.push(argv[index]);
  }
  return { ...normalizeLongTaskOptions(options), passThrough };
}

export function checkpointPathFor(outputDir, filename = 'checkpoint.json') {
  if (!outputDir) throw new Error('outputDir is required for checkpointPathFor.');
  return path.join(outputDir, filename);
}

export function createCheckpoint(options = {}) {
  const longTask = normalizeLongTaskOptions(options);
  const now = new Date().toISOString();
  return {
    version: 1,
    platform: String(options.platform || ''),
    task: String(options.task || ''),
    mode: longTask.full ? 'full' : 'default',
    batch_size: longTask.batchSize,
    max_items: longTask.maxItems,
    current_batch: Number(options.currentBatch || options.current_batch || 0),
    next_cursor: String(options.nextCursor ?? options.next_cursor ?? ''),
    next_page: Number(options.nextPage ?? options.next_page ?? 1),
    has_more: options.hasMore ?? options.has_more ?? true,
    status: String(options.status || 'running'),
    cursors: options.cursors && typeof options.cursors === 'object' ? options.cursors : {},
    completed_count: Number(options.completedCount ?? options.completed_count ?? 0),
    failed_count: Number(options.failedCount ?? options.failed_count ?? 0),
    completed_items: options.completedItems || options.completed_items || {},
    failed_items: options.failedItems || options.failed_items || {},
    warnings: Array.isArray(options.warnings) ? options.warnings : [],
    created_at: String(options.createdAt || options.created_at || now),
    updated_at: now,
  };
}

export function loadCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function saveCheckpoint(filePath, checkpoint) {
  if (!filePath) throw new Error('filePath is required for saveCheckpoint.');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = {
    ...checkpoint,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function resetCheckpoint(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

export function updateCheckpoint(filePath, updater) {
  const current = loadCheckpoint(filePath);
  const patch = typeof updater === 'function' ? updater(current) : updater;
  const next = {
    ...(current || {}),
    ...(patch || {}),
  };
  return saveCheckpoint(filePath, next);
}

export function markCheckpointItem(checkpoint, itemId, patch = {}, status = 'completed') {
  const key = String(itemId || '').trim();
  if (!key) return checkpoint;
  const next = {
    ...checkpoint,
    completed_items: { ...(checkpoint.completed_items || {}) },
    failed_items: { ...(checkpoint.failed_items || {}) },
  };
  if (status === 'failed') {
    delete next.completed_items[key];
    next.failed_items[key] = { status: 'failed', ...patch };
  } else {
    delete next.failed_items[key];
    next.completed_items[key] = { status: 'completed', ...patch };
  }
  next.completed_count = Object.keys(next.completed_items).length;
  next.failed_count = Object.keys(next.failed_items).length;
  return next;
}

export function checkpointCursor(checkpoint = {}, key = '', fallback = '') {
  if (!key) return fallback;
  const cursors = checkpoint?.cursors && typeof checkpoint.cursors === 'object' ? checkpoint.cursors : {};
  return cursors[key] ?? fallback;
}

export function setCheckpointCursor(checkpoint = {}, key = '', value = '') {
  if (!key) return checkpoint;
  return {
    ...checkpoint,
    cursors: {
      ...(checkpoint.cursors || {}),
      [key]: value,
    },
  };
}

export function setCheckpointCursors(checkpoint = {}, patch = {}) {
  return {
    ...checkpoint,
    cursors: {
      ...(checkpoint.cursors || {}),
      ...(patch || {}),
    },
  };
}
