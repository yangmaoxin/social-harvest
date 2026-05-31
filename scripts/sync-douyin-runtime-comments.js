#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT_DIR, 'adapters', 'douyin');
export const DEFAULT_OPENCLI_DIR = path.join(os.homedir(), '.opencli');
export const DOUYIN_RUNTIME_ADAPTER_FILES = ['shared.js', 'resolve-user.js', 'skill-videos.js', 'comments.js', 'comment-id-bridge-probe.js', 'comment-name-dom-probe.js', 'creator-inspect.js', 'creator-api-summary.js', 'creator-danmaku.js', 'creator-danmaku-probe.js', 'creator-works.js', 'creator-comments.js', 'creator-harvest.js', 'harvest.js', 'messages.js', 'messages-api-flat.js', 'messages-api-scan-probe.js', 'messages-probe.js', 'messages-api-probe.js', 'messages-conversation-api-probe.js', 'messages-dom-detail-probe.js', 'messages-thread-list-probe.js', 'messages-thread-structure-probe.js', 'messages-dom-api-match-probe.js', 'messages-direction-scan-probe.js', 'messages-field-probe.js', 'messages-record-probe.js', 'messages-payload-probe.js', 'messages-protobuf-branch-probe.js', 'messages-field9-probe.js', 'messages-field9-classify-probe.js', 'messages-value-shape-probe.js'];

function parseArgs(argv) {
  const options = {
    opencliDir: DEFAULT_OPENCLI_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--opencli-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--opencli-dir requires a directory path.');
      options.opencliDir = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/sync-douyin-runtime-comments.js

Options:
  --opencli-dir DIR  OpenCLI user dir, default ~/.opencli
`);
}

export function copyRuntimeDouyinAdapter(options = {}) {
  const opencliDir = path.resolve(options.opencliDir || DEFAULT_OPENCLI_DIR);
  if (options.requireExistingRoot && (!fs.existsSync(opencliDir) || !fs.statSync(opencliDir).isDirectory())) {
    return null;
  }
  const destDir = path.join(opencliDir, 'clis', 'douyin');
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of DOUYIN_RUNTIME_ADAPTER_FILES) {
    const source = path.join(SOURCE_DIR, file);
    const dest = path.join(destDir, file);
    fs.copyFileSync(source, dest);
  }

  return {
    site: 'douyin',
    commands: ['skill-resolve-user', 'skill-videos', 'skill-comments', 'skill-comment-id-bridge-probe', 'skill-comment-name-dom-probe', 'skill-creator-inspect', 'skill-creator-api-summary', 'skill-creator-danmaku', 'skill-creator-danmaku-probe', 'skill-creator-works', 'skill-creator-comments', 'skill-creator-harvest', 'skill-harvest', 'skill-messages-flat', 'skill-messages-api-flat', 'skill-messages-api-scan-probe', 'skill-messages-probe', 'skill-messages-api-probe', 'skill-messages-conversation-api-probe', 'skill-messages-dom-detail-probe', 'skill-messages-thread-list-probe', 'skill-messages-thread-structure-probe', 'skill-messages-dom-api-match-probe', 'skill-messages-direction-scan-probe', 'skill-messages-field-probe', 'skill-messages-record-probe', 'skill-messages-payload-probe', 'skill-messages-protobuf-branch-probe', 'skill-messages-field9-probe', 'skill-messages-field9-classify-probe', 'skill-messages-value-shape-probe'],
    directory: destDir,
    files: DOUYIN_RUNTIME_ADAPTER_FILES.map((file) => path.join(destDir, file)),
  };
}

export const copyRuntimeCommentsAdapter = copyRuntimeDouyinAdapter;

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exit(0);
    }

    const result = copyRuntimeDouyinAdapter(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
