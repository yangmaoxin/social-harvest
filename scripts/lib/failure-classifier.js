const FAILURE_DEFINITIONS = [
  {
    category: 'report_damaged',
    title: '任务报告损坏',
    description: '任务报告文件存在，但桌面端无法读取其中的 JSON 内容。',
    patterns: [/task-report\.json.*(无法读取|损坏|invalid|parse|json)/i, /报告文件.*(损坏|无法读取)/i],
    nextActions: [
      '打开任务目录检查 task-report.json。',
      '查看 task-events.jsonl 确认任务最后停在哪一步。',
      '确认参数后从历史页重跑任务。',
    ],
  },
  {
    category: 'report_missing',
    title: '任务报告缺失',
    description: '任务进程已经退出，但没有生成最终 task-report.json。',
    patterns: [/task-report\.json.*(缺失|未生成|尚未生成|missing|not found)/i, /(未生成报告|尚未生成|没有生成最终报告|missing report)/i],
    nextActions: [
      '打开任务目录检查 task-events.jsonl 和 task-state.json。',
      '在配置页运行诊断，确认运行依赖可用。',
      '确认环境或参数后从历史页重跑任务。',
    ],
  },
  {
    category: 'chrome_unreachable',
    title: 'Chrome 未连接',
    description: '桌面端连接不到 Chrome 或远程调试端口。',
    patterns: [
      /chrome.*(未启动|不可用|无法连接|not reachable|not available|not running)/i,
      /(remote debugging|debugging port|9222).*?(failed|refused|unreachable|不可用|无法连接)/i,
      /(ECONNREFUSED|connect).*?(127\.0\.0\.1|localhost).*?(9222|chrome)/i,
      /(browser|target).*?(closed|disconnected)/i,
    ],
    nextActions: [
      '先打开 Chrome，并确认远程调试端口可用。',
      '在配置页运行诊断，确认 Chrome/OpenCLI 连接状态。',
      '平台页面保持登录后再重跑任务。',
    ],
  },
  {
    category: 'opencli_unavailable',
    title: 'OpenCLI 不可用',
    description: '平台适配器或平台插件当前不可用。',
    patterns: [
      /opencli.*(not found|missing|unavailable|workspace not found|不可用|未安装|未连接)/i,
      /(unknown command|Cannot find module|ERR_MODULE_NOT_FOUND).*opencli/i,
      /Detached while handling command/i,
      /(插件|plugin).*(未安装|未连接|不可用|not found|unavailable)/i,
    ],
    nextActions: [
      '在配置页运行诊断，确认 OpenCLI 和平台插件可用。',
      '确认本机 OpenCLI 依赖已安装，并且桌面端能访问。',
      '修复依赖后从历史页重跑任务。',
    ],
  },
  {
    category: 'account_missing',
    title: '账号标识不可用',
    description: '本次任务缺少可用的平台账号标识，或账号标识已经失效。',
    patterns: [
      /(账号|account).*(缺失|未配置|不存在|找不到|失效|过期|missing|not found|unknown|invalid|expired)/i,
      /(sec_uid|secUid|identifier).*(缺失|未配置|missing|required|invalid)/i,
      /(missing|required).*(account|sec_uid|identifier)/i,
    ],
    nextActions: [
      '打开配置页检查启用账号的 ID、sec_uid 或主页标识。',
      '保存配置后重新运行诊断。',
      '确认账号标识有效后从历史页重跑任务。',
    ],
  },
  {
    category: 'platform_not_logged_in',
    title: '平台未登录',
    description: '平台登录态不可用，平台页面或接口没有授权。',
    patterns: [
      /(未登录|登录态|重新登录|扫码登录|请登录|登录已过期|login required|not logged|session expired)/i,
      /(unauthorized|forbidden|401|403).*(login|登录|session|token|auth)/i,
      /(login|session|token|auth).*(expired|invalid|unauthorized|forbidden)/i,
    ],
    nextActions: [
      '在 Chrome 中打开对应平台后台并重新登录。',
      '确认页面可以正常访问后，回到桌面端运行诊断。',
      '登录态恢复后从历史页重跑任务。',
    ],
  },
  {
    category: 'platform_access_unavailable',
    title: '平台访问失败',
    description: '平台检查步骤访问页面或接口失败，但当前证据不足以直接判断为未登录。',
    patterns: [
      /platform:[\w-]+[\s\S]{0,2000}?(API_ERROR|request failed)/i,
      /node .*opencli.*[\w-]+\s+.*failed with code 1[\s\S]{0,1200}?code:\s*API_ERROR/i,
    ],
    nextActions: [
      '先在 Chrome 中打开对应平台页面，确认页面和接口请求可以正常返回。',
      '如果页面需要重新登录或刷新会话，处理后回到桌面端重新运行诊断。',
      '若仍失败，查看 task-report.json 中的平台接口错误，再决定是否重跑或上报样本。',
    ],
  },
  {
    category: 'database_unavailable',
    title: '数据库不可用',
    description: '数据库配置、连接或目标表结构阻断了本次入库。',
    patterns: [
      /(SCRM|database|mysql|db_|数据库).*(失败|不可用|缺失|连接|配置|failed|unavailable|missing|connect|denied)/i,
      /(ECONNREFUSED|Access denied|ER_[A-Z_]+|Unknown database|No database selected)/i,
      /(host|user|password|db_name).*(missing|required|缺失|未配置)/i,
    ],
    nextActions: [
      '打开配置页检查数据库 host、user、db_name 和密码。',
      '确认 MySQL 可连接，并且目标表和必要索引存在。',
      '如果只是验证数据更新，可先关闭正式入库后重跑。',
    ],
  },
  {
    category: 'ai_unavailable',
    title: 'AI 配置不可用',
    description: 'AI Key、接口地址或模型配置不可用。',
    patterns: [
      /(AI|ModelScope|OPENCLI_MODELSCOPE|MODELSCOPE|OpenAI|api key|API Key).*(失败|不可用|缺失|未配置|failed|unavailable|missing|invalid|unauthorized)/i,
      /(401|403).*(api key|modelscope|openai|ai)/i,
      /(model|base_url|baseURL).*(missing|required|invalid|缺失|未配置)/i,
    ],
    nextActions: [
      '打开配置页检查 AI Key、base URL 和模型。',
      '如果暂不需要意向分析，可先关闭 AI 分析后重跑。',
      '修复配置后重新运行诊断。',
    ],
  },
];

