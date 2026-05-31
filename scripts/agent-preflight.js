#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { scanOpenCliAdapterDirectory } from './lib/opencli-adapter-metadata.js';

const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageLockPath = path.join(rootDir, 'package-lock.json');

const args = new Set(process.argv.slice(2));
const outputJson = args.has('--json');

function parseVersion(version) {
  const match = String(version).match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function satisfiesCurrentNode(engine) {
  const current = parseVersion(process.version);
  if (!current) {
    return { ok: false, detail: `Unable to parse current Node version: ${process.version}` };
  }

  if (engine === '>=24 <25') {
    return {
      ok: current.major >= 24 && current.major < 25,
      detail: `Current Node is ${process.version}; expected ${engine}`,
    };
  }

  return {
    ok: true,
    detail: `Current Node is ${process.version}; engine expression ${engine} was not evaluated strictly`,
  };
}

function run(command, commandArgs = []) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function commandExists(command) {
  if (process.platform === 'win32') {
    const result = run('where', [command]);
    return result.status === 0;
  }
  const result = run('command', ['-v', command]);
  if (result.status === 0) return true;
  return run('which', [command]).status === 0;
}

function checkNodeVersion() {
  const engine = packageJson.engines?.node || '';
  const result = satisfiesCurrentNode(engine);
  return {
    id: 'node-version',
    status: result.ok ? 'passed' : 'failed',
    message: result.detail,
    next_actions: result.ok ? [] : [
      'Run `nvm use 24` or install a Node version that satisfies package.json engines.node.',
      'Re-run `npm run check` before tests, builds, or task execution.',
    ],
  };
}

function checkNvm() {
  const nvmScript = path.join(os.homedir(), '.nvm', 'nvm.sh');
  const hasNvm = Boolean(process.env.NVM_DIR) || fs.existsSync(nvmScript) || commandExists('nvm');
  return {
    id: 'nvm',
    status: hasNvm ? 'passed' : 'warning',
    message: hasNvm
      ? 'nvm appears to be available for switching Node versions.'
      : 'nvm was not detected; Node version switching may require manual setup.',
    next_actions: hasNvm ? [] : ['Install nvm or use another Node version manager before running project commands.'],
  };
}

function checkOpenCli() {
  const globalOpenCli = commandExists('opencli');
  const installedPackagePath = path.join(rootDir, 'node_modules', '@jackwener', 'opencli', 'package.json');
  const installedOpenCli = readJsonIfExists(installedPackagePath);
  const lockfile = readJsonIfExists(packageLockPath);
  const lockedVersion = lockfile?.packages?.['node_modules/@jackwener/opencli']?.version || '';
  const declaredRange = packageJson.dependencies?.['@jackwener/opencli'] || '';

  if (installedOpenCli) {
    const installedVersion = installedOpenCli.version || 'unknown';
    const versionMessage = [
      `@jackwener/opencli ${installedVersion} is installed in project node_modules`,
      lockedVersion ? `lockfile expects ${lockedVersion}` : '',
      declaredRange ? `package.json declares ${declaredRange}` : '',
    ].filter(Boolean).join('; ');
    const matchesLockfile = !lockedVersion || installedVersion === lockedVersion;

    return {
      id: 'opencli',
      status: matchesLockfile ? 'passed' : 'warning',
      message: `${versionMessage}. A global opencli install is not required for Social Harvest npm scripts.`,
      next_actions: matchesLockfile
        ? (globalOpenCli ? [] : ['Use Social Harvest npm scripts. Do not install or upgrade global opencli just because opencli is not on PATH.'])
        : ['Run `npm install --omit=dev` with Node 24 so node_modules matches package-lock.json.'],
    };
  }

  if (globalOpenCli) {
    const version = run('opencli', ['--version']);
    return {
      id: 'opencli',
      status: 'warning',
      message: `global opencli is available${version.stdout ? `: ${version.stdout}` : ''}, but project @jackwener/opencli is missing from node_modules.`,
      next_actions: ['Run `npm install --omit=dev` with Node 24 so Social Harvest uses its project-pinned OpenCLI dependency.'],
    };
  }

  return {
    id: 'opencli',
    status: 'failed',
    message: '@jackwener/opencli is not installed in project node_modules.',
    next_actions: ['Run `npm install --omit=dev` with Node 24, then re-run preflight.'],
  };
}

function checkConfig() {
  const localConfig = path.join(rootDir, 'config.local.json');
  const exampleConfig = path.join(rootDir, 'config.example.json');
  if (fs.existsSync(localConfig)) {
    return {
      id: 'config',
      status: 'passed',
      message: 'config.local.json exists.',
      next_actions: [],
    };
  }
  return {
    id: 'config',
    status: 'warning',
    message: fs.existsSync(exampleConfig)
      ? 'config.local.json is missing; config.example.json is available as a template.'
      : 'config.local.json and config.example.json are both missing.',
    next_actions: ['Create config.local.json before real platform runs or SCRM imports.'],
  };
}

function checkChrome() {
  if (process.platform === 'darwin') {
    const chromeApp = '/Applications/Google Chrome.app';
    return {
      id: 'chrome',
      status: fs.existsSync(chromeApp) ? 'passed' : 'warning',
      message: fs.existsSync(chromeApp)
        ? 'Google Chrome app exists in /Applications.'
        : 'Google Chrome app was not found in /Applications.',
      next_actions: fs.existsSync(chromeApp) ? [] : ['Install Chrome or update platform runbooks with the actual browser path.'],
    };
  }

  return {
    id: 'chrome',
    status: 'warning',
    message: 'Chrome presence is not checked on this platform yet.',
    next_actions: ['Run the project diagnostic task before real platform collection.'],
  };
}

function checkMisplacedArtifacts() {
  const misplacedFiles = [
    path.join(rootDir, 'samples', 'douyin', 'creator-harvest.json'),
    path.join(rootDir, 'samples', 'douyin', 'creator-harvest-report.json'),
    path.join(rootDir, 'samples', 'douyin', 'account-profile.json'),
    path.join(rootDir, 'samples', 'douyin', 'account-profile-report.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'harvest.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'run-report.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'account-profile.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'account-profile-report.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'danmaku-flat.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'danmaku-report.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'private-messages-flat.json'),
    path.join(rootDir, 'samples', 'weixin-channels', 'private-messages-report.json'),
  ].filter((filePath) => fs.existsSync(filePath));

  return {
    id: 'sample-artifacts',
    status: misplacedFiles.length ? 'warning' : 'passed',
    message: misplacedFiles.length
      ? `Found ${misplacedFiles.length} platform artifact(s) directly under samples/<platform>; expected samples/<platform>/<YYYY-MM-DD>/...`
      : 'No misplaced platform artifacts were found under samples/<platform>.',
    next_actions: misplacedFiles.length ? [
      'Do not import these root-level files directly.',
      'Re-run collection through npm scripts so outputs land under samples/<platform>/<YYYY-MM-DD>/, or move the files into the correct dated folder after confirming their collection date.',
    ] : [],
  };
}

function checkUserOpenCliAdapters() {
  const userCliDir = path.join(os.homedir(), '.opencli', 'clis');
  if (!fs.existsSync(userCliDir)) {
    return {
      id: 'user-opencli-adapters',
      status: 'passed',
      message: 'No user-level OpenCLI adapter directory was found.',
      next_actions: [],
    };
  }

  const report = scanOpenCliAdapterDirectory(userCliDir, { baseDir: userCliDir });
  if (report.issues.length === 0) {
    return {
      id: 'user-opencli-adapters',
      status: 'passed',
      message: `User-level OpenCLI adapters look compatible (${report.commandFiles} command file(s) checked).`,
      next_actions: [],
    };
  }

  const examples = report.issues
    .slice(0, 5)
    .map((issue) => `${issue.file}: ${issue.message}`)
    .join('; ');

  return {
    id: 'user-opencli-adapters',
    status: 'warning',
    message: `Found ${report.issues.length} likely incompatible user-level OpenCLI adapter metadata issue(s) under ${userCliDir}. Examples: ${examples}`,
    next_actions: [
      'These user-level adapters can cause `Command <site>/<command> must declare access` or positional help errors in newer OpenCLI.',
      'Temporarily move stale files out of the user-level OpenCLI adapter directory shown above, or update them to declare `access: \'read\' | \'write\'` and non-empty `help` for positional args.',
      'Do not fix this by globally reinstalling opencli unless the project-pinned OpenCLI dependency is missing.',
    ],
  };
}

function summarize(checks) {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'passed';
}

const checks = [
  checkNodeVersion(),
  checkNvm(),
  checkOpenCli(),
  checkConfig(),
  checkChrome(),
  checkMisplacedArtifacts(),
  checkUserOpenCliAdapters(),
];

const report = {
  project: packageJson.name,
  display_name: 'Social Harvest',
  cwd: rootDir,
  status: summarize(checks),
  checks,
};

if (outputJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`Social Harvest agent preflight: ${report.status}`);
  for (const check of checks) {
    console.log(`- [${check.status}] ${check.id}: ${check.message}`);
    for (const action of check.next_actions) {
      console.log(`  next: ${action}`);
    }
  }
}

if (report.status === 'failed') {
  process.exitCode = 1;
}
