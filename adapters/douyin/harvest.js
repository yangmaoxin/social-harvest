import { resolveDouyinIdentifier } from './shared.js';
import { fetchDouyinCommentRows } from './comments.js';
import { resolveDouyinUser } from './resolve-user.js';
import { fetchDouyinVideoRows } from './skill-videos.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinHarvestSpec = {
  site: 'douyin',
  name: 'skill-harvest',
  description: '按用户抓取抖音作品与评论，并输出聚合结构',
  args: [
    { name: 'identifier', type: 'string' },
    { name: 'sec_uid', type: 'string' },
    { name: 'cursor', type: 'string', default: '0' },
    { name: 'video_limit', type: 'int', default: 10 },
    { name: 'comment_limit', type: 'int', default: 10 },
    { name: 'comment_pages', type: 'int', default: 1 },
    { name: 'comment_reply_limit', type: 'int', default: 10 },
    { name: 'comment_reply_pages', type: 'int', default: 1 },
    { name: 'with_replies', type: 'bool', default: false },
  ],
  notes: [
    '先解析用户，再抓作品列表，再逐个抓评论',
    '输出结构应以作品为主，每个作品挂 comments 数组',
  ],
};

export async function fetchDouyinHarvestRows(page, kwargs = {}) {
  const identifier = kwargs.sec_uid || kwargs.identifier || '';
  const resolved = await resolveDouyinUser(page, identifier).catch(() => resolveDouyinIdentifier(identifier));
  if (!resolved.sec_uid) {
    throw new Error('A resolvable sec_uid or user URL is required for douyin skill-harvest');
  }

  const videos = await fetchDouyinVideoRows(page, {
    sec_uid: resolved.sec_uid,
    limit: kwargs.video_limit ?? 10,
    cursor: kwargs.cursor ?? '0',
  });

  const commentLimit = kwargs.comment_limit ?? 10;
  const commentsByVideo = await Promise.all(videos.map(async (video) => ({
    aweme_id: video.aweme_id,
    comments: await fetchDouyinCommentRows(page, {
      aweme_id: video.aweme_id,
      limit: commentLimit,
      cursor: '0',
      pages: kwargs.comment_pages ?? 1,
      with_replies: kwargs.with_replies ?? false,
      reply_limit: kwargs.comment_reply_limit ?? kwargs.comment_limit ?? 10,
      reply_pages: kwargs.comment_reply_pages ?? 1,
      self_sec_uid: resolved.sec_uid,
      self_uid: resolved.uid ?? '',
    }),
  })));

  const commentsMap = new Map(commentsByVideo.map((entry) => [entry.aweme_id, entry.comments]));
  return videos.map((video) => ({
    ...video,
    sec_uid: resolved.sec_uid,
    uid: resolved.uid ?? '',
    nickname: resolved.nickname,
    unique_id: resolved.unique_id ?? '',
    profile_url: resolved.profile_url,
    comments: commentsMap.get(video.aweme_id) ?? [],
  }));
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-harvest',
    description: douyinHarvestSpec.description,
    access: 'read',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: 'https://www.douyin.com',
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 1200,
    args: douyinHarvestSpec.args,
    func: async (page, kwargs) => fetchDouyinHarvestRows(page, kwargs),
  });
}
