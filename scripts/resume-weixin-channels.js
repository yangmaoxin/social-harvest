#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { enrichDanmakuRows, resolveDanmakuWorkIndexPath } from './import-danmaku-to-scrm.js';
import {
  checkpointCursor,
  checkpointPathFor,
  createCheckpoint,
  loadCheckpoint,
  markCheckpointItem,
  normalizeLongTaskOptions,
  parseLongTaskFlag,
  resetCheckpoint,
  saveCheckpoint,
  setCheckpointCursors,
} from '../runner/checkpoint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OPENCLI_DIR_CANDIDATES = [
  path.join(ROOT_DIR, 'node_modules', '@jackwener', 'opencli'),
  path.join(ROOT_DIR, 'workspace', 'OpenCLI'),
];
const DEFAULT_OPENCLI_DIR = OPENCLI_DIR_CANDIDATES.find((candidate) => fs.existsSync(path.join(candidate, 'dist', 'src', 'main.js'))) || OPENCLI_DIR_CANDIDATES[0];
const RUN_OPENCLI_SCRIPT = path.join(ROOT_DIR, 'scripts', 'run-opencli.js');
const USER_ADAPTER_DIR_CANDIDATES = [
  path.join(ROOT_DIR, 'workspace', 'OpenCLI', 'clis', 'weixin-channels'),
  path.join(os.homedir(), '.opencli', 'clis', 'weixin-channels'),
];
const DEFAULT_USER_ADAPTER_DIR = USER_ADAPTER_DIR_CANDIDATES.find((candidate) => fs.existsSync(candidate))
  || USER_ADAPTER_DIR_CANDIDATES[0];
const DEFAULT_OUTPUT_BASE = path.join(ROOT_DIR, 'samples', 'weixin-channels');
const PROGRESS_PREFIX = 'OPENCLI_PROGRESS ';
const RUN_REPORT_FILE = 'run-report.json';
const TASK_EVENT_PREFIX = 'TASK_EVENT ';

