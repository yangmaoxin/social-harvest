import fs from 'node:fs';
import path from 'node:path';

import { buildTaskState } from './reports.js';

const TASK_EVENT_PREFIX = 'TASK_EVENT ';
const OPENCLI_PROGRESS_PREFIX = 'OPENCLI_PROGRESS ';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function shortText(text, max = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export function isRawJsonLikeLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (text === '{' || text === '}' || text === '[' || text === ']') return true;
  if (/^[{\[]\s*["{\[]/.test(text)) return true;
  if (/^["'][^"']+["']\s*:/.test(text)) return true;
  if (/^[}\]],?$/.test(text)) return true;
  return false;
}

function parsePrefixedJsonLine(line, prefix) {
  if (!line.startsWith(prefix)) return null;
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return null;
  }
}

function childProgressMessage(event = {}) {
  return shortText(
    event.message
    || event.currentEvent
    || event.statusRibbon
    || event.title
    || event.stage
    || event.type
    || '平台任务进度更新',
  );
}

function eventDetail(event = {}) {
  const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
  return detail.detail && typeof detail.detail === 'object' ? detail.detail : detail;
}

function displayTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function compactMetrics(event = {}) {
  const detail = eventDetail(event);
  const metrics = [];
  const workRows = Number(detail.work_rows || 0);
  if (workRows > 0) metrics.push(`作品 ${workRows}`);
  const accountRows = Number(detail.account_rows || 0);
  if (accountRows > 0) metrics.push(`账号 ${accountRows}`);
  const snapshotRows = Number(detail.snapshot_rows || 0);
  if (snapshotRows > 0) metrics.push(`快照 ${snapshotRows}`);
  const eventRows = Number(detail.event_rows || detail.generated_rows || 0);
  if (eventRows > 0) metrics.push(`事件 ${eventRows}`);
  const insertedRows = Number(detail.inserted_rows || detail.new_rows || 0);
  if (insertedRows > 0) metrics.push(`新增 ${insertedRows}`);
  const duplicateRows = Number(detail.duplicate_rows || 0);
  if (duplicateRows > 0) metrics.push(`已存在 ${duplicateRows}`);
  const current = Number(detail.current_work_index || 0);
  const total = Number(detail.total_works || 0);
  if (current > 0 || total > 0) metrics.push(`进度 ${current || '?'}/${total || '?'}`);
  const completed = Number(detail.works_completed || 0);
  if (completed > 0) metrics.push(`完成 ${completed}`);
  const failed = Number(detail.works_failed || 0);
  if (failed > 0) metrics.push(`失败 ${failed}`);
  const comments = Number(detail.total_comments || detail.comment_rows || detail.top_level_comment_rows || 0);
  if (comments > 0) metrics.push(`评论 ${comments}`);
  const replies = Number(detail.total_replies || detail.reply_comment_rows || 0);
  if (replies > 0) metrics.push(`回复 ${replies}`);
  const messages = Number(detail.private_messages || detail.message_rows || detail.exported_rows || 0);
  const eventText = [event.step, event.task, event.task_label, event.message].map((value) => String(value || '')).join(' ');
  if (messages > 0 && /message|私信/.test(eventText)) {
    metrics.push(`私信 ${messages}`);
  }
  const danmaku = Number(detail.danmaku_rows || 0);
  if (danmaku > 0) metrics.push(`弹幕 ${danmaku}`);
  const commentTargets = Number(detail.comment_target_count || 0);
  if (commentTargets > 0) metrics.push(`评论对象 ${commentTargets}`);
  const danmakuTargets = Number(detail.danmaku_target_count || 0);
  if (danmakuTargets > 0) metrics.push(`弹幕对象 ${danmakuTargets}`);
  const failedCommentTargets = Number(detail.failed_comment_target_count || 0);
  if (failedCommentTargets > 0) metrics.push(`评论失败 ${failedCommentTargets}`);
  const failedDanmakuTargets = Number(detail.failed_danmaku_target_count || 0);
  if (failedDanmakuTargets > 0) metrics.push(`弹幕失败 ${failedDanmakuTargets}`);
  const counts = detail.counts && typeof detail.counts === 'object' ? detail.counts : {};
  const writeAttempts = Number(
    detail.write_attempt_rows
    || detail.write_attempt_work_rows
    || counts.write_attempt_rows
    || counts.write_attempt_work_rows
    || 0,
  );
  if (writeAttempts > 0) metrics.push(`准备写入 ${writeAttempts}`);
  const matchedRows = Number(
    detail.matched_current_payload_rows
    || detail.matched_rows
    || detail.verification?.matched_current_payload_rows
    || detail.verification?.matched_rows
    || 0,
  );
  if (matchedRows > 0) metrics.push(`校验命中 ${matchedRows}`);
  return metrics.length ? ` (${metrics.join('，')})` : '';
}

function eventScope(event = {}) {
  return [
    event.platform_label || event.platform,
    event.task_label || event.task,
  ].map((part) => String(part || '').trim()).filter(Boolean).join(' / ') || 'Social Harvest';
}

function detailText(detail = {}, keys = []) {
  return keys
    .map(([key, label]) => {
      const value = detail[key];
      if (value === undefined || value === null || value === '') return '';
      if (typeof value === 'number' && !Number.isFinite(value)) return '';
      if (Number.isFinite(Number(value)) && Number(value) <= 0) return '';
      return `${label}${value}`;
    })
    .filter(Boolean);
}

function detailValue(detail = {}, key, fallback = '') {
  const value = detail[key];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function countText(value, unit, fallback = '') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return `${number} ${unit}`;
}

function numberedWorkText(detail = {}, unit = '个作品') {
  const current = Number(detail.current_work_index || 0);
  const total = Number(detail.total_works || 0);
  if (current > 0 && total > 0) return `第 ${current}/${total} ${unit}`;
  if (current > 0) return `第 ${current} ${unit}`;
  return '';
}

function workTitle(detail = {}) {
  return shortText(
    detail.current_work
    || detail.title
    || detail.work_title
    || detail.aweme_id
    || detail.item_id
    || '',
    80,
  );
}

function detailCountParts(detail = {}) {
  const parts = [];
  const current = Number(detail.current_work_index || 0);
  const total = Number(detail.total_works || 0);
  if (current > 0 && total > 0) parts.push(`进度 ${current}/${total}`);
  else if (current > 0) parts.push(`进度 ${current}`);
  const completed = Number(detail.works_completed || 0);
  const failed = Number(detail.works_failed || 0);
  const skipped = Number(detail.skipped_works || 0);
  if (completed > 0 || failed > 0 || skipped > 0) parts.push(`已完成 ${completed}，失败 ${failed}，跳过 ${skipped}`);
  const currentWork = workTitle(detail);
  if (currentWork) parts.push(`当前 ${currentWork}`);
  const creatorTopLevel = Number(detail.creator_harvest_top_level_comments || 0);
  const creatorReplies = Number(detail.creator_harvest_reply_comments || 0);
  const creatorDanmaku = Number(detail.creator_harvest_danmaku_rows || 0);
  if (creatorTopLevel > 0 || creatorReplies > 0 || creatorDanmaku > 0) {
    const works = Number(detail.works || detail.work_rows || 0);
    if (works > 0) parts.push(`作品 ${works}`);
    if (creatorTopLevel > 0) parts.push(`评论 ${creatorTopLevel}`);
    if (creatorReplies > 0) parts.push(`回复 ${creatorReplies}`);
    if (creatorDanmaku > 0) parts.push(`弹幕 ${creatorDanmaku}`);
    return [...new Set(parts)];
  }
  parts.push(...detailText(detail, [
    ['work_rows', '作品 '],
    ['works', '作品 '],
    ['account_rows', '账号 '],
    ['accounts', '账号 '],
    ['total_comments', '一级评论 '],
    ['comment_rows', '评论 '],
    ['comments', '评论 '],
    ['top_level_comment_rows', '一级评论 '],
    ['total_replies', '回复 '],
    ['reply_comment_rows', '回复 '],
    ['message_rows', '私信 '],
    ['exported_rows', '导出 '],
    ['danmaku_rows', '弹幕 '],
    ['api_calls', '接口 '],
    ['snapshot_rows', '快照 '],
    ['event_rows', '事件 '],
    ['generated_rows', '事件 '],
    ['inserted_rows', '新增 '],
    ['duplicate_rows', '已存在 '],
    ['write_attempt_rows', '准备写入 '],
    ['matched_current_payload_rows', '校验命中 '],
    ['matched_rows', '校验命中 '],
    ['received_count', '本页 '],
    ['receivedCount', '本页 '],
    ['reply_rows', '本页回复 '],
    ['accumulatedTopLevel', '累计一级评论 '],
    ['accumulatedReplies', '累计回复 '],
    ['accumulatedPosts', '累计作品 '],
    ['accumulatedImageTexts', '累计图文 '],
    ['accumulatedVideos', '累计视频 '],
    ['totalTopLevel', '一级评论 '],
    ['totalReplies', '回复 '],
    ['current_work_top_level', '当前一级评论 '],
    ['current_work_replies', '当前回复 '],
    ['comment_page', '评论页 '],
    ['danmaku_page', '弹幕页 '],
    ['current_work_page', '评论页 '],
    ['current_reply_page', '回复页 '],
  ]));
  return [...new Set(parts)];
}

function parseProgressIndex(message = '') {
  const match = String(message || '').match(/(\d+)\s*\/\s*(\d+)/);
  return match ? { current: match[1], total: match[2] } : null;
}

function afterColon(message = '') {
  const text = String(message || '');
  return text.includes('：') ? text.split('：').slice(1).join('：').trim() : '';
}

function startMessage(event = {}) {
  const taskId = String(event.task || '').trim();
  const taskLabel = String(event.task_label || taskId || '任务').trim();

  if (taskId === 'diagnostic' || taskLabel.includes('运行前检查')) {
    return '运行前检查开始：检查 Node、依赖、配置、登录态和数据库连接';
  }
  if (taskId.includes('import') || taskLabel.includes('入库')) {
    return `准备入库：${taskLabel}，先校验待写数据和目标配置`;
  }
  if (taskId.includes('metric-snapshot')) {
    return `准备生成指标快照：${taskLabel}`;
  }
  if (taskId.includes('metric-delta')) {
    return `准备计算指标增量：${taskLabel}`;
  }
  if (taskId.includes('messages') || taskLabel.includes('私信')) {
    return `准备导出私信：${taskLabel}`;
  }
  if (taskId.includes('danmaku') || taskLabel.includes('弹幕')) {
    return `准备采集弹幕：${taskLabel}`;
  }
  if (taskId.includes('account') || taskLabel.includes('账号')) {
    return `准备采集账号信息：${taskLabel}`;
  }
  if (taskId.includes('content') || taskLabel.includes('内容') || taskLabel.includes('作品')) {
    return `准备采集内容数据：${taskLabel}`;
  }
  return `准备执行：${taskLabel}`;
}

function humanDetailedMessage(event = {}, detail = {}) {
  const step = String(event.step || event.task || detail.step || '').trim();
  const rawMessage = shortText(event.message || childProgressMessage(event), 240);
  const title = workTitle(detail);
  const position = numberedWorkText(detail);
  const indexed = parseProgressIndex(rawMessage);

  if (detail.phase_label === '实时分享' || detail.phaseLabel === '实时分享') {
    return rawMessage;
  }
  if (step === 'start') {
    return startMessage(event);
  }
  if (step === 'full-start') {
    const batchText = countText(detail.batch_size, '个一批', '分批');
    const maxText = Number(detail.max_items || 0) > 0 ? `，最多处理 ${detail.max_items} 个` : '';
    return `已进入全量采集模式：每批 ${batchText}${maxText}，中途断了也会保存进度`;
  }
  if (step === 'resume-detected') {
    const batch = Number(detail.current_batch || 0);
    const cursor = detail.next_cursor ? '，已找到续跑位置' : '';
    return `发现上次断点，将从第 ${batch + 1 || 1} 批继续${cursor}`;
  }
  if (step === 'batch-start') {
    const batch = Number(detail.current_batch || 1);
    return `第 ${batch} 批开始：准备读取下一批作品和互动数据`;
  }
  if (step === 'batch-complete') {
    const parts = [];
    if (detail.batch_items !== undefined) parts.push(`本批 ${detail.batch_items} 个`);
    if (detail.completed_count !== undefined) parts.push(`已完成 ${detail.completed_count} 个`);
    if (detail.failed_count !== undefined) parts.push(`失败 ${detail.failed_count} 个`);
    return `第 ${detail.current_batch || 1} 批完成${parts.length ? `：${parts.join('，')}` : ''}`;
  }
  if (step === 'checkpoint-saved') {
    return '断点已保存，下次可以从这里继续，不需要从头重跑';
  }
  if (step === 'full-complete') {
    const counts = detailCountParts(detail).join('，');
    return `全量采集完成${counts ? `：${counts}` : ''}`;
  }
  if (step === 'creator-harvest') {
    const workLimit = countText(detail.work_limit, '个作品', '若干作品');
    const commentLimit = countText(detail.comment_work_limit, '个评论对象', '');
    const danmakuLimit = countText(detail.danmaku_work_limit, '个弹幕对象', '');
    const goals = [workLimit, commentLimit, danmakuLimit].filter(Boolean).join('，');
    if (/完成/.test(rawMessage)) return `本轮采集完成：${detailCountParts(detail).join('，') || rawMessage}`;
    return `开始采集抖音创作者中心：准备抓 ${goals}`;
  }
  if (step === 'creator-harvest-complete') {
    return `采集完成，正在整理结果：${detailCountParts(detail).join('，') || rawMessage}`;
  }
  if (step === 'opencli-command') {
    return '正在打开抖音创作者中心，等待作品、评论和弹幕数据返回';
  }
  if (step === 'parse-output') {
    return `页面数据已返回，正在整理 ${countText(detail.work_rows, '个作品', '采集结果')}`;
  }
  if (step === 'write-artifacts') {
    return `采集结果已整理完成，准备进入入库或后续处理`;
  }
  if (step === 'complete') {
    const counts = detailCountParts(detail).join('，');
    if (counts) return `本轮任务完成：${counts}`;
    return rawMessage.replace(/.+?\/.+?：/, '') || '本轮任务完成';
  }
  if (step === 'work-list-start') return '正在打开作品列表，准备读取作品';
  if (step === 'work-list-complete') return `已找到 ${countText(detail.work_rows || detail.total_works, '个作品', '作品列表')}，接下来抓评论和弹幕`;
  if (step === 'comment-target-start') return '正在打开评论管理，准备找到需要抓评论的作品';
  if (step === 'comment-target-complete') return `已找到 ${countText(detail.comment_target_count, '个评论对象', '评论对象')}，开始逐个抓评论`;
  if (step === 'danmaku-target-start') return '正在打开弹幕管理，准备找到需要抓弹幕的作品';
  if (step === 'danmaku-target-complete') return `已找到 ${countText(detail.danmaku_target_count, '个弹幕对象', '弹幕对象')}，开始逐个抓弹幕`;
  if (step === 'comment-fetch-start') {
    const pos = position || (indexed ? `第 ${indexed.current}/${indexed.total} 个作品` : '当前作品');
    return `正在抓${pos}的评论${title ? `：《${title}》` : ''}`;
  }
  if (step === 'comment-page') {
    return rawMessage || `评论页已返回`;
  }
  if (step === 'reply-page' || step === 'reply-progress') {
    return rawMessage || '正在整理评论回复';
  }
  if (step === 'comment-fetch-complete') {
    const pos = position || (indexed ? `第 ${indexed.current}/${indexed.total} 个作品` : '当前作品');
    return `${pos}评论抓取完成${title ? `：《${title}》` : ''}`;
  }
  if (step === 'comment-fetch-failed') {
    const pos = position || (indexed ? `第 ${indexed.current}/${indexed.total} 个作品` : '当前作品');
    return `${pos}评论抓取失败${title ? `：《${title}》` : ''}，稍后继续处理其他作品`;
  }
  if (step === 'danmaku-fetch-start') {
    const pos = position || (indexed ? `第 ${indexed.current}/${indexed.total} 个作品` : '当前作品');
    return `正在抓${pos}的弹幕${title ? `：《${title}》` : ''}`;
  }
  if (step === 'danmaku-page') {
    return rawMessage || '弹幕页已返回';
  }
  if (step === 'danmaku-fetch-complete') {
    const pos = position || (indexed ? `第 ${indexed.current}/${indexed.total} 个作品` : '当前作品');
    return `${pos}弹幕抓取完成${title ? `：《${title}》` : ''}`;
  }
  if (step === 'danmaku-fetch-failed') {
    const pos = position || (indexed ? `第 ${indexed.current}/${indexed.total} 个作品` : '当前作品');
    return `${pos}弹幕抓取失败${title ? `：《${title}》` : ''}，稍后继续处理其他作品`;
  }
  if (step === 'waiting') return rawMessage || '还在处理中，等待页面返回数据';
  if (step === 'import-summary') return `正在检查即将入库的数据：${afterColon(rawMessage) || detailCountParts(detail).join('，')}`;
  if (step === 'import-verification') return `入库前校验完成：${afterColon(rawMessage) || detailCountParts(detail).join('，')}`;
  if (step.includes('metric-snapshot')) return rawMessage.replace(/^指标/, '正在处理指标');
  if (step === 'metric-delta-applied') return rawMessage || '指标增量写入完成';
  if (step.includes('metric-delta')) return rawMessage.replace(/^指标/, '正在处理指标');

  return rawMessage || '任务进度更新';
}

export function normalizeDisplayMode(display = '') {
  const value = String(display || '').trim().toLowerCase();
  if (!value) return 'compact';
  if (['compact', 'detailed', 'jsonl', 'silent'].includes(value)) return value;
  throw new Error(`Unsupported display mode: ${display}. Use compact, detailed, jsonl, or silent.`);
}

export function taskEventFromLine(line) {
  const text = String(line || '').trim();
  return parsePrefixedJsonLine(text, TASK_EVENT_PREFIX);
}

export function isStructuredEventLine(line) {
  const text = String(line || '').trim();
  return text.startsWith(TASK_EVENT_PREFIX) || text.startsWith(OPENCLI_PROGRESS_PREFIX);
}

export function formatTaskEventLine(lineOrEvent) {
  const event = typeof lineOrEvent === 'string' ? taskEventFromLine(lineOrEvent) : lineOrEvent;
  if (!event) return '';
  const status = event.status || 'running';
  const step = event.step || event.task || 'progress';
  const message = shortText(event.message || childProgressMessage(event), 180);
  return `[${displayTime(event.timestamp)}] ${eventScope(event)} | ${status} | ${step} | ${message}${compactMetrics(event)}`;
}

export function formatDetailedTaskEventBlock(lineOrEvent) {
  const event = typeof lineOrEvent === 'string' ? taskEventFromLine(lineOrEvent) : lineOrEvent;
  if (!event) return '';
  const detail = eventDetail(event);
  const message = humanDetailedMessage(event, detail);
  const suppressMetricDeltaCounts = ['metric-delta-summary', 'metric-delta-applied'].includes(String(event.step || ''));
  const parts = suppressMetricDeltaCounts ? [] : detailCountParts(detail);
  const ribbon = detailValue(detail, 'status_ribbon', detailValue(detail, 'statusRibbon'));
  const alreadySaysCounts = parts.length > 0 && parts
    .filter((part) => !part.startsWith('进度 ') && !part.startsWith('当前 '))
    .some((part) => message.includes(part));
  const suffix = parts.length && !alreadySaysCounts ? `（${parts.join('，')}）` : '';
  const ribbonText = ribbon ? `。${shortText(ribbon, 120)}` : '';
  return `[${displayTime(event.timestamp)}] ${message}${suffix}${ribbonText}`;
}

function shouldRenderCompactEvent(event = {}) {
  const source = String(event.source || '');
  const status = String(event.status || 'running');
  if (['failed', 'error', 'warning'].includes(status)) return true;
  if (!['child-task-event', 'opencli-progress', 'stderr-progress', 'tagged-summary'].includes(source)) return true;
  return false;
}

export function emitTaskEvent(event, writer = console.error) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  writer(`${TASK_EVENT_PREFIX}${JSON.stringify(payload)}`);
  return payload;
}

