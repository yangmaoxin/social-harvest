#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { scanOpenCliAdapterDirectory } from './lib/opencli-adapter-metadata.js';

const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const ADAPTERS_DIR = path.join(ROOT_DIR, 'adapters');

const report = scanOpenCliAdapterDirectory(ADAPTERS_DIR, { baseDir: ROOT_DIR });

if (report.issues.length === 0) {
  console.log(`OpenCLI adapter metadata: passed (${report.commandFiles} command files checked)`);
} else {
  console.error(`OpenCLI adapter metadata: failed (${report.issues.length} issue(s))`);
  for (const issue of report.issues) {
    console.error(`- ${issue.file}: ${issue.message}`);
  }
  process.exitCode = 1;
}
