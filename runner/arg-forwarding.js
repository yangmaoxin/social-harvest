const ARG_VALUE_FLAGS = new Set([
  '--account',
  '--batch-size',
  '--comment-limit',
  '--comment-pages',
  '--comment-work-limit',
  '--config',
  '--danmaku-limit',
  '--danmaku-pages',
  '--danmaku-retry-delay-ms',
  '--danmaku-retries',
  '--danmaku-work-limit',
  '--database',
  '--date',
  '--sink',
  '--app-id',
  '--app-secret',
  '--app-token',
  '--api-base-url',
  '--account-id',
  '--account-profile',
  '--base-name',
  '--folder-token',
  '--host',
  '--image-text-limit',
  '--limit',
  '--load-history-clicks',
  '--max-items',
  '--message-limit',
  '--opencli-dir',
  '--opencli-main',
  '--password',
  '--post-limit',
  '--posts-timeout',
  '--record-sample-limit',
  '--reply-limit',
  '--reply-pages',
  '--tab',
  '--tab-name',
  '--thread-keyword',
  '--thread-rank',
  '--timeout',
  '--table-prefix',
  '--work-index',
  '--url',
  '--user',
  '--user-adapter-dir',
  '--work-limit',
]);

const COMPOSITE_ARG_PROFILES = {
  content: {
    common: new Set([
      '--date',
      '--opencli-dir',
      '--opencli-main',
      '--timeout',
      '--full',
      '--batch-size',
      '--max-items',
      '--resume',
      '--no-resume',
      '--refresh',
    ]),
    douyin: new Set([
      '--comment-limit',
      '--comment-pages',
      '--comment-work-limit',
      '--danmaku-limit',
      '--danmaku-pages',
      '--danmaku-work-limit',
      '--reply-limit',
      '--reply-pages',
      '--with-replies',
      '--without-replies',
      '--work-limit',
    ]),
    'weixin-channels': new Set([
      '--allow-partial-import',
      '--comment-limit',
      '--comments-timeout',
      '--image-text-limit',
      '--limit',
      '--post-limit',
      '--posts-timeout',
      '--skip-image-text-list',
      '--skip-preflight',
      '--skip-startup-preflight',
      '--stop-on-error',
      '--user-adapter-dir',
      '--work-limit',
    ]),
  },
  account: {
    common: new Set([
      '--date',
      '--opencli-dir',
      '--opencli-main',
      '--timeout',
      '--refresh',
    ]),
    douyin: new Set([]),
    'weixin-channels': new Set([
      '--skip-preflight',
      '--skip-startup-preflight',
      '--user-adapter-dir',
    ]),
  },
  danmaku: {
    common: new Set([
      '--date',
      '--opencli-main',
      '--limit',
      '--danmaku-retries',
      '--danmaku-retry-delay-ms',
      '--host',
      '--user',
      '--password',
      '--database',
      '--config',
    ]),
    douyin: new Set([]),
    'weixin-channels': new Set([]),
  },
  messages: {
    common: new Set([
      '--date',
      '--opencli-main',
      '--full',
      '--batch-size',
      '--max-items',
      '--resume',
      '--no-resume',
      '--refresh',
      '--limit',
      '--message-limit',
      '--all-messages',
    ]),
    douyin: new Set([
      '--all',
      '--include-outbound',
      '--load-history-clicks',
      '--record-sample-limit',
      '--tab-name',
      '--thread-keyword',
      '--thread-rank',
      '--url',
    ]),
    'weixin-channels': new Set([
      '--tab',
    ]),
  },
  import: {
    common: new Set([
      '--apply',
      '--limit',
      '--config',
      '--host',
      '--user',
      '--password',
      '--database',
      '--account-bound',
      '--supplement-public-ip',
    ]),
    douyin: new Set([]),
    'weixin-channels': new Set([]),
  },
};

function argAllowedForCompositeStep(platformId, profileName, arg) {
  const profile = COMPOSITE_ARG_PROFILES[profileName || ''] || {};
  return Boolean(profile.common?.has(arg) || profile[platformId]?.has(arg));
}

export function filterArgsForCompositeStep(platformId, step = {}, args = []) {
  const argList = Array.isArray(args) ? args.map(String) : [];
  const profile = step.argProfile || step.task || '';
  const filtered = [];
  for (let index = 0; index < argList.length; index += 1) {
    const arg = argList[index];
    const takesValue = ARG_VALUE_FLAGS.has(arg);
    if (argAllowedForCompositeStep(platformId, profile, arg)) {
      filtered.push(arg);
      if (takesValue && index + 1 < argList.length) filtered.push(argList[++index]);
      continue;
    }
    if (takesValue) index += 1;
  }
  return filtered;
}