export function childEventFromLine(line, { stream = 'stderr' } = {}) {
  const text = String(line || '').trim();
  if (!text) return null;

  const taskEvent = parsePrefixedJsonLine(text, TASK_EVENT_PREFIX);
  if (taskEvent) {
    return {
      type: taskEvent.type || 'progress',
      source: taskEvent.source || 'child-task-event',
      status: taskEvent.status || 'running',
      step: taskEvent.step || taskEvent.task || 'progress',
      message: childProgressMessage(taskEvent),
      detail: taskEvent,
    };
  }

  const progressEvent = parsePrefixedJsonLine(text, OPENCLI_PROGRESS_PREFIX);
  if (progressEvent) {
    return {
      type: 'progress',
      source: 'opencli-progress',
      status: progressEvent.status || 'running',
      step: progressEvent.step || progressEvent.stage || progressEvent.type || 'progress',
      message: childProgressMessage(progressEvent),
      detail: progressEvent,
    };
  }

  const taggedEvent = taggedSummaryEventFromLine(text);
  if (taggedEvent) return taggedEvent;

  if (stream !== 'stderr') return null;

  const knownProgressPatterns = [
    { pattern: /^\[douyin\] harvesting /, step: 'account-harvest' },
    { pattern: /^\[douyin\] retrying /, step: 'retry' },
    { pattern: /^\[douyin\] skipping /, step: 'skip' },
    { pattern: /^\[douyin\] reusing /, step: 'reuse' },
    { pattern: /^\[1\/2\] /, step: 'export' },
    { pattern: /^\[2\/2\] /, step: 'import' },
    { pattern: /^\[probe\] /, step: 'probe' },
    { pattern: /^\[report\] /, step: 'report' },
  ];
  const matched = knownProgressPatterns.find(({ pattern }) => pattern.test(text));
  if (!matched) return null;
  return {
    type: 'progress',
    source: 'stderr-progress',
    status: 'running',
    step: matched.step,
    message: shortText(text),
    detail: { line: text },
  };
}

