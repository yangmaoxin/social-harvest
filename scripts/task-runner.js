#!/usr/bin/env node
import path from 'node:path';

import {
  listGlobalTasks,
  listPlatforms,
} from './lib/platform-registry.js';
import { runPlatformTask, runTaskPlan } from '../runner/executor.js';
import { normalizeDisplayMode } from '../runner/events.js';

export {
  buildTaskReport,
  buildTaskState,
} from '../runner/reports.js';

export {
  summarizePlatformOutput,
  summarizeTaskOutput,
} from '../runner/platform-output.js';

export {
  loadFailedTaskPlan,
  loadTaskPlan,
  planScopedTaskArgs,
} from '../runner/plans.js';

export {
  createEventWriter,
  childEventFromLine,
  emitTaskEvent,
  formatDetailedTaskEventBlock,
  formatTaskEventLine,
  createStructuredOutputWriter,
  isRawJsonLikeLine,
  isStructuredEventLine,
  normalizeDisplayMode,
  taskEventFromLine,
} from '../runner/events.js';

export {
  applyImplicitScrmApplyForSink,
  runPlatformTask,
  runTaskPlan,
} from '../runner/executor.js';

export {
  parseSinkOptions,
  resolveSinkOptions,
  shouldRunFeishuSink,
  shouldRunScrmSink,
} from '../runner/sink-options.js';

export {
  filterArgsForCompositeStep,
} from '../runner/arg-forwarding.js';

export {
  DEFAULT_BATCH_SIZE,
  checkpointCursor,
  checkpointPathFor,
  createCheckpoint,
  loadCheckpoint,
  markCheckpointItem,
  normalizeLongTaskOptions,
  parseLongTaskArgs,
  parseLongTaskFlag,
  resetCheckpoint,
  saveCheckpoint,
  setCheckpointCursor,
  setCheckpointCursors,
  updateCheckpoint,
} from '../runner/checkpoint.js';

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== false && item !== ''));
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command: command || '',
    platform: '',
    task: '',
    plan: '',
    failedFrom: '',
    outputDir: '',
    passThrough: [],
    display: 'compact',
    json: false,
    skipDoctor: false,
    help: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--') {
      options.passThrough.push(...rest.slice(i + 1));
      break;
    }
    if (arg === '--platform') options.platform = rest[++i];
    else if (arg === '--task') options.task = rest[++i];
    else if (arg === '--plan' || arg === '--config') options.plan = path.resolve(rest[++i]);
    else if (arg === '--failed-from') options.failedFrom = path.resolve(rest[++i]);
    else if (arg === '--output-dir') options.outputDir = path.resolve(rest[++i]);
    else if (arg === '--display') options.display = normalizeDisplayMode(rest[++i]);
    else if (arg === '--json') options.json = true;
    else if (arg === '--skip-diagnostic') options.skipDoctor = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.passThrough.push(arg);
  }
  return options;
}

export function printHelp() {
  console.log(`Usage:
  node scripts/task-runner.js list [--json]
  node scripts/task-runner.js run --platform <platform> [--task TASK] [--display compact|detailed|jsonl|silent] [--output-dir DIR] -- [task options]
  node scripts/task-runner.js run --task diagnostic [--display compact|detailed|jsonl|silent] [--output-dir DIR] -- [diagnostic options]
  node scripts/task-runner.js plan --config <task-plan.json> [--display compact|detailed|jsonl|silent] [--output-dir DIR] [--skip-diagnostic]
  node scripts/task-runner.js plan --failed-from <task-report.json> [--display compact|detailed|jsonl|silent] [--output-dir DIR]

Examples:
  node scripts/task-runner.js run --platform weixin-channels -- --date 2026-04-25
  node scripts/task-runner.js run --platform douyin -- --date 2026-04-25
  node scripts/task-runner.js run --platform douyin --task creator-content -- --work-limit 50
  node scripts/task-runner.js run --platform douyin --task creator-messages -- --message-limit 50
  node scripts/task-runner.js run --platform douyin -- --sink feishu --sink-apply
  node scripts/task-runner.js run --platform douyin -- --sink scrm --sink feishu --sink-apply
  node scripts/task-runner.js run --task diagnostic -- --check-platforms
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command || options.help) {
    printHelp();
    return;
  }

  if (options.command === 'list') {
    const platforms = listPlatforms().map((platform) => ({
      id: platform.id,
      label: platform.label,
      default_task: platform.defaultTask,
      supports_accounts: platform.supportsAccounts,
      supports_private_messages: platform.supportsPrivateMessages,
      supports_import: platform.supportsImport,
      supports_schedule: platform.supportsSchedule,
      tasks: Object.values(platform.tasks || {}).map((task) => compactObject({
        id: task.id,
        label: task.label,
        capability: task.capability,
        legacy: task.legacy,
        alias_of: task.aliasOf,
        export_and_import_coupled: task.exportAndImportCoupled,
        content_and_danmaku_coupled: task.contentAndDanmakuCoupled,
        user_facing: task.userFacing,
        steps: Array.isArray(task.steps) ? task.steps.map((step) => step.task) : undefined,
      })),
    }));
    const globalTasks = listGlobalTasks().map((task) => compactObject({
      id: task.id,
      label: task.label,
      capability: task.capability,
      legacy: task.legacy,
      alias_of: task.aliasOf,
    }));
    if (options.json) console.log(JSON.stringify({ platforms, global_tasks: globalTasks }, null, 2));
    else {
      platforms.forEach((platform) => console.log(`${platform.id}\t${platform.label}\t${platform.tasks.map((task) => task.id).join(',')}`));
      globalTasks.forEach((task) => console.log(`global:${task.id}\t${task.label}`));
    }
    return;
  }

  if (options.command === 'run') {
    if (!options.platform && !options.task) throw new Error('--platform or --task is required for run.');
    const result = await runPlatformTask(options.platform, options.passThrough, {
      outputDir: options.outputDir || '',
      task: options.task || '',
      display: options.display,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (options.command === 'plan') {
    if (!options.plan && !options.failedFrom) throw new Error('--config/--plan or --failed-from is required for plan.');
    const result = await runTaskPlan(options.plan, {
      outputDir: options.outputDir || '',
      skipDoctor: options.skipDoctor,
      display: options.display,
      failedFrom: options.failedFrom,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${options.command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