export function formatShanghaiDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function commentsFilenameFor(objectId) {
  const suffix = String(objectId).replace(/^export\//, '');
  return `comments-export_${suffix}.json`;
}

export function commentsDebugFilenameFor(objectId) {
  const suffix = String(objectId).replace(/^export\//, '');
  return `comments-debug_${suffix}.json`;
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function numericZeroOrEmpty(value) {
  if (value === undefined || value === null || value === '') return true;
  const n = Number(value);
  return Number.isFinite(n) && n === 0;
}

function numericPositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasVideoEvidence(item = {}) {
  const mediaType = Number(item.media_type ?? item.mediaType);
  return item.content_type === 'video'
    || numericPositive(item.duration)
    || mediaType === 4;
}

function isImageTextLike(item = {}, fallbackKind = '') {
  if (hasVideoEvidence(item)) return false;
  const mediaType = item.media_type ?? item.mediaType;
  return fallbackKind === 'image_text'
    || Number(item.file_type) === 2
    || item.content_type === 'image_text'
    || (Number(mediaType) === 2 && numericZeroOrEmpty(item.duration))
    || Number(item.image_count || 0) > 0
    || hasNonEmptyArray(item.image_urls)
    || hasNonEmptyArray(item.images);
}

function contentKindOf(item = {}) {
  return isImageTextLike(item) ? 'image_text' : 'video';
}

function contentKindLabel(item = {}) {
  return contentKindOf(item) === 'image_text' ? '图文' : '视频';
}

function normalizeContentItem(item = {}, fallbackKind = 'video') {
  const kind = isImageTextLike(item, fallbackKind) ? 'image_text' : 'video';
  return {
    ...item,
    content_type: kind,
    file_type: kind === 'image_text' ? 2 : 1,
  };
}

function publishTimestampNumber(item = {}) {
  const raw = Number(item.publish_timestamp || 0);
  return Number.isFinite(raw) ? raw : 0;
}

export function mergeContentItems(posts = [], imageTexts = []) {
  const byObjectId = new Map();
  for (const item of posts.map((entry) => normalizeContentItem(entry, 'video'))) {
    const key = String(item.object_id || '');
    if (!key) continue;
    byObjectId.set(key, item);
  }
  for (const item of imageTexts.map((entry) => normalizeContentItem(entry, 'image_text'))) {
    const key = String(item.object_id || '');
    if (!key) continue;
    const existing = byObjectId.get(key);
    if (!existing) {
      byObjectId.set(key, item);
      continue;
    }
    if (contentKindOf(existing) === 'video' && hasVideoEvidence(existing)) {
      continue;
    }
    if (contentKindOf(item) === 'image_text') {
      byObjectId.set(key, { ...existing, ...item });
    }
  }
  return Array.from(byObjectId.values())
    .sort((left, right) => publishTimestampNumber(right) - publishTimestampNumber(left));
}

function parseNonNegativeInt(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function countTopLevelComments(rows = []) {
  return Array.isArray(rows) ? rows.filter((row) => !row.is_reply).length : 0;
}

function countReplyComments(rows = []) {
  return Array.isArray(rows) ? rows.filter((row) => row.is_reply).length : 0;
}

export function truncateText(value, maxLength = 48) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function summarizeProgressEvent(event = {}) {
  switch (event.type) {
    case 'navigate':
      return `正在打开页面 ${truncateText(event.page, 64)}，先把浏览器切到正确后台，确保后面的接口请求都落在已登录环境里`;
    case 'api-request':
      return `正在请求 ${event.path}，这一跳会把当前分页参数、游标和筛选条件一起带上，准备从后台拉回最新数据`;
    case 'api-response':
      return `接口返回 ${event.path}，状态 ${event.status}，说明这一轮网络往返已经完成，接下来开始拆解返回内容`;
    case 'api-error':
      return `接口异常 ${event.path}，错误信息是 ${truncateText(event.error || '未知错误', 60)}，这一步没有成功拿到可用结果`;
    case 'post-page':
      return `作品流第 ${event.currentPage} 页已经返回，本页拿到 ${event.receivedCount} 条作品，累计盘点到 ${Number(event.accumulatedPosts || 0) + Number(event.receivedCount || 0)} 条候选作品`;
    case 'post-list-complete':
      return `作品流扫描完成，本轮可处理作品已经整理完毕，共 ${event.totalPosts} 条，马上进入逐条评论抓取阶段`;
    case 'image-text-page':
      return `图文列表第 ${event.currentPage} 页已经返回，本页拿到 ${event.receivedCount} 条图文，正在补齐统一稿件池`;
    case 'image-text-list-complete':
      return `图文列表扫描完成，本轮可处理图文已经整理完毕，共 ${event.totalImageTexts} 条`;
    case 'comment-detail':
      return `正在读取作品 ${truncateText(event.exportId, 40)} 的评论详情，先确认后台识别到的真实评论对象和详情上下文`;
    case 'comment-detail-resolved':
      return `评论对象已经锁定为 ${truncateText(event.resolvedExportId, 40)}，后面的评论分页都会围绕这个对象继续深入`;
    case 'comment-page':
      return `评论第 ${event.pageNumber} 页已经返回，本页拿到 ${event.receivedCount} 条一级评论，累计已经沉淀 ${Number(event.accumulatedTopLevel || 0) + Number(event.receivedCount || 0)} 条一级评论`;
    case 'comment-item':
      return `收到一条新的一级评论，评论人是 ${truncateText(event.author || '匿名', 24)}，系统会把正文、层级关系和时间字段一起整理出来`;
    case 'reply-page':
      return `回复第 ${event.pageNumber} 页已经返回，本页拿到 ${event.receivedCount} 条回复，正在继续拼接评论链路`;
    case 'reply-progress':
      return `围绕评论 ${truncateText(event.commentId, 16)} 的回复链还在延展，目前已经累计整理出 ${event.accumulatedReplies} 条回复`;
    case 'comments-complete':
      return `这条作品的评论抓取已经完成，最终得到 ${event.totalTopLevel} 条一级评论、${event.totalReplies} 条回复，当前作品可以进入落盘和聚合阶段`;
    case 'danmaku-video':
      return `弹幕视频 ${truncateText(event.title || event.videoNo || '未命名视频', 40)} 已整理完成，本轮拿到 ${event.bulletCount || 0} 条弹幕`;
    case 'danmaku-complete':
      return `弹幕抓取已经完成，最终整理出 ${event.totalVideos || 0} 个视频、${event.totalRows || 0} 条弹幕`;
    default:
      return event.message || truncateText(JSON.stringify(event), 80);
  }
}

function describeProgressEventBurst(event = {}) {
  switch (event.type) {
    case 'navigate':
      return [
        `浏览器准备切换到目标页面 ${truncateText(event.page, 64)}，先确认当前会话还保持在可操作状态`,
        '页面稳定后就会进入接口调用阶段，不会停在空白等待里',
      ];
    case 'api-request':
      return [
        `开始请求 ${event.path}，系统会把当前页码、游标和筛选条件一起送到后台`,
        '后台请求已经发出，当前正在等待服务器返回这一轮结果',
      ];
    case 'api-response':
      return [
        `接口 ${event.path} 已返回，HTTP 状态 ${event.status}`,
        '系统开始拆解返回 JSON，准备提取作品、评论、回复或弹幕结构',
      ];
    case 'api-error':
      return [
        `接口 ${event.path} 这一步没有成功完成，错误是 ${truncateText(event.error || '未知错误', 80)}`,
        '当前失败已经写入事件流，后续会按脚本策略继续推进或停止',
      ];
    case 'post-page':
      return [
        `作品流第 ${event.currentPage} 页已经打开，本页抓到 ${event.receivedCount} 条作品候选`,
        `作品池累计已盘点 ${Number(event.accumulatedPosts || 0) + Number(event.receivedCount || 0)} 条，稍后会逐条进入评论抓取`,
      ];
    case 'post-list-complete':
      return [
        `作品流扫描收尾，本轮确认 ${event.totalPosts} 条可处理作品`,
        '作品池整理完成，系统马上切到逐条评论抓取模式',
      ];
    case 'image-text-page':
      return [
        `图文列表第 ${event.currentPage} 页已经打开，本页抓到 ${event.receivedCount} 条图文候选`,
        `图文池累计已盘点 ${Number(event.accumulatedImageTexts || 0) + Number(event.receivedCount || 0)} 条`,
      ];
    case 'image-text-list-complete':
      return [
        `图文列表扫描收尾，本轮确认 ${event.totalImageTexts} 条可处理图文`,
        '图文池整理完成，稍后会和账号作品流一起进入统一评论抓取队列',
      ];
    case 'comment-detail':
      return [
        `开始读取作品 ${truncateText(event.exportId, 40)} 的评论详情上下文，先确认后台识别到的真实对象`,
        '这个步骤主要是为了避免后续评论分页抓错对象',
      ];
    case 'comment-detail-resolved':
      return [
        `评论对象已经锁定为 ${truncateText(event.resolvedExportId, 40)}`,
        '对象确认完成，可以正式开始一级评论分页抓取',
      ];
    case 'comment-page':
      return [
        `评论第 ${event.pageNumber} 页已经返回，本页拿到 ${event.receivedCount} 条一级评论`,
        `一级评论累计沉淀到 ${Number(event.accumulatedTopLevel || 0) + Number(event.receivedCount || 0)} 条，系统继续向下翻页`,
        '每条一级评论后面还会继续判断是否需要展开回复链路',
      ];
    case 'comment-item':
      return [
        `系统刚收到一条新的一级评论，评论人是 ${truncateText(event.author || '匿名', 24)}`,
        '正在整理评论正文、时间字段、父子关系和可见性信息',
      ];
    case 'reply-page':
      return [
        `回复第 ${event.pageNumber} 页已经返回，本页收到 ${event.receivedCount} 条回复`,
        '回复链路正在拼接，系统会把 parent/root 关系一起挂好',
      ];
    case 'reply-progress':
      return [
        `围绕评论 ${truncateText(event.commentId, 16)} 的回复链还在延展，目前累计 ${event.accumulatedReplies} 条`,
        '只要后台还给出下一页游标，系统就会继续往深处抓',
      ];
    case 'comments-complete':
      return [
        `这条作品的评论抓取完成，最终拿到 ${event.totalTopLevel} 条一级评论、${event.totalReplies} 条回复`,
        '当前作品数据已经齐了，接下来会写入单文件并刷新聚合产物',
      ];
    case 'danmaku-video':
      return [
        `弹幕视频 ${truncateText(event.title || event.videoNo || '未命名视频', 40)} 已整理完成，本轮拿到 ${event.bulletCount || 0} 条弹幕`,
        '这条视频的弹幕表格已经被展开成扁平记录，接下来继续扫下一个有弹幕的视频',
      ];
    case 'danmaku-complete':
      return [
        `弹幕抓取收尾，本轮整理出 ${event.totalVideos || 0} 个视频、${event.totalRows || 0} 条弹幕`,
        '弹幕清单已经齐了，接下来可以落盘并进入 scrm_danmaku 导入阶段',
      ];
    default:
      return [summarizeProgressEvent(event)];
  }
}

function createEventState() {
  return {
    command: '',
    stage: 'idle',
    phaseLabel: '准备中',
    statusRibbon: '系统待命中',
    currentWork: '',
    currentWorkIndex: 0,
    totalWorks: 0,
    worksCompleted: 0,
    worksFailed: 0,
    skippedWorks: 0,
    totalComments: 0,
    totalReplies: 0,
    apiCalls: 0,
    currentWorkTopLevel: 0,
    currentWorkReplies: 0,
    currentWorkPage: 0,
    currentReplyPage: 0,
    lastEventAt: 0,
  };
}

function stageToLabel(stage = '') {
  switch (stage) {
    case 'browser':
      return '打开页面';
    case 'post-list':
      return '扫描作品流';
    case 'image-text-list':
      return '扫描图文';
    case 'comment-detail':
      return '识别作品详情';
    case 'comment-list':
      return '抓取一级评论';
    case 'reply-list':
      return '抓取评论回复';
    case 'danmaku-list':
      return '抓取弹幕';
    case 'api':
      return '请求接口';
    case 'preflight':
      return '运行预检';
    case 'import':
      return '写入业务系统';
    case 'summary':
      return '最终汇总';
    case 'private-message':
      return '处理私信';
    case 'danmaku':
      return '处理弹幕';
    case 'artifact':
      return '刷新产物';
    case 'command':
      return '执行命令';
    case 'system':
      return '系统准备';
    case 'success':
      return '阶段完成';
    case 'warning':
      return '风险提醒';
    case 'skip':
      return '断点跳过';
    case 'resume':
      return '断点续跑';
    default:
      return stage || '处理中';
  }
}

function buildStatusRibbon(state = {}) {
  if (state.stage === 'reply-list') return '正在深挖回复层，速度慢一点是正常现象';
  if (state.stage === 'comment-list') return '正在扫评论页，画面持续刷新中';
  if (state.stage === 'post-list') return '正在盘点作品池，很快会进入评论抓取';
  if (state.stage === 'image-text-list') return '正在补齐图文稿件池，稍后会和作品流合并';
  if (state.stage === 'danmaku-list') return '正在整理弹幕列表和明细，完成后会进入弹幕入库';
  if (state.stage === 'import') return '抓取产物已落盘，正在做字段映射、写入和数据库校验';
  if (state.stage === 'preflight') return '正在提前检查环境、登录态和数据库条件';
  return '系统正在稳定推进抓取流程';
}

function emitTaskEventFromState(state = {}, message, kind = 'progress', extraDetail = {}) {
  if (process.env.OPENCLI_TASK_EVENTS !== 'jsonl') return;
  const eventStep = kind && kind !== 'progress' ? kind : (state.stage || kind);
  const phaseLabel = state.phaseLabel && kind === 'progress' ? state.phaseLabel : stageToLabel(eventStep);
  const event = {
    type: kind,
    status: kind === 'error' ? 'warning' : 'running',
    step: eventStep,
    message,
    detail: {
      phase_label: phaseLabel,
      status_ribbon: state.statusRibbon || buildStatusRibbon(state),
      current_work: state.currentWork || '',
      current_work_index: state.currentWorkIndex || 0,
      total_works: state.totalWorks || 0,
      works_completed: state.worksCompleted || 0,
      works_failed: state.worksFailed || 0,
      skipped_works: state.skippedWorks || 0,
      total_comments: state.totalComments || 0,
      total_replies: state.totalReplies || 0,
      current_work_top_level: state.currentWorkTopLevel || 0,
      current_work_replies: state.currentWorkReplies || 0,
      current_work_page: state.currentWorkPage || 0,
      current_reply_page: state.currentReplyPage || 0,
      api_calls: state.apiCalls || 0,
      ...extraDetail,
    },
  };
  console.error(`${TASK_EVENT_PREFIX}${JSON.stringify(event)}`);
}

function queueTaskEvent(state, message, kind = 'progress', extraDetail = {}) {
  state.phaseLabel = stageToLabel(kind && kind !== 'progress' ? kind : state.stage);
  state.statusRibbon = buildStatusRibbon(state);
  state.lastEventAt = Date.now();
  emitTaskEventFromState(state, message, kind, extraDetail);
}

function queueTaskEventBurst(state, messages, kind = 'progress', extraDetail = {}) {
  for (const message of messages) {
    queueTaskEvent(state, message, kind, extraDetail);
  }
}

function applyProgressEvent(state, event) {
  const next = state;
  next.stage = event.stage || next.stage;
  next.phaseLabel = stageToLabel(next.stage);
  next.statusRibbon = buildStatusRibbon(next);
  if (event.type === 'api-request') next.apiCalls += 1;
  if (event.type === 'comment-item') next.totalComments += 1;
  if (event.type === 'comment-page') next.currentWorkPage = Number(event.pageNumber || next.currentWorkPage || 0);
  if (event.type === 'reply-page') next.currentReplyPage = Number(event.pageNumber || next.currentReplyPage || 0);
  if (event.type === 'reply-progress') next.currentReplyPage = Number(event.pageNumber || next.currentReplyPage || 0);
  if (event.type === 'comment-item') next.currentWorkTopLevel = Number(event.accumulatedTopLevel || next.currentWorkTopLevel || 0);
  if (event.type === 'reply-progress') next.currentWorkReplies = Number(event.accumulatedReplies || next.currentWorkReplies || 0);
  if (event.type === 'comments-complete') {
    next.currentWorkTopLevel = Number(event.totalTopLevel || 0);
    next.currentWorkReplies = Number(event.totalReplies || 0);
  }
  if (event.type === 'comments-complete') {
    next.totalReplies += Number(event.totalReplies || 0);
  }
  queueTaskEventBurst(next, describeProgressEventBurst(event), event.type === 'api-error' ? 'error' : 'progress');
  return next;
}

export function deriveArtifacts(works, commentsByObjectId, failures = {}) {
  const index = works.map((video) => {
    const comments = commentsByObjectId[video.object_id];
    const status = failures[video.object_id] ? 'failed' : comments ? 'done' : 'pending';
    return {
      title: video.title,
      object_id: video.object_id,
      content_type: contentKindOf(video),
      file_type: contentKindOf(video) === 'image_text' ? 2 : (Number(video.file_type) || 1),
      publish_timestamp: video.publish_timestamp ?? '',
      publish_time: video.publish_time,
      fav_count: video.fav_count ?? '',
      comment_count: video.comment_count,
      comments_file: commentsFilenameFor(video.object_id),
      comments_status: status,
      ...(failures[video.object_id] ? { error: failures[video.object_id] } : {}),
    };
  });

  const harvest = works.map((video, indexValue) => {
    const comments = commentsByObjectId[video.object_id] ?? [];
    return {
      ...video,
      rank: indexValue + 1,
      fetched_comment_count: comments.length,
      comments_status: failures[video.object_id] ? 'failed' : commentsByObjectId[video.object_id] ? 'done' : 'pending',
      ...(failures[video.object_id] ? { error: failures[video.object_id] } : {}),
      comments,
    };
  });

  const flat = harvest.flatMap((video) => video.comments.map((comment) => ({
    video_rank: video.rank,
    video_title: video.title,
    video_object_id: video.object_id,
    video_cover_url: video.cover_url,
    video_publish_timestamp: video.publish_timestamp ?? '',
    video_publish_time: video.publish_time,
    video_fav_count: video.fav_count ?? '',
    video_comment_count: video.comment_count,
    fetched_comment_count: video.fetched_comment_count,
    comment_rank: comment.rank,
    comment_id: comment.comment_id,
    parent_comment_id: comment.parent_comment_id,
    root_comment_id: comment.root_comment_id,
    author: comment.author,
    avatar_url: comment.avatar_url,
    reply_to: comment.reply_to,
    text: comment.text,
    like_count: comment.like_count,
    reply_count: comment.reply_count,
    is_reply: comment.is_reply,
    visible_flag: comment.visible_flag,
    comment_timestamp: comment.comment_timestamp ?? '',
    comment_time: comment.time,
  })));

  const merged = harvest.flatMap((video) => video.comments.map((comment) => ({
    video_title: video.title,
    video_object_id: video.object_id,
    video_publish_timestamp: video.publish_timestamp ?? '',
    video_publish_time: video.publish_time,
    video_fav_count: video.fav_count ?? '',
    video_comment_count: video.comment_count,
    comment_rank: comment.rank,
    comment_id: comment.comment_id,
    parent_comment_id: comment.parent_comment_id,
    root_comment_id: comment.root_comment_id,
    author: comment.author,
    reply_to: comment.reply_to,
    text: comment.text,
    like_count: comment.like_count,
    reply_count: comment.reply_count,
    is_reply: comment.is_reply,
    visible_flag: comment.visible_flag,
    comment_timestamp: comment.comment_timestamp ?? '',
    comment_time: comment.time,
  })));

  return { index, harvest, flat, merged };
}

function applyContentOnlyMode(options) {
  options.contentOnly = true;
  options.importScrm = false;
  options.importScrmApply = false;
  options.importScrmMessage = false;
  options.importScrmMessageApply = false;
  options.importScrmDanmaku = false;
  options.importScrmDanmakuApply = false;
  options.includePrivateMessages = false;
  options.includeDanmaku = false;
}

export function parseArgs(argv) {
  const options = {
    date: formatShanghaiDate(),
    outputDir: '',
    opencliDir: DEFAULT_OPENCLI_DIR,
    userAdapterDir: DEFAULT_USER_ADAPTER_DIR,
    timeoutSeconds: 1800,
    postsTimeoutSeconds: 300,
    commentsTimeoutSeconds: 900,
    limit: 0,
    postLimit: 0,
    imageTextLimit: 0,
    workLimit: 0,
    commentLimit: 0,
    skipImageTextList: false,
    refresh: false,
    stopOnError: false,
    importScrm: true,
    importScrmApply: true,
    importScrmMessage: true,
    importScrmMessageApply: true,
    importScrmDanmaku: true,
    importScrmDanmakuApply: true,
    includePrivateMessages: true,
    includeDanmaku: true,
    contentOnly: false,
    allowPartialImport: false,
    skipPreflight: false,
    skipStartupPreflight: false,
    metadataOnly: false,
    workIdsFile: '',
    full: false,
    batchSize: 50,
    maxItems: 0,
    resume: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const longTaskIndex = parseLongTaskFlag(argv, i, options);
    if (longTaskIndex >= i) {
      i = longTaskIndex;
      continue;
    }
    if (arg === '--date') options.date = argv[++i];
    else if (arg === '--output-dir') options.outputDir = argv[++i];
    else if (arg === '--opencli-dir') options.opencliDir = argv[++i];
    else if (arg === '--user-adapter-dir') options.userAdapterDir = argv[++i];
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++i] || options.timeoutSeconds);
    else if (arg === '--posts-timeout') options.postsTimeoutSeconds = Number(argv[++i] || options.postsTimeoutSeconds);
    else if (arg === '--comments-timeout') options.commentsTimeoutSeconds = Number(argv[++i] || options.commentsTimeoutSeconds);
    else if (arg === '--limit') {
      options.limit = parseNonNegativeInt(argv[++i], 0);
      options.workLimit = options.limit;
    }
    else if (arg === '--post-limit') options.postLimit = parseNonNegativeInt(argv[++i], 0);
    else if (arg === '--image-text-limit') options.imageTextLimit = parseNonNegativeInt(argv[++i], 0);
    else if (arg === '--work-limit') options.workLimit = parseNonNegativeInt(argv[++i], 0);
    else if (arg === '--comment-limit') options.commentLimit = parseNonNegativeInt(argv[++i], 0);
    else if (arg === '--account') i += 1;
    else if (arg === '--skip-image-text-list') options.skipImageTextList = true;
    else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--stop-on-error') options.stopOnError = true;
    else if (arg === '--detailed-mode' || arg === '--verbose-ui') {
      throw new Error('--detailed-mode has been removed. Use node scripts/task-runner.js run --display detailed ... for the unified detailed display.');
    }
    else if (arg === '--import-scrm') {
      options.importScrm = true;
      options.importScrmApply = false;
    }
    else if (arg === '--import-scrm-apply') {
      options.importScrm = true;
      options.importScrmApply = true;
    }
    else if (arg === '--no-import-scrm') {
      options.importScrm = false;
      options.importScrmApply = false;
    }
    else if (arg === '--import-scrm-message') {
      options.importScrmMessage = true;
      options.importScrmMessageApply = false;
    }
    else if (arg === '--import-scrm-message-apply') {
      options.importScrmMessage = true;
      options.importScrmMessageApply = true;
    }
    else if (arg === '--no-import-scrm-message') {
      options.importScrmMessage = false;
      options.importScrmMessageApply = false;
    }
    else if (arg === '--import-scrm-danmaku') {
      options.importScrmDanmaku = true;
      options.importScrmDanmakuApply = false;
    }
    else if (arg === '--import-scrm-danmaku-apply') {
      options.importScrmDanmaku = true;
      options.importScrmDanmakuApply = true;
    }
    else if (arg === '--no-import-scrm-danmaku') {
      options.importScrmDanmaku = false;
      options.importScrmDanmakuApply = false;
    }
    else if (arg === '--skip-private-messages') {
      options.includePrivateMessages = false;
      options.importScrmMessage = false;
      options.importScrmMessageApply = false;
    }
    else if (arg === '--skip-danmaku') {
      options.includeDanmaku = false;
      options.importScrmDanmaku = false;
      options.importScrmDanmakuApply = false;
    }
    else if (arg === '--content-only') {
      applyContentOnlyMode(options);
    }
    else if (arg === '--allow-partial-import') options.allowPartialImport = true;
    else if (arg === '--skip-preflight') options.skipPreflight = true;
    else if (arg === '--skip-startup-preflight') options.skipStartupPreflight = true;
    else if (arg === '--metadata-only') options.metadataOnly = true;
    else if (arg === '--work-ids-file') options.workIdsFile = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.metadataOnly) {
    options.importScrm = false;
    options.importScrmApply = false;
    options.importScrmMessage = false;
    options.importScrmMessageApply = false;
    options.importScrmDanmaku = false;
    options.importScrmDanmakuApply = false;
    options.includePrivateMessages = false;
    options.includeDanmaku = false;
  }
  if (options.contentOnly) {
    applyContentOnlyMode(options);
  } else {
    if (options.importScrmMessage) options.includePrivateMessages = true;
    if (options.importScrmDanmaku) options.includeDanmaku = true;
  }

  Object.assign(options, normalizeLongTaskOptions(options));
  return options;
}

export function printHelp() {
  console.log(`Usage: node scripts/resume-weixin-channels.js [options]

Incrementally fetch weixin-channels posts, optional image-text enhancements, comments and replies into a dated samples directory.

Options:
  --date YYYY-MM-DD          Output date folder in Asia/Shanghai, default today
  --output-dir PATH          Override output directory
  --opencli-dir PATH         OpenCLI package/workspace directory
  --user-adapter-dir PATH    Runtime adapter directory, default ~/.opencli/clis/weixin-channels
  --limit N                  Alias for --work-limit
  --post-limit N             Process up to N primary post-stream rows before merging the work queue
  --image-text-limit N       Process up to N image-text enhancement rows before merging the work queue
  --work-limit N             Process up to N merged works after the post stream and image-text enhancements are combined
  --comment-limit N          Fetch up to N top-level comments per work, default all
  --full                     Explicit full harvest mode with checkpointing
  --batch-size N             Full-mode batch size, default 50
  --max-items N              Full-mode safety cap, default unlimited
  --no-resume                Ignore existing checkpoint in full mode
  --skip-image-text-list     Skip the separate image-text enhancement list; continue from the primary post stream
  --refresh                  Re-fetch posts.json, image-texts.json and all comment files
  --posts-timeout SECONDS    Timeout for the primary post-stream command, default 300
  --comments-timeout SECONDS Timeout for each comments command, default 900
  --stop-on-error            Exit immediately on the first comment-fetch failure
  --content-only             Only update works, comments and replies; skip SCRM import, private messages and danmaku
  --skip-private-messages    Skip the final private-message export/import step
  --skip-danmaku             Skip the final danmaku export/import step
  --metadata-only            Only fetch and write posts/image-texts/works metadata; skip per-work comments and imports
  --work-ids-file PATH       Only process works whose object_id appears in this JSON file
  --import-scrm              Downgrade the default SCRM file/comment apply to dry-run
  --import-scrm-apply        Run the SCRM file/comment importer and write into MySQL (default)
  --no-import-scrm           Skip SCRM file/comment import
  --import-scrm-message      Downgrade the default private-message apply to dry-run
  --import-scrm-message-apply
                             Export private-messages-flat.json and write into scrm_message (default)
  --no-import-scrm-message   Export private-messages-flat.json but skip scrm_message import
  --import-scrm-danmaku      Downgrade the default danmaku apply to dry-run
  --import-scrm-danmaku-apply
                             Export danmaku-flat.json and write into scrm_danmaku (default)
  --no-import-scrm-danmaku   Export danmaku-flat.json but skip scrm_danmaku import
  --allow-partial-import     Allow --import-scrm-apply even when some works failed
  --skip-preflight           Skip the lightweight login/API checks before fresh harvest
  --skip-startup-preflight   Skip local/SCRM config and schema checks before the main flow
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function resolveWeixinOutputDir(options) {
  if (!options.outputDir) return path.join(DEFAULT_OUTPUT_BASE, options.date);
  if (samePath(options.outputDir, DEFAULT_OUTPUT_BASE)) {
    return path.join(DEFAULT_OUTPUT_BASE, options.date);
  }
  return options.outputDir;
}

function syncCurrentAdapter(destDir) {
  ensureDir(path.dirname(destDir));
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT_DIR, 'adapters', 'weixin-channels'), destDir, { recursive: true });
}

function opencliEntryFor(opencliDir) {
  if (!opencliDir) return '';
  return path.join(opencliDir, 'dist', 'src', 'main.js');
}

function hasLocalOpenCliBuild(opencliDir) {
  const entry = opencliEntryFor(opencliDir);
  return Boolean(entry) && fs.existsSync(entry);
}

function resolveOpenCliCommand() {
  return 'opencli';
}

export function buildWeixinSourceListArgs(command, options = {}) {
  const args = ['weixin-channels', command];
  const limit = Number(options.limit || 0);
  if (limit > 0) args.push('--limit', String(limit));
  else args.push('--all');
  if (options.full) args.push('--page', String(Math.max(1, Number(options.page || 1) || 1)));
  args.push('-f', 'json');
  return args;
}

export function appendMissingArgs(argv = [], additions = []) {
  const next = [...argv];
  for (const arg of additions) {
    if (!next.includes(arg)) next.push(arg);
  }
  return next;
}

export function removeFlag(argv = [], flag = '') {
  return argv.filter((arg) => arg !== flag);
}

export function mergeWorksByObjectId(existing = [], incoming = []) {
  const byObjectId = new Map();
  for (const item of existing) {
    const key = String(item?.object_id || '').trim();
    if (key) byObjectId.set(key, item);
  }
  for (const item of incoming) {
    const key = String(item?.object_id || '').trim();
    if (key) byObjectId.set(key, { ...(byObjectId.get(key) || {}), ...item });
  }
  return Array.from(byObjectId.values())
    .sort((left, right) => publishTimestampNumber(right) - publishTimestampNumber(left));
}

function windowsCmdQuote(value) {
  const text = String(value ?? '');
  if (!text) return '""';
  return `"${text.replace(/"/g, '""')}"`;
}

function createChunkDecoder(preferGbk = false) {
  const utf8 = new TextDecoder('utf-8', { fatal: false });
  const gbk = preferGbk ? new TextDecoder('gbk', { fatal: false }) : null;
  return {
    decode(chunk) {
      if (!preferGbk) return utf8.decode(chunk, { stream: true });
      const gbkText = gbk.decode(chunk, { stream: true });
      const badCount = (gbkText.match(/\uFFFD/g) || []).length;
      if (badCount === 0) return gbkText;
      return utf8.decode(chunk, { stream: true });
    },
    flush() {
      if (!preferGbk) return utf8.decode();
      const gbkTail = gbk.decode();
      if (gbkTail && !gbkTail.includes('\uFFFD')) return gbkTail;
      return utf8.decode();
    },
  };
}

function quarantineBadJson(filePath) {
  const badPath = `${filePath}.bad-${Date.now()}`;
  fs.renameSync(filePath, badPath);
  return badPath;
}

function readJsonIfExists(filePath, warnings = []) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const badPath = quarantineBadJson(filePath);
    warnings.push(`JSON 文件损坏，已隔离为 ${badPath}，本轮会重新生成：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parsePrefixedJsonLine(text, prefix) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(prefix));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(prefix.length).trim());
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function collectWorkIds(value, ids = new Set()) {
  if (!value) return ids;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) ids.add(text);
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkIds(item, ids);
    return ids;
  }
  if (typeof value === 'object') {
    for (const key of ['object_id', 'objectId', 'work_no', 'workNo', 'id']) {
      if (value[key]) collectWorkIds(value[key], ids);
    }
    for (const key of ['work_ids', 'workIds', 'changed_work_ids', 'changedWorkIds', 'works', 'changed_works', 'changedWorks']) {
      if (value[key]) collectWorkIds(value[key], ids);
    }
  }
  return ids;
}

function loadWorkIdFilter(filePath = '') {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--work-ids-file not found: ${resolved}`);
  }
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const ids = collectWorkIds(data);
  return {
    file: resolved,
    ids,
  };
}