function metricParts(data = {}) {
  const parts = [];
  const fields = [
    ['account_rows', '账号'],
    ['work_rows', '作品'],
    ['comment_rows', '评论'],
    ['message_rows', '私信'],
    ['danmaku_rows', '弹幕'],
    ['snapshot_rows', '快照'],
    ['event_rows', '事件'],
    ['generated_rows', '事件'],
    ['inserted_rows', '新增'],
    ['duplicate_rows', '已存在'],
    ['write_attempt_rows', '准备写入'],
    ['matched_current_payload_rows', '校验命中'],
    ['matched_rows', '校验命中'],
  ];
  for (const [field, label] of fields) {
    const value = Number(data[field] || 0);
    if (value > 0) parts.push(`${label}${value}`);
  }
  const counts = data.counts && typeof data.counts === 'object' ? data.counts : {};
  const nestedWorkRows = Number(counts.write_attempt_work_rows || 0);
  if (nestedWorkRows > 0) parts.push(`准备写入作品${nestedWorkRows}`);
  const nestedCommentRows = Number(counts.write_attempt_comment_rows || 0);
  if (nestedCommentRows > 0) parts.push(`准备写入评论${nestedCommentRows}`);
  const verification = data.verification && typeof data.verification === 'object' ? data.verification : {};
  const nestedMatched = Number(verification.matched_current_payload_rows || verification.matched_rows || 0);
  if (nestedMatched > 0) parts.push(`校验命中${nestedMatched}`);
  return parts;
}

