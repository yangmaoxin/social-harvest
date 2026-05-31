import {
  DOUYIN_CREATOR_CONTENT_MANAGE_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  formatDouyinTimestamp,
  normalizeDouyinVideoLimit,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

const DOUYIN_CREATOR_WORK_LIST_PREFETCH_URL = 'https://creator.douyin.com/goofy/douyin_creator_pc/mono/prefetch/creator_content/manage/prefetch.json';

export function preserveCreatorJsonLargeIdValues(text) {
  return String(text ?? '').replace(/(?<!\\)"([^"\\]*(?:id|ID|Id)[^"\\]*)"\s*:\s*(-?\d{16,})(?=\s*[,}])/g, '"$1":"$2"');
}

export const douyinCreatorWorksSpec = {
  site: 'douyin',
  name: 'skill-creator-works',
  description: '抓取抖音创作者中心作品管理列表，输出作品基础字段和指标摘要',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_CONTENT_MANAGE_URL, help: 'Douyin creator content management URL' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum works to return' },
    { name: 'cursor', type: 'string', default: '0', help: 'max_cursor value for creator work_list' },
    { name: 'status', type: 'string', default: '0', help: 'Creator work status filter passed to work_list' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
  ],
  columns: [
    'data_source',
    'rank',
    'aweme_id',
    'item_id',
    'title',
    'desc',
    'file_type',
    'aweme_type',
    'creator_type',
    'visibility',
    'status_value',
    'create_time',
    'publish_time',
    'cover_url',
    'share_url',
    'play_count',
    'digg_count',
    'comment_count',
    'share_count',
    'collect_count',
    'metrics',
    'has_more',
    'next_cursor',
    'source_url_path',
  ],
};

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function firstArrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value[0];
  }
  return '';
}

function firstStatusValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      const text = firstNonEmpty(value.value, value.name, value.label, value.status);
      if (text) return text;
      continue;
    }
    const text = firstNonEmpty(value);
    if (text) return text;
  }
  return '';
}

function chooseCreatorDisplayTitle(primaryTitle, description) {
  const title = firstNonEmpty(primaryTitle);
  const desc = firstNonEmpty(description);
  if (!desc) return title;
  if (!title) return desc;
  if (desc === title) return desc;
  if (desc.startsWith(title)) return desc;
  return title;
}

function pickMetrics(item = {}, aweme = {}) {
  const metrics = item.metrics && typeof item.metrics === 'object' ? item.metrics : {};
  const statistics = aweme.statistics && typeof aweme.statistics === 'object' ? aweme.statistics : {};
  return {
    ...statistics,
    ...metrics,
  };
}

function normalizeCreatorWorkRow(raw = {}, index = 0, context = {}) {
  const aweme = raw.aweme && typeof raw.aweme === 'object' ? raw.aweme : {};
  const item = raw.item && typeof raw.item === 'object' ? raw.item : {};
  const metrics = pickMetrics(item, aweme);
  const awemeId = firstNonEmpty(aweme.aweme_id, raw.aweme_id, aweme.item_id, raw.item_id, item.id);
  const itemId = firstNonEmpty(aweme.item_id, raw.item_id, item.item_id, item.id, aweme.aweme_id, raw.aweme_id);
  const createTime = firstNonEmpty(item.create_time, aweme.create_time, raw.create_time);
  const isImageText = Boolean(aweme.is_pic_word || aweme.is_slides || Array.isArray(aweme.images) || Array.isArray(aweme.image_infos));
  const primaryTitle = firstNonEmpty(aweme.item_title, item.item_title, item.title, aweme.caption, item.description, raw.title);
  const description = firstNonEmpty(aweme.desc, item.description, item.title, aweme.caption, raw.desc);
  return {
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    rank: index + 1,
    aweme_id: awemeId,
    item_id: itemId,
    title: chooseCreatorDisplayTitle(primaryTitle, description),
    desc: description,
    file_type: isImageText ? 'image_text' : 'video',
    aweme_type: String(firstNonEmpty(aweme.aweme_type, raw.aweme_type)),
    creator_type: String(firstNonEmpty(item.type, aweme.type, raw.type)),
    visibility: String(firstStatusValue(item.visibility, aweme.visibility, raw.visibility)),
    status_value: String(firstStatusValue(aweme.status_value, item.status, raw.status_value)),
    create_time: String(createTime),
    publish_time: formatDouyinTimestamp(createTime),
    cover_url: firstNonEmpty(
      firstArrayValue(item.cover?.url_list, aweme.Cover?.url_list, aweme.video?.cover?.url_list),
      item.cover?.uri,
      aweme.Cover?.uri,
    ),
    share_url: firstNonEmpty(aweme.share_url, aweme.share_info?.share_url, item.share_url),
    play_count: firstNumber(metrics.play_count, metrics.play, metrics.play_cnt, metrics.playCount),
    digg_count: firstNumber(metrics.digg_count, metrics.like_count, metrics.digg, metrics.like, metrics.diggCount),
    comment_count: firstNumber(metrics.comment_count, metrics.comment, metrics.comment_cnt, metrics.commentCount),
    share_count: firstNumber(metrics.share_count, metrics.share, metrics.share_cnt, metrics.shareCount),
    collect_count: firstNumber(metrics.collect_count, metrics.collect, metrics.collect_cnt, metrics.collectCount),
    metrics,
    has_more: Boolean(context.has_more),
    next_cursor: String(context.next_cursor ?? ''),
    source_url_path: String(context.source_url_path || ''),
  };
}

