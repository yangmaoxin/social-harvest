#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const includeArchiveDetails = process.argv.includes('--include-archive');
const ignoredDirs = new Set([
  '.agents',
  '.git',
  'delivery',
  'dist',
  'node_modules',
  'out',
  'workspace',
]);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) files.push(...walk(path.join(dir, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(dir, entry.name));
  }
  return files;
}

function stripLinkTarget(target) {
  return target
    .trim()
    .replace(/^<|>$/g, '')
    .split('#')[0];
}

function isExternalTarget(target) {
  return /^(https?:|mailto:)/i.test(target);
}

function resolveTarget(filePath, target) {
  const cleanTarget = stripLinkTarget(target);
  if (!cleanTarget || isExternalTarget(cleanTarget)) return null;
  const relativeFile = path.relative(rootDir, filePath);
  const baseDir = relativeFile.startsWith(`templates${path.sep}delivery-package${path.sep}`)
    ? rootDir
    : path.dirname(filePath);
  try {
    const decoded = decodeURI(cleanTarget);
    return path.isAbsolute(decoded)
      ? decoded
      : path.resolve(baseDir, decoded);
  } catch {
    return path.resolve(baseDir, cleanTarget);
  }
}

function existsWithOptionalLineSuffix(filePath) {
  if (fs.existsSync(filePath)) return true;
  const lineSuffixMatch = filePath.match(/^(.*):\d+$/);
  return Boolean(lineSuffixMatch && fs.existsSync(lineSuffixMatch[1]));
}

function scanMarkdownLinks() {
  const missing = [];
  const markdownFiles = walk(rootDir);
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;

  for (const filePath of markdownFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const match of text.matchAll(linkPattern)) {
      const resolved = resolveTarget(filePath, match[1]);
      if (!resolved || existsWithOptionalLineSuffix(resolved)) continue;
      missing.push({
        file: path.relative(rootDir, filePath),
        target: match[1],
        archived: path.relative(rootDir, filePath).startsWith(`docs${path.sep}archive${path.sep}`),
      });
    }
  }

  return { markdownFiles, missing };
}

const { markdownFiles, missing } = scanMarkdownLinks();
const activeMissing = missing.filter((item) => !item.archived);
const archiveMissing = missing.filter((item) => item.archived);

if (activeMissing.length || archiveMissing.length) {
  console.error(`Checked ${markdownFiles.length} Markdown files.`);
  if (activeMissing.length) {
    console.error(`Missing links in active docs: ${activeMissing.length}`);
    activeMissing.slice(0, 30).forEach((item) => {
      console.error(`- ${item.file} -> ${item.target}`);
    });
  }
  if (archiveMissing.length) {
    console.error(`Missing links in archived docs: ${archiveMissing.length} (warning only)`);
    if (includeArchiveDetails) {
      archiveMissing.slice(0, 30).forEach((item) => {
        console.error(`- ${item.file} -> ${item.target}`);
      });
    } else {
      console.error('Run `npm run docs:check-links -- --include-archive` to list archived links.');
    }
  }
}

if (activeMissing.length) {
  process.exitCode = 1;
} else {
  console.log(`Checked ${markdownFiles.length} Markdown files. Active docs links passed.`);
  if (archiveMissing.length) {
    console.log(`Archived docs still have ${archiveMissing.length} missing link(s); they are reported as warnings.`);
  }
}