function buildPrivateMessagesReport(privateMessages = null, options = {}) {
  const base = {
    enabled: Boolean(options.includePrivateMessages),
    status: options.includePrivateMessages ? 'pending' : 'skipped',
    exported_rows: 0,
    import_requested: Boolean(options.importScrmMessage),
    apply_requested: Boolean(options.importScrmMessageApply),
    import_mode: options.importScrmMessage ? (options.importScrmMessageApply ? 'apply' : 'dry-run') : 'none',
    import_payload_rows: 0,
    write_attempt_rows: 0,
    matched_current_payload_rows: 0,
    output_file: '',
    error: '',
  };
  return {
    ...base,
    ...(privateMessages || {}),
  };
}

function buildDanmakuReport(danmaku = null, options = {}) {
  const base = {
    enabled: Boolean(options.includeDanmaku),
    status: options.includeDanmaku ? 'pending' : 'skipped',
    exported_rows: 0,
    danmaku_rows: 0,
    import_requested: Boolean(options.importScrmDanmaku),
    apply_requested: Boolean(options.importScrmDanmakuApply),
    import_mode: options.importScrmDanmaku
      ? (options.importScrmDanmakuApply ? 'apply' : 'dry-run')
      : 'none',
    import_payload_rows: 0,
    write_attempt_rows: 0,
    matched_current_payload_rows: 0,
    output_file: '',
    error: '',
  };
  return {
    ...base,
    ...(danmaku || {}),
  };
}

function detailedImportLines(kind, importSummary = {}, importVerification = {}, apply = false) {
  const verification = importVerification?.verification || {};
  if (kind === 'file-comment') {
    const workRows = Number(importSummary?.work_rows || 0);
    const commentRows = Number(importSummary?.comment_rows || 0);
    const matchedWorks = Number(verification?.matched_current_payload_rows?.works || 0);
    const matchedComments = Number(verification?.matched_current_payload_rows?.comments || 0);
    const modeText = apply ? '正式入库完成' : '入库预演完成';
    return [
      `作品和评论${modeText}：本轮 ${workRows} 篇作品、${commentRows} 条评论。`,
      apply
        ? `数据库校验通过：已匹配 ${matchedWorks}/${workRows} 篇作品、${matchedComments}/${commentRows} 条评论。`
        : '本轮没有写入数据库，只完成字段和行数预检。',
    ];
  }
  if (kind === 'private-message') {
    const payloadRows = Number(importSummary?.message_rows || 0);
    const writeRows = Number(importSummary?.write_attempt_rows || 0);
    const matchedRows = Number(verification?.matched_current_payload_rows || 0);
    const modeText = apply ? '正式入库完成' : '入库预演完成';
    return [
      `私信${modeText}：本轮识别 ${payloadRows} 条入站消息，准备写入 ${writeRows} 条。`,
      apply
        ? `私信数据库校验通过：已匹配 ${matchedRows}/${writeRows} 条消息。`
        : '本轮没有写入数据库，只完成私信字段和行数预检。',
    ];
  }
  if (kind === 'danmaku') {
    const payloadRows = Number(importSummary?.danmaku_rows ?? 0);
    const writeRows = Number(importSummary?.write_attempt_rows || 0);
    const matchedRows = Number(importVerification?.matched_rows || importVerification?.verification?.matched_rows || 0);
    const modeText = apply ? '正式入库完成' : '入库预演完成';
    return [
      `弹幕${modeText}：本轮识别 ${payloadRows} 条弹幕，准备写入 ${writeRows} 条。`,
      apply
        ? `弹幕数据库校验通过：已匹配 ${matchedRows}/${writeRows} 条弹幕。`
        : '本轮没有写入数据库，只完成弹幕字段和行数预检。',
    ];
  }
  return [];
}

