import {
  DOUYIN_CREATOR_DANMAKU_MANAGE_URL,
  DOUYIN_CREATOR_DANMAKU_MANAGE_ENTRY_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

const DEFAULT_MODULE_IDS = [93066, 72056, 38483, 22033];

export const douyinCreatorDanmakuProbeSpec = {
  site: 'douyin',
  name: 'skill-creator-danmaku-probe',
  description: '只读探测抖音创作者中心弹幕子应用的 webpack 模块和候选 API，不导出正文内容',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_DANMAKU_MANAGE_URL, help: 'Douyin creator danmaku management URL' },
    { name: 'wait_seconds', type: 'int', default: 5, help: 'Seconds to wait after page load' },
    { name: 'module_ids', type: 'string', default: DEFAULT_MODULE_IDS.join(','), help: 'Comma-separated webpack module ids to inspect' },
    { name: 'call_hit_word_list', type: 'bool', default: true, help: 'Call getHitWordList when the API client exports it' },
    { name: 'click_card_count', type: 'int', default: 3, help: 'Number of work cards to click for network capture' },
  ],
  columns: [
    'data_source',
    'current_url',
    'page_title',
    'probe_context_url',
    'frame_count',
    'iframe_srcs',
    'chunk_keys',
    'module_scan_count',
    'matched_modules',
    'clicked_cards',
    'captured_count',
    'captured_url_paths',
    'module_ids',
    'defined_module_ids',
    'loaded_module_ids',
    'module_export_keys',
    'module_source_excerpts',
    'api_export_keys',
    'api_candidate_keys',
    'has_hit_word_api',
    'hit_word_count',
    'hit_word_sample',
    'errors',
  ],
};

export function normalizeDanmakuProbeModuleIds(value) {
  const ids = String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return ids.length > 0 ? ids.slice(0, 12) : [...DEFAULT_MODULE_IDS];
}

function summarizeHitWordSample(result = {}) {
  const words = Array.isArray(result.words) ? result.words : [];
  return words
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, 5);
}

export function normalizeCreatorDanmakuProbeRow(result = {}) {
  const moduleReports = Array.isArray(result.module_reports) ? result.module_reports : [];
  const moduleExportKeys = {};
  const moduleSourceExcerpts = {};
  for (const report of moduleReports) {
    if (!Number.isInteger(report?.module_id)) continue;
    moduleExportKeys[String(report.module_id)] = Array.isArray(report.export_keys) ? report.export_keys : [];
    moduleSourceExcerpts[String(report.module_id)] = String(report.source_excerpt || '');
  }
  const apiProbe = result.api_probe && typeof result.api_probe === 'object' ? result.api_probe : {};
  const hitWordSample = summarizeHitWordSample(apiProbe.hit_word_list);
  const hitWordCount = Array.isArray(apiProbe.hit_word_list?.words) ? apiProbe.hit_word_list.words.length : 0;
  return [{
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    current_url: String(result.current_url || ''),
    page_title: String(result.page_title || ''),
    probe_context_url: String(result.probe_context_url || ''),
    frame_count: Number(result.frame_count || 0),
    iframe_srcs: Array.isArray(result.iframe_srcs) ? result.iframe_srcs : [],
    chunk_keys: Array.isArray(result.chunk_keys) ? result.chunk_keys : [],
    module_scan_count: Number(result.module_scan_count || 0),
    matched_modules: Array.isArray(result.matched_modules) ? result.matched_modules : [],
    clicked_cards: Array.isArray(result.clicked_cards) ? result.clicked_cards : [],
    captured_count: Number(result.captured_count || 0),
    captured_url_paths: Array.isArray(result.captured_url_paths) ? result.captured_url_paths : [],
    module_ids: Array.isArray(result.module_ids) ? result.module_ids : [],
    defined_module_ids: moduleReports.filter((item) => item?.defined).map((item) => item.module_id),
    loaded_module_ids: moduleReports.filter((item) => item?.loaded).map((item) => item.module_id),
    module_export_keys: moduleExportKeys,
    module_source_excerpts: moduleSourceExcerpts,
    api_export_keys: Array.isArray(apiProbe.export_keys) ? apiProbe.export_keys : [],
    api_candidate_keys: Array.isArray(apiProbe.candidate_keys) ? apiProbe.candidate_keys : [],
    has_hit_word_api: Boolean(apiProbe.has_hit_word_api),
    hit_word_count: hitWordCount,
    hit_word_sample: hitWordSample,
    errors: Array.isArray(result.errors) ? result.errors : [],
  }];
}

