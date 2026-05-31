import { setting, settingList } from './runtime-config.js';

export const DEFAULT_MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn/v1';
export const DEFAULT_MODELSCOPE_MODEL = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B';
export const DEFAULT_MODELSCOPE_MODELS = [
  'ZhipuAI/GLM-5',
  'Qwen/Qwen3.5-397B-A17B',
  'Qwen/Qwen3-235B-A22B-Instruct-2507',
  'Qwen/Qwen3-Next-80B-A3B-Instruct',
  'ZhipuAI/GLM-5.1',
  'Qwen/Qwen3.5-35B-A3B',
  'Qwen/Qwen3.5-27B',
  'Qwen/Qwen3-Coder-30B-A3B-Instruct',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
];

const DEFAULT_BATCH_SIZE = 20;
const INTENTION_NONE = 1;
const INTENTION_LOW = 2;
const INTENTION_MEDIUM = 3;
const INTENTION_HIGH = 4;
const VALID_INTENTIONS = new Set([INTENTION_NONE, INTENTION_LOW, INTENTION_MEDIUM, INTENTION_HIGH]);

export const CLASSIFICATION_RULES = `你是专业的脐带血 / 干细胞存储业务销售线索意向分析助手。
请根据客户评论、私信正文、回复链语境，判断用户当前所处的购买阶段，并输出对应意向等级。

意向等级：
1=无关 / 无需求
2=认知了解阶段
3=购买评估阶段
4=行动推进阶段

核心判断：
- 优先判断用户当前处于哪一种购买阶段，不要只按单个关键词机械匹配。
- 结合用户是否出现现实需求、是否开始购买决策、是否准备推进下一步、是否已经开始渠道/地区/办理咨询。
- 若同时出现多个信号，以最高意向等级为准。
- 模糊场景只有在出现孕期、孩子、价格、地区、医院、办理、私信、销售对接等现实购买线索时才上调；否则不要主动虚高。
- 普通用户在回复链里承接购买话题继续咨询，仍然正常判断意向，不能因为是回复别人就判 1。

优先排除为 1：
- 博主本人、客服、销售、官方账号的主动营销回复或自说自话。
- 与产品/服务/办理/购买/存储无关的内容。
- 夸视频、夸作者、夸剪辑、追星表达、剧情讨论、玩梗、路人互动，哪怕发生在私信里也判 1。
- 纯表情、纯数字、第一、加一、哈哈哈、太厉害了、绝绝子、会火的、真不错、好看、好玩。
- 围绕内容创作/素材/视频本身的表达，如想要视频、求原视频、再剪一个、怎么剪的、怎么做这个视频。
- 冲流量标签、艾特小助手、@DOU+、@抖音小助手、@上热门。
- 单纯吐槽、攻击、阴谋论、完全否定且没有咨询行为。
- 历史用户单纯回忆、吐槽服务、表达不续费或明确放弃，如“存了10年，现在不想续了”。

4=行动推进阶段，高意向：
- 用户已经进入明确推进、办理、成交或实际落地咨询。
- 明确购买/推进动作：准备存、打算存、想尽快办理、马上办理、这周去办、询问具体办理流程、私信咨询、已留联系方式、已被销售跟进、正在对接机构。
- 渠道/地区落地咨询：当地能不能存、哪家医院可以办、哪个地区能做、有没有合作医院、廊坊能存吗、现在还能存吗、私信你了帮我看看。
- 强时间节点：过几天生、马上要生、已住院、临产、已进待产阶段。
- 高风险驱动且与购买/办理相关：家族病史、老大患病、生二胎为了留脐带血、明显表达后悔没存，并继续询问存储/办理/价格/机构。
- 已成交/复购推进：已续费、二胎继续存、推荐家人继续存、再次咨询办理。
- 注意：“历史存过”本身不等于 4；只有当前再次推进、续费、继续咨询，才判 4。

3=购买评估阶段，中意向：
- 用户已经产生现实购买兴趣，正在比较、评估、纠结、咨询，但尚未明确行动。
- 价格与方案：多少钱、怎么收费、有没有优惠、套餐区别、能不能分期。
- 产品购买评估：有没有必要存、值不值、要不要存、靠不靠谱、会不会是智商税。
- 决策犹豫：家里人在纠结、有点心动、想了解一下、帮忙看看、我在考虑。
- 现实限制：太贵了、怕被坑、担心机构跑路、不知道靠不靠谱。
- 回复链承接购买话题继续咨询也判 3，例如别人说“我家存了”，用户追问“多少钱？在哪存的？”。
- 即使带怀疑、犹豫、嫌贵等负面情绪，只要核心仍围绕“自己是否购买/办理”，仍属于 3。

2=认知了解阶段，低意向：
- 用户主要处于知识了解、科普认知阶段，对产品有兴趣，但没有进入现实购买决策。
- 知识科普：能治疗什么病、原理是什么、有什么用途、技术靠谱吗、为什么能用。
- 产品区别：脐带血和干细胞区别、哪个更好、存储年限、到期怎么办、保险怎么赔。
- 泛讨论：行业观点、医疗发展、技术趋势、经验交流。
- 轻度好奇或泛泛质疑：真的假的、第一次知道、原来还能这样、智商税吗。
- “智商税/靠谱”如果只是泛泛质疑，判 2；如果围绕自己要不要买、快生了、价格、办理等现实决策，判 3 或 4。

1=无意向：
- 纯互动、无关闲聊、路人围观、玩笑、与产品购买无明显关系，或无法体现实际需求。
- 问衣服、问链接、问托腹带、聊天气新闻等无关话题。
- 纯负面但无购买/咨询行为。

边界示例：
- “想了解一下” -> 3
- “想了解一下，过几天就生了” -> 4
- “值不值存？” -> 3
- “哪里可以办？” -> 4
- “廊坊能存吗？” -> 4
- “智商税吗？” -> 2
- “想存但怕是智商税” -> 3
- “老大存了，老二继续存” -> 4
- “存了10年，现在不想续了” -> 1

输出要求：
- 不要输出 0；0 只留给系统在超时、失败、漏返回时兜底。
- 只返回 JSON 数组，不要解释，不要 Markdown。
- 输出格式固定为 [{"id":"原样返回","intention":1|2|3|4}]。`;