function finalSummaryLines({ works = [], commentsByObjectId = {}, failures = {}, privateMessages = null, danmaku = null, options = {} }) {
  const failedCount = Object.keys(failures).length;
  const completedCount = Object.keys(commentsByObjectId).length;
  const imageTextCount = works.filter((work) => contentKindOf(work) === 'image_text').length;
  const videoCount = works.length - imageTextCount;
  const topLevelComments = Object.values(commentsByObjectId)
    .reduce((sum, rows) => sum + countTopLevelComments(rows), 0);
  const replyComments = Object.values(commentsByObjectId)
    .reduce((sum, rows) => sum + countReplyComments(rows), 0);
  const privateReport = buildPrivateMessagesReport(privateMessages, options);
  const danmakuReport = buildDanmakuReport(danmaku, options);
  const lines = [
    '本轮完成，成果汇总：',
    `稿件：共 ${works.length} 篇，成功 ${works.length - failedCount} 篇，失败 ${failedCount} 篇；其中视频 ${videoCount} 篇，图文 ${imageTextCount} 篇。`,
    `评论：一级评论 ${topLevelComments} 条，回复 ${replyComments} 条，合计 ${topLevelComments + replyComments} 条。`,
  ];
  lines.push(privateReport.enabled
    ? `私信：导出 ${privateReport.exported_rows} 条，入库准备 ${privateReport.write_attempt_rows} 条，数据库匹配 ${privateReport.matched_current_payload_rows} 条。`
    : '私信：本轮未执行。');
  lines.push(danmakuReport.enabled
    ? `弹幕：导出 ${danmakuReport.exported_rows} 条，入库准备 ${danmakuReport.write_attempt_rows} 条，数据库匹配 ${danmakuReport.matched_current_payload_rows} 条。`
    : '弹幕：本轮未执行。');
  lines.push(failedCount === 0
    ? `状态：全部流程完成，${completedCount}/${works.length} 篇稿件已有完整评论文件。`
    : `状态：有 ${failedCount} 篇稿件失败，详细原因已写入 run-report.json。`);
  return lines;
}

function recoveryCommand(options = {}, extraArgs = []) {
  const args = ['node scripts/resume-weixin-channels.js'];
  const passthrough = [];
  if (options.date) {
    passthrough.push('--date', options.date);
  }
  if (options.outputDir) {
    passthrough.push('--output-dir', options.outputDir);
  }
  if (options.workLimit > 0) {
    passthrough.push('--work-limit', String(options.workLimit));
  }
  if (options.postLimit > 0) {
    passthrough.push('--post-limit', String(options.postLimit));
  }
  if (options.imageTextLimit > 0) {
    passthrough.push('--image-text-limit', String(options.imageTextLimit));
  }
  if (options.commentLimit > 0) {
    passthrough.push('--comment-limit', String(options.commentLimit));
  }
  if (options.skipImageTextList) passthrough.push('--skip-image-text-list');
  if (options.contentOnly) {
    passthrough.push('--content-only');
  } else {
    if (!options.includePrivateMessages) passthrough.push('--skip-private-messages');
    if (!options.includeDanmaku) passthrough.push('--skip-danmaku');
    if (!options.importScrm) passthrough.push('--no-import-scrm');
    if (options.includePrivateMessages && !options.importScrmMessage) passthrough.push('--no-import-scrm-message');
    if (options.includeDanmaku && !options.importScrmDanmaku) passthrough.push('--no-import-scrm-danmaku');
  }
  passthrough.push(...extraArgs);
  return passthrough.length > 0 ? `${args[0]} ${passthrough.join(' ')}` : args[0];
}

function buildFailureRecovery({ works = [], failures = {}, preflight = null, startupPreflight = null, privateMessages = null, danmaku = null, warnings = [], options = {} }) {
  const failedWorks = works
    .filter((work) => failures[work.object_id])
    .map((work) => ({
      object_id: work.object_id,
      title: work.title || '',
      error: failures[work.object_id],
      recovery: '修复错误后重新运行同一命令；已有 comments 文件会自动跳过，失败稿件会被重新抓取。需要强制全量重抓时增加 --refresh。',
    }));
  const steps = [];
  const commands = [];
  const startupFailed = startupPreflight?.status === 'failed';
  const apiPreflightFailed = preflight?.status === 'failed';
  const privateFailed = privateMessages?.status === 'failed';
  const danmakuFailed = danmaku?.status === 'failed';
  const scrmImportFailed = warnings.some((warning) => String(warning).includes('SCRM 导入阶段失败'));

  if (startupFailed) {
    steps.push('先修复启动前预检失败项，通常是数据库配置、连接权限或 SCRM 唯一索引/字段缺失；这一步发生在抓取前，不会产生部分入库。');
    commands.push(recoveryCommand(options));
  }
  if (apiPreflightFailed) {
    steps.push('先确认微信视频号后台登录态和接口权限；修复后重新运行同一命令。确认接口可用但只想跳过轻量 API 检查时，可增加 --skip-preflight。');
    commands.push(recoveryCommand(options));
  }
  if (failedWorks.length > 0) {
    steps.push(`有 ${failedWorks.length} 篇稿件评论抓取失败；默认会阻止正式 SCRM 入库，避免数据库里混入不完整批次。`);
    steps.push('修复网络/登录态/接口问题后重新运行同一命令即可断点续跑；确认接受部分入库时再增加 --allow-partial-import。');
    commands.push(recoveryCommand(options));
    commands.push(recoveryCommand(options, ['--refresh']));
  }
  if (scrmImportFailed) {
    const harvestPath = path.join(options.outputDir || path.join(DEFAULT_OUTPUT_BASE, options.date), 'harvest.json');
    steps.push('作品/评论抓取产物已经保留，失败只在 SCRM 导入阶段；修复数据库或字段问题后可单独重试导入。');
    commands.push(`node scripts/import-to-scrm.js --platform weixin-channels --input ${harvestPath} --apply`);
  }
  if (privateFailed) {
    steps.push('私信失败发生在主流程最后一步，不影响已完成的作品/评论产物；修复私信接口或 scrm_message 表结构后重跑主流程或单独重试私信入库。');
    if (privateMessages.output_file) {
      commands.push(`node scripts/import-private-messages-to-scrm-message.js --input ${privateMessages.output_file} --apply`);
    } else {
      commands.push(recoveryCommand(options));
    }
  }
  if (danmakuFailed) {
    steps.push('弹幕失败发生在主流程最后一步，不影响已完成的作品/评论产物；修复弹幕页面或 scrm_danmaku 表结构后重跑主流程或单独重试弹幕入库。');
    if (danmaku.output_file) {
      commands.push(`node scripts/import-danmaku-to-scrm.js --input ${danmaku.output_file} --apply`);
    } else {
      commands.push(recoveryCommand(options));
    }
  }

  return {
    has_blockers: steps.length > 0,
    resume_safe: true,
    failed_works: failedWorks,
    next_steps: Array.from(new Set(steps)),
    commands: Array.from(new Set(commands)),
  };
}

export function buildRunReport(works, commentsByObjectId, failures = {}, posts = [], imageTexts = [], warnings = [], preflight = null, options = {}, privateMessages = null, danmaku = null, commentDiagnosticsByObjectId = {}) {
  const workReports = works.map((work) => {
    const comments = commentsByObjectId[work.object_id];
    const diagnostics = commentDiagnosticsByObjectId[work.object_id] || {};
    const topLevelComments = countTopLevelComments(comments);
    const replyComments = countReplyComments(comments);
    const filteredSelfTopLevelComments = Number(diagnostics.summary?.filtered_self_top_level_comments || 0);
    const filteredSelfReplyComments = Number(diagnostics.summary?.filtered_self_reply_comments || 0);
    const expectedTopLevel = Number(work.comment_count);
    const hasExpectedTopLevel = Number.isFinite(expectedTopLevel) && expectedTopLevel >= 0;
    const failed = Boolean(failures[work.object_id]);
    const completed = Array.isArray(comments);
    const topLevelCommentCountMatched = hasExpectedTopLevel && completed ? expectedTopLevel === topLevelComments : null;
    return {
      object_id: work.object_id,
      title: work.title,
      content_type: contentKindOf(work),
      file_type: contentKindOf(work) === 'image_text' ? 2 : 1,
      status: failed ? 'failed' : (completed ? 'done' : 'pending'),
      expected_top_level_comments: hasExpectedTopLevel ? expectedTopLevel : null,
      fetched_top_level_comments: completed ? topLevelComments : 0,
      fetched_reply_comments: completed ? replyComments : 0,
      fetched_total_comment_rows: completed ? comments.length : 0,
      filtered_self_top_level_comments: filteredSelfTopLevelComments,
      filtered_self_reply_comments: filteredSelfReplyComments,
      filtered_self_total_comment_rows: filteredSelfTopLevelComments + filteredSelfReplyComments,
      top_level_comment_count_matched: topLevelCommentCountMatched,
      comment_count_matched: topLevelCommentCountMatched,
      comment_match_basis: 'top_level_comments_only',
      comment_diagnostics_file: commentsDebugFilenameFor(work.object_id),
      ...(failed ? { error: failures[work.object_id] } : {}),
    };
  });
  const failedCount = Object.keys(failures).length;
  const completedCount = Object.keys(commentsByObjectId).length;
  const privateMessagesReport = buildPrivateMessagesReport(privateMessages, options);
  const danmakuReport = buildDanmakuReport(danmaku, options);
  const harvestStatus = failedCount > 0 ? 'partial' : (completedCount === works.length ? 'complete' : 'in_progress');
  const startupFailed = options.startupPreflight?.status === 'failed';
  const apiPreflightFailed = preflight?.status === 'failed';
  const privateFailed = privateMessagesReport.status === 'failed';
  const danmakuFailed = danmakuReport.status === 'failed';
  const importFailed = warnings.some((warning) => String(warning).includes('SCRM 导入阶段失败'));
  const report = {
    generated_at: new Date().toISOString(),
    output_dir: options.outputDir || '',
    status: startupFailed || apiPreflightFailed || privateFailed || danmakuFailed || importFailed ? 'failed' : harvestStatus,
    harvest_status: harvestStatus,
    totals: {
      posts: posts.length,
      image_texts: imageTexts.length,
      works: works.length,
      completed_works: completedCount,
      failed_works: failedCount,
      pending_works: works.length - completedCount - failedCount,
      fetched_top_level_comments: Object.values(commentsByObjectId).reduce((sum, rows) => sum + countTopLevelComments(rows), 0),
      fetched_reply_comments: Object.values(commentsByObjectId).reduce((sum, rows) => sum + countReplyComments(rows), 0),
      filtered_self_top_level_comments: Object.values(commentDiagnosticsByObjectId).reduce((sum, item) => sum + Number(item?.summary?.filtered_self_top_level_comments || 0), 0),
      filtered_self_reply_comments: Object.values(commentDiagnosticsByObjectId).reduce((sum, item) => sum + Number(item?.summary?.filtered_self_reply_comments || 0), 0),
    },
    import_gate: {
      import_scrm_requested: Boolean(options.importScrm),
      import_scrm_apply_requested: Boolean(options.importScrmApply),
      allow_partial_import: Boolean(options.allowPartialImport),
      scrm_apply_allowed: !options.importScrmApply || failedCount === 0 || Boolean(options.allowPartialImport),
      reason: options.importScrmApply && failedCount > 0 && !options.allowPartialImport
        ? '有稿件抓取失败，默认阻止正式写入 SCRM；如确认接受部分入库，请显式增加 --allow-partial-import'
        : '',
    },
    startup_preflight: options.startupPreflight || null,
    private_messages: privateMessagesReport,
    danmaku: danmakuReport,
    warnings,
    preflight,
    works: workReports,
  };
  report.failure_recovery = buildFailureRecovery({
    works,
    failures,
    preflight,
    startupPreflight: options.startupPreflight || null,
    privateMessages: privateMessagesReport,
    danmaku: danmakuReport,
    warnings,
    options,
  });
  return report;
}

