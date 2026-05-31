#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , opencliMain, ...opencliArgs] = process.argv;

if (!opencliMain) {
  console.error('Usage: node scripts/run-opencli.js <opencli-main> [...args]');
  process.exitCode = 1;
} else {
  const resolvedMain = path.resolve(opencliMain);
  process.argv = [process.argv[0], resolvedMain, ...opencliArgs];
  await import(pathToFileURL(resolvedMain).href);
}