function envFlag(name, defaultValue) {
  const value = setting(name);
  if (value === undefined || value === null) return defaultValue;
  return !new Set(['0', 'false', 'no', 'off']).has(String(value).trim().toLowerCase());
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

export function extractContentText(messageContent) {
  if (typeof messageContent === 'string') return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .filter((item) => item && typeof item === 'object' && item.type === 'text' && item.text)
      .map((item) => String(item.text))
      .join('\n');
  }
  return '';
}

export function parseResponseJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('AI response was empty');
  try {
    return JSON.parse(text);
  } catch {
    const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    const objectStream = text.match(/^\s*\{[\s\S]*\}\s*(,\s*\{[\s\S]*\}\s*)+$/);
    if (objectStream) return JSON.parse(`[${text}]`);
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 200)}`);
  }
}

export function normalizeResults(data) {
  if (!Array.isArray(data)) throw new Error('AI response JSON must be an array');
  const results = new Map();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const recordId = String(item.id ?? '').trim();
    const intention = Number(item.intention);
    if (recordId && VALID_INTENTIONS.has(intention)) results.set(recordId, intention);
  }
  return results;
}

export class IntentionClassifier {
  constructor({
    apiKey,
    baseUrl = DEFAULT_MODELSCOPE_BASE_URL,
    model = DEFAULT_MODELSCOPE_MODEL,
    models = undefined,
    timeoutSeconds = 30,
    batchSize = DEFAULT_BATCH_SIZE,
  }) {
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.models = (models?.length ? models : [model]).map((item) => String(item).trim()).filter(Boolean);
    if (this.models.length === 0) this.models = [DEFAULT_MODELSCOPE_MODEL];
    this.timeoutSeconds = timeoutSeconds;
    this.batchSize = Math.max(1, batchSize);
  }

  async classify(items) {
    const results = new Map();
    for (let start = 0; start < items.length; start += this.batchSize) {
      const batch = items.slice(start, start + this.batchSize);
      const batchResults = await this.classifyBatch(batch);
      for (const [key, value] of batchResults.entries()) results.set(key, value);
    }
    return results;
  }

  async classifyBatch(items) {
    const errors = [];
    for (const model of this.models) {
      try {
        return await this.classifyBatchWithModel(items, model);
      } catch (error) {
        errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`all AI models failed (${errors.slice(0, 3).join('; ')})`);
  }

  async classifyBatchWithModel(items, model) {
    const userContent = `${CLASSIFICATION_RULES}\n待分类数据：${JSON.stringify(items.map((item) => ({ id: item.recordId, text: item.content })))}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: userContent }],
          temperature: 0,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const responseData = JSON.parse(text);
    const message = responseData?.choices?.[0]?.message?.content;
    if (message === undefined) throw new Error(`Unexpected AI response shape: ${text.slice(0, 300)}`);
    const rawMessage = typeof message === 'string' || Array.isArray(message)
      ? extractContentText(message)
      : JSON.stringify(message);
    let parsed = parseResponseJson(rawMessage);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.results)) {
      parsed = parsed.results;
    }
    return normalizeResults(parsed);
  }
}

