export const DOUYIN_PLATFORM = 'douyin';
export const DOUYIN_SOURCE_PUBLIC = 'douyin_public';
export const DOUYIN_SOURCE_CREATOR_CENTER = 'douyin_creator_center';
export const DOUYIN_WEB_BASE = 'https://www.douyin.com';
export const DOUYIN_CREATOR_HOME_URL = 'https://creator.douyin.com/creator-micro/home';
export const DOUYIN_CREATOR_CONTENT_MANAGE_URL = 'https://creator.douyin.com/creator-micro/content/manage';
export const DOUYIN_CREATOR_COMMENT_MANAGE_URL = 'https://creator.douyin.com/creator-micro/interactive/comment';
export const DOUYIN_CREATOR_DANMAKU_MANAGE_URL = 'https://creator.douyin.com/creator-micro/danmaku-manage/manage';
export const DOUYIN_CREATOR_DANMAKU_MANAGE_ENTRY_URL = 'https://creator.douyin.com/goofy/douyin_creator_pc/douyin_creator_mid_video/#/manage';
export const DOUYIN_PRIVATE_MESSAGES_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
export const DOUYIN_CREATOR_API_SUMMARY_DEFAULT_CLICK_LABELS = '内容管理,作品管理,互动管理,评论管理,弹幕管理,数据中心,私信管理';
export const DOUYIN_CREATOR_TARGET_PAGES = [
  { id: 'home', label: '创作者中心首页', url: DOUYIN_CREATOR_HOME_URL },
  { id: 'content_manage', label: '内容管理/作品管理', url: DOUYIN_CREATOR_CONTENT_MANAGE_URL },
  { id: 'comment_manage', label: '互动管理/评论管理', url: DOUYIN_CREATOR_COMMENT_MANAGE_URL },
  { id: 'danmaku_manage', label: '互动管理/弹幕管理', url: DOUYIN_CREATOR_DANMAKU_MANAGE_URL },
  { id: 'private_messages', label: '互动管理/私信管理', url: DOUYIN_PRIVATE_MESSAGES_URL },
];
export const DOUYIN_USER_VIDEOS_PATH = '/aweme/v1/web/aweme/post/';
export const DOUYIN_COMMENT_LIST_PATH = '/aweme/v1/web/comment/list/';
export const DOUYIN_COMMENT_REPLY_LIST_PATH = '/aweme/v1/web/comment/list/reply/';

export function summarizeDouyinProtobufWireShape(value) {
  const bodyByteLength = (input) => {
    if (typeof input === 'string') return input.length;
    if (input instanceof ArrayBuffer) return input.byteLength;
    if (ArrayBuffer.isView(input)) return input.byteLength;
    if (typeof Blob !== 'undefined' && input instanceof Blob) return input.size;
    return 0;
  };
  const toUint8Array = (input) => {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  };
  const looksLikeUtf8Text = (bytes) => {
    if (!bytes || bytes.length === 0 || bytes.length > 2048) return false;
    let printable = 0;
    for (const byte of bytes) {
      if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) printable += 1;
      if (byte === 0) return false;
    }
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return decoded.trim().length > 0 && printable / bytes.length > 0.8;
    } catch {
      return false;
    }
  };
  const byteSignature = (bytes) => {
    if (!bytes || bytes.length === 0) return '';
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
    if (bytes[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[1])) return 'zlib';
    if (looksLikeUtf8Text(bytes)) return 'utf8-text';
    return 'binary';
  };
  const readVarint = (bytes, offset) => {
    let cursor = offset;
    let shift = 0;
    let decodedValue = 0n;
    while (cursor < bytes.length && shift <= 63) {
      const byte = bytes[cursor];
      decodedValue += BigInt(byte & 0x7f) << BigInt(shift);
      cursor += 1;
      if ((byte & 0x80) === 0) {
        const numberValue = decodedValue <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(decodedValue) : null;
        return { ok: true, value: numberValue, next: cursor, byteLength: cursor - offset };
      }
      shift += 7;
    }
    return { ok: false, next: cursor, byteLength: cursor - offset };
  };
  const parseProtoFields = (input, depth = 0, limit = 120) => {
    const bytes = toUint8Array(input);
    if (!bytes || bytes.length === 0 || depth > 4) {
      return { ok: false, byte_length: bytes?.length || 0, fields: [] };
    }
    const fields = [];
    let offset = 0;
    let guard = 0;
    while (offset < bytes.length && guard < limit) {
      guard += 1;
      const tag = readVarint(bytes, offset);
      if (!tag.ok || !tag.value) break;
      const fieldNumber = Math.floor(tag.value / 8);
      const wireType = tag.value % 8;
      if (fieldNumber <= 0 || wireType < 0 || wireType > 5 || wireType === 3 || wireType === 4) break;
      offset = tag.next;
      const entry = {
        field_no: fieldNumber,
        wire_type: wireType,
        tag_bytes: tag.byteLength,
      };
      if (wireType === 0) {
        const fieldValue = readVarint(bytes, offset);
        if (!fieldValue.ok) break;
        entry.value_type = 'varint';
        entry.value_bytes = fieldValue.byteLength;
        offset = fieldValue.next;
      } else if (wireType === 1) {
        if (offset + 8 > bytes.length) break;
        entry.value_type = 'fixed64';
        entry.value_bytes = 8;
        offset += 8;
      } else if (wireType === 2) {
        const length = readVarint(bytes, offset);
        if (!length.ok || offset + length.byteLength + length.value > bytes.length) break;
        offset = length.next;
        const start = offset;
        const end = offset + length.value;
        entry.value_type = 'length_delimited';
        entry.value_bytes = length.value;
        const slice = bytes.slice(start, end);
        entry.byte_signature = byteSignature(slice);
        entry.string_like = entry.byte_signature === 'utf8-text';
        const nested = parseProtoFields(slice, depth + 1, Math.max(20, Math.floor(limit / 2)));
        if (nested.fields.length > 0) {
          entry.nested_ok = Boolean(nested.ok && nested.consumed_bytes === length.value);
          entry.nested_consumed_bytes = nested.consumed_bytes || 0;
          entry.nested = nested.fields;
        }
        offset = end;
      } else if (wireType === 5) {
        if (offset + 4 > bytes.length) break;
        entry.value_type = 'fixed32';
        entry.value_bytes = 4;
        offset += 4;
      }
      fields.push(entry);
    }
    const ok = fields.length > 0 && offset === bytes.length;
    return {
      ok,
      byte_length: bytes.length,
      consumed_bytes: offset,
      truncated: offset < bytes.length,
      fields,
    };
  };
  const parsed = parseProtoFields(value);
  if (!parsed.fields.length) {
    return {
      ok: false,
      byte_length: parsed.byte_length || bodyByteLength(value),
      consumed_bytes: parsed.consumed_bytes || 0,
      truncated: Boolean(parsed.truncated),
      fields: [],
    };
  }
  const compact = (fields) => {
    const map = new Map();
    for (const field of fields) {
      const key = field.field_no + ':' + field.wire_type + ':' + field.value_type;
      const existing = map.get(key) || {
        field_no: field.field_no,
        wire_type: field.wire_type,
        value_type: field.value_type,
        count: 0,
        value_bytes_min: field.value_bytes || 0,
        value_bytes_max: field.value_bytes || 0,
        byte_signature: field.byte_signature,
        string_like: Boolean(field.string_like),
        nested_ok: field.nested_ok,
        nested_consumed_bytes: field.nested_consumed_bytes,
        nested: field.nested ? compact(field.nested) : undefined,
      };
      existing.count += 1;
      existing.value_bytes_min = Math.min(existing.value_bytes_min, field.value_bytes || 0);
      existing.value_bytes_max = Math.max(existing.value_bytes_max, field.value_bytes || 0);
      existing.string_like = existing.string_like || Boolean(field.string_like);
      if (!existing.byte_signature && field.byte_signature) existing.byte_signature = field.byte_signature;
      if (existing.nested_ok === undefined && field.nested_ok !== undefined) existing.nested_ok = field.nested_ok;
      if (!existing.nested_consumed_bytes && field.nested_consumed_bytes) existing.nested_consumed_bytes = field.nested_consumed_bytes;
      if (!existing.nested && field.nested) existing.nested = compact(field.nested);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((left, right) => left.field_no - right.field_no || left.wire_type - right.wire_type);
  };
  return {
    ok: parsed.ok,
    byte_length: parsed.byte_length,
    consumed_bytes: parsed.consumed_bytes,
    truncated: parsed.truncated,
    fields: compact(parsed.fields),
  };
}

export function attributeDouyinPrivateMessageRecordFields(responseBytes, options = {}) {
  const sampleLimit = Math.max(1, Math.min(500, Number(options.sample_limit || 30)));
  const includeValues = Boolean(options.include_values ?? options.includeValues);
  const toUint8Array = (input) => {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  };
  const looksLikeUtf8Text = (bytes) => {
    if (!bytes || bytes.length === 0 || bytes.length > 2048) return false;
    for (const byte of bytes) {
      if (byte === 0) return false;
    }
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return decoded.trim().length > 0;
    } catch {
      return false;
    }
  };
  const readVarint = (bytes, offset) => {
    let cursor = offset;
    let shift = 0;
    let decodedValue = 0n;
    while (cursor < bytes.length && shift <= 63) {
      const byte = bytes[cursor];
      decodedValue += BigInt(byte & 0x7f) << BigInt(shift);
      cursor += 1;
      if ((byte & 0x80) === 0) {
        const numberValue = decodedValue <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(decodedValue) : null;
        return { ok: true, value: numberValue, next: cursor, byteLength: cursor - offset };
      }
      shift += 7;
    }
    return { ok: false, next: cursor, byteLength: cursor - offset };
  };
  const parseFields = (input, depth = 0, limit = 1000) => {
    const bytes = toUint8Array(input);
    if (!bytes || bytes.length === 0 || depth > 6) {
      return { ok: false, byte_length: bytes?.length || 0, consumed_bytes: 0, truncated: Boolean(bytes?.length), fields: [] };
    }
    const fields = [];
    let offset = 0;
    let guard = 0;
    while (offset < bytes.length && guard < limit) {
      guard += 1;
      const tag = readVarint(bytes, offset);
      if (!tag.ok || !tag.value) break;
      const fieldNumber = Math.floor(tag.value / 8);
      const wireType = tag.value % 8;
      if (fieldNumber <= 0 || wireType < 0 || wireType > 5 || wireType === 3 || wireType === 4) break;
      offset = tag.next;
      const field = { field_no: fieldNumber, wire_type: wireType, tag_bytes: tag.byteLength };
      if (wireType === 0) {
        const value = readVarint(bytes, offset);
        if (!value.ok) break;
        field.value_type = 'varint';
        field.value_bytes = value.byteLength;
        field.numeric_hint = value.value;
        offset = value.next;
      } else if (wireType === 1) {
        if (offset + 8 > bytes.length) break;
        field.value_type = 'fixed64';
        field.value_bytes = 8;
        offset += 8;
      } else if (wireType === 2) {
        const length = readVarint(bytes, offset);
        if (!length.ok || offset + length.byteLength + length.value > bytes.length) break;
        offset = length.next;
        const start = offset;
        const end = offset + length.value;
        const slice = bytes.slice(start, end);
        field.value_type = 'length_delimited';
        field.value_bytes = length.value;
        field.string_like = looksLikeUtf8Text(slice);
        field.bytes = slice;
        const nested = parseFields(slice, depth + 1, Math.max(60, Math.floor(limit / 2)));
        if (nested.fields.length > 0) {
          field.nested_ok = Boolean(nested.ok && nested.consumed_bytes === length.value);
          field.nested = nested.fields;
        }
        offset = end;
      } else if (wireType === 5) {
        if (offset + 4 > bytes.length) break;
        field.value_type = 'fixed32';
        field.value_bytes = 4;
        offset += 4;
      }
      fields.push(field);
    }
    return {
      ok: fields.length > 0 && offset === bytes.length,
      byte_length: bytes.length,
      consumed_bytes: offset,
      truncated: offset < bytes.length,
      fields,
    };
  };
  const findFirstField = (fields, fieldNumber) => fields.find((field) => field.field_no === fieldNumber && Array.isArray(field.nested));
  const addRoleCandidate = (summary, role) => {
    if (!summary.role_candidates.includes(role)) summary.role_candidates.push(role);
  };
  const hashBytes = (bytes) => {
    let hash = 2166136261;
    for (const byte of bytes || []) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  const addSample = (summary, key, value, limit = 5) => {
    if (value === null || value === undefined) return;
    if (!summary[key]) summary[key] = [];
    if (summary[key].length >= limit || summary[key].includes(value)) return;
    summary[key].push(value);
  };
  const formatTimestamp = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '';
    const milliseconds = number > 1000000000000 ? number : number * 1000;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  const updateSummaryWithField = (byField, field, path, seenInRecord) => {
    const key = `${path}:${field.wire_type}:${field.value_type}`;
    const summary = byField.get(key) || {
      field_path: path,
      field_no: field.field_no,
      depth: path.split('.').length - 1,
      wire_type: field.wire_type,
      value_type: field.value_type,
      count: 0,
      record_coverage: 0,
      value_bytes_min: field.value_bytes || 0,
      value_bytes_max: field.value_bytes || 0,
      string_like_count: 0,
      nested_count: 0,
      numeric_min: null,
      numeric_max: null,
      timestamp_min: '',
      timestamp_max: '',
      enum_values: [],
      redacted_hash_samples: [],
      role_candidates: [],
    };
    summary.count += 1;
    if (!seenInRecord.has(key)) {
      summary.record_coverage += 1;
      seenInRecord.add(key);
    }
    summary.value_bytes_min = Math.min(summary.value_bytes_min, field.value_bytes || 0);
    summary.value_bytes_max = Math.max(summary.value_bytes_max, field.value_bytes || 0);
    if (field.string_like) summary.string_like_count += 1;
    if (Array.isArray(field.nested) && field.nested.length > 0) summary.nested_count += 1;
    if (field.value_type === 'varint' && typeof field.numeric_hint === 'number') {
      summary.numeric_min = summary.numeric_min === null ? field.numeric_hint : Math.min(summary.numeric_min, field.numeric_hint);
      summary.numeric_max = summary.numeric_max === null ? field.numeric_hint : Math.max(summary.numeric_max, field.numeric_hint);
      if ([0, 1, 2, 3, 4, 5].includes(field.numeric_hint)) addSample(summary, 'enum_values', field.numeric_hint);
      if (field.numeric_hint >= 1262304000 && field.numeric_hint <= 2208988800) {
        addRoleCandidate(summary, 'timestamp_seconds');
        const timeText = formatTimestamp(field.numeric_hint);
        summary.timestamp_min = summary.timestamp_min ? [summary.timestamp_min, timeText].sort()[0] : timeText;
        const sorted = summary.timestamp_max ? [summary.timestamp_max, timeText].sort() : [timeText];
        summary.timestamp_max = sorted[sorted.length - 1];
      }
      if (field.numeric_hint >= 1262304000000 && field.numeric_hint <= 2208988800000) {
        addRoleCandidate(summary, 'timestamp_milliseconds');
        const timeText = formatTimestamp(field.numeric_hint);
        summary.timestamp_min = summary.timestamp_min ? [summary.timestamp_min, timeText].sort()[0] : timeText;
        const sorted = summary.timestamp_max ? [summary.timestamp_max, timeText].sort() : [timeText];
        summary.timestamp_max = sorted[sorted.length - 1];
      }
      if ([0, 1, 2].includes(field.numeric_hint)) addRoleCandidate(summary, 'enum_or_direction');
    }
    if (field.value_type === 'length_delimited' && field.string_like) {
      addRoleCandidate(summary, field.value_bytes > 80 ? 'text_or_json_candidate' : 'id_or_short_text_candidate');
      addSample(summary, 'redacted_hash_samples', hashBytes(field.bytes));
    }
    if (field.value_type === 'length_delimited' && Array.isArray(field.nested) && field.nested.length > 0) {
      addRoleCandidate(summary, 'nested_object');
    }
    byField.set(key, summary);
  };
  const visitFields = (byField, fields, prefix, seenInRecord) => {
    for (const field of fields) {
      const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
      updateSummaryWithField(byField, field, path, seenInRecord);
      if (Array.isArray(field.nested) && field.nested.length > 0) {
        visitFields(byField, field.nested, path, seenInRecord);
      }
    }
  };
  const fieldsByPath = (fields, targetPath, prefix = '') => {
    const matches = [];
    for (const field of fields || []) {
      const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
      if (path === targetPath) matches.push(field);
      if (Array.isArray(field.nested) && field.nested.length > 0) {
        matches.push(...fieldsByPath(field.nested, targetPath, path));
      }
    }
    return matches;
  };
  const firstNumericByPath = (fields, targetPath) => fieldsByPath(fields, targetPath)
    .map((field) => field.numeric_hint)
    .find((value) => typeof value === 'number');
  const firstHashByPath = (fields, targetPath) => {
    const field = fieldsByPath(fields, targetPath).find((item) => item.bytes?.length);
    return field ? hashBytes(field.bytes) : '';
  };
  const hashSamplesByPath = (fields, targetPath, limit = 5) => {
    const hashes = [];
    for (const field of fieldsByPath(fields, targetPath)) {
      if (!field.bytes?.length) continue;
      const hash = hashBytes(field.bytes);
      if (!hashes.includes(hash)) hashes.push(hash);
      if (hashes.length >= limit) break;
    }
    return hashes;
  };
  const chooseTimestamp = (fields) => {
    const candidates = [
      ['10', firstNumericByPath(fields, '10')],
      ['3', firstNumericByPath(fields, '3')],
      ['5', firstNumericByPath(fields, '5')],
    ];
    for (const [path, value] of candidates) {
      if (typeof value !== 'number') continue;
      if (value >= 1262304000000 && value <= 2208988800000) {
        return { path, value, time: formatTimestamp(value) };
      }
      if (value >= 1262304000 && value <= 2208988800) {
        return { path, value, time: formatTimestamp(value) };
      }
    }
    return { path: '', value: '', time: '' };
  };
  const summarizePayloadField = (payload) => {
    if (!payload?.bytes?.length) {
      return {
        payload_hash: '',
        payload_kind: '',
        payload_json_keys: [],
        payload_field_count: 0,
        payload_field_paths: [],
      };
    }
    const hash = hashBytes(payload.bytes);
    let decoded = '';
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes);
    } catch {
      decoded = '';
    }
    const trimmed = decoded.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const json = JSON.parse(trimmed);
        return {
          payload_hash: hash,
          payload_kind: Array.isArray(json) ? 'json_array' : 'json_object',
          payload_json_keys: Array.isArray(json) ? [] : Object.keys(json).sort().slice(0, 20),
          payload_field_count: 0,
          payload_field_paths: [],
        };
      } catch {
        return {
          payload_hash: hash,
          payload_kind: 'json_like_text',
          payload_json_keys: [],
          payload_field_count: 0,
          payload_field_paths: [],
        };
      }
    }
    const fieldPaths = [];
    const collectPaths = (fields, prefix = '') => {
      for (const field of fields || []) {
        const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
        if (!fieldPaths.includes(path)) fieldPaths.push(path);
        if (Array.isArray(field.nested) && field.nested.length > 0) collectPaths(field.nested, path);
      }
    };
    if (Array.isArray(payload.nested) && payload.nested.length > 0 && payload.nested_ok !== false) {
      collectPaths(payload.nested);
      return {
        payload_hash: hash,
        payload_kind: 'protobuf_like',
        payload_json_keys: [],
        payload_field_count: payload.nested.length,
        payload_field_paths: fieldPaths.slice(0, 30),
      };
    }
    if (payload.string_like) {
      return {
        payload_hash: hash,
        payload_kind: 'utf8_text',
        payload_json_keys: [],
        payload_field_count: 0,
        payload_field_paths: [],
      };
    }
    const parsed = parseFields(payload.bytes, 0, 200);
    collectPaths(parsed.fields);
    return {
      payload_hash: hash,
      payload_kind: 'binary_or_unknown',
      payload_json_keys: [],
      payload_field_count: 0,
      payload_field_paths: fieldPaths.slice(0, 30),
    };
  };
  const extractPayloadRecordHints = (payload) => {
    const empty = {
      payload_timestamp_candidate: '',
      payload_timestamp_key: '',
      payload_timestamp_value: '',
      payload_text_hash: '',
      payload_text_key: '',
      payload_text: '',
    };
    const readHintsFromJson = (parsed) => {
      const source = Array.isArray(parsed) ? parsed.find((item) => item && typeof item === 'object') : parsed;
      if (!source || typeof source !== 'object') return null;
      const hints = { ...empty };
      const timestampKeys = ['createdAt', 'create_time', 'createTime', 'timestamp', 'time', 'server_time', 'serverTime', 'msg_time', 'msgTime'];
      for (const key of timestampKeys) {
        const formatted = formatTimestamp(source[key]);
        if (formatted) {
          hints.payload_timestamp_candidate = formatted;
          hints.payload_timestamp_key = key;
          hints.payload_timestamp_value = String(source[key] ?? '');
          break;
        }
      }
      const textKeys = ['text', 'content', 'msgHint', 'desc', 'hint'];
      for (const key of textKeys) {
        const value = typeof source[key] === 'string' ? source[key].trim() : '';
        if (!value) continue;
        hints.payload_text_hash = hashBytes(new TextEncoder().encode(value));
        hints.payload_text_key = key;
        hints.payload_text = value;
        break;
      }
      return hints;
    };
    const readHintsFromBytes = (bytes) => {
      if (!bytes?.length) return null;
      let decoded = '';
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
      const trimmed = decoded.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
      try {
        return readHintsFromJson(JSON.parse(trimmed));
      } catch {
        return null;
      }
    };
    const visitNestedPayload = (field, depth = 0) => {
      if (!field || depth > 4) return null;
      const direct = readHintsFromBytes(field.bytes);
      if (direct && (direct.payload_timestamp_candidate || direct.payload_text_hash)) return direct;
      for (const nested of field.nested || []) {
        const candidate = visitNestedPayload(nested, depth + 1);
        if (candidate && (candidate.payload_timestamp_candidate || candidate.payload_text_hash)) return candidate;
      }
      return null;
    };
    if (!payload?.bytes?.length) return empty;
    const direct = readHintsFromBytes(payload.bytes);
    if (direct && (direct.payload_timestamp_candidate || direct.payload_text_hash)) {
      return direct;
    }
    if (Array.isArray(payload.nested) && payload.nested.length > 0) {
      const nested = visitNestedPayload(payload);
      if (nested && (nested.payload_timestamp_candidate || nested.payload_text_hash)) return nested;
    }
    return empty;
  };
  const normalizeDirectionFromCandidates = (directionCandidates = []) => {
    const mapping = new Map();
    for (const item of Array.isArray(directionCandidates) ? directionCandidates : []) {
      const [path, rawValue] = String(item || '').split(':');
      const value = Number(rawValue);
      if (path && Number.isFinite(value)) mapping.set(path, value);
    }
    if (mapping.get('2') === 1) return 'outbound';
    if (mapping.get('2') === 2) return 'inbound';
    if (mapping.get('6') === 2) return 'outbound';
    if (mapping.get('6') === 1) return 'inbound';
    return 'inbound';
  };
  const classifyPayloadBytes = (payload, payloadKind) => {
    const empty = {
      value_shape: '',
      char_count: 0,
      charset: '',
      has_space: false,
      has_cjk: false,
      has_emoji: false,
      digit_ratio: 0,
    };
    if (!payload?.bytes?.length) return empty;
    if (payloadKind === 'json_array' || payloadKind === 'json_object' || payloadKind === 'json_like_text') {
      return { ...empty, value_shape: payloadKind, char_count: payload.value_bytes || 0 };
    }
    if (payloadKind === 'protobuf_like') {
      return { ...empty, value_shape: 'nested_object_candidate', char_count: payload.value_bytes || 0 };
    }
    let decoded = '';
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes);
    } catch {
      return { ...empty, value_shape: 'binary_or_unknown', char_count: payload.value_bytes || 0 };
    }
    const trimmed = decoded.trim();
    const chars = Array.from(trimmed);
    if (chars.length === 0) return { ...empty, value_shape: 'empty' };
    let ascii = 0;
    let alpha = 0;
    let cjk = 0;
    let digit = 0;
    let space = 0;
    let emoji = 0;
    for (const char of chars) {
      const code = char.codePointAt(0) || 0;
      if (code <= 0x7f) ascii += 1;
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) alpha += 1;
      if (code >= 48 && code <= 57) digit += 1;
      if (/\s/.test(char)) space += 1;
      if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1;
      if (code >= 0x1f300 && code <= 0x1faff) emoji += 1;
    }
    const digitRatio = Number((digit / chars.length).toFixed(3));
    const hasSpace = space > 0;
    const hasCjk = cjk > 0;
    const hasEmoji = emoji > 0;
    let shape = 'utf8_unknown_candidate';
    if (/^\d+$/.test(trimmed)) {
      shape = 'numeric_candidate';
    } else if (/^https?:\/\//i.test(trimmed)) {
      shape = 'url_candidate';
    } else if (/^[A-Za-z0-9_-]{12,}$/.test(trimmed) && !hasSpace && digit > 0) {
      shape = 'id_or_token_candidate';
    } else if (chars.length <= 8 && !hasSpace && cjk === 0 && alpha === 0) {
      shape = 'short_code_candidate';
    } else if (chars.length <= 80 && (alpha > 0 || cjk > 0 || hasEmoji)) {
      shape = 'human_phrase_candidate';
    } else if (chars.length > 80 && (alpha > 0 || cjk > 0 || hasEmoji)) {
      shape = 'long_human_phrase_candidate';
    }
    const charset = hasCjk
      ? 'cjk_mixed'
      : ascii === chars.length
        ? 'ascii'
        : 'unicode_mixed';
    return {
      value_shape: shape,
      char_count: chars.length,
      charset,
      has_space: hasSpace,
      has_cjk: hasCjk,
      has_emoji: hasEmoji,
      digit_ratio: digitRatio,
    };
  };
  const collectJsonLeafValueSamples = (value, prefix = '$', rows = [], depth = 0, limit = 40) => {
    if (rows.length >= limit || depth > 5 || value === null || value === undefined) return rows;
    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((item, index) => collectJsonLeafValueSamples(item, `${prefix}[${index}]`, rows, depth + 1, limit));
      return rows;
    }
    if (typeof value === 'object') {
      Object.entries(value).slice(0, 30).forEach(([key, child]) => {
        collectJsonLeafValueSamples(child, `${prefix}.${key}`, rows, depth + 1, limit);
      });
      return rows;
    }
    if (typeof value !== 'string' || !value.trim()) return rows;
    const bytes = new TextEncoder().encode(value);
    const shape = classifyPayloadBytes({ bytes, value_bytes: bytes.byteLength }, 'utf8_text');
    rows.push({
      json_leaf_path: prefix,
      value_hash: hashBytes(bytes),
      value_kind: 'json_string_leaf',
      value_bytes: bytes.byteLength,
      value_shape: shape.value_shape,
      char_count: shape.char_count,
      charset: shape.charset,
      has_space: shape.has_space,
      has_cjk: shape.has_cjk,
      has_emoji: shape.has_emoji,
      digit_ratio: shape.digit_ratio,
    });
    return rows;
  };
  const collectProtobufBranchSamples = (fields, prefix = '', rows = []) => {
    const summarizeBranchDescendants = (branchFields, branchPath) => {
      const descendantFieldPaths = [];
      const descendantValueKinds = [];
      let descendantFieldCount = 0;
      let descendantLengthDelimitedCount = 0;
      let descendantProtobufBranchCount = 0;
      let descendantUtf8TextCount = 0;
      let descendantHumanPhraseCount = 0;
      let descendantJsonLeafCount = 0;
      let descendantCjkLeafCount = 0;
      const walk = (nestedFields, nestedPrefix) => {
        for (const nestedField of nestedFields || []) {
          const nestedPath = nestedPrefix ? `${nestedPrefix}.${nestedField.field_no}` : String(nestedField.field_no);
          descendantFieldCount += 1;
          if (!descendantFieldPaths.includes(nestedPath)) descendantFieldPaths.push(nestedPath);
          if (nestedField.wire_type === 2 && nestedField.bytes?.length) {
            descendantLengthDelimitedCount += 1;
            const nestedSummary = summarizePayloadField(nestedField);
            const nestedShape = classifyPayloadBytes(nestedField, nestedSummary.payload_kind);
            if (!descendantValueKinds.includes(nestedSummary.payload_kind)) descendantValueKinds.push(nestedSummary.payload_kind);
            if (nestedSummary.payload_kind === 'protobuf_like') descendantProtobufBranchCount += 1;
            if (nestedSummary.payload_kind === 'utf8_text') descendantUtf8TextCount += 1;
            if (/human_phrase_candidate/.test(nestedShape.value_shape || '')) descendantHumanPhraseCount += 1;
            if (nestedShape.has_cjk) descendantCjkLeafCount += 1;
            if (nestedSummary.payload_kind === 'json_object' || nestedSummary.payload_kind === 'json_array') {
              try {
                const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(nestedField.bytes).trim());
                const jsonLeafSamples = collectJsonLeafValueSamples(parsed, '$', [], 0, 40);
                descendantJsonLeafCount += jsonLeafSamples.length;
                descendantHumanPhraseCount += jsonLeafSamples.filter((leaf) => /human_phrase_candidate/.test(leaf.value_shape || '')).length;
                descendantCjkLeafCount += jsonLeafSamples.filter((leaf) => leaf.has_cjk).length;
              } catch {
                // Ignore malformed JSON-like payloads during branch summarization.
              }
            }
          }
          if (Array.isArray(nestedField.nested) && nestedField.nested.length > 0) walk(nestedField.nested, nestedPath);
        }
      };
      walk(branchFields, branchPath);
      return {
        descendant_field_count: descendantFieldCount,
        descendant_length_delimited_count: descendantLengthDelimitedCount,
        descendant_protobuf_branch_count: descendantProtobufBranchCount,
        descendant_utf8_text_count: descendantUtf8TextCount,
        descendant_human_phrase_count: descendantHumanPhraseCount,
        descendant_json_leaf_count: descendantJsonLeafCount,
        descendant_cjk_leaf_count: descendantCjkLeafCount,
        descendant_value_kinds: descendantValueKinds,
        descendant_field_paths: descendantFieldPaths.slice(0, 40),
      };
    };
    for (const field of fields || []) {
      const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
      if (field.wire_type === 2 && field.bytes?.length) {
        const summary = summarizePayloadField(field);
        if (summary.payload_kind === 'protobuf_like' && Array.isArray(field.nested) && field.nested.length > 0) {
          rows.push({
            branch_field_path: path,
            branch_hash: summary.payload_hash,
            branch_value_bytes: field.value_bytes || 0,
            branch_field_count: summary.payload_field_count || 0,
            branch_field_paths: summary.payload_field_paths || [],
            ...summarizeBranchDescendants(field.nested, path),
          });
        }
      }
      if (Array.isArray(field.nested) && field.nested.length > 0) collectProtobufBranchSamples(field.nested, path, rows);
    }
    return rows;
  };
  const collectValueShapeSamples = (fields, prefix = '', rows = []) => {
    for (const field of fields || []) {
      const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
      if (field.wire_type === 2 && field.bytes?.length) {
        const summary = summarizePayloadField(field);
        const shape = classifyPayloadBytes(field, summary.payload_kind);
        rows.push({
          field_path: path,
          value_hash: summary.payload_hash,
          value_kind: summary.payload_kind,
          value_bytes: field.value_bytes || 0,
          value_shape: shape.value_shape,
          char_count: shape.char_count,
          charset: shape.charset,
          has_space: shape.has_space,
          has_cjk: shape.has_cjk,
          has_emoji: shape.has_emoji,
          digit_ratio: shape.digit_ratio,
        });
        if (summary.payload_kind === 'json_object' || summary.payload_kind === 'json_array') {
          try {
            const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(field.bytes).trim());
            const jsonLeafSamples = collectJsonLeafValueSamples(parsed, '$', [], 0, 40);
            for (const leaf of jsonLeafSamples) {
              rows.push({
                field_path: `${path}@${leaf.json_leaf_path}`,
                value_hash: leaf.value_hash,
                value_kind: leaf.value_kind,
                value_bytes: leaf.value_bytes,
                value_shape: leaf.value_shape,
                char_count: leaf.char_count,
                charset: leaf.charset,
                has_space: leaf.has_space,
                has_cjk: leaf.has_cjk,
                has_emoji: leaf.has_emoji,
                digit_ratio: leaf.digit_ratio,
              });
            }
          } catch {
            // Ignore malformed JSON-like payloads; the base payload row is still useful.
          }
        }
      }
      if (Array.isArray(field.nested) && field.nested.length > 0) {
        collectValueShapeSamples(field.nested, path, rows);
      }
    }
    return rows;
  };
  const summarizeField9Entries = (fields) => fieldsByPath(fields, '9').slice(0, 12).map((entry, index) => {
    const part1 = fieldsByPath(entry.nested || [], '1')[0];
    const part2 = fieldsByPath(entry.nested || [], '2')[0];
    const part2Summary = summarizePayloadField(part2);
    const part2Shape = classifyPayloadBytes(part2, part2Summary.payload_kind);
    return {
      field9_item_rank: index + 1,
      field9_hash: entry.bytes?.length ? hashBytes(entry.bytes) : '',
      field9_value_bytes: entry.value_bytes || 0,
      part1_hash: part1?.bytes?.length ? hashBytes(part1.bytes) : '',
      part1_value_bytes: part1?.value_bytes || 0,
      part2_hash: part2Summary.payload_hash,
      part2_kind: part2Summary.payload_kind,
      part2_value_bytes: part2?.value_bytes || 0,
      part2_json_keys: part2Summary.payload_json_keys,
      part2_field_count: part2Summary.payload_field_count,
      part2_field_paths: part2Summary.payload_field_paths,
      part2_value_shape: part2Shape.value_shape,
      part2_char_count: part2Shape.char_count,
      part2_charset: part2Shape.charset,
      part2_has_space: part2Shape.has_space,
      part2_has_cjk: part2Shape.has_cjk,
      part2_has_emoji: part2Shape.has_emoji,
      part2_digit_ratio: part2Shape.digit_ratio,
    };
  });
  const buildRecordRows = (parsedRecords) => parsedRecords.map((record, index) => {
    const timestamp = chooseTimestamp(record.fields);
    const enumPaths = ['2', '4', '6', '11', '12', '13', '17'];
    const directionCandidates = enumPaths
      .map((path) => [path, firstNumericByPath(record.fields, path)])
      .filter(([, value]) => [0, 1, 2, 3, 4, 5].includes(value))
      .map(([path, value]) => `${path}:${value}`);
    const payload = fieldsByPath(record.fields, '8')[0];
    const messageIdHash = firstHashByPath(record.fields, '1');
    const peerHashCandidates = [
      ...hashSamplesByPath(record.fields, '9.1', 3),
      ...hashSamplesByPath(record.fields, '9.2', 3),
    ].slice(0, 5);
    const metadataHashCandidates = hashSamplesByPath(record.fields, '14', 3);
    const payloadSummary = summarizePayloadField(payload);
    const payloadHints = extractPayloadRecordHints(payload);
    const {
      payload_timestamp_value: payloadTimestampValue,
      payload_text: payloadText,
      ...redactedPayloadHints
    } = payloadHints;
    const direction = normalizeDirectionFromCandidates(directionCandidates);
    const messageTime = payloadHints.payload_timestamp_candidate || timestamp.time || '';
    const messageTimestamp = String(payloadTimestampValue || timestamp.value || '');
    const field9Samples = summarizeField9Entries(record.fields);
    const field9PairHashes = field9Samples
      .map((item) => {
        const left = String(item?.part1_hash || '').trim();
        const right = String(item?.part2_hash || '').trim();
        return left || right ? `${left}>${right}` : '';
      })
      .filter(Boolean);
    const field9RankedPairHashes = field9Samples
      .map((item) => {
        const rank = Number(item?.field9_item_rank || 0);
        const left = String(item?.part1_hash || '').trim();
        const right = String(item?.part2_hash || '').trim();
        return rank > 0 && (left || right) ? `${rank}:${left}>${right}` : '';
      })
      .filter(Boolean);
    const protobufBranchSamples = collectProtobufBranchSamples(record.fields).slice(0, 40);
    const valueShapeSamples = collectValueShapeSamples(record.fields).slice(0, 80);
    const recordKey = [
      messageIdHash,
      timestamp.time,
      directionCandidates.join(','),
      payload?.value_bytes || 0,
      peerHashCandidates.join(','),
      metadataHashCandidates.join(','),
    ].join('|');
    return {
      record_rank: index + 1,
      record_key_hash: hashBytes(new TextEncoder().encode(recordKey)),
      message_id_hash: messageIdHash,
      timestamp_candidate: timestamp.time,
      timestamp_field_path: timestamp.path,
      direction_candidate_values: directionCandidates,
      payload_field_path: payload ? '8' : '',
      payload_value_bytes: payload?.value_bytes || 0,
      ...payloadSummary,
      ...redactedPayloadHints,
      ...(includeValues ? {
        direction,
        text: payloadText || '',
        timestamp: messageTimestamp,
        time: messageTime,
      } : {}),
      field9_samples: field9Samples,
      field9_pair_hashes: field9PairHashes,
      field9_ranked_pair_hashes: field9RankedPairHashes,
      protobuf_branch_samples: protobufBranchSamples,
      value_shape_samples: valueShapeSamples,
      peer_hash_candidates: peerHashCandidates,
      metadata_hash_candidates: metadataHashCandidates,
    };
  });
  const collectRecordArrayCandidates = (fields, prefix = '', rows = []) => {
    const groups = new Map();
    for (const field of fields || []) {
      if (field.wire_type === 2 && field.bytes && Array.isArray(field.nested) && field.nested.length > 0) {
        const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
        const key = `${path}[]`;
        const group = groups.get(key) || [];
        group.push(field);
        groups.set(key, group);
      }
    }
    for (const [candidatePath, records] of groups.entries()) {
      const sampled = records.slice(0, sampleLimit).map((field) => parseFields(field.bytes, 0, 500));
      const hasTimestamp = sampled.some((record) => Boolean(chooseTimestamp(record.fields).time));
      const hasPayload8 = sampled.some((record) => fieldsByPath(record.fields, '8').length > 0);
      const hasPayload50 = sampled.some((record) => fieldsByPath(record.fields, '50').length > 0);
      const hasTextishLeaf = sampled.some((record) => collectValueShapeSamples(record.fields).some((sample) => (
        sample.value_shape === 'human_phrase_candidate'
          || sample.value_kind === 'json_string_leaf'
          || /@\$\.text$/.test(String(sample.field_path || ''))
      )));
      const totalFieldCount = sampled.reduce((sum, record) => sum + (Array.isArray(record.fields) ? record.fields.length : 0), 0);
      const averageFieldCount = sampled.length > 0 ? totalFieldCount / sampled.length : 0;
      const preferredPath = /^(6\.(200|301)\.1\[]|6\.610\.1\.(4|6|50)\[])/.test(candidatePath);
      const hasCoreMessageSignals = hasTimestamp || hasPayload8 || hasPayload50;
      const score = records.length
        + (hasCoreMessageSignals ? 12 : 0)
        + (hasTimestamp ? 5 : 0)
        + (hasPayload8 ? 4 : 0)
        + (hasPayload50 ? 4 : 0)
        + (hasTextishLeaf ? 2 : 0)
        + (preferredPath ? 3 : 0)
        + (averageFieldCount >= 3 ? 2 : 0);
      if (hasCoreMessageSignals || (hasTextishLeaf && averageFieldCount >= 4)) {
        rows.push({
          candidate_path: candidatePath,
          records,
          score,
        });
      }
    }
    for (const field of fields || []) {
      if (Array.isArray(field.nested) && field.nested.length > 0) {
        const path = prefix ? `${prefix}.${field.field_no}` : String(field.field_no);
        collectRecordArrayCandidates(field.nested, path, rows);
      }
    }
    return rows;
  };
  const response = parseFields(responseBytes, 0, 2000);
  const candidateContainers = collectRecordArrayCandidates(response.fields)
    .sort((left, right) => right.score - left.score || right.records.length - left.records.length);
  const selected = candidateContainers[0] || {
    candidate_path: '6.200.1[]',
    records: [],
  };
  const records = selected.records;
  const sampled = records.slice(0, sampleLimit).map((field) => parseFields(field.bytes, 0, 500));
  const byField = new Map();
  for (const record of sampled) {
    const seenInRecord = new Set();
    visitFields(byField, record.fields, '', seenInRecord);
  }
  return {
    ok: records.length > 0,
    response_byte_length: toUint8Array(responseBytes)?.byteLength || 0,
    response_ok: response.ok,
    candidate_path: selected.candidate_path,
    record_count: records.length,
    sampled_record_count: sampled.length,
    record_samples: buildRecordRows(sampled),
    fields: Array.from(byField.values()).sort((left, right) => {
      const leftParts = left.field_path.split('.').map(Number);
      const rightParts = right.field_path.split('.').map(Number);
      for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
        if (diff) return diff;
      }
      return left.wire_type - right.wire_type;
    }),
  };
}