function normalizeCreatorWorkListResponse(data = {}, options = {}) {
  const awemeList = Array.isArray(data.aweme_list) ? data.aweme_list : [];
  const items = Array.isArray(data.items) ? data.items : [];
  const maxLength = Math.max(awemeList.length, items.length);
  const limit = normalizeDouyinVideoLimit(options.limit ?? maxLength, 20);
  const context = {
    has_more: Boolean(data.has_more),
    next_cursor: data.max_cursor ?? data.cursor ?? data.next_cursor ?? '',
    source_url_path: options.source_url_path || '',
  };
  return Array.from({ length: maxLength })
    .map((_, index) => normalizeCreatorWorkRow({
      aweme: awemeList[index] || {},
      item: items[index] || {},
    }, index, context))
    .filter((row) => row.aweme_id || row.item_id)
    .slice(0, limit);
}

export async function fetchDouyinCreatorWorkRows(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_CONTENT_MANAGE_URL);
  const limit = normalizeDouyinVideoLimit(kwargs.limit ?? 20, 20);
  const cursor = String(kwargs.cursor ?? '0');
  const status = String(kwargs.status ?? '0');
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator works.');
  }

  const result = await page.evaluate(`
    (async () => {
      const prefetchUrl = ${JSON.stringify(DOUYIN_CREATOR_WORK_LIST_PREFETCH_URL)};
      const limit = ${JSON.stringify(limit)};
      const cursor = ${JSON.stringify(cursor)};
      const status = ${JSON.stringify(status)};
      const preserveLargeIds = ${preserveCreatorJsonLargeIdValues.toString()};
      const safeJson = async (response) => {
        const text = await response.text();
        try { return JSON.parse(preserveLargeIds(text)); } catch {}
        try { return JSON.parse(text); } catch { return null; }
      };
      const findWorkListCall = (value, depth = 0) => {
        if (depth > 5 || value === null || value === undefined) return null;
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = findWorkListCall(item, depth + 1);
            if (found) return found;
          }
          return null;
        }
        if (typeof value === 'object') {
          if (typeof value.url === 'string' && /\\/work_list(?:[?#]|$)/.test(value.url)) return value;
          for (const child of Object.values(value)) {
            const found = findWorkListCall(child, depth + 1);
            if (found) return found;
          }
        }
        return null;
      };
      const prefetchResponse = await fetch(prefetchUrl, { credentials: 'include' });
      const prefetchJson = await safeJson(prefetchResponse);
      const call = findWorkListCall(prefetchJson);
      if (!call) {
        return {
          ok: false,
          error: 'creator_work_list_call_not_found',
          source_url_path: prefetchUrl,
          data: null,
        };
      }
      const parsed = new URL(call.url, window.location.origin);
      const params = call.params && typeof call.params === 'object' ? call.params : {};
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) continue;
        if (['string', 'number', 'boolean'].includes(typeof value)) parsed.searchParams.set(key, String(value));
      }
      parsed.searchParams.set('count', String(limit));
      parsed.searchParams.set('max_cursor', cursor);
      if (status) parsed.searchParams.set('status', status);
      const response = await fetch(parsed.toString(), { credentials: 'include' });
      const data = await safeJson(response);
      return {
        ok: response.ok,
        status: response.status,
        source_url_path: parsed.origin + parsed.pathname,
        data,
      };
    })()
  `);
  if (!result?.ok || !result?.data) {
    throw new Error(`douyin creator work_list failed: ${result?.error || result?.status || 'unknown'}`);
  }
  return normalizeCreatorWorkListResponse(result.data, {
    limit,
    source_url_path: result.source_url_path,
  });
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-works',
    description: douyinCreatorWorksSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_CONTENT_MANAGE_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinCreatorWorksSpec.args,
    columns: douyinCreatorWorksSpec.columns,
    func: async (page, kwargs) => fetchDouyinCreatorWorkRows(page, kwargs),
  });
}
