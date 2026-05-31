import {
  DOUYIN_CREATOR_HOME_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinCreatorInspectSpec = {
  site: 'douyin',
  name: 'skill-creator-inspect',
  description: '只读检查抖音创作者中心页面状态和可见模块，不导出正文内容',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_HOME_URL, help: 'Douyin creator center URL' },
    { name: 'wait_seconds', type: 'int', default: 3, help: 'Seconds to wait after page load' },
  ],
  columns: [
    'data_source',
    'current_url',
    'page_title',
    'page_unavailable',
    'login_hint',
    'module_work_hint',
    'module_comment_hint',
    'module_message_hint',
    'module_metric_hint',
    'link_count',
    'button_count',
  ],
};

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export async function inspectDouyinCreatorCenter(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_HOME_URL);
  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') {
      await page.wait(Number(kwargs.wait_seconds ?? 3));
    }
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator center inspect.');
  }

  const state = await page.evaluate(() => {
    const text = String(document?.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const currentUrl = String(globalThis.location?.href || '');
    return {
      current_url: currentUrl,
      page_title: String(document?.title || ''),
      body_text_sample: text.slice(0, 2000),
      link_count: document?.querySelectorAll?.('a')?.length || 0,
      button_count: document?.querySelectorAll?.('button')?.length || 0,
    };
  });
  const text = String(state?.body_text_sample || '');
  return [{
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    current_url: String(state?.current_url || targetUrl),
    page_title: String(state?.page_title || ''),
    page_unavailable: includesAny(text, [/页面不存在/, /无法访问/, /服务异常/, /404/i, /not found/i]),
    login_hint: includesAny(text, [/登录/, /扫码/, /验证码/, /请先登录/, /login/i]),
    module_work_hint: includesAny(text, [/作品/, /内容管理/, /发布/]),
    module_comment_hint: includesAny(text, [/评论/, /互动/]),
    module_message_hint: includesAny(text, [/私信/, /消息/, /会话/]),
    module_metric_hint: includesAny(text, [/数据/, /播放/, /粉丝/, /分析/, /收益/]),
    link_count: Number(state?.link_count || 0),
    button_count: Number(state?.button_count || 0),
  }];
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-inspect',
    description: douyinCreatorInspectSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_HOME_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: douyinCreatorInspectSpec.args,
    columns: douyinCreatorInspectSpec.columns,
    func: async (page, kwargs) => inspectDouyinCreatorCenter(page, kwargs),
  });
}