export function buildDouyinPrivateMessageApiFlatRows(apiRows = [], options = {}) {
  const includeOutbound = Boolean(options.include_outbound ?? options.includeOutbound);
  const threadRank = Math.max(0, Number(options.thread_rank ?? options.threadRank ?? 0));
  const threadLabel = String(options.thread_label ?? options.threadLabel ?? '').trim();
  const threadNickname = normalizeDouyinPrivateMessageNickname(threadLabel);
  const threadId = threadNickname
    || `dyapi-thread-${hashDouyinStableText(`${threadLabel}|${threadRank || 1}`)}`;
  const targetRows = (Array.isArray(apiRows) ? apiRows : [])
    .filter((row) => isDouyinPrivateMessageConversationApiPath(String(row?.url_path || ''))
      && Array.isArray(row?.message_record_field_summary?.record_samples)
      && row.message_record_field_summary.record_samples.length > 0);
  const firstTargetClickAt = Number(
    options.first_target_click_at
      ?? options.firstTargetClickAt
      ?? targetRows[0]?.click_result?.first_target_click_at
      ?? 0,
  ) || 0;
  const target = targetRows
    .sort((left, right) => {
      const leftConversation = /\/v1\/message\/get_by_conversation$/.test(String(left.url_path || '')) ? 1 : 0;
      const rightConversation = /\/v1\/message\/get_by_conversation$/.test(String(right.url_path || '')) ? 1 : 0;
      const leftAfterTargetClick = firstTargetClickAt > 0 && Number(left.captured_at || 0) >= firstTargetClickAt ? 1 : 0;
      const rightAfterTargetClick = firstTargetClickAt > 0 && Number(right.captured_at || 0) >= firstTargetClickAt ? 1 : 0;
      const leftTargetClickIndex = Number(left.target_click_index || 0);
      const rightTargetClickIndex = Number(right.target_click_index || 0);
      return rightConversation - leftConversation
        || rightAfterTargetClick - leftAfterTargetClick
        || rightTargetClickIndex - leftTargetClickIndex
        || Number(right.captured_at || 0) - Number(left.captured_at || 0)
        || Number(right.message_record_field_summary?.record_count || 0) - Number(left.message_record_field_summary?.record_count || 0);
    })[0];
  const recordSamples = Array.isArray(target?.message_record_field_summary?.record_samples)
    ? target.message_record_field_summary.record_samples
    : [];
  const seen = new Set();
  return recordSamples
    .map((record, index) => {
      const text = String(record.text || '').trim();
      const direction = String(record.direction || '').trim() || 'inbound';
      const time = String(record.time || record.payload_timestamp_candidate || record.timestamp_candidate || '').trim();
      const timestamp = String(record.timestamp || '').trim();
      const messageId = buildDouyinPrivateMessageId({
        threadId,
        direction,
        timestamp: time || timestamp,
        text,
        index,
      });
      return {
        row_rank: 0,
        thread_rank: threadRank || 1,
        thread_id: threadId,
        thread_nickname: threadNickname,
        message_rank: Number(record.record_rank || index + 1),
        api_record_rank: Number(record.record_rank || index + 1),
        message_id: messageId,
        message_id_hash: String(record.message_id_hash || ''),
        sender_name: direction === 'outbound' ? '我' : threadNickname,
        direction,
        content_source: 'api',
        interaction_source: 'dom_click_then_api_capture',
        direction_source: 'candidate_heuristic',
        direction_signal_sources: [],
        direction_signal_hits: [],
        direction_signal_score: 0,
        direction_signal_opposite_score: 0,
        direction_candidate_values: Array.isArray(record.direction_candidate_values) ? record.direction_candidate_values : [],
        peer_hash_candidates: Array.isArray(record.peer_hash_candidates) ? record.peer_hash_candidates : [],
        metadata_hash_candidates: Array.isArray(record.metadata_hash_candidates) ? record.metadata_hash_candidates : [],
        field9_part1_hashes: Array.isArray(record.field9_samples)
          ? record.field9_samples.map((item) => String(item?.part1_hash || '')).filter(Boolean).slice(0, 5)
          : [],
        field9_part2_hashes: Array.isArray(record.field9_samples)
          ? record.field9_samples.map((item) => String(item?.part2_hash || '')).filter(Boolean).slice(0, 5)
          : [],
        field9_pair_hashes: Array.isArray(record.field9_pair_hashes)
          ? record.field9_pair_hashes.map((item) => String(item || '')).filter(Boolean).slice(0, 8)
          : [],
        field9_ranked_pair_hashes: Array.isArray(record.field9_ranked_pair_hashes)
          ? record.field9_ranked_pair_hashes.map((item) => String(item || '')).filter(Boolean).slice(0, 8)
          : [],
        text,
        message_type: String(record.payload_text_key || 'text'),
        timestamp,
        time,
        source_url_path: String(target?.url_path || ''),
        candidate_path: String(target?.message_record_field_summary?.candidate_path || ''),
      };
    })
    .filter((row) => row.text && !isDouyinUnsupportedPrivateMessageText(row.text))
    .filter((row) => includeOutbound || row.direction === 'inbound')
    .filter((row) => {
      const key = [row.message_id, row.thread_id, row.text].join('\0');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row, index) => ({
      ...row,
      row_rank: index + 1,
    }));
}

export function applyDouyinPrivateMessageDomDirectionOverrides(apiRows = [], domRows = []) {
  const list = Array.isArray(apiRows) ? apiRows : [];
  const domList = Array.isArray(domRows) ? domRows : [];
  const domByHash = new Map();
  for (const row of domList) {
    const text = String(row?.text || '').trim();
    const direction = String(row?.direction || '').trim();
    if (!text || !direction) continue;
    const textHash = hashDouyinUtf8Text(text);
    const matches = domByHash.get(textHash) || [];
    matches.push(row);
    domByHash.set(textHash, matches);
  }
  return list.map((row) => {
    const text = String(row?.text || '').trim();
    if (!text) return row;
    const matches = domByHash.get(hashDouyinUtf8Text(text)) || [];
    if (matches.length !== 1) return row;
    const domRow = matches[0];
    const domDirection = String(domRow.direction || '').trim();
    if (!domDirection) return row;
    return {
      ...row,
      direction: domDirection,
      direction_source: 'dom_match',
      direction_signal_sources: ['dom_text_match'],
      direction_signal_hits: [hashDouyinUtf8Text(text)],
      direction_signal_score: 100,
      direction_signal_opposite_score: 0,
      sender_name: domDirection === 'outbound' ? '我' : String(row.thread_nickname || row.sender_name || '').trim(),
    };
  });
}

export function applyDouyinPrivateMessageVisibleFingerprintDirectionOverrides(apiRows = []) {
  const list = Array.isArray(apiRows) ? apiRows : [];
  const unique = (values) => Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
  const onlyInLeft = (left, right) => left.filter((value) => !right.includes(value));
  const matchedRows = list.filter((row) => row?.direction_source === 'dom_match');
  if (!matchedRows.length) {
    return list;
  }
  const inboundRows = matchedRows.filter((row) => row?.direction === 'inbound');
  const outboundRows = matchedRows.filter((row) => row?.direction === 'outbound');
  if (!inboundRows.length || !outboundRows.length) {
    return list;
  }
  const flatten = (rows, key) => unique(rows.flatMap((row) => Array.isArray(row?.[key]) ? row[key] : []));
  const sourceSpecs = [
    { key: 'metadata_hash_candidates', label: 'metadata', weight: 3, strong: true },
    { key: 'field9_part1_hashes', label: 'field9_part1', weight: 1, strong: false },
    { key: 'field9_part2_hashes', label: 'field9_part2', weight: 1, strong: false },
    { key: 'field9_pair_hashes', label: 'field9_pair', weight: 2, strong: true },
    { key: 'field9_ranked_pair_hashes', label: 'field9_ranked_pair', weight: 3, strong: true },
  ];
  const signalSets = {
    inbound: Object.fromEntries(sourceSpecs.map((spec) => [
      spec.label,
      onlyInLeft(flatten(inboundRows, spec.key), flatten(outboundRows, spec.key)),
    ])),
    outbound: Object.fromEntries(sourceSpecs.map((spec) => [
      spec.label,
      onlyInLeft(flatten(outboundRows, spec.key), flatten(inboundRows, spec.key)),
    ])),
  };
  if (!Object.values(signalSets.inbound).some((values) => values.length) && !Object.values(signalSets.outbound).some((values) => values.length)) {
    return list;
  }
  return list.map((row) => {
    if (row?.direction_source === 'dom_match') {
      return row;
    }
    const bucketHits = {
      inbound: [],
      outbound: [],
    };
    for (const spec of sourceSpecs) {
      const values = unique(Array.isArray(row?.[spec.key]) ? row[spec.key] : []);
      if (!values.length) continue;
      const inboundMatches = values.filter((value) => signalSets.inbound[spec.label].includes(value));
      const outboundMatches = values.filter((value) => signalSets.outbound[spec.label].includes(value));
      if (inboundMatches.length) {
        bucketHits.inbound.push({ ...spec, hits: inboundMatches });
      }
      if (outboundMatches.length) {
        bucketHits.outbound.push({ ...spec, hits: outboundMatches });
      }
    }
    const summarizeScore = (entries) => ({
      score: entries.reduce((sum, entry) => sum + Number(entry.weight || 0), 0),
      strong: entries.some((entry) => Boolean(entry.strong)),
      sources: unique(entries.map((entry) => entry.label)),
      hits: unique(entries.flatMap((entry) => entry.hits.map((hit) => `${entry.label}:${hit}`))),
    });
    const inboundScore = summarizeScore(bucketHits.inbound);
    const outboundScore = summarizeScore(bucketHits.outbound);
    if (!inboundScore.score && !outboundScore.score) {
      return row;
    }
    if (inboundScore.score === outboundScore.score) {
      return row;
    }
    const winner = inboundScore.score > outboundScore.score
      ? { direction: 'inbound', own: inboundScore, other: outboundScore }
      : { direction: 'outbound', own: outboundScore, other: inboundScore };
    const scoreMargin = winner.own.score - winner.other.score;
    const hasEnoughEvidence = (winner.own.strong || winner.own.sources.length >= 2)
      && scoreMargin >= 4;
    if (!hasEnoughEvidence) {
      return row;
    }
    return {
      ...row,
      direction: winner.direction,
      direction_source: 'visible_fingerprint',
      direction_signal_sources: winner.own.sources,
      direction_signal_hits: winner.own.hits,
      direction_signal_score: winner.own.score,
      direction_signal_opposite_score: winner.other.score,
      sender_name: winner.direction === 'outbound' ? '我' : String(row.thread_nickname || row.sender_name || '').trim(),
    };
  });
}

