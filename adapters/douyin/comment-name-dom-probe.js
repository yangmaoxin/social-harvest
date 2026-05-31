import {
  DOUYIN_CREATOR_COMMENT_MANAGE_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  formatDouyinTimestamp,
  normalizeDouyinCommentLimit,
} from './shared.js';
import { fetchDouyinCreatorCommentTargets } from './creator-comments.js';
import { preserveCreatorJsonLargeIdValues } from './creator-works.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinCommentNameDomProbeSpec = {
  site: 'douyin',
  name: 'skill-comment-name-dom-probe',
  description: '定向诊断抖音创作者中心评论页昵称来源，检查可见评论卡片、React/状态候选字段与原始评论接口是否对齐',
  args: [
    { name: 'aweme_id', type: 'string', required: true, positional: true, help: 'Target public aweme_id to inspect' },
    { name: 'item_id', type: 'string', default: 'auto', help: 'Creator comment-management item_id, or auto to resolve from creator item list' },
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_COMMENT_MANAGE_URL, help: 'Douyin creator comment management URL' },
    { name: 'limit', type: 'int', default: 5, help: 'Maximum visible comments / raw rows to inspect' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after creator page load' },
  ],
  columns: [
    'data_source',
    'scope',
    'target_aweme_id',
    'target_item_id',
    'row_count',
    'nickname_nonempty',
    'avatar_nonempty',
    'ip_nonempty',
    'matching_raw_rows',
    'request_paths',
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
  return Array.isArray(rows) ? rows.slice(0, Math.max(1, Math.min(20, Number(limit || 5)))) : [];
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
    throw new Error(`douyin creator comment name probe request failed: ${result?.status || 'unknown'}`);
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

function normalizeRawCreatorCommentRows(rows = []) {
  return rows.map((item, index) => ({
    rank: index + 1,
    comment_id: firstNonEmpty(item.comment_id, item.cid, item.id),
    text: firstNonEmpty(item.text, item.comment_text, item.content),
    time: formatDouyinTimestamp(firstNonEmpty(item.create_time, item.createTime, item.timestamp, item.time)),
    create_time: String(firstNonEmpty(item.create_time, item.createTime, item.timestamp, item.time)),
    author_uid: firstNonEmpty(item.user_info?.user_id, item.user?.uid, item.user?.user_id, item.user_id, item.uid),
    author: firstNonEmpty(
      item.user_info?.nickname,
      item.user_info?.name,
      item.user_info?.screen_name,
      item.user?.nickname,
      item.user?.name,
      item.user?.screen_name,
      item.user_name,
      item.author,
    ),
    avatar_url: firstNonEmpty(
      item.user_info?.avatar_url,
      item.user?.avatar_url,
      item.reply_to_user_info?.avatar_url,
    ),
    ip_location: firstNonEmpty(item.ip_label, item.ip_location, item.ipLocation),
  }));
}

function summarizeVisibleCards(cards = []) {
  const rows = Array.isArray(cards) ? cards : [];
  return {
    row_count: rows.length,
    nickname_nonempty: rows.filter((row) => firstNonEmpty(row?.author)).length,
    avatar_nonempty: rows.filter((row) => firstNonEmpty(row?.avatar_url)).length,
    ip_nonempty: rows.filter((row) => firstNonEmpty(row?.ip_location)).length,
  };
}

export function matchVisibleCardsToRawRows(visibleCards = [], rawRows = []) {
  const available = [...rawRows];
  return visibleCards.map((card) => {
    const exactIndex = available.findIndex((row) => row.text === card.text && row.time === card.time);
    const fuzzyIndex = exactIndex >= 0
      ? exactIndex
      : available.findIndex((row) => row.text === card.text || row.time === card.time);
    const matched = fuzzyIndex >= 0 ? available.splice(fuzzyIndex, 1)[0] : null;
    return {
      visible_author: firstNonEmpty(card.author),
      visible_time: firstNonEmpty(card.time),
      visible_text: firstNonEmpty(card.text),
      visible_avatar_url: firstNonEmpty(card.avatar_url),
      visible_ip_location: firstNonEmpty(card.ip_location),
      raw_comment_id: firstNonEmpty(matched?.comment_id),
      raw_author: firstNonEmpty(matched?.author),
      raw_author_uid: firstNonEmpty(matched?.author_uid),
      raw_avatar_url: firstNonEmpty(matched?.avatar_url),
      raw_ip_location: firstNonEmpty(matched?.ip_location),
      raw_time: firstNonEmpty(matched?.time),
      raw_text: firstNonEmpty(matched?.text),
      matched: Boolean(matched),
    };
  });
}

async function inspectVisibleCommentCards(page, rawRows = [], limit = 5) {
  return page.evaluate(({ rowLimit, rawHints }) => {
    const actionPattern = /回复|删除|举报/;
    const timePattern = /刚刚|昨天|前天|\d+\s*(秒钟|秒|分钟|分|小时|天)前|\d{1,2}:\d{2}/;
    const skipPattern = /有爱评论|说点好听的|全部评论|全部人群|最新发布|高清发布|评论管理|没有更多评论/;
    const emojiTokenPattern = /\[[^\]]{1,8}\]/g;

    function linesOf(element) {
      return String(element?.innerText || '')
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean);
    }

    function normalizeCommentText(value) {
      return String(value || '')
        .replace(emojiTokenPattern, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function backgroundImageUrl(element) {
      const style = element ? window.getComputedStyle(element) : null;
      const backgroundImage = style?.backgroundImage || '';
      const match = backgroundImage.match(/url\(["']?(.*?)["']?\)/i);
      return match?.[1] || '';
    }

    function collectReactDisplayFields(element) {
      const displayKeyPattern = /(nickname|screen_?name|user_?name|name|avatar|ip_?label|ip_?location)/i;
      let current = element;
      while (current) {
        const keys = Object.keys(current).filter((key) => key.startsWith('__reactProps$') || key.startsWith('__reactFiber$'));
        for (const key of keys) {
          const value = key.startsWith('__reactFiber$') ? current[key]?.memoizedProps : current[key];
          if (!value || typeof value !== 'object') continue;
          const queue = [{ value, path: '', depth: 0 }];
          const seen = new Set();
          const paths = [];
          const examples = {};
          while (queue.length > 0 && paths.length < 20) {
            const item = queue.shift();
            if (!item || item.value === null || item.value === undefined) continue;
            if (item.depth > 4) continue;
            if (typeof item.value !== 'object') continue;
            if (seen.has(item.value)) continue;
            seen.add(item.value);
            const entries = Array.isArray(item.value)
              ? item.value.slice(0, 6).map((child, index) => [String(index), child])
              : Object.entries(item.value).slice(0, 40);
            for (const [childKey, childValue] of entries) {
              const path = item.path ? `${item.path}.${childKey}` : childKey;
              if (displayKeyPattern.test(childKey)) {
                paths.push(path);
                if (!examples[path]) {
                  examples[path] = typeof childValue === 'object' && childValue !== null
                    ? JSON.stringify(childValue).slice(0, 200)
                    : String(childValue ?? '').slice(0, 200);
                }
              }
              if (typeof childValue === 'object' && childValue !== null) {
                queue.push({ value: childValue, path, depth: item.depth + 1 });
              }
            }
          }
          if (paths.length > 0) {
            return {
              carrier_tag: current.tagName,
              source_kind: key.startsWith('__reactFiber$') ? 'fiber' : 'props',
              display_paths: [...new Set(paths)],
              display_examples: examples,
            };
          }
        }
        current = current.parentElement;
      }
      return {
        carrier_tag: '',
        source_kind: '',
        display_paths: [],
        display_examples: {},
      };
    }

    const rows = [];
    const seen = new Set();

    function isVisible(element) {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function findTextAnchors(text) {
      const exact = [];
      const fuzzy = [];
      if (!text) return { exact, fuzzy };
      const normalizedText = normalizeCommentText(text);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const parent = current.parentElement;
        if (parent && isVisible(parent)) {
          const nodeText = normalizeCommentText(current.textContent || '');
          if (nodeText) {
            if (nodeText === normalizedText) {
              exact.push(parent);
            } else if (
              nodeText.includes(normalizedText)
              || normalizedText.includes(nodeText)
              || nodeText.includes(String(text || '').trim())
            ) {
              fuzzy.push(parent);
            }
          }
        }
        current = walker.nextNode();
      }
      return { exact, fuzzy };
    }

    function findRowRoot(anchor, text) {
      const candidates = [];
      let current = anchor;
      let depth = 0;
      while (current && depth < 8) {
        if (current instanceof HTMLElement) {
          candidates.push(current);
          if (current.parentElement) {
            candidates.push(current.parentElement);
          }
          if (current.previousElementSibling) {
            candidates.push(current.previousElementSibling);
          }
          if (current.nextElementSibling) {
            candidates.push(current.nextElementSibling);
          }
        }
        current = current.parentElement;
        depth += 1;
      }

      const unique = [...new Set(candidates.filter(Boolean))];
      return unique.find((node) => {
        const lines = linesOf(node);
        const joined = lines.join('\n');
        return lines.length >= 3
          && lines.some((line) => line.includes(text))
          && lines.some((line) => timePattern.test(line))
          && actionPattern.test(joined)
          && !skipPattern.test(joined);
      }) || null;
    }

    function extractAuthor(lines, text, time) {
      const blacklist = /(回复|删除|举报|点赞|展开|收起)/;
      for (const line of lines) {
        if (!line || line === text || line === time) continue;
        if (blacklist.test(line)) continue;
        if (timePattern.test(line)) continue;
        if (line.length <= 20) return line;
      }
      return '';
    }

    for (const marker of Array.from(document.querySelectorAll('span[role="listitem"]'))) {
      const rowRoot = marker.nextElementSibling instanceof HTMLElement ? marker.nextElementSibling : null;
      if (!rowRoot) continue;
      const lines = linesOf(rowRoot);
      const joined = lines.join('\n');
      if (lines.length < 3 || skipPattern.test(joined) || !actionPattern.test(joined)) continue;
      const time = lines.find((line) => timePattern.test(line)) || '';
      if (!time) continue;
      const text = lines.find((line, index) => index > 0 && line !== time && !actionPattern.test(line)) || '';
      const author = extractAuthor(lines, text, time);
      const key = `${author}__${time}__${text}`;
      if (!author || !time || !text || seen.has(key)) continue;
      seen.add(key);
      const markerReactProbe = collectReactDisplayFields(marker);
      const rootReactProbe = collectReactDisplayFields(rowRoot);
      const avatarUrl = [
        marker,
        marker.parentElement,
        rowRoot,
        ...Array.from(rowRoot.querySelectorAll('*')).slice(0, 40),
      ].map((node) => backgroundImageUrl(node)).find(Boolean) || '';
      rows.push({
        author,
        time,
        text,
        avatar_url: avatarUrl,
        ip_location: lines.find((line) => /IP|来自|天津|北京|上海|广东|浙江|江苏|福建|山东|河北|河南|湖北|湖南|四川|重庆|安徽|江西|辽宁|吉林|黑龙江|陕西|山西|云南|贵州|广西|海南|甘肃|青海|宁夏|新疆|内蒙古|西藏/.test(line)) || '',
        line_preview: lines.slice(0, 8),
        anchor_text: linesOf(marker)[0] || '',
        anchor_hit_type: 'role_listitem_sibling',
        react_probe: markerReactProbe.display_paths.length > 0 ? markerReactProbe : rootReactProbe,
      });
      if (rows.length >= rowLimit) return rows;
    }

    for (const raw of Array.isArray(rawHints) ? rawHints.slice(0, rowLimit * 3) : []) {
      const text = String(raw?.text || '').trim();
      if (!text) continue;
      const { exact, fuzzy } = findTextAnchors(text);
      const anchors = [...exact, ...fuzzy];
      const anchor = anchors.find((node) => findRowRoot(node, text));
      const rowRoot = anchor ? findRowRoot(anchor, text) : null;
      if (!rowRoot || !anchor) continue;
      const lines = linesOf(rowRoot);
      const time = lines.find((line) => timePattern.test(line)) || '';
      const author = extractAuthor(lines, text, time);
      const key = `${author}__${time}__${text}`;
      if (!author || !time || !text || seen.has(key)) continue;
      seen.add(key);
      const anchorReactProbe = collectReactDisplayFields(anchor);
      const rootReactProbe = collectReactDisplayFields(rowRoot);
      const avatarUrl = [
        anchor,
        anchor.parentElement,
        rowRoot,
        ...Array.from(rowRoot.querySelectorAll('*')).slice(0, 40),
      ].map((node) => backgroundImageUrl(node)).find(Boolean) || '';
      rows.push({
        author,
        time,
        text,
        avatar_url: avatarUrl,
        ip_location: lines.find((line) => /IP|来自|天津|北京|上海|广东|浙江|江苏|福建|山东|河北|河南|湖北|湖南|四川|重庆|安徽|江西|辽宁|吉林|黑龙江|陕西|山西|云南|贵州|广西|海南|甘肃|青海|宁夏|新疆|内蒙古|西藏/.test(line)) || '',
        line_preview: lines.slice(0, 8),
        anchor_text: linesOf(anchor)[0] || '',
        anchor_hit_type: exact.includes(anchor) ? 'exact' : 'fuzzy',
        react_probe: anchorReactProbe.display_paths.length > 0 ? anchorReactProbe : rootReactProbe,
      });
      if (rows.length >= rowLimit) break;
    }
    return rows;
  }, {
    rowLimit: Math.max(1, Math.min(8, Number(limit || 5))),
    rawHints: normalizeRows(rawRows, Math.max(1, Math.min(20, Number(limit || 5) * 3))),
  });
}

async function listCommentRelatedRequests(page, limit = 20) {
  if (typeof page?.networkRequests !== 'function') return [];
  try {
    const requests = await page.networkRequests(false);
    if (!Array.isArray(requests)) return [];
    return [...new Set(
      requests
        .map((entry) => String(entry?.url || ''))
        .filter((url) => url.startsWith('https://creator.douyin.com/'))
        .filter((url) => /(comment|user|profile|author|avatar|interact)/i.test(url))
    )].slice(0, limit);
  } catch {
    return [];
  }
}

async function inspectGlobalStateCandidates(page, rawRows = [], limit = 5) {
  return page.evaluate(({ rawHints, rowLimit }) => {
    const rawTexts = (Array.isArray(rawHints) ? rawHints : [])
      .map((row) => String(row?.text || '').replace(/\[[^\]]{1,8}\]/g, '').trim())
      .filter(Boolean)
      .slice(0, rowLimit);
    const nameKeyPattern = /(nickname|screen_?name|user_?name|display_?name|author_?name|name)/i;
    const rootKeyPattern = /(comment|interactive|store|state|data|initial|redux|garfish|webpack)/i;
    const seen = new Set();
    const rows = [];

    function safePreview(value) {
      try {
        if (typeof value === 'string') return value.slice(0, 200);
        return JSON.stringify(value).slice(0, 200);
      } catch {
        return String(value ?? '').slice(0, 200);
      }
    }

    function containsRawText(value) {
      if (typeof value === 'string') {
        return rawTexts.some((text) => text && value.includes(text));
      }
      if (Array.isArray(value)) {
        return value.some((item) => containsRawText(item));
      }
      if (value && typeof value === 'object') {
        return Object.values(value).some((child) => containsRawText(child));
      }
      return false;
    }

    function summarizeObject(rootName, rootValue) {
      const queue = [{ value: rootValue, path: rootName, depth: 0 }];
      const localSeen = new Set();
      const matchedPaths = [];
      const namePaths = [];
      const examples = {};

      while (queue.length > 0 && matchedPaths.length < 20) {
        const current = queue.shift();
        if (!current || current.value === null || current.value === undefined) continue;
        if (current.depth > 4) continue;
        if (typeof current.value !== 'object') continue;
        if (localSeen.has(current.value)) continue;
        localSeen.add(current.value);

        const entries = Array.isArray(current.value)
          ? current.value.slice(0, 12).map((child, index) => [String(index), child])
          : Object.entries(current.value).slice(0, 60);
        for (const [key, child] of entries) {
          const path = `${current.path}.${key}`;
          if (nameKeyPattern.test(key)) {
            namePaths.push(path);
            if (!examples[path]) examples[path] = safePreview(child);
          }
          if (containsRawText(child)) {
            matchedPaths.push(path);
            if (!examples[path]) examples[path] = safePreview(child);
          }
          if (child && typeof child === 'object') {
            queue.push({ value: child, path, depth: current.depth + 1 });
          }
        }
      }

      return {
        root: rootName,
        matched_paths: [...new Set(matchedPaths)].slice(0, 20),
        name_paths: [...new Set(namePaths)].slice(0, 20),
        examples,
      };
    }

    for (const key of Object.getOwnPropertyNames(window)) {
      if (!rootKeyPattern.test(key)) continue;
      let value;
      try {
        value = window[key];
      } catch {
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      const summary = summarizeObject(`window.${key}`, value);
      if (summary.matched_paths.length > 0 || summary.name_paths.length > 0) {
        rows.push(summary);
      }
      if (rows.length >= rowLimit) break;
    }

    return rows;
  }, {
    rawHints: normalizeRows(rawRows, limit),
    rowLimit: Math.max(1, Math.min(8, Number(limit || 5))),
  });
}

async function inspectPageTextPresence(page, rawRows = [], limit = 5) {
  return page.evaluate(({ rawHints, rowLimit }) => {
    const emojiTokenPattern = /\[[^\]]{1,8}\]/g;
    const normalizeCommentText = (value) => String(value || '')
      .replace(emojiTokenPattern, '')
      .replace(/\s+/g, ' ')
      .trim();

    const bodyText = normalizeCommentText(document.body?.innerText || '');
    const rows = [];
    for (const raw of Array.isArray(rawHints) ? rawHints.slice(0, rowLimit) : []) {
      const text = normalizeCommentText(raw?.text || '');
      if (!text) continue;
      const index = bodyText.indexOf(text);
      rows.push({
        text,
        present_in_body_text: index >= 0,
        context_excerpt: index >= 0 ? bodyText.slice(Math.max(0, index - 60), Math.min(bodyText.length, index + text.length + 120)) : '',
      });
    }
    return rows;
  }, {
    rawHints: normalizeRows(rawRows, limit),
    rowLimit: Math.max(1, Math.min(8, Number(limit || 5))),
  });
}

export async function probeDouyinCommentNameDomState(page, kwargs = {}) {
  const awemeId = String(kwargs.aweme_id || '').trim();
  if (!awemeId) throw new Error('aweme_id is required');
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_COMMENT_MANAGE_URL);
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));
  const limit = normalizeDouyinCommentLimit(kwargs.limit ?? 5, 5);

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }

  const targets = await fetchDouyinCreatorCommentTargets(page, { url: targetUrl, limit: 20, wait_seconds: waitSeconds });
  const itemId = String(kwargs.item_id || 'auto');
  const target = itemId !== 'auto'
    ? targets.find((row) => String(row.item_id || '') === itemId) || { item_id: itemId, aweme_id: awemeId }
    : targets.find((row) => String(row.aweme_id || '') === awemeId) || targets.find((row) => Number(row.comment_count || 0) > 0) || targets[0];
  if (!target?.item_id) throw new Error('No creator comment target could be resolved for comment name DOM probe.');

  const legacyTopLevel = await fetchCreatorCommentPage(page, buildCreatorCommentRequest(
    '/aweme/v1/creator/comment/list',
    { item_id: target.item_id, cursor: '0', count: limit, sort: '' },
  ));
  const rawRows = normalizeRawCreatorCommentRows(normalizeRows(extractCreatorComments(legacyTopLevel.data), limit));
  const visibleCardRows = await inspectVisibleCommentCards(page, rawRows, limit);
  const visibleCards = Array.isArray(visibleCardRows) ? visibleCardRows : [];
  const matchingRows = matchVisibleCardsToRawRows(visibleCards, rawRows);
  const requestUrls = await listCommentRelatedRequests(page, 20);
  const pageTextPresence = await inspectPageTextPresence(page, rawRows, limit);
  const pageTextRows = Array.isArray(pageTextPresence) ? pageTextPresence : [];
  const globalStateCandidates = await inspectGlobalStateCandidates(page, rawRows, limit);
  const globalStateRows = Array.isArray(globalStateCandidates) ? globalStateCandidates : [];

  return [
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'visible_cards',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: visibleCards.length,
      ...summarizeVisibleCards(visibleCards),
      visible_cards: visibleCards,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'raw_comment_rows',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: rawRows.length,
      nickname_nonempty: rawRows.filter((row) => firstNonEmpty(row.author)).length,
      avatar_nonempty: rawRows.filter((row) => firstNonEmpty(row.avatar_url)).length,
      ip_nonempty: rawRows.filter((row) => firstNonEmpty(row.ip_location)).length,
      raw_rows: rawRows,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'visible_to_raw_match',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: matchingRows.length,
      matching_raw_rows: matchingRows.filter((row) => row.matched).length,
      matches: matchingRows,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'request_candidates',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: requestUrls.length,
      request_paths: requestUrls.map((url) => {
        try {
          const parsed = new URL(url);
          return `${parsed.origin}${parsed.pathname}`;
        } catch {
          return url;
        }
      }),
      request_urls: requestUrls,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'page_text_presence',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: pageTextRows.length,
      matching_raw_rows: pageTextRows.filter((row) => row.present_in_body_text).length,
      rows: pageTextRows,
    },
    {
      data_source: DOUYIN_SOURCE_CREATOR_CENTER,
      scope: 'global_state_candidates',
      target_aweme_id: target.aweme_id,
      target_item_id: target.item_id,
      row_count: globalStateRows.length,
      rows: globalStateRows,
    },
  ];
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-comment-name-dom-probe',
    description: douyinCommentNameDomProbeSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_COMMENT_MANAGE_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinCommentNameDomProbeSpec.args,
    columns: douyinCommentNameDomProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinCommentNameDomState(page, kwargs),
  });
}
