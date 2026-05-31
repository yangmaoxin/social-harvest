import {
  DOUYIN_CREATOR_DANMAKU_MANAGE_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  formatDouyinTimestamp,
  normalizeDouyinCommentLimit,
  normalizeDouyinPageLimit,
  normalizeDouyinVideoLimit,
} from './shared.js';
import { preserveCreatorJsonLargeIdValues } from './creator-works.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

const DOUYIN_CREATOR_DANMAKU_LIST_PATH = '/web/api/third_party/aweme/v1/danmaku/manage/list/';
const DOUYIN_CREATOR_APP_ID = '2906';

export const douyinCreatorDanmakuSpec = {
  site: 'douyin',
  name: 'skill-creator-danmaku',
  description: '抓取抖音创作者中心弹幕管理列表，输出后台弹幕基础字段',
  args: [
    { name: 'item_id', type: 'string', required: true, positional: true, help: 'Creator danmaku-management item_id, or auto to follow the currently selected work card' },
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_DANMAKU_MANAGE_URL, help: 'Douyin creator danmaku management URL' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum danmaku rows per page' },
    { name: 'offset', type: 'int', default: 0, help: 'offset value for creator danmaku list' },
    { name: 'pages', type: 'int', default: 1, help: 'Maximum danmaku pages' },
    { name: 'order_type', type: 'int', default: 1, help: 'Creator danmaku sort option passed to the manage list api' },
    { name: 'is_blocked', type: 'bool', default: false, help: 'Fetch blocked danmaku instead of normal danmaku' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
  ],
  columns: [
    'data_source',
    'rank',
    'danmaku_id',
    'item_id',
    'author',
    'author_uid',
    'author_sec_uid',
    'avatar_url',
    'text',
    'time',
    'create_time',
    'digg_count',
    'video_time',
    'video_position_seconds',
    'status_value',
    'has_more',
    'next_offset',
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

function normalizeVideoPositionSeconds(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim())) {
      const parts = value.trim().split(':').map((item) => Number(item));
      if (parts.every((item) => Number.isFinite(item))) {
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      continue;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    if (number > 1000) return Math.max(0, Math.round(number / 1000));
    return Math.max(0, Math.round(number));
  }
  return 0;
}

function formatVideoTime(seconds) {
  const totalSeconds = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function normalizeStatusValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      const text = firstNonEmpty(value.value, value.label, value.name, value.status);
      if (text) return text;
      continue;
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const text = firstNonEmpty(value);
    if (text) return text;
  }
  return '';
}

function normalizeCreatorDanmakuRow(item = {}, index = 0, context = {}) {
  const user = item.user && typeof item.user === 'object' ? item.user : {};
  const extra = item.extra && typeof item.extra === 'object' ? item.extra : {};
  const createTime = firstNonEmpty(item.create_time, item.createTime, item.timestamp, item.time);
  const videoPositionSeconds = normalizeVideoPositionSeconds(
    item.video_position_seconds,
    item.video_position,
    item.position_seconds,
    item.position,
    item.offset_seconds,
    item.offset_time,
    item.play_time_seconds,
    item.play_time,
    item.video_time,
  );
  return {
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    rank: index + 1,
    danmaku_id: firstNonEmpty(item.danmaku_id, item.id, item.comment_id, item.cid, item.bullet_id),
    item_id: firstNonEmpty(context.aweme_id, context.item_id, item.item_id, item.aweme_id),
    author: firstNonEmpty(user.nickname, user.name, item.user_name, item.nickname, extra.nickname, item.author),
    author_uid: firstNonEmpty(user.uid, user.user_id, item.user_id, item.uid),
    author_sec_uid: firstNonEmpty(user.sec_uid, user.secUid, item.sec_uid, item.secUid),
    avatar_url: firstNonEmpty(
      firstArrayValue(user.avatar_thumb?.url_list, user.avatar_medium?.url_list, user.avatar_larger?.url_list),
      user.avatar_url,
      extra.avatar_url,
      item.avatar_url,
    ),
    text: firstNonEmpty(item.text, item.content, item.danmaku_text, item.danmaku_content),
    time: formatDouyinTimestamp(createTime),
    create_time: String(createTime),
    digg_count: firstNumber(item.digg_count, item.diggCount, item.like_count, item.likeCount),
    video_time: firstNonEmpty(item.video_time_text, item.video_time, item.play_time_text) || formatVideoTime(videoPositionSeconds),
    video_position_seconds: videoPositionSeconds,
    status_value: normalizeStatusValue(item.status_value, item.status, item.audit_status, item.is_blocked),
    has_more: Boolean(context.has_more),
    next_offset: String(context.next_offset ?? ''),
    source_url_path: String(context.source_url_path || ''),
  };
}

function normalizeCreatorDanmakuListResponse(data = {}, options = {}) {
  const items = Array.isArray(data.danmaku_list)
    ? data.danmaku_list
    : Array.isArray(data.list)
      ? data.list
      : [];
  const limit = normalizeDouyinCommentLimit(options.limit ?? items.length, 20);
  const hasMore = data.has_more === true || Number(data.has_more ?? data.hasMore ?? 0) > 0;
  const nextOffset = data.offset ?? data.next_offset ?? data.nextOffset ?? (hasMore ? Number(options.offset || 0) + items.length : '');
  const context = {
    item_id: options.item_id,
    aweme_id: options.aweme_id,
    has_more: hasMore,
    next_offset: nextOffset,
    source_url_path: options.source_url_path || '',
  };
  return items
    .map((item, index) => normalizeCreatorDanmakuRow(item, index, context))
    .filter((row) => row.danmaku_id || row.text)
    .slice(0, limit);
}

function buildCreatorDanmakuRequest(params) {
  return {
    path: DOUYIN_CREATOR_DANMAKU_LIST_PATH,
    params: {
      app_id: DOUYIN_CREATOR_APP_ID,
      ...params,
    },
  };
}

function normalizeCreatorDanmakuTargetRow(item = {}, index = 0, context = {}) {
  return {
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    rank: index + 1,
    item_id: firstNonEmpty(item.item_id, item.id),
    aweme_id: firstNonEmpty(item.item_id_plain, item.aweme_id, item.item_id, item.id),
    title: firstNonEmpty(item.title, item.item_title, item.desc),
    create_time: firstNonEmpty(item.create_time),
    publish_time: formatDouyinTimestamp(item.create_time),
    danmaku_count: firstNumber(item.danmaku_count, item.bullet_count),
    creator_danmaku_target_has_more: Boolean(context.has_more),
    creator_danmaku_target_next_cursor: String(context.next_cursor ?? ''),
  };
}

async function fetchCreatorDanmakuPage(page, request) {
  const result = await page.evaluate(`
    (async () => {
      const request = ${JSON.stringify(request)};
      const preserveLargeIds = ${preserveCreatorJsonLargeIdValues.toString()};
      const safeJson = async (response) => {
        const text = await response.text();
        try { return JSON.parse(preserveLargeIds(text)); } catch {}
        try { return JSON.parse(text); } catch { return null; }
      };
      const parsed = new URL(request.path, window.location.origin);
      for (const [key, value] of Object.entries(request.params || {})) {
        if (value === null || value === undefined || value === '') continue;
        parsed.searchParams.set(key, String(value));
      }
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
    throw new Error(`douyin creator danmaku request failed: ${result?.status || 'unknown'}`);
  }
  return result;
}

export async function fetchDouyinCreatorDanmakuTargets(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_DANMAKU_MANAGE_URL);
  const limit = normalizeDouyinVideoLimit(kwargs.limit ?? 20, 20);
  const cursor = String(kwargs.cursor ?? '0');
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator danmaku targets.');
  }

  const result = await fetchCreatorDanmakuPage(page, {
    path: '/aweme/v1/creator/item/list',
    params: { cursor, count: limit },
  });
  const items = Array.isArray(result.data?.item_info_list) ? result.data.item_info_list : [];
  const hasMore = result.data?.has_more === true || Number(result.data?.has_more ?? result.data?.hasMore ?? 0) > 0;
  const nextCursor = result.data?.cursor ?? result.data?.next_cursor ?? result.data?.max_cursor ?? '';
  return items
    .map((item, index) => normalizeCreatorDanmakuTargetRow(item, index, {
      has_more: hasMore,
      next_cursor: hasMore ? nextCursor : '',
    }))
    .filter((row) => row.item_id || row.aweme_id)
    .slice(0, limit);
}

async function detectSelectedCreatorDanmakuCard(page) {
  return page.evaluate(`
    (() => {
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const nodes = Array.from(document.querySelectorAll('button,a,div,span'));
      const rawCards = [];
      const seen = new Set();
      for (const node of nodes) {
        const text = normalizeText(node.textContent);
        if (!text) continue;
        if (!(text.includes('全部作品') || /弹\\s*\\d+/i.test(text))) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 24) continue;
        const key = [text, Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const html = String(node.innerHTML || '');
        const ariaSelected = node.getAttribute('aria-selected');
        const ariaChecked = node.getAttribute('aria-checked');
        const className = typeof node.className === 'string' ? node.className : '';
        const selected = /tick|selected|active|checked/i.test(html)
          || /selected|active|checked/i.test(className)
          || ariaSelected === 'true'
          || ariaChecked === 'true';
        rawCards.push({
          text,
          selected,
          top: rect.top,
          left: rect.left,
        });
      }
      rawCards.sort((left, right) => left.top - right.top || left.left - right.left);
      const workCards = rawCards.filter((item) => !item.text.includes('全部作品'));
      const selectedIndex = workCards.findIndex((item) => item.selected);
      return {
        selected_index: selectedIndex,
        card_texts: workCards.map((item) => item.text),
      };
    })()
  `);
}

async function resolveCreatorDanmakuTarget(page, itemId, kwargs = {}) {
  const limit = normalizeDouyinVideoLimit(kwargs.limit ?? 20, 20);
  const targets = await fetchDouyinCreatorDanmakuTargets(page, {
    url: kwargs.url,
    wait_seconds: kwargs.wait_seconds,
    limit: Math.max(limit, 5),
  });
  if (itemId !== 'auto') {
    const matchedTarget = targets.find((target) => target.item_id === itemId || target.aweme_id === itemId) || null;
    const resolvedItemId = firstNonEmpty(matchedTarget?.item_id, itemId);
    const resolvedAwemeId = firstNonEmpty(matchedTarget?.aweme_id, itemId);
    return {
      item_id: resolvedItemId,
      aweme_id: resolvedAwemeId,
      request_item_id: firstNonEmpty(resolvedAwemeId, resolvedItemId),
    };
  }

  const cardState = await detectSelectedCreatorDanmakuCard(page).catch(() => ({
    selected_index: -1,
    card_texts: [],
  }));
  if (targets.length < Math.max((Number(cardState?.selected_index) || 0) + 1, 1)) {
    const refreshedTargets = await fetchDouyinCreatorDanmakuTargets(page, {
      url: kwargs.url,
      wait_seconds: kwargs.wait_seconds,
      limit: Math.max(limit, (Number(cardState?.selected_index) || 0) + 1, 5),
    });
    if (refreshedTargets.length > 0) {
      targets.splice(0, targets.length, ...refreshedTargets);
    }
  }
  const selectedIndex = Number(cardState?.selected_index);
  const target = Number.isInteger(selectedIndex) && selectedIndex >= 0
    ? targets[selectedIndex] || null
    : null;
  const fallbackTarget = target || targets[0] || null;
  const resolvedItemId = firstNonEmpty(fallbackTarget?.item_id);
  const resolvedAwemeId = firstNonEmpty(fallbackTarget?.aweme_id, resolvedItemId);
  if (!resolvedItemId && !resolvedAwemeId) {
    throw new Error('douyin creator danmaku item list is empty');
  }
  return {
    item_id: resolvedItemId,
    aweme_id: resolvedAwemeId,
    request_item_id: firstNonEmpty(resolvedAwemeId, resolvedItemId),
  };
}

export async function fetchDouyinCreatorDanmakuRows(page, kwargs = {}) {
  const itemId = String(kwargs.item_id ?? '').trim();
  if (!itemId) throw new Error('item_id is required');

  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_DANMAKU_MANAGE_URL);
  const limit = normalizeDouyinCommentLimit(kwargs.limit ?? 20, 20);
  const pages = normalizeDouyinPageLimit(kwargs.pages ?? 1, 1);
  const orderType = Number(kwargs.order_type ?? 1) || 1;
  const isBlocked = kwargs.is_blocked === true || String(kwargs.is_blocked ?? '').toLowerCase() === 'true';
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));
  const onProgress = typeof kwargs.onProgress === 'function' ? kwargs.onProgress : () => {};

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator danmaku.');
  }

  const target = await resolveCreatorDanmakuTarget(page, itemId, {
    url: targetUrl,
    wait_seconds: waitSeconds,
    limit: 20,
  });
  const rows = [];
  let offset = Math.max(0, Number(kwargs.offset ?? 0) || 0);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const result = await fetchCreatorDanmakuPage(page, buildCreatorDanmakuRequest({
      count: limit,
      offset,
      order_type: orderType,
      item_id: firstNonEmpty(target.request_item_id, target.aweme_id, target.item_id),
      is_blocked: isBlocked,
    }));
    const pageRows = normalizeCreatorDanmakuListResponse(result.data, {
      item_id: target.item_id,
      aweme_id: target.aweme_id,
      limit,
      offset,
      source_url_path: result.source_url_path,
    });
    rows.push(...pageRows);
    onProgress({
      step: 'danmaku-page',
      message: `弹幕第 ${pageIndex + 1} 页返回 ${pageRows.length} 条，当前作品累计弹幕 ${rows.length} 条`,
      pageNumber: pageIndex + 1,
      receivedCount: pageRows.length,
      accumulatedRows: rows.length,
    });
    const hasMore = result.data?.has_more === true || Number(result.data?.has_more ?? result.data?.hasMore ?? 0) > 0;
    if (!hasMore || pageRows.length === 0) break;
    offset += pageRows.length;
  }
  return rows;
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-danmaku',
    description: douyinCreatorDanmakuSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_DANMAKU_MANAGE_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinCreatorDanmakuSpec.args,
    columns: douyinCreatorDanmakuSpec.columns,
    func: async (page, kwargs) => fetchDouyinCreatorDanmakuRows(page, kwargs),
  });
}
