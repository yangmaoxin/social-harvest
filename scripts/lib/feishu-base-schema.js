import { ensureDatetimeText, ensureInt, ensureText, nowDatetimeText } from './scrm-base.js';

const NUMBER_FIELD = { type: 'number', style: { type: 'plain', precision: 0, thousands_separator: true } };
const DATETIME_FIELD = { type: 'datetime', style: { format: 'yyyy-MM-dd HH:mm' } };

function textField(name, description = '') {
  return description ? { name, type: 'text', description } : { name, type: 'text' };
}

function readonlyTextField(name, description = '') {
  return { ...textField(name, description), writable: false };
}

function numberField(name) {
  return { name, ...NUMBER_FIELD };
}

function datetimeField(name) {
  return { name, ...DATETIME_FIELD };
}

function formulaField(name, expression) {
  return { name, type: 'formula', expression, writable: false };
}

function checkboxField(name) {
  return { name, type: 'checkbox' };
}

function attachmentField(name) {
  return { name, type: 'attachment', writable: false };
}

function isWritableField(field = {}) {
  if (field.writable === false) return false;
  return !['formula', 'lookup', 'attachment', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(field.type);
}

export const FEISHU_DATASETS = {
  works: {
    tableName: 'works',
    sourceKeyFields: ['platform', 'origin_type', 'work_no'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('account_id'),
      textField('work_no'),
      textField('title'),
      numberField('file_type'),
      numberField('duration'),
      numberField('count_collect'),
      numberField('count_comment'),
      numberField('count_play'),
      numberField('count_danmaku'),
      numberField('count_like'),
      numberField('count_fav'),
      numberField('count_share'),
      textField('front_img_url'),
      datetimeField('public_at'),
      numberField('status'),
      datetimeField('created_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
  comments: {
    tableName: 'comments',
    sourceKeyFields: ['platform', 'origin_type', 'comment_id'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('account_id'),
      textField('comment_id'),
      textField('work_no'),
      textField('comment_user_name'),
      textField('comment_user_photo'),
      textField('content'),
      numberField('intention'),
      textField('parent_comment_id'),
      textField('root_parent_id'),
      textField('reply_to'),
      textField('reply_to_comment_id'),
      textField('ip_location'),
      numberField('count_agree'),
      numberField('status'),
      datetimeField('created_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
  danmaku: {
    tableName: 'danmaku',
    sourceKeyFields: ['platform', 'origin_type', 'danmaku_id'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('account_id'),
      textField('danmaku_id'),
      textField('work_no'),
      textField('comment_user_name'),
      textField('comment_user_photo'),
      textField('content'),
      numberField('intention'),
      numberField('video_timestamp_ms'),
      textField('video_timestamp_text'),
      numberField('status'),
      datetimeField('created_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
  messages: {
    tableName: 'messages',
    sourceKeyFields: ['platform', 'origin_type', 'comment_id'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('account_id'),
      textField('comment_id'),
      textField('comment_user_name'),
      textField('comment_user_photo'),
      textField('content'),
      numberField('intention'),
      datetimeField('created_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
  accounts: {
    tableName: 'accounts',
    sourceKeyFields: ['platform', 'origin_type', 'account_id'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('account_id'),
      textField('account_name'),
      textField('account_photo'),
      textField('profile_url'),
      numberField('fans_count'),
      datetimeField('created_at'),
      datetimeField('updated_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
  metric_snapshots: {
    tableName: 'metric_snapshots',
    sourceKeyFields: ['platform', 'snapshot_hash'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('target_scope'),
      textField('target_id'),
      textField('source'),
      textField('source_run_id'),
      textField('device_id'),
      textField('capture_bucket'),
      textField('snapshot_hash'),
      numberField('fans_count'),
      numberField('like_count'),
      numberField('share_count'),
      numberField('collect_count'),
      numberField('comment_count'),
      numberField('following_count'),
      numberField('video_count'),
      datetimeField('captured_at'),
      datetimeField('created_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
  metric_delta_events: {
    tableName: 'metric_delta_events',
    sourceKeyFields: ['platform', 'origin_type', 'target_scope', 'target_id', 'metric_type', 'from_snapshot_id', 'to_snapshot_id', 'sequence_no'],
    fields: [
      textField('source_key', 'Social Harvest 幂等写入键，请勿手工修改。'),
      textField('platform'),
      numberField('origin_type'),
      textField('target_scope'),
      textField('target_id'),
      textField('metric_type'),
      numberField('delta_unit'),
      numberField('from_snapshot_id'),
      numberField('to_snapshot_id'),
      datetimeField('window_started_at'),
      datetimeField('window_ended_at'),
      datetimeField('event_time'),
      numberField('sequence_no'),
      numberField('sequence_total'),
      textField('display_title'),
      textField('display_status'),
      textField('confidence'),
      datetimeField('created_at'),
      datetimeField('imported_at'),
      textField('raw_payload_json'),
    ],
  },
};

export const FEISHU_DATASET_NAMES = Object.keys(FEISHU_DATASETS);

export const FEISHU_DISPLAY_DATASETS = {
  display_contents: {
    tableName: 'display_contents',
    sourceKeyFields: ['source_key'],
    fields: [
      textField('标题'),
      textField('source_key', 'Social Harvest 展示层幂等写入键，请勿手工修改。'),
      textField('月份'),
      textField('原始表source_key'),
      textField('跟进状态'),
      textField('备注'),
      checkboxField('进入创作池'),
    ],
  },
  display_interactions: {
    tableName: 'display_interactions',
    sourceKeyFields: ['source_key'],
    fields: [
      textField('用户昵称'),
      textField('source_key', 'Social Harvest 展示层幂等写入键，请勿手工修改。'),
      textField('月份'),
      textField('来源类型'),
      textField('跟进状态'),
      textField('备注'),
      textField('原始表source_key'),
    ],
  },
  display_accounts: {
    tableName: 'display_accounts',
    sourceKeyFields: ['source_key'],
    fields: [
      textField('账号'),
      textField('source_key', 'Social Harvest 展示层幂等写入键，请勿手工修改。'),
      textField('月份'),
      textField('备注'),
      textField('原始表source_key'),
    ],
  },
};

const ALL_FEISHU_DATASETS = {
  ...FEISHU_DATASETS,
  ...FEISHU_DISPLAY_DATASETS,
};

export function getFeishuDataset(name) {
  const dataset = ALL_FEISHU_DATASETS[name];
  if (!dataset) throw new Error(`Unsupported Feishu dataset: ${name}`);
  return dataset;
}

function jsonValue(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function normalizeDateText(value) {
  return ensureDatetimeText(value);
}

function datetimeValue(value) {
  const text = normalizeDateText(value);
  if (!text) return null;
  const timestamp = new Date(text.replace(' ', 'T')).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid datetime text: ${text}`);
  return timestamp;
}

function fieldValue(row, field) {
  if (field === 'platform') return row.platform || '';
  if (field === 'raw_payload_json') return ensureText(row.raw_payload_json) || JSON.stringify(jsonValue(row.raw_payload ?? row));
  if (field === 'imported_at') return datetimeValue(row.imported_at || nowDatetimeText());
  const value = row[field];
  if (value === undefined || value === null || value === '') return null;
  const spec = Object.values(ALL_FEISHU_DATASETS)
    .flatMap((dataset) => dataset.fields)
    .find((item) => item.name === field);
  if (spec?.type === 'number') return ensureInt(value);
  if (spec?.type === 'datetime') return datetimeValue(value);
  return ensureText(value);
}

export function buildSourceKey(datasetName, row, platform = '') {
  const dataset = getFeishuDataset(datasetName);
  const parts = dataset.sourceKeyFields.map((field) => {
    if (field === 'platform') return ensureText(row.platform || platform);
    return ensureText(row[field]);
  });
  const missing = parts.some((part) => !part);
  if (missing && datasetName === 'metric_snapshots') {
    return [
      ensureText(row.platform || platform),
      'metric_snapshots',
      ensureText(row.origin_type),
      ensureText(row.target_scope),
      ensureText(row.target_id),
      ensureText(row.capture_bucket || row.captured_at),
    ].join(':');
  }
  if (missing) return '';
  return parts.join(':');
}

export function buildFeishuRows(datasetName, rows, {
  platform = '',
  importedAt = nowDatetimeText(),
} = {}) {
  const dataset = getFeishuDataset(datasetName);
  const sourceRows = Array.isArray(rows) ? rows : [];
  const bySourceKey = new Map();

  for (const row of sourceRows) {
    const current = {
      ...row,
      platform: ensureText(row.platform || platform),
      imported_at: importedAt,
      raw_payload: row.raw_payload ?? row,
    };
    const sourceKey = ensureText(row.source_key || buildSourceKey(datasetName, current, platform));
    if (!sourceKey) continue;
    current.source_key = sourceKey;
    const fields = Object.fromEntries(dataset.fields.filter(isWritableField).map((field) => [
      field.name,
      fieldValue(current, field.name),
    ]));
    bySourceKey.set(sourceKey, fields);
  }

  return [...bySourceKey.values()];
}

export function tableNameForDataset(datasetName, prefix = 'harvest') {
  const dataset = getFeishuDataset(datasetName);
  const normalizedPrefix = ensureText(prefix) || 'harvest';
  return `${normalizedPrefix}_${dataset.tableName}`;
}

function monthKey(value, fallback = nowDatetimeText()) {
  const text = normalizeDateText(value) || normalizeDateText(fallback);
  return text.slice(0, 7).replace('-', '');
}

function displayMonthLabel(month) {
  const text = ensureText(month);
  if (/^\d{6}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4)}`;
  return text || '未知月份';
}

function displayTableName(platform, month, label) {
  return `${platformLabel(platform)} ${displayMonthLabel(month)} ${label}`;
}

function platformLabel(platform) {
  const value = ensureText(platform);
  if (value === 'douyin') return '抖音';
  if (value === 'weixin-channels') return '视频号';
  return value || '未知平台';
}

function contentTypeLabel(row = {}) {
  const fileType = ensureInt(row.file_type);
  if (fileType === 2) return '图文';
  return '视频';
}

function intentionLabel(value) {
  const score = ensureInt(value);
  if (score >= 3) return '高意向';
  if (score >= 1) return '普通意向';
  return '低意向';
}

function accountTier(row = {}) {
  const fansCount = ensureInt(row.fans_count);
  if (fansCount >= 100000) return '头部账号';
  if (fansCount >= 10000) return '腰部账号';
  if (fansCount > 0) return '长尾账号';
  return '待补充';
}

function sourceKeyValue(datasetName, row, platform) {
  return ensureText(row.source_key || buildSourceKey(datasetName, row, platform));
}

function displayFieldValue(row, field, fieldSpecs) {
  const value = row[field];
  if (value === undefined || value === null || value === '') return null;
  const spec = fieldSpecs.find((item) => item.name === field);
  if (spec?.type === 'number') return ensureInt(value);
  if (spec?.type === 'datetime') return datetimeValue(value);
  if (spec?.type === 'checkbox') return Boolean(value);
  return ensureText(value);
}

function buildDisplayRows(fieldSpecs, rows, { platform, importedAt }) {
  const bySourceKey = new Map();
  for (const row of rows) {
    const current = {
      ...row,
      平台: platformLabel(row.platform || platform),
      采集时间: importedAt,
    };
    const sourceKey = ensureText(current.source_key);
    if (!sourceKey) continue;
    const fields = Object.fromEntries(fieldSpecs.filter(isWritableField).map((field) => [
      field.name,
      displayFieldValue(current, field.name, fieldSpecs),
    ]));
    bySourceKey.set(sourceKey, fields);
  }
  return [...bySourceKey.values()];
}

function addGroupedDisplayRows(groups, datasetName, sourceDatasetName, sourceRows, {
  platform,
  tablePrefix,
  importedAt,
}) {
  for (const row of sourceRows) {
    const rowPlatform = ensureText(row.platform || platform);
    const rawSourceKey = sourceKeyValue(sourceDatasetName, row, rowPlatform);
    if (!rawSourceKey) continue;
    const dateField = row.public_at || row.created_at || row.updated_at || importedAt;
    const month = monthKey(dateField, importedAt);
    const fieldSpecs = displayFieldSpecs(datasetName, tablePrefix);
    const tableLabel = datasetName === 'display_contents'
      ? '内容'
      : datasetName === 'display_interactions'
        ? '线索'
        : '账号';
    const tableName = displayTableName(rowPlatform, month, tableLabel);
    const key = `${datasetName}\0${tableName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        dataset: datasetName,
        table_name: tableName,
        source_rows: 0,
        rows: [],
        attachments: [],
        fields: fieldSpecs,
        views: displayViewSpecs(datasetName),
        field_count: fieldSpecs.length,
        warnings: [],
      });
    }
    const item = groups.get(key);
    item.source_rows += 1;
    item.rows.push({
      ...row,
      source_key: `${datasetName}:${rawSourceKey}`,
      月份: month,
      原始表source_key: rawSourceKey,
      采集时间: importedAt,
    });
    for (const attachment of displayAttachmentSpecs(datasetName, row)) {
      if (!ensureText(attachment.url)) continue;
      item.attachments.push({
        source_key: `${datasetName}:${rawSourceKey}`,
        ...attachment,
      });
    }
  }
}

function rawLookup(tableName, sourceKeyField, targetField) {
  return `FIRST([${tableName}].FILTER(CurrentValue.[source_key] = [${sourceKeyField}]).[${targetField}])`;
}

function displayDatetime(expression) {
  return `IF(ISBLANK(${expression}), "", TEXT(${expression}, "YYYY-MM-DD hh:mm"))`;
}

function displayPlatform(expression) {
  return `IF(ISBLANK(${expression}), "", IFS(${expression} = "weixin-channels", "视频号", ${expression} = "douyin", "抖音", TRUE(), ${expression}))`;
}

function branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, targetField) {
  return `IF([来源类型] = "评论", ${rawLookup(commentsTable, sourceKeyField, targetField)}, IF([来源类型] = "私信", ${rawLookup(messagesTable, sourceKeyField, targetField)}, ${rawLookup(danmakuTable, sourceKeyField, targetField)}))`;
}

function contentDisplayFields(tablePrefix) {
  const worksTable = tableNameForDataset('works', tablePrefix);
  const sourceKeyField = '原始表source_key';
  const like = rawLookup(worksTable, sourceKeyField, 'count_like');
  const play = rawLookup(worksTable, sourceKeyField, 'count_play');
  const comment = rawLookup(worksTable, sourceKeyField, 'count_comment');
  const collect = rawLookup(worksTable, sourceKeyField, 'count_collect');
  const fav = rawLookup(worksTable, sourceKeyField, 'count_fav');
  const share = rawLookup(worksTable, sourceKeyField, 'count_share');
  const interaction = `${like} + ${comment} + IFBLANK(${collect}, ${fav}) + ${share}`;
  const weighted = `${like} + IFBLANK(${collect}, ${fav}) + ${comment} * 4 + ${share} * 4`;
  return [
    textField('标题'),
    textField('source_key', 'Social Harvest 展示层幂等写入键，请勿手工修改。'),
    textField('月份'),
    textField('原始表source_key'),
    formulaField('平台', displayPlatform(rawLookup(worksTable, sourceKeyField, 'platform'))),
    formulaField('账号ID', rawLookup(worksTable, sourceKeyField, 'account_id')),
    formulaField('作品ID', rawLookup(worksTable, sourceKeyField, 'work_no')),
    formulaField('内容类型', `IF(${rawLookup(worksTable, sourceKeyField, 'file_type')} = 2, "图文", "视频")`),
    formulaField('正文', rawLookup(worksTable, sourceKeyField, 'title')),
    attachmentField('封面图'),
    readonlyTextField('封面图来源链接'),
    formulaField('封面图链接', rawLookup(worksTable, sourceKeyField, 'front_img_url')),
    textField('原文链接'),
    formulaField('发布时间', displayDatetime(rawLookup(worksTable, sourceKeyField, 'public_at'))),
    formulaField('播放数', play),
    formulaField('点赞数', like),
    formulaField('评论数', comment),
    formulaField('收藏数', `IFBLANK(${collect}, ${fav})`),
    formulaField('分享数', share),
    formulaField('互动量', interaction),
    formulaField('内容表现', `IFS(${like} >= 1000 || ${play} >= 10000 || ${weighted} >= 3000, "重点复盘", ${weighted} >= 300 || ${like} >= 100, "表现不错", TRUE(), "正常观察")`),
    formulaField('采集时间', displayDatetime(rawLookup(worksTable, sourceKeyField, 'imported_at'))),
    textField('跟进状态'),
    checkboxField('进入创作池'),
    textField('备注'),
  ];
}

function interactionDisplayFields(tablePrefix) {
  const commentsTable = tableNameForDataset('comments', tablePrefix);
  const messagesTable = tableNameForDataset('messages', tablePrefix);
  const danmakuTable = tableNameForDataset('danmaku', tablePrefix);
  const sourceKeyField = '原始表source_key';
  const score = branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'intention');
  return [
    textField('用户昵称'),
    textField('source_key', 'Social Harvest 展示层幂等写入键，请勿手工修改。'),
    textField('月份'),
    textField('来源类型'),
    textField('原始表source_key'),
    formulaField('平台', displayPlatform(branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'platform'))),
    formulaField('账号ID', branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'account_id')),
    formulaField('作品ID', `IF([来源类型] = "评论", ${rawLookup(commentsTable, sourceKeyField, 'work_no')}, IF([来源类型] = "弹幕", ${rawLookup(danmakuTable, sourceKeyField, 'work_no')}, ""))`),
    attachmentField('用户头像'),
    readonlyTextField('用户头像来源链接'),
    formulaField('用户头像链接', branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'comment_user_photo')),
    formulaField('内容', branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'content')),
    formulaField('意向等级', `IFS(${score} >= 3, "高意向", ${score} >= 1, "普通意向", TRUE(), "低意向")`),
    formulaField('互动时间', displayDatetime(branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'created_at'))),
    formulaField('采集时间', displayDatetime(branchByInteractionSource(commentsTable, messagesTable, danmakuTable, sourceKeyField, 'imported_at'))),
    textField('跟进状态'),
    textField('备注'),
  ];
}

function accountDisplayFields(tablePrefix) {
  const accountsTable = tableNameForDataset('accounts', tablePrefix);
  const sourceKeyField = '原始表source_key';
  const fans = rawLookup(accountsTable, sourceKeyField, 'fans_count');
  return [
    textField('账号'),
    textField('source_key', 'Social Harvest 展示层幂等写入键，请勿手工修改。'),
    textField('月份'),
    textField('原始表source_key'),
    formulaField('平台', displayPlatform(rawLookup(accountsTable, sourceKeyField, 'platform'))),
    formulaField('账号ID', rawLookup(accountsTable, sourceKeyField, 'account_id')),
    attachmentField('头像'),
    readonlyTextField('头像来源链接'),
    formulaField('头像链接', rawLookup(accountsTable, sourceKeyField, 'account_photo')),
    formulaField('主页链接', rawLookup(accountsTable, sourceKeyField, 'profile_url')),
    formulaField('粉丝数', fans),
    formulaField('账号分层', `IFS(${fans} >= 100000, "头部账号", ${fans} >= 10000, "腰部账号", ${fans} > 0, "长尾账号", TRUE(), "待补充")`),
    formulaField('更新时间', displayDatetime(rawLookup(accountsTable, sourceKeyField, 'updated_at'))),
    formulaField('采集时间', displayDatetime(rawLookup(accountsTable, sourceKeyField, 'imported_at'))),
    textField('备注'),
  ];
}

function displayFieldSpecs(datasetName, tablePrefix) {
  if (datasetName === 'display_contents') return contentDisplayFields(tablePrefix);
  if (datasetName === 'display_interactions') return interactionDisplayFields(tablePrefix);
  if (datasetName === 'display_accounts') return accountDisplayFields(tablePrefix);
  return getFeishuDataset(datasetName).fields;
}

function displayAttachmentSpecs(datasetName, row = {}) {
  if (datasetName === 'display_contents') {
    return [{ field_name: '封面图', marker_field_name: '封面图来源链接', url: row.front_img_url, image_kind: 'cover' }];
  }
  if (datasetName === 'display_interactions') {
    return [{ field_name: '用户头像', marker_field_name: '用户头像来源链接', url: row.comment_user_photo, image_kind: 'avatar' }];
  }
  if (datasetName === 'display_accounts') {
    return [{ field_name: '头像', marker_field_name: '头像来源链接', url: row.account_photo, image_kind: 'avatar' }];
  }
  return [];
}

function displayViewSpecs(datasetName) {
  if (datasetName === 'display_contents') {
    return [
      {
        name: '内容画册',
        type: 'gallery',
        visible_fields: [
          '标题',
          '内容表现',
          '发布时间',
          '互动量',
        ],
        sort_config: [
          { field: '互动量', desc: true },
          { field: '发布时间', desc: true },
        ],
        card: { cover_field: '封面图' },
      },
    ];
  }
  return [];
}

export function buildFeishuDisplayPlans(datasets, {
  platform = '',
  tablePrefix = 'harvest',
  importedAt = nowDatetimeText(),
} = {}) {
  const groups = new Map();

  for (const item of datasets) {
    const rows = Array.isArray(item.rows) ? item.rows : [];
    if (item.dataset === 'works') {
      const displayRows = rows.map((row) => ({
        ...row,
        标题: ensureText(row.title) || ensureText(row.work_no),
        平台: platformLabel(row.platform || platform),
        账号ID: ensureText(row.account_id),
        作品ID: ensureText(row.work_no),
      }));
      addGroupedDisplayRows(groups, 'display_contents', 'works', displayRows, { platform, tablePrefix, importedAt });
    }

    if (item.dataset === 'comments' || item.dataset === 'messages' || item.dataset === 'danmaku') {
      const sourceType = item.dataset === 'comments'
        ? '评论'
        : item.dataset === 'messages'
          ? '私信'
          : '弹幕';
      const displayRows = rows.map((row) => ({
        ...row,
        用户昵称: ensureText(row.comment_user_name) || '未知用户',
        平台: platformLabel(row.platform || platform),
        来源类型: sourceType,
        跟进状态: ensureInt(row.intention) >= 3 ? '待跟进' : '观察',
      }));
      addGroupedDisplayRows(groups, 'display_interactions', item.dataset, displayRows, { platform, tablePrefix, importedAt });
    }

    if (item.dataset === 'accounts') {
      const displayRows = rows.map((row) => ({
        ...row,
        账号: ensureText(row.account_name) || ensureText(row.account_id),
        平台: platformLabel(row.platform || platform),
      }));
      addGroupedDisplayRows(groups, 'display_accounts', 'accounts', displayRows, { platform, tablePrefix, importedAt });
    }
  }

  return [...groups.values()].map((item) => ({
    ...item,
    rows: buildDisplayRows(item.fields, item.rows, { platform, importedAt }),
  }));
}
