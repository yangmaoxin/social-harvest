import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

import {
  DOUYIN_CREATOR_HOME_URL,
  DOUYIN_SOURCE_CREATOR_CENTER,
  DOUYIN_WEB_BASE,
} from './shared.js';

const registryModule = await import('@jackwener/opencli/registry').catch(() => null);
const cli = registryModule?.cli;
const Strategy = registryModule?.Strategy;

export const douyinCreatorAccountSpec = {
  site: 'douyin',
  name: 'skill-creator-account',
  description: '通过创作者中心接口抓取当前登录抖音账号的基础信息',
  args: [
    { name: 'url', type: 'string', default: DOUYIN_CREATOR_HOME_URL, help: 'Douyin creator center home URL' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
  ],
  columns: [
    'data_source',
    'account_id',
    'account_name',
    'uid',
    'sec_uid',
    'account_photo',
    'profile_url',
    'fans_count',
    'following_count',
    'like_count',
    'video_count',
    'current_url',
    'page_title',
  ],
};

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function pickFirst(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function pickFirstUrl(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      const url = pickFirst(...value);
      if (url) return url;
      continue;
    }
    const url = cleanText(value);
    if (url) return url;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function buildProfileUrl(secUid) {
  const normalized = cleanText(secUid);
  return normalized ? `${DOUYIN_WEB_BASE}/user/${normalized}` : '';
}

function unwrapApiResponse(result, path) {
  if (!result?.ok || !result.json) {
    throw new CliError(
      'REQUEST_FAILED',
      `Douyin creator account API ${path} failed with status ${Number(result?.status || 0)}`,
    );
  }
  if (Number(result.json.status_code ?? 0) !== 0) {
    throw new CliError(
      'REQUEST_FAILED',
      `Douyin creator account API ${path} returned status_code=${Number(result.json.status_code)}`,
    );
  }
  return result.json;
}

export function normalizeDouyinCreatorAccountPayload(payload = {}) {
  const creatorInfo = payload.creatorInfo || {};
  const pcInfo = payload.pcInfo || {};
  const mediaInfo = payload.mediaInfo || {};
  const userProfile = creatorInfo.user_profile || {};
  const verifyInfo = creatorInfo.douyin_user_verify_info || {};
  const mediaUser = mediaInfo.user || {};

  const secUid = pickFirst(mediaUser.sec_uid, userProfile.secret_id);
  const uid = pickFirst(mediaUser.uid, pcInfo.uid);
  const accountHandle = pickFirst(
    mediaUser.unique_id,
    userProfile.unique_id,
    verifyInfo.douyin_unique_id,
    mediaUser.short_id,
  );

  return {
    data_source: DOUYIN_SOURCE_CREATOR_CENTER,
    account_id: accountHandle,
    account_name: pickFirst(mediaUser.nickname, userProfile.nick_name, verifyInfo.nick_name),
    uid,
    sec_uid: secUid,
    account_photo: pickFirstUrl(
      mediaUser.avatar_thumb?.url_list,
      mediaUser.avatar_medium?.url_list,
      mediaUser.avatar_larger?.url_list,
      userProfile.avatar_url,
      verifyInfo.avatar_url,
    ),
    profile_url: buildProfileUrl(secUid),
    fans_count: firstNumber(mediaUser.follower_count, userProfile.follower_count, verifyInfo.follower_count),
    following_count: firstNumber(mediaUser.following_count, userProfile.following_count, verifyInfo.following_count),
    like_count: firstNumber(mediaUser.total_favorited, userProfile.total_favorited, verifyInfo.total_favorited),
    video_count: firstNumber(mediaUser.aweme_count),
    current_url: cleanText(payload.current_url),
    page_title: cleanText(payload.page_title),
  };
}

export async function fetchDouyinCreatorAccountRows(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || DOUYIN_CREATOR_HOME_URL);
  const waitSeconds = Math.max(1, Math.min(30, Number(kwargs.wait_seconds ?? 2)));

  if (typeof page?.goto === 'function') {
    await page.goto(targetUrl);
    if (typeof page.wait === 'function') {
      await page.wait(waitSeconds);
    }
  }
  if (typeof page?.evaluate !== 'function') {
    throw new Error('A browser page with evaluate is required for douyin creator account.');
  }

  const rawPayload = await page.evaluate(`
    (async () => {
      const fetchJson = async (url) => {
        try {
          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'X-Requested-With': 'XMLHttpRequest',
            },
          });
          const text = await response.text();
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (error) {
            return {
              ok: response.ok,
              status: response.status,
              error: error instanceof Error ? error.message : String(error),
              text,
            };
          }
          return {
            ok: response.ok,
            status: response.status,
            json,
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };

      const bodyText = document.body?.innerText || '';
      const href = location.href;
      const loginBlocked = /登录|扫码登录|请先登录/.test(bodyText) && /creator\\.douyin\\.com/.test(href);

      return {
        loginBlocked,
        current_url: href,
        page_title: document.title || '',
        creatorInfo: await fetchJson('/aweme/v1/creator/user/info/'),
        pcInfo: await fetchJson('/aweme/v1/creator/pc/user/info/'),
        mediaInfo: await fetchJson('/web/api/media/user/info/'),
      };
    })()
  `);

  if (rawPayload?.loginBlocked) {
    throw new AuthRequiredError('creator.douyin.com', 'Please log in to Douyin Creator Center in the browser first');
  }

  const payload = {
    current_url: rawPayload.current_url,
    page_title: rawPayload.page_title,
    creatorInfo: unwrapApiResponse(rawPayload.creatorInfo, '/aweme/v1/creator/user/info/'),
    pcInfo: unwrapApiResponse(rawPayload.pcInfo, '/aweme/v1/creator/pc/user/info/'),
    mediaInfo: unwrapApiResponse(rawPayload.mediaInfo, '/web/api/media/user/info/'),
  };

  return [normalizeDouyinCreatorAccountPayload(payload)];
}

if (cli && Strategy) {
  cli({
    site: 'douyin',
    name: 'skill-creator-account',
    description: douyinCreatorAccountSpec.description,
    access: 'read',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: DOUYIN_CREATOR_HOME_URL,
    browser: true,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: douyinCreatorAccountSpec.args,
    columns: douyinCreatorAccountSpec.columns,
    func: async (page, kwargs) => fetchDouyinCreatorAccountRows(page, kwargs),
  });
}
