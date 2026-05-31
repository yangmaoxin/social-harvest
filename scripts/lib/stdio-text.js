const DEFAULT_ENCODING = 'utf-8';

function normalizeEncoding(value) {
  const text = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!text) return '';
  if (text === 'utf8') return 'utf-8';
  if (text === 'cp936' || text === 'gb2312' || text === 'gb18030') return 'gbk';
  return text;
}

function createTextDecoder(encoding) {
  try {
    return new TextDecoder(encoding, { fatal: false });
  } catch {
    return null;
  }
}

function replacementCount(text) {
  return (String(text || '').match(/\uFFFD/g) || []).length;
}

function shouldPreferGbk(utf8Text, gbkText, preferGbk) {
  if (!gbkText) return false;
  const utf8Bad = replacementCount(utf8Text);
  const gbkBad = replacementCount(gbkText);
  if (utf8Bad > gbkBad) return true;
  if (gbkBad > utf8Bad) return false;
  return Boolean(preferGbk) && utf8Bad > 0;
}

export function createChunkDecoder(options = {}) {
  const forcedEncoding = normalizeEncoding(
    options.encoding
      || process.env.HARVEST_OPS_STDIO_ENCODING
      || process.env.OPENCLI_STDIO_ENCODING,
  );
  const preferGbk = Boolean(options.preferGbk ?? process.platform === 'win32');
  const utf8 = createTextDecoder(DEFAULT_ENCODING);
  const gbk = (forcedEncoding === 'gbk' || preferGbk) ? createTextDecoder('gbk') : null;
  const forced = forcedEncoding === 'gbk' && gbk ? gbk : utf8;

  return {
    decode(chunk) {
      if (!chunk || chunk.length === 0) return '';
      if (forcedEncoding && forced) {
        return forced.decode(chunk, { stream: true });
      }

      const utf8Text = utf8.decode(chunk, { stream: true });
      if (!gbk) return utf8Text;

      const gbkText = gbk.decode(chunk, { stream: true });
      return shouldPreferGbk(utf8Text, gbkText, preferGbk) ? gbkText : utf8Text;
    },
    flush() {
      if (forcedEncoding && forced) return forced.decode();

      const utf8Text = utf8.decode();
      if (!gbk) return utf8Text;

      const gbkText = gbk.decode();
      return shouldPreferGbk(utf8Text, gbkText, preferGbk) ? gbkText : utf8Text;
    },
  };
}

export function withUtf8FriendlyEnv(env = process.env) {
  return {
    ...env,
    LANG: env.LANG || 'C.UTF-8',
    LC_ALL: env.LC_ALL || 'C.UTF-8',
    PYTHONIOENCODING: env.PYTHONIOENCODING || 'utf-8',
    PYTHONUTF8: env.PYTHONUTF8 || '1',
    npm_config_unicode: env.npm_config_unicode || 'true',
  };
}
