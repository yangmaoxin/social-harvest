const DEFAULT_IMAGE_USER_AGENT = 'Social Harvest/1.0';

function hostnameForUrl(url = '') {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function refererForImageUrl(url = '') {
  const hostname = hostnameForUrl(url);
  if (hostname === 'sinaimg.cn' || hostname.endsWith('.sinaimg.cn')) {
    return 'https://weibo.com/';
  }
  return '';
}

export function imageRequestHeaders(url = '', {
  userAgent = DEFAULT_IMAGE_USER_AGENT,
} = {}) {
  const headers = {
    'User-Agent': userAgent || DEFAULT_IMAGE_USER_AGENT,
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };
  const referer = refererForImageUrl(url);
  if (referer) headers.Referer = referer;
  return headers;
}
