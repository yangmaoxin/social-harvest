const SINK_VALUE_FLAGS = new Set([
  '--sink',
  '--app-id',
  '--app-secret',
  '--app-token',
  '--api-base-url',
  '--account-id',
  '--account-profile',
  '--base-name',
  '--config',
  '--database',
  '--folder-token',
  '--host',
  '--password',
  '--table-prefix',
  '--user',
  '--work-index',
]);

const SINK_BOOLEAN_FLAGS = new Set([
  '--sink-apply',
  '--create-base',
  '--display-tables',
  '--refresh-display-images',
  '--skip-display-images',
  '--skip-intention',
]);

function splitCommaValues(value = '') {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeSinkList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.flatMap(splitCommaValues))];
}

export function parseSinkOptions(args = []) {
  const argList = Array.isArray(args) ? args.map(String) : [];
  const sinks = [];
  const sinkArgs = [];
  const taskArgs = [];
  let sinkApply = false;
  let explicitSinks = false;

  for (let index = 0; index < argList.length; index += 1) {
    const arg = argList[index];
    if (arg === '--sink') {
      const value = argList[++index] || '';
      explicitSinks = true;
      sinks.push(...splitCommaValues(value));
      continue;
    }
    if (arg === '--sink-apply') {
      sinkApply = true;
      continue;
    }
    if (SINK_VALUE_FLAGS.has(arg)) {
      sinkArgs.push(arg);
      if (index + 1 < argList.length) sinkArgs.push(argList[++index]);
      continue;
    }
    if (SINK_BOOLEAN_FLAGS.has(arg)) {
      sinkArgs.push(arg);
      continue;
    }
    taskArgs.push(arg);
  }

  return {
    sinks: normalizeSinkList(sinks),
    explicitSinks,
    sinkApply,
    sinkArgs,
    taskArgs,
  };
}

export function resolveSinkOptions(options = {}, {
  defaultSinks = ['scrm'],
} = {}) {
  let sinks = options.explicitSinks
    ? normalizeSinkList(options.sinks || [])
    : normalizeSinkList(defaultSinks);
  if (!sinks.length && !options.explicitSinks) sinks = ['scrm'];
  return {
    ...options,
    sinks,
  };
}

export function shouldRunScrmSink(options = {}) {
  return Array.isArray(options.sinks) && options.sinks.includes('scrm');
}

export function shouldRunFeishuSink(options = {}) {
  return Array.isArray(options.sinks) && options.sinks.includes('feishu');
}
