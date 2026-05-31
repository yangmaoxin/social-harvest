import { cli, Strategy } from '@jackwener/opencli/registry';

import {
  FINDER_ORIGIN,
  fetchFinderApi,
  fetchFinderInteractionApi,
  gotoFinderPage,
} from './shared.js';

export const PLATFORM_HOME_URL = 'https://channels.weixin.qq.com/platform';

export const weixinChannelsAccountProfileSpec = {
  site: 'weixin-channels',
  name: 'account-profile',
  description: '通过视频号助手接口抓取当前登录账号的基础信息',
  args: [
    { name: 'url', type: 'string', default: PLATFORM_HOME_URL, help: 'Weixin Channels assistant home URL' },
    { name: 'wait_seconds', type: 'int', default: 2, help: 'Seconds to wait after page load' },
  ],
  columns: [
    'data_source',
    'account_id',
    'account_name',
    'account_photo',
    'profile_url',
    'fans_count',
    'video_count',
    'finder_username',
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

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function normalizeWeixinChannelsAccountPayload(payload = {}) {
  const authData = payload.authData || {};
  const finderUser = authData.finderUser || {};
  const finderUsername = pickFirst(
    finderUser.finderUsername,
    payload.finderUsername,
  );
  const accountHandle = pickFirst(finderUser.uniqId);

  return {
    data_source: 'weixin_channels_assistant',
    account_id: accountHandle,
    account_name: pickFirst(finderUser.nickname, authData.userAttr?.nickname),
    account_photo: pickFirst(finderUser.headImgUrl, authData.userAttr?.encryptedHeadImage),
    profile_url: pickFirst(payload.current_url, PLATFORM_HOME_URL, FINDER_ORIGIN),
    fans_count: firstNumber(finderUser.fansCount),
    video_count: firstNumber(finderUser.feedsCount),
    finder_username: finderUsername,
    current_url: pickFirst(payload.current_url, PLATFORM_HOME_URL),
    page_title: pickFirst(payload.page_title, '视频号助手'),
  };
}

export async function fetchWeixinChannelsAccountProfileRows(page, kwargs = {}) {
  const targetUrl = String(kwargs.url || PLATFORM_HOME_URL);
  await gotoFinderPage(page, targetUrl);
  if (typeof page?.wait === 'function') {
    await page.wait({ time: Math.max(1, Number(kwargs.wait_seconds ?? 2)) });
  }

  const authData = await fetchFinderApi(page, '/auth/auth_data', {}, {
    stage: 'account-profile-auth-data',
  });
  const selfInfo = await fetchFinderInteractionApi(page, '/private-msg/get-finder-username', {}, {
    stage: 'account-profile-finder-username',
  }).catch(() => ({}));
  const pageState = typeof page?.evaluate === 'function'
    ? await page.evaluate(() => ({
      current_url: String(globalThis.location?.href || ''),
      page_title: String(document?.title || ''),
    }))
    : { current_url: '', page_title: '' };
  const resolvedPageState = pageState && typeof pageState === 'object'
    ? pageState
    : { current_url: '', page_title: '' };

  return [normalizeWeixinChannelsAccountPayload({
    authData,
    finderUsername: pickFirst(
      selfInfo?.finderUsername,
      selfInfo?.username,
      selfInfo?.finder_username,
      selfInfo?.finderUserName,
    ),
    current_url: pickFirst(resolvedPageState.current_url, targetUrl),
    page_title: pickFirst(resolvedPageState.page_title, '视频号助手'),
  })];
}

cli({
  site: 'weixin-channels',
  name: 'account-profile',
  description: weixinChannelsAccountProfileSpec.description,
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  defaultFormat: 'json',
  timeoutSeconds: 120,
  args: weixinChannelsAccountProfileSpec.args,
  columns: weixinChannelsAccountProfileSpec.columns,
  func: async (page, kwargs) => fetchWeixinChannelsAccountProfileRows(page, kwargs),
});