function mediaSkipReasonParts(reasons = {}) {
  const labels = [
    ['already_public_url', '已是目标 OSS URL'],
    ['existing_oss_object', 'OSS 对象已存在'],
    ['backend_not_configured', '未配置媒体后端'],
  ];
  return labels
    .map(([field, label]) => [Number(reasons[field] || 0), label])
    .filter(([value]) => value > 0)
    .map(([value, label]) => `${label}${value}`);
}

function mediaSummaryMessage(data = {}) {
  if (data.status === 'skipped') {
    const reason = shortText(data.reason || '未启用 SCRM 图片处理');
    return `SCRM 图片处理跳过：${reason}`;
  }
  const parts = [];
  const attempted = Number(data.attempted || 0);
  const uploaded = Number(data.uploaded || 0);
  const skipped = Number(data.skipped_existing || 0);
  const failed = Number(data.failed || 0);
  if (attempted > 0) parts.push(`尝试${attempted}`);
  if (uploaded > 0) parts.push(`上传${uploaded}`);
  if (skipped > 0) parts.push(`跳过${skipped}`);
  if (failed > 0) parts.push(`失败${failed}`);
  const reasonParts = mediaSkipReasonParts(data.skipped_reasons);
  if (reasonParts.length) parts.push(`跳过原因：${reasonParts.join('，')}`);
  return parts.length ? `SCRM 图片处理完成：${parts.join('，')}` : 'SCRM 图片处理完成：没有需要上传的图片';
}