export function buildClassifierFromEnv() {
  if (!envFlag('OPENCLI_INTENTION_AI_ENABLED', true)) return null;
  const apiKey = (setting('OPENCLI_MODELSCOPE_API_KEY') || setting('MODELSCOPE_API_KEY') || '').trim();
  if (!apiKey) return null;
  const baseUrl = (setting('OPENCLI_MODELSCOPE_BASE_URL', DEFAULT_MODELSCOPE_BASE_URL) || DEFAULT_MODELSCOPE_BASE_URL).trim();
  const envModel = (process.env.OPENCLI_MODELSCOPE_MODEL || '').trim();
  let models = settingList('OPENCLI_MODELSCOPE_MODELS');
  const configModel = (setting('OPENCLI_MODELSCOPE_MODEL') || '').trim();
  let model;
  if (envModel) {
    models = [envModel];
    model = envModel;
  } else if (models.length) {
    model = models[0];
  } else if (configModel) {
    model = configModel;
    models = [configModel];
  } else {
    models = [...DEFAULT_MODELSCOPE_MODELS];
    model = models[0];
  }
  return new IntentionClassifier({
    apiKey,
    baseUrl,
    model,
    models,
    timeoutSeconds: Number(setting('OPENCLI_INTENTION_AI_TIMEOUT_SECONDS', '30') || 30),
    batchSize: Number(setting('OPENCLI_INTENTION_AI_BATCH_SIZE', String(DEFAULT_BATCH_SIZE)) || DEFAULT_BATCH_SIZE),
  });
}

export async function applyIntentionAnalysis(records, {
  contentKey = 'content',
  idKey = 'comment_id',
  classifier = undefined,
} = {}) {
  const warnings = [];
  const analysisItems = [];
  for (const record of records) {
    if (record.intention === undefined) record.intention = 0;
    const recordId = String(record[idKey] ?? '').trim();
    const content = String(record[contentKey] ?? '').trim();
    if (recordId && content) analysisItems.push({ recordId, content });
  }
  if (analysisItems.length === 0) return warnings;

  const activeClassifier = classifier === undefined ? buildClassifierFromEnv() : classifier;
  if (activeClassifier === null) {
    warnings.push('AI intention analysis skipped: missing OPENCLI_MODELSCOPE_API_KEY/MODELSCOPE_API_KEY or AI explicitly disabled.');
    return warnings;
  }

  let results;
  try {
    results = await activeClassifier.classify(analysisItems);
  } catch (error) {
    warnings.push(`AI intention analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    return warnings;
  }

  const missingIds = [];
  for (const record of records) {
    const recordId = String(record[idKey] ?? '').trim();
    if (!recordId) continue;
    const intention = results.get(recordId);
    if (VALID_INTENTIONS.has(intention)) record.intention = intention;
    else missingIds.push(recordId);
  }
  if (missingIds.length) {
    warnings.push(`AI intention analysis returned no result for ${missingIds.length} rows; kept default intention=0.`);
  }
  return warnings;
}
