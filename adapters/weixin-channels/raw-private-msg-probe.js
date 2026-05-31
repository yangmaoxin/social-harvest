import { cli, Strategy } from '@jackwener/opencli/registry';

import { PRIVATE_MESSAGE_TAB_LABELS, PRIVATE_MSG_URL } from './shared.js';

async function installPageCapture(page, pattern = '/cgi-bin/mmfinderassistant-bin') {
  return page.evaluate(`
    (() => {
      const pattern = ${JSON.stringify(pattern)};
      const arrName = '__opencli_private_msg_probe';
      const errName = '__opencli_private_msg_probe_errors';
      const parseJson = (text) => {
        if (typeof text !== 'string' || !text.trim()) return null;
        try { return JSON.parse(text); } catch { return null; }
      };
      const shouldCapture = (url) => typeof url === 'string' && url.includes(pattern);
      const getInteractionWindow = () => {
        const iframe = Array.from(document.querySelectorAll('iframe')).find((node) => {
          try {
            const href = String(node.contentWindow?.location?.href || '');
            return href.includes('/micro/interaction/');
          } catch {
            return false;
          }
        });
        return iframe?.contentWindow || null;
      };
      const installInto = (targetWindow, source) => {
        if (!targetWindow) return { ok: false, source, reason: 'missing-window' };
        if (!targetWindow[arrName]) targetWindow[arrName] = [];
        if (!targetWindow[errName]) targetWindow[errName] = [];
        const pushEntry = (entry) => {
          targetWindow[arrName].push({
            url: String(entry.url || ''),
            method: String(entry.method || 'GET').toUpperCase(),
            requestBody: entry.requestBody ?? null,
            responseBody: entry.responseBody ?? null,
            responsePreview: entry.responsePreview ?? '',
            responseStatus: entry.responseStatus ?? null,
            responseContentType: entry.responseContentType ?? '',
            capturedAt: Date.now(),
            source,
          });
        };

        if (!targetWindow.__opencli_private_msg_probe_fetch) {
          targetWindow.__opencli_private_msg_probe_fetch = targetWindow.fetch.bind(targetWindow);
          targetWindow.fetch = async function(...args) {
            const req = args[0];
            const init = args[1] || {};
            const url = typeof req === 'string' ? req : (req && req.url) || '';
            const method = init.method || (req && req.method) || 'GET';
            const bodyText = typeof init.body === 'string' ? init.body : null;
            const response = await targetWindow.__opencli_private_msg_probe_fetch.apply(this, args);
            if (shouldCapture(url)) {
              try {
                const clone = response.clone();
                const preview = await clone.text();
                pushEntry({
                  url,
                  method,
                  requestBody: parseJson(bodyText),
                  responseBody: parseJson(preview),
                  responsePreview: preview.slice(0, 4000),
                  responseStatus: response.status,
                  responseContentType: response.headers.get('content-type') || '',
                });
              } catch (error) {
                targetWindow[errName].push({ url, error: String(error), source });
              }
            }
            return response;
          };
        }

        if (!targetWindow.__opencli_private_msg_probe_xhr_open) {
          targetWindow.__opencli_private_msg_probe_xhr_open = targetWindow.XMLHttpRequest.prototype.open;
          targetWindow.__opencli_private_msg_probe_xhr_send = targetWindow.XMLHttpRequest.prototype.send;
          targetWindow.__opencli_private_msg_probe_xhr_set_header = targetWindow.XMLHttpRequest.prototype.setRequestHeader;

          targetWindow.XMLHttpRequest.prototype.open = function(method, url) {
            Object.defineProperty(this, '__opencli_probe_url', { value: String(url), writable: true, configurable: true });
            Object.defineProperty(this, '__opencli_probe_method', { value: String(method || 'GET').toUpperCase(), writable: true, configurable: true });
            return targetWindow.__opencli_private_msg_probe_xhr_open.apply(this, arguments);
          };

          targetWindow.XMLHttpRequest.prototype.setRequestHeader = function(key, value) {
            const headers = this.__opencli_probe_headers || {};
            headers[String(key).toLowerCase()] = String(value);
            Object.defineProperty(this, '__opencli_probe_headers', { value: headers, writable: true, configurable: true });
            return targetWindow.__opencli_private_msg_probe_xhr_set_header.apply(this, arguments);
          };

          targetWindow.XMLHttpRequest.prototype.send = function(body) {
            this.addEventListener('load', function() {
              const url = this.__opencli_probe_url || '';
              if (!shouldCapture(url)) return;
              try {
                const responseText = typeof this.responseText === 'string' ? this.responseText : '';
                pushEntry({
                  url,
                  method: this.__opencli_probe_method || 'GET',
                  requestBody: typeof body === 'string' ? parseJson(body) : null,
                  responseBody: parseJson(responseText),
                  responsePreview: responseText.slice(0, 4000),
                  responseStatus: this.status,
                  responseContentType: this.getResponseHeader('content-type') || '',
                });
              } catch (error) {
                targetWindow[errName].push({ url, error: String(error), source });
              }
            });
            return targetWindow.__opencli_private_msg_probe_xhr_send.apply(this, arguments);
          };
        }

        return { ok: true, source };
      };

      const topResult = installInto(window, 'top');
      const interactionResult = installInto(getInteractionWindow(), 'interaction');

      return { ok: true, pattern, installed: true, targets: [topResult, interactionResult] };
    })()
  `);
}