function metricDeltaSummaryMessage(data = {}) {
  const snapshotRows = Number(data.snapshot_rows || 0);
  const eventRows = Number(data.event_rows || data.generated_rows || 0);
  const parts = [];
  if (snapshotRows > 0) parts.push(`快照${snapshotRows}`);
  parts.push(`待校验事件${eventRows}`);
  if (data.to_source_run_id) parts.push('仅本轮快照');
  return `指标增量预检完成：${parts.join('，')}`;
}

function metricDeltaAppliedMessage(data = {}) {
  const generatedRows = Number(data.generated_rows || data.checked_rows || 0);
  const insertedRows = Number(data.inserted_rows || 0);
  const duplicateRows = Number(data.duplicate_rows || 0);
  const writeAttemptRows = Number(data.write_attempt_rows || 0);
  const parts = [
    `校验事件${generatedRows}`,
    `新增${insertedRows}`,
    `已存在${duplicateRows}`,
  ];
  if (writeAttemptRows !== insertedRows) parts.push(`写入尝试${writeAttemptRows}`);
  return `指标增量写入完成：${parts.join('，')}`;
}

function taggedSummaryEventFromLine(text) {
  const mediaStart = parsePrefixedJsonLine(text, 'MEDIA_START ');
  if (mediaStart) {
    const backend = shortText(mediaStart.backend || '未配置');
    return {
      type: 'progress',
      source: 'tagged-summary',
      status: 'running',
      step: 'media-start',
      message: mediaStart.configured
        ? `开始处理 SCRM 图片：使用 ${backend}`
        : '开始处理 SCRM 图片：未配置媒体后端，将跳过',
      detail: mediaStart,
    };
  }

  const mediaSummary = parsePrefixedJsonLine(text, 'MEDIA_SUMMARY ');
  if (mediaSummary) {
    return {
      type: 'progress',
      source: 'tagged-summary',
      status: mediaSummary.status === 'warning' ? 'warning' : 'running',
      step: 'media-summary',
      message: mediaSummaryMessage(mediaSummary),
      detail: mediaSummary,
    };
  }

  const metricDeltaSummary = parsePrefixedJsonLine(text, 'METRIC_DELTA_SUMMARY ');
  if (metricDeltaSummary) {
    return {
      type: 'progress',
      source: 'tagged-summary',
      status: 'running',
      step: 'metric-delta-summary',
      message: metricDeltaSummaryMessage(metricDeltaSummary),
      detail: metricDeltaSummary,
    };
  }

  const metricDeltaApplied = parsePrefixedJsonLine(text, 'METRIC_DELTA_APPLIED ');
  if (metricDeltaApplied) {
    return {
      type: 'progress',
      source: 'tagged-summary',
      status: 'success',
      step: 'metric-delta-applied',
      message: metricDeltaAppliedMessage(metricDeltaApplied),
      detail: metricDeltaApplied,
    };
  }

  const taggedSpecs = [
    ['IMPORT_SUMMARY ', 'import-summary', '导入预检完成', 'running'],
    ['IMPORT_VERIFICATION ', 'import-verification', '导入校验完成', 'running'],
    ['METRIC_SNAPSHOT_SUMMARY ', 'metric-snapshot-summary', '指标快照预检完成', 'running'],
    ['METRIC_SNAPSHOT_APPLIED ', 'metric-snapshot-applied', '指标快照写入完成', 'success'],
  ];
  for (const [prefix, step, label, status] of taggedSpecs) {
    const data = parsePrefixedJsonLine(text, prefix);
    if (!data) continue;
    const parts = metricParts(data);
    return {
      type: 'progress',
      source: 'tagged-summary',
      status,
      step,
      message: parts.length ? `${label}：${parts.join('，')}` : label,
      detail: data,
    };
  }
  return null;
}

