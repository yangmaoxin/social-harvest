import {
  DOUYIN_CREATOR_API_SUMMARY_DEFAULT_CLICK_LABELS,
  DOUYIN_CREATOR_HOME_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  summarizeDouyinProtobufWireShape,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinCreatorApiSummarySpec = {
  site: 'douyin',
  name: 'skill-creator-api-summary',
  description: '只读汇总抖音创作者中心相关数据结构摘要，不保存响应正文',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_HOME_URL, help: 'Douyin creator center URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load and interaction' },
    { name: 'click_labels', type: 'string', default: DOUYIN_CREATOR_API_SUMMARY_DEFAULT_CLICK_LABELS, help: 'Comma-separated visible labels to click after page load' },
    { name: 'follow_endpoint_hints', type: 'boolean', default: false, help: 'Fetch endpoint hints from prefetch JSON and summarize their response shapes' },
    { name: 'endpoint_follow_limit', type: 'int', default: 5, help: 'Maximum endpoint hints to follow' },
    { name: 'limit', type: 'int', default: 30, help: 'Maximum deduped API entries to return' },
  ],
  columns: [
    'data_source',
    'rank',
    'current_url',
    'page_title',
    'captured_count',
    'deduped_count',
    'source',
    'url_path',
    'method',
    'status',
    'content_type',
    'response_type',
    'request_body_type',
    'request_body_byte_length',
    'request_body_hash',
    'response_byte_length',
    'response_body_hash',
    'request_wire_shape',
    'response_wire_shape',
    'query_keys',
    'response_endpoint_hints',
    'response_array_paths',
    'response_shape',
    'captured_at',
    'errors',
  ],
};

function normalizeClickLabels(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeCreatorApiSummaryRows(result = {}, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 30)));
  const rows = Array.isArray(result.rows) ? result.rows.slice(0, limit) : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];
  return rows.map((row, index) => ({
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    rank: index + 1,
    current_url: String(result.current_url || ''),
    page_title: String(result.page_title || ''),
    captured_count: Number(result.captured_count || rows.length),
    deduped_count: Number(result.deduped_count || rows.length),
    source: String(row.source || ''),
    url_path: String(row.url_path || ''),
    method: String(row.method || 'GET').toUpperCase(),
    status: row.status ?? null,
    content_type: String(row.content_type || ''),
    response_type: String(row.response_type || ''),
    request_body_type: String(row.request_body_type || ''),
    request_body_byte_length: Number(row.request_body_byte_length || 0),
    request_body_hash: String(row.request_body_hash || ''),
    response_byte_length: Number(row.response_byte_length || 0),
    response_body_hash: String(row.response_body_hash || ''),
    request_wire_shape: row.request_wire_shape || null,
    response_wire_shape: row.response_wire_shape || null,
    query_keys: Array.isArray(row.query_keys) ? row.query_keys : [],
    response_endpoint_hints: Array.isArray(row.response_endpoint_hints) ? row.response_endpoint_hints : [],
    response_array_paths: Array.isArray(row.response_array_paths) ? row.response_array_paths : [],
    response_shape: row.response_shape || null,
    captured_at: Number(row.captured_at || 0),
    errors,
  }));
}

