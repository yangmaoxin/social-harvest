import path from 'node:path';

import { ROOT_DIR } from './runtime-config.js';

function nodeTask(id, label, script, extra = {}) {
  return {
    id,
    label,
    runner: 'node',
    script: path.join(ROOT_DIR, script),
    injectOutputDir: true,
    defaultArgs: [],
    ...extra,
  };
}

function compositeTask(id, label, steps, extra = {}) {
  return {
    id,
    label,
    runner: 'composite',
    steps,
    defaultArgs: [],
    ...extra,
  };
}

export const GLOBAL_TASKS = {
  diagnostic: nodeTask('diagnostic', '运行前检查', 'scripts/doctor.js', {
    capability: 'diagnostic',
    injectOutputDir: false,
    defaultArgs: ['--json'],
    reportFileName: 'doctor-report.json',
  }),
};

export const PLATFORM_REGISTRY = {
  'weixin-channels': {
    id: 'weixin-channels',
    label: '微信视频号',
    script: path.join(ROOT_DIR, 'scripts', 'resume-weixin-channels.js'),
    defaultTask: 'creator-center',
    supportsAccounts: true,
    supportsPrivateMessages: true,
    supportsImport: true,
    supportsSchedule: true,
    tasks: {
      'creator-center': compositeTask('creator-center', '视频号创作者日常全流程', [
        { task: 'creator-content', argProfile: 'content' },
        { task: 'creator-account', argProfile: 'account' },
        { task: 'creator-danmaku', argProfile: 'danmaku' },
        { task: 'creator-messages', argProfile: 'messages' },
      ], {
        capability: 'creator-center',
        userFacing: true,
      }),
      'creator-content': nodeTask('creator-content', '视频号创作者内容更新', 'scripts/resume-weixin-channels.js', {
        capability: 'creator-content',
        defaultArgs: ['--content-only'],
      }),
      'creator-account': nodeTask('creator-account', '视频号账号主体更新', 'scripts/harvest-weixin-channels-account.js', {
        capability: 'creator-account',
      }),
      'content-import': nodeTask('content-import', '视频号内容写入业务系统', 'scripts/import-to-scrm.js', {
        capability: 'content-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels'],
      }),
      'account-import': nodeTask('account-import', '视频号账号主体写入业务系统', 'scripts/import-account-to-scrm.js', {
        capability: 'account-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels'],
      }),
      'creator-danmaku': nodeTask('creator-danmaku', '视频号弹幕更新', 'scripts/sync-weixin-channels-danmaku-to-scrm.js', {
        capability: 'creator-danmaku',
        defaultArgs: ['--export-only'],
      }),
      'danmaku-import': nodeTask('danmaku-import', '视频号弹幕写入业务系统', 'scripts/import-danmaku-to-scrm.js', {
        capability: 'danmaku-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels'],
      }),
      'creator-messages': nodeTask('creator-messages', '视频号私信线索更新', 'scripts/sync-weixin-channels-private-messages-to-scrm-message.js', {
        capability: 'creator-messages',
        defaultArgs: ['--export-only'],
      }),
      'messages-import': nodeTask('messages-import', '视频号私信线索写入业务系统', 'scripts/import-private-messages-to-scrm-message.js', {
        capability: 'messages-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels'],
      }),
      'metric-snapshot-account': nodeTask('metric-snapshot-account', '视频号账号指标快照写入', 'scripts/import-metric-snapshot-to-scrm.js', {
        capability: 'metric-snapshot-account',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels', '--scope', 'account', '--apply'],
      }),
      'metric-snapshot-work': nodeTask('metric-snapshot-work', '视频号作品指标快照写入', 'scripts/import-metric-snapshot-to-scrm.js', {
        capability: 'metric-snapshot-work',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels', '--scope', 'work', '--apply'],
      }),
      'metric-delta-account': nodeTask('metric-delta-account', '视频号账号指标事件生成', 'scripts/generate-metric-delta-events.js', {
        capability: 'metric-delta-account',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels', '--scope', 'account', '--apply'],
      }),
      'metric-delta-work': nodeTask('metric-delta-work', '视频号作品指标事件生成', 'scripts/generate-metric-delta-events.js', {
        capability: 'metric-delta-work',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'weixin-channels', '--scope', 'work', '--apply'],
      }),
    },
  },
  douyin: {
    id: 'douyin',
    label: '抖音',
    script: path.join(ROOT_DIR, 'scripts', 'harvest-douyin.js'),
    defaultTask: 'creator-center',
    supportsAccounts: true,
    supportsPrivateMessages: true,
    supportsImport: true,
    supportsSchedule: true,
    tasks: {
      'creator-center': compositeTask('creator-center', '抖音创作者日常全流程', [
        { task: 'creator-content', argProfile: 'content' },
        { task: 'creator-account', argProfile: 'account' },
        { task: 'creator-messages', argProfile: 'messages' },
      ], {
        capability: 'creator-center',
        userFacing: true,
      }),
      'public-content': nodeTask('public-content', '抖音公开账号内容采集', 'scripts/harvest-douyin.js', {
        capability: 'public-content',
      }),
      'creator-content': nodeTask('creator-content', '抖音创作者内容更新', 'scripts/harvest-douyin-creator.js', {
        capability: 'creator-content',
      }),
      'creator-account': nodeTask('creator-account', '抖音账号主体更新', 'scripts/harvest-douyin-account.js', {
        capability: 'creator-account',
      }),
      'content-import': nodeTask('content-import', '抖音内容写入业务系统', 'scripts/import-douyin-content-to-scrm.js', {
        capability: 'content-import',
        injectOutputDir: false,
      }),
      'account-import': nodeTask('account-import', '抖音账号主体写入业务系统', 'scripts/import-account-to-scrm.js', {
        capability: 'account-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin'],
      }),
      'creator-danmaku': nodeTask('creator-danmaku', '抖音创作者弹幕更新', 'scripts/harvest-douyin-creator.js', {
        capability: 'creator-danmaku',
        contentAndDanmakuCoupled: true,
      }),
      'danmaku-import': nodeTask('danmaku-import', '抖音弹幕写入业务系统', 'scripts/import-danmaku-to-scrm.js', {
        capability: 'danmaku-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin'],
      }),
      'creator-messages': nodeTask('creator-messages', '抖音私信线索更新', 'scripts/sync-douyin-private-messages-to-scrm-message.js', {
        capability: 'creator-messages',
        defaultArgs: ['--export-only'],
        exportAndImportCoupled: true,
      }),
      'messages-import': nodeTask('messages-import', '抖音私信线索写入业务系统', 'scripts/import-private-messages-to-scrm-message.js', {
        capability: 'messages-import',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin'],
      }),
      'metric-snapshot-account': nodeTask('metric-snapshot-account', '抖音账号指标快照写入', 'scripts/import-metric-snapshot-to-scrm.js', {
        capability: 'metric-snapshot-account',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin', '--scope', 'account', '--apply'],
      }),
      'metric-snapshot-work': nodeTask('metric-snapshot-work', '抖音作品指标快照写入', 'scripts/import-metric-snapshot-to-scrm.js', {
        capability: 'metric-snapshot-work',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin', '--scope', 'work', '--apply'],
      }),
      'metric-delta-account': nodeTask('metric-delta-account', '抖音账号指标事件生成', 'scripts/generate-metric-delta-events.js', {
        capability: 'metric-delta-account',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin', '--scope', 'account', '--apply'],
      }),
      'metric-delta-work': nodeTask('metric-delta-work', '抖音作品指标事件生成', 'scripts/generate-metric-delta-events.js', {
        capability: 'metric-delta-work',
        injectOutputDir: false,
        defaultArgs: ['--platform', 'douyin', '--scope', 'work', '--apply'],
      }),
    },
  },
};