export function buildWorkIndexRows(posts = [], imageTexts = [], works = []) {
  const merged = mergeContentItems(
    Array.isArray(posts) ? posts : [],
    Array.isArray(imageTexts) ? imageTexts : [],
  );
  const fallbackWorks = Array.isArray(works) ? works : [];
  const source = merged.length ? merged : fallbackWorks;
  return source.map((row, index) => ({
    row_rank: index + 1,
    object_id: String(row.object_id || ''),
    title: String(row.title || ''),
    content_type: contentKindOf(row),
    file_type: Number(row.file_type || (contentKindOf(row) === 'image_text' ? 2 : 1)) || 1,
    publish_timestamp: String(row.publish_timestamp || ''),
    publish_time: String(row.publish_time || ''),
    cover_url: String(row.cover_url || ''),
    duration: Number(row.duration || 0) || 0,
  })).filter((row) => row.object_id && row.title);
}

function writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts = [], imageTexts = [], warnings = [], preflight = null, options = {}, privateMessages = null, danmaku = null, commentDiagnosticsByObjectId = {}) {
  const { index: indexRows, harvest, flat, merged } = deriveArtifacts(works, commentsByObjectId, failures);
  const workIndexRows = buildWorkIndexRows(posts, imageTexts, works);
  writeJson(path.join(outputDir, 'index.json'), indexRows);
  writeJson(path.join(outputDir, 'work-index.json'), workIndexRows);
  writeJson(path.join(outputDir, 'harvest.json'), harvest);
  writeJson(path.join(outputDir, 'harvest-comments.json'), flat);
  writeJson(path.join(outputDir, 'merged.json'), merged);
  writeJson(path.join(outputDir, 'progress.json'), {
    generated_at: new Date().toISOString(),
    total_works: works.length,
    total_posts: posts.length,
    total_image_texts: imageTexts.length,
    completed_works: Object.keys(commentsByObjectId).length,
    completed_video_works: works.filter((item) => contentKindOf(item) === 'video' && commentsByObjectId[item.object_id]).length,
    completed_image_texts: works.filter((item) => contentKindOf(item) === 'image_text' && commentsByObjectId[item.object_id]).length,
    failed_works: Object.keys(failures).length,
    remaining_works: works.length - Object.keys(commentsByObjectId).length - Object.keys(failures).length,
    failures,
    warnings,
  });
  writeJson(path.join(outputDir, RUN_REPORT_FILE), buildRunReport(
    works,
    commentsByObjectId,
    failures,
    posts,
    imageTexts,
    warnings,
    preflight,
    options,
    privateMessages,
    danmaku,
    commentDiagnosticsByObjectId,
  ));
}

function parseProgressLine(line) {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  try {
    return JSON.parse(line.slice(PROGRESS_PREFIX.length));
  } catch {
    return null;
  }
}

