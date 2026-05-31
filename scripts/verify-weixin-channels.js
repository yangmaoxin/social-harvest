#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncAdapter } from './sync-adapter.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
}

export function verifyWeixinChannels(opencliDir = path.join(ROOT_DIR, 'workspace', 'OpenCLI')) {
  const resolvedOpencliDir = path.resolve(opencliDir);

  console.log('[1/5] Running local adapter tests');
  run('npm', ['test', '--', '--run', 'adapters/weixin-channels']);

  console.log('[2/5] Syncing adapter into OpenCLI');
  syncAdapter('weixin-channels', resolvedOpencliDir);

  if (!fs.existsSync(resolvedOpencliDir) || !fs.statSync(resolvedOpencliDir).isDirectory()) {
    throw new Error(`OpenCLI workspace not found: ${resolvedOpencliDir}`);
  }

  if (!fs.existsSync(path.join(resolvedOpencliDir, 'node_modules'))) {
    console.log('[3/5] Installing OpenCLI dependencies');
    run('npm', ['install'], { cwd: resolvedOpencliDir });
  } else {
    console.log('[3/5] OpenCLI dependencies already installed');
  }

  console.log('[4/5] Building OpenCLI');
  run('npm', ['run', 'build'], { cwd: resolvedOpencliDir });

  console.log('[5/5] Running synced adapter tests inside OpenCLI');
  run('npx', ['vitest', 'run', 'clis/weixin-channels/*.test.js'], {
    cwd: resolvedOpencliDir,
    env: {
      ...process.env,
      OPENCLI_SKILL_ROOT: ROOT_DIR,
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const [, , opencliDir] = process.argv;
    verifyWeixinChannels(opencliDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