async function readPageCapture(page) {
  return page.evaluate(`
    (() => {
      const arrName = '__opencli_private_msg_probe';
      const errName = '__opencli_private_msg_probe_errors';
      const getInteractionWindow = () => {
        const iframe = Array.from(document.querySelectorAll('iframe')).find((node) => {
          try {
            const href = String(node.contentWindow?.location?.href || '');
            return href.includes('/micro/interaction/');
          } catch {
            return false;
          }
        });
        return iframe?.contentWindow || null;
      };
      const collect = (targetWindow, source) => {
        if (!targetWindow) return { source, rows: [], errors: [] };
        const rows = Array.isArray(targetWindow[arrName]) ? targetWindow[arrName].slice() : [];
        const errors = Array.isArray(targetWindow[errName]) ? targetWindow[errName].slice() : [];
        targetWindow[arrName] = [];
        targetWindow[errName] = [];
        return { source, rows, errors };
      };
      const collected = [
        collect(window, 'top'),
        collect(getInteractionWindow(), 'interaction'),
      ];
      return {
        rows: collected.flatMap((entry) => entry.rows || []),
        errors: collected.flatMap((entry) => entry.errors || []),
      };
    })()
  `);
}

async function clickTabByLabel(page, label) {
  return page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (node) => {
        if (!node || node.nodeType !== 1 || typeof node.getBoundingClientRect !== 'function') return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const label = ${JSON.stringify(label)};
      const iframe = Array.from(document.querySelectorAll('iframe')).find((node) => {
        try {
          return String(node.contentWindow?.location?.href || '').includes('/micro/interaction/');
        } catch {
          return false;
        }
      });
      const doc = iframe?.contentWindow?.document || document;
      const nodes = Array.from(doc.querySelectorAll('button, [role="tab"], div, span, a'));
      const pickMainPanelNode = (candidates) => {
        const viewportWidth = doc.defaultView?.innerWidth || window.innerWidth || 0;
        return candidates
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .sort((left, right) => {
            const leftMainPanel = left.rect.left > viewportWidth * 0.18 ? 0 : 1;
            const rightMainPanel = right.rect.left > viewportWidth * 0.18 ? 0 : 1;
            if (leftMainPanel !== rightMainPanel) return leftMainPanel - rightMainPanel;
            return left.rect.top - right.rect.top;
          })[0]?.node || null;
      };
      const exact = pickMainPanelNode(nodes.filter((node) => isVisible(node) && normalize(node.textContent) === label));
      const fuzzy = pickMainPanelNode(nodes.filter((node) => isVisible(node) && normalize(node.textContent).includes(label)));
      const target = exact || fuzzy;
      if (!target) {
        return {
          ok: false,
          label,
          visible_labels: nodes
            .filter((node) => isVisible(node))
            .map((node) => normalize(node.textContent))
            .filter(Boolean)
            .slice(0, 40),
        };
      }
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, label, text: normalize(target.textContent) };
    })()
  `);
}

async function clickFirstConversation(page) {
  return page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (node) => {
        if (!node || node.nodeType !== 1 || typeof node.getBoundingClientRect !== 'function') return false;
        const view = node.ownerDocument?.defaultView || window;
        const style = view.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const splitLines = (text) => String(text ?? '')
        .split(/\\n+/)
        .map((line) => normalize(line))
        .filter(Boolean);
      const uniqueLines = (node) => Array.from(new Set(splitLines(node?.innerText || node?.textContent || '')));
      const matchTimeLike = (text) => /^(\\d{2}:\\d{2}|\\d{2}月\\d{2}日|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{2}月\\d{2}日 \\d{2}:\\d{2})$/.test(text);
      const iframe = Array.from(document.querySelectorAll('iframe')).find((node) => {
        try {
          return String(node.contentWindow?.location?.href || '').includes('/micro/interaction/');
        } catch {
          return false;
        }
      });
      const doc = iframe?.contentWindow?.document || document;
      const tabNode = Array.from(doc.querySelectorAll('button, [role="tab"], div, span, a'))
        .filter((node) => isVisible(node) && normalize(node.textContent) === '私信')
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .sort((left, right) => {
          const viewportWidth = doc.defaultView?.innerWidth || window.innerWidth || 0;
          const leftMainPanel = left.rect.left > viewportWidth * 0.18 ? 0 : 1;
          const rightMainPanel = right.rect.left > viewportWidth * 0.18 ? 0 : 1;
          if (leftMainPanel !== rightMainPanel) return leftMainPanel - rightMainPanel;
          return left.rect.top - right.rect.top;
        })[0]?.node || null;
      const tabRect = tabNode?.getBoundingClientRect() || { bottom: 0 };
      const leftBoundary = (doc.defaultView?.innerWidth || window.innerWidth) * 0.42;
      const avatarNodes = Array.from(doc.querySelectorAll('img'))
        .filter((node) => {
          if (!isVisible(node)) return false;
          const rect = node.getBoundingClientRect();
          return rect.left < leftBoundary && rect.top > tabRect.bottom + 40 && rect.width >= 24 && rect.height >= 24;
        });
      let target = null;
      let text = '';
      for (const avatar of avatarNodes) {
        let node = avatar;
        for (let depth = 0; depth < 6 && node?.parentElement; depth += 1) {
          node = node.parentElement;
          if (!isVisible(node)) continue;
          const rect = node.getBoundingClientRect();
          if (rect.left >= leftBoundary || rect.width < 160 || rect.width > leftBoundary + 120 || rect.height < 48 || rect.height > 180) continue;
          const lines = uniqueLines(node);
          if (lines.length < 2 || lines.length > 5) continue;
          if (!lines.some((line) => matchTimeLike(line))) continue;
          target = node;
          text = normalize(lines.join(' | '));
          break;
        }
        if (target) break;
      }
      if (!target) {
        return {
          ok: false,
          avatars: avatarNodes.length,
          body_preview: normalize(doc.body?.innerText || '').slice(0, 400),
        };
      }
      target.scrollIntoView({ block: 'center' });
      target.click?.();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true, text };
    })()
  `);
}