async function runOpenCli(opencliDir, args, timeoutSeconds, options = {}) {
  const hasLocalBuild = hasLocalOpenCliBuild(opencliDir);
  const useWindowsInstalledOpencli = process.platform === 'win32' && !hasLocalBuild;
  const command = hasLocalBuild ? process.execPath : resolveOpenCliCommand();
  const commandArgs = hasLocalBuild ? [RUN_OPENCLI_SCRIPT, opencliEntryFor(opencliDir), ...args] : args;
  const spawnOptions = {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      OPENCLI_BROWSER_COMMAND_TIMEOUT: String(timeoutSeconds),
      ...(options.progressEvents ? { OPENCLI_PROGRESS_EVENTS: 'jsonl' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(useWindowsInstalledOpencli ? { shell: true } : {}),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, spawnOptions);
    const stdoutDecoder = createChunkDecoder(useWindowsInstalledOpencli);
    const stderrDecoder = createChunkDecoder(useWindowsInstalledOpencli);

    let stdout = '';
    let stderr = '';
    let stderrBuffer = '';
    child.stdout.on('data', (chunk) => { stdout += stdoutDecoder.decode(chunk); });
    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.decode(chunk);
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const progressEvent = parseProgressLine(line);
        if (progressEvent) {
          options.onProgress?.(progressEvent);
          continue;
        }
        if (line) options.onStderr?.(line);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      stdout += stdoutDecoder.flush();
      stderr += stderrDecoder.flush();
      const line = stderrBuffer.trim();
      if (line) {
        const progressEvent = parseProgressLine(line);
        if (progressEvent) options.onProgress?.(progressEvent);
        else options.onStderr?.(line);
      }
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const runnerLabel = hasLocalBuild ? `node ${opencliEntryFor(opencliDir)}` : command;
      reject(new Error(`${runnerLabel} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function runNodeScript(scriptPath, args, options = {}) {
  const command = process.execPath;
  return new Promise((resolve, reject) => {
    const child = spawn(command, [scriptPath, ...args], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutDecoder = createChunkDecoder(false);
    const stderrDecoder = createChunkDecoder(false);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = stdoutDecoder.decode(chunk);
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = stderrDecoder.decode(chunk);
      stderr += text;
      options.onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      stdout += stdoutDecoder.flush();
      stderr += stderrDecoder.flush();
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${command} ${scriptPath} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function ensureWeixinAccountProfile(outputDir, options = {}, eventState = null) {
  const accountProfilePath = path.join(outputDir, 'account-profile.json');
  if (fs.existsSync(accountProfilePath)) return accountProfilePath;
  queueTaskEventBurst(eventState, [
    `准备补采当前账号主体信息到 ${accountProfilePath}，后续 scrm_file / scrm_comment / scrm_message / scrm_danmaku 入库都会复用这份账号归属`,
    '这一步只抓当前登录主体信息，不会重复抓作品、评论或私信',
  ], 'account-profile');
  await runNodeScript(
    path.join(ROOT_DIR, 'scripts', 'harvest-weixin-channels-account.js'),
    ['--output-dir', outputDir],
    { env: options.env || {} },
  );
  return accountProfilePath;
}

function loadExistingComments(outputDir, videos, warnings = []) {
  const commentsByObjectId = {};
  for (const video of videos) {
    const file = path.join(outputDir, commentsFilenameFor(video.object_id));
    const rows = readJsonIfExists(file, warnings);
    if (Array.isArray(rows)) commentsByObjectId[video.object_id] = rows;
  }
  return commentsByObjectId;
}

function loadExistingCommentDiagnostics(outputDir, videos, warnings = []) {
  const diagnosticsByObjectId = {};
  for (const video of videos) {
    const file = path.join(outputDir, commentsDebugFilenameFor(video.object_id));
    const data = readJsonIfExists(file, warnings);
    if (data && typeof data === 'object' && !Array.isArray(data)) diagnosticsByObjectId[video.object_id] = data;
  }
  return diagnosticsByObjectId;
}

function createCommentDiagnosticRecord(work = {}, commentsFile = '', debugFile = '') {
  return {
    object_id: String(work.object_id || ''),
    title: String(work.title || ''),
    content_type: contentKindLabel(work),
    comments_file: commentsFile,
    debug_file: debugFile,
    resolved_export_id: '',
    top_level_pages: [],
    reply_pages: [],
    summary: {
      fetched_top_level_comments: 0,
      fetched_reply_comments: 0,
      filtered_self_top_level_comments: 0,
      filtered_self_reply_comments: 0,
      filtered_self_total_comment_rows: 0,
    },
    error: '',
  };
}

function applyCommentDiagnosticEvent(record, event = {}) {
  if (!record || !event || typeof event !== 'object') return record;
  if (event.type === 'comment-detail-resolved' && event.resolvedExportId) {
    record.resolved_export_id = String(event.resolvedExportId);
    return record;
  }
  if (event.type === 'comment-page-diagnostics') {
    record.top_level_pages.push({
      page_number: Number(event.pageNumber || 0),
      received_count: Number(event.receivedCount || 0),
      kept_count: Number(event.keptCount || 0),
      filtered_self_count: Number(event.filteredSelfCount || 0),
      has_more: Boolean(event.hasMore),
      current_cursor: String(event.currentCursor || ''),
      next_cursor: String(event.nextCursor || ''),
      with_replies: Boolean(event.withReplies),
    });
    return record;
  }
  if (event.type === 'reply-page-diagnostics') {
    record.reply_pages.push({
      comment_id: String(event.commentId || ''),
      page_number: Number(event.pageNumber || 0),
      received_count: Number(event.receivedCount || 0),
      kept_count: Number(event.keptCount || 0),
      filtered_self_count: Number(event.filteredSelfCount || 0),
      has_more: Boolean(event.hasMore),
      current_cursor: String(event.currentCursor || ''),
      next_cursor: String(event.nextCursor || ''),
    });
    return record;
  }
  if (event.type === 'comments-complete') {
    record.summary = {
      fetched_top_level_comments: Number(event.totalTopLevel || 0),
      fetched_reply_comments: Number(event.totalReplies || 0),
      filtered_self_top_level_comments: Number(event.filteredSelfTopLevelComments || 0),
      filtered_self_reply_comments: Number(event.filteredSelfReplies || 0),
      filtered_self_total_comment_rows: Number(event.filteredSelfTopLevelComments || 0) + Number(event.filteredSelfReplies || 0),
    };
  }
  return record;
}

function preflightOk(name, extra = {}) {
  return {
    name,
    status: 'ok',
    checked_at: new Date().toISOString(),
    ...extra,
  };
}

function preflightFailed(name, error) {
  return {
    name,
    status: 'failed',
    checked_at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
}

async function runPreflightChecks(options, eventState) {
  const report = {
    enabled: !options.skipPreflight,
    status: 'skipped',
    checks: [],
  };
  if (options.skipPreflight) return report;

  const runCheck = async (name, args, timeoutSeconds) => {
    try {
      const raw = await runOpenCli(options.opencliDir, args, timeoutSeconds, {
        progressEvents: true,
        onProgress(event) {
          applyProgressEvent(eventState, event);
        },
      });
      const rows = JSON.parse(raw);
      const count = Array.isArray(rows) ? rows.length : 0;
      const check = preflightOk(name, { rows: count });
      report.checks.push(check);
      return { rows, check };
    } catch (error) {
      const check = preflightFailed(name, error);
      report.checks.push(check);
      throw error;
    }
  };

  queueTaskEventBurst(eventState, [
    '开始运行 preflight：先用最小请求确认登录态、作品接口和评论接口可用',
    '这个检查会尽早暴露扫码登录、权限失效或后台接口变化，避免长流程跑到一半才失败',
  ], 'preflight');

  const postsResult = await runCheck('posts-api', ['weixin-channels', 'posts', '--limit', '1', '-f', 'json'], Math.min(options.postsTimeoutSeconds, 120));
  const firstWork = Array.isArray(postsResult.rows) ? postsResult.rows.find((row) => row?.object_id) : null;
  if (firstWork?.object_id) {
    await runCheck('comments-api', ['weixin-channels', 'comments', firstWork.object_id, '--limit', '1', '-f', 'json'], Math.min(options.commentsTimeoutSeconds, 180));
  } else {
    report.checks.push({
      name: 'comments-api',
      status: 'skipped',
      checked_at: new Date().toISOString(),
      reason: '作品列表为空，无法选择样本作品检查评论接口',
    });
  }

  report.status = report.checks.some((check) => check.status === 'failed') ? 'failed' : 'ok';
  queueTaskEvent(eventState, `preflight 完成，状态 ${report.status}`, 'preflight');
  return report;
}

async function runStartupPreflight(options, eventState) {
  const report = {
    enabled: !options.skipStartupPreflight,
    status: 'skipped',
    checks: [],
  };
  if (options.skipStartupPreflight) return report;

  const args = [];
  if (options.importScrmApply) args.push('--require-file-comment-db');
  if (options.importScrmMessageApply) args.push('--require-message-db');
  if (options.importScrmDanmakuApply) args.push('--require-danmaku-db');
  if (args.length === 0) {
    report.checks.push({
      name: 'scrm-db',
      status: 'skipped',
      checked_at: new Date().toISOString(),
      reason: '本轮未请求正式写入 SCRM，跳过数据库预检',
    });
    return report;
  }

  queueTaskEventBurst(eventState, [
    '开始运行启动前预检：先确认数据库配置、连接权限和 SCRM 幂等入库索引',
    '这个检查会尽早暴露配置或表结构问题，避免作品评论都抓完后才在导入阶段失败',
  ], 'preflight');

  try {
    const stdout = await runNodeScript(
      path.join(ROOT_DIR, 'scripts', 'preflight-scrm.js'),
      args,
      {},
    );
    const parsed = parsePrefixedJsonLine(stdout, 'SCRM_PREFLIGHT ');
    const preflightReport = parsed || { ...report, status: 'ok' };
    queueTaskEvent(eventState, `启动前预检完成，状态 ${preflightReport.status}`, 'preflight');
    return preflightReport;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const parsed = parsePrefixedJsonLine(message, 'SCRM_PREFLIGHT ');
    const failedReport = parsed || {
      enabled: true,
      status: 'failed',
      checks: [{
        name: 'scrm-startup-preflight',
        status: 'failed',
        checked_at: new Date().toISOString(),
        error: message,
      }],
    };
    queueTaskEventBurst(eventState, [
      `启动前预检失败：${truncateText(message, 160)}`,
      '本轮还没有开始抓取，先修复配置或表结构后再重跑会更干净',
    ], 'error');
    return failedReport;
  }
}

function assertCanApplyScrmImport(options, failedCount) {
  if (!options.importScrmApply || failedCount === 0 || options.allowPartialImport) return;
  throw new Error(`有 ${failedCount} 篇稿件抓取失败，已阻止正式写入 SCRM。确认接受部分入库时，请重新运行并增加 --allow-partial-import。`);
}

async function runWeixinChannelsOnce(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const outputDir = resolveWeixinOutputDir(options);
  options.outputDir = outputDir;
  ensureDir(outputDir);
  const eventState = createEventState();
  const longTask = normalizeLongTaskOptions(options);
  const checkpointFile = checkpointPathFor(outputDir);
  let checkpoint = null;
  eventState.totalWorks = options.workLimit > 0
    ? options.workLimit
    : (options.postLimit > 0 || options.imageTextLimit > 0 ? options.postLimit + options.imageTextLimit : 0);
  queueTaskEventBurst(eventState, [
    `输出目录已经确认到 ${outputDir}，后面的所有过程文件都会落到这里`,
  ], 'system');
  if (longTask.full) {
    if (longTask.refresh || !longTask.resume) resetCheckpoint(checkpointFile);
    checkpoint = longTask.resume ? loadCheckpoint(checkpointFile) : null;
    if (checkpoint) {
      queueTaskEvent(
        eventState,
        `发现上次断点，将从第 ${Number(checkpoint.current_batch || 0) + 1} 批继续`,
        'resume-detected',
        checkpoint,
      );
    } else {
      checkpoint = createCheckpoint({
        platform: 'weixin-channels',
        task: 'creator-content',
        full: true,
        batchSize: longTask.batchSize,
        maxItems: longTask.maxItems,
      });
    }
    if (options.workLimit <= 0) {
      const completedBefore = Number(checkpoint.completed_count || 0);
      const remainingItems = longTask.maxItems > 0 ? Math.max(0, longTask.maxItems - completedBefore) : longTask.batchSize;
      options.workLimit = longTask.maxItems > 0 ? Math.min(longTask.batchSize, remainingItems) : longTask.batchSize;
      eventState.totalWorks = options.workLimit;
    }
    checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    queueTaskEvent(
      eventState,
      `全量采集已启动：每批 ${longTask.batchSize} 个${longTask.maxItems ? `，最多 ${longTask.maxItems} 个` : ''}`,
      'full-start',
      checkpoint,
    );
    queueTaskEvent(
      eventState,
      `第 ${Number(checkpoint.current_batch || 0) + 1} 批开始`,
      'batch-start',
      { ...checkpoint, current_batch: Number(checkpoint.current_batch || 0) + 1 },
    );
  }

  const localOpenCliBuild = hasLocalOpenCliBuild(options.opencliDir);
  if (localOpenCliBuild) {
    syncCurrentAdapter(path.join(options.opencliDir, 'clis', 'weixin-channels'));
  }
  syncCurrentAdapter(options.userAdapterDir);
  queueTaskEventBurst(eventState, [
    ...(localOpenCliBuild
      ? ['适配器代码正在同步到 OpenCLI 工作区，确保真实运行环境吃到的是最新逻辑']
      : ['没有检测到本地 OpenCLI 工作区构建产物，本轮改为直接调用系统里已安装的 opencli']),
    '本地用户运行目录也已经同步完成，后续命令会基于这份最新代码执行',
  ], 'system');

  const postsFile = path.join(outputDir, 'posts.json');
  const imageTextsFile = path.join(outputDir, 'image-texts.json');
  const worksFile = path.join(outputDir, 'works.json');
  const fullWorksFile = path.join(outputDir, 'works-full.json');
  const warnings = [];
  let privateMessages = null;
  let danmaku = null;
  let startupPreflight = {
    enabled: !options.skipStartupPreflight,
    status: 'skipped',
    checks: [],
  };
  options.startupPreflight = startupPreflight;
  let preflight = {
    enabled: !options.skipPreflight,
    status: 'skipped',
    checks: [],
  };
  const postListLimit = options.postLimit > 0 ? options.postLimit : options.workLimit;
  const imageTextListLimit = options.imageTextLimit > 0 ? options.imageTextLimit : options.workLimit;
  const fullPostPage = Math.max(1, Number(checkpointCursor(checkpoint, 'posts_page', 1)) || 1);
  const fullImageTextPage = Math.max(1, Number(checkpointCursor(checkpoint, 'image_text_page', 1)) || 1);
  const fullPostsHasMore = checkpointCursor(checkpoint, 'posts_has_more', true) !== false;
  const fullImageTextsHasMore = checkpointCursor(checkpoint, 'image_text_has_more', true) !== false;
  const fullMaxItemsReached = longTask.full
    && longTask.maxItems > 0
    && Number(checkpoint?.completed_count || 0) >= longTask.maxItems;
  startupPreflight = await runStartupPreflight(options, eventState);
  options.startupPreflight = startupPreflight;
  if (startupPreflight.status === 'failed') {
    writeJson(path.join(outputDir, RUN_REPORT_FILE), buildRunReport(
      [],
      {},
      {},
      [],
      [],
      warnings,
      preflight,
      options,
      privateMessages,
      danmaku,
    ));
    throw new Error('启动前预检失败，已停止主流程；请查看 run-report.json 的 startup_preflight 和 failure_recovery。');
  }
  const shouldRunPreflight = !options.skipPreflight && (options.refresh || !fs.existsSync(postsFile));
  if (shouldRunPreflight) {
    try {
      preflight = await runPreflightChecks(options, eventState);
    } catch (error) {
      preflight.status = 'failed';
      writeJson(path.join(outputDir, RUN_REPORT_FILE), buildRunReport(
        [],
        {},
        {},
        [],
        [],
        warnings,
        preflight,
        options,
        privateMessages,
        danmaku,
      ));
      throw error;
    }
  }

  let posts = !options.refresh && !longTask.full ? readJsonIfExists(postsFile, warnings) : null;
  if (longTask.full && (!fullPostsHasMore || fullMaxItemsReached)) posts = [];
  if (!Array.isArray(posts)) {
    const args = buildWeixinSourceListArgs('posts', {
      limit: postListLimit,
      full: longTask.full,
      page: fullPostPage,
    });
    eventState.command = args.join(' ');
    queueTaskEventBurst(eventState, [
      `开始执行命令：${eventState.command}`,
      '系统先把账号作品流盘一遍，这里会同时看到视频和部分图文，后面再统一进评论链路',
    ], 'command');
    const raw = await runOpenCli(options.opencliDir, args, options.postsTimeoutSeconds, {
      progressEvents: true,
      onProgress(event) {
        applyProgressEvent(eventState, event);
      },
    });
    posts = JSON.parse(raw);
    writeJson(postsFile, posts);
    if (checkpoint) {
      const hasMore = postListLimit > 0 && posts.length >= postListLimit;
      checkpoint = setCheckpointCursors(checkpoint, {
        posts_page: hasMore ? fullPostPage + 1 : fullPostPage,
        posts_has_more: hasMore,
      });
      checkpoint = saveCheckpoint(checkpointFile, checkpoint);
      queueTaskEvent(eventState, '作品流断点已保存，下次会从下一页继续', 'checkpoint-saved', checkpoint);
    }
    queueTaskEventBurst(eventState, [
      `作品流已落盘到 ${postsFile}，共 ${posts.length} 条`,
      '作品主清单已经稳定保存，本轮即使中断也能从这里继续',
    ], 'artifact');
  }
  if (Array.isArray(posts)) {
    if (!fs.existsSync(postsFile)) writeJson(postsFile, posts);
  }

  let imageTexts = [];
  if (options.skipImageTextList) {
    const warning = '--skip-image-text-list 已启用：本轮跳过单独图文列表增强，只使用账号作品流继续抓取';
    warnings.push(warning);
    writeJson(imageTextsFile, imageTexts);
    queueTaskEventBurst(eventState, [
      warning,
      '如果作品流里本身带有图文字段，系统仍会按 file_type=2 识别并继续抓评论',
    ], 'warning');
    if (checkpoint) {
      checkpoint = setCheckpointCursors(checkpoint, {
        image_text_has_more: false,
      });
      checkpoint = saveCheckpoint(checkpointFile, checkpoint);
    }
  } else {
    imageTexts = !options.refresh && !longTask.full ? readJsonIfExists(imageTextsFile, warnings) : null;
  }
  if (longTask.full && (!fullImageTextsHasMore || fullMaxItemsReached)) imageTexts = [];
  if (!Array.isArray(imageTexts)) {
    const args = buildWeixinSourceListArgs('image-texts', {
      limit: imageTextListLimit,
      full: longTask.full,
      page: fullImageTextPage,
    });
    eventState.command = args.join(' ');
    queueTaskEventBurst(eventState, [
      `开始执行命令：${eventState.command}`,
      '系统继续盘点图文增强入口，稍后会和作品流合并为统一稿件队列',
    ], 'command');
    try {
      const raw = await runOpenCli(options.opencliDir, args, options.postsTimeoutSeconds, {
        progressEvents: true,
        onProgress(event) {
          applyProgressEvent(eventState, event);
        },
      });
      imageTexts = JSON.parse(raw);
      writeJson(imageTextsFile, imageTexts);
      if (checkpoint) {
        const hasMore = imageTextListLimit > 0 && imageTexts.length >= imageTextListLimit;
        checkpoint = setCheckpointCursors(checkpoint, {
          image_text_page: hasMore ? fullImageTextPage + 1 : fullImageTextPage,
          image_text_has_more: hasMore,
        });
        checkpoint = saveCheckpoint(checkpointFile, checkpoint);
        queueTaskEvent(eventState, '图文列表断点已保存，下次会从下一页继续', 'checkpoint-saved', checkpoint);
      }
      queueTaskEventBurst(eventState, [
        `图文增强列表已落盘到 ${imageTextsFile}，共 ${imageTexts.length} 条`,
        '图文增强清单已经稳定保存，后面会复用同一套评论抓取和入库链路',
      ], 'artifact');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const warning = `图文增强列表抓取失败，主流程已降级为只使用作品流继续执行：${message}`;
      warnings.push(warning);
      imageTexts = [];
      console.warn(`[warn] ${warning}`);
      queueTaskEventBurst(eventState, [
        truncateText(warning, 180),
        '这只影响图文补强入口，不影响作品流、评论、回复和后续入库继续推进',
      ], 'warning');
    }
  }

  if (options.postLimit > 0) posts = posts.slice(0, options.postLimit);
  if (options.imageTextLimit > 0) imageTexts = imageTexts.slice(0, options.imageTextLimit);
  const mergedWorks = mergeContentItems(posts, imageTexts);
  const workIdFilter = loadWorkIdFilter(options.workIdsFile);
  const filteredMergedWorks = workIdFilter
    ? mergedWorks.filter((work) => workIdFilter.ids.has(String(work.object_id || '').trim()))
    : mergedWorks;
  if (workIdFilter) {
    const warning = `--work-ids-file 已启用：${workIdFilter.file} 命中 ${filteredMergedWorks.length}/${mergedWorks.length} 篇稿件`;
    warnings.push(warning);
    queueTaskEventBurst(eventState, [
      warning,
      '本轮只会对命中的稿件继续抓评论或生成增量产物，未命中的稿件保留在原始 posts/image-texts 文件里',
    ], 'filter');
  }
  const currentBatchWorks = options.workLimit > 0 ? filteredMergedWorks.slice(0, options.workLimit) : filteredMergedWorks;
  let works = currentBatchWorks;
  if (longTask.full) {
    const existingFullWorks = !options.refresh ? readJsonIfExists(fullWorksFile, warnings) : null;
    works = mergeWorksByObjectId(Array.isArray(existingFullWorks) ? existingFullWorks : [], currentBatchWorks);
    writeJson(fullWorksFile, works);
  }
  writeJson(worksFile, works);
  eventState.totalWorks = works.length;
  queueTaskEventBurst(eventState, [
    `本轮计划处理 ${works.length} 篇稿件，其中作品流 ${posts.length} 条、图文增强 ${imageTexts.length} 条`,
    '系统接下来会按统一稿件队列逐条进入评论与回复抓取',
  ], 'system');

  if (options.metadataOnly) {
    writeRunArtifacts(outputDir, works, {}, {}, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
    queueTaskEventBurst(eventState, [
      `--metadata-only 已启用，本轮只完成稿件索引：${works.length} 篇`,
      '评论、私信、弹幕和 SCRM 入库都已跳过；这个产物可用于后续增量判定',
    ], 'complete');
    return;
  }

  const commentsByObjectId = loadExistingComments(outputDir, works, warnings);
  const commentDiagnosticsByObjectId = loadExistingCommentDiagnostics(outputDir, works, warnings);
  const failures = {};
  eventState.worksCompleted = Object.keys(commentsByObjectId).length;
  eventState.totalComments = Object.values(commentsByObjectId).reduce(
    (sum, rows) => sum + rows.filter((row) => !row.is_reply).length,
    0,
  );
  eventState.totalReplies = Object.values(commentsByObjectId).reduce(
    (sum, rows) => sum + rows.filter((row) => row.is_reply).length,
    0,
  );
  if (eventState.worksCompleted > 0) {
    queueTaskEvent(
      eventState,
      `检测到已有成果 ${eventState.worksCompleted} 篇稿件，一级评论 ${eventState.totalComments} 条，回复 ${eventState.totalReplies} 条，将从断点继续`,
      'resume',
    );
  }

  for (const [index, work] of works.entries()) {
    const commentsFile = path.join(outputDir, commentsFilenameFor(work.object_id));
    const kindLabel = contentKindLabel(work);
    eventState.currentWork = `${kindLabel} ${work.object_id} ${work.title}`;
    eventState.currentWorkIndex = index + 1;
    eventState.currentWorkTopLevel = 0;
    eventState.currentWorkReplies = 0;
    eventState.currentWorkPage = 0;
    eventState.currentReplyPage = 0;
    queueTaskEventBurst(eventState, [
      `进入${kindLabel}任务 ${index + 1}/${works.length}：${truncateText(work.title || work.object_id, 60)}，对象 ${work.object_id}`,
      `这篇${kindLabel}现在被推上主处理队列，接下来会先识别评论对象，再逐页拉评论和回复`,
    ], contentKindOf(work));
    if (!options.refresh && commentsByObjectId[work.object_id]) {
      console.log(`[skip ${index + 1}/${works.length}] ${kindLabel} ${work.object_id}`);
      eventState.skippedWorks += 1;
      queueTaskEventBurst(eventState, [
        `跳过${kindLabel} ${work.object_id}，原因：本地已存在评论文件 ${commentsFile}`,
        '这一步不是漏抓，而是断点续跑机制在主动节省重复劳动',
      ], 'skip');
      if (checkpoint) {
        checkpoint = markCheckpointItem(checkpoint, work.object_id, {
          title: work.title || '',
          skipped: true,
          fetched_at: new Date().toISOString(),
        });
        checkpoint = saveCheckpoint(checkpointFile, checkpoint);
        queueTaskEvent(eventState, '断点已保存，下次可以继续', 'checkpoint-saved', checkpoint);
      }
      writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku, commentDiagnosticsByObjectId);
      continue;
    }

    console.log(`[fetch ${index + 1}/${works.length}] ${kindLabel} ${work.object_id} ${work.title}`);
    const commentsDebugFile = path.join(outputDir, commentsDebugFilenameFor(work.object_id));
    const commentDiagnostics = createCommentDiagnosticRecord(work, commentsFile, commentsDebugFile);
    try {
      const commentArgs = options.commentLimit > 0
        ? ['weixin-channels', 'comments', work.object_id, '--limit', String(options.commentLimit), '--with-replies', 'true', '--all-replies', '-f', 'json']
        : ['weixin-channels', 'comments', work.object_id, '--all', '--with-replies', 'true', '--all-replies', '-f', 'json'];
      eventState.command = commentArgs.join(' ');
      queueTaskEventBurst(eventState, [
        `开始执行命令：${eventState.command}`,
        '这一轮会把一级评论和回复一起拉全，然后再统一写盘',
      ], 'command');
      const raw = await runOpenCli(
        options.opencliDir,
        commentArgs,
        options.commentsTimeoutSeconds,
        {
          progressEvents: true,
          onProgress(event) {
            applyCommentDiagnosticEvent(commentDiagnostics, event);
            applyProgressEvent(eventState, event);
          },
        },
      );
      const rows = JSON.parse(raw);
      commentsByObjectId[work.object_id] = rows;
      commentDiagnosticsByObjectId[work.object_id] = commentDiagnostics;
      writeJson(commentsFile, rows);
      writeJson(commentsDebugFile, commentDiagnostics);
      delete failures[work.object_id];
      eventState.worksCompleted = Object.keys(commentsByObjectId).length;
      queueTaskEventBurst(eventState, [
        `${kindLabel} ${work.object_id} 抓取完成，写入 ${commentsFile}，共 ${rows.filter((row) => !row.is_reply).length} 条一级评论，${rows.filter((row) => row.is_reply).length} 条回复`,
        `单${kindLabel}评论文件已经落盘完成，这意味着这篇稿件的原始成果已经安全保存`,
      ], 'success');
      if (checkpoint) {
        checkpoint = markCheckpointItem(checkpoint, work.object_id, {
          title: work.title || '',
          fetched_at: new Date().toISOString(),
        });
        checkpoint = saveCheckpoint(checkpointFile, checkpoint);
        queueTaskEvent(eventState, '断点已保存，下次可以继续', 'checkpoint-saved', checkpoint);
      }
    } catch (error) {
      failures[work.object_id] = error instanceof Error ? error.message : String(error);
      commentDiagnostics.error = failures[work.object_id];
      commentDiagnosticsByObjectId[work.object_id] = commentDiagnostics;
      writeJson(commentsDebugFile, commentDiagnostics);
      console.error(`[fail ${index + 1}/${works.length}] ${kindLabel} ${work.object_id}`);
      console.error(failures[work.object_id]);
      eventState.worksFailed = Object.keys(failures).length;
      queueTaskEventBurst(eventState, [
        `${kindLabel} ${work.object_id} 抓取失败，错误：${truncateText(failures[work.object_id], 120)}`,
        '失败信息已经记账，系统不会卡住，会继续处理后续稿件任务',
      ], 'error');
      if (checkpoint) {
        checkpoint = markCheckpointItem(checkpoint, work.object_id, {
          title: work.title || '',
          error: failures[work.object_id],
          fetched_at: new Date().toISOString(),
        }, 'failed');
        checkpoint = saveCheckpoint(checkpointFile, checkpoint);
        queueTaskEvent(eventState, '断点已保存，下次可以继续', 'checkpoint-saved', checkpoint);
      }
      if (options.stopOnError) throw error;
    }

    writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku, commentDiagnosticsByObjectId);
    eventState.worksCompleted = Object.keys(commentsByObjectId).length;
    eventState.worksFailed = Object.keys(failures).length;
    queueTaskEventBurst(eventState, [
      '聚合产物已刷新：index.json、harvest.json、harvest-comments.json、merged.json、progress.json',
      '这一轮聚合刷新完成后，使用者随时都可以打开目录看当前阶段成果',
    ], 'artifact');
  }

  const failedCount = Object.keys(failures).length;
  let importFailed = false;
  if (checkpoint) {
    const currentBatch = Number(checkpoint.current_batch || 0) + 1;
    const sourceHasMore = checkpointCursor(checkpoint, 'posts_has_more', false) !== false
      || checkpointCursor(checkpoint, 'image_text_has_more', false) !== false;
    const reachedMaxItems = longTask.maxItems > 0 && Number(checkpoint.completed_count || 0) >= longTask.maxItems;
    const status = (!sourceHasMore || reachedMaxItems) ? 'complete' : 'running';
    checkpoint = saveCheckpoint(checkpointFile, {
      ...checkpoint,
      current_batch: currentBatch,
      has_more: sourceHasMore && !reachedMaxItems,
      status,
    });
    queueTaskEvent(
      eventState,
      `第 ${currentBatch} 批完成，本批 ${works.length} 篇稿件`,
      'batch-complete',
      { ...checkpoint, batch_items: works.length },
    );
    if (status === 'complete') {
      queueTaskEvent(
        eventState,
        reachedMaxItems ? `已达到全量上限 ${longTask.maxItems} 篇稿件` : '平台已经返回没有更多，视频号全量采集完成',
        'full-complete',
        checkpoint,
      );
    }
  }
  writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
  if (options.importScrm || options.importScrmMessage || options.importScrmDanmaku) {
    try {
      await ensureWeixinAccountProfile(outputDir, options, eventState);
    } catch (error) {
      warnings.push(`账号主体信息导出失败：${error instanceof Error ? error.message : String(error)}`);
      writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      throw error;
    }
  }
  if (options.importScrm) {
    try {
      assertCanApplyScrmImport(options, failedCount);
    } catch (error) {
      queueTaskEventBurst(
        eventState,
        [
          error instanceof Error ? error.message : String(error),
          '本地抓取产物和 run-report.json 已保留，可以修复失败项后重跑，或显式允许部分入库',
        ],
        'error',
      );
      writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      throw error;
    }
    const harvestPath = path.join(outputDir, 'harvest.json');
    const importArgs = ['--input', harvestPath];
    if (options.importScrmApply) importArgs.push('--apply');
    queueTaskEventBurst(
      eventState,
      [
        `抓取阶段已经结束，准备把 ${harvestPath} 送进 SCRM 导入脚本`,
        options.importScrmApply
          ? '这次会直接写入数据库，并在结束后打印每篇稿件的导入校验报告'
          : '这次先走 dry-run 预演，先看字段映射和每篇稿件的评论/回复统计是否符合预期',
      ],
      'import',
    );
    try {
      const importStdout = await runNodeScript(
        path.join(ROOT_DIR, 'scripts', 'import-to-scrm.js'),
        ['--platform', 'weixin-channels', ...importArgs],
      );
      if (importStdout) {
        console.log(importStdout);
      }
      const importSummary = parsePrefixedJsonLine(importStdout, 'IMPORT_SUMMARY ');
      const importVerification = parsePrefixedJsonLine(importStdout, 'IMPORT_VERIFICATION ');
      eventState.stage = 'import';
      queueTaskEventBurst(
        eventState,
        detailedImportLines('file-comment', importSummary, importVerification, options.importScrmApply),
        'import',
      );
      if (importSummary?.work_report) {
        for (const row of importSummary.work_report) {
          queueTaskEvent(
            eventState,
            `导入预检：${truncateText(row.title || row.work_no, 40)}，预计导入 ${row.top_level_comments || 0} 条一级评论、${row.reply_comments || 0} 条回复，总评论行 ${row.total_comment_rows || 0}`,
            'import',
          );
        }
      }
      if (importVerification?.verification?.works) {
        for (const row of importVerification.verification.works) {
          queueTaskEvent(
            eventState,
            `落库校验：${truncateText(row.title || row.work_no, 40)}，数据库里已有 ${row.top_level_comments || 0} 条一级评论、${row.reply_comments || 0} 条回复，总评论行 ${row.total_comment_rows || 0}`,
            'import',
          );
        }
      }
      queueTaskEvent(
        eventState,
        options.importScrmApply ? 'SCRM 正式导入已经完成，抓取到入库这一整段链路已经串起来了' : 'SCRM dry-run 已完成，当前可以先审字段映射和按作品校验报告',
        'import',
      );
    } catch (error) {
      importFailed = true;
      warnings.push(`SCRM 导入阶段失败：${error instanceof Error ? error.message : String(error)}`);
      writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      queueTaskEventBurst(
        eventState,
        [
          `SCRM 导入阶段失败，错误是 ${truncateText(error instanceof Error ? error.message : String(error), 120)}`,
          '抓取成果还在本地目录里，问题只出在导入阶段，可以单独重试导入，不会丢掉抓取数据',
        ],
        'error',
      );
      if (options.stopOnError) throw error;
    }
  }
  if (options.includePrivateMessages) {
    const privateMessagesPath = path.join(outputDir, 'private-messages-flat.json');
    queueTaskEventBurst(
      eventState,
      [
        `评论链路已收尾，主流程最后一步开始导出私信扁平文件 ${privateMessagesPath}`,
        options.importScrmMessage
          ? (options.importScrmMessageApply
            ? '这次会把对方发来的私信和打招呼消息继续写进 scrm_message'
            : '这次还会继续做私信 dry-run，检查字段映射和预期入库行数')
          : '这次只导出私信文件，不写入 scrm_message',
      ],
      'private-message',
    );
    try {
      const privateRaw = await runOpenCli(
        options.opencliDir,
        ['weixin-channels', 'private-messages-flat', '--all', '-f', 'json'],
        options.commentsTimeoutSeconds,
        {
          progressEvents: true,
          onProgress(event) {
            applyProgressEvent(eventState, event);
          },
        },
      );
      const privateRows = JSON.parse(privateRaw);
      writeJson(privateMessagesPath, privateRows);
      privateMessages = buildPrivateMessagesReport({
        status: options.importScrmMessage ? 'exported' : 'exported',
        exported_rows: privateRows.length,
        output_file: privateMessagesPath,
      }, options);
      queueTaskEventBurst(
        eventState,
        [
          `私信扁平文件已落盘到 ${privateMessagesPath}，当前共 ${privateRows.length} 条入站消息`,
          options.importScrmMessage
            ? '这份文件只保留对方发来的消息，后面的 scrm_message 导入会直接复用这份产物'
            : '主流程已完成私信采集；如需入库，可单独运行私信导入或下次增加 --import-scrm-message-apply',
        ],
        'artifact',
      );

      if (!options.importScrmMessage) {
        queueTaskEvent(
          eventState,
          '私信导出已作为主流程最后一步完成，本轮未请求 scrm_message 入库',
          'private-message',
        );
        writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      } else {
        const importMessageArgs = ['--input', privateMessagesPath];
        if (options.importScrmMessageApply) importMessageArgs.push('--apply');
        const importStdout = await runNodeScript(
          path.join(ROOT_DIR, 'scripts', 'import-private-messages-to-scrm-message.js'),
          importMessageArgs,
        );
        if (importStdout) {
          console.log(importStdout);
        }
        const importSummary = parsePrefixedJsonLine(importStdout, 'IMPORT_SUMMARY ');
        const importVerification = parsePrefixedJsonLine(importStdout, 'IMPORT_VERIFICATION ');
        privateMessages = {
          ...privateMessages,
          status: options.importScrmMessageApply ? 'imported' : 'dry-run',
          import_payload_rows: Number(importSummary?.message_rows || 0),
          write_attempt_rows: Number(importSummary?.write_attempt_rows || 0),
          matched_current_payload_rows: Number(importVerification?.verification?.matched_current_payload_rows || 0),
        };
        eventState.stage = 'import';
        queueTaskEventBurst(
          eventState,
          detailedImportLines('private-message', importSummary, importVerification, options.importScrmMessageApply),
          'import',
        );
        if (importSummary?.message_rows) {
          queueTaskEvent(
            eventState,
            `私信导入预检：预计写入 ${importSummary.message_rows} 条消息，样例发送人是 ${truncateText(importSummary.message_example?.comment_user_name || '未知', 24)}`,
            'import',
          );
        }
        if (importVerification?.verification?.records) {
          for (const row of importVerification.verification.records.slice(0, 5)) {
            queueTaskEvent(
              eventState,
              `私信落库校验：${truncateText(row.comment_user_name || row.comment_id, 24)} -> ${truncateText(row.content || '', 36)}`,
              'import',
            );
          }
        }
        queueTaskEvent(
          eventState,
          options.importScrmMessageApply ? '私信正式导入已经完成，scrm_message 链路已串到主流程里' : '私信 dry-run 已完成，当前可以先审发送人、头像和消息正文映射',
          'import',
        );
        writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      }
    } catch (error) {
      importFailed = true;
      const warning = `私信主流程最后一步失败：${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      privateMessages = buildPrivateMessagesReport({
        ...(privateMessages || {}),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }, options);
      writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      queueTaskEventBurst(
        eventState,
        [
          truncateText(warning, 160),
          '评论抓取成果已经留在本地目录里，私信链路可以单独重试，不会影响稿件和评论结果',
        ],
        'error',
      );
      if (options.stopOnError) throw error;
    }
  } else {
    queueTaskEvent(
      eventState,
      '--skip-private-messages 已启用，主流程最后一步私信导出已跳过',
      'private-message',
    );
    privateMessages = buildPrivateMessagesReport({
      status: 'skipped',
    }, options);
    writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
  }
  if (options.includeDanmaku) {
    const danmakuPath = path.join(outputDir, 'danmaku-flat.json');
    const danmakuWorkIndexPath = resolveDanmakuWorkIndexPath(danmakuPath);
    queueTaskEventBurst(
      eventState,
      [
        `私信链路已收尾，主流程最后一步继续导出弹幕扁平文件 ${danmakuPath}`,
        options.importScrmDanmaku
          ? (options.importScrmDanmakuApply
            ? '这次会把弹幕明细继续写进 scrm_danmaku'
            : '这次还会继续做弹幕 dry-run，检查字段映射和预期入库行数')
          : '这次只导出弹幕文件，不写入 scrm_danmaku',
      ],
      'danmaku',
    );
    try {
      const bulletRaw = await runOpenCli(
        options.opencliDir,
        ['weixin-channels', 'danmaku-flat', '--all', '-f', 'json'],
        options.commentsTimeoutSeconds,
        {
          progressEvents: true,
          onProgress(event) {
            applyProgressEvent(eventState, event);
          },
        },
      );
      const bulletRows = enrichDanmakuRows(JSON.parse(bulletRaw), {
        platform: 'weixin-channels',
        rootDir: ROOT_DIR,
        workIndexPath: danmakuWorkIndexPath,
      });
      writeJson(danmakuPath, bulletRows);
      danmaku = buildDanmakuReport({
        status: 'exported',
        exported_rows: bulletRows.length,
        danmaku_rows: bulletRows.length,
        output_file: danmakuPath,
      }, options);
      queueTaskEventBurst(
        eventState,
        [
          `弹幕扁平文件已落盘到 ${danmakuPath}，当前共 ${bulletRows.length} 条弹幕`,
          options.importScrmDanmaku
            ? '这份文件会直接复用到 scrm_danmaku 导入，不需要再重复抓取页面'
            : '主流程已完成弹幕采集；如需入库，可单独运行弹幕导入或下次增加 --import-scrm-danmaku-apply',
        ],
        'artifact',
      );

      if (!options.importScrmDanmaku) {
        queueTaskEvent(
          eventState,
          '弹幕导出已作为主流程最后一步完成，本轮未请求 scrm_danmaku 入库',
          'danmaku',
        );
        writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      } else {
        const importBulletArgs = ['--input', danmakuPath];
        if (options.importScrmDanmakuApply) importBulletArgs.push('--apply');
        const importStdout = await runNodeScript(
          path.join(ROOT_DIR, 'scripts', 'import-danmaku-to-scrm.js'),
          importBulletArgs,
        );
        if (importStdout) {
          console.log(importStdout);
        }
        const importSummary = parsePrefixedJsonLine(importStdout, 'IMPORT_SUMMARY ');
        const importVerification = parsePrefixedJsonLine(importStdout, 'IMPORT_VERIFICATION ');
        danmaku = {
          ...danmaku,
          status: options.importScrmDanmakuApply ? 'imported' : 'dry-run',
          danmaku_rows: Number(importSummary?.danmaku_rows ?? danmaku?.danmaku_rows ?? 0),
          import_payload_rows: Number(importSummary?.danmaku_rows ?? 0),
          write_attempt_rows: Number(importSummary?.write_attempt_rows || 0),
          matched_current_payload_rows: Number(importVerification?.matched_rows || 0),
        };
        eventState.stage = 'import';
        queueTaskEventBurst(
          eventState,
          detailedImportLines('danmaku', importSummary, importVerification, options.importScrmDanmakuApply),
          'import',
        );
        if (importSummary?.danmaku_rows) {
          const importRows = Number(importSummary?.danmaku_rows ?? 0);
          queueTaskEvent(
            eventState,
            `弹幕导入预检：预计写入 ${importRows} 条弹幕，样例内容是 ${truncateText(importSummary?.danmaku_example?.content || '未知', 36)}`,
            'import',
          );
        }
        if (Array.isArray(importVerification?.records)) {
          for (const row of importVerification.records.slice(0, 5)) {
            queueTaskEvent(
              eventState,
              `弹幕落库校验：${truncateText(row.comment_user_name || row.danmaku_id, 24)} -> ${truncateText(row.content || '', 36)}`,
              'import',
            );
          }
        }
        queueTaskEvent(
          eventState,
          options.importScrmDanmakuApply ? '弹幕正式导入已经完成，scrm_danmaku 链路已串到主流程里' : '弹幕 dry-run 已完成，当前可以先审视频时间点、作者和正文映射',
          'import',
        );
        writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      }
    } catch (error) {
      importFailed = true;
      const warning = `弹幕主流程最后一步失败：${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      danmaku = buildDanmakuReport({
        ...(danmaku || {}),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }, options);
      writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
      queueTaskEventBurst(
        eventState,
        [
          truncateText(warning, 160),
          '评论和私信成果已经留在本地目录里，弹幕链路可以单独重试，不会影响前面的稿件和评论结果',
        ],
        'error',
      );
      if (options.stopOnError) throw error;
    }
  } else {
    queueTaskEvent(
      eventState,
      '--skip-danmaku 已启用，主流程最后一步弹幕导出已跳过',
      'danmaku',
    );
    danmaku = buildDanmakuReport({
      status: 'skipped',
    }, options);
    writeRunArtifacts(outputDir, works, commentsByObjectId, failures, posts, imageTexts, warnings, preflight, options, privateMessages, danmaku);
  }
  eventState.stage = 'summary';
  queueTaskEventBurst(
    eventState,
    finalSummaryLines({
      works,
      commentsByObjectId,
      failures,
      privateMessages,
      danmaku,
      options,
    }),
    failedCount > 0 ? 'warning' : 'success',
  );
  queueTaskEventBurst(
    eventState,
    [
      `任务结束：成功 ${works.length - failedCount}/${works.length} 篇稿件，失败 ${failedCount}`,
      '全过程事件已经写入 task-events.jsonl，可用于 runner 实时展示和后续回放',
    ],
    failedCount > 0 ? 'warning' : 'success',
  );
  console.log(`done: ${works.length - failedCount}/${works.length} works completed`);
  if (failedCount > 0 || importFailed) {
    process.exitCode = 1;
  }
}

export async function runWeixinChannels(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.full) {
    await runWeixinChannelsOnce(argv);
    return;
  }

  const outputDir = resolveWeixinOutputDir(options);
  const checkpointFile = checkpointPathFor(outputDir);
  const loopLimit = options.maxItems > 0
    ? Math.max(1, Math.ceil(options.maxItems / Math.max(1, options.batchSize)) + 2)
    : 1000;
  let batchIndex = 0;
  let checkpoint = null;
  const batchArgs = appendMissingArgs(argv, [
    '--content-only',
    '--skip-private-messages',
    '--skip-danmaku',
  ]);

  while (batchIndex < loopLimit) {
    const currentArgs = batchIndex === 0
      ? batchArgs
      : appendMissingArgs(batchArgs, ['--skip-startup-preflight', '--skip-preflight']);
    await runWeixinChannelsOnce(currentArgs);
    checkpoint = loadCheckpoint(checkpointFile);
    if (!checkpoint || checkpoint.status === 'complete' || checkpoint.has_more === false) break;
    batchIndex += 1;
  }

  if (batchIndex >= loopLimit) {
    throw new Error(`视频号全量循环超过安全上限 ${loopLimit} 批，已停止以避免无限循环。`);
  }

  if (!options.contentOnly) {
    const finalArgs = appendMissingArgs(removeFlag(argv, '--refresh'), ['--skip-startup-preflight', '--skip-preflight']);
    await runWeixinChannelsOnce(finalArgs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeixinChannels().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
