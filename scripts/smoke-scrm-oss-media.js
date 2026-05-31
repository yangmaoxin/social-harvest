#!/usr/bin/env node
import {
  scrmMediaConfigFromSettings,
  setConfigPath,
} from './lib/runtime-config.js';
import {
  createOssClient,
  publicUrlForOssKey,
  renderOssKey,
  validateOssMediaConfig,
} from './lib/scrm-media.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

export function parseArgs(argv) {
  const options = {
    config: '',
    keep: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') options.config = argv[++index];
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/smoke-scrm-oss-media.js [options]

Options:
  --config PATH  Config file, default config.local.json.
  --keep         Keep the uploaded smoke image instead of deleting it.
`);
}

export async function run(options = {}) {
  if (options.config) setConfigPath(options.config);
  const mediaConfig = scrmMediaConfigFromSettings();
  validateOssMediaConfig(mediaConfig);
  const client = createOssClient(mediaConfig);
  const key = renderOssKey({
    mediaConfig,
    platform: '_smoke',
    accountId: '_smoke',
    entityType: 'config',
    entityId: `smoke-${Date.now()}`,
    imageType: 'pixel',
    ext: 'png',
  });
  const publicUrl = publicUrlForOssKey(mediaConfig, key);

  const report = {
    status: 'ok',
    bucket: mediaConfig.bucket,
    region: mediaConfig.region,
    key,
    public_url: publicUrl,
    kept: Boolean(options.keep),
    deleted: false,
  };

  try {
    await client.put(key, ONE_PIXEL_PNG, {
      headers: { 'Content-Type': 'image/png' },
    });
    await client.head(key);
    if (!options.keep) {
      await client.delete(key);
      report.deleted = true;
    }
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(report.error), { report });
  } finally {
    console.log(JSON.stringify(report, null, 2));
    console.log(`SCRM_OSS_MEDIA_SMOKE ${JSON.stringify(report)}`);
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    run(options).catch((error) => {
      if (!error?.report) console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