export function listPlatforms() {
  return Object.values(PLATFORM_REGISTRY);
}

export function listGlobalTasks() {
  return Object.values(GLOBAL_TASKS);
}

export function getPlatformDefinition(platformId) {
  const platform = PLATFORM_REGISTRY[platformId];
  if (!platform) {
    const supported = Object.keys(PLATFORM_REGISTRY).join(', ');
    throw new Error(`Unsupported platform "${platformId}". Supported platforms: ${supported}`);
  }
  return platform;
}

export function listPlatformTasks(platformId) {
  return Object.values(getPlatformDefinition(platformId).tasks || {});
}

export function getPlatformTaskDefinition(platformId, taskId = '') {
  const platform = getPlatformDefinition(platformId);
  const requestedTaskId = taskId || platform.defaultTask;
  const task = platform.tasks?.[requestedTaskId];
  if (!task) {
    const supported = Object.keys(platform.tasks || {}).join(', ');
    throw new Error(`Unsupported task "${requestedTaskId}" for platform "${platformId}". Supported tasks: ${supported}`);
  }
  return task;
}

export function hasGlobalTaskDefinition(taskId) {
  return Boolean(GLOBAL_TASKS[taskId]);
}

export function getGlobalTaskDefinition(taskId) {
  const task = GLOBAL_TASKS[taskId];
  if (!task) {
    const supported = Object.keys(GLOBAL_TASKS).join(', ');
    throw new Error(`Unsupported global task "${taskId}". Supported tasks: ${supported}`);
  }
  return task;
}