function isZeroLike(value) {
  const text = String(value ?? '').trim();
  return !text || text === '0';
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

export function looksLikeSecUid(value = '') {
  const text = String(value ?? '').trim();
  return text.length > 8
    && !text.includes(' ')
    && !text.startsWith('http')
    && !text.startsWith('@')
    && !text.includes('/');
}

export function extractDouyinSecUidFromUrl(input = '') {
  const value = String(input ?? '').trim();
  if (!value) {
    return '';
  }

  const directMatch = value.match(/\/user\/([^/?#]+)/i);
  if (directMatch?.[1]) {
    return decodeURIComponent(directMatch[1]);
  }

  try {
    const url = new URL(value);
    const queryValue = pickFirstNonEmpty(
      url.searchParams.get('sec_uid'),
      url.searchParams.get('secUid'),
      url.searchParams.get('sec_user_id'),
    );
    return queryValue ? decodeURIComponent(queryValue) : '';
  } catch {
    return '';
  }
}

function extractJsonStringByKey(html, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i');
  const match = String(html ?? '').match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function extractDouyinUserProfileFromHtml(html = '') {
  const content = String(html ?? '');
  if (!content.trim()) {
    return {
      sec_uid: '',
      uid: '',
      nickname: '',
      unique_id: '',
      short_id: '',
    };
  }

  return {
    sec_uid: pickFirstNonEmpty(
      extractJsonStringByKey(content, 'secUid'),
      extractJsonStringByKey(content, 'sec_uid'),
      extractJsonStringByKey(content, 'sec_user_id'),
    ),
    uid: pickFirstNonEmpty(
      extractJsonStringByKey(content, 'uid'),
      extractJsonStringByKey(content, 'userId'),
    ),
    nickname: pickFirstNonEmpty(
      extractJsonStringByKey(content, 'nickname'),
      extractJsonStringByKey(content, 'nickName'),
    ),
    unique_id: pickFirstNonEmpty(
      extractJsonStringByKey(content, 'uniqueId'),
      extractJsonStringByKey(content, 'unique_id'),
    ),
    short_id: pickFirstNonEmpty(
      extractJsonStringByKey(content, 'shortId'),
      extractJsonStringByKey(content, 'short_id'),
    ),
  };
}

export function normalizeDouyinIdentifier(input = '') {
  const value = String(input ?? '').trim();

  if (!value) {
    return {
      raw: '',
      source: 'empty',
      sec_uid: '',
      profile_url: '',
    };
  }

  if (looksLikeSecUid(value)) {
    return {
      raw: value,
      source: 'sec_uid',
      sec_uid: value,
      profile_url: `https://www.douyin.com/user/${value}`,
    };
  }

  if (/^https?:\/\//i.test(value)) {
    const secUid = extractDouyinSecUidFromUrl(value);
    return {
      raw: value,
      source: 'url',
      sec_uid: secUid,
      profile_url: value,
    };
  }

  return {
    raw: value.replace(/^@/, ''),
    source: 'username',
    sec_uid: '',
    profile_url: '',
  };
}

export function resolveDouyinIdentifier(input = '', artifacts = {}) {
  const normalized = normalizeDouyinIdentifier(input);
  const finalUrl = String(artifacts.final_url ?? artifacts.finalUrl ?? '').trim();
  const html = String(artifacts.html ?? '').trim();
  const urlSecUid = extractDouyinSecUidFromUrl(finalUrl || normalized.profile_url);
  const profile = extractDouyinUserProfileFromHtml(html);
  const secUid = pickFirstNonEmpty(normalized.sec_uid, urlSecUid, profile.sec_uid);
  const profileUrl = pickFirstNonEmpty(
    finalUrl,
    normalized.profile_url,
    secUid ? `https://www.douyin.com/user/${secUid}` : '',
  );

  return {
    identifier: normalized.raw,
    source: normalized.source,
    sec_uid: secUid,
    uid: profile.uid,
    nickname: profile.nickname,
    unique_id: profile.unique_id,
    short_id: profile.short_id,
    profile_url: profileUrl,
    resolved: Boolean(secUid),
  };
}

export function formatDouyinTimestamp(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return text;
  }

  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalizeDouyinDuration(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 1000 ? Math.round(numeric / 1000) : Math.round(numeric);
}

export function normalizeDouyinVideo(item = {}) {
  const duration = normalizeDouyinDuration(item.duration ?? item.video?.duration ?? 0);
  const images = Array.isArray(item.images) ? item.images : [];
  const providedImageUrls = Array.isArray(item.image_urls) ? item.image_urls : [];
  const normalizedImageUrls = images
    .map((image) => pickFirstNonEmpty(
      image?.url_list?.[0],
      image?.url,
      image?.uri,
    ))
    .filter(Boolean);
  const imageUrls = [
    ...providedImageUrls,
    ...normalizedImageUrls,
  ].filter(Boolean);
  const playUrl = String(item.play_url ?? item.video?.play_addr?.url_list?.[0] ?? '');
  const hasVideo = Boolean(playUrl) || duration > 0;
  const imageCount = imageUrls.length || images.length;
  const explicitFileType = Number(item.file_type ?? item.fileType ?? 0);
  const awemeType = item.aweme_type ?? item.awemeType ?? '';
  const mediaType = item.media_type ?? item.mediaType ?? '';
  const isImageTextByType = (Number(awemeType) === 68 || Number(mediaType) === 2) && imageCount > 0 && duration === 0;

  return {
    data_source: String(item.data_source ?? item.source ?? DOUYIN_SOURCE_PUBLIC),
    aweme_id: String(item.aweme_id ?? item.id ?? ''),
    title: String(item.title ?? item.desc ?? '').trim(),
    file_type: explicitFileType === 2 || isImageTextByType || (!hasVideo && imageCount > 0) ? 2 : 1,
    aweme_type: awemeType,
    media_type: mediaType,
    image_count: imageCount,
    image_urls: imageUrls,
    cover_url: String(
      item.cover_url
      ?? item.video?.cover?.url_list?.[0]
      ?? item.video?.origin_cover?.url_list?.[0]
      ?? imageUrls[0]
      ?? item.cover?.url
      ?? '',
    ),
    play_url: playUrl,
    create_time: formatDouyinTimestamp(item.create_time ?? ''),
    digg_count: Number(item.digg_count ?? item.statistics?.digg_count ?? 0),
    comment_count: Number(item.comment_count ?? item.statistics?.comment_count ?? 0),
    share_count: Number(item.share_count ?? item.statistics?.share_count ?? 0),
    duration,
  };
}

export async function extractDouyinVideosFromDom(page, limit = 20) {
  const rows = await page.evaluate(({ maxItems }) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]'));
    const seen = new Set();
    const results = [];

    function clean(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const type = href.includes('/note/') ? 'note' : 'video';
      const match = href.match(/\/(?:video|note)\/(\d+)/);
      const awemeId = match?.[1] || '';
      if (!awemeId || seen.has(awemeId)) {
        continue;
      }
      seen.add(awemeId);

      const image = anchor.querySelector('img');
      const textCandidates = [
        anchor.getAttribute('title'),
        anchor.getAttribute('aria-label'),
        image?.getAttribute('alt'),
        anchor.textContent,
      ]
        .map(clean)
        .filter(Boolean);

      results.push({
        aweme_id: awemeId,
        title: textCandidates[0] || '',
        file_type: type === 'note' ? 2 : 1,
        image_count: type === 'note' ? 1 : 0,
        image_urls: type === 'note' && image?.getAttribute('src') ? [image.getAttribute('src')] : [],
        cover_url: image?.getAttribute('src') || '',
        play_url: type === 'video' ? (href.startsWith('http') ? href : `https://www.douyin.com${href}`) : '',
        create_time: '',
        digg_count: 0,
        comment_count: 0,
        share_count: 0,
        duration: 0,
      });

      if (results.length >= maxItems) {
        break;
      }
    }

    return results;
  }, { maxItems: limit });

  return Array.isArray(rows) ? rows.map(normalizeDouyinVideo) : [];
}

export function normalizeDouyinComment(item = {}, awemeId = '', context = {}) {
  const commentId = String(item.comment_id ?? item.cid ?? item.id ?? '');
  const contextParentId = String(context.parent_comment_id ?? '');
  const contextRootId = String(context.root_comment_id ?? contextParentId ?? '');
  const rawReplyToReplyId = String(item.reply_to_reply_id ?? '');
  const replyToCommentId = isZeroLike(rawReplyToReplyId)
    ? String(context.reply_to_comment_id ?? contextParentId ?? '')
    : rawReplyToReplyId;
  const parentCommentId = String(item.parent_comment_id ?? contextParentId ?? (context.is_reply ? contextParentId : ''));
  const rootCommentId = context.is_reply
    ? String(contextRootId || parentCommentId || item.root_comment_id || '')
    : String(item.root_comment_id ?? contextRootId ?? parentCommentId ?? '');
  const ipLocation = pickFirstNonEmpty(
    item.ip_location,
    item.ip_label,
    item.ipLabel,
    item.label_text,
    item.account_region,
    item.user?.account_region,
    item.user?.ip_location,
  );

  return {
    data_source: String(item.data_source ?? item.source ?? DOUYIN_SOURCE_PUBLIC),
    comment_id: commentId,
    aweme_id: String(awemeId ?? item.aweme_id ?? ''),
    author: String(item.author ?? item.nickname ?? item.user?.nickname ?? '').trim(),
    avatar_url: String(item.avatar_url ?? item.user?.avatar_thumb?.url_list?.[0] ?? item.user?.avatar_medium?.url_list?.[0] ?? ''),
    text: String(item.text ?? item.content ?? '').trim(),
    time: formatDouyinTimestamp(item.time ?? item.create_time ?? item.create_time_text ?? ''),
    ip_location: ipLocation,
    digg_count: Number(item.digg_count ?? item.like_count ?? 0),
    reply_count: Number(item.reply_count ?? item.reply_comment_total ?? 0),
    reply_to: String(item.reply_to ?? context.reply_to ?? ''),
    reply_to_comment_id: replyToCommentId,
    parent_comment_id: parentCommentId,
    root_comment_id: rootCommentId,
    is_reply: Boolean(item.is_reply ?? context.is_reply ?? false),
  };
}

function normalizeDouyinMessageDirection(item = {}) {
  const value = String(
    item.direction
    ?? item.senderRole
    ?? item.message_direction
    ?? item.messageDirection
    ?? (item.fromSelf || item.isSelf || item.is_self || item.mine ? 'outbound' : ''),
  ).toLowerCase();
  if (/^(outbound|send|sent|self|mine|right)$/.test(value)) return 'outbound';
  if (/^(inbound|recv|receive|received|peer|other|left)$/.test(value)) return 'inbound';
  return 'inbound';
}

export function isDouyinGroupConversation(item = {}) {
  const typeText = String(
    item.conversation_type
    ?? item.conversationType
    ?? item.session_type
    ?? item.sessionType
    ?? item.chat_type
    ?? item.chatType
    ?? '',
  ).toLowerCase();
  const memberCount = Number(
    item.member_count
    ?? item.memberCount
    ?? item.participant_count
    ?? item.participantCount
    ?? 0,
  );
  const text = [
    item.thread_nickname,
    item.nickname,
    item.name,
    item.title,
    item.label,
    typeText,
  ].map((value) => String(value ?? '')).join(' ');
  return Boolean(item.is_group || item.isGroup || item.group || memberCount > 2 || /群聊|群消息|group/.test(text));
}

export function normalizeDouyinPrivateMessageNickname(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const cleaned = text
    .replace(/\s*(刚刚|\d+\s*分钟前|\d+\s*小时前|今天|昨天|前天|\d{1,2}:\d{2}|\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
    .trim();
  return cleaned || text;
}

export function normalizeDouyinPrivateMessageTabName(value) {
  const text = String(value ?? '').replace(/\s+/g, '').trim().toLowerCase();
  if (!text) return '';
  if (['全部', 'all'].includes(text)) return '全部';
  if (['朋友私信', '朋友', 'friends', 'friend'].includes(text)) return '朋友私信';
  if (['陌生人私信', '陌生人', 'strangers', 'stranger'].includes(text)) return '陌生人私信';
  if (['群消息', '群聊', 'groups', 'group'].includes(text)) return '群消息';
  return String(value ?? '').replace(/\s+/g, '').trim();
}

export function hashDouyinStableText(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashDouyinUtf8Text(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function isDouyinUnsupportedPrivateMessageText(value) {
  return /你收到一条新类型消息|请打开抖音app查看|请打开抖音 app 查看/.test(String(value ?? '').replace(/\s+/g, ' ').trim());
}

function normalizeDouyinPrivateMessageLimit(limit, fallback = 20) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(500, Math.max(1, Math.round(numeric)));
}

function isDouyinPrivateMessageRecordApiPath(urlPath) {
  const text = String(urlPath || '');
  return /\/v1\/message\/get_by_(user|conversation)$/.test(text)
    || /\/v1\/stranger\/get_messages$/.test(text);
}

function isDouyinPrivateMessageConversationApiPath(urlPath) {
  const text = String(urlPath || '');
  return /\/v1\/message\/get_by_conversation$/.test(text)
    || /\/v1\/stranger\/get_messages$/.test(text);
}

export function buildDouyinPrivateMessageId({
  threadId = '',
  direction = '',
  timestamp = '',
  text = '',
  index = 0,
} = {}) {
  const base = [
    threadId,
    direction,
    timestamp,
    text,
  ].map((value) => String(value ?? '')).join('|');
  const suffix = timestamp ? '' : `-${Math.max(1, Number(index || 0) + 1)}`;
  return `dymsg-${hashDouyinStableText(base)}${suffix}`;
}

export function normalizeDouyinPrivateMessageItem(item = {}, thread = {}, index = 0) {
  const direction = normalizeDouyinMessageDirection(item);
  const timestamp = String(
    item.timestamp
    ?? item.create_time
    ?? item.createTime
    ?? item.server_time
    ?? item.serverTime
    ?? item.time
    ?? '',
  );
  const text = String(item.text ?? item.content ?? item.rawContent ?? item.preview_text ?? '').trim();
  const rawSenderName = String(item.sender_name ?? item.senderName ?? item.sender ?? (direction === 'outbound' ? '我' : thread.nickname ?? '')).trim();
  return {
    rank: index + 1,
    message_id: String(
      item.message_id
      ?? item.messageId
      ?? item.msg_id
      ?? item.msgId
      ?? item.client_message_id
      ?? item.clientMessageId
      ?? item.id
      ?? buildDouyinPrivateMessageId({
        threadId: item.thread_id ?? item.conversation_id ?? item.conversationId ?? thread.thread_id ?? '',
        direction,
        timestamp,
        text,
        index,
      }),
    ),
    thread_id: String(item.thread_id ?? item.conversation_id ?? item.conversationId ?? thread.thread_id ?? ''),
    sender_name: direction === 'inbound' ? normalizeDouyinPrivateMessageNickname(rawSenderName) : rawSenderName,
    sender_avatar_url: String(item.sender_avatar_url ?? item.senderAvatarUrl ?? item.avatar_url ?? item.avatarUrl ?? '').trim(),
    direction,
    text,
    message_type: String(item.message_type ?? item.messageType ?? item.msg_type ?? item.msgType ?? item.type ?? 'text'),
    timestamp,
    time: formatDouyinTimestamp(timestamp),
  };
}

export function normalizeDouyinPrivateMessageThread(item = {}, index = 0) {
  const rawNickname = String(item.thread_nickname ?? item.nickname ?? item.name ?? item.title ?? '').trim();
  const threadId = String(
    item.thread_id
    ?? item.threadId
    ?? item.conversation_id
    ?? item.conversationId
    ?? item.session_id
    ?? item.sessionId
    ?? item.id
    ?? normalizeDouyinPrivateMessageNickname(rawNickname)
    ?? `douyin-thread-${index + 1}`,
  );
  const latestTimestamp = String(item.latest_timestamp ?? item.latestTimestamp ?? item.timestamp ?? item.time ?? '');
  const thread = {
    rank: index + 1,
    thread_id: threadId,
    nickname: normalizeDouyinPrivateMessageNickname(rawNickname),
    avatar_url: String(item.thread_avatar_url ?? item.avatar_url ?? item.avatarUrl ?? item.head_url ?? item.headUrl ?? '').trim(),
    preview_text: String(item.preview_text ?? item.previewText ?? item.last_message ?? item.lastMessage ?? '').trim(),
    latest_timestamp: latestTimestamp,
    latest_time: formatDouyinTimestamp(latestTimestamp),
    unread_count: String(item.unread_count ?? item.unreadCount ?? item.unread ?? ''),
    is_group: isDouyinGroupConversation(item),
    messages: [],
  };
  const messages = Array.isArray(item.messages) ? item.messages : [];
  thread.messages = messages.map((message, messageIndex) => normalizeDouyinPrivateMessageItem(message, thread, messageIndex));
  thread.message_count = thread.messages.length;
  return thread;
}

export function filterDouyinPrivateMessageThreads(threads = [], options = {}) {
  const rankFilter = Number(options.thread_rank ?? options.threadRank ?? 0);
  const keywordFilter = String(options.thread_keyword ?? options.threadKeyword ?? '').trim().toLowerCase();
  return (Array.isArray(threads) ? threads : []).filter((thread) => {
    if (rankFilter > 0 && Number(thread?.rank || 0) !== rankFilter) return false;
    if (!keywordFilter) return true;
    const text = [
      thread?.nickname,
      thread?.thread_id,
      thread?.preview_text,
    ].map((value) => String(value ?? '').toLowerCase()).join(' ');
    return text.includes(keywordFilter);
  });
}

export async function scrapeDouyinPrivateMessageThreadsFromDom(page, options = {}) {
  const limit = normalizeDouyinVideoLimit(options.limit ?? 20, 20);
  const messageLimit = normalizeDouyinPrivateMessageLimit(options.messageLimit ?? 20, 20);
  const threadRank = Math.max(0, Number(options.thread_rank ?? options.threadRank ?? 0));
  const threadKeyword = String(options.thread_keyword ?? options.threadKeyword ?? '').trim();
  const loadHistoryClicks = Math.max(0, Math.min(50, Number(options.load_history_clicks ?? options.loadHistoryClicks ?? 0)));
  const rawThreads = await page.evaluate(`
    (async () => {
    const maxThreads = ${JSON.stringify(limit)};
    const maxMessages = ${JSON.stringify(messageLimit)};
    const targetThreadRank = ${JSON.stringify(threadRank)};
    const targetThreadKeyword = ${JSON.stringify(threadKeyword)}.trim().toLowerCase();
    const historyClickCount = ${JSON.stringify(loadHistoryClicks)};
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
    };
    const isUnsupportedMessageText = ${isDouyinUnsupportedPrivateMessageText.toString()};
    const isGroupText = (value) => /群聊|群消息|group/i.test(normalize(value));
    const excludedMessageText = /发送|搜索|私信|关注|粉丝|作品|首页|推荐|朋友|我的|登录|扫码|查看更多|全部已读|没有更多|页面不见啦|查看Ta的主页|在线客服/;
    const excludedThreadText = /高清发布|发布作品|创作|数据|互动|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理/;
    const isThreadDateText = (value) => /^(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2})/.test(normalize(value));
    const cleanThreadName = (value) => normalize(value)
      .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
      .trim();
    const findPrivateTabRight = () => {
      const tabRight = Array.from(document.querySelectorAll('[role="tab"], a, button, div, p, span'))
        .filter((node) => isVisible(node))
        .map((node) => {
          const label = normalize(node.textContent);
          if (!/^(全部|朋友私信|陌生人私信|群消息)$/.test(label)) return 0;
          const rect = node.getBoundingClientRect();
          if (rect.top < 80 || rect.top > 280 || rect.width < 24 || rect.width > 220) return 0;
          return rect.right;
        })
        .reduce((max, value) => Math.max(max, value), 0);
      return tabRight ? Math.min(tabRight + 160, window.innerWidth * 0.48) : 0;
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pad2 = (value) => String(value).padStart(2, '0');
    const formatDate = (date, hour = '00', minute = '00') => [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
    ].join('-') + ' ' + pad2(hour) + ':' + pad2(minute) + ':00';
    const parseVisibleTime = (value) => {
      const text = normalize(value);
      const now = new Date();
      let match = text.match(/^今天\\s+(\\d{1,2}):(\\d{2})$/);
      if (match) return formatDate(now, match[1], match[2]);
      match = text.match(/^昨天\\s+(\\d{1,2}):(\\d{2})$/);
      if (match) {
        const date = new Date(now);
        date.setDate(date.getDate() - 1);
        return formatDate(date, match[1], match[2]);
      }
      match = text.match(/^前天\\s+(\\d{1,2}):(\\d{2})$/);
      if (match) {
        const date = new Date(now);
        date.setDate(date.getDate() - 2);
        return formatDate(date, match[1], match[2]);
      }
      match = text.match(/^(\\d{2})-(\\d{2})\\s+(\\d{1,2}):(\\d{2})$/);
      if (match) return now.getFullYear() + '-' + match[1] + '-' + match[2] + ' ' + pad2(match[3]) + ':' + match[4] + ':00';
      match = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s+(\\d{1,2}):(\\d{2})$/);
      if (match) return match[1] + '-' + pad2(match[2]) + '-' + pad2(match[3]) + ' ' + pad2(match[4]) + ':' + match[5] + ':00';
      return '';
    };
    const clickNode = (node) => {
      const rect = node.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      node.click?.();
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
    };
    const bodyText = normalize(document.body?.innerText || '');
    if (/页面不见啦|页面不存在|not found|404/i.test(bodyText)) return [];

    const findCards = () => {
      const inDetail = /全部私信/.test(normalize(document.body?.innerText || ''));
      const leftPanelRight = findPrivateTabRight();
      const candidates = Array.from(document.querySelectorAll('[role="gridcell"], [role="row"], [role="listitem"], li, a, button, div'));
      const cards = [];
      const seen = new Set();
      for (const node of candidates) {
        if (!isVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (inDetail) {
          const maxRight = leftPanelRight || window.innerWidth * 0.48;
          if (rect.left > maxRight + 16 || rect.right > maxRight + 48 || rect.top < 120 || rect.width < 200 || rect.width > 760 || rect.height < 36 || rect.height > 220) continue;
        } else if (rect.left < window.innerWidth * 0.18 || rect.left > window.innerWidth * 0.75 || rect.top < 100 || rect.width < 40 || rect.width > 760 || rect.height < 16 || rect.height > 220) {
          continue;
        }
        const text = normalize(node.textContent);
        if (!text || text.length > 240) continue;
        const image = node.querySelector?.('img');
        const imageUrl = image?.getAttribute('src') || '';
        if (!inDetail && /^(全部|朋友私信|陌生人私信|群消息)$/.test(text)) continue;
        if (inDetail && /全部私信|朋友私信|陌生人私信|群消息/.test(text)) continue;
        if (inDetail && !imageUrl) continue;
        const parts = Array.from(node.querySelectorAll?.('span, p, div') || [])
          .filter((child) => isVisible(child))
          .filter((child) => {
            const childText = normalize(child.textContent);
            if (!childText || childText.length > 80) return false;
            const repeatedByChild = Array.from(child.children || [])
              .some((grandchild) => isVisible(grandchild) && normalize(grandchild.textContent) === childText);
            return !repeatedByChild || childText.length <= 16;
          })
          .map((child) => normalize(child.textContent))
          .filter((part, index, array) => part && array.indexOf(part) === index);
        const nickname = parts
          .map((part) => cleanThreadName(part))
          .find((part) => part && !isThreadDateText(part) && !excludedMessageText.test(part))
          || cleanThreadName(text)
          || text.split(' ')[0]
          || '';
        if (excludedThreadText.test(nickname) || excludedThreadText.test(text)) continue;
        const seenKey = inDetail ? 'top:' + Math.round(rect.top / 80) : nickname;
        if (!nickname || seen.has(seenKey)) continue;
        seen.add(seenKey);
        const previewText = parts.find((part) => part !== nickname
          && cleanThreadName(part) !== nickname
          && !isThreadDateText(part)
          && !excludedMessageText.test(part)) || '';
        cards.push({
          node,
          threadId: node.getAttribute('data-conversation-id') || node.getAttribute('data-id') || nickname,
          nickname,
          avatarUrl: imageUrl,
          previewText,
          rawText: text,
          isGroup: isGroupText(text) || isGroupText(node.getAttribute('aria-label') || ''),
        });
        if (cards.length >= maxThreads) break;
      }
      return cards;
    };

    const findMessages = (thread) => {
      const candidates = Array.from(document.querySelectorAll('div, p, span'));
      const rows = [];
      const seen = new Set();
      const structuralLeftPanelRight = findPrivateTabRight();
      const detectedLeftPanelRight = candidates.reduce((maxRight, node) => {
        if (!isVisible(node)) return maxRight;
        const rect = node.getBoundingClientRect();
        const text = normalize(node.textContent);
        if (rect.left < window.innerWidth * 0.45
          && rect.right < window.innerWidth * 0.48
          && rect.top >= 120
          && rect.width >= 200
          && rect.width <= 760
          && rect.height >= 36
          && rect.height <= 220
          && text
          && text.length <= 280
          && !/全部私信|朋友私信|陌生人私信|群消息/.test(text)
          && !excludedThreadText.test(text)) {
          return Math.max(maxRight, rect.right);
        }
        return maxRight;
      }, 0);
      const leftPanelRight = structuralLeftPanelRight || detectedLeftPanelRight;
      const minMessageLeft = leftPanelRight
        ? leftPanelRight + 8
        : window.innerWidth * 0.20;
      const fallbackMessageLeft = leftPanelRight
        ? Math.max(window.innerWidth * 0.18, leftPanelRight - 90)
        : window.innerWidth * 0.20;
      const rectOfTextNode = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        range.detach?.();
        return rect;
      };
      const timeMarkers = candidates
        .map((node) => {
          if (!isVisible(node)) return null;
          const rect = node.getBoundingClientRect();
          const time = parseVisibleTime(node.textContent);
          if (!time || rect.left < minMessageLeft || rect.top < 72) return null;
          return { top: rect.top, time };
        })
        .filter(Boolean)
        .sort((left, right) => left.top - right.top);
      const cleanName = (value) => normalize(value)
        .replace(/(今天|昨天|前天|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}).*$/, '')
        .replace(/你收到一条新类型消息.*$/, '')
        .trim();
      for (const node of candidates) {
        if (!isVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < minMessageLeft || rect.top < 72 || rect.width < 18 || rect.width > 720 || rect.height < 16 || rect.height > 220) continue;
        const text = normalize(node.textContent);
        if (/^(今天|昨天|前天)(\\s+\\d{1,2}:\\d{2})?$/.test(text) || /^\\d{1,2}:\\d{2}$/.test(text) || /^\\d{2}-\\d{2}$/.test(text)) continue;
        if (/^(全部|朋友私信|陌生人私信|群消息)$/.test(text)) continue;
        if (!text || text.length > 1000 || excludedMessageText.test(text) || isUnsupportedMessageText(text)) continue;
        const childRepeatsText = Array.from(node.children || []).some((child) => isVisible(child) && normalize(child.textContent) === text);
        if (childRepeatsText && rect.width > 240) continue;
        const side = rect.left > window.innerWidth * 0.62 ? 'outbound' : 'inbound';
        const key = side + ':' + Math.round(rect.top / 8) + ':' + text;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          direction: side,
          senderName: side === 'outbound' ? '我' : thread.nickname,
          text,
          messageType: 'text',
          timestamp: [...timeMarkers].reverse().find((marker) => marker.top < rect.top)?.time || '',
          domTop: rect.top,
        });
      }
      const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (textWalker.nextNode()) {
        const textNode = textWalker.currentNode;
        const text = normalize(textNode.nodeValue);
        if (!text || text.length > 1000 || excludedMessageText.test(text) || isUnsupportedMessageText(text)) continue;
        if (/^(今天|昨天|前天)(\\s+\\d{1,2}:\\d{2})?$/.test(text) || /^\\d{1,2}:\\d{2}$/.test(text) || /^\\d{4}-\\d{1,2}-\\d{1,2}\\s+\\d{1,2}:\\d{2}$/.test(text) || /^\\d{2}-\\d{2}$/.test(text)) continue;
        if (/^(全部|朋友私信|陌生人私信|群消息)$/.test(text)) continue;
        if (text === thread.nickname || text === '查看Ta的主页') continue;
        const rect = rectOfTextNode(textNode);
        if (rect.left < fallbackMessageLeft || rect.top < 120 || rect.width < 8 || rect.width > 720 || rect.height < 8 || rect.height > 80) continue;
        const side = rect.left > window.innerWidth * 0.62 ? 'outbound' : 'inbound';
        const key = side + ':' + Math.round(rect.top / 8) + ':' + text;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          direction: side,
          senderName: side === 'outbound' ? '我' : thread.nickname,
          text,
          messageType: 'text',
          timestamp: [...timeMarkers].reverse().find((marker) => marker.top < rect.top)?.time || '',
          domTop: rect.top,
        });
      }
      const compactSeen = new Set();
      return rows
        .sort((left, right) => Number(left.domTop || 0) - Number(right.domTop || 0))
        .filter((row) => {
          const key = [row.direction, row.text, Math.round(Number(row.domTop || 0) / 24)].join(':');
          if (compactSeen.has(key)) return false;
          compactSeen.add(key);
          return true;
        })
        .slice(-maxMessages);
    };
    const findHistoryLoadButton = () => {
      const candidates = Array.from(document.querySelectorAll('button, div, span, a'))
        .filter((node) => isVisible(node))
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: normalize(node.textContent) }))
        .filter((item) => item.text === '加载')
        .filter((item) => item.rect.left >= window.innerWidth * 0.35
          && item.rect.right <= window.innerWidth * 0.92
          && item.rect.top >= 80
          && item.rect.bottom <= window.innerHeight - 80
          && item.rect.width >= 24
          && item.rect.width <= 220
          && item.rect.height >= 20
          && item.rect.height <= 96)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
      return candidates[0]?.node || null;
    };
    const findNonPlaceholderPreviewCard = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        const text = normalize(textNode.nodeValue);
        if (!text || text.length > 80) continue;
        if (isUnsupportedMessageText(text) || isThreadDateText(text)) continue;
        if (/^(全部|朋友私信|陌生人私信|群消息|首页|互动管理|私信管理|查看Ta的主页)$/.test(text)) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rect = range.getBoundingClientRect();
        range.detach?.();
        if (rect.left < window.innerWidth * 0.08
          || rect.left > window.innerWidth * 0.36
          || rect.top < 120
          || rect.width < 8
          || rect.height < 8) continue;
        let current = textNode.parentElement;
        while (current && current !== document.body) {
          const cardRect = current.getBoundingClientRect();
          if (cardRect.left >= window.innerWidth * 0.06
            && cardRect.left <= window.innerWidth * 0.38
            && cardRect.width >= 120
            && cardRect.height >= 28
            && cardRect.height <= 220
            && current.querySelector?.('img[src]')) {
            const rawText = normalize(current.textContent);
            return {
              node: current,
              threadId: cleanThreadName(rawText) || text,
              nickname: cleanThreadName(rawText) || text,
              avatarUrl: current.querySelector?.('img')?.getAttribute('src') || '',
              previewText: text,
              rawText,
              isGroup: isGroupText(rawText),
            };
          }
          current = current.parentElement;
        }
      }
      return null;
    };
    const findVisibleConversationClickPoints = () => {
      const points = Array.from(document.querySelectorAll('img[src]'))
        .filter((node) => isVisible(node))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            rect,
          };
        })
        .filter((item) => item.rect.left >= window.innerWidth * 0.08
          && item.rect.left <= window.innerWidth * 0.36
          && item.rect.top >= 120
          && item.rect.width >= 24
          && item.rect.width <= 96
          && item.rect.height >= 24
          && item.rect.height <= 96)
        .sort((left, right) => left.y - right.y);
      const seen = new Set();
      return points.filter((point) => {
        const key = Math.round(point.y / 24);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const findDetailScrollContainer = () => Array.from(document.querySelectorAll('div, section, main'))
      .filter((node) => isVisible(node))
      .map((node) => ({
        node,
        rect: node.getBoundingClientRect(),
        scrollHeight: Number(node.scrollHeight || 0),
        clientHeight: Number(node.clientHeight || 0),
        overflowY: String(window.getComputedStyle(node).overflowY || ''),
      }))
      .filter((item) => item.rect.left >= window.innerWidth * 0.3
        && item.rect.right <= window.innerWidth
        && item.rect.top >= 72
        && item.rect.height >= 180
        && item.scrollHeight > item.clientHeight + 40
        && /(auto|scroll|overlay)/i.test(item.overflowY))
      .sort((left, right) => right.rect.height - left.rect.height);
    const scrollDetailPaneToTop = async () => {
      const container = findDetailScrollContainer()[0]?.node || null;
      if (!container) return false;
      for (let index = 0; index < 3; index += 1) {
        container.scrollTop = 0;
        container.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(180);
      }
      return true;
    };
    const waitForHistoryLoadButton = async (retries = 6, waitMs = 250) => {
      for (let index = 0; index < retries; index += 1) {
        const button = findHistoryLoadButton();
        if (button) return button;
        await scrollDetailPaneToTop();
        await sleep(waitMs);
      }
      return null;
    };
    const clickHistoryLoadButtons = async () => {
      let clickedCount = 0;
      for (let index = 0; index < historyClickCount; index += 1) {
        await scrollDetailPaneToTop();
        const button = await waitForHistoryLoadButton();
        if (!button) break;
        clickNode(button);
        clickedCount += 1;
        await sleep(900);
      }
      return clickedCount;
    };
    const findCurrentThreadName = () => {
      const leftPanelRight = findPrivateTabRight() || window.innerWidth * 0.20;
      const candidates = Array.from(document.querySelectorAll('div, p, span'))
        .filter((node) => isVisible(node))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent).replace(/\\s*查看Ta的主页.*$/, '').trim();
          return { rect, text };
        })
        .filter((item) => item.rect.left >= leftPanelRight + 8
          && item.rect.left <= window.innerWidth * 0.72
          && item.rect.top >= 72
          && item.rect.top <= 150
          && item.rect.width >= 32
          && item.rect.width <= 420
          && item.text
          && item.text.length <= 32
          && !/^(全部|朋友私信|陌生人私信|群消息|通知|网址|抖音)$/.test(item.text)
          && !excludedMessageText.test(item.text)
          && !excludedThreadText.test(item.text));
      return cleanThreadName(candidates[0]?.text || '');
    };

    let cards = findCards();
    if (targetThreadRank > 0) {
      cards = cards.filter((card, index) => index + 1 === targetThreadRank);
    }
    if (targetThreadKeyword) {
      cards = cards.filter((card) => {
        const text = [card.nickname, card.threadId, card.previewText].map((value) => normalize(value).toLowerCase()).join(' ');
        return text.includes(targetThreadKeyword);
      });
    }
    if (!/全部私信/.test(normalize(document.body?.innerText || '')) && cards[0]) {
      const entryCard = (targetThreadRank > 0 || targetThreadKeyword)
        ? cards[0]
        : (cards.find((card) => !isUnsupportedMessageText(card.rawText || card.previewText || card.nickname)) || cards[0]);
      clickNode(entryCard.node);
      await sleep(1000);
      cards = findCards();
      if (targetThreadRank > 0) {
        cards = cards.filter((card, index) => index + 1 === targetThreadRank);
      }
      if (targetThreadKeyword) {
        cards = cards.filter((card) => {
          const text = [card.nickname, card.threadId, card.previewText].map((value) => normalize(value).toLowerCase()).join(' ');
          return text.includes(targetThreadKeyword);
        });
      }
    }
    const scanCards = (targetThreadRank > 0 || targetThreadKeyword)
      ? cards
      : cards.filter((card) => !isUnsupportedMessageText(card.rawText || card.previewText));
    const cardTargets = scanCards.map((card, index) => ({
      index,
      threadId: card.threadId,
      nickname: card.nickname,
      previewText: card.previewText,
      rawText: card.rawText,
    }));
    const threads = [];
    if (targetThreadRank === 0 && !targetThreadKeyword) {
      const currentThreadName = findCurrentThreadName();
      if (currentThreadName) {
        const currentMessages = findMessages({ nickname: currentThreadName });
        if (currentMessages.length > 0) {
          threads.push({
            threadId: currentThreadName,
            nickname: currentThreadName,
            avatarUrl: '',
            previewText: '',
            is_group: false,
            messages: currentMessages,
          });
        }
      }
    }
    for (const target of cardTargets) {
      const freshCards = findCards();
      const targetKeyword = normalize(target.nickname || target.threadId || target.previewText).toLowerCase();
      const card = freshCards.find((candidate) => candidate.threadId === target.threadId)
        || freshCards.find((candidate) => candidate.nickname === target.nickname)
        || freshCards.find((candidate) => {
          if (!targetKeyword) return false;
          const text = [
            candidate.nickname,
            candidate.threadId,
            candidate.previewText,
            candidate.rawText,
          ].map((value) => normalize(value).toLowerCase()).join(' ');
          return text.includes(targetKeyword);
        })
        || freshCards[target.index];
      if (!card) continue;
      clickNode(card.node);
      await sleep(700);
      if (!card.isGroup && historyClickCount > 0) {
        await clickHistoryLoadButtons();
      }
      threads.push({
        threadId: card.threadId,
        nickname: card.nickname,
        avatarUrl: card.avatarUrl,
        previewText: card.previewText,
        is_group: card.isGroup,
        messages: card.isGroup ? [] : findMessages(card),
      });
    }
    if (targetThreadRank === 0
      && !targetThreadKeyword
      && !threads.some((thread) => Array.isArray(thread.messages) && thread.messages.length > 0)) {
      const fallbackCard = findCards().find((card) => !card.isGroup && !isUnsupportedMessageText(card.rawText || card.previewText || card.nickname))
        || findNonPlaceholderPreviewCard();
      if (fallbackCard) {
        clickNode(fallbackCard.node);
        await sleep(1000);
        if (historyClickCount > 0) {
          await clickHistoryLoadButtons();
        }
        const messages = findMessages(fallbackCard);
        if (messages.length > 0) {
          threads.push({
            threadId: fallbackCard.threadId,
            nickname: fallbackCard.nickname,
            avatarUrl: fallbackCard.avatarUrl,
            previewText: fallbackCard.previewText,
            is_group: false,
            messages,
          });
        }
      }
    }
    if (targetThreadRank === 0
      && !targetThreadKeyword
      && !threads.some((thread) => Array.isArray(thread.messages) && thread.messages.length > 0)) {
      const points = findVisibleConversationClickPoints().slice(0, maxThreads);
      for (const point of points) {
        const target = document.elementFromPoint(point.x, point.y);
        if (!target) continue;
        clickNode(target);
        await sleep(900);
        const currentThreadName = findCurrentThreadName() || '抖音私信';
        const messages = findMessages({ nickname: currentThreadName });
        if (messages.length === 0) continue;
        threads.push({
          threadId: currentThreadName,
          nickname: currentThreadName,
          avatarUrl: '',
          previewText: '',
          is_group: false,
          messages,
        });
      }
    }
    return threads;
    })()
  `);

  return (Array.isArray(rawThreads) ? rawThreads : []).map((thread, index) => normalizeDouyinPrivateMessageThread(thread, index));
}

export function flattenDouyinPrivateMessages(threads = [], options = {}) {
  const includeOutbound = Boolean(options.include_outbound ?? options.includeOutbound);
  const includeGroups = Boolean(options.include_groups ?? options.includeGroups);
  const seen = new Set();
  return (Array.isArray(threads) ? threads : [])
    .filter((thread) => includeGroups || !thread.is_group)
    .flatMap((thread) => (Array.isArray(thread.messages) ? thread.messages : []).map((message, messageIndex) => ({
      row_rank: 0,
      thread_rank: thread.rank,
      thread_id: thread.thread_id,
      thread_nickname: thread.nickname,
      thread_avatar_url: thread.avatar_url,
      thread_preview_text: thread.preview_text,
      thread_latest_timestamp: thread.latest_timestamp,
      thread_latest_time: thread.latest_time,
      thread_unread_count: thread.unread_count,
      thread_message_count: thread.message_count,
      message_rank: messageIndex + 1,
      message_id: message.message_id,
      sender_name: message.sender_name,
      sender_avatar_url: message.direction === 'inbound' ? (message.sender_avatar_url || thread.avatar_url) : '',
      direction: message.direction,
      text: message.text,
      message_type: message.message_type,
      timestamp: message.timestamp,
      time: message.time,
    })))
    .filter((row) => row.text && !isDouyinUnsupportedPrivateMessageText(row.text))
    .filter((row) => includeOutbound || row.direction === 'inbound')
    .filter((row) => {
      const key = [row.message_id, row.thread_id, row.text].join('\0');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row, index) => ({
      ...row,
      row_rank: index + 1,
    }));
}

function inspectDouyinPrivateMessagePageStateBrowser() {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const isVisible = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
  };
  const bodyText = normalize(document.body?.innerText || '');
  const allNodes = () => Array.from(document.querySelectorAll('[role="tab"], [role="menuitem"], [role="listitem"], [role="link"], li, a, button, div, p, span'));
  const nodeText = (node) => normalize(node?.textContent || '');
  const sidebarNodes = () => allNodes().filter((node) => {
    if (!isVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    return rect.left < window.innerWidth * 0.28 && rect.top >= 72 && rect.width >= 36 && rect.height >= 20;
  });
  const excludedThreadText = /高清发布|发布作品|创作|数据|互动|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理/;
  const leftCards = Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div, p, span')).filter((node) => {
    if (!isVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    const text = normalize(node.textContent);
    return rect.left < window.innerWidth * 0.36
      && rect.right < window.innerWidth * 0.48
      && rect.top >= 120
      && rect.width >= 200
      && rect.width <= 680
      && rect.height >= 36
      && rect.height <= 220
      && text
      && text.length <= 280
      && !/全部私信|朋友私信|陌生人私信|群消息/.test(text)
      && !excludedThreadText.test(text);
  });
  const privateTabs = allNodes().filter((node) => isVisible(node) && /^(全部|朋友私信|陌生人私信|群消息)$/.test(nodeText(node)));
  const privateTabCount = privateTabs.length;
  const privateNavCount = sidebarNodes().filter((node) => /私信管理/.test(nodeText(node))).length;
  const interactionNavCount = sidebarNodes().filter((node) => /互动管理/.test(nodeText(node))).length;
  const selectedTabHint = normalize(window.__opencli_douyin_selected_private_tab || '');
  const activePrivateTabNode = privateTabs.find((node) => node.getAttribute?.('aria-selected') === 'true')
    || privateTabs.find((node) => /\b(active|current|selected)\b/i.test(String(node.className || '')))
    || privateTabs.find((node) => nodeText(node) === selectedTabHint);
  return {
    current_url: window.location.href,
    title: document.title || '',
    body_text_length: bodyText.length,
    url_looks_private: /creator-micro\/data\/following\/chat|\/following\/chat(?:[/?#]|$)/.test(window.location.href),
    has_private_tabs: /全部私信|朋友私信|陌生人私信|群消息/.test(bodyText) || privateTabCount > 0,
    private_tab_count: privateTabCount,
    private_tab_labels: Array.from(new Set(privateTabs.map((node) => nodeText(node)))),
    selected_private_tab_hint: selectedTabHint,
    active_private_tab: activePrivateTabNode ? nodeText(activePrivateTabNode) : '',
    left_card_count: leftCards.length,
    left_card_avatar_count: leftCards.filter((node) => Boolean(node.querySelector?.('img[src]'))).length,
    sidebar_private_nav_count: privateNavCount,
    sidebar_interaction_nav_count: interactionNavCount,
  };
}

function buildDouyinPrivateMessageDomSelectorsBrowser() {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const isVisible = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
  };
  const excludedThreadText = /高清发布|发布作品|创作|数据|互动|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理/;
  const excludedMessageText = /发送|搜索|私信|关注|粉丝|作品|首页|推荐|朋友|我的|登录|扫码|查看更多|全部已读|没有更多|页面不见啦/;
  const allNodes = () => Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div, p, span'));
  const findPrivateTabRight = () => {
    const tabRight = Array.from(document.querySelectorAll('[role="tab"], a, button, div, p, span'))
      .filter((node) => isVisible(node))
      .map((node) => {
        const label = normalize(node.textContent);
        if (!/^(全部|朋友私信|陌生人私信|群消息)$/.test(label)) return 0;
        const rect = node.getBoundingClientRect();
        if (rect.top < 80 || rect.top > 280 || rect.width < 24 || rect.width > 220) return 0;
        return rect.right;
      })
      .reduce((max, value) => Math.max(max, value), 0);
    return tabRight ? Math.min(tabRight + 160, window.innerWidth * 0.48) : 0;
  };
  const compactCardNodes = (nodes) => {
    const groups = new Map();
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const text = normalize(node.textContent);
      const key = [
        Math.round(rect.left / 12),
        Math.round(rect.top / 12),
        text.slice(0, 60),
      ].join('|');
      const current = groups.get(key);
      const hasImg = Boolean(node.querySelector?.('img[src]'));
      const area = rect.width * rect.height;
      if (!current) {
        groups.set(key, { node, hasImg, area });
        continue;
      }
      if ((hasImg && !current.hasImg) || (hasImg === current.hasImg && area > current.area)) {
        groups.set(key, { node, hasImg, area });
      }
    }
    return Array.from(groups.values()).map((item) => item.node);
  };
  const findEntryCards = () => allNodes().filter((node) => {
    if (!isVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    const text = normalize(node.textContent);
    return rect.left > window.innerWidth * 0.18
      && rect.left < window.innerWidth * 0.72
      && rect.top >= 100
      && rect.width >= 40
      && rect.width <= 720
      && rect.height >= 16
      && rect.height <= 190
      && text
      && text.length <= 260
      && !/^(全部|朋友私信|陌生人私信|群消息)$/.test(text)
      && !excludedThreadText.test(text);
  }).filter((node, index, nodes) => !nodes.some((other, otherIndex) => otherIndex !== index && other.contains?.(node) && normalize(other.textContent) === normalize(node.textContent)));
  const findLeftCards = () => allNodes().filter((node) => {
    if (!isVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    const text = normalize(node.textContent);
    const leftPanelRight = findPrivateTabRight();
    return rect.left < window.innerWidth * 0.36
      && (!leftPanelRight || rect.right <= leftPanelRight + 48)
      && rect.right < window.innerWidth * 0.48
      && rect.top >= 120
      && rect.width >= 180
      && rect.width <= 760
      && rect.height >= 36
      && rect.height <= 220
      && text
      && text.length <= 280
      && !/全部私信|朋友私信|陌生人私信|群消息/.test(text)
      && !excludedThreadText.test(text);
  }).filter((node, index, nodes) => !nodes.some((other, otherIndex) => otherIndex !== index && other.contains?.(node) && normalize(other.textContent) === normalize(node.textContent)));
  const findMessageCandidates = () => {
    const leftCards = compactCardNodes(findLeftCards());
    const structuralLeftPanelRight = findPrivateTabRight();
    const detectedLeftPanelRight = leftCards.reduce((maxRight, node) => Math.max(maxRight, node.getBoundingClientRect().right), 0);
    const leftPanelRight = structuralLeftPanelRight || detectedLeftPanelRight;
    const minMessageLeft = leftPanelRight
      ? leftPanelRight + 8
      : window.innerWidth * 0.20;
    return allNodes().filter((node) => {
      if (!isVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      const text = normalize(node.textContent);
      return rect.left >= minMessageLeft
        && rect.top >= 72
        && rect.width >= 18
        && rect.width <= 760
        && rect.height >= 16
        && rect.height <= 240
        && text
        && text.length <= 1000
        && !excludedMessageText.test(text);
    });
  };
  return {
    normalize,
    isVisible,
    findEntryCards: () => compactCardNodes(findEntryCards()),
    findLeftCards: () => compactCardNodes(findLeftCards()),
    findMessageCandidates,
  };
}

function ensureDouyinPrivateMessagePageBrowser(inspectState) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (node) => {
    if (!node || !(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
  };
  const allNodes = () => Array.from(document.querySelectorAll('[role="menuitem"], [role="tab"], [role="link"], a, button, div, p, span'));
  const sidebarNodes = () => allNodes().filter((node) => {
    if (!isVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    return rect.left < window.innerWidth * 0.28 && rect.top >= 72 && rect.width >= 36 && rect.height >= 20;
  });
  const findSidebarText = (pattern) => sidebarNodes().find((node) => pattern.test(normalize(node.textContent)));
  const clickNode = async (node, waitMs = 900) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    node.click?.();
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
    await sleep(waitMs);
    return true;
  };
  const isReady = (state) => Boolean(
    state?.has_private_tabs
      || (state?.url_looks_private && state?.left_card_count > 0 && state?.left_card_avatar_count > 0)
  );
  const waitForReady = async (timeoutMs = 3200, stepMs = 200) => {
    const startedAt = Date.now();
    let state = inspectState();
    while (!isReady(state) && Date.now() - startedAt < timeoutMs) {
      await sleep(stepMs);
      state = inspectState();
    }
    return state;
  };

  return (async () => {
    let state = inspectState();
    if (isReady(state)) return { ...state, entry_action: 'none' };

    const directPrivateNav = findSidebarText(/^私信管理$/) || findSidebarText(/私信管理/);
    if (directPrivateNav) {
      await clickNode(directPrivateNav, 1200);
      state = await waitForReady();
      if (isReady(state)) return { ...state, entry_action: 'private-nav' };
    }

    const interactionNav = findSidebarText(/^互动管理$/) || findSidebarText(/互动管理/);
    if (interactionNav) {
      await clickNode(interactionNav, 800);
      await sleep(300);
    }
    const privateNavAfterExpand = findSidebarText(/^私信管理$/) || findSidebarText(/私信管理/);
    if (privateNavAfterExpand) {
      await clickNode(privateNavAfterExpand, 1400);
      state = await waitForReady(4200, 250);
      return { ...state, entry_action: interactionNav ? 'interaction-then-private' : 'private-nav-retry' };
    }

    return { ...state, entry_action: interactionNav ? 'interaction-only' : 'not-found' };
  })();
}

async function selectDouyinPrivateMessageTab(page, tabName = '') {
  const normalizedTabName = normalizeDouyinPrivateMessageTabName(tabName);
  if (!normalizedTabName) return null;
  return page.evaluate(`
    (async () => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (node) => {
        if (!node || !(node instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
      };
      const clickNode = async (node, waitMs = 800) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        node.click?.();
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
        await sleep(waitMs);
        return true;
      };
      const countLeftCards = () => Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div, p, span'))
        .filter((node) => isVisible(node))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent);
          return rect.left < window.innerWidth * 0.36
            && rect.right < window.innerWidth * 0.52
            && rect.top >= 120
            && rect.width >= 180
            && rect.width <= 760
            && rect.height >= 36
            && rect.height <= 220
            && text
            && text.length <= 280
            && !/全部私信|朋友私信|陌生人私信|群消息/.test(text)
            && !/高清发布|发布作品|创作|数据|互动|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理/.test(text);
        }).length;
      const target = ${JSON.stringify(normalizedTabName)};
      window.__opencli_douyin_selected_private_tab = target;
      const collectTabs = () => {
        const allCandidates = Array.from(document.querySelectorAll('[role="tab"], a, button, div, p, span'))
          .filter((node) => isVisible(node))
          .map((node) => {
            const label = normalize(node.textContent);
            if (!/^(全部|朋友私信|陌生人私信|群消息)$/.test(label)) return null;
            const clickable = node.closest?.('[role="tab"], button, a') || node.parentElement || node;
            if (!clickable || !isVisible(clickable)) return null;
            const rect = clickable.getBoundingClientRect();
            if (rect.top < 80 || rect.top > 280 || rect.width < 24 || rect.height < 20) return null;
            return {
              node: clickable,
              label,
              rect,
              role: clickable.getAttribute?.('role') || '',
            };
          })
          .filter(Boolean)
          .sort((left, right) => {
            const leftScore = left.role === 'tab' ? 0 : 1;
            const rightScore = right.role === 'tab' ? 0 : 1;
            return leftScore - rightScore || left.rect.top - right.rect.top || left.rect.left - right.rect.left || right.rect.width - left.rect.width;
          });
        const seen = new Set();
        return allCandidates.filter((item) => {
          const key = [item.label, Math.round(item.rect.left / 4), Math.round(item.rect.top / 4), Math.round(item.rect.width / 4)].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const tabs = collectTabs();
      const matched = tabs.find((item) => item.label === target)?.node || null;
      if (!matched) {
        return {
          target_tab: target,
          found: false,
          clicked: false,
          active_private_tab: '',
          left_card_count: countLeftCards(),
          reload_attempted: false,
          candidate_labels: tabs.map((item) => item.label),
        };
      }
      await clickNode(matched, 900);
      let leftCardCount = countLeftCards();
      let reloadAttempted = false;
      if (target !== '全部' && leftCardCount === 0) {
        const allTab = tabs.find((item) => item.label === '全部')?.node || null;
        if (allTab) {
          reloadAttempted = true;
          await clickNode(allTab, 500);
          await clickNode(matched, 900);
          leftCardCount = countLeftCards();
        }
      }
      const activeCandidates = Array.from(document.querySelectorAll('[role="tab"], a, button, div, p, span'))
        .filter((node) => isVisible(node))
        .filter((node) => /^(全部|朋友私信|陌生人私信|群消息)$/.test(normalize(node.textContent)));
      const active = activeCandidates.find((node) => node.getAttribute?.('aria-selected') === 'true')
        || activeCandidates.find((node) => /\\b(active|current|selected)\\b/i.test(String(node.className || '')))
        || activeCandidates.find((node) => normalize(node.textContent) === target);
      return {
        target_tab: target,
        found: true,
        clicked: true,
        active_private_tab: active ? normalize(active.textContent) : target,
        left_card_count: leftCardCount,
        reload_attempted: reloadAttempted,
        candidate_labels: tabs.map((item) => item.label),
      };
    })()
  `);
}

export async function ensureDouyinPrivateMessagePage(page, kwargs = {}) {
  const tabName = normalizeDouyinPrivateMessageTabName(kwargs.tab_name ?? kwargs.tabName ?? kwargs.tab_keyword ?? kwargs.tabKeyword ?? '');
  const ensured = await page.evaluate(`
    (async () => {
      const inspectState = ${inspectDouyinPrivateMessagePageStateBrowser.toString()};
      const ensurePage = ${ensureDouyinPrivateMessagePageBrowser.toString()};
      return ensurePage(inspectState);
    })()
  `);
  if (tabName) {
    const tabResult = await selectDouyinPrivateMessageTab(page, tabName);
    return {
      ...ensured,
      tab_action: tabResult || null,
    };
  }
  return ensured;
}

async function shouldNavigateDouyinPrivateMessagePage(page, kwargs = {}) {
  if (Boolean(kwargs.skip_navigate ?? kwargs.skipNavigate)) {
    return false;
  }
  if (typeof page?.evaluate !== 'function') {
    return true;
  }
  try {
    const currentUrl = String(await page.evaluate('window.location.href')).trim();
    return !/creator\.douyin\.com\/creator-micro\/data\/following\/chat(?:[/?#]|$)/.test(currentUrl);
  } catch {
    return true;
  }
}

export async function fetchDouyinPrivateMessageRows(page, kwargs = {}) {
  if (await shouldNavigateDouyinPrivateMessagePage(page, kwargs)) {
    await page.goto(String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL));
    if (typeof page.wait === 'function') {
      await page.wait(2);
    }
  }
  await ensureDouyinPrivateMessagePage(page, kwargs);
  const hasThreadFilter = Number(kwargs.thread_rank ?? kwargs.threadRank ?? 0) > 0
    || String(kwargs.thread_keyword ?? kwargs.threadKeyword ?? '').trim();
  const keywordHints = hasThreadFilter || kwargs.disable_keyword_fallback || kwargs.disableKeywordFallback
    ? []
    : await collectDouyinPrivateMessageKeywordHints(page);
  const threads = await scrapeDouyinPrivateMessageThreadsFromDom(page, {
    limit: kwargs.all ? 50 : kwargs.limit,
    messageLimit: kwargs.all_messages ? (kwargs.message_limit ?? 200) : (kwargs.message_limit ?? 20),
    load_history_clicks: kwargs.load_history_clicks ?? kwargs.loadHistoryClicks ?? 0,
    thread_rank: kwargs.thread_rank ?? kwargs.threadRank ?? 0,
    thread_keyword: kwargs.thread_keyword ?? kwargs.threadKeyword ?? '',
  });
  const filteredThreads = filterDouyinPrivateMessageThreads(threads, kwargs);
  const rows = flattenDouyinPrivateMessages(filteredThreads, kwargs);
  if (rows.length > 0 || hasThreadFilter || kwargs.disable_keyword_fallback || kwargs.disableKeywordFallback) {
    return rows;
  }

  const collectProbeHints = async () => {
    await resetDouyinPrivateMessagePage(page, kwargs);
    const visibleThreads = await probeDouyinPrivateMessageThreadList(page, kwargs).catch(() => []);
    return Array.from(new Set((Array.isArray(visibleThreads) ? visibleThreads : [])
      .map((row) => normalizeDouyinPrivateMessageNickname(row?.thread_nickname || ''))
      .filter(Boolean)));
  };
  const collectRowsForHints = async (hints) => {
    const orderedHints = hints.slice().sort((left, right) => {
      const score = (value) => (/消息|电话|说|等会|喜欢|哈哈|[，。！？!?]/.test(String(value || '')) ? 0 : 1);
      return score(left) - score(right);
    });
    const output = [];
    for (const hint of orderedHints.slice(0, kwargs.all ? 50 : (kwargs.limit ?? 20))) {
      await resetDouyinPrivateMessagePage(page, kwargs);
      const primaryRows = await fetchDouyinPrivateMessageRows(page, {
        ...kwargs,
        thread_keyword: hint,
        disable_keyword_fallback: true,
      });
      if (primaryRows.length > 0) {
        output.push(...primaryRows);
        continue;
      }
      const shortHint = Array.from(hint).slice(0, 3).join('');
      if (!shortHint || shortHint === hint) continue;
      await resetDouyinPrivateMessagePage(page, kwargs);
      const shortRows = await fetchDouyinPrivateMessageRows(page, {
        ...kwargs,
        thread_keyword: shortHint,
        disable_keyword_fallback: true,
      });
      output.push(...shortRows);
    }
    return output;
  };
  const fallbackRows = await collectRowsForHints(keywordHints.length > 0 ? keywordHints : await collectProbeHints());
  if (fallbackRows.length > 0 || keywordHints.length === 0) return fallbackRows;
  const probeHints = (await collectProbeHints()).filter((hint) => !keywordHints.includes(hint));
  return collectRowsForHints(probeHints);
}

async function resetDouyinPrivateMessagePage(page, kwargs = {}) {
  if (typeof page?.goto === 'function') {
    await page.goto(String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL));
    if (typeof page.wait === 'function') {
      await page.wait(Math.max(1, Number(kwargs.wait_seconds ?? kwargs.waitSeconds ?? 2)));
    }
  }
  await ensureDouyinPrivateMessagePage(page, kwargs);
}

async function collectDouyinPrivateMessageKeywordHints(page) {
  if (typeof page?.evaluate !== 'function') return [];
  const hints = await page.evaluate(`
    (async () => {
      const domSelectors = ${buildDouyinPrivateMessageDomSelectorsBrowser.toString()}();
      const normalize = domSelectors.normalize;
      const isVisible = domSelectors.isVisible;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const clickNode = async (node, waitMs = 800) => {
        if (!node) return false;
        node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + Math.min(Math.max(rect.width * 0.18, 24), rect.width / 2);
        const clientY = rect.top + rect.height / 2;
        const target = document.elementFromPoint(clientX, clientY)
          || node.closest?.('li, a, button, [role="listitem"], [role="gridcell"], [role="button"], [role="link"]')
          || node;
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
        target.click?.();
        await sleep(waitMs);
        return true;
      };
      const cleanName = (value) => normalize(value)
        .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
        .trim();
      const isUnsupported = ${isDouyinUnsupportedPrivateMessageText.toString()};
      const isDateText = (value) => /^(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2})$/.test(normalize(value));
      const excludedName = /^(全选|全部私信|朋友私信|陌生人私信|群消息|首页|互动管理|私信管理|评论管理|弹幕管理|发送|查看Ta的主页)$/;
      const collectVisibleTextParts = (root) => {
        const parts = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const textNode = walker.currentNode;
          const text = normalize(textNode.nodeValue);
          const parent = textNode.parentElement;
          if (!text || !parent || !isVisible(parent)) continue;
          const range = document.createRange();
          range.selectNodeContents(textNode);
          const rect = range.getBoundingClientRect();
          range.detach?.();
          if (rect.width <= 0 || rect.height <= 0) continue;
          parts.push({
            text,
            top: Math.round(rect.top),
            left: Math.round(rect.left),
          });
        }
        return parts.sort((left, right) => left.top - right.top || left.left - right.left);
      };
      const chooseName = (node) => {
        const parts = collectVisibleTextParts(node)
          .map((part) => cleanName(part.text))
          .filter((part) => part
            && part.length <= 24
            && !isDateText(part)
            && !excludedName.test(part));
        if (parts[0]) return parts[0];
        const text = normalize(node.textContent);
        const beforeDate = text.split(/刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}/)[0] || '';
        const compact = cleanName(beforeDate || text);
        if (compact && compact.length <= 24 && !excludedName.test(compact)) return compact;
        return '';
      };
      let cards = domSelectors.findLeftCards();
      if (cards.length === 0) {
        const entry = domSelectors.findEntryCards().find((node) => Boolean(node.querySelector?.('img[src]')));
        if (entry) {
          await clickNode(entry, 1000);
          cards = domSelectors.findLeftCards();
        }
      }
      const rows = cards
        .map((node) => {
          const text = normalize(node.textContent);
          const name = chooseName(node);
          return { name, text };
        });
      const hints = [];
      for (const row of rows) {
        const name = row.name;
        if (!name || name.length > 24) continue;
        if (excludedName.test(name)) continue;
        if (isUnsupported(row.text)) continue;
        hints.push(name);
      }
      if (hints.length === 0) {
        const entryCandidates = Array.from(document.querySelectorAll('[role="tab"], [role="menuitem"], [role="listitem"], [role="link"], li, a, button, div, p, span'))
          .filter((node) => isVisible(node))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.textContent);
            return rect.left >= window.innerWidth * 0.08
              && rect.left <= window.innerWidth * 0.72
              && rect.top >= 100
              && rect.width >= 40
              && rect.width <= 760
              && rect.height >= 16
              && rect.height <= 260
              && text
              && text.length <= 280
              && !/^(全部|朋友私信|陌生人私信|群消息)$/.test(text)
              && !/高清发布|发布作品|创作|数据|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理|查看Ta的主页|发送/.test(text)
              && (Boolean(node.querySelector?.('img[src]')) || /\\d{2}-\\d{2}|刚刚|分钟前|小时前|今天|昨天|前天/.test(text));
          })
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return leftRect.top - rightRect.top || leftRect.left - rightRect.left || rightRect.width - leftRect.width;
          });
        const seenRects = new Set();
        for (const node of entryCandidates) {
          const rect = node.getBoundingClientRect();
          const rectKey = [Math.round(rect.top / 12), Math.round(rect.left / 12), Math.round(rect.width / 12)].join('|');
          if (seenRects.has(rectKey)) continue;
          seenRects.add(rectKey);
          if (isUnsupported(node.textContent)) continue;
          const name = chooseName(node);
          if (!name || name.length > 24 || excludedName.test(name)) continue;
          hints.push(name);
        }
      }
      if (hints.length === 0) {
        const lineExcluded = /抖音创作者中心|通知|网址|抖音|全部|高清发布|首页|活动管理|内容管理|互动管理|关注管理|粉丝管理|评论管理|弹幕管理|私信管理|数据中心|变现中心|创作中心|全部私信|朋友私信|陌生人私信|群消息|你收到一条新类型消息|请打开抖音app查看|发送|搜索|没有更多|查看Ta的主页/;
        const lines = String(document.body?.innerText || '')
          .split(/\\n+/)
          .map((line) => cleanName(line))
          .map((line) => line.replace(/[:：]\\s*$/, '').trim())
          .filter((line) => line
            && line.length <= 24
            && !isDateText(line)
            && !excludedName.test(line)
            && !lineExcluded.test(line));
        hints.push(...lines);
      }
      return Array.from(new Set(hints));
    })()
  `);
  return (Array.isArray(hints) ? hints : [])
    .map((hint) => normalizeDouyinPrivateMessageNickname(hint))
    .filter(Boolean);
}

async function withDouyinPrivateMessagePageIdentityRetry(page, kwargs = {}, operation) {
  const retryCount = Math.max(1, Math.min(3, Number(kwargs.page_retry_count ?? kwargs.pageRetryCount ?? kwargs.rank_retry_count ?? kwargs.rankRetryCount ?? 2)));
  let lastError = null;
  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      if (attempt > 0) {
        await resetDouyinPrivateMessagePage(page, kwargs);
      }
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= retryCount || !isDouyinPageIdentityError(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error('Private message page retry exhausted without result');
}

async function collectDouyinVisiblePrivateMessageThreadRows(page) {
  const rows = await page.evaluate(`
    (async () => {
      const domSelectors = ${buildDouyinPrivateMessageDomSelectorsBrowser.toString()}();
      const normalizeNickname = ${normalizeDouyinPrivateMessageNickname.toString()};
      const normalize = domSelectors.normalize;
      const isVisible = domSelectors.isVisible;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const clickNode = async (node, waitMs = 700) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        node.click?.();
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
        await sleep(waitMs);
        return true;
      };
      const excludedMessageText = /发送|搜索|私信|关注|粉丝|作品|首页|推荐|朋友|我的|登录|扫码|查看更多|全部已读|没有更多|页面不见啦|查看Ta的主页/;
      const excludedThreadText = /高清发布|发布作品|创作|数据|互动|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理/;
      const isThreadDateText = (value) => /^(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2})/.test(normalize(value));
      const cleanThreadName = (value) => normalize(value)
        .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
        .trim();
      const clickableSelector = 'li, a, button, [role="list-item"], [role="listitem"], [role="gridcell"], [role="button"], [role="link"]';
      const findCardRoot = (start) => {
        let current = start;
        let fallback = start;
        while (current && current instanceof HTMLElement && current !== document.body) {
          const rect = current.getBoundingClientRect();
          if (rect.width >= 160 && rect.height >= 32) {
            fallback = current;
            if (current.querySelector?.('img[src]')) return current;
          }
          current = current.parentElement;
        }
        return fallback;
      };
      let inDetail = /全部私信/.test(normalize(document.body?.innerText || ''));
      if (!inDetail) {
        const entryCard = domSelectors.findEntryCards()[0];
        if (entryCard) {
          await clickNode(entryCard, 900);
          inDetail = /全部私信/.test(normalize(document.body?.innerText || ''));
        }
      }
      const candidates = inDetail
        ? Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div'))
        : Array.from(document.querySelectorAll('img[src]'))
          .map((image) => {
            const ancestor = image.closest?.('[role="listitem"], li, a, button, div');
            return ancestor || image.parentElement || null;
          })
          .filter(Boolean);
      const normalizedCandidates = Array.from(new Set(candidates
        .map((node) => {
          const root = findCardRoot(node);
          return root?.closest?.(clickableSelector) || root || node;
        })
        .filter(Boolean)));
      const rows = [];
      const seen = new Set();
      for (const node of normalizedCandidates) {
        if (!isVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (inDetail) {
          if (rect.left > window.innerWidth * 0.45 || rect.right > window.innerWidth * 0.48 || rect.top < 120 || rect.width < 200 || rect.width > 760 || rect.height < 36 || rect.height > 220) continue;
        } else if (rect.left < window.innerWidth * 0.04 || rect.left > window.innerWidth * 0.55 || rect.top < 100 || rect.width < 160 || rect.width > 760 || rect.height < 36 || rect.height > 260) {
          continue;
        }
        const text = normalize(node.textContent);
        if (!text || text.length > 240) continue;
        if (!inDetail && /^(全部|朋友私信|陌生人私信|群消息)$/.test(text)) continue;
        if (inDetail && /全部私信|朋友私信|陌生人私信|群消息/.test(text)) continue;
        const imageUrl = node.querySelector?.('img')?.getAttribute('src') || '';
        if (!imageUrl) continue;
        const parts = Array.from(node.querySelectorAll?.('span, p, div') || [])
          .filter((child) => isVisible(child))
          .filter((child) => {
            const childText = normalize(child.textContent);
            if (!childText || childText.length > 80) return false;
            const repeatedByChild = Array.from(child.children || [])
              .some((grandchild) => isVisible(grandchild) && normalize(grandchild.textContent) === childText);
            return !repeatedByChild || childText.length <= 16;
          })
          .map((child) => normalize(child.textContent))
          .filter(Boolean);
        const nickname = parts
          .map((part) => cleanThreadName(part))
          .find((part) => part && !isThreadDateText(part) && !excludedMessageText.test(part))
          || cleanThreadName(text)
          || text.split(' ')[0]
          || '';
        if (!nickname || excludedThreadText.test(nickname) || excludedThreadText.test(text)) continue;
        const previewText = parts.find((part) => part !== nickname
          && cleanThreadName(part) !== nickname
          && !isThreadDateText(part)
          && !excludedMessageText.test(part)) || '';
        const style = window.getComputedStyle(node);
        const clickable = node.closest?.(clickableSelector) || node;
        const clickableStyle = window.getComputedStyle(clickable);
        const borderLeftWidth = Number.parseFloat(style.borderLeftWidth || '0') || 0;
        const borderLeftColor = String(style.borderLeftColor || '');
        const clickableBorderLeftWidth = Number.parseFloat(clickableStyle.borderLeftWidth || '0') || 0;
        const clickableBorderLeftColor = String(clickableStyle.borderLeftColor || '');
        const isSelected = node.getAttribute?.('aria-selected') === 'true'
          || clickable.getAttribute?.('aria-selected') === 'true'
          || /\\b(active|current|selected)\\b/i.test(String(node.className || ''))
          || /\\b(active|current|selected)\\b/i.test(String(clickable.className || ''))
          || borderLeftWidth >= 2
          || clickableBorderLeftWidth >= 2
          || /rgb\\(255,\\s*45,\\s*108\\)|rgba\\(255,\\s*45,\\s*108/i.test(borderLeftColor)
          || /rgb\\(255,\\s*45,\\s*108\\)|rgba\\(255,\\s*45,\\s*108/i.test(clickableBorderLeftColor);
        const seenKey = [
          normalizeNickname(nickname),
          Math.round(rect.left / 12),
          Math.round(rect.top / 12),
          Math.round(rect.width / 12),
          Math.round(rect.height / 12),
        ].join('|');
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);
        rows.push({
          thread_rank: rows.length + 1,
          thread_nickname: normalizeNickname(nickname),
          thread_preview_text: previewText,
          has_avatar: Boolean(imageUrl),
          is_selected: isSelected,
        });
      }
      const dedupedRows = [];
      const rowSeen = new Set();
      for (const row of rows) {
        const rowKey = [
          normalizeNickname(row.thread_nickname),
          normalize(row.thread_preview_text),
          row.has_avatar ? '1' : '0',
        ].join('|');
        if (rowSeen.has(rowKey)) continue;
        rowSeen.add(rowKey);
        dedupedRows.push({
          ...row,
          thread_rank: dedupedRows.length + 1,
        });
      }
      return dedupedRows;
    })()
  `);
  return Array.isArray(rows) ? rows : [];
}

export async function probeDouyinPrivateMessageThreadList(page, kwargs = {}) {
  if (await shouldNavigateDouyinPrivateMessagePage(page, kwargs)) {
    await page.goto(String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL));
    if (typeof page.wait === 'function') {
      await page.wait(2);
    }
  }
  await ensureDouyinPrivateMessagePage(page, kwargs);
  return withDouyinPrivateMessagePageIdentityRetry(page, kwargs, async () => {
    const rows = await collectDouyinVisiblePrivateMessageThreadRows(page);
    if (rows.length > 0) return rows;
    const hints = await collectDouyinPrivateMessageKeywordHints(page);
    return hints.map((hint, index) => ({
      thread_rank: index + 1,
      thread_nickname: hint,
      thread_preview_text: '',
      has_avatar: true,
      is_selected: false,
    }));
  });
}

export async function probeDouyinPrivateMessageThreadStructure(page, kwargs = {}) {
  const targetThreadRank = Math.max(0, Number(kwargs.thread_rank ?? kwargs.threadRank ?? 0));
  const targetThreadKeyword = String(kwargs.thread_keyword ?? kwargs.threadKeyword ?? '').trim().toLowerCase();
  return withDouyinPrivateMessagePageIdentityRetry(page, kwargs, async () => page.evaluate(`
    (async () => {
      const domSelectors = ${buildDouyinPrivateMessageDomSelectorsBrowser.toString()}();
      const normalizeNickname = ${normalizeDouyinPrivateMessageNickname.toString()};
      const normalize = domSelectors.normalize;
      const isVisible = domSelectors.isVisible;
      const targetThreadRank = ${JSON.stringify(targetThreadRank)};
      const targetThreadKeyword = ${JSON.stringify(targetThreadKeyword)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const cleanThreadName = (value) => normalize(value)
        .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
        .trim();
      const normalizeThreadLabel = (value) => cleanThreadName(value).toLowerCase();
      const clickNode = async (node, waitMs = 700) => {
        if (!node) return false;
        node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        node.click?.();
        await sleep(waitMs);
        return true;
      };
      const summarizeRect = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
        };
      };
      const summarizeNode = (node, sourceGroup, targetLabel) => {
        const clickable = node.closest?.('li, a, button, [role="list-item"], [role="listitem"], [role="gridcell"], [role="button"], [role="link"]') || node;
        const rawText = normalize(node.textContent);
        const label = normalizeNickname(cleanThreadName(rawText));
        const style = window.getComputedStyle(node);
        const clickableStyle = window.getComputedStyle(clickable);
        const borderLeftWidth = Number.parseFloat(style.borderLeftWidth || '0') || 0;
        const borderLeftColor = String(style.borderLeftColor || '');
        const clickableBorderLeftWidth = Number.parseFloat(clickableStyle.borderLeftWidth || '0') || 0;
        const clickableBorderLeftColor = String(clickableStyle.borderLeftColor || '');
        const isSelected = node.getAttribute?.('aria-selected') === 'true'
          || clickable.getAttribute?.('aria-selected') === 'true'
          || /\\b(active|current|selected)\\b/i.test(String(node.className || ''))
          || /\\b(active|current|selected)\\b/i.test(String(clickable.className || ''))
          || borderLeftWidth >= 2
          || clickableBorderLeftWidth >= 2
          || /rgb\\(255,\\s*45,\\s*108\\)|rgba\\(255,\\s*45,\\s*108/i.test(borderLeftColor)
          || /rgb\\(255,\\s*45,\\s*108\\)|rgba\\(255,\\s*45,\\s*108/i.test(clickableBorderLeftColor);
        const parts = Array.from(node.querySelectorAll?.('span, p, div') || [])
          .filter((child) => isVisible(child))
          .map((child) => normalize(child.textContent))
          .filter((text) => text && text.length <= 80)
          .slice(0, 8);
        return {
          row_rank: 0,
          source_group: sourceGroup,
          target_label: targetLabel,
          thread_label: label,
          label_match: normalizeThreadLabel(label) === normalizeThreadLabel(targetLabel),
          text: rawText.slice(0, 200),
          text_length: Array.from(rawText).length,
          child_texts: parts,
          node_tag: String(node.tagName || '').toLowerCase(),
          node_role: String(node.getAttribute?.('role') || ''),
          node_class_name: String(node.className || '').slice(0, 200),
          node_rect: summarizeRect(node),
          has_avatar: Boolean(node.querySelector?.('img[src]')),
          avatar_count: node.querySelectorAll?.('img[src]')?.length || 0,
          is_selected: isSelected,
          border_left_width: borderLeftWidth,
          border_left_color: borderLeftColor,
          clickable_tag: String(clickable.tagName || '').toLowerCase(),
          clickable_role: String(clickable.getAttribute?.('role') || ''),
          clickable_class_name: String(clickable.className || '').slice(0, 200),
          clickable_rect: summarizeRect(clickable),
          clickable_text: normalize(clickable.textContent).slice(0, 200),
          clickable_border_left_width: clickableBorderLeftWidth,
          clickable_border_left_color: clickableBorderLeftColor,
        };
      };
      let inDetail = /全部私信/.test(normalize(document.body?.innerText || ''));
      if (!inDetail) {
        const entryCard = domSelectors.findEntryCards()[0];
        if (entryCard) {
          await clickNode(entryCard, 900);
          inDetail = /全部私信/.test(normalize(document.body?.innerText || ''));
        }
      }
      const detailCards = domSelectors.findLeftCards();
      const conversationCandidates = Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div, p, span'))
        .filter((node) => isVisible(node))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent);
          return rect.left < window.innerWidth * 0.36
            && rect.right < window.innerWidth * 0.52
            && rect.top >= 120
            && rect.width >= 120
            && rect.height >= 36
            && rect.width <= 620
            && rect.height <= 220
            && text
            && text.length <= 240
            && Boolean(node.querySelector?.('img[src]'))
            && !/全部私信|朋友私信|陌生人私信|群消息|查看Ta的主页|发送/.test(text);
        });
      const groups = [
        ['detail', detailCards],
        ['conversation', conversationCandidates],
      ];
      const rankedLabels = [];
      const seenRanks = new Set();
      for (const node of detailCards) {
        const label = normalizeNickname(cleanThreadName(normalize(node.textContent)));
        const rankKey = Math.round(node.getBoundingClientRect().top / 80) + '|' + label;
        if (!label || seenRanks.has(rankKey)) continue;
        seenRanks.add(rankKey);
        rankedLabels.push(label);
      }
      const targetLabel = targetThreadRank > 0
        ? String(rankedLabels[targetThreadRank - 1] || '')
        : '';
      const rows = [];
      for (const [sourceGroup, nodes] of groups) {
        nodes.forEach((node) => {
          const row = summarizeNode(node, sourceGroup, targetLabel);
          if (!row.thread_label) return;
          if (targetLabel && normalizeThreadLabel(row.thread_label) !== normalizeThreadLabel(targetLabel)) return;
          if (targetThreadKeyword && ![
            normalizeThreadLabel(row.thread_label),
            row.text.toLowerCase(),
            row.clickable_text.toLowerCase(),
          ].some((text) => text.includes(targetThreadKeyword))) return;
          rows.push(row);
        });
      }
      return rows.map((row, index) => ({
        ...row,
        row_rank: index + 1,
        visible_thread_ranks: rankedLabels,
      }));
    })()
  `));
}

export async function probeDouyinPrivateMessageApiFlatScan(page, kwargs = {}) {
  const startRank = Math.max(1, Number(kwargs.thread_rank_start ?? kwargs.threadRankStart ?? 1));
  const endRank = Math.max(startRank, Number(kwargs.thread_rank_end ?? kwargs.threadRankEnd ?? 5));
  const url = String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL);
  const waitSeconds = Math.max(1, Number(kwargs.wait_seconds ?? kwargs.waitSeconds ?? 2));
  const visibleThreads = await probeDouyinPrivateMessageThreadList(page, kwargs).catch(() => []);
  const rows = [];
  for (let threadRank = startRank; threadRank <= endRank; threadRank += 1) {
    const requestedThread = visibleThreads[threadRank - 1] || null;
    const visibleThreadCount = Array.isArray(visibleThreads) ? visibleThreads.length : 0;
    if (visibleThreadCount > 0 && threadRank > visibleThreadCount) {
      rows.push({
        rank: rows.length + 1,
        thread_rank: threadRank,
        requested_thread_nickname: '',
        thread_nickname: '',
        api_row_count: 0,
        inbound_count: 0,
        outbound_count: 0,
        directions: [],
        first_time: '',
        last_time: '',
        source_url_paths: [],
        errors: [`thread rank ${threadRank} exceeds visible thread count ${visibleThreadCount}`],
      });
      continue;
    }
    try {
      if (typeof page?.goto === 'function') {
        await page.goto(url);
        if (typeof page.wait === 'function') {
          await page.wait(waitSeconds);
        }
      }
      const probeRows = await probeDouyinPrivateMessageApis(page, {
        ...kwargs,
        thread_rank: threadRank,
        keep_duplicates: true,
        include_message_values: true,
        allow_dom_fallback: false,
        limit: Math.max(20, Number(kwargs.api_limit ?? kwargs.limit ?? 20)),
      });
      const apiRows = buildDouyinPrivateMessageApiFlatRows(probeRows, {
        thread_rank: threadRank,
        thread_label: String(requestedThread?.thread_nickname || ''),
        include_outbound: true,
      });
      const inboundCount = apiRows.filter((row) => row.direction === 'inbound').length;
      const outboundCount = apiRows.filter((row) => row.direction === 'outbound').length;
      rows.push({
        rank: rows.length + 1,
        thread_rank: threadRank,
        requested_thread_nickname: String(requestedThread?.thread_nickname || ''),
        thread_nickname: String(apiRows[0]?.thread_nickname || requestedThread?.thread_nickname || ''),
        api_row_count: apiRows.length,
        inbound_count: inboundCount,
        outbound_count: outboundCount,
        directions: [...new Set(apiRows.map((row) => String(row.direction || '')).filter(Boolean))],
        first_time: String(apiRows[0]?.time || ''),
        last_time: String(apiRows[apiRows.length - 1]?.time || ''),
        source_url_paths: [...new Set(apiRows.map((row) => String(row.source_url_path || '')).filter(Boolean))],
        errors: [],
      });
    } catch (error) {
      rows.push({
        rank: rows.length + 1,
        thread_rank: threadRank,
        requested_thread_nickname: String(requestedThread?.thread_nickname || ''),
        thread_nickname: '',
        api_row_count: 0,
        inbound_count: 0,
        outbound_count: 0,
        directions: [],
        first_time: '',
        last_time: '',
        source_url_paths: [],
        errors: [String(error instanceof Error ? error.message : error)],
      });
    }
  }
  return rows;
}

export async function fetchDouyinPrivateMessageApiRows(page, kwargs = {}) {
  const runProbe = async () => {
    const originalThreadKeyword = String(kwargs.thread_keyword ?? kwargs.threadKeyword ?? '').trim();
    const originalThreadRank = Math.max(0, Number(kwargs.thread_rank ?? kwargs.threadRank ?? 0));
    const probeKwargs = {
      ...kwargs,
      thread_keyword: originalThreadKeyword,
      thread_rank: originalThreadRank,
    };
    const rows = await probeDouyinPrivateMessageApis(page, {
      ...probeKwargs,
      conversation_clicks: probeKwargs.conversation_clicks ?? 1,
      keep_duplicates: true,
      include_message_values: true,
      allow_dom_fallback: false,
      limit: probeKwargs.api_limit ?? probeKwargs.limit ?? 20,
    });
    const latestConversationRow = rows
      .filter((row) => isDouyinPrivateMessageConversationApiPath(String(row?.url_path || ''))
        && Array.isArray(row?.message_record_field_summary?.record_samples)
        && row.message_record_field_summary.record_samples.length > 0)
      .sort((left, right) => Number(right.captured_at || 0) - Number(left.captured_at || 0))[0];
    const clickedLabel = String(rows[0]?.click_result?.clicked_labels?.[0] || '').trim()
      || originalThreadKeyword;
    const apiFlatRows = buildDouyinPrivateMessageApiFlatRows(latestConversationRow ? [latestConversationRow] : rows, {
      ...probeKwargs,
      thread_label: clickedLabel,
    });
    if (!clickedLabel && !originalThreadRank && !originalThreadKeyword) {
      return apiFlatRows;
    }
    try {
      const domRows = await fetchDouyinPrivateMessageRows(page, {
        ...probeKwargs,
        include_outbound: true,
        limit: 1,
      });
      const domMatchedRows = applyDouyinPrivateMessageDomDirectionOverrides(apiFlatRows, domRows);
      return applyDouyinPrivateMessageVisibleFingerprintDirectionOverrides(domMatchedRows);
    } catch {
      return apiFlatRows;
    }
  };
  try {
    return await runProbe();
  } catch (error) {
    if (!isDouyinPageIdentityError(error)) {
      throw error;
    }
    return withDouyinPrivateMessagePageIdentityRetry(page, kwargs, runProbe);
  }
}

export async function inspectDouyinPrivateMessagePage(page, kwargs = {}) {
  if (typeof page?.goto === 'function') {
    await page.goto(String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL));
    if (typeof page.wait === 'function') {
      await page.wait(2);
    }
  }

  return page.evaluate(`
    (() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
    };
    const bodyText = normalize(document.body?.innerText || '');
    const pageUnavailable = /页面不见啦|页面不存在|not found|404/i.test(bodyText);
    const leftCandidates = Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div'))
      .filter((node) => {
        if (!isVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        const text = normalize(node.textContent);
        return rect.left < window.innerWidth * 0.48
          && rect.width >= 120
          && rect.height >= 36
          && text.length > 0
          && text.length <= 240;
      });
    const messageCandidates = Array.from(document.querySelectorAll('div, p, span'))
      .filter((node) => {
        if (!isVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        const text = normalize(node.textContent);
        return rect.left >= window.innerWidth * 0.30
          && rect.top >= 72
          && rect.width >= 18
          && rect.height >= 16
          && text.length > 0
          && text.length <= 1000;
      });

    return {
      current_url: window.location.href,
      title: document.title || '',
      ready_state: document.readyState,
      body_text_length: bodyText.length,
      has_login_hint: /登录|扫码|验证码|账号/.test(bodyText),
      has_message_hint: /私信|消息|聊天|会话/.test(bodyText),
      page_unavailable: pageUnavailable,
      visible_left_candidate_count: leftCandidates.length,
      visible_message_candidate_count: messageCandidates.length,
    };
    })()
  `);
}

export async function inspectDouyinPrivateMessageDomDetail(page, kwargs = {}) {
  const targetThreadRank = Math.max(0, Number(kwargs.thread_rank ?? kwargs.threadRank ?? 0));
  const targetThreadKeyword = String(kwargs.thread_keyword ?? kwargs.threadKeyword ?? '').trim().toLowerCase();
  const loadHistoryClicks = Math.max(0, Math.min(5, Number(kwargs.load_history_clicks ?? kwargs.loadHistoryClicks ?? 0)));
  if (await shouldNavigateDouyinPrivateMessagePage(page, kwargs)) {
    await page.goto(String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL));
    if (typeof page.wait === 'function') {
      await page.wait(2);
    }
  }
  await ensureDouyinPrivateMessagePage(page, kwargs);

  return page.evaluate(`
    (async () => {
      const domSelectors = ${buildDouyinPrivateMessageDomSelectorsBrowser.toString()}();
      const normalize = domSelectors.normalize;
      const hashText = (value) => {
        let hash = 2166136261;
        for (const char of String(value || '')) {
          hash ^= char.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
      };
      const targetThreadRank = ${JSON.stringify(targetThreadRank)};
      const targetThreadKeyword = ${JSON.stringify(targetThreadKeyword)};
      const historyClickCount = ${JSON.stringify(loadHistoryClicks)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = domSelectors.isVisible;
      const rectOf = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const clickNode = async (node, waitMs = 800) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
        await sleep(waitMs);
        return true;
      };
      const cleanThreadName = (value) => normalize(value)
        .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
        .trim();
      const threadMatches = (node) => {
        const text = cleanThreadName(node.textContent).toLowerCase();
        if (targetThreadKeyword && !text.includes(targetThreadKeyword)) return false;
        return true;
      };
      const findHistoryLoadButtons = () => {
        const leftCardsNow = domSelectors.findLeftCards();
        const leftBoundary = Math.max(
          window.innerWidth * 0.35,
          ...leftCardsNow.map((node) => node.getBoundingClientRect().right + 16),
        );
        return Array.from(document.querySelectorAll('button, div, span, a'))
          .filter((node) => isVisible(node))
          .map((node) => ({ node, text: normalize(node.textContent), rect: node.getBoundingClientRect() }))
          .filter((item) => item.text === '加载')
          .filter((item) => item.rect.left >= leftBoundary
            && item.rect.right <= window.innerWidth * 0.92
            && item.rect.top >= 80
            && item.rect.bottom <= window.innerHeight - 80
            && item.rect.width >= 24
            && item.rect.width <= 220
            && item.rect.height >= 20
            && item.rect.height <= 96)
          .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
      };
      const findLooseHistoryLoadButtons = () => Array.from(document.querySelectorAll('button, div, span, a'))
        .filter((node) => isVisible(node))
        .map((node) => ({ node, text: normalize(node.textContent), rect: node.getBoundingClientRect() }))
        .filter((item) => item.text.includes('加载'))
          .filter((item) => item.rect.top >= 60
          && item.rect.bottom <= window.innerHeight - 60
          && item.rect.width >= 16
          && item.rect.width <= 280
          && item.rect.height >= 16
          && item.rect.height <= 120)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
      const findDetailScrollContainer = () => {
        const leftCardsNow = domSelectors.findLeftCards();
        const leftBoundary = Math.max(
          window.innerWidth * 0.3,
          ...leftCardsNow.map((node) => node.getBoundingClientRect().right + 8),
        );
        return Array.from(document.querySelectorAll('div, section, main'))
          .filter((node) => isVisible(node))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            scrollHeight: Number(node.scrollHeight || 0),
            clientHeight: Number(node.clientHeight || 0),
            overflowY: String(window.getComputedStyle(node).overflowY || ''),
          }))
          .filter((item) => item.rect.left >= leftBoundary
            && item.rect.right <= window.innerWidth
            && item.rect.top >= 72
            && item.rect.height >= 180
            && item.scrollHeight > item.clientHeight + 40
            && /(auto|scroll|overlay)/i.test(item.overflowY))
          .sort((left, right) => right.rect.height - left.rect.height)
          .map((item) => item.node);
      };
      const summarizeScrollContainer = (node, index) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return {
          rank: index + 1,
          rect: rectOf(node),
          scroll_height: Number(node.scrollHeight || 0),
          client_height: Number(node.clientHeight || 0),
          scroll_top: Math.round(Number(node.scrollTop || 0)),
          overflow_y: String(style.overflowY || ''),
          text_hash: hashText(normalize(node.textContent).slice(0, 120)),
          text_length: Array.from(normalize(node.textContent).slice(0, 120)).length,
        };
      };
      const scrollDetailPaneToTop = async () => {
        const container = findDetailScrollContainer()[0] || null;
        if (!container) return false;
        for (let index = 0; index < 3; index += 1) {
          container.scrollTop = 0;
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
          await sleep(180);
        }
        return true;
      };
      const waitForHistoryLoadButton = async (retries = 6, waitMs = 250) => {
        for (let index = 0; index < retries; index += 1) {
          const button = findHistoryLoadButtons()[0];
          if (button) return button;
          await scrollDetailPaneToTop();
          await sleep(waitMs);
        }
        return null;
      };
      const entryCards = domSelectors.findEntryCards();
      if (!/全部私信/.test(normalize(document.body?.innerText || '')) && entryCards[0]) {
        await clickNode(entryCards[0], 1000);
      }
      let leftCards = domSelectors.findLeftCards();
      const filteredLeftCards = leftCards.filter((node) => threadMatches(node));
      const targetCard = targetThreadRank > 0
        ? filteredLeftCards[targetThreadRank - 1]
        : filteredLeftCards[0];
      if (targetCard) {
        await clickNode(targetCard, 800);
      }
      leftCards = domSelectors.findLeftCards();
      const historyButtonsBefore = findHistoryLoadButtons();
      const looseHistoryButtonsBefore = findLooseHistoryLoadButtons();
      const historyLoadTimeline = [];
      for (let index = 0; index < historyClickCount; index += 1) {
        await scrollDetailPaneToTop();
        const button = await waitForHistoryLoadButton();
        if (!button) break;
        historyLoadTimeline.push({
          click_index: index + 1,
          text: button.text,
          rect: rectOf(button.node),
        });
        await clickNode(button.node, 700);
      }
      const historyButtonsAfter = findHistoryLoadButtons();
      const looseHistoryButtonsAfter = findLooseHistoryLoadButtons();
      const scrollContainers = findDetailScrollContainer();
      const messageCandidates = domSelectors.findMessageCandidates();
      const leftPanelRight = leftCards.reduce((maxRight, node) => Math.max(maxRight, node.getBoundingClientRect().right), 0);
      const minMessageLeft = leftPanelRight
        ? leftPanelRight + 8
        : window.innerWidth * 0.20;
      const summarize = (node, index) => {
        const text = normalize(node.textContent);
        const image = node.querySelector?.('img');
        return {
          rank: index + 1,
          text_hash: hashText(text),
          text_length: Array.from(text).length,
          rect: rectOf(node),
          has_img: Boolean(image?.getAttribute('src')),
          child_count: node.children?.length || 0,
        };
      };
      return {
        current_url: window.location.href,
        title: document.title || '',
        body_text_length: normalize(document.body?.innerText || '').length,
        has_all_private: /全部私信/.test(normalize(document.body?.innerText || '')),
        entry_candidate_count: entryCards.length,
        left_card_candidate_count: leftCards.length,
        message_candidate_count: messageCandidates.length,
        history_load_visible_count_before: historyButtonsBefore.length,
        history_load_visible_count_after: historyButtonsAfter.length,
        history_load_loose_count_before: looseHistoryButtonsBefore.length,
        history_load_loose_count_after: looseHistoryButtonsAfter.length,
        history_load_click_count: historyLoadTimeline.length,
        history_scroll_container_count: scrollContainers.length,
        history_scroll_container_samples: scrollContainers.slice(0, 6).map(summarizeScrollContainer),
        history_load_samples_before: historyButtonsBefore.slice(0, 6).map((item, index) => ({
          rank: index + 1,
          text_hash: hashText(item.text),
          text_length: Array.from(item.text).length,
          rect: rectOf(item.node),
        })),
        history_load_samples_after: historyButtonsAfter.slice(0, 6).map((item, index) => ({
          rank: index + 1,
          text_hash: hashText(item.text),
          text_length: Array.from(item.text).length,
          rect: rectOf(item.node),
        })),
        history_load_loose_samples_before: looseHistoryButtonsBefore.slice(0, 8).map((item, index) => ({
          rank: index + 1,
          text_hash: hashText(item.text),
          text_length: Array.from(item.text).length,
          rect: rectOf(item.node),
        })),
        history_load_loose_samples_after: looseHistoryButtonsAfter.slice(0, 8).map((item, index) => ({
          rank: index + 1,
          text_hash: hashText(item.text),
          text_length: Array.from(item.text).length,
          rect: rectOf(item.node),
        })),
        history_load_timeline: historyLoadTimeline,
        min_message_left: Math.round(minMessageLeft),
        left_card_samples: leftCards.slice(0, 12).map(summarize),
        message_samples: messageCandidates.slice(0, 20).map(summarize),
      };
    })()
  `);
}

export async function probeDouyinPrivateMessageApis(page, kwargs = {}) {
  const url = String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL);
  const waitSeconds = normalizeDouyinPageLimit(kwargs.wait_seconds ?? 3, 3);
  const maxRows = normalizeDouyinVideoLimit(kwargs.limit ?? 30, 30);
  const conversationClicks = normalizeDouyinCommentLimit(kwargs.conversation_clicks ?? kwargs.thread_clicks ?? 1, 1);
  const keepDuplicates = Boolean(kwargs.keep_duplicates ?? kwargs.keepDuplicates);
  const recordSampleLimit = Math.max(1, Math.min(500, Number(kwargs.record_sample_limit ?? kwargs.sample_limit ?? 30)));
  const targetTabName = normalizeDouyinPrivateMessageTabName(kwargs.tab_name ?? kwargs.tabName ?? '');
  const targetThreadRank = Math.max(0, Number(kwargs.thread_rank ?? kwargs.threadRank ?? 0));
  const targetThreadKeyword = String(kwargs.thread_keyword ?? kwargs.threadKeyword ?? '').trim().toLowerCase();
  const targetThreadLabel = String(kwargs.target_thread_label ?? kwargs.targetThreadLabel ?? '').trim().toLowerCase();
  const allowDomFallback = Boolean(kwargs.allow_dom_fallback ?? kwargs.allowDomFallback);
  const includeMessageValues = Boolean(kwargs.include_message_values ?? kwargs.includeMessageValues);
  const loadHistoryClicks = Math.max(0, Math.min(5, Number(kwargs.load_history_clicks ?? kwargs.loadHistoryClicks ?? 0)));
  const refreshPage = Boolean(kwargs.refresh ?? kwargs.force_refresh ?? kwargs.refreshPage);

  let currentUrl = '';
  if (typeof page?.evaluate === 'function') {
    try {
      currentUrl = String(await page.evaluate('window.location.href')).trim();
    } catch {
      currentUrl = '';
    }
  }
  if ((refreshPage || !currentUrl || currentUrl === 'about:blank' || !/creator\.douyin\.com/.test(currentUrl)) && typeof page?.goto === 'function') {
    await page.goto(url);
  }
  if (typeof page?.wait === 'function') {
    await page.wait(waitSeconds);
  }
  if (targetThreadRank > 0 || targetThreadKeyword || targetThreadLabel) {
    try {
      await probeDouyinPrivateMessageThreadList(page, kwargs);
    } catch {
      // Best-effort preflight: if detail entry stays flaky, the main probe still runs.
    }
  }
  const readProbeResult = async () => page.evaluate(`
    (() => {
      const rows = Array.isArray(window.__opencli_douyin_message_api_probe) ? window.__opencli_douyin_message_api_probe.slice() : [];
      const errors = Array.isArray(window.__opencli_douyin_message_api_probe_errors) ? window.__opencli_douyin_message_api_probe_errors.slice() : [];
      const clickResult = window.__opencli_douyin_message_api_probe_click_result || null;
      const byKey = new Map();
      for (const row of rows) {
        const key = [row.method, row.url_path, row.status, JSON.stringify(row.query_keys || [])].join('|');
        if (!byKey.has(key)) byKey.set(key, row);
      }
      return {
        current_url: window.location.href,
        title: document.title || '',
        captured_count: rows.length,
        deduped_count: byKey.size,
        errors,
        click_result: clickResult,
        all_rows: rows,
        rows: Array.from(byKey.values()),
        page_state: (${inspectDouyinPrivateMessagePageStateBrowser.toString()})(),
      };
    })()
  `);
  let result = await page.evaluate(`
    (async () => {
      const arrName = '__opencli_douyin_message_api_probe';
      const errName = '__opencli_douyin_message_api_probe_errors';
      const phaseStateName = '__opencli_douyin_message_api_probe_phase_state';
      const compactProtoShape = ${summarizeDouyinProtobufWireShape.toString()};
      const attributeMessageRecords = ${attributeDouyinPrivateMessageRecordFields.toString()};
      const domSelectors = ${buildDouyinPrivateMessageDomSelectorsBrowser.toString()}();
      const inspectState = ${inspectDouyinPrivateMessagePageStateBrowser.toString()};
      const ensurePage = ${ensureDouyinPrivateMessagePageBrowser.toString()};
      const targetTab = ${JSON.stringify(targetTabName)};
      const targetThreadRank = ${JSON.stringify(targetThreadRank)};
      const targetThreadKeyword = ${JSON.stringify(targetThreadKeyword)};
      const targetThreadLabel = ${JSON.stringify(targetThreadLabel)};
      const recordSampleLimit = ${JSON.stringify(recordSampleLimit)};
      const includeMessageValues = ${JSON.stringify(includeMessageValues)};
      const waitMs = ${JSON.stringify(waitSeconds * 1000)};
      const clickCount = ${JSON.stringify(conversationClicks)};
      const historyClickCount = ${JSON.stringify(loadHistoryClicks)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = domSelectors.normalize;
      const isVisible = domSelectors.isVisible;
      const ensurePhaseState = () => {
        if (!window[phaseStateName] || typeof window[phaseStateName] !== 'object') {
          window[phaseStateName] = {
            phase: 'boot',
            phase_index: 0,
            target_click_index: 0,
            target_click_label: '',
            last_transition_at: Date.now(),
          };
        }
        return window[phaseStateName];
      };
      const setPhase = (phase, extras = {}) => {
        const current = ensurePhaseState();
        window[phaseStateName] = {
          ...current,
          ...extras,
          phase: String(phase || ''),
          phase_index: Number(current.phase_index || 0) + 1,
          last_transition_at: Date.now(),
        };
        return window[phaseStateName];
      };
      const getPhaseSnapshot = () => {
        const current = ensurePhaseState();
        return {
          phase: String(current.phase || ''),
          phase_index: Number(current.phase_index || 0),
          target_click_index: Number(current.target_click_index || 0),
          target_click_label: String(current.target_click_label || ''),
          last_transition_at: Number(current.last_transition_at || 0),
        };
      };
      const clickTab = async (tabName) => {
        if (!tabName) return { found: false, clicked: false, active_private_tab: '' };
        const countLeftCards = () => Array.from(document.querySelectorAll('[role="listitem"], li, a, button, div, p, span'))
          .filter((node) => isVisible(node))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.textContent);
            return rect.left < window.innerWidth * 0.36
              && rect.right < window.innerWidth * 0.52
              && rect.top >= 120
              && rect.width >= 180
              && rect.width <= 760
              && rect.height >= 36
              && rect.height <= 220
              && text
              && text.length <= 280
              && !/全部私信|朋友私信|陌生人私信|群消息/.test(text)
              && !/高清发布|发布作品|创作|数据|互动|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理/.test(text);
          }).length;
        const collectTabs = () => Array.from(document.querySelectorAll('[role="tab"], a, button, div, p, span'))
          .filter((node) => isVisible(node))
          .map((node) => {
            const label = normalize(node.textContent);
            if (!/^(全部|朋友私信|陌生人私信|群消息)$/.test(label)) return null;
            const clickable = node.closest?.('[role="tab"], button, a') || node.parentElement || node;
            if (!clickable || !isVisible(clickable)) return null;
            const rect = clickable.getBoundingClientRect();
            if (rect.top < 80 || rect.top > 280 || rect.width < 24 || rect.height < 20) return null;
            return { label, node: clickable, rect, role: clickable.getAttribute?.('role') || '' };
          })
          .filter(Boolean)
          .sort((left, right) => {
            const leftScore = left.role === 'tab' ? 0 : 1;
            const rightScore = right.role === 'tab' ? 0 : 1;
            return leftScore - rightScore || left.rect.top - right.rect.top || left.rect.left - right.rect.left || right.rect.width - left.rect.width;
          });
        const tabs = collectTabs();
        const match = tabs.find((item) => item.label === tabName)?.node || null;
        if (!match) return { found: false, clicked: false, active_private_tab: '', left_card_count: countLeftCards(), reload_attempted: false };
        window.__opencli_douyin_selected_private_tab = tabName;
        await clickNode(match, 900);
        let leftCardCount = countLeftCards();
        let reloadAttempted = false;
        if (tabName !== '全部' && leftCardCount === 0) {
          const allTab = tabs.find((item) => item.label === '全部')?.node || null;
          if (allTab) {
            reloadAttempted = true;
            await clickNode(allTab, 500);
            await clickNode(match, 900);
            leftCardCount = countLeftCards();
          }
        }
        const activeCandidates = Array.from(document.querySelectorAll('[role="tab"], a, button, div, p, span'))
          .filter((node) => isVisible(node))
          .filter((node) => /^(全部|朋友私信|陌生人私信|群消息)$/.test(normalize(node.textContent)));
        const active = activeCandidates.find((node) => node.getAttribute?.('aria-selected') === 'true')
          || activeCandidates.find((node) => /\\b(active|current|selected)\\b/i.test(String(node.className || '')))
          || activeCandidates.find((node) => normalize(node.textContent) === tabName);
        return {
          found: true,
          clicked: true,
          active_private_tab: active ? normalize(active.textContent) : tabName,
          left_card_count: leftCardCount,
          reload_attempted: reloadAttempted,
        };
      };
      const safeJson = (text) => {
        if (typeof text !== 'string' || !text.trim()) return null;
        try { return JSON.parse(text); } catch { return null; }
      };
      const urlPath = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl, window.location.href);
          return parsed.origin + parsed.pathname;
        } catch {
          return String(rawUrl || '').split('?')[0];
        }
      };
      const queryKeys = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl, window.location.href);
          return Array.from(parsed.searchParams.keys()).sort();
        } catch {
          return [];
        }
      };
      const summarize = (value, depth = 0) => {
        if (value === null) return { type: 'null' };
        if (Array.isArray(value)) {
          const first = value.find((item) => item !== null && item !== undefined);
          return { type: 'array', length: value.length, item: depth >= 2 ? undefined : summarize(first, depth + 1) };
        }
        if (typeof value === 'object') {
          const keys = Object.keys(value).sort().slice(0, 80);
          const children = {};
          if (depth < 2) {
            for (const key of keys.slice(0, 30)) children[key] = summarize(value[key], depth + 1);
          }
          return { type: 'object', keys, children };
        }
        return { type: typeof value };
      };
      const collectArrayPaths = (value, prefix = '', depth = 0, output = []) => {
        if (depth > 4 || value === null || value === undefined) return output;
        if (Array.isArray(value)) {
          output.push({ path: prefix || '$', length: value.length });
          const first = value.find((item) => item && typeof item === 'object');
          if (first) collectArrayPaths(first, prefix ? prefix + '[]' : '$[]', depth + 1, output);
          return output;
        }
        if (typeof value === 'object') {
          for (const key of Object.keys(value).slice(0, 60)) collectArrayPaths(value[key], prefix ? prefix + '.' + key : key, depth + 1, output);
        }
        return output;
      };
      const shouldCapture = (rawUrl) => {
        const text = String(rawUrl || '');
        return /creator\\.douyin\\.com|www\\.douyin\\.com|douyin\\.com/.test(text)
          && /chat|message|msg|im|conversation|session|following|notice|comment|interaction|item|user/i.test(text);
      };
      const bodyType = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return 'string';
        if (value instanceof ArrayBuffer) return 'arraybuffer';
        if (ArrayBuffer.isView(value)) return value.constructor?.name || 'typedarray';
        if (value instanceof Blob) return 'blob';
        if (value instanceof FormData) return 'formdata';
        if (value instanceof URLSearchParams) return 'urlsearchparams';
        return typeof value;
      };
      const bodyByteLength = (value) => {
        if (typeof value === 'string') return value.length;
        if (value instanceof ArrayBuffer) return value.byteLength;
        if (ArrayBuffer.isView(value)) return value.byteLength;
        if (value instanceof Blob) return value.size;
        return 0;
      };
      const hashBody = (value) => {
        let bytes = null;
        if (typeof value === 'string') {
          bytes = new TextEncoder().encode(value);
        } else if (value instanceof ArrayBuffer) {
          bytes = new Uint8Array(value);
        } else if (ArrayBuffer.isView(value)) {
          bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        } else {
          return '';
        }
        let hash = 2166136261;
        for (const byte of bytes) {
          hash ^= byte;
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
      };
      window[arrName] = [];
      window[errName] = [];
      ensurePhaseState();
      const pushEntry = (entry) => {
        const responseJson = entry.responseJson ?? null;
        const requestJson = entry.requestJson ?? null;
        const capturedAt = Date.now();
        const phaseState = getPhaseSnapshot();
        window[arrName].push({
          url_path: urlPath(entry.url),
          query_keys: queryKeys(entry.url),
          method: String(entry.method || 'GET').toUpperCase(),
          status: entry.status ?? null,
          content_type: entry.contentType || '',
          response_type: entry.responseType || '',
          request_body_type: entry.requestBodyType || '',
          request_body_byte_length: entry.requestBodyByteLength || 0,
          request_body_hash: entry.requestBodyHash || '',
          response_byte_length: entry.responseByteLength || 0,
          response_body_hash: entry.responseBodyHash || '',
          request_wire_shape: entry.requestWireShape || null,
          response_wire_shape: entry.responseWireShape || null,
          message_record_field_summary: entry.messageRecordFieldSummary || null,
          request_shape: requestJson ? summarize(requestJson) : null,
          response_shape: responseJson ? summarize(responseJson) : null,
          response_array_paths: responseJson ? collectArrayPaths(responseJson).slice(0, 30) : [],
          captured_at: capturedAt,
          capture_phase: phaseState.phase,
          capture_phase_index: phaseState.phase_index,
          target_click_index: phaseState.target_click_index,
          target_click_label: phaseState.target_click_label,
          capture_phase_elapsed_ms: Math.max(0, capturedAt - Number(phaseState.last_transition_at || capturedAt)),
          source: entry.source || '',
        });
      };
      setPhase('hooks-ready');
      if (!window.__opencli_douyin_message_api_probe_fetch) {
        window.__opencli_douyin_message_api_probe_fetch = window.fetch.bind(window);
        window.fetch = async function(...args) {
          const req = args[0];
          const init = args[1] || {};
          const rawUrl = typeof req === 'string' ? req : (req && req.url) || '';
          const method = init.method || (req && req.method) || 'GET';
          const requestJson = typeof init.body === 'string' ? safeJson(init.body) : null;
          const response = await window.__opencli_douyin_message_api_probe_fetch.apply(this, args);
          if (shouldCapture(rawUrl)) {
            try {
              const clone = response.clone();
              const text = await clone.text();
              pushEntry({
                url: rawUrl,
                method,
                status: response.status,
                contentType: response.headers.get('content-type') || '',
                responseType: 'fetch',
                requestBodyType: bodyType(init.body),
                requestBodyByteLength: bodyByteLength(init.body),
                requestBodyHash: hashBody(init.body),
                responseByteLength: text.length,
                responseBodyHash: hashBody(text),
                requestWireShape: compactProtoShape(init.body),
                requestJson,
                responseJson: safeJson(text),
                source: 'fetch',
              });
            } catch (error) {
              window[errName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'fetch' });
            }
          }
          return response;
        };
      }
      if (!window.__opencli_douyin_message_api_probe_xhr_open) {
        window.__opencli_douyin_message_api_probe_xhr_open = window.XMLHttpRequest.prototype.open;
        window.__opencli_douyin_message_api_probe_xhr_send = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function(method, rawUrl) {
          Object.defineProperty(this, '__opencli_probe_url', { value: String(rawUrl), writable: true, configurable: true });
          Object.defineProperty(this, '__opencli_probe_method', { value: String(method || 'GET').toUpperCase(), writable: true, configurable: true });
          return window.__opencli_douyin_message_api_probe_xhr_open.apply(this, arguments);
        };
        window.XMLHttpRequest.prototype.send = function(body) {
          this.addEventListener('load', function() {
            const rawUrl = this.__opencli_probe_url || '';
            if (!shouldCapture(rawUrl)) return;
            try {
              const responseType = this.responseType || 'text';
              if (responseType && responseType !== 'text') {
                pushEntry({
                  url: rawUrl,
                  method: this.__opencli_probe_method || 'GET',
                  status: this.status,
                  contentType: this.getResponseHeader('content-type') || '',
                  responseType,
                  requestBodyType: bodyType(body),
                  requestBodyByteLength: bodyByteLength(body),
                  requestBodyHash: hashBody(body),
                  responseByteLength: bodyByteLength(this.response),
                  responseBodyHash: hashBody(this.response),
                  requestWireShape: compactProtoShape(body),
                  responseWireShape: compactProtoShape(this.response),
                  messageRecordFieldSummary: (${isDouyinPrivateMessageRecordApiPath.toString()})(urlPath(rawUrl))
                    ? attributeMessageRecords(this.response, { sample_limit: recordSampleLimit, include_values: includeMessageValues })
                    : null,
                  requestJson: typeof body === 'string' ? safeJson(body) : null,
                  responseJson: null,
                  source: 'xhr',
                });
                return;
              }
              const text = typeof this.responseText === 'string' ? this.responseText : '';
              pushEntry({
                url: rawUrl,
                method: this.__opencli_probe_method || 'GET',
                status: this.status,
                contentType: this.getResponseHeader('content-type') || '',
                responseType,
                requestBodyType: bodyType(body),
                requestBodyByteLength: bodyByteLength(body),
                requestBodyHash: hashBody(body),
                responseByteLength: text.length,
                responseBodyHash: hashBody(text),
                requestWireShape: compactProtoShape(body),
                requestJson: typeof body === 'string' ? safeJson(body) : null,
                responseJson: safeJson(text),
                source: 'xhr',
              });
            } catch (error) {
              window[errName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'xhr' });
            }
          });
          return window.__opencli_douyin_message_api_probe_xhr_send.apply(this, arguments);
        };
      }
      if (!window.__opencli_douyin_message_api_probe_ws) {
        window.__opencli_douyin_message_api_probe_ws = window.WebSocket;
        const NativeWebSocket = window.WebSocket;
        class ProbeWebSocket extends NativeWebSocket {
          constructor(wsUrl, protocols) {
            super(wsUrl, protocols);
            const rawUrl = typeof wsUrl === 'string' ? wsUrl : String(wsUrl || '');
            if (shouldCapture(rawUrl)) {
              this.addEventListener('message', async (event) => {
                try {
                  if (typeof event.data === 'string') {
                    pushEntry({
                      url: rawUrl,
                      method: 'WS',
                      status: '',
                      contentType: '',
                      responseType: 'websocket-text',
                      requestBodyType: '',
                      requestBodyByteLength: 0,
                      requestBodyHash: '',
                      responseByteLength: event.data.length,
                      responseBodyHash: hashBody(event.data),
                      requestWireShape: null,
                      responseWireShape: null,
                      requestJson: null,
                      responseJson: safeJson(event.data),
                      source: 'websocket',
                    });
                    return;
                  }
                  let buffer = null;
                  if (event.data instanceof ArrayBuffer) buffer = event.data;
                  else if (event.data instanceof Blob) buffer = await event.data.arrayBuffer();
                  else if (ArrayBuffer.isView(event.data)) buffer = event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength);
                  if (!buffer) return;
                  pushEntry({
                    url: rawUrl,
                    method: 'WS',
                    status: '',
                    contentType: '',
                    responseType: 'websocket-arraybuffer',
                    requestBodyType: '',
                    requestBodyByteLength: 0,
                    requestBodyHash: '',
                    responseByteLength: bodyByteLength(buffer),
                    responseBodyHash: hashBody(buffer),
                    requestWireShape: null,
                    responseWireShape: compactProtoShape(buffer),
                    messageRecordFieldSummary: attributeMessageRecords(buffer, { sample_limit: recordSampleLimit, include_values: includeMessageValues }),
                    requestJson: null,
                    responseJson: null,
                    source: 'websocket',
                  });
                } catch (error) {
                  window[errName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'websocket' });
                }
              });
            }
          }
        }
        Object.defineProperty(ProbeWebSocket, 'CONNECTING', { value: NativeWebSocket.CONNECTING });
        Object.defineProperty(ProbeWebSocket, 'OPEN', { value: NativeWebSocket.OPEN });
        Object.defineProperty(ProbeWebSocket, 'CLOSING', { value: NativeWebSocket.CLOSING });
        Object.defineProperty(ProbeWebSocket, 'CLOSED', { value: NativeWebSocket.CLOSED });
        window.WebSocket = ProbeWebSocket;
      }
      const clickNode = async (node, delayMs = 700) => {
        if (!node) return false;
        node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        const clickableSelector = 'li, a, button, [role="list-item"], [role="listitem"], [role="gridcell"], [role="button"], [role="link"]';
        const findCardRoot = (start) => {
          let current = start;
          let fallback = start;
          while (current && current instanceof HTMLElement && current !== document.body) {
            const rect = current.getBoundingClientRect();
            if (rect.width >= 160 && rect.height >= 32 && rect.right < window.innerWidth * 0.52) {
              fallback = current;
              if (current.querySelector?.('img[src]')) return current;
            }
            current = current.parentElement;
          }
          return fallback;
        };
        const root = findCardRoot(node);
        const primary = root?.closest?.(clickableSelector)
          || root
          || node.closest?.(clickableSelector)
          || node;
        const rect = primary.getBoundingClientRect();
        const clickPoints = [
          { clientX: rect.left + Math.min(Math.max(rect.width * 0.18, 24), rect.width / 2), clientY: rect.top + rect.height / 2 },
          { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 },
        ].filter((point, index, points) => index === 0
          || Math.abs(point.clientX - points[0].clientX) > 2
          || Math.abs(point.clientY - points[0].clientY) > 2);
        const dispatchClick = (target, point) => {
          if (!target) return;
          if (typeof PointerEvent === 'function') {
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: point.clientX, clientY: point.clientY, pointerType: 'mouse', isPrimary: true }));
            target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: point.clientX, clientY: point.clientY, pointerType: 'mouse', isPrimary: true }));
          }
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: point.clientX, clientY: point.clientY }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: point.clientX, clientY: point.clientY }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: point.clientX, clientY: point.clientY }));
          target.click?.();
        };
        for (const point of clickPoints) {
          const hit = document.elementFromPoint(point.clientX, point.clientY);
          const clickable = hit?.closest?.(clickableSelector)
            || primary;
          dispatchClick(clickable, point);
        }
        await sleep(delayMs);
        return true;
      };
      const allNodes = () => Array.from(document.querySelectorAll('[role="tab"], [role="menuitem"], [role="listitem"], [role="link"], li, a, button, div, p, span'));
      const ensureState = await ensurePage(inspectState);
      setPhase('page-ready');
      const tabResult = await clickTab(targetTab);
      await sleep(waitMs);
      setPhase('tab-ready');
      const readyState = inspectState();
      const excluded = /高清发布|发布作品|创作|数据|服务|首页|内容管理|作品管理|直播|收益|设置|帮助|没有更多|私信管理|评论管理|查看Ta的主页|发送/;
      const conversationCards = (mode) => {
        const minLeft = mode === 'entry' ? window.innerWidth * 0.15 : 0;
        const maxLeft = mode === 'entry' ? window.innerWidth * 0.72 : window.innerWidth * 0.36;
        const maxWidth = mode === 'entry' ? 720 : 620;
        const seenCards = new Set();
        return allNodes().filter((node) => {
          if (!isVisible(node)) return false;
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent);
          if (rect.left < minLeft || rect.left > maxLeft) return false;
          if (mode === 'entry' && (rect.top < 100 || rect.width < 40 || rect.height < 16)) return false;
          if (mode === 'detail' && (rect.width < 120 || rect.height < 36)) return false;
          if (rect.width > maxWidth || rect.height > 220) return false;
          if (mode === 'detail' && (rect.top < 120 || rect.right > window.innerWidth * 0.48 || rect.width < 180)) return false;
          if (mode === 'entry' && /^(全部|朋友私信|陌生人私信|群消息)$/.test(text)) return false;
          if (mode === 'detail' && /全部私信|朋友私信|陌生人私信|群消息/.test(text)) return false;
          if (!text || text.length > 260 || excluded.test(text)) return false;
          if (mode === 'detail' && !node.querySelector?.('img[src]')) return false;
          const key = [
            Math.round(rect.left / 8),
            Math.round(rect.top / 8),
            Math.round(rect.width / 8),
            Math.round(rect.height / 8),
            text.slice(0, 80),
          ].join('|');
          if (seenCards.has(key)) return false;
          seenCards.add(key);
          return true;
        }).sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
        });
      };
      const dedupeCandidates = (nodes) => {
        const seen = new Set();
        return nodes.filter((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent);
          const key = [
            Math.round(rect.left / 8),
            Math.round(rect.top / 8),
            Math.round(rect.width / 8),
            Math.round(rect.height / 8),
            text.slice(0, 60),
          ].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const cleanThreadLabel = (value) => normalize(value)
        .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
        .trim();
      const normalizeThreadLabel = (value) => normalize(value)
        .replace(/\\s*(刚刚|\\d+\\s*分钟前|\\d+\\s*小时前|今天|昨天|前天|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}|你收到一条新类型消息|请打开抖音app查看).*$/, '')
        .trim()
        .toLowerCase();
      const extractThreadLabelDisplay = (node) => {
        const parts = Array.from(node.querySelectorAll?.('span, p, div') || [])
          .filter((child) => isVisible(child))
          .map((child) => normalize(child.textContent))
          .filter((text) => text && text.length <= 80);
        const candidate = parts
          .map((text) => cleanThreadLabel(text))
          .find(Boolean);
        return cleanThreadLabel(candidate || normalize(node.textContent));
      };
      const extractThreadLabel = (node) => {
        return normalizeThreadLabel(extractThreadLabelDisplay(node));
      };
      const buildThreadRowsFromNodes = (nodes) => {
        const rows = [];
        const seen = new Set();
        for (const node of dedupeCandidates(nodes)) {
          if (!isVisible(node)) continue;
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent);
          if (!text || text.length > 280) continue;
          if (!node.querySelector?.('img[src]')) continue;
          const parts = Array.from(node.querySelectorAll?.('span, p, div') || [])
            .filter((child) => isVisible(child))
            .map((child) => normalize(child.textContent))
            .filter((part) => part && part.length <= 80);
          const nickname = parts
            .map((part) => cleanThreadLabel(part))
            .find((part) => part && !excluded.test(part))
            || cleanThreadLabel(text);
          if (!nickname || excluded.test(nickname)) continue;
          const seenKey = Math.round(rect.top / 80);
          if (seen.has(seenKey)) continue;
          seen.add(seenKey);
          rows.push({
            node,
            label: normalizeThreadLabel(nickname),
            display_label: cleanThreadLabel(nickname),
            text: normalize(text).toLowerCase(),
          });
        }
        return rows;
      };
      const filterThreadCandidates = (nodes) => {
        const deduped = dedupeCandidates(nodes).map((node) => ({
          node,
          text: normalize(node.textContent).toLowerCase(),
          label: extractThreadLabel(node),
          display_label: extractThreadLabelDisplay(node),
        }));
        let filtered = deduped;
        let matchedByTarget = false;
        if (targetThreadLabel) {
          const exact = deduped.filter((item) => item.label === targetThreadLabel);
          const fuzzy = deduped.filter((item) => item.label.includes(targetThreadLabel) || item.text.includes(targetThreadLabel));
          const matched = exact.length > 0 ? exact : fuzzy;
          if (matched.length > 0) {
            filtered = matched;
            matchedByTarget = true;
          }
        } else if (targetThreadKeyword) {
          const matched = deduped.filter((item) => item.label.includes(targetThreadKeyword) || item.text.includes(targetThreadKeyword));
          if (matched.length > 0) {
            filtered = matched;
            matchedByTarget = true;
          }
        }
        if (matchedByTarget) {
          return filtered[0] ? [filtered[0].node] : [];
        }
        if (targetThreadRank > 0) {
          const selected = filtered[targetThreadRank - 1];
          return selected ? [selected.node] : [];
        }
        return filtered.map((item) => item.node);
      };
      const collectDetailCandidates = () => {
        const detailCards = domSelectors.findLeftCards();
        const fallbackCandidates = allNodes().filter((node) => {
          if (!isVisible(node)) return false;
          const rect = node.getBoundingClientRect();
          const text = normalize(node.textContent);
          return rect.left < window.innerWidth * 0.36
            && rect.right < window.innerWidth * 0.52
            && rect.top >= 120
            && rect.width >= 120
            && rect.height >= 36
            && text
            && text.length <= 240
            && Boolean(node.querySelector?.('img[src]'))
            && !excluded.test(text);
        });
        const conversationCandidates = conversationCards('detail').filter((node) => Boolean(node.querySelector?.('img[src]')));
        const primaryCandidates = detailCards.length > 0
          ? detailCards
          : (conversationCandidates.length > 0 ? conversationCandidates : fallbackCandidates);
        const threadRows = buildThreadRowsFromNodes(primaryCandidates);
        let rowCandidates = threadRows;
        if (targetThreadLabel) {
          const exact = threadRows.filter((item) => item.label === targetThreadLabel);
          const fuzzy = threadRows.filter((item) => item.label.includes(targetThreadLabel) || item.text.includes(targetThreadLabel));
          rowCandidates = exact.length > 0 ? exact : (fuzzy.length > 0 ? fuzzy : threadRows);
        } else if (targetThreadKeyword) {
          const matched = threadRows.filter((item) => item.label.includes(targetThreadKeyword) || item.text.includes(targetThreadKeyword));
          rowCandidates = matched.length > 0 ? matched : threadRows;
        }
        const rowRankCandidates = targetThreadRank > 0
          ? (rowCandidates[targetThreadRank - 1] ? [rowCandidates[targetThreadRank - 1].node] : [])
          : rowCandidates.map((item) => item.node);
        return {
          detailCards,
          fallbackCandidates,
          conversationCandidates,
          candidates: rowRankCandidates.length > 0 ? rowRankCandidates : filterThreadCandidates(primaryCandidates),
        };
      };
      const isNodeActive = (node) => {
        const className = String(node.className || '');
        if (/\\b(active|current|selected)\\b/i.test(className)) return true;
        if (node.getAttribute?.('aria-selected') === 'true') return true;
        const style = window.getComputedStyle(node);
        return /rgb\\(255,\\s*45,\\s*108\\)|rgba\\(255,\\s*45,\\s*108/i.test(String(style.borderLeftColor || ''))
          || Number.parseFloat(style.borderLeftWidth || '0') >= 2;
      };
      const collectActiveDetailCardLabels = (nodes) => dedupeCandidates(nodes)
        .filter((node) => isNodeActive(node)
          || isNodeActive(node.closest?.('li, a, button, [role="list-item"], [role="listitem"], [role="gridcell"], [role="button"], [role="link"]') || null))
        .map((node) => extractThreadLabelDisplay(node))
        .filter(Boolean)
        .slice(0, 8);
      const collectDetailHeaderLabel = () => {
        const headerCandidates = allNodes()
          .filter((node) => isVisible(node))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            text: cleanThreadLabel(node.textContent),
          }))
          .filter((item) => item.text
            && item.text.length <= 40
            && item.rect.top >= 70
            && item.rect.top <= 190
            && item.rect.left >= window.innerWidth * 0.32
            && item.rect.left <= window.innerWidth * 0.68
            && item.rect.width <= 320
            && !/查看Ta的主页|全部私信|朋友私信|陌生人私信|群消息|抖音创作者中心/.test(item.text))
          .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left || right.text.length - left.text.length);
        return headerCandidates[0]?.text || '';
      };
      const collectDetailPaneSignature = () => {
        const messageParts = domSelectors.findMessageCandidates()
          .filter((node) => isVisible(node))
          .map((node) => normalize(node.textContent))
          .filter((text) => text && text.length <= 120)
          .slice(0, 8);
        const header = cleanThreadLabel(collectDetailHeaderLabel());
        return normalize([header, ...messageParts].join('|')).slice(0, 240);
      };
      const findHistoryLoadButtons = () => {
        const leftBoundary = Math.max(
          window.innerWidth * 0.35,
          ...detailCards.map((node) => node.getBoundingClientRect().right + 16),
          ...conversationCandidates.map((node) => node.getBoundingClientRect().right + 16),
        );
        return allNodes()
          .filter((node) => isVisible(node))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            text: normalize(node.textContent),
          }))
          .filter((item) => item.text === '加载')
          .filter((item) => item.rect.left >= leftBoundary
            && item.rect.right <= window.innerWidth * 0.92
            && item.rect.top >= 80
            && item.rect.bottom <= window.innerHeight - 80
            && item.rect.width >= 24
            && item.rect.width <= 220
            && item.rect.height >= 20
            && item.rect.height <= 96)
          .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)
          .map((item) => item.node);
      };
      const findDetailScrollContainer = () => {
        const leftBoundary = Math.max(
          window.innerWidth * 0.3,
          ...detailCards.map((node) => node.getBoundingClientRect().right + 8),
          ...conversationCandidates.map((node) => node.getBoundingClientRect().right + 8),
        );
        return allNodes()
          .filter((node) => isVisible(node))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            scrollHeight: Number(node.scrollHeight || 0),
            clientHeight: Number(node.clientHeight || 0),
            overflowY: String(window.getComputedStyle(node).overflowY || ''),
          }))
          .filter((item) => item.rect.left >= leftBoundary
            && item.rect.right <= window.innerWidth
            && item.rect.top >= 72
            && item.rect.height >= 180
            && item.scrollHeight > item.clientHeight + 40
            && /(auto|scroll|overlay)/i.test(item.overflowY))
          .sort((left, right) => right.rect.height - left.rect.height)
          .map((item) => item.node);
      };
      const scrollDetailPaneToTop = async () => {
        const container = findDetailScrollContainer()[0] || null;
        if (!container) return false;
        for (let index = 0; index < 3; index += 1) {
          container.scrollTop = 0;
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
          await sleep(180);
        }
        return true;
      };
      const waitForHistoryLoadButton = async (retries = 6, waitMs = 250) => {
        for (let index = 0; index < retries; index += 1) {
          const button = findHistoryLoadButtons()[0];
          if (button) return button;
          await scrollDetailPaneToTop();
          await sleep(waitMs);
        }
        return null;
      };
      const clickHistoryLoadButtons = async () => {
        const historyLoads = [];
        for (let index = 0; index < historyClickCount; index += 1) {
          await scrollDetailPaneToTop();
          const button = await waitForHistoryLoadButton();
          if (!button) break;
          setPhase('history-load-click');
          const text = normalize(button.textContent).slice(0, 40) || '加载';
          const clickedAt = Date.now();
          await clickNode(button, 700);
          historyLoads.push({
            click_index: index + 1,
            label: text,
            clicked_at: clickedAt,
          });
          await sleep(500);
        }
        return historyLoads;
      };
      const tryOpenDetailFromEntryCards = async (nodes, phaseName = 'entry-click') => {
        for (const entryNode of dedupeCandidates(nodes).slice(0, 4)) {
          setPhase(phaseName);
          const clicked = await clickNode(entryNode, 900);
          if (!clicked) continue;
          const nextState = inspectState();
          if (nextState.left_card_avatar_count > 0 || nextState.left_card_count > 0) {
            return true;
          }
        }
        return false;
      };
      const entryCards = readyState.url_looks_private ? domSelectors.findEntryCards() : [];
      const entryCardsWithAvatar = entryCards.filter((node) => Boolean(node.querySelector?.('img[src]')));
      const filteredEntryCards = filterThreadCandidates(entryCards);
      const filteredEntryCardsWithAvatar = filteredEntryCards.filter((node) => Boolean(node.querySelector?.('img[src]')));
      const useNeutralEntryCard = targetThreadRank > 0 || Boolean(targetThreadKeyword) || Boolean(targetThreadLabel);
      let enteredDetail = false;
      if (!readyState.has_private_tabs && readyState.url_looks_private && filteredEntryCards[0]) {
        const preferredEntries = useNeutralEntryCard
          ? (entryCardsWithAvatar.length > 0 ? entryCardsWithAvatar : entryCards)
          : (filteredEntryCardsWithAvatar.length > 0 ? filteredEntryCardsWithAvatar : (filteredEntryCards.length > 0 ? filteredEntryCards : (entryCardsWithAvatar.length > 0 ? entryCardsWithAvatar : entryCards)));
        enteredDetail = await tryOpenDetailFromEntryCards(preferredEntries, 'entry-click');
      } else if (readyState.has_private_tabs && readyState.left_card_avatar_count === 0) {
        const preferredEntries = useNeutralEntryCard
          ? (entryCardsWithAvatar.length > 0 ? entryCardsWithAvatar : entryCards)
          : (filteredEntryCardsWithAvatar.length > 0 ? filteredEntryCardsWithAvatar : (filteredEntryCards.length > 0 ? filteredEntryCards : (entryCardsWithAvatar.length > 0 ? entryCardsWithAvatar : entryCards)));
        if (preferredEntries[0]) {
          enteredDetail = await tryOpenDetailFromEntryCards(preferredEntries, 'entry-click');
        }
      }
      const stateAfterEntry = inspectState();
      setPhase('detail-ready');
      let detailCollection = stateAfterEntry.has_private_tabs ? collectDetailCandidates() : {
        detailCards: [],
        fallbackCandidates: [],
        conversationCandidates: [],
        candidates: [],
      };
      let detailRetryCount = 0;
      for (; detailRetryCount < 4 && detailCollection.candidates.length === 0; detailRetryCount += 1) {
        await sleep(450);
        detailCollection = inspectState().has_private_tabs ? collectDetailCandidates() : detailCollection;
      }
      if (detailCollection.candidates.length === 0 && stateAfterEntry.has_private_tabs && filteredEntryCards.length > 0) {
        detailCollection = {
          ...detailCollection,
          candidates: filterThreadCandidates([
            ...(filteredEntryCardsWithAvatar.length > 0 ? filteredEntryCardsWithAvatar : filteredEntryCards),
            ...detailCollection.candidates,
          ]),
        };
      }
      if (detailCollection.candidates.length === 0 && stateAfterEntry.has_private_tabs && entryCardsWithAvatar[0]) {
        enteredDetail = await tryOpenDetailFromEntryCards(entryCardsWithAvatar.length > 0 ? entryCardsWithAvatar : entryCards, 'entry-retry-click') || enteredDetail;
        detailCollection = inspectState().has_private_tabs ? collectDetailCandidates() : detailCollection;
        setPhase('detail-ready');
      }
      const detailCards = detailCollection.detailCards;
      const fallbackCandidates = detailCollection.fallbackCandidates;
      const conversationCandidates = detailCollection.conversationCandidates;
      const candidates = detailCollection.candidates;
      const activeConversationLabelsBefore = collectActiveDetailCardLabels([
        ...detailCards,
        ...conversationCandidates,
      ]);
      const activeConversationLabelKeysBefore = activeConversationLabelsBefore
        .map((label) => normalizeThreadLabel(label))
        .filter(Boolean);
      const clicked = [];
      const clickTimeline = [];
      for (const target of candidates.slice(0, clickCount)) {
        const clickedLabel = (extractThreadLabelDisplay(target) || normalize(target.textContent)).slice(0, 80);
        const targetClickIndex = clicked.length + 1;
        const clickedAt = Date.now();
        clicked.push(clickedLabel);
        clickTimeline.push({
          label: clickedLabel,
          target_click_index: targetClickIndex,
          clicked_at: clickedAt,
        });
        const clickedLabelKey = normalizeThreadLabel(clickedLabel);
        const clickCandidates = dedupeCandidates([
          target,
          ...detailCards.filter((node) => extractThreadLabel(node) === clickedLabelKey),
          ...conversationCandidates.filter((node) => extractThreadLabel(node) === clickedLabelKey),
          ...fallbackCandidates.filter((node) => extractThreadLabel(node) === clickedLabelKey),
        ])
          .sort((left, right) => {
            const score = (node) => {
              const tag = String(node.tagName || '').toLowerCase();
              const role = String(node.getAttribute?.('role') || '').toLowerCase();
              const className = String(node.className || '');
              return (tag === 'li' ? 4 : 0)
                + (role === 'list-item' ? 3 : 0)
                + (role === 'listitem' ? 2 : 0)
                + (role === 'gridcell' ? 1 : 0)
                + (/semi-list-item/.test(className) ? 2 : 0)
                + (node.querySelector?.('img[src]') ? 1 : 0);
            };
            return score(right) - score(left);
          })
          .slice(0, 4);
        const targetAlreadyActive = activeConversationLabelKeysBefore.includes(clickedLabelKey);
        const beforeSignature = collectDetailPaneSignature();
        if (targetAlreadyActive) {
          const alternateCandidate = dedupeCandidates([
            ...detailCards,
            ...conversationCandidates,
            ...fallbackCandidates,
          ])
            .find((node) => {
              const labelKey = extractThreadLabel(node);
              return labelKey && labelKey !== clickedLabelKey;
            });
          if (alternateCandidate) {
            setPhase('target-prime-click', {
              target_click_index: targetClickIndex,
              target_click_label: clickedLabel,
            });
            await clickNode(alternateCandidate, 400);
            await sleep(250);
          }
        }
        for (const clickCandidate of clickCandidates) {
          setPhase('target-click', {
            target_click_index: targetClickIndex,
            target_click_label: clickedLabel,
          });
          await clickNode(clickCandidate, 500);
          const afterSignature = collectDetailPaneSignature();
          if (afterSignature && beforeSignature && afterSignature !== beforeSignature) {
            break;
          }
        }
      }
      const historyLoads = historyClickCount > 0 ? await clickHistoryLoadButtons() : [];
      await sleep(waitMs);
      setPhase('capture-finished');
      const finalState = inspectState();
      const activeConversationLabelsAfter = collectActiveDetailCardLabels([
        ...detailCards,
        ...conversationCandidates,
      ]);
      window.__opencli_douyin_message_api_probe_click_result = {
        phase: 'detail',
        entry_state: ensureState,
        tab_result: tabResult,
        target_thread_rank: targetThreadRank,
        target_thread_keyword: targetThreadKeyword,
        target_thread_label: targetThreadLabel,
        entered_detail: enteredDetail,
        has_private_tabs: finalState.has_private_tabs,
        url_looks_private: finalState.url_looks_private,
        state_after_entry: stateAfterEntry,
        entry_candidate_count: entryCards.length,
        filtered_entry_candidate_count: filteredEntryCards.length,
        filtered_entry_labels: filteredEntryCards.map((node) => extractThreadLabelDisplay(node)).slice(0, 12),
        detail_candidate_count: detailCards.length,
        detail_retry_count: detailRetryCount,
        detail_conversation_candidate_count: conversationCandidates.length,
        detail_fallback_candidate_count: fallbackCandidates.length,
        detail_card_labels: detailCards.map((node) => extractThreadLabelDisplay(node)).slice(0, 20),
        detail_conversation_labels: conversationCandidates.map((node) => extractThreadLabelDisplay(node)).slice(0, 20),
        detail_fallback_labels: fallbackCandidates.map((node) => extractThreadLabelDisplay(node)).slice(0, 20),
        active_detail_card_labels: collectActiveDetailCardLabels(detailCards),
        active_conversation_labels_before: activeConversationLabelsBefore,
        active_conversation_labels_after: activeConversationLabelsAfter,
        detail_header_label: collectDetailHeaderLabel(),
        candidate_count: candidates.length,
        candidate_labels: candidates.map((node) => extractThreadLabelDisplay(node)).slice(0, 20),
        clicked_count: clicked.length,
        clicked_labels: clicked,
        first_target_click_at: clickTimeline[0]?.clicked_at || 0,
        last_target_click_at: clickTimeline[clickTimeline.length - 1]?.clicked_at || 0,
        click_timeline: clickTimeline,
        history_load_click_count: historyLoads.length,
        history_load_labels: historyLoads.map((item) => item.label),
        history_load_timeline: historyLoads,
      };
      const rows = Array.isArray(window[arrName]) ? window[arrName].slice() : [];
      const errors = Array.isArray(window[errName]) ? window[errName].slice() : [];
      const byKey = new Map();
      for (const row of rows) {
        const key = [row.method, row.url_path, row.status, JSON.stringify(row.query_keys || [])].join('|');
        if (!byKey.has(key)) byKey.set(key, row);
      }
      return {
        current_url: window.location.href,
        title: document.title || '',
        page_state: finalState,
        captured_count: rows.length,
        deduped_count: byKey.size,
        errors,
        click_result: window.__opencli_douyin_message_api_probe_click_result || null,
        all_rows: rows,
        rows: Array.from(byKey.values()),
      };
    })()
  `);
  const initialRows = Array.isArray(result?.all_rows) ? result.all_rows : [];
  const hasConversationResponse = initialRows.some((row) => isDouyinPrivateMessageConversationApiPath(String(row.url_path || '')));
  if (allowDomFallback && !hasConversationResponse && conversationClicks > 0) {
    await fetchDouyinPrivateMessageRows(page, {
      ...kwargs,
      skip_navigate: true,
      limit: conversationClicks,
      message_limit: Math.min(3, Number(kwargs.message_limit || 3)),
      load_history_clicks: kwargs.load_history_clicks ?? kwargs.loadHistoryClicks ?? 0,
    });
    if (typeof page?.wait === 'function') {
      await page.wait(waitSeconds);
    }
    result = await readProbeResult();
  }

  const sourceRows = keepDuplicates ? result?.all_rows : result?.rows;
  const rows = Array.isArray(sourceRows) ? sourceRows.slice(0, maxRows) : [];
  if (rows.length === 0) {
    return [{
      current_url: result?.current_url || '',
      title: result?.title || '',
      page_state: result?.page_state || null,
      captured_count: Number(result?.captured_count || 0),
      deduped_count: Number(result?.deduped_count || 0),
      source: '',
      url_path: '',
      method: '',
      status: '',
      response_type: '',
      content_type: '',
      request_body_type: '',
      request_body_byte_length: 0,
      request_body_hash: '',
      response_byte_length: 0,
      response_body_hash: '',
      request_wire_shape: null,
      response_wire_shape: null,
      message_record_field_summary: null,
      query_keys: [],
      response_array_paths: [],
      response_shape: null,
      request_shape: null,
      click_result: result?.click_result || null,
      errors: result?.errors || [],
    }];
  }
  return rows.map((row, index) => ({
    rank: index + 1,
    current_url: result?.current_url || '',
    title: result?.title || '',
    page_state: result?.page_state || null,
    captured_count: Number(result?.captured_count || 0),
    deduped_count: Number(result?.deduped_count || 0),
    source: row.source || '',
    url_path: row.url_path || '',
    method: row.method || '',
    status: row.status ?? '',
    response_type: row.response_type || '',
    content_type: row.content_type || '',
    request_body_type: row.request_body_type || '',
    request_body_byte_length: Number(row.request_body_byte_length || 0),
    request_body_hash: row.request_body_hash || '',
    response_byte_length: Number(row.response_byte_length || 0),
    response_body_hash: row.response_body_hash || '',
    request_wire_shape: row.request_wire_shape || null,
    response_wire_shape: row.response_wire_shape || null,
    message_record_field_summary: row.message_record_field_summary || null,
    query_keys: row.query_keys || [],
    response_array_paths: row.response_array_paths || [],
    response_shape: row.response_shape || null,
    request_shape: row.request_shape || null,
    captured_at: Number(row.captured_at || 0),
    capture_phase: row.capture_phase || '',
    capture_phase_index: Number(row.capture_phase_index || 0),
    target_click_index: Number(row.target_click_index || 0),
    target_click_label: row.target_click_label || '',
    capture_phase_elapsed_ms: Number(row.capture_phase_elapsed_ms || 0),
    click_result: result?.click_result || null,
    errors: result?.errors || [],
  }));
}

export async function probeDouyinPrivateMessageFieldAttribution(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageApis(page, {
    ...kwargs,
    limit: kwargs.limit ?? 10,
  });
  const targetRows = rows
    .filter((row) => isDouyinPrivateMessageRecordApiPath(String(row.url_path || ''))
      && row.message_record_field_summary);
  const target = targetRows
    .sort((left, right) => {
      const leftConversation = isDouyinPrivateMessageConversationApiPath(String(left.url_path || '')) ? 1 : 0;
      const rightConversation = isDouyinPrivateMessageConversationApiPath(String(right.url_path || '')) ? 1 : 0;
      return rightConversation - leftConversation
        || Number(right.message_record_field_summary?.record_count || 0) - Number(left.message_record_field_summary?.record_count || 0);
    })[0];
  const summary = target?.message_record_field_summary;
  if (!summary?.fields?.length) {
    return [{
      current_url: rows[0]?.current_url || '',
      title: rows[0]?.title || '',
      url_path: target?.url_path || '',
      status: target?.status ?? '',
      response_byte_length: target?.response_byte_length || 0,
      candidate_path: summary?.candidate_path || '6.200.1[]',
      record_count: summary?.record_count || 0,
      sampled_record_count: summary?.sampled_record_count || 0,
      field_path: '',
      field_no: '',
      depth: '',
      wire_type: '',
      value_type: '',
      count: 0,
      record_coverage: 0,
      value_bytes_min: 0,
      value_bytes_max: 0,
      numeric_min: '',
      numeric_max: '',
      timestamp_min: '',
      timestamp_max: '',
      enum_values: [],
      string_like_count: 0,
      nested_count: 0,
      redacted_hash_samples: [],
      role_candidates: [],
      errors: rows.flatMap((row) => row.errors || []),
    }];
  }
  return summary.fields.map((field, index) => ({
    rank: index + 1,
    current_url: target.current_url || '',
    title: target.title || '',
    url_path: target.url_path || '',
    status: target.status ?? '',
    response_byte_length: Number(target.response_byte_length || summary.response_byte_length || 0),
    candidate_path: summary.candidate_path || '6.200.1[]',
    record_count: Number(summary.record_count || 0),
    sampled_record_count: Number(summary.sampled_record_count || 0),
    field_path: field.field_path || String(field.field_no || ''),
    field_no: field.field_no,
    depth: Number(field.depth || 0),
    wire_type: field.wire_type,
    value_type: field.value_type,
    count: Number(field.count || 0),
    record_coverage: Number(field.record_coverage || 0),
    value_bytes_min: Number(field.value_bytes_min || 0),
    value_bytes_max: Number(field.value_bytes_max || 0),
    numeric_min: field.numeric_min ?? '',
    numeric_max: field.numeric_max ?? '',
    timestamp_min: field.timestamp_min || '',
    timestamp_max: field.timestamp_max || '',
    enum_values: field.enum_values || [],
    string_like_count: Number(field.string_like_count || 0),
    nested_count: Number(field.nested_count || 0),
    redacted_hash_samples: field.redacted_hash_samples || [],
    role_candidates: field.role_candidates || [],
    errors: rows.flatMap((row) => row.errors || []),
  }));
}

export async function probeDouyinPrivateMessageRecordAttribution(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageApis(page, {
    ...kwargs,
    limit: kwargs.limit ?? 10,
  });
  const targetRows = rows
    .filter((row) => isDouyinPrivateMessageRecordApiPath(String(row.url_path || ''))
      && row.message_record_field_summary);
  const target = targetRows
    .sort((left, right) => {
      const leftConversation = isDouyinPrivateMessageConversationApiPath(String(left.url_path || '')) ? 1 : 0;
      const rightConversation = isDouyinPrivateMessageConversationApiPath(String(right.url_path || '')) ? 1 : 0;
      return rightConversation - leftConversation
        || Number(right.message_record_field_summary?.record_count || 0) - Number(left.message_record_field_summary?.record_count || 0);
    })[0];
  const summary = target?.message_record_field_summary;
  if (!summary?.record_samples?.length) {
    return [{
      current_url: rows[0]?.current_url || '',
      title: rows[0]?.title || '',
      url_path: target?.url_path || '',
      status: target?.status ?? '',
      response_byte_length: target?.response_byte_length || 0,
      candidate_path: summary?.candidate_path || '6.200.1[]',
      record_count: summary?.record_count || 0,
      sampled_record_count: summary?.sampled_record_count || 0,
      record_rank: '',
      record_key_hash: '',
      message_id_hash: '',
      timestamp_candidate: '',
      timestamp_field_path: '',
      direction_candidate_values: [],
      payload_field_path: '',
      payload_value_bytes: 0,
      payload_timestamp_candidate: '',
      payload_timestamp_key: '',
      payload_text_hash: '',
      payload_text_key: '',
      payload_hash: '',
      payload_kind: '',
      payload_json_keys: [],
      payload_field_count: 0,
      payload_field_paths: [],
      field9_samples: [],
      protobuf_branch_samples: [],
      value_shape_samples: [],
      peer_hash_candidates: [],
      metadata_hash_candidates: [],
      errors: rows.flatMap((row) => row.errors || []),
    }];
  }
  return summary.record_samples.map((record, index) => ({
    rank: index + 1,
    current_url: target.current_url || '',
    title: target.title || '',
    url_path: target.url_path || '',
    status: target.status ?? '',
    response_byte_length: Number(target.response_byte_length || summary.response_byte_length || 0),
    candidate_path: summary.candidate_path || '6.200.1[]',
    record_count: Number(summary.record_count || 0),
    sampled_record_count: Number(summary.sampled_record_count || 0),
    record_rank: Number(record.record_rank || 0),
    record_key_hash: record.record_key_hash || '',
    message_id_hash: record.message_id_hash || '',
    timestamp_candidate: record.timestamp_candidate || '',
    timestamp_field_path: record.timestamp_field_path || '',
    direction_candidate_values: record.direction_candidate_values || [],
    payload_field_path: record.payload_field_path || '',
    payload_value_bytes: Number(record.payload_value_bytes || 0),
    payload_timestamp_candidate: record.payload_timestamp_candidate || '',
    payload_timestamp_key: record.payload_timestamp_key || '',
    payload_text_hash: record.payload_text_hash || '',
    payload_text_key: record.payload_text_key || '',
    payload_hash: record.payload_hash || '',
    payload_kind: record.payload_kind || '',
    payload_json_keys: record.payload_json_keys || [],
    payload_field_count: Number(record.payload_field_count || 0),
    payload_field_paths: record.payload_field_paths || [],
    field9_samples: record.field9_samples || [],
    protobuf_branch_samples: record.protobuf_branch_samples || [],
    value_shape_samples: record.value_shape_samples || [],
    peer_hash_candidates: record.peer_hash_candidates || [],
    metadata_hash_candidates: record.metadata_hash_candidates || [],
    errors: rows.flatMap((row) => row.errors || []),
  }));
}

export async function probeDouyinPrivateMessagePayloadAttribution(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageRecordAttribution(page, kwargs);
  return rows.map((row) => ({
    rank: row.rank || '',
    current_url: row.current_url || '',
    title: row.title || '',
    url_path: row.url_path || '',
    status: row.status ?? '',
    response_byte_length: Number(row.response_byte_length || 0),
    candidate_path: row.candidate_path || '6.200.1[]',
    record_count: Number(row.record_count || 0),
    sampled_record_count: Number(row.sampled_record_count || 0),
    record_rank: row.record_rank || '',
    record_key_hash: row.record_key_hash || '',
    timestamp_candidate: row.timestamp_candidate || '',
    payload_field_path: row.payload_field_path || '',
    payload_value_bytes: Number(row.payload_value_bytes || 0),
    payload_timestamp_candidate: row.payload_timestamp_candidate || '',
    payload_timestamp_key: row.payload_timestamp_key || '',
    payload_text_hash: row.payload_text_hash || '',
    payload_text_key: row.payload_text_key || '',
    payload_hash: row.payload_hash || '',
    payload_kind: row.payload_kind || '',
    payload_json_keys: row.payload_json_keys || [],
    payload_field_count: Number(row.payload_field_count || 0),
    payload_field_paths: row.payload_field_paths || [],
    errors: row.errors || [],
  }));
}

export async function probeDouyinPrivateMessageProtobufBranchAttribution(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageRecordAttribution(page, kwargs);
  return rows.flatMap((row) => {
    const samples = Array.isArray(row.protobuf_branch_samples) ? row.protobuf_branch_samples : [];
    if (samples.length === 0) {
      return [{
        rank: row.rank || '',
        current_url: row.current_url || '',
        title: row.title || '',
        url_path: row.url_path || '',
        status: row.status ?? '',
        response_byte_length: Number(row.response_byte_length || 0),
        candidate_path: row.candidate_path || '6.200.1[]',
        record_count: Number(row.record_count || 0),
        sampled_record_count: Number(row.sampled_record_count || 0),
        record_rank: row.record_rank || '',
        record_key_hash: row.record_key_hash || '',
        timestamp_candidate: row.timestamp_candidate || '',
        branch_field_path: '',
        branch_hash: '',
        branch_value_bytes: 0,
        branch_field_count: 0,
        branch_field_paths: [],
        descendant_field_count: 0,
        descendant_length_delimited_count: 0,
        descendant_protobuf_branch_count: 0,
        descendant_utf8_text_count: 0,
        descendant_human_phrase_count: 0,
        descendant_json_leaf_count: 0,
        descendant_cjk_leaf_count: 0,
        descendant_value_kinds: [],
        descendant_field_paths: [],
        errors: row.errors || [],
      }];
    }
    return samples.map((sample, index) => ({
      rank: `${row.rank || ''}.${index + 1}`,
      current_url: row.current_url || '',
      title: row.title || '',
      url_path: row.url_path || '',
      status: row.status ?? '',
      response_byte_length: Number(row.response_byte_length || 0),
      candidate_path: row.candidate_path || '6.200.1[]',
      record_count: Number(row.record_count || 0),
      sampled_record_count: Number(row.sampled_record_count || 0),
      record_rank: row.record_rank || '',
      record_key_hash: row.record_key_hash || '',
      timestamp_candidate: row.timestamp_candidate || '',
      branch_field_path: sample.branch_field_path || '',
      branch_hash: sample.branch_hash || '',
      branch_value_bytes: Number(sample.branch_value_bytes || 0),
      branch_field_count: Number(sample.branch_field_count || 0),
      branch_field_paths: sample.branch_field_paths || [],
      descendant_field_count: Number(sample.descendant_field_count || 0),
      descendant_length_delimited_count: Number(sample.descendant_length_delimited_count || 0),
      descendant_protobuf_branch_count: Number(sample.descendant_protobuf_branch_count || 0),
      descendant_utf8_text_count: Number(sample.descendant_utf8_text_count || 0),
      descendant_human_phrase_count: Number(sample.descendant_human_phrase_count || 0),
      descendant_json_leaf_count: Number(sample.descendant_json_leaf_count || 0),
      descendant_cjk_leaf_count: Number(sample.descendant_cjk_leaf_count || 0),
      descendant_value_kinds: sample.descendant_value_kinds || [],
      descendant_field_paths: sample.descendant_field_paths || [],
      errors: row.errors || [],
    }));
  });
}

export async function probeDouyinPrivateMessageField9Attribution(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageRecordAttribution(page, kwargs);
  return rows.flatMap((row) => {
    const samples = Array.isArray(row.field9_samples) ? row.field9_samples : [];
    if (samples.length === 0) {
      return [{
        rank: row.rank || '',
        current_url: row.current_url || '',
        title: row.title || '',
        url_path: row.url_path || '',
        status: row.status ?? '',
        response_byte_length: Number(row.response_byte_length || 0),
        candidate_path: row.candidate_path || '6.200.1[]',
        record_count: Number(row.record_count || 0),
        sampled_record_count: Number(row.sampled_record_count || 0),
        record_rank: row.record_rank || '',
        record_key_hash: row.record_key_hash || '',
        timestamp_candidate: row.timestamp_candidate || '',
        field9_item_rank: '',
        field9_hash: '',
        field9_value_bytes: 0,
        part1_hash: '',
        part1_value_bytes: 0,
        part2_hash: '',
        part2_kind: '',
        part2_value_bytes: 0,
        part2_json_keys: [],
        part2_field_count: 0,
        part2_field_paths: [],
        part2_value_shape: '',
        part2_char_count: 0,
        part2_charset: '',
        part2_has_space: false,
        part2_has_cjk: false,
        part2_has_emoji: false,
        part2_digit_ratio: 0,
        errors: row.errors || [],
      }];
    }
    return samples.map((sample, index) => ({
      rank: `${row.rank || ''}.${index + 1}`,
      current_url: row.current_url || '',
      title: row.title || '',
      url_path: row.url_path || '',
      status: row.status ?? '',
      response_byte_length: Number(row.response_byte_length || 0),
      candidate_path: row.candidate_path || '6.200.1[]',
      record_count: Number(row.record_count || 0),
      sampled_record_count: Number(row.sampled_record_count || 0),
      record_rank: row.record_rank || '',
      record_key_hash: row.record_key_hash || '',
      timestamp_candidate: row.timestamp_candidate || '',
      field9_item_rank: Number(sample.field9_item_rank || 0),
      field9_hash: sample.field9_hash || '',
      field9_value_bytes: Number(sample.field9_value_bytes || 0),
      part1_hash: sample.part1_hash || '',
      part1_value_bytes: Number(sample.part1_value_bytes || 0),
      part2_hash: sample.part2_hash || '',
      part2_kind: sample.part2_kind || '',
      part2_value_bytes: Number(sample.part2_value_bytes || 0),
      part2_json_keys: sample.part2_json_keys || [],
      part2_field_count: Number(sample.part2_field_count || 0),
      part2_field_paths: sample.part2_field_paths || [],
      part2_value_shape: sample.part2_value_shape || '',
      part2_char_count: Number(sample.part2_char_count || 0),
      part2_charset: sample.part2_charset || '',
      part2_has_space: Boolean(sample.part2_has_space),
      part2_has_cjk: Boolean(sample.part2_has_cjk),
      part2_has_emoji: Boolean(sample.part2_has_emoji),
      part2_digit_ratio: Number(sample.part2_digit_ratio || 0),
      errors: row.errors || [],
    }));
  });
}

export async function probeDouyinPrivateMessageField9Classification(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageField9Attribution(page, kwargs);
  return rows.map((row) => ({
    rank: row.rank || '',
    current_url: row.current_url || '',
    title: row.title || '',
    url_path: row.url_path || '',
    status: row.status ?? '',
    response_byte_length: Number(row.response_byte_length || 0),
    candidate_path: row.candidate_path || '6.200.1[]',
    record_count: Number(row.record_count || 0),
    sampled_record_count: Number(row.sampled_record_count || 0),
    record_rank: row.record_rank || '',
    record_key_hash: row.record_key_hash || '',
    timestamp_candidate: row.timestamp_candidate || '',
    field9_item_rank: row.field9_item_rank || '',
    field9_hash: row.field9_hash || '',
    part1_hash: row.part1_hash || '',
    part1_value_bytes: Number(row.part1_value_bytes || 0),
    part2_hash: row.part2_hash || '',
    part2_kind: row.part2_kind || '',
    part2_value_bytes: Number(row.part2_value_bytes || 0),
    part2_value_shape: row.part2_value_shape || '',
    part2_char_count: Number(row.part2_char_count || 0),
    part2_charset: row.part2_charset || '',
    part2_has_space: Boolean(row.part2_has_space),
    part2_has_cjk: Boolean(row.part2_has_cjk),
    part2_has_emoji: Boolean(row.part2_has_emoji),
    part2_digit_ratio: Number(row.part2_digit_ratio || 0),
    errors: row.errors || [],
  }));
}

export async function probeDouyinPrivateMessageValueShapeAttribution(page, kwargs = {}) {
  const rows = await probeDouyinPrivateMessageRecordAttribution(page, kwargs);
  return rows.flatMap((row) => {
    const samples = Array.isArray(row.value_shape_samples) ? row.value_shape_samples : [];
    if (samples.length === 0) {
      return [{
        rank: row.rank || '',
        current_url: row.current_url || '',
        title: row.title || '',
        url_path: row.url_path || '',
        status: row.status ?? '',
        response_byte_length: Number(row.response_byte_length || 0),
        candidate_path: row.candidate_path || '6.200.1[]',
        record_count: Number(row.record_count || 0),
        sampled_record_count: Number(row.sampled_record_count || 0),
        record_rank: row.record_rank || '',
        record_key_hash: row.record_key_hash || '',
        timestamp_candidate: row.timestamp_candidate || '',
        field_path: '',
        value_hash: '',
        value_kind: '',
        value_bytes: 0,
        value_shape: '',
        char_count: 0,
        charset: '',
        has_space: false,
        has_cjk: false,
        has_emoji: false,
        digit_ratio: 0,
        errors: row.errors || [],
      }];
    }
    return samples.map((sample, index) => ({
      rank: `${row.rank || ''}.${index + 1}`,
      current_url: row.current_url || '',
      title: row.title || '',
      url_path: row.url_path || '',
      status: row.status ?? '',
      response_byte_length: Number(row.response_byte_length || 0),
      candidate_path: row.candidate_path || '6.200.1[]',
      record_count: Number(row.record_count || 0),
      sampled_record_count: Number(row.sampled_record_count || 0),
      record_rank: row.record_rank || '',
      record_key_hash: row.record_key_hash || '',
      timestamp_candidate: row.timestamp_candidate || '',
      field_path: sample.field_path || '',
      value_hash: sample.value_hash || '',
      value_kind: sample.value_kind || '',
      value_bytes: Number(sample.value_bytes || 0),
      value_shape: sample.value_shape || '',
      char_count: Number(sample.char_count || 0),
      charset: sample.charset || '',
      has_space: Boolean(sample.has_space),
      has_cjk: Boolean(sample.has_cjk),
      has_emoji: Boolean(sample.has_emoji),
      digit_ratio: Number(sample.digit_ratio || 0),
      errors: row.errors || [],
    }));
  });
}

export function buildDouyinPrivateMessageDomApiMatches(domRows = [], apiRows = []) {
  const toEpochSeconds = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      return numeric > 1e12 ? Math.round(numeric / 1000) : numeric;
    }
    const normalized = text.replace(' ', 'T');
    const parsed = Date.parse(normalized);
    if (Number.isNaN(parsed)) return null;
    return Math.round(parsed / 1000);
  };
  const apiList = Array.isArray(apiRows) ? apiRows : [];
  const apiByHash = new Map();
  for (const row of apiList) {
    const valueHash = String(row.value_hash || '').trim();
    if (!valueHash) continue;
    const rows = apiByHash.get(valueHash) || [];
    rows.push(row);
    apiByHash.set(valueHash, rows);
  }

  return (Array.isArray(domRows) ? domRows : []).map((row, index) => {
    const text = String(row.text ?? '').trim();
    const textHash = hashDouyinUtf8Text(text);
    const matches = apiByHash.get(textHash) || [];
    const matchedFieldPaths = [];
    const matchedRecordRanks = [];
    const matchedValueShapes = [];
    const matchedValueBytes = [];
    const matchedDirectionCandidateSets = [];
    const matchedTimestampCandidates = [];
    const matchedPayloadTimestampCandidates = [];
    const matchedPayloadTimestampKeys = [];
    const matchedTimestampDeltaSeconds = [];
    const matchedPayloadTimestampDeltaSeconds = [];
    const matchedPeerHashCandidates = [];
    const matchedMetadataHashCandidates = [];
    const matchedField9Part1Hashes = [];
    const matchedField9Part2Hashes = [];
    const matchedField9PairHashes = [];
    const matchedField9RankedPairHashes = [];
    const domEpochSeconds = toEpochSeconds(row.time);
    for (const match of matches) {
      if (match.field_path && !matchedFieldPaths.includes(match.field_path)) matchedFieldPaths.push(match.field_path);
      if (match.record_rank && !matchedRecordRanks.includes(match.record_rank)) matchedRecordRanks.push(match.record_rank);
      if (match.value_shape && !matchedValueShapes.includes(match.value_shape)) matchedValueShapes.push(match.value_shape);
      const valueBytes = Number(match.value_bytes || 0);
      if (valueBytes && !matchedValueBytes.includes(valueBytes)) matchedValueBytes.push(valueBytes);
      const directionSignature = (Array.isArray(match.direction_candidate_values) ? match.direction_candidate_values : []).join(',');
      if (directionSignature && !matchedDirectionCandidateSets.includes(directionSignature)) matchedDirectionCandidateSets.push(directionSignature);
      if (match.timestamp_candidate && !matchedTimestampCandidates.includes(match.timestamp_candidate)) matchedTimestampCandidates.push(match.timestamp_candidate);
      if (match.payload_timestamp_candidate && !matchedPayloadTimestampCandidates.includes(match.payload_timestamp_candidate)) {
        matchedPayloadTimestampCandidates.push(match.payload_timestamp_candidate);
      }
      if (match.payload_timestamp_key && !matchedPayloadTimestampKeys.includes(match.payload_timestamp_key)) {
        matchedPayloadTimestampKeys.push(match.payload_timestamp_key);
      }
      for (const peerHash of Array.isArray(match.peer_hash_candidates) ? match.peer_hash_candidates : []) {
        if (peerHash && !matchedPeerHashCandidates.includes(peerHash)) matchedPeerHashCandidates.push(peerHash);
      }
      for (const metadataHash of Array.isArray(match.metadata_hash_candidates) ? match.metadata_hash_candidates : []) {
        if (metadataHash && !matchedMetadataHashCandidates.includes(metadataHash)) matchedMetadataHashCandidates.push(metadataHash);
      }
      for (const part1Hash of Array.isArray(match.field9_part1_hashes) ? match.field9_part1_hashes : []) {
        if (part1Hash && !matchedField9Part1Hashes.includes(part1Hash)) matchedField9Part1Hashes.push(part1Hash);
      }
      for (const part2Hash of Array.isArray(match.field9_part2_hashes) ? match.field9_part2_hashes : []) {
        if (part2Hash && !matchedField9Part2Hashes.includes(part2Hash)) matchedField9Part2Hashes.push(part2Hash);
      }
      for (const pairHash of Array.isArray(match.field9_pair_hashes) ? match.field9_pair_hashes : []) {
        if (pairHash && !matchedField9PairHashes.includes(pairHash)) matchedField9PairHashes.push(pairHash);
      }
      for (const rankedPairHash of Array.isArray(match.field9_ranked_pair_hashes) ? match.field9_ranked_pair_hashes : []) {
        if (rankedPairHash && !matchedField9RankedPairHashes.includes(rankedPairHash)) matchedField9RankedPairHashes.push(rankedPairHash);
      }
      const recordEpochSeconds = toEpochSeconds(match.timestamp_candidate);
      if (domEpochSeconds !== null && recordEpochSeconds !== null) {
        const deltaSeconds = recordEpochSeconds - domEpochSeconds;
        if (!matchedTimestampDeltaSeconds.includes(deltaSeconds)) matchedTimestampDeltaSeconds.push(deltaSeconds);
      }
      const payloadEpochSeconds = toEpochSeconds(match.payload_timestamp_candidate);
      if (domEpochSeconds !== null && payloadEpochSeconds !== null) {
        const deltaSeconds = payloadEpochSeconds - domEpochSeconds;
        if (!matchedPayloadTimestampDeltaSeconds.includes(deltaSeconds)) matchedPayloadTimestampDeltaSeconds.push(deltaSeconds);
      }
    }
    return {
      rank: index + 1,
      dom_message_rank: row.row_rank || row.message_rank || index + 1,
      dom_text_hash: textHash,
      dom_text_length: Array.from(text).length,
      dom_sender_hash: row.sender_name ? hashDouyinUtf8Text(row.sender_name) : '',
      dom_time: row.time || '',
      dom_direction: row.direction || '',
      api_match_count: matches.length,
      matched_field_paths: matchedFieldPaths,
      matched_record_ranks: matchedRecordRanks,
      matched_value_shapes: matchedValueShapes,
      matched_value_bytes: matchedValueBytes,
      matched_direction_candidate_sets: matchedDirectionCandidateSets,
      matched_timestamp_candidates: matchedTimestampCandidates,
      matched_payload_timestamp_candidates: matchedPayloadTimestampCandidates,
      matched_payload_timestamp_keys: matchedPayloadTimestampKeys,
      matched_timestamp_delta_seconds: matchedTimestampDeltaSeconds,
      matched_payload_timestamp_delta_seconds: matchedPayloadTimestampDeltaSeconds,
      matched_peer_hash_candidates: matchedPeerHashCandidates,
      matched_metadata_hash_candidates: matchedMetadataHashCandidates,
      matched_field9_part1_hashes: matchedField9Part1Hashes,
      matched_field9_part2_hashes: matchedField9Part2Hashes,
      matched_field9_pair_hashes: matchedField9PairHashes,
      matched_field9_ranked_pair_hashes: matchedField9RankedPairHashes,
      candidate_path: matches[0]?.candidate_path || apiList[0]?.candidate_path || '',
      record_count: Number(matches[0]?.record_count || apiList[0]?.record_count || 0),
      sampled_record_count: Number(matches[0]?.sampled_record_count || apiList[0]?.sampled_record_count || 0),
      url_path: matches[0]?.url_path || apiList[0]?.url_path || '',
      errors: apiList.flatMap((apiRow) => apiRow.errors || []),
    };
  });
}

export function summarizeDouyinPrivateMessageMatchedHashFingerprints(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const unique = (values) => Array.from(new Set((Array.isArray(values) ? values : []).filter((value) => value !== '' && value !== null && value !== undefined)));
  const flatten = (items, key) => unique(items.flatMap((item) => Array.isArray(item?.[key]) ? item[key] : []));
  const onlyInLeft = (left, right) => left.filter((value) => !right.includes(value));
  const intersection = (left, right) => left.filter((value) => right.includes(value));
  const inbound = list.filter((row) => row?.dom_direction === 'inbound');
  const outbound = list.filter((row) => row?.dom_direction === 'outbound');

  const inboundPeerHashes = flatten(inbound, 'matched_peer_hash_candidates');
  const outboundPeerHashes = flatten(outbound, 'matched_peer_hash_candidates');
  const inboundMetadataHashes = flatten(inbound, 'matched_metadata_hash_candidates');
  const outboundMetadataHashes = flatten(outbound, 'matched_metadata_hash_candidates');
  const inboundField9Part1Hashes = flatten(inbound, 'matched_field9_part1_hashes');
  const outboundField9Part1Hashes = flatten(outbound, 'matched_field9_part1_hashes');
  const inboundField9Part2Hashes = flatten(inbound, 'matched_field9_part2_hashes');
  const outboundField9Part2Hashes = flatten(outbound, 'matched_field9_part2_hashes');
  const inboundField9PairHashes = flatten(inbound, 'matched_field9_pair_hashes');
  const outboundField9PairHashes = flatten(outbound, 'matched_field9_pair_hashes');
  const inboundField9RankedPairHashes = flatten(inbound, 'matched_field9_ranked_pair_hashes');
  const outboundField9RankedPairHashes = flatten(outbound, 'matched_field9_ranked_pair_hashes');

  return {
    inbound_peer_hash_candidates: inboundPeerHashes,
    outbound_peer_hash_candidates: outboundPeerHashes,
    inbound_only_peer_hash_candidates: onlyInLeft(inboundPeerHashes, outboundPeerHashes),
    outbound_only_peer_hash_candidates: onlyInLeft(outboundPeerHashes, inboundPeerHashes),
    shared_peer_hash_candidates: intersection(inboundPeerHashes, outboundPeerHashes),
    inbound_metadata_hash_candidates: inboundMetadataHashes,
    outbound_metadata_hash_candidates: outboundMetadataHashes,
    inbound_only_metadata_hash_candidates: onlyInLeft(inboundMetadataHashes, outboundMetadataHashes),
    outbound_only_metadata_hash_candidates: onlyInLeft(outboundMetadataHashes, inboundMetadataHashes),
    shared_metadata_hash_candidates: intersection(inboundMetadataHashes, outboundMetadataHashes),
    inbound_field9_part1_hashes: inboundField9Part1Hashes,
    outbound_field9_part1_hashes: outboundField9Part1Hashes,
    inbound_only_field9_part1_hashes: onlyInLeft(inboundField9Part1Hashes, outboundField9Part1Hashes),
    outbound_only_field9_part1_hashes: onlyInLeft(outboundField9Part1Hashes, inboundField9Part1Hashes),
    shared_field9_part1_hashes: intersection(inboundField9Part1Hashes, outboundField9Part1Hashes),
    inbound_field9_part2_hashes: inboundField9Part2Hashes,
    outbound_field9_part2_hashes: outboundField9Part2Hashes,
    inbound_only_field9_part2_hashes: onlyInLeft(inboundField9Part2Hashes, outboundField9Part2Hashes),
    outbound_only_field9_part2_hashes: onlyInLeft(outboundField9Part2Hashes, inboundField9Part2Hashes),
    shared_field9_part2_hashes: intersection(inboundField9Part2Hashes, outboundField9Part2Hashes),
    inbound_field9_pair_hashes: inboundField9PairHashes,
    outbound_field9_pair_hashes: outboundField9PairHashes,
    inbound_only_field9_pair_hashes: onlyInLeft(inboundField9PairHashes, outboundField9PairHashes),
    outbound_only_field9_pair_hashes: onlyInLeft(outboundField9PairHashes, inboundField9PairHashes),
    shared_field9_pair_hashes: intersection(inboundField9PairHashes, outboundField9PairHashes),
    inbound_field9_ranked_pair_hashes: inboundField9RankedPairHashes,
    outbound_field9_ranked_pair_hashes: outboundField9RankedPairHashes,
    inbound_only_field9_ranked_pair_hashes: onlyInLeft(inboundField9RankedPairHashes, outboundField9RankedPairHashes),
    outbound_only_field9_ranked_pair_hashes: onlyInLeft(outboundField9RankedPairHashes, inboundField9RankedPairHashes),
    shared_field9_ranked_pair_hashes: intersection(inboundField9RankedPairHashes, outboundField9RankedPairHashes),
  };
}

export function summarizeDouyinPrivateMessageDirectionScanRows(rows = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const threadRank = Number(options.thread_rank ?? options.threadRank ?? list[0]?.thread_rank ?? 0);
  const apiRows = Array.isArray(options.api_rows) ? options.api_rows : [];
  const unique = (values) => Array.from(new Set((Array.isArray(values) ? values : []).filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== '' && value !== null && value !== undefined;
  })));
  const flatUnique = (selector) => unique(list.flatMap((row) => {
    const value = selector(row);
    return Array.isArray(value) ? value : [value];
  }));
  const inboundRows = list.filter((row) => row?.dom_direction === 'inbound');
  const outboundRows = list.filter((row) => row?.dom_direction === 'outbound');
  const matchedRows = list.filter((row) => Number(row?.api_match_count || 0) > 0);
  const inboundMatchedRows = inboundRows.filter((row) => Number(row?.api_match_count || 0) > 0);
  const outboundMatchedRows = outboundRows.filter((row) => Number(row?.api_match_count || 0) > 0);
  const inboundApiRows = apiRows.filter((row) => row?.direction === 'inbound');
  const outboundApiRows = apiRows.filter((row) => row?.direction === 'outbound');
  const firstRow = list[0] || {};
  return {
    rank: threadRank || 1,
    thread_rank: threadRank || 0,
    dom_row_count: Number(firstRow.dom_row_count || list.length || 0),
    inbound_dom_count: inboundRows.length,
    outbound_dom_count: outboundRows.length,
    matched_dom_count: matchedRows.length,
    inbound_matched_count: inboundMatchedRows.length,
    outbound_matched_count: outboundMatchedRows.length,
    dom_directions: unique(list.map((row) => row?.dom_direction || '')),
    direction_candidate_sets: flatUnique((row) => row?.matched_direction_candidate_sets || []),
    inbound_direction_candidate_sets: flatUnique((row) => row?.dom_direction === 'inbound' ? (row?.matched_direction_candidate_sets || []) : []),
    outbound_direction_candidate_sets: flatUnique((row) => row?.dom_direction === 'outbound' ? (row?.matched_direction_candidate_sets || []) : []),
    matched_field_paths: flatUnique((row) => row?.matched_field_paths || []),
    matched_payload_timestamp_keys: flatUnique((row) => row?.matched_payload_timestamp_keys || []),
    matched_timestamp_delta_seconds: flatUnique((row) => row?.matched_timestamp_delta_seconds || []),
    matched_payload_timestamp_delta_seconds: flatUnique((row) => row?.matched_payload_timestamp_delta_seconds || []),
    captured_api_count: Number(firstRow.captured_api_count || 0),
    captured_url_paths: unique(firstRow.captured_url_paths || []),
    api_row_count: apiRows.length,
    api_inbound_count: inboundApiRows.length,
    api_outbound_count: outboundApiRows.length,
    api_directions: unique(apiRows.map((row) => row?.direction || '')),
    api_source_url_paths: unique(apiRows.map((row) => row?.source_url_path || '')),
    page_state: firstRow.page_state || null,
    url_path: String(firstRow.url_path || ''),
    errors: flatUnique((row) => row?.errors || []),
  };
}

export async function probeDouyinPrivateMessageDomApiMatch(page, kwargs = {}) {
  const url = String(kwargs.url || DOUYIN_PRIVATE_MESSAGES_URL);
  const recordSampleLimit = Math.max(1, Math.min(500, Number(kwargs.record_sample_limit ?? kwargs.sample_limit ?? 30)));
  const waitSeconds = Number(kwargs.wait_seconds || 2);
  const domRetryCount = Math.max(1, Math.min(4, Number(kwargs.dom_retry_count ?? kwargs.retry_count ?? 2)));
  const refreshPage = Boolean(kwargs.refresh ?? kwargs.force_refresh ?? kwargs.refreshPage);
  let currentUrl = '';
  if (typeof page?.evaluate === 'function') {
    try {
      currentUrl = String(await page.evaluate('window.location.href')).trim();
    } catch {
      currentUrl = '';
    }
  }
  if ((refreshPage || !currentUrl || !currentUrl.startsWith(url)) && typeof page?.goto === 'function') {
    await page.goto(url);
    if (typeof page.wait === 'function') await page.wait(2);
  }
  await ensureDouyinPrivateMessagePage(page, kwargs);
  await page.evaluate(`
    (() => {
      const arrName = '__opencli_douyin_dom_api_match_probe';
      const errName = '__opencli_douyin_dom_api_match_probe_errors';
      window[arrName] = [];
      window[errName] = [];
      const urlPath = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl, window.location.href);
          return parsed.origin + parsed.pathname;
        } catch {
          return String(rawUrl || '').split('?')[0];
        }
      };
      const shouldCapture = (rawUrl) => (${isDouyinPrivateMessageRecordApiPath.toString()})(urlPath(rawUrl));
      const bodyByteLength = (value) => {
        if (value instanceof ArrayBuffer) return value.byteLength;
        if (ArrayBuffer.isView(value)) return value.byteLength;
        if (typeof value === 'string') return value.length;
        if (value instanceof Blob) return value.size;
        return 0;
      };
      const attributeMessageRecords = ${attributeDouyinPrivateMessageRecordFields.toString()};
      const recordSampleLimit = ${JSON.stringify(recordSampleLimit)};
      const pushResponse = (entry) => {
        window[arrName].push({
          url_path: urlPath(entry.url),
          method: String(entry.method || 'GET').toUpperCase(),
          status: entry.status ?? null,
          response_type: entry.responseType || '',
          content_type: entry.contentType || '',
          response_byte_length: bodyByteLength(entry.response),
          message_record_field_summary: attributeMessageRecords(entry.response, { sample_limit: recordSampleLimit }),
          captured_at: Date.now(),
          source: entry.source || '',
        });
      };
      if (!window.__opencli_douyin_dom_api_match_fetch) {
        window.__opencli_douyin_dom_api_match_fetch = window.fetch.bind(window);
        window.fetch = async function(...args) {
          const req = args[0];
          const init = args[1] || {};
          const rawUrl = typeof req === 'string' ? req : (req && req.url) || '';
          const method = init.method || (req && req.method) || 'GET';
          const response = await window.__opencli_douyin_dom_api_match_fetch.apply(this, args);
          if (shouldCapture(rawUrl)) {
            try {
              const clone = response.clone();
              const buffer = await clone.arrayBuffer();
              pushResponse({
                url: rawUrl,
                method,
                status: response.status,
                contentType: response.headers.get('content-type') || '',
                responseType: 'arraybuffer',
                response: buffer,
                source: 'fetch',
              });
            } catch (error) {
              window[errName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'fetch' });
            }
          }
          return response;
        };
      }
      if (!window.__opencli_douyin_dom_api_match_xhr_open) {
        window.__opencli_douyin_dom_api_match_xhr_open = window.XMLHttpRequest.prototype.open;
        window.__opencli_douyin_dom_api_match_xhr_send = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function(method, rawUrl) {
          Object.defineProperty(this, '__opencli_dom_api_match_url', { value: String(rawUrl), writable: true, configurable: true });
          Object.defineProperty(this, '__opencli_dom_api_match_method', { value: String(method || 'GET').toUpperCase(), writable: true, configurable: true });
          return window.__opencli_douyin_dom_api_match_xhr_open.apply(this, arguments);
        };
        window.XMLHttpRequest.prototype.send = function(body) {
          this.addEventListener('load', function() {
            const rawUrl = this.__opencli_dom_api_match_url || '';
            if (!shouldCapture(rawUrl)) return;
            try {
              pushResponse({
                url: rawUrl,
                method: this.__opencli_dom_api_match_method || 'GET',
                status: this.status,
                contentType: this.getResponseHeader('content-type') || '',
                responseType: this.responseType || 'text',
                response: this.response,
                source: 'xhr',
              });
            } catch (error) {
              window[errName].push({ url_path: urlPath(rawUrl), error: String(error), source: 'xhr' });
            }
          });
          return window.__opencli_douyin_dom_api_match_xhr_send.apply(this, arguments);
        };
      }
      return { ok: true };
    })()
  `);
  const readCaptured = () => page.evaluate(`
    (() => ({
      page_state: (${inspectDouyinPrivateMessagePageStateBrowser.toString()})(),
      rows: Array.isArray(window.__opencli_douyin_dom_api_match_probe) ? window.__opencli_douyin_dom_api_match_probe : [],
      errors: Array.isArray(window.__opencli_douyin_dom_api_match_probe_errors) ? window.__opencli_douyin_dom_api_match_probe_errors : [],
    }))()
  `);
  let domRows = [];
  let captured = { rows: [], errors: [], page_state: null };
  for (let attempt = 0; attempt < domRetryCount; attempt += 1) {
    try {
      domRows = await fetchDouyinPrivateMessageRows(page, {
        ...kwargs,
        skip_navigate: true,
        include_outbound: kwargs.include_outbound ?? true,
        limit: kwargs.dom_limit ?? kwargs.limit,
        message_limit: kwargs.dom_message_limit ?? kwargs.message_limit,
      });
      if (typeof page.wait === 'function') await page.wait(waitSeconds);
      captured = await readCaptured();
    } catch (error) {
      if (attempt + 1 >= domRetryCount || !isDouyinPageIdentityError(error)) {
        throw error;
      }
      await ensureDouyinPrivateMessagePage(page, kwargs);
      continue;
    }
    const capturedRows = Array.isArray(captured?.rows) ? captured.rows : [];
    const hasConversationRows = capturedRows.some((entry) => isDouyinPrivateMessageConversationApiPath(String(entry.url_path || '')));
    if (domRows.length > 0 && hasConversationRows) break;
    await ensureDouyinPrivateMessagePage(page, kwargs);
  }
  const apiRows = [];
  for (const entry of Array.isArray(captured?.rows) ? captured.rows : []) {
    const summary = entry.message_record_field_summary || {};
    for (const record of summary.record_samples || []) {
      for (const sample of record.value_shape_samples || []) {
        apiRows.push({
          current_url: '',
          title: '',
          url_path: entry.url_path || '',
          status: entry.status ?? '',
          response_byte_length: Number(entry.response_byte_length || summary.response_byte_length || 0),
          candidate_path: summary.candidate_path || '6.200.1[]',
          record_count: Number(summary.record_count || 0),
          sampled_record_count: Number(summary.sampled_record_count || 0),
          record_rank: Number(record.record_rank || 0),
          record_key_hash: record.record_key_hash || '',
          timestamp_candidate: record.timestamp_candidate || '',
          field_path: sample.field_path || '',
          value_hash: sample.value_hash || '',
          value_kind: sample.value_kind || '',
          value_bytes: Number(sample.value_bytes || 0),
          value_shape: sample.value_shape || '',
          char_count: Number(sample.char_count || 0),
          charset: sample.charset || '',
          has_space: Boolean(sample.has_space),
          has_cjk: Boolean(sample.has_cjk),
          has_emoji: Boolean(sample.has_emoji),
          digit_ratio: Number(sample.digit_ratio || 0),
          direction_candidate_values: record.direction_candidate_values || [],
          timestamp_candidate: record.timestamp_candidate || '',
          payload_timestamp_candidate: record.payload_timestamp_candidate || '',
          payload_timestamp_key: record.payload_timestamp_key || '',
          peer_hash_candidates: record.peer_hash_candidates || [],
          metadata_hash_candidates: record.metadata_hash_candidates || [],
          field9_part1_hashes: Array.isArray(record.field9_samples)
            ? record.field9_samples.map((item) => item?.part1_hash || '').filter(Boolean)
            : [],
          field9_part2_hashes: Array.isArray(record.field9_samples)
            ? record.field9_samples.map((item) => item?.part2_hash || '').filter(Boolean)
            : [],
          field9_pair_hashes: Array.isArray(record.field9_pair_hashes)
            ? record.field9_pair_hashes.filter(Boolean)
            : [],
          field9_ranked_pair_hashes: Array.isArray(record.field9_ranked_pair_hashes)
            ? record.field9_ranked_pair_hashes.filter(Boolean)
            : [],
          errors: captured?.errors || [],
        });
      }
    }
  }
  const matches = buildDouyinPrivateMessageDomApiMatches(domRows, apiRows);
  if (matches.length === 0) {
    const firstDomRow = domRows[0] || {};
    const firstDomText = String(firstDomRow.text ?? '').trim();
    const capturedUrlPaths = Array.from(new Set((Array.isArray(captured?.rows) ? captured.rows : []).map((row) => String(row.url_path || '')).filter(Boolean)));
    return [{
      rank: firstDomRow.row_rank || firstDomRow.message_rank || '',
      dom_message_rank: firstDomRow.row_rank || firstDomRow.message_rank || '',
      dom_text_hash: firstDomText ? hashDouyinUtf8Text(firstDomText) : '',
      dom_text_length: Array.from(firstDomText).length,
      dom_sender_hash: firstDomRow.sender_name ? hashDouyinUtf8Text(firstDomRow.sender_name) : '',
      dom_time: firstDomRow.time || '',
      dom_direction: firstDomRow.direction || '',
      dom_row_count: domRows.length,
      page_state: captured?.page_state || null,
      captured_api_count: Array.isArray(captured?.rows) ? captured.rows.length : 0,
      captured_url_paths: capturedUrlPaths,
      api_match_count: 0,
      matched_field_paths: [],
      matched_record_ranks: [],
      matched_value_shapes: [],
      matched_value_bytes: [],
      matched_direction_candidate_sets: [],
      matched_timestamp_candidates: [],
      matched_payload_timestamp_candidates: [],
      matched_payload_timestamp_keys: [],
      matched_timestamp_delta_seconds: [],
      matched_payload_timestamp_delta_seconds: [],
      matched_peer_hash_candidates: [],
      matched_metadata_hash_candidates: [],
      matched_field9_part1_hashes: [],
      matched_field9_part2_hashes: [],
      matched_field9_pair_hashes: [],
      matched_field9_ranked_pair_hashes: [],
      candidate_path: apiRows[0]?.candidate_path || '',
      record_count: Number(apiRows[0]?.record_count || 0),
      sampled_record_count: Number(apiRows[0]?.sampled_record_count || 0),
      url_path: apiRows[0]?.url_path || '',
      errors: apiRows.flatMap((apiRow) => apiRow.errors || []),
    }];
  }
  const capturedUrlPaths = Array.from(new Set((Array.isArray(captured?.rows) ? captured.rows : []).map((row) => String(row.url_path || '')).filter(Boolean)));
  const fingerprintSummary = summarizeDouyinPrivateMessageMatchedHashFingerprints(matches);
  return matches.map((row) => ({
    ...row,
    dom_row_count: domRows.length,
    page_state: captured?.page_state || null,
    captured_api_count: Array.isArray(captured?.rows) ? captured.rows.length : 0,
    captured_url_paths: capturedUrlPaths,
    ...fingerprintSummary,
  }));
}

export function isDouyinPageIdentityError(error) {
  const text = String(error ?? '').trim();
  if (!text) {
    return false;
  }
  return /stale page identity|Detached while handling command|Page not found|execution context was destroyed|Target closed/i.test(text);
}

export async function probeDouyinPrivateMessageDirectionScan(page, kwargs = {}) {
  const startArg = Number(kwargs.thread_rank_start ?? kwargs.threadRankStart ?? kwargs.thread_rank ?? kwargs.threadRank ?? 1);
  const endArg = Number(kwargs.thread_rank_end ?? kwargs.threadRankEnd ?? kwargs.thread_rank ?? kwargs.threadRank ?? 5);
  const start = Math.max(1, Math.round(Number.isFinite(startArg) ? startArg : 1));
  const end = Math.max(start, Math.round(Number.isFinite(endArg) ? endArg : start));
  const results = [];
  for (let threadRank = start; threadRank <= end; threadRank += 1) {
    let lastError = '';
    let summary = null;
    try {
      summary = await withDouyinPrivateMessagePageIdentityRetry(page, kwargs, async () => {
        const rows = await probeDouyinPrivateMessageDomApiMatch(page, {
          ...kwargs,
          thread_rank: threadRank,
          include_outbound: kwargs.include_outbound ?? true,
          limit: 1,
        });
        let apiRows = [];
        const hasCapturedApiRows = rows.some((row) => Number(row?.captured_api_count || 0) > 0);
        if (!hasCapturedApiRows) {
          apiRows = await fetchDouyinPrivateMessageApiRows(page, {
            ...kwargs,
            thread_rank: threadRank,
            include_outbound: true,
          });
        }
        return summarizeDouyinPrivateMessageDirectionScanRows(rows, {
          thread_rank: threadRank,
          api_rows: apiRows,
        });
      });
    } catch (error) {
      lastError = String(error);
    }
    if (summary) {
      results.push(summary);
    } else {
      results.push({
        rank: threadRank,
        thread_rank: threadRank,
        dom_row_count: 0,
        inbound_dom_count: 0,
        outbound_dom_count: 0,
        matched_dom_count: 0,
        inbound_matched_count: 0,
        outbound_matched_count: 0,
        dom_directions: [],
        direction_candidate_sets: [],
        inbound_direction_candidate_sets: [],
        outbound_direction_candidate_sets: [],
        matched_field_paths: [],
        matched_payload_timestamp_keys: [],
        matched_timestamp_delta_seconds: [],
        matched_payload_timestamp_delta_seconds: [],
        captured_api_count: 0,
        captured_url_paths: [],
        api_row_count: 0,
        api_inbound_count: 0,
        api_outbound_count: 0,
        api_directions: [],
        api_source_url_paths: [],
        page_state: null,
        url_path: '',
        errors: lastError ? [lastError] : [],
      });
    }
  }
  return results;
}

export function normalizeDouyinVideoLimit(limit, fallback = 20) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(50, Math.max(1, Math.round(numeric)));
}

