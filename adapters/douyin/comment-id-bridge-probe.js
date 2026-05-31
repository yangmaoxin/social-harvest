import {
  DOUYIN_CREATOR_COMMENT_MANAGE_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  DOUYIN_SOURCE_PUBLIC,
  fetchDouyinComments,
  fetchDouyinCommentReplies,
  normalizeDouyinCommentLimit,
} from './shared.js';
import { fetchDouyinCreatorCommentTargets } from './creator-comments.js';
import { preserveCreatorJsonLargeIdValues } from './creator-works.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

const CANDIDATE_FIELDS = [
  'comment_id_str',
  'cid',
  'group_id',
  'public_comment_id',
  'item_comment_id',
  'comment_id',
  'item_id',
  'aweme_id',
  'reply_id',
  'reply_to_reply_id',
  'root_comment_id',
  'extra',
];

const DISPLAY_FIELD_PATTERNS = [
  /nickname/i,
  /screen_?name/i,
  /avatar/i,
  /^name$/i,
  /ip_?label/i,
  /ip_?location/i,
  /^ip$/i,
  /province/i,
  /city/i,
  /region/i,
  /location/i,
];

export const douyinCommentIdBridgeProbeSpec = {
  site: 'douyin',
  name: 'skill-comment-id-bridge-probe',
  description: '低频诊断：检查抖音前台评论与创作者中心评论原始响应里是否存在桥接 ID 或额外字段',
  args: [
    { name: 'aweme_id', type: 'string', required: true, positional: true, help: 'Target public aweme_id to inspect' },
    { name: 'item_id', type: 'string', default: 'auto', help: 'Creator comment-management item_id, or auto to resolve from creator item list' },
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_COMMENT_MANAGE_URL, help: 'Creator comment management URL' },
    { name: 'limit', type: 'int', default: 10, help: 'Maximum top-level comments to inspect per source' },
    { name: 'reply_limit', type: 'int', default: 10, help: 'Maximum replies to inspect for the first reply-bearing comment per source' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after creator page load' },
  ],
  columns: [
    'data_source',
    'scope',
    'endpoint_path',
    'target_aweme_id',
    'target_item_id',
    'row_count',
    'selected_comment_id',
    'candidate_field_hits',
    'candidate_field_examples',
    'id_like_key_paths',
    'extra_key_paths',
    'encrypted_id_like_paths',
    'display_field_hits',
    'display_key_paths',
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

function normalizeRows(rows, limit) {
  return Array.isArray(rows) ? rows.slice(0, Math.max(1, Math.min(50, Number(limit || 10)))) : [];
}

function looksEncryptedId(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.startsWith('@if')) return true;
  return text.length >= 40 && /[+/=]/.test(text);
}

function matchesDisplayField(key = '') {
  return DISPLAY_FIELD_PATTERNS.some((pattern) => pattern.test(String(key || '')));
}

export function createProbeSummary(rows = []) {
  const fieldHits = Object.fromEntries(CANDIDATE_FIELDS.map((field) => [field, 0]));
  const fieldExamples = {};
  const idLikeKeyPaths = new Set();
  const extraKeyPaths = new Set();
  const encryptedIdLikePaths = new Set();
  const displayFieldHits = {};
  const displayFieldExamples = {};
  const displayKeyPaths = new Set();

  function visit(value, path = '', keyName = '') {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item) => visit(item, `${path}[]`, keyName));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value).slice(0, 80)) {
        const nextPath = path ? `${path}.${key}` : key;
        if (/id|cid|group/i.test(key)) {
          idLikeKeyPaths.add(nextPath);
        }
        if (matchesDisplayField(key)) {
          displayKeyPaths.add(nextPath);
          const sampleValue = typeof child === 'object' && child !== null
            ? JSON.stringify(child).slice(0, 200)
            : String(child ?? '').slice(0, 200);
          if ((Array.isArray(child) && child.length > 0) || (typeof child === 'object' && child && Object.keys(child).length > 0) || firstNonEmpty(child)) {
            displayFieldHits[key] = Number(displayFieldHits[key] || 0) + 1;
            if (!displayFieldExamples[key]) {
              displayFieldExamples[key] = {
                path: nextPath,
                sample: sampleValue,
              };
            }
          }
        }
        if (key === 'extra' || nextPath.includes('.extra')) {
          extraKeyPaths.add(nextPath);
        }
        if (CANDIDATE_FIELDS.includes(key)) {
          const sampleValue = typeof child === 'object' && child !== null
            ? JSON.stringify(child).slice(0, 200)
            : String(child ?? '').slice(0, 200);
          if ((Array.isArray(child) && child.length > 0) || (typeof child === 'object' && child && Object.keys(child).length > 0) || firstNonEmpty(child)) {
            fieldHits[key] += 1;
            if (!fieldExamples[key]) {
              fieldExamples[key] = {
                path: nextPath,
                sample: sampleValue,
              };
            }
          }
        }
        if (typeof child !== 'object' && /id|cid|group/i.test(key) && looksEncryptedId(child)) {
          encryptedIdLikePaths.add(nextPath);
        }
        visit(child, nextPath, key);
      }
      return;
    }
    if (/id|cid|group/i.test(keyName) && looksEncryptedId(value)) {
      encryptedIdLikePaths.add(path);
    }
  }

  for (const row of rows) visit(row);

  return {
    candidate_field_hits: fieldHits,
    candidate_field_examples: fieldExamples,
    id_like_key_paths: [...idLikeKeyPaths].sort(),
    extra_key_paths: [...extraKeyPaths].sort(),
    encrypted_id_like_paths: [...encryptedIdLikePaths].sort(),
    display_field_hits: displayFieldHits,
    display_field_examples: displayFieldExamples,
    display_key_paths: [...displayKeyPaths].sort(),
  };
}

