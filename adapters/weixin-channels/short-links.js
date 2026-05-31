import fs from 'node:fs';
import path from 'node:path';

import { cli, Strategy } from '@jackwener/opencli/registry';

import { fetchObjectShortLinks } from './shared.js';

function readInputRows(inputPath) {
  const resolved = path.resolve(String(inputPath || ''));
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${resolved} did not contain a JSON array.`);
  return data;
}

cli({
  site: 'weixin-channels',
  name: 'short-links',
  description: '按 object_id 和 object_nonce 批量生成微信视频号短链接',
  access: 'read',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  timeoutSeconds: 600,
  defaultFormat: 'json',
  args: [
    { name: 'input', type: 'string', required: true, help: 'JSON array file with object_id and object_nonce fields' },
    { name: 'limit', type: 'int', default: 0, help: 'Maximum rows to process; 0 means all rows' },
  ],
  columns: [
    'rank',
    'object_id',
    'object_nonce',
    'scene',
    'share_url',
    'status',
    'error',
  ],
  func: async (page, kwargs) => {
    const rows = readInputRows(kwargs.input);
    const limit = Number(kwargs.limit || 0);
    const selected = limit > 0 ? rows.slice(0, limit) : rows;
    return fetchObjectShortLinks(page, selected);
  },
});
