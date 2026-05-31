import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  inspectDouyinPrivateMessageDomDetail,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesDomDetailProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-dom-detail-probe',
  description: '诊断抖音私信第二层 DOM 候选区域，不输出私信正文',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'thread_rank', type: 'int', default: 0, help: 'Prefer one visible conversation rank before inspecting the detail pane' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Prefer conversations whose nickname/preview contains this text before inspecting the detail pane' },
    { name: 'load_history_clicks', type: 'int', default: 0, help: 'Click the visible 加载 button in the message pane this many times before sampling DOM detail' },
  ],
  columns: [
    'current_url',
    'title',
    'body_text_length',
    'has_all_private',
    'entry_candidate_count',
    'left_card_candidate_count',
    'message_candidate_count',
    'history_load_visible_count_before',
    'history_load_visible_count_after',
    'history_load_loose_count_before',
    'history_load_loose_count_after',
    'history_load_click_count',
    'history_scroll_container_count',
    'history_scroll_container_samples',
    'history_load_samples_before',
    'history_load_samples_after',
    'history_load_loose_samples_before',
    'history_load_loose_samples_after',
    'history_load_timeline',
    'left_card_samples',
    'message_samples',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-dom-detail-probe',
    description: douyinMessagesDomDetailProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: douyinMessagesDomDetailProbeSpec.args,
    columns: douyinMessagesDomDetailProbeSpec.columns,
    func: async (page, kwargs) => [await inspectDouyinPrivateMessageDomDetail(page, kwargs)],
  });
}