export function summarizeDomCards(cards = []) {
  const rows = Array.isArray(cards) ? cards : [];
  return {
    row_count: rows.length,
    author_nonempty: rows.filter((row) => firstNonEmpty(row?.author)).length,
    avatar_nonempty: rows.filter((row) => firstNonEmpty(row?.avatar_url)).length,
    ip_nonempty: rows.filter((row) => firstNonEmpty(row?.ip_location)).length,
    time_nonempty: rows.filter((row) => firstNonEmpty(row?.time)).length,
    text_nonempty: rows.filter((row) => firstNonEmpty(row?.text)).length,
  };
}

async function readCreatorCommentDomCards(page, limit = 5) {
  return page.evaluate(({ cardLimit }) => {
    const timePattern = /刚刚|昨天|前天|\d+\s*(秒钟|秒|分钟|分|小时|天)前|\d{1,2}:\d{2}/;
    const actionPattern = /回复|删除|举报/;
    const skipPattern = /有爱评论|说点好听的|全部评论|全部人群|最新发布|高清发布|评论管理/;

    function getBackgroundImageUrl(element) {
      if (!element) return '';
      const style = window.getComputedStyle(element);
      const backgroundImage = style?.backgroundImage || '';
      const match = backgroundImage.match(/url\(["']?(.*?)["']?\)/i);
      return match?.[1] || '';
    }

    function visibleText(element) {
      return String(element?.innerText || '')
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean);
    }

    const markers = Array.from(document.querySelectorAll('[role="listitem"]'));
    const candidates = [];

    for (const marker of markers) {
      const element = marker.parentElement;
      if (!element) continue;
      const lines = visibleText(element);
      if (lines.length < 3) continue;
      const joined = lines.join('\n');
      if (!actionPattern.test(joined) || skipPattern.test(joined)) continue;
      const time = lines.find((line) => timePattern.test(line)) || '';
      if (!time) continue;
      const img = element.querySelector('img[src]');
      const avatarFallback = [
        marker.previousElementSibling,
        marker,
        element,
        ...Array.from(element.querySelectorAll('*')),
      ]
        .map((node) => getBackgroundImageUrl(node))
        .find(Boolean) || '';
      const avatarUrl = String(img?.getAttribute('src') || avatarFallback || '').trim();
      const author = lines[0] || '';
      const text = lines.find((line, index) => index > 0 && line !== time && !actionPattern.test(line)) || '';
      const ipLocation = lines.find((line) => /IP|来自|天津|北京|上海|广东|浙江|江苏|福建|山东|河北|河南|湖北|湖南|四川|重庆|安徽|江西|辽宁|吉林|黑龙江|陕西|山西|云南|贵州|广西|海南|甘肃|青海|宁夏|新疆|内蒙古|西藏/.test(line)) || '';
      candidates.push({
        author,
        time,
        text,
        avatar_url: avatarUrl,
        ip_location: ipLocation,
      });
    }

    const unique = [];
    const seen = new Set();
    for (const card of candidates) {
      const key = `${card.author}__${card.time}__${card.text}`;
      if (!card.author || !card.text || seen.has(key)) continue;
      seen.add(key);
      unique.push(card);
      if (unique.length >= cardLimit) break;
    }
    return unique;
  }, { cardLimit: Math.max(1, Math.min(10, Number(limit || 5))) });
}

async function inspectCreatorCommentDomState(page, limit = 3) {
  return page.evaluate(({ rowLimit }) => {
    const displayKeyPattern = /(nickname|name|avatar|ip_?label|ip_?location)/i;
    const actionPattern = /回复|删除|举报/;
    const timePattern = /刚刚|昨天|前天|\d+\s*(秒钟|秒|分钟|分|小时|天)前|\d{1,2}:\d{2}/;
    const skipPattern = /有爱评论|说点好听的|全部评论|全部人群|最新发布|高清发布|评论管理|没有更多评论/;

    function visibleLines(element) {
      return String(element?.innerText || '')
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean);
    }

    function findRowRoot(marker) {
      const direct = marker?.nextElementSibling;
      const candidates = [
        direct,
        marker?.parentElement,
        marker?.parentElement?.nextElementSibling,
        marker?.parentElement?.parentElement,
        marker?.parentElement?.parentElement?.nextElementSibling,
      ].filter(Boolean);
      return candidates.find((node) => {
        const lines = visibleLines(node);
        const joined = lines.join('\n');
        return lines.length >= 3
          && actionPattern.test(joined)
          && lines.some((line) => timePattern.test(line))
          && !skipPattern.test(joined);
      }) || null;
    }

    function getReactPayload(element) {
      let current = element;
      while (current) {
        const keys = Object.keys(current).filter((key) => key.startsWith('__reactProps$') || key.startsWith('__reactFiber$'));
        for (const key of keys) {
          const value = current[key];
          if (key.startsWith('__reactProps$') && value) {
            return { carrier: current.tagName, kind: 'props', value };
          }
          if (key.startsWith('__reactFiber$') && value?.memoizedProps) {
            return { carrier: current.tagName, kind: 'fiber', value: value.memoizedProps };
          }
        }
        current = current.parentElement;
      }
      return null;
    }

    function summarizePayload(value) {
      const displayPaths = [];
      const examples = {};
      const queue = [{ value, path: '', depth: 0 }];
      const seen = new Set();

      while (queue.length > 0 && displayPaths.length < 20) {
        const current = queue.shift();
        if (!current || current.value === null || current.value === undefined) continue;
        if (current.depth > 4) continue;
        if (typeof current.value !== 'object') continue;
        if (seen.has(current.value)) continue;
        seen.add(current.value);
        const entries = Array.isArray(current.value)
          ? current.value.slice(0, 6).map((child, index) => [String(index), child])
          : Object.entries(current.value).slice(0, 40);
        for (const [key, child] of entries) {
          const path = current.path ? `${current.path}.${key}` : key;
          if (displayKeyPattern.test(key)) {
            displayPaths.push(path);
            if (!examples[path]) {
              examples[path] = typeof child === 'object' && child !== null
                ? JSON.stringify(child).slice(0, 200)
                : String(child ?? '').slice(0, 200);
            }
          }
          if (typeof child === 'object' && child !== null) {
            queue.push({ value: child, path, depth: current.depth + 1 });
          }
        }
      }

      return {
        display_paths: [...new Set(displayPaths)],
        examples,
      };
    }

    const markers = Array.from(document.querySelectorAll('span[role="listitem"]'));
    const rows = [];
    for (const marker of markers) {
      const rowRoot = findRowRoot(marker);
      if (!rowRoot) continue;
      const lines = visibleLines(rowRoot);
      const joined = lines.join('\n');
      if (skipPattern.test(joined) || !actionPattern.test(joined)) continue;
      const author = lines[0] || '';
      const time = lines.find((line) => timePattern.test(line)) || '';
      const text = lines.find((line, index) => index > 0 && line !== time && !actionPattern.test(line)) || '';
      if (!author || !time || !text) continue;
      const reactPayload = getReactPayload(rowRoot) || getReactPayload(marker);
      rows.push({
        author,
        time,
        text,
        row_lines: lines.slice(0, 12),
        react_carrier: reactPayload?.carrier || '',
        react_kind: reactPayload?.kind || '',
        react_summary: reactPayload ? summarizePayload(reactPayload.value) : { display_paths: [], examples: {} },
      });
      if (rows.length >= rowLimit) break;
    }
    return rows;
  }, { rowLimit: Math.max(1, Math.min(5, Number(limit || 3))) });
}

async function listCreatorDisplayCandidateRequests(page, limit = 20) {
  if (typeof page?.networkRequests !== 'function') return [];
  try {
    const requests = await page.networkRequests(false);
    if (!Array.isArray(requests)) return [];
    const urls = requests
      .map((entry) => String(entry?.url || ''))
      .filter((url) => url.startsWith('https://creator.douyin.com/'))
      .filter((url) => !/\.js(\?|$)|\.css(\?|$)|\.png(\?|$)|\.jpg(\?|$)|\.jpeg(\?|$)|\.webp(\?|$)|\.svg(\?|$)|\.woff2?(\?|$)/i.test(url))
      .filter((url) => /(comment|user|profile|author|avatar|relation|fans|follow|interact)/i.test(url))
      .map((url) => {
        try {
          const parsed = new URL(url);
          return {
            path: `${parsed.origin}${parsed.pathname}`,
            url,
          };
        } catch {
          return { path: url, url };
        }
      });
    const seen = new Set();
    const unique = [];
    for (const entry of urls) {
      const key = `${entry.path}__${entry.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(entry);
      if (unique.length >= limit) break;
    }
    return unique;
  } catch {
    return [];
  }
}

function buildCreatorCommentRequest(path, params) {
  return { path, params };
}

async function fetchCreatorCommentPage(page, request) {
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
    throw new Error(`douyin creator comment probe request failed: ${result?.status || 'unknown'}`);
  }
  return result;
}

function extractCreatorComments(data = {}) {
  return Array.isArray(data.comment_info_list)
    ? data.comment_info_list
    : Array.isArray(data.comments)
      ? data.comments
      : [];
}

function resolveCreatorTarget(targets, awemeId, itemId) {
  if (itemId && itemId !== 'auto') {
    return targets.find((target) => String(target.item_id || '') === itemId)
      || { item_id: itemId, aweme_id: firstNonEmpty(awemeId, itemId) };
  }
  return targets.find((target) => String(target.aweme_id || '') === String(awemeId || ''))
    || targets.find((target) => Number(target.comment_count || 0) > 0)
    || targets[0]
    || null;
}

async function probeCreatorComments(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_COMMENT_MANAGE_URL);
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));
  const limit = normalizeDouyinCommentLimit(kwargs.limit ?? 10, 10);
  const replyLimit = normalizeDouyinCommentLimit(kwargs.reply_limit ?? 10, 10);

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }

  const targets = await fetchDouyinCreatorCommentTargets(page, { url: targetUrl, limit: 20, wait_seconds: waitSeconds });
  const target = resolveCreatorTarget(targets, String(kwargs.aweme_id || ''), String(kwargs.item_id || 'auto'));
  if (!target?.item_id) {
    throw new Error('No creator comment target could be resolved for comment id bridge probe.');
  }

  const legacyTopLevel = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
    '/aweme/v1/creator/comment/list',
    { item_id: target.item_id, cursor: '0', count: limit, sort: '' },
  ));
  const legacyTopLevelRows = normalizeRows(extractCreatorComments(legacyTopLevel.data), limit);
  const commentInfo = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
    '/aweme/v1/creator/comment/info',
    {},
  )).catch(() => null);
  const selectTopLevel = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
    '/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/',
    {
      aweme_id: target.aweme_id,
      cursor: '0',
      count: limit,
      sort_options: 0,
      comment_select_options: '0',
      channel_id: 618,
    },
  ));
  const selectTopLevelRows = normalizeRows(extractCreatorComments(selectTopLevel.data), limit);

  async function fetchReplyProbe(rows, mode) {
    const replyTarget = rows.find((row) => Number(row?.reply_count ?? row?.reply_comment_total ?? 0) > 0);
    const selectedCommentId = firstNonEmpty(replyTarget?.comment_id, replyTarget?.cid, replyTarget?.id);
    if (!replyTarget || !selectedCommentId) {
      return { endpoint_path: '', row_count: 0, selected_comment_id: '', ...createProbeSummary([]) };
    }
    try {
      const replyResult = mode === 'select'
        ? await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
          '/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/reply/',
          { comment_id: selectedCommentId, item_id: target.aweme_id, cursor: '0', count: replyLimit },
        ))
        : await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
          '/aweme/v1/creator/comment/reply/list',
          { comment_id: selectedCommentId, cursor: '0', count: replyLimit, sort: '' },
        ));
      const replyRows = normalizeRows(extractCreatorComments(replyResult.data), replyLimit);
      return {
        endpoint_path: replyResult.source_url_path,
        row_count: replyRows.length,
        selected_comment_id: selectedCommentId,
        ...createProbeSummary(replyRows),
      };
    } catch {
      return { endpoint_path: '', row_count: 0, selected_comment_id: selectedCommentId, ...createProbeSummary([]) };
    }
  }

  const legacyReply = await fetchReplyProbe(legacyTopLevelRows, 'legacy');
  const selectReply = await fetchReplyProbe(selectTopLevelRows, 'select');
  let domCards = [];
  let displayCandidateRequests = [];
  try {
    const rows = await readCreatorCommentDomCards(page, 5);
    domCards = Array.isArray(rows) ? rows : [];
  } catch {
    domCards = [];
  }
  try {
    const requests = await listCreatorDisplayCandidateRequests(page, 20);
    displayCandidateRequests = Array.isArray(requests) ? requests : [];
  } catch {
    displayCandidateRequests = [];
  }
  let domStateRows = [];
  try {
    const rows = await inspectCreatorCommentDomState(page, 3);
    domStateRows = Array.isArray(rows) ? rows : [];
  } catch {
    domStateRows = [];
  }

  return [
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'top_level_legacy',
      endpoint_path: legacyTopLevel.source_url_path,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: legacyTopLevelRows.length,
      selected_comment_id: '',
      ...createProbeSummary(legacyTopLevelRows),
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'reply_legacy',
      endpoint_path: legacyReply.endpoint_path,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: legacyReply.row_count,
      selected_comment_id: legacyReply.selected_comment_id,
      candidate_field_hits: legacyReply.candidate_field_hits,
      candidate_field_examples: legacyReply.candidate_field_examples,
      id_like_key_paths: legacyReply.id_like_key_paths,
      extra_key_paths: legacyReply.extra_key_paths,
      encrypted_id_like_paths: legacyReply.encrypted_id_like_paths,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'page_comment_info',
      endpoint_path: commentInfo?.source_url_path || '',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: commentInfo?.data ? 1 : 0,
      selected_comment_id: '',
      ...(commentInfo?.data ? createProbeSummary([commentInfo.data]) : createProbeSummary([])),
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'top_level_select',
      endpoint_path: selectTopLevel.source_url_path,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: selectTopLevelRows.length,
      selected_comment_id: '',
      ...createProbeSummary(selectTopLevelRows),
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'reply_select',
      endpoint_path: selectReply.endpoint_path,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: selectReply.row_count,
      selected_comment_id: selectReply.selected_comment_id,
      candidate_field_hits: selectReply.candidate_field_hits,
      candidate_field_examples: selectReply.candidate_field_examples,
      id_like_key_paths: selectReply.id_like_key_paths,
      extra_key_paths: selectReply.extra_key_paths,
      encrypted_id_like_paths: selectReply.encrypted_id_like_paths,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'dom_visible_cards',
      endpoint_path: targetUrl,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: domCards.length,
      selected_comment_id: '',
      dom_summary: summarizeDomCards(domCards),
      dom_preview: domCards,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'dom_state_probe',
      endpoint_path: targetUrl,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: domStateRows.length,
      selected_comment_id: '',
      dom_state_rows: domStateRows,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'network_candidate_requests',
      endpoint_path: targetUrl,
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: displayCandidateRequests.length,
      selected_comment_id: '',
      request_paths: displayCandidateRequests.map((entry) => entry.path),
      request_urls: displayCandidateRequests.map((entry) => entry.url),
    },
  ];
}

async function probePublicComments(page, kwargs = {}) {
  const awemeId = String(kwargs.aweme_id || '').trim();
  const limit = normalizeDouyinCommentLimit(kwargs.limit ?? 10, 10);
  const replyLimit = normalizeDouyinCommentLimit(kwargs.reply_limit ?? 10, 10);

  if (typeof page?.goto === 'function') {
    await page.goto(`https://www.douyin.com/video/${awemeId}`);
    if (typeof page.wait === 'function') await page.wait(2);
  }

  const topLevelRows = normalizeRows(await fetchDouyinComments(page, awemeId, { limit, pages: 1, cursor: '0' }), limit);
  const replyTarget = topLevelRows.find((row) => Number(row?.reply_count ?? row?.reply_comment_total ?? 0) > 0);
  const selectedCommentId = firstNonEmpty(replyTarget?.comment_id, replyTarget?.cid, replyTarget?.id);
  let replyRows = [];
  if (replyTarget && selectedCommentId) {
    try {
      replyRows = normalizeRows(await fetchDouyinCommentReplies(page, awemeId, selectedCommentId, { limit: replyLimit, pages: 1, cursor: '0' }), replyLimit);
    } catch {
      replyRows = [];
    }
  }

  return [
    {
      data_source: DOUYIN_SOURCE_PUBLIC,
      scope: 'top_level',
      endpoint_path: 'https://www.douyin.com/aweme/v1/web/comment/list/',
      target_aweme_id: awemeId,
      target_item_id: '',
      row_count: topLevelRows.length,
      selected_comment_id: '',
      ...createProbeSummary(topLevelRows),
    },
    {
      data_source: DOUYIN_SOURCE_PUBLIC,
      scope: 'reply',
      endpoint_path: 'https://www.douyin.com/aweme/v1/web/comment/list/reply/',
      target_aweme_id: awemeId,
      target_item_id: '',
      row_count: replyRows.length,
      selected_comment_id: selectedCommentId,
      ...createProbeSummary(replyRows),
    },
  ];
}

export async function probeDouyinCommentIdBridge(page, kwargs = {}) {
  const awemeId = String(kwargs.aweme_id || '').trim();
  if (!awemeId) {
    throw new Error('aweme_id is required');
  }
  const creatorRows = await probeCreatorComments(page, kwargs);
  const publicRows = await probePublicComments(page, kwargs);
  return [...creatorRows, ...publicRows];
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-comment-id-bridge-probe',
    description: douyinCommentIdBridgeProbeSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_COMMENT_MANAGE_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinCommentIdBridgeProbeSpec.args,
    columns: douyinCommentIdBridgeProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinCommentIdBridge(page, kwargs),
  });
}
