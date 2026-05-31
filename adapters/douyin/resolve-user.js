import {
  DOUYIN_WEB_BASE,
  normalizeDouyinIdentifier,
  resolveDouyinIdentifier,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinResolveUserSpec = {
  site: 'douyin',
  name: 'skill-resolve-user',
  description: '将抖音号、主页链接或 sec_uid 解析成稳定用户标识',
  args: [
    { name: 'identifier', type: 'string', required: true, positional: true, help: '抖音号、主页链接或 sec_uid' },
  ],
  columns: ['identifier', 'source', 'sec_uid', 'uid', 'nickname', 'unique_id', 'short_id', 'profile_url', 'resolved'],
};

export function resolveDouyinUserArtifacts(identifier, artifacts = {}) {
  return resolveDouyinIdentifier(identifier, artifacts);
}

export function buildDouyinResolveTarget(identifier) {
  const normalized = normalizeDouyinIdentifier(identifier);
  if (normalized.source === 'sec_uid') {
    return normalized.profile_url;
  }
  if (normalized.source === 'url') {
    return normalized.raw;
  }
  if (normalized.source === 'username' && normalized.raw) {
    return `${DOUYIN_WEB_BASE}/search/${encodeURIComponent(normalized.raw)}?type=user`;
  }
  return '';
}

export async function inspectDouyinResolveArtifacts(page, identifier) {
  const targetUrl = buildDouyinResolveTarget(identifier);
  if (!targetUrl) {
    return {
      final_url: '',
      html: '',
    };
  }

  if (typeof page?.goto !== 'function' || typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with goto/evaluate is required to resolve douyin users from page content');
  }

  await page.goto(targetUrl);
  if (typeof page.wait === 'function') {
    await page.wait(2);
  }

  return page.evaluate(() => ({
    final_url: globalThis.location?.href ?? '',
    html: globalThis.document?.documentElement?.outerHTML ?? '',
  }));
}

export async function resolveDouyinUser(page, identifier, options = {}) {
  const normalized = normalizeDouyinIdentifier(identifier);
  if (normalized.source === 'sec_uid') {
    if (options.artifacts) {
      return resolveDouyinIdentifier(identifier, options.artifacts);
    }
    if (typeof page?.goto !== 'function' || typeof page?.evaluate !== 'function') {
      return resolveDouyinIdentifier(identifier);
    }
    const artifacts = await inspectDouyinResolveArtifacts(page, identifier).catch(() => null);
    if (!artifacts) {
      return resolveDouyinIdentifier(identifier);
    }
    return resolveDouyinIdentifier(identifier, artifacts);
  }

  const artifacts = options.artifacts ?? await inspectDouyinResolveArtifacts(page, identifier);
  return resolveDouyinIdentifier(identifier, artifacts);
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-resolve-user',
    description: douyinResolveUserSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    defaultFormat: 'json',
    args: douyinResolveUserSpec.args,
    columns: douyinResolveUserSpec.columns,
    func: async (page, kwargs) => {
      const row = await resolveDouyinUser(page, kwargs.identifier);
      return [row];
    },
  });
}