export async function inspectDouyinCreatorDanmakuModules(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_DANMAKU_MANAGE_URL);
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 5)));
  const moduleIds = normalizeDanmakuProbeModuleIds(kwargs.module_ids);
  const callHitWordList = kwargs.call_hit_word_list !== false && String(kwargs.call_hit_word_list ?? '').toLowerCase() !== 'false';
  const clickCardCount = Math.max(0, Math.min(8, Number(kwargs.click_card_count ?? 3)));

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(waitSeconds);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator danmaku probe.');
  }

  const result = await page.evaluate(`
    (async () => {
      const moduleIds = ${JSON.stringify(moduleIds)};
      const callHitWordList = ${JSON.stringify(callHitWordList)};
      const clickCardCount = ${JSON.stringify(clickCardCount)};
      const errors = [];
      const captures = [];
      const captureSeen = new Set();
      const summarizeSource = (value) => String(value || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 320);
      const collectUrlMatches = (sourceText) => {
        const tokens = String(sourceText || '')
          .split(/["'\\s]+/)
          .map((item) => item.replace(/[),;]+$/g, ''))
          .filter((item) => /^(?:https?:\\/\\/|\\/)/i.test(item))
          .filter((item) => /danmaku|hit[_-]?word|blocked[_-]?word|bullet/i.test(item));
        return Array.from(new Set(tokens)).slice(0, 8);
      };
      const toSortedKeys = (value) => {
        if (!value || typeof value !== 'object') return [];
        return Object.keys(value).sort();
      };
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const safeJson = (text) => {
        if (typeof text !== 'string' || !text.trim()) return null;
        try { return JSON.parse(text); } catch { return null; }
      };
      const shouldCapture = (rawUrl) => {
        const text = String(rawUrl || '');
        return /creator\\.douyin\\.com|douyin\\.com/.test(text)
          && /danmaku|comment|aweme|item|interactive|creator|api/i.test(text);
      };
      const toUrlPath = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl, location.href);
          return parsed.origin + parsed.pathname;
        } catch {
          return String(rawUrl || '').split('?')[0];
        }
      };
      const capture = (entry) => {
        const urlPath = toUrlPath(entry.url);
        const key = String(entry.method || 'GET').toUpperCase() + '|' + urlPath;
        if (captureSeen.has(key)) return;
        captureSeen.add(key);
        captures.push({
          method: String(entry.method || 'GET').toUpperCase(),
          url_path: urlPath,
        });
      };
      const safeCall = async (fn) => {
        try {
          return { ok: true, value: await fn() };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      };
      const toSortedObjectKeys = (value) => {
        if (!value || typeof value !== 'object') return {};
        const entries = Object.entries(value)
          .filter(([, child]) => child && typeof child === 'object')
          .slice(0, 20)
          .map(([key, child]) => [key, Object.keys(child).sort().slice(0, 40)]);
        return Object.fromEntries(entries);
      };
      const installNetworkCapture = () => {
        if (!window.__opencli_danmaku_probe_fetch) {
          window.__opencli_danmaku_probe_fetch = window.fetch.bind(window);
          window.fetch = async function(...args) {
            const req = args[0];
            const init = args[1] || {};
            const rawUrl = typeof req === 'string' ? req : (req && req.url) || '';
            const method = init.method || (req && req.method) || 'GET';
            const response = await window.__opencli_danmaku_probe_fetch.apply(this, args);
            if (shouldCapture(rawUrl)) capture({ url: rawUrl, method });
            return response;
          };
        }
        if (!window.__opencli_danmaku_probe_xhr_open) {
          window.__opencli_danmaku_probe_xhr_open = window.XMLHttpRequest.prototype.open;
          window.__opencli_danmaku_probe_xhr_send = window.XMLHttpRequest.prototype.send;
          window.XMLHttpRequest.prototype.open = function(method, rawUrl) {
            Object.defineProperty(this, '__opencli_danmaku_probe_url', { value: String(rawUrl), writable: true, configurable: true });
            Object.defineProperty(this, '__opencli_danmaku_probe_method', { value: String(method || 'GET').toUpperCase(), writable: true, configurable: true });
            return window.__opencli_danmaku_probe_xhr_open.apply(this, arguments);
          };
          window.XMLHttpRequest.prototype.send = function() {
            this.addEventListener('load', function() {
              const rawUrl = this.__opencli_danmaku_probe_url || '';
              if (shouldCapture(rawUrl)) capture({ url: rawUrl, method: this.__opencli_danmaku_probe_method || 'GET' });
            });
            return window.__opencli_danmaku_probe_xhr_send.apply(this, arguments);
          };
        }
      };
      const collectCardCandidates = () => {
        const nodes = Array.from(document.querySelectorAll('button,a,div,span')).filter((node) => {
          const text = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!text) return false;
          if (!(text === '全部作品' || /弹\\s*\\d+/i.test(text))) return false;
          const rect = node.getBoundingClientRect();
          return rect.width >= 40 && rect.height >= 24;
        });
        const deduped = [];
        const seen = new Set();
        for (const node of nodes) {
          const text = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
          const rect = node.getBoundingClientRect();
          const key = text + '|' + Math.round(rect.left) + '|' + Math.round(rect.top);
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push({
            text,
            clickable: node.closest('button,a,[role="button"],[role="tab"]') || node,
          });
          if (deduped.length >= clickCardCount + 2) break;
        }
        return deduped;
      };
      const clickCards = async () => {
        const cards = collectCardCandidates();
        const clicked = [];
        for (const item of cards.slice(0, clickCardCount)) {
          try {
            item.clickable.click();
            clicked.push(item.text);
            await sleep(1200);
          } catch (error) {
            errors.push('click_card_failed:' + String(error));
          }
        }
        return clicked;
      };
      const listContexts = () => {
        const contexts = [];
        const pushContext = (ctx, kind) => {
          if (!ctx || contexts.some((item) => item.window === ctx)) return;
          try {
            contexts.push({
              window: ctx,
              kind,
              href: String(ctx.location?.href || ''),
              title: String(ctx.document?.title || ''),
              chunk_keys: Object.keys(ctx)
                .filter((key) => key.startsWith('webpackChunk'))
                .sort()
                .slice(0, 20),
            });
          } catch (error) {
            errors.push('context_collect_failed:' + String(error));
          }
        };
        pushContext(window, 'self');
        const frames = Array.from(document.querySelectorAll('iframe'));
        for (const frame of frames) pushContext(frame.contentWindow, 'iframe');
        return contexts;
      };
      const iframeSrcs = Array.from(document.querySelectorAll('iframe'))
        .map((frame) => String(frame.getAttribute('src') || frame.src || '').trim())
        .filter(Boolean)
        .slice(0, 20);
      const contexts = listContexts();
      const preferredContext = contexts.find((item) => item.chunk_keys.includes('webpackChunkdouyin_creator_mid_video'))
        || contexts.find((item) => item.href.includes('douyin_creator_mid_video'))
        || contexts[0]
        || null;
      installNetworkCapture();
      await sleep(1200);
      const clickedCards = await clickCards();
      await sleep(800);
      const getWebpackRequire = (ctx) => {
        const chunk = ctx?.window?.webpackChunkdouyin_creator_mid_video;
        if (!Array.isArray(chunk) || typeof chunk.push !== 'function') return null;
        let webpackRequire = null;
        try {
          chunk.push([['opencli_danmaku_probe_' + Date.now()], {}, (runtime) => {
            webpackRequire = runtime;
          }]);
        } catch (error) {
          errors.push('webpack_chunk_push_failed:' + String(error));
        }
        return webpackRequire;
      };
      const webpackRequire = getWebpackRequire(preferredContext);
      if (!webpackRequire) {
        return {
          current_url: String(location.href || ''),
          page_title: String(document.title || ''),
          probe_context_url: String(preferredContext?.href || ''),
          frame_count: Math.max(0, contexts.length - 1),
          iframe_srcs: iframeSrcs,
          chunk_keys: Array.isArray(preferredContext?.chunk_keys) ? preferredContext.chunk_keys : [],
          module_scan_count: 0,
          matched_modules: [],
          clicked_cards: clickedCards,
          captured_count: captures.length,
          captured_url_paths: captures.map((item) => item.url_path),
          module_ids: moduleIds,
          module_reports: [],
          api_probe: {},
          errors: [...errors, 'webpack_require_unavailable'],
        };
      }

      const moduleReports = [];
      const availableModuleIds = Object.keys(webpackRequire.m || {})
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item));
      const matchedModules = [];
      for (const moduleId of moduleIds) {
        const sourceText = typeof webpackRequire.m?.[moduleId] === 'function' ? String(webpackRequire.m[moduleId]) : '';
        const sourceMatches = [
          /getHitWordList/.test(sourceText) ? 'getHitWordList' : '',
          /setHitWordList/.test(sourceText) ? 'setHitWordList' : '',
          /getDanmaku/i.test(sourceText) ? 'getDanmaku' : '',
          /author_blocked_words/.test(sourceText) ? 'author_blocked_words' : '',
        ].filter(Boolean);
        try {
          const exported = webpackRequire(moduleId);
          moduleReports.push({
            module_id: moduleId,
            defined: typeof webpackRequire.m?.[moduleId] === 'function',
            loaded: true,
            export_keys: toSortedKeys(exported),
            source_matches: sourceMatches,
            url_matches: collectUrlMatches(sourceText),
            source_excerpt: summarizeSource(sourceText),
          });
        } catch (error) {
          moduleReports.push({
            module_id: moduleId,
            defined: typeof webpackRequire.m?.[moduleId] === 'function',
            loaded: false,
            export_keys: [],
            source_matches: sourceMatches,
            url_matches: collectUrlMatches(sourceText),
            source_excerpt: summarizeSource(sourceText),
            error: String(error),
          });
        }
      }

      for (const moduleId of availableModuleIds.slice(0, 4000)) {
        const sourceText = typeof webpackRequire.m?.[moduleId] === 'function' ? String(webpackRequire.m[moduleId]) : '';
        const sourceMatches = [
          /getHitWordList/.test(sourceText) ? 'getHitWordList' : '',
          /setHitWordList/.test(sourceText) ? 'setHitWordList' : '',
          /getDanmaku/i.test(sourceText) ? 'getDanmaku' : '',
          /author_blocked_words/.test(sourceText) ? 'author_blocked_words' : '',
        ].filter(Boolean);
        let exported = null;
        let exportKeys = [];
        let nestedKeys = {};
        let loadError = '';
        try {
          exported = webpackRequire(moduleId);
          exportKeys = toSortedKeys(exported);
          nestedKeys = toSortedObjectKeys(exported);
        } catch {
          loadError = 'require_failed';
        }
        const flatNestedKeys = Object.values(nestedKeys).flat();
        const matchesStore = exportKeys.includes('m5') || exportKeys.includes('OW');
        const matchesApi = flatNestedKeys.some((key) => /getHitWordList|setHitWordList|getDanmaku/i.test(key));
        if (!matchesStore && !matchesApi && sourceMatches.length === 0) continue;
        matchedModules.push({
          module_id: moduleId,
          loaded: Boolean(exported),
          export_keys: exportKeys,
          nested_keys: nestedKeys,
          source_matches: sourceMatches,
          url_matches: collectUrlMatches(sourceText),
          source_excerpt: summarizeSource(sourceText),
          error: loadError,
        });
        if (matchedModules.length >= 20) break;
      }

      const apiModule = moduleReports.find((item) => item.module_id === 72056 && item.loaded);
      const apiProbe = {
        export_keys: [],
        candidate_keys: [],
        has_hit_word_api: false,
        hit_word_list: { words: [] },
      };
      if (apiModule?.loaded) {
        try {
          const exported = webpackRequire(72056);
          const apiClient = exported?.H && typeof exported.H === 'object' ? exported.H : null;
          apiProbe.export_keys = toSortedKeys(exported);
          apiProbe.candidate_keys = apiClient
            ? Object.keys(apiClient)
                .filter((key) => typeof apiClient[key] === 'function')
                .sort()
            : [];
          apiProbe.has_hit_word_api = Boolean(apiClient?.getHitWordList);
          if (callHitWordList && apiClient?.getHitWordList) {
            const hitWordResult = await safeCall(() => apiClient.getHitWordList());
            if (hitWordResult.ok) {
              const data = hitWordResult.value?.data && typeof hitWordResult.value.data === 'object'
                ? hitWordResult.value.data
                : {};
              const words = Array.isArray(data.author_blocked_words) ? data.author_blocked_words : [];
              apiProbe.hit_word_list = { words };
            } else {
              errors.push('getHitWordList_failed:' + String(hitWordResult.error));
            }
          }
        } catch (error) {
          errors.push('api_module_probe_failed:' + String(error));
        }
      }

      return {
        current_url: String(location.href || ''),
        page_title: String(document.title || ''),
        probe_context_url: String(preferredContext?.href || ''),
        frame_count: Math.max(0, contexts.length - 1),
        iframe_srcs: iframeSrcs,
        chunk_keys: Array.isArray(preferredContext?.chunk_keys) ? preferredContext.chunk_keys : [],
        module_scan_count: availableModuleIds.length,
        matched_modules: matchedModules,
        clicked_cards: clickedCards,
        captured_count: captures.length,
        captured_url_paths: captures.map((item) => item.url_path),
        module_ids: moduleIds,
        module_reports: moduleReports,
        api_probe: apiProbe,
        errors,
      };
    })()
  `);

  return normalizeCreatorDanmakuProbeRow(result);
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-danmaku-probe',
    description: douyinCreatorDanmakuProbeSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_DANMAKU_MANAGE_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 180,
    args: douyinCreatorDanmakuProbeSpec.args,
    columns: douyinCreatorDanmakuProbeSpec.columns,
    func: async (page, kwargs) => inspectDouyinCreatorDanmakuModules(page, kwargs),
  });
}