export function createLineCollector(onLine) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    },
    flush() {
      if (!buffer) return;
      onLine(buffer);
      buffer = '';
    },
  };
}

export function createEventWriter(eventFile, fallbackWriter = console.error, options = {}) {
  const display = normalizeDisplayMode(options.display);
  return (line) => {
    if (eventFile) {
      ensureDir(path.dirname(eventFile));
      fs.appendFileSync(eventFile, `${line}\n`);
    }
    if (display === 'silent') return;
    if (display === 'jsonl') {
      fallbackWriter(line);
      return;
    }
    const event = taskEventFromLine(line);
    if (display === 'compact' && event && !shouldRenderCompactEvent(event)) return;
    if (display === 'detailed') {
      fallbackWriter(formatDetailedTaskEventBlock(event || line) || formatTaskEventLine(event || line) || line);
      return;
    }
    fallbackWriter(formatTaskEventLine(event || line) || line);
  };
}

export function createStructuredOutputWriter(stream, writer, options = {}) {
  const output = writer || ((line) => stream.write(`${line}\n`));
  return createLineCollector((line) => {
    if (isStructuredEventLine(line)) return;
    if (options.suppressRawJson !== false && isRawJsonLikeLine(line)) return;
    if (options.displayPlain === false) return;
    output(line);
  });
}

