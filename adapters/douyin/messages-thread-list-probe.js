import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageThreadList,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesThreadListProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-thread-list-probe',
  description: '列出当前抖音私信页左侧可见会话的 rank、昵称和预览，帮助对齐 DOM/API 会话选择',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
  ],
  columns: [
    'thread_rank',
    'thread_nickname',
    'thread_preview_text',
    'has_avatar',
    'is_selected',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-thread-list-probe',
    description: douyinMessagesThreadListProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: douyinMessagesThreadListProbeSpec.args,
    columns: douyinMessagesThreadListProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageThreadList(page, kwargs),
  });
}
