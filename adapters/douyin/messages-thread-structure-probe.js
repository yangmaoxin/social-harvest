import {
  DOUYIN_PRIVATE_MESSAGES_URL,
  probeDouyinPrivateMessageThreadStructure,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinMessagesThreadStructureProbeSpec = {
  site: 'douyin',
  name: 'skill-messages-thread-structure-probe',
  description: '输出二层私信左侧目标会话的 DOM 节点结构，帮助定位真正触发切换的可点击节点',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_PRIVATE_MESSAGES_URL, help: 'Douyin creator center private message URL' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
    { name: 'tab_name', type: 'string', default: '', help: 'Prefer one private-message tab such as 全部 / 朋友私信 / 陌生人私信 / 群消息' },
    { name: 'thread_rank', type: 'int', default: 0, help: 'Inspect one visible detail-thread rank' },
    { name: 'thread_keyword', type: 'string', default: '', help: 'Inspect nodes whose thread label contains this keyword' },
  ],
  columns: [
    'row_rank',
    'source_group',
    'target_label',
    'thread_label',
    'label_match',
    'text',
    'text_length',
    'child_texts',
    'node_tag',
    'node_role',
    'node_class_name',
    'node_rect',
    'has_avatar',
    'avatar_count',
    'is_selected',
    'border_left_width',
    'border_left_color',
    'clickable_tag',
    'clickable_role',
    'clickable_class_name',
    'clickable_rect',
    'clickable_text',
    'clickable_border_left_width',
    'clickable_border_left_color',
    'visible_thread_ranks',
  ],
};

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-messages-thread-structure-probe',
    description: douyinMessagesThreadStructureProbeSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_PRIVATE_MESSAGES_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 240,
    args: douyinMessagesThreadStructureProbeSpec.args,
    columns: douyinMessagesThreadStructureProbeSpec.columns,
    func: async (page, kwargs) => probeDouyinPrivateMessageThreadStructure(page, kwargs),
  });
}