const UNKNOWN_FAILURE = {
  category: 'unknown',
  title: '未归类失败',
  description: '任务失败原因还没有匹配到已知类型。',
  nextActions: [
    '查看 task-report.json 的 error 字段。',
    '查看 task-events.jsonl 和平台输出目录中的报告文件。',
    '把错误样本补充到失败归类规则后再重跑验证。',
  ],
  recoverable: true,
};

export function classifyTaskFailure({ error = '', stderr = '', platformReport = null } = {}) {
  const text = collectFailureText([error, stderr, platformReport]);
  if (!text) return null;
  const matched = FAILURE_DEFINITIONS.find((definition) => definition.patterns.some((pattern) => pattern.test(text)));
  const source = matched || UNKNOWN_FAILURE;
  return {
    category: source.category,
    title: source.title,
    description: source.description,
    nextActions: [...source.nextActions],
    recoverable: source.recoverable !== false,
  };
}

function collectFailureText(values) {
  const chunks = [];
  for (const value of values) {
    collectValueText(value, chunks, 0);
  }
  return chunks
    .map((chunk) => String(chunk).trim())
    .filter(Boolean)
    .join('\n');
}

function collectValueText(value, chunks, depth) {
  if (value === null || value === undefined || depth > 4) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    chunks.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectValueText(item, chunks, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const child of Object.values(value)) {
    collectValueText(child, chunks, depth + 1);
  }
}