export async function inspectDouyinCreatorApiSummary(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_HOME_URL);
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 3)));
  const clickLabels = normalizeClickLabels(kwargs.click_labels);
  const followEndpointHints = Boolean(kwargs.follow_endpoint_hints ?? kwargs.followEndpointHints);
  const endpointFollowLimit = Math.max(0, Math.min(20, Number(kwargs.endpoint_follow_limit ?? kwargs.endpointFollowLimit ?? 5)));
  const limit = Math.max(1, Math.min(200, Number(kwargs.limit || 30)));

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') await page.wait(1);
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator api summary.');
  }

  const result = await page.evaluate(`
    (async () => {
      const waitMs = ${JSON.stringify(waitSeconds * 1000)};
      const clickLabels = ${JSON.stringify(clickLabels)};
      const followEndpointHints = ${JSON.stringify(followEndpointHints)};
      const endpointFollowLimit = ${JSON.stringify(endpointFollowLimit)};
      const limit = ${JSON.stringify(limit)};
      const sourceName = '__opencli_douyin_creator_api_summary';
      const errorName = '__opencli_douyin_creator_api_summary_errors';
      const endpointQueueName = '__opencli_douyin_creator_api_summary_endpoint_queue';
      const compactProtoShape = ${summarizeDouyinProtobufWireShape.toString()};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const safeJson = (text) => {
        if (typeof text !== 'string' || !text.trim()) return null;
        try { return JSON.parse(text); } catch { return null; }
      };
      const urlPath = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl, window.location.href);
          return parsed.origin + parsed.pathname;
        } catch {
          return String(rawUrl || '').split('?')[0];
        }
      };
      const queryKeys = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl, window.location.href);
          return Array.from(parsed.searchParams.keys()).sort();
        } catch {
          return [];
        }
      };
      const summarize = (value, depth = 0) => {
        if (value === null) return { type: 'null' };
        if (Array.isArray(value)) {
          const first = value.find((item) => item !== null && item !== undefined);
          return { type: 'array', length: value.length, item: depth >= 2 ? undefined : summarize(first, depth + 1) };
        }
        if (typeof value === 'object') {
          const keys = Object.keys(value).sort().slice(0, 80);
          const children = {};
          if (depth < 2) {
            for (const key of keys.slice(0, 30)) children[key] = summarize(value[key], depth + 1);
          }
          return { type: 'object', keys, children };
        }
        return { type: typeof value };
      };
      const collectArrayPaths = (value, prefix = '', depth = 0, output = []) => {
        if (depth > 4 || value === null || value === undefined) return output;
        if (Array.isArray(value)) {
          output.push({ path: prefix || '$', length: value.length });
          const first = value.find((item) => item && typeof item === 'object');
          if (first) collectArrayPaths(first, prefix ? prefix + '[]' : '$[]', depth + 1, output);
          return output;
        }
        if (typeof value === 'object') {
          for (const key of Object.keys(value).slice(0, 60)) collectArrayPaths(value[key], prefix ? prefix + '.' + key : key, depth + 1, output);
        }
        return output;
      };
      const endpointHint = (rawValue, keyPath) => {
        const text = String(rawValue || '').trim();
        if (!text || text.length > 800) return null;
        if (!/^https?:\\/\\//.test(text) && !text.startsWith('/')) return null;
        try {
          const parsed = new URL(text, window.location.origin);
          if (!/douyin\\.com$/.test(parsed.hostname) && !/\\.douyin\\.com$/.test(parsed.hostname)) return null;
          return {
            key_path: keyPath,
            url_path: parsed.origin + parsed.pathname,
            query_keys: Array.from(parsed.searchParams.keys()).sort(),
          };
        } catch {
          return null;
        }
      };
      const collectEndpointHints = (value, prefix = '', depth = 0, output = []) => {
        if (depth > 5 || value === null || value === undefined || output.length >= 40) return output;
        if (Array.isArray(value)) {
          value.slice(0, 20).forEach((item, index) => collectEndpointHints(item, prefix ? prefix + '[]' : '$[' + index + ']', depth + 1, output));
          return output;
        }
        if (typeof value === 'object') {
          if (typeof value.url === 'string') {
            const hint = endpointHint(value.url, prefix ? prefix + '.url' : 'url');
            if (hint && !output.some((item) => item.url_path === hint.url_path && item.key_path === hint.key_path)) {
              const params = value.params && typeof value.params === 'object' && !Array.isArray(value.params) ? value.params : {};
              output.push({
                ...hint,
                param_keys: Object.keys(params).sort(),
                credential_keys: value.credentials && typeof value.credentials === 'object' ? Object.keys(value.credentials).sort() : [],
              });
            }
          }
          for (const [key, child] of Object.entries(value).slice(0, 80)) {
            const nextPrefix = prefix ? prefix + '.' + key : key;
            if (typeof child === 'string' && /url|path|api|href/i.test(key)) {
              const hint = endpointHint(child, nextPrefix);
              if (hint && !output.some((item) => item.url_path === hint.url_path && item.key_path === hint.key_path)) output.push(hint);
            }
            collectEndpointHints(child, nextPrefix, depth + 1, output);
          }
        }
        return output;
      };
      const endpointCallFromObject = (value, keyPath) => {
        if (!value || typeof value !== 'object' || typeof value.url !== 'string') return null;
        const hint = endpointHint(value.url, keyPath ? keyPath + '.url' : 'url');
        if (!hint) return null;
        const params = value.params && typeof value.params === 'object' && !Array.isArray(value.params) ? value.params : {};
        return {
          keyPath: hint.key_path,
          rawUrl: value.url,
          urlPath: hint.url_path,
          method: String(value.method || 'GET').toUpperCase(),
          params,
          credentials: String(value.credentials || 'include'),
        };
      };
      const collectEndpointCalls = (value, prefix = '', depth = 0, output = []) => {
        if (depth > 5 || value === null || value === undefined || output.length >= 40) return output;
        if (Array.isArray(value)) {
          value.slice(0, 20).forEach((item) => collectEndpointCalls(item, prefix ? prefix + '[]' : '$[]', depth + 1, output));
          return output;
        }
        if (typeof value === 'object') {
          const call = endpointCallFromObject(value, prefix);
          if (call && !output.some((item) => item.urlPath === call.urlPath && item.keyPath === call.keyPath)) output.push(call);
          for (const [key, child] of Object.entries(value).slice(0, 80)) {
            collectEndpointCalls(child, prefix ? prefix + '.' + key : key, depth + 1, output);
          }
        }
        return output;
      };
      const buildEndpointFetchUrl = (call) => {
        const parsed = new URL(call.rawUrl, window.location.origin);
        const params = call.params && typeof call.params === 'object' ? call.params : {};
        for (const [key, value] of Object.entries(params)) {
          if (value === null || value === undefined) continue;
          if (['string', 'number', 'boolean'].includes(typeof value)) parsed.searchParams.set(key, String(value));
        }
        return parsed.toString();
      };
      const bodyType = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return 'string';
        if (value instanceof ArrayBuffer) return 'arraybuffer';
        if (ArrayBuffer.isView(value)) return value.constructor?.name || 'typedarray';
        if (value instanceof Blob) return 'blob';
        if (value instanceof FormData) return 'formdata';
        if (value instanceof URLSearchParams) return 'urlsearchparams';
        return typeof value;
      };
      const bodyByteLength = (value) => {
        if (typeof value === 'string') return value.length;
        if (value instanceof ArrayBuffer) return value.byteLength;
        if (ArrayBuffer.isView(value)) return value.byteLength;
        if (value instanceof Blob) return value.size;
        return 0;
      };
      const stableHash = (value) => {
        const text = String(value ?? '');
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
      };
      const hashBody = (value) => {
        let text = '';
        if (typeof value === 'string') text = value;
        else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) text = String(bodyByteLength(value));
        else return '';
        return stableHash(text);
      };
      const shouldCapture = (rawUrl) => {
        const text = String(rawUrl || '');
        return /creator\\.douyin\\.com|www\\.douyin\\.com|douyin\\.com/.test(text)
          && /api|aweme|item|content|creator|comment|interaction|message|im|notice|data|stat|analysis|dashboard|manage/i.test(text);
      };
      const pushEntry = (entry) => {
        const responseJson = entry.responseJson ?? null;
        if (responseJson) {
          const calls = collectEndpointCalls(responseJson);
          for (const call of calls) {
            if (!window[endpointQueueName].some((item) => item.urlPath === call.urlPath && item.keyPath === call.keyPath)) {
              window[endpointQueueName].push(call);
            }
          }
        }
        window[sourceName].push({
          source: entry.source || '',
          url_path: urlPath(entry.url),
          query_keys: queryKeys(entry.url),
          method: String(entry.method || 'GET').toUpperCase(),
          status: entry.status ?? null,
          content_type: entry.contentType || '',
          response_type: entry.responseType || '',
          request_body_type: entry.requestBodyType || '',
          request_body_byte_length: entry.requestBodyByteLength || 0,
          request_body_hash: entry.requestBodyHash || '',
          response_byte_length: entry.responseByteLength || 0,
          response_body_hash: entry.responseBodyHash || '',
          request_wire_shape: entry.requestWireShape || null,
          response_wire_shape: entry.responseWireShape || null,
          response_endpoint_hints: responseJson ? collectEndpointHints(responseJson).slice(0, 30) : [],
          response_shape: responseJson ? summarize(responseJson) : null,
          response_array_paths: responseJson ? collectArrayPaths(responseJson).slice(0, 30) : [],
          captured_at: Date.now(),
        });
      };
      window[sourceName] = [];
      window[errorName] = [];
      window[endpointQueueName] = [];
      if (!window.__opencli_douyin_creator_api_summary_fetch) {
        window.__opencli_douyin_creator_api_summary_fetch = window.fetch.bind(window);
        window.fetch = async function(...args) {
          const req = args[0];
          const init = args[1] || {};
          const rawUrl = typeof req === 'string' ? req : (req && req.url) || '';
          const method = init.method || (req && req.method) || 'GET';
          const response = await window.__opencli_douyin_creator_api_summary_fetch.apply(this, args);
          if (shouldCapture(rawUrl)) {
            try {
              const text = await response.clone().text();
              pushEntry({
                url: rawUrl,
                method,
                status: response.status,
                contentType: response.headers.get('content-type') || '',
                responseType: 'fetch',
                requestBodyType: bodyType(init.body),
                requestBodyByteLength: bodyByteLength(init.body),
                requestBodyHash: hashBody(init.body),
                responseByteLength: text.length,
                responseBodyHash: hashBody(text),
                requestWireShape: compactProtoShape(init.body),
                responseWireShape: null,
                responseJson: safeJson(text),
                source: 'page_fetch',
              });
            } catch (error) {
              window[errorName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'fetch' });
            }
          }
          return response;
        };
      }
      if (!window.__opencli_douyin_creator_api_summary_xhr_open) {
        window.__opencli_douyin_creator_api_summary_xhr_open = window.XMLHttpRequest.prototype.open;
        window.__opencli_douyin_creator_api_summary_xhr_send = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function(method, rawUrl) {
          Object.defineProperty(this, '__opencli_creator_api_url', { value: String(rawUrl), writable: true, configurable: true });
          Object.defineProperty(this, '__opencli_creator_api_method', { value: String(method || 'GET').toUpperCase(), writable: true, configurable: true });
          return window.__opencli_douyin_creator_api_summary_xhr_open.apply(this, arguments);
        };
        window.XMLHttpRequest.prototype.send = function(body) {
          this.addEventListener('load', function() {
            const rawUrl = this.__opencli_creator_api_url || '';
            if (!shouldCapture(rawUrl)) return;
            try {
              const responseType = this.responseType || 'text';
              if (responseType && responseType !== 'text') {
                pushEntry({
                  url: rawUrl,
                  method: this.__opencli_creator_api_method || 'GET',
                  status: this.status,
                  contentType: this.getResponseHeader('content-type') || '',
                  responseType,
                  requestBodyType: bodyType(body),
                  requestBodyByteLength: bodyByteLength(body),
                  requestBodyHash: hashBody(body),
                  responseByteLength: bodyByteLength(this.response),
                  responseBodyHash: hashBody(this.response),
                  requestWireShape: compactProtoShape(body),
                  responseWireShape: compactProtoShape(this.response),
                  responseJson: null,
                  source: 'page_xhr',
                });
                return;
              }
              const text = typeof this.responseText === 'string' ? this.responseText : '';
              pushEntry({
                url: rawUrl,
                method: this.__opencli_creator_api_method || 'GET',
                status: this.status,
                contentType: this.getResponseHeader('content-type') || '',
                responseType,
                requestBodyType: bodyType(body),
                requestBodyByteLength: bodyByteLength(body),
                requestBodyHash: hashBody(body),
                responseByteLength: text.length,
                responseBodyHash: hashBody(text),
                requestWireShape: compactProtoShape(body),
                responseWireShape: null,
                responseJson: safeJson(text),
                source: 'page_xhr',
              });
            } catch (error) {
              window[errorName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'xhr' });
            }
          });
          return window.__opencli_douyin_creator_api_summary_xhr_send.apply(this, arguments);
        };
      }
      const clickVisibleLabel = async (label) => {
        const target = Array.from(document.querySelectorAll('a,button,[role="button"],[role="tab"],span,div'))
          .find((node) => {
            const text = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
            if (text !== label) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const clickable = target?.closest?.('a,button,[role="button"],[role="tab"]') || target;
        if (clickable) {
          clickable.click();
          await sleep(800);
          return true;
        }
        return false;
      };
      await sleep(waitMs);
      for (const label of clickLabels) await clickVisibleLabel(label);
      await sleep(1000);
      if (followEndpointHints && endpointFollowLimit > 0) {
        const calls = window[endpointQueueName].slice(0, endpointFollowLimit);
        for (const call of calls) {
          try {
            const method = call.method === 'GET' ? 'GET' : 'GET';
            const response = await window.__opencli_douyin_creator_api_summary_fetch(buildEndpointFetchUrl(call), {
              method,
              credentials: ['include', 'same-origin', 'omit'].includes(call.credentials) ? call.credentials : 'include',
            });
            const text = await response.clone().text();
            pushEntry({
              url: response.url || buildEndpointFetchUrl(call),
              method,
              status: response.status,
              contentType: response.headers.get('content-type') || '',
              responseType: 'follow_endpoint_hint',
              requestBodyType: '',
              requestBodyByteLength: 0,
              requestBodyHash: '',
              responseByteLength: text.length,
              responseBodyHash: hashBody(text),
              requestWireShape: null,
              responseWireShape: null,
              responseJson: safeJson(text),
              source: 'endpoint_hint',
            });
          } catch (error) {
            window[errorName].push({ url_path: call.urlPath || '', error: String(error), source: 'endpoint_hint' });
          }
        }
      }
      const byKey = new Map();
      for (const row of window[sourceName]) {
        const key = [row.source, row.method, row.url_path, row.status, JSON.stringify(row.query_keys || [])].join('|');
        if (!byKey.has(key)) byKey.set(key, row);
      }
      return {
        current_url: window.location.href,
        page_title: document.title || '',
        captured_count: window[sourceName].length,
        deduped_count: byKey.size,
        rows: Array.from(byKey.values()).slice(0, limit),
        errors: window[errorName].slice(0, 20),
      };
    })()
  `);
  return normalizeCreatorApiSummaryRows(result, { limit });
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-api-summary',
    description: douyinCreatorApiSummarySpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_HOME_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinCreatorApiSummarySpec.args,
    columns: douyinCreatorApiSummarySpec.columns,
    func: async (page, kwargs) => inspectDouyinCreatorApiSummary(page, kwargs),
  });
}
