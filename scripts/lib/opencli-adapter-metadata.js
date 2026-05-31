import fs from 'node:fs';
import path from 'node:path';

const CLI_MODULE_PATTERN = /\bcli\s*\(\s*\{/;
const ACCESS_PATTERN = /\baccess\s*:\s*['"](read|write)['"]/;
const POSITIONAL_PATTERN = /\bpositional\s*:\s*true\b/g;
const HELP_PATTERN = /\bhelp\s*:\s*(['"`])([\s\S]*?)\1/;

export function collectJavaScriptFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.js')) continue;
    if (entry.name.endsWith('.test.js')) continue;
    files.push(fullPath);
  }
  return files;
}

function findMatchingBrace(source, startIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function extractArgObject(source, index) {
  const start = source.lastIndexOf('{', index);
  if (start < 0) return '';
  const end = findMatchingBrace(source, start);
  if (end < 0) return '';
  return source.slice(start, end + 1);
}

function hasNonEmptyHelp(objectSource) {
  const match = objectSource.match(HELP_PATTERN);
  return Boolean(match && match[2].trim());
}

export function scanOpenCliAdapterSource(source) {
  const isCliModule = CLI_MODULE_PATTERN.test(source);
  if (!isCliModule) {
    return {
      isCliModule: false,
      missingAccess: false,
      positionalHelpIssues: [],
    };
  }

  const positionalHelpIssues = [];
  for (const match of source.matchAll(POSITIONAL_PATTERN)) {
    const objectSource = extractArgObject(source, match.index ?? 0);
    if (!objectSource || hasNonEmptyHelp(objectSource)) continue;

    const nameMatch = objectSource.match(/\bname\s*:\s*['"]([^'"]+)['"]/);
    positionalHelpIssues.push({
      name: nameMatch?.[1] || '(unknown)',
    });
  }

  return {
    isCliModule: true,
    missingAccess: !ACCESS_PATTERN.test(source),
    positionalHelpIssues,
  };
}

export function scanOpenCliAdapterDirectory(dir, options = {}) {
  const baseDir = options.baseDir || dir;
  const issues = [];
  let commandFiles = 0;

  for (const filePath of collectJavaScriptFiles(dir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const result = scanOpenCliAdapterSource(source);
    if (!result.isCliModule) continue;

    commandFiles += 1;
    const file = path.relative(baseDir, filePath) || path.basename(filePath);

    if (result.missingAccess) {
      issues.push({
        file,
        type: 'missing-access',
        message: 'missing access: read/write',
      });
    }

    for (const issue of result.positionalHelpIssues) {
      issues.push({
        file,
        type: 'missing-positional-help',
        arg: issue.name,
        message: `positional arg "${issue.name}" missing non-empty help`,
      });
    }
  }

  return {
    dir,
    commandFiles,
    issues,
  };
}