export function normalizeDouyinCommentLimit(limit, fallback = 20) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(50, Math.max(1, Math.round(numeric)));
}

export function normalizeDouyinPageLimit(pages, fallback = 1) {
  const numeric = Number(pages);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(20, Math.max(1, Math.round(numeric)));
}

export async function fetchDouyinWebApi(page, path, params = {}, options = {}) {
  const url = new URL(path.startsWith('http') ? path : `${DOUYIN_WEB_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const js = `
    (async () => {
      try {
        const response = await fetch(${JSON.stringify(url.toString())}, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            referer: 'https://www.douyin.com/',
            ...${JSON.stringify(options.headers ?? {})}
          }
        });
        return await response.json();
      } catch (error) {
        return {
          __opencli_fetch_error: error instanceof Error ? error.message : String(error)
        };
      }
    })()
  `;

  const result = await page.evaluate(js);

  if (!result || typeof result !== 'object') {
    throw new Error(`Douyin web API returned non-JSON response for ${url}`);
  }

  if (result.__opencli_fetch_error) {
    throw new Error(`Douyin web API request failed for ${url} (${result.__opencli_fetch_error})`);
  }

  if (typeof result.status_code === 'number' && result.status_code !== 0) {
    throw new Error(`Douyin web API error ${result.status_code} for ${url}`);
  }

  return result;
}

export async function findDouyinResourceUrl(page, pathFragment) {
  return page.evaluate(({ fragment }) => {
    const resources = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => typeof name === 'string' && name.includes(fragment));
    return resources.length ? resources[resources.length - 1] : '';
  }, { fragment: pathFragment });
}

export async function findDouyinNetworkRequestUrl(page, pathFragment) {
  if (typeof page?.networkRequests !== 'function') {
    return '';
  }
  try {
    const requests = await page.networkRequests(false);
    if (!Array.isArray(requests)) {
      return '';
    }
    const matched = requests
      .map((entry) => entry?.url)
      .filter((url) => typeof url === 'string' && url.includes(pathFragment));
    return matched.length ? matched[matched.length - 1] : '';
  } catch {
    return '';
  }
}

export async function waitForDouyinResourceUrl(page, pathFragment, attempts = 10, waitSeconds = 1) {
  for (let index = 0; index < attempts; index += 1) {
    const url = await findDouyinResourceUrl(page, pathFragment);
    if (typeof url === 'string' && url) {
      return url;
    }
    if (typeof page?.wait === 'function') {
      await page.wait(waitSeconds);
    }
  }
  return '';
}

export async function fetchDouyinUserVideoPage(page, secUid, options = {}) {
  const limit = normalizeDouyinVideoLimit(options.limit ?? 20, 20);
  const cursor = String(options.cursor ?? '0');

  const data = await fetchDouyinWebApi(page, DOUYIN_USER_VIDEOS_PATH, {
    sec_user_id: secUid,
    max_cursor: cursor,
    count: limit,
    aid: '6383',
  });
  const nextCursor = pickFirstNonEmpty(data.max_cursor, data.cursor, data.next_cursor);
  const hasMore = data.has_more === true || Number(data.has_more ?? data.hasMore ?? 0) > 0;
  return {
    rows: Array.isArray(data.aweme_list) ? data.aweme_list : [],
    has_more: hasMore,
    next_cursor: hasMore ? nextCursor : '',
  };
}

export async function fetchDouyinUserVideos(page, secUid, options = {}) {
  const result = await fetchDouyinUserVideoPage(page, secUid, options);
  return result.rows;
}

export async function fetchDouyinComments(page, awemeId, options = {}) {
  const limit = normalizeDouyinCommentLimit(options.limit ?? 20, 20);
  const pages = normalizeDouyinPageLimit(options.pages ?? 1, 1);
  let cursor = String(options.cursor ?? '0');
  const rows = [];

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const data = await fetchDouyinWebApi(page, DOUYIN_COMMENT_LIST_PATH, {
      aweme_id: awemeId,
      count: limit,
      cursor,
      aid: '6383',
    });
    const comments = Array.isArray(data.comments) ? data.comments.slice(0, limit) : [];
    rows.push(...comments);

    const nextCursor = pickFirstNonEmpty(data.cursor, data.next_cursor, data.max_cursor);
    const hasMore = data.has_more === true || Number(data.has_more ?? data.hasMore ?? 0) > 0;
    if (!hasMore || !nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  }

  return rows;
}

export async function fetchDouyinCommentReplies(page, awemeId, commentId, options = {}) {
  const limit = normalizeDouyinCommentLimit(options.limit ?? 20, 20);
  const pages = normalizeDouyinPageLimit(options.pages ?? 1, 1);
  let cursor = String(options.cursor ?? '0');
  const rows = [];

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const data = await fetchDouyinWebApi(page, DOUYIN_COMMENT_REPLY_LIST_PATH, {
      item_id: awemeId,
      comment_id: commentId,
      count: limit,
      cursor,
      aid: '6383',
    });
    const comments = Array.isArray(data.comments)
      ? data.comments.slice(0, limit)
      : [];
    rows.push(...comments);

    const nextCursor = pickFirstNonEmpty(data.cursor, data.next_cursor, data.max_cursor);
    const hasMore = data.has_more === true || Number(data.has_more ?? data.hasMore ?? 0) > 0;
    if (!hasMore || !nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  }

  return rows;
}