async function readPageSignals(page) {
  return page.evaluate(`
    (() => {
      const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
      return {
        href: location.href,
        title: document.title,
        hasUnavailableNotice: text.includes('暂时无法使用该功能'),
        hasGreetingTab: text.includes('打招呼消息'),
        hasPrivateList: text.includes('全部私信'),
        body_preview: text.slice(0, 1200),
      };
    })()
  `);
}

async function inspectEmbeddedApps(page) {
  return page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const iframes = Array.from(document.querySelectorAll('iframe')).map((iframe, index) => {
        let accessible = false;
        let href = '';
        let bodyPreview = '';
        let scripts = [];
        try {
          const doc = iframe.contentWindow?.document;
          accessible = Boolean(doc);
          href = String(iframe.contentWindow?.location?.href || '');
          bodyPreview = normalize(doc?.body?.innerText || '').slice(0, 600);
          scripts = Array.from(doc?.scripts || []).map((script) => script.src).filter(Boolean).slice(0, 30);
        } catch {
          accessible = false;
        }
        return {
          index,
          src: iframe.getAttribute('src') || '',
          name: iframe.getAttribute('name') || '',
          id: iframe.id || '',
          className: iframe.className || '',
          accessible,
          href,
          body_preview: bodyPreview,
          scripts,
        };
      });

      const customRoots = Array.from(document.querySelectorAll('*'))
        .filter((node) => node.shadowRoot)
        .slice(0, 20)
        .map((node, index) => ({
          index,
          tag: node.tagName,
          id: node.id || '',
          className: node.className || '',
          shadow_preview: normalize(node.shadowRoot?.innerText || '').slice(0, 600),
        }));

      return { iframes, shadow_roots: customRoots };
    })()
  `);
}

async function inspectPrivateMsgScripts(page) {
  return page.evaluate(`
    (async () => {
      const keywords = ['private_msg', 'privateMsg', 'PrivateMsg', 'MicroPrivateMsg', 'greet', 'greeting', 'hello'];
      const scripts = Array.from(document.scripts)
        .map((script) => script.src)
        .filter((src) => typeof src === 'string' && src);
      const uniqueScripts = Array.from(new Set(scripts)).slice(0, 30);

      const snippets = [];
      for (const src of uniqueScripts) {
        try {
          const response = await fetch(src, { credentials: 'include' });
          const text = await response.text();
          const lowered = text.toLowerCase();
          const hit = keywords.find((keyword) => lowered.includes(keyword.toLowerCase()));
          if (!hit) continue;

          const matches = [];
          const pathRegex = /\\/cgi-bin\\/mmfinderassistant-bin\\/[a-zA-Z0-9_/-]+/g;
          const allPaths = text.match(pathRegex) || [];
          for (const path of allPaths) {
            if (path.toLowerCase().includes('msg') || path.toLowerCase().includes('private') || path.toLowerCase().includes('greet')) {
              matches.push(path);
            }
          }

          const hitIndex = lowered.indexOf(hit.toLowerCase());
          const snippet = hitIndex >= 0 ? text.slice(Math.max(0, hitIndex - 240), Math.min(text.length, hitIndex + 360)) : '';
          snippets.push({
            src,
            hit,
            matched_paths: Array.from(new Set(matches)).slice(0, 20),
            snippet,
          });
        } catch (error) {
          snippets.push({
            src,
            hit: 'fetch-error',
            matched_paths: [],
            snippet: String(error),
          });
        }
      }

      return {
        script_count: uniqueScripts.length,
        scripts_with_hits: snippets,
      };
    })()
  `);
}

async function inspectRuntimePrivateMsgState(page) {
  return page.evaluate(`
    (() => {
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const iframe = Array.from(document.querySelectorAll('iframe')).find((node) => {
        try {
          return String(node.contentWindow?.location?.href || '').includes('/micro/interaction/');
        } catch {
          return false;
        }
      });
      const targetWindow = iframe?.contentWindow || window;
      const shareData = targetWindow?.$shareData;
      const stores = typeof shareData?.getStores === 'function' ? shareData.getStores() : {};
      const storeKeys = Object.keys(stores || {}).sort();
      const msgManagerStore = stores?.msgManagerStore || null;
      const privateMsgStore = stores?.privateMsgStore || null;
      const privateMsgTypeStore = stores?.privateMsgTypeStore || null;
      const serializeSessionEntries = (entries) => (Array.isArray(entries) ? entries : [])
        .map((entry) => {
          const sessionId = entry?.[0];
          const session = entry?.[1];
          const latest = session?.latestMessage?.message || {};
          return {
            session_id: sessionId || '',
            nickname: session?.sessionInfo?.nickname || '',
            username: session?.sessionInfo?.username || '',
            session_type: session?.sessionInfo?.sessionType ?? null,
            reject_msg: session?.sessionInfo?.rejectMsg ?? null,
            preview_text: latest?.textMsg?.content || latest?.rawContent || '',
            latest_ts: latest?.ts || null,
          };
        });
      return {
        store_keys: storeKeys,
        msg_manager: msgManagerStore ? {
          current_tab: msgManagerStore.currentTab || '',
          current_session_id: msgManagerStore.currentSessionId || '',
          msg_cookie: msgManagerStore.msgCookie || '',
          is_continue: Boolean(msgManagerStore.isContinue),
          private_session_ids: Array.isArray(msgManagerStore.privateSessionIds) ? msgManagerStore.privateSessionIds.slice() : [],
          call_session_ids: Array.isArray(msgManagerStore.callSessionIds) ? msgManagerStore.callSessionIds.slice() : [],
          private_session_list: serializeSessionEntries(msgManagerStore.privateMsgSessionList),
          call_session_list: serializeSessionEntries(msgManagerStore.callMsgSessionList),
          session_list_keys: Object.keys(msgManagerStore.sessionList || {}),
        } : null,
        private_msg_store: privateMsgStore ? {
          current_type: privateMsgStore.privateMsgType ?? null,
        } : null,
        private_msg_type_store: privateMsgTypeStore ? {
          current_type: privateMsgTypeStore.privateMsgType ?? null,
        } : null,
        local_storage_private_session_info: (() => {
          try {
            const raw = targetWindow.localStorage?.getItem('privateSessionInfo') || '';
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        })(),
        body_preview: normalize(targetWindow.document?.body?.innerText || '').slice(0, 600),
      };
    })()
  `);
}

function normalizeCapturedEntries(entries = [], label = '') {
  return entries.map((entry) => {
    const url = String(entry?.url || '');
    const preview = typeof entry?.responsePreview === 'string' ? entry.responsePreview : '';
    let responseJson = null;
    if (preview && !preview.startsWith('base64:')) {
      try {
        responseJson = JSON.parse(preview);
      } catch {
        responseJson = null;
      }
    }
    return {
      source_tab: label,
      method: entry?.method || '',
      status: entry?.responseStatus ?? entry?.status ?? null,
      content_type: entry?.responseContentType || entry?.contentType || '',
      url,
      path: (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })(),
      request_headers: entry?.requestHeaders || null,
      request_body: entry?.requestBody ?? null,
      response_preview: preview,
      response_json: responseJson,
    };
  });
}

function filterInterestingEntries(entries = []) {
  return entries.filter((entry) => {
    const url = String(entry?.url || '');
    return url.includes('/cgi-bin/mmfinderassistant-bin')
      || url.includes('/platform/private_msg')
      || url.includes('private_msg')
      || url.includes('greet');
  });
}

cli({
  site: 'weixin-channels',
  name: 'raw-private-msg-probe',
  description: '调试命令：抓私信页真实 network 请求，便于定位私信与打招呼消息接口',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 180,
  defaultFormat: 'json',
  args: [
    { name: 'wait-seconds', type: 'int', default: 3, help: 'Seconds to wait after load and each tab switch' },
  ],
  func: async (page, kwargs) => {
    const waitSeconds = Math.max(1, Number(kwargs['wait-seconds'] || 3));

    await page.goto(PRIVATE_MSG_URL);
    await page.wait({ time: waitSeconds });
    const captureInstall = await installPageCapture(page);
    await page.goto(`${PRIVATE_MSG_URL}${PRIVATE_MSG_URL.includes('?') ? '&' : '?'}opencli_probe_reload=${Date.now()}`);
    await page.wait({ time: waitSeconds });
    const captureReinstall = await installPageCapture(page);

    const initialEntries = await readPageCapture(page);
    const pageSignals = await readPageSignals(page);
    const embeddedApps = await inspectEmbeddedApps(page);

    const privateClick = await clickTabByLabel(page, PRIVATE_MESSAGE_TAB_LABELS.private);
    await page.wait({ time: waitSeconds });
    const privateConversationClick = await clickFirstConversation(page);
    await page.wait({ time: waitSeconds });
    const privateEntries = await readPageCapture(page);

    const greetingClick = await clickTabByLabel(page, PRIVATE_MESSAGE_TAB_LABELS.greeting);
    await page.wait({ time: waitSeconds });
    const greetingConversationClick = await clickFirstConversation(page);
    await page.wait({ time: waitSeconds });
    const greetingEntries = await readPageCapture(page);
    const scriptInspection = await inspectPrivateMsgScripts(page);
    const runtimeState = await inspectRuntimePrivateMsgState(page);

    return {
      page_url: PRIVATE_MSG_URL,
      capture_install: captureInstall,
      capture_reinstall: captureReinstall,
      page_signals: pageSignals,
      embedded_apps: embeddedApps,
      private_click: privateClick,
      private_conversation_click: privateConversationClick,
      greeting_click: greetingClick,
      greeting_conversation_click: greetingConversationClick,
      initial_capture_errors: initialEntries?.errors || [],
      private_capture_errors: privateEntries?.errors || [],
      greeting_capture_errors: greetingEntries?.errors || [],
      initial_requests: normalizeCapturedEntries(filterInterestingEntries(Array.isArray(initialEntries?.rows) ? initialEntries.rows : []), 'initial'),
      private_tab_requests: normalizeCapturedEntries(filterInterestingEntries(Array.isArray(privateEntries?.rows) ? privateEntries.rows : []), 'private'),
      greeting_tab_requests: normalizeCapturedEntries(filterInterestingEntries(Array.isArray(greetingEntries?.rows) ? greetingEntries.rows : []), 'greeting'),
      script_inspection: scriptInspection,
      runtime_state: runtimeState,
    };
  },
});