export function createChildEventBridge({
  taskId,
  platform,
  task,
  outputDir,
  platformOutputDir,
  eventFile,
  stateFile,
  reportFile,
  startedAt,
  eventWriter,
  recentEvents,
}) {
  return (line, stream = 'stderr') => {
    const childEvent = childEventFromLine(line, { stream });
    if (!childEvent) return null;
    const event = emitTaskEvent({
      task_id: taskId,
      platform: platform?.id || '',
      platform_label: platform?.label || '',
      task: task.id,
      task_label: task.label || task.id,
      status: childEvent.status || 'running',
      step: childEvent.step || 'progress',
      type: childEvent.type || 'progress',
      source: childEvent.source || 'child',
      message: childEvent.message || '平台任务进度更新',
      detail: childEvent.detail || {},
      output_dir: platformOutputDir,
    }, eventWriter);
    recentEvents.push(event);
    writeJson(stateFile, buildTaskState({
      taskId,
      platformId: platform?.id || '',
      platformLabel: platform?.label || '',
      taskName: task.id,
      taskLabel: task.label || task.id,
      status: 'running',
      step: event.step,
      message: event.message,
      outputDir,
      platformOutputDir,
      eventFile,
      stateFile,
      reportFile,
      startedAt,
      recentEvents,
    }));
    return event;
  };
}
