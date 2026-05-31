import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  inspectDouyinPrivateMessagePage,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-probe',
  description: '诊断已登录抖音私信页面是否可见，不导出私信正文',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin web private message URL' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
  ],
  columns: [
    'current_url',
    'title',
    'ready_state',
    'body_text_length',
    'has_login_hint',
    'has_message_hint',
    'page_unavailable',
    'visible_left_candidate_count',
    'visible_message_candidate_count',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-probe',
    description: douyinMessagesProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: douyinMessagesProbeSpec.args,
    columns: douyinMessagesProbeSpec.columns,
    func: async (page, kwargs) => [await inspectDouyinPrivateMessagePage(page, kwargs)],
  });
}
