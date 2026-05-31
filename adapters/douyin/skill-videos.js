import {
  DOUYIN_USER_VIDEOS_PATH,
  fetchDouyinUserVideoPage,
  normalizeDouyinVideo,
  normalizeDouyinVideoLimit,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinVideosSpec = {
  site: 'douyin',
  name: 'skill-videos',
  description: '抓取指定抖音用户的作品列表，支持视频和图文',
  args: [
    { name: 'sec_uid', type: 'string', required: true },
    { name: 'limit', type: 'int', default: 20 },
    { name: 'cursor', type: 'string', default: '0' },
  ],
  columns: [
    'aweme_id',
    'title',
    'file_type',
    'aweme_type',
    'media_type',
    'image_count',
    'image_urls',
    'cover_url',
    'play_url',
    'create_time',
    'digg_count',
    'comment_count',
    'share_count',
    'duration',
    'has_more',
    'next_cursor',
  ],
};

export async function fetchDouyinVideoRows(page, kwargs = {}) {
  const secUid = String(kwargs.sec_uid ?? '').trim();
  if (!secUid) {
    throw new Error('sec_uid is required');
  }

  if (typeof page?.installInterceptor === 'function') {
    await page.installInterceptor(DOUYIN_USER_VIDEOS_PATH);
  }

  if (typeof page?.goto === 'function') {
    await page.goto(`https://www.douyin.com/user/${secUid}`);
    if (typeof page.wait === 'function') {
      await page.wait(3);
    }
  }

  const limit = normalizeDouyinVideoLimit(kwargs.limit ?? 20, 20);
  if (typeof page?.getInterceptedRequests === 'function') {
    for (let index = 0; index < 5; index += 1) {
      const intercepted = await page.getInterceptedRequests().catch(() => []);
      const captured = Array.isArray(intercepted)
        ? intercepted.find((entry) => Array.isArray(entry?.aweme_list))
        : null;
      if (captured?.aweme_list) {
        return captured.aweme_list.slice(0, limit).map(normalizeDouyinVideo);
      }
      if (typeof page?.wait === 'function') {
        await page.wait(1);
      }
    }
  }

  const result = await fetchDouyinUserVideoPage(page, secUid, {
    limit,
    cursor: kwargs.cursor ?? '0',
  });
  return result.rows.slice(0, limit).map((row) => ({
    ...normalizeDouyinVideo(row),
    ...((result.has_more || result.next_cursor) ? {
      has_more: Boolean(result.has_more),
      next_cursor: String(result.next_cursor || ''),
    } : {}),
  }));
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-videos',
    description: douyinVideosSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: 'https://www.douyin.com',
    browser: true,
    defaultFormat: 'json',
    args: douyinVideosSpec.args,
    columns: douyinVideosSpec.columns,
    func: async (page, kwargs) => fetchDouyinVideoRows(page, kwargs),
  });
}
