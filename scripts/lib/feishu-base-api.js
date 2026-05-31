import { ensureText } from './scrm-base.js';

const DEFAULT_API_BASE_URL = 'https://open.feishu.cn/open-apis';
const DRIVE_MEDIA_SINGLE_PART_LIMIT_BYTES = 20 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function tableId(table = {}) {
  return ensureText(table.table_id || table.tableId || table.id);
}

function tableName(table = {}) {
  return ensureText(table.name || table.table_name || table.tableName);
}

function fieldName(field = {}) {
  return ensureText(field.field_name || field.name || field.fieldName);
}

function fieldId(field = {}) {
  return ensureText(field.field_id || field.fieldId || field.id);
}

function viewName(view = {}) {
  return ensureText(view.view_name || view.name || view.viewName);
}

function viewId(view = {}) {
  return ensureText(view.view_id || view.viewId || view.id);
}

function isDefaultPrimaryField(field = {}, index = 0) {
  const name = fieldName(field);
  return index === 0 && ['多行文本', 'ID'].includes(name);
}

function recordId(record = {}) {
  return ensureText(record.record_id || record.recordId || record.id);
}

function fieldMap(record = {}) {
  return record.fields || {};
}

function cellText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => cellText(item?.text ?? item?.name ?? item?.value ?? item)).filter(Boolean).join('');
  }
  if (typeof value === 'object') return ensureText(value.text || value.name || value.value || value.link || JSON.stringify(value));
  return ensureText(value);
}

function appendQuery(url, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${url}?${suffix}` : url;
}

function bitableFieldSpec(spec = {}) {
  const name = ensureText(spec.name);
  if (!name) throw new Error('Feishu field spec requires name.');
  if (spec.type === 'number') {
    return {
      field_name: name,
      type: 2,
      property: { formatter: '0' },
    };
  }
  if (spec.type === 'datetime') {
    return {
      field_name: name,
      type: 5,
      property: { date_formatter: 'yyyy-MM-dd HH:mm' },
    };
  }
  return {
    field_name: name,
    type: 1,
  };
}

function usesBaseV3FieldApi(spec = {}) {
  return ['formula', 'lookup', 'link', 'select', 'checkbox', 'attachment'].includes(spec.type)
    || (spec.type === 'text' && spec.style && Object.keys(spec.style).length > 0);
}

function baseV3FieldSpec(spec = {}) {
  const name = ensureText(spec.name);
  if (!name) throw new Error('Feishu field spec requires name.');
  const body = {
    name,
    type: ensureText(spec.type) || 'text',
  };
  if (spec.description) body.description = ensureText(spec.description);
  if (spec.expression) body.expression = ensureText(spec.expression);
  if (spec.multiple !== undefined) body.multiple = Boolean(spec.multiple);
  if (spec.options) body.options = spec.options;
  if (spec.from) body.from = spec.from;
  if (spec.select) body.select = spec.select;
  if (spec.where) body.where = spec.where;
  if (spec.aggregate) body.aggregate = spec.aggregate;
  if (spec.link_table) body.link_table = spec.link_table;
  if (spec.bidirectional !== undefined) body.bidirectional = Boolean(spec.bidirectional);
  if (spec.bidirectional_link_field_name) body.bidirectional_link_field_name = spec.bidirectional_link_field_name;
  if (spec.style) body.style = spec.style;
  return body;
}

export class FeishuBaseApiClient {
  constructor({
    appId,
    appSecret,
    appToken = '',
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    requestTimeoutMs = Number(process.env.HARVEST_FEISHU_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
  } = {}) {
    this.appId = ensureText(appId);
    this.appSecret = ensureText(appSecret);
    this.appToken = ensureText(appToken);
    this.apiBaseUrl = ensureText(apiBaseUrl).replace(/\/+$/, '') || DEFAULT_API_BASE_URL;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.requestTimeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
    this.cachedTenantToken = '';
    this.cachedTenantTokenExpiresAt = 0;
  }

  assertAuthConfig() {
    const missing = [];
    if (!this.appId) missing.push('app_id');
    if (!this.appSecret) missing.push('app_secret');
    if (!this.fetchImpl) missing.push('fetch');
    if (missing.length) throw new Error(`Missing Feishu API config: ${missing.join(', ')}`);
  }

  async tenantAccessToken() {
    this.assertAuthConfig();
    if (this.cachedTenantToken && this.cachedTenantTokenExpiresAt - 60_000 > this.now()) {
      return this.cachedTenantToken;
    }
    const data = await this.requestRaw('/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      body: {
        app_id: this.appId,
        app_secret: this.appSecret,
      },
      auth: false,
    });
    const token = ensureText(data.tenant_access_token || data.data?.tenant_access_token);
    if (!token) throw new Error('Feishu tenant_access_token response did not contain tenant_access_token.');
    const expireSeconds = Number(data.expire || data.data?.expire || 7200);
    this.cachedTenantToken = token;
    this.cachedTenantTokenExpiresAt = this.now() + Math.max(60, expireSeconds) * 1000;
    return token;
  }

  async requestRaw(path, {
    method = 'GET',
    query = {},
    body = undefined,
    auth = true,
    headers: extraHeaders = {},
  } = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (auth) headers.Authorization = `Bearer ${await this.tenantAccessToken()}`;
    let response;
    try {
      response = await this.fetchImpl(appendQuery(`${this.apiBaseUrl}${path}`, query), {
        method,
        headers,
        body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new Error(`Feishu API ${method} ${path} timeout after ${this.requestTimeoutMs}ms`);
      }
      throw error;
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok || Number(data.code || 0) !== 0) {
      const message = data.msg || data.message || text || response.statusText;
      throw new Error(`Feishu API ${method} ${path} failed: ${message}`);
    }
    return data;
  }

  async request(path, options = {}) {
    const data = await this.requestRaw(path, options);
    return data.data ?? data;
  }

  async requestForm(path, formData, options = {}) {
    const data = await this.requestRaw(path, {
      ...options,
      method: options.method || 'POST',
      body: formData,
    });
    return data.data ?? data;
  }

  appPath(suffix = '') {
    if (!this.appToken) throw new Error('Missing Feishu app_token. Set HARVEST_FEISHU_APP_TOKEN or sinks.feishu.app_token.');
    return `/bitable/v1/apps/${encodeURIComponent(this.appToken)}${suffix}`;
  }

  async createBase(name, { folderToken = '' } = {}) {
    const body = { name };
    if (folderToken) body.folder_token = folderToken;
    const data = await this.request('/base/v3/bases', { method: 'POST', body });
    const app = data.base || data.app || data;
    const appToken = ensureText(app.app_token || app.base_token || app.token || data.app_token || data.base_token);
    if (!appToken) throw new Error('Feishu create Base response did not contain app_token.');
    this.appToken = appToken;
    return {
      ...app,
      app_token: appToken,
      url: ensureText(app.url || data.url),
      created: true,
    };
  }

  async listTables() {
    const tables = [];
    let pageToken = '';
    do {
      const data = await this.request(this.appPath('/tables'), {
        query: {
          page_size: 100,
          page_token: pageToken,
        },
      });
      const items = jsonArray(data.items);
      tables.push(...items);
      pageToken = ensureText(data.page_token);
      if (!data.has_more) break;
    } while (pageToken);
    return tables;
  }

  async createTable(name) {
    const data = await this.request(this.appPath('/tables'), {
      method: 'POST',
      body: {
        table: { name },
      },
    });
    return data.table || data;
  }

  async ensureTable(name) {
    const existing = (await this.listTables()).find((item) => tableName(item) === name);
    if (existing) return { table: existing, tableId: tableId(existing), created: false };
    const created = await this.createTable(name);
    return { table: created, tableId: tableId(created), created: true };
  }

  async listFields(table) {
    const fields = [];
    let pageToken = '';
    do {
      const data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/fields`), {
        query: {
          page_size: 200,
          page_token: pageToken,
        },
      });
      const items = jsonArray(data.items);
      fields.push(...items);
      pageToken = ensureText(data.page_token);
      if (!data.has_more) break;
    } while (pageToken);
    return fields;
  }

  async createField(table, spec) {
    if (usesBaseV3FieldApi(spec)) {
      return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/fields`, {
        method: 'POST',
        body: baseV3FieldSpec(spec),
      });
    }
    return this.request(this.appPath(`/tables/${encodeURIComponent(table)}/fields`), {
      method: 'POST',
      body: bitableFieldSpec(spec),
    });
  }

  async updateField(table, field, spec) {
    if (usesBaseV3FieldApi(spec)) {
      return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/fields/${encodeURIComponent(field)}`, {
        method: 'PUT',
        body: baseV3FieldSpec(spec),
      });
    }
    return this.request(this.appPath(`/tables/${encodeURIComponent(table)}/fields/${encodeURIComponent(field)}`), {
      method: 'PUT',
      body: bitableFieldSpec(spec),
    });
  }

  async deleteField(table, field) {
    try {
      await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/fields/${encodeURIComponent(field)}`), {
        method: 'DELETE',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NotFound')) return;
      await this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/fields/${encodeURIComponent(field)}`, {
        method: 'DELETE',
      });
    }
  }

  async ensureFields(table, fieldSpecs) {
    const fields = await this.listFields(table);
    const existing = new Set(fields.map(fieldName).filter(Boolean));
    const created = [];
    let updatedPrimaryField = '';
    const [firstSpec] = fieldSpecs;
    const firstField = fields[0];
    const firstFieldId = fieldId(firstField);

    if (firstSpec && !existing.has(firstSpec.name) && firstFieldId && isDefaultPrimaryField(firstField, 0)) {
      await this.updateField(table, firstFieldId, firstSpec);
      existing.delete(fieldName(firstField));
      existing.add(firstSpec.name);
      updatedPrimaryField = firstSpec.name;
    }

    for (const spec of fieldSpecs) {
      if (existing.has(spec.name)) continue;
      await this.createField(table, spec);
      existing.add(spec.name);
      created.push(spec.name);
    }
    return { existing: [...existing], created, updated_primary_field: updatedPrimaryField };
  }

  async listViews(table) {
    const views = [];
    let pageToken = '';
    do {
      const data = await this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/views`, {
        query: {
          page_size: 100,
          page_token: pageToken,
        },
      });
      const items = [...jsonArray(data.items), ...jsonArray(data.views)];
      views.push(...items);
      pageToken = ensureText(data.page_token);
      if (!data.has_more) break;
    } while (pageToken);
    return views;
  }

  async createView(table, spec = {}) {
    const name = ensureText(spec.name);
    if (!name) throw new Error('Feishu view spec requires name.');
    return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/views`, {
      method: 'POST',
      body: {
        name,
        type: ensureText(spec.type) || 'grid',
      },
    });
  }

  async ensureView(table, spec = {}) {
    const name = ensureText(spec.name);
    const existing = (await this.listViews(table)).find((item) => viewName(item) === name);
    if (existing) return { view: existing, viewId: viewId(existing), created: false };
    const created = await this.createView(table, spec);
    const view = created.view || created;
    return { view, viewId: viewId(view), created: true };
  }

  async setViewVisibleFields(table, view, visibleFields = []) {
    return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/views/${encodeURIComponent(view)}/visible_fields`, {
      method: 'PUT',
      body: { visible_fields: visibleFields },
    });
  }

  async setViewGroup(table, view, groupConfig = []) {
    return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/views/${encodeURIComponent(view)}/group`, {
      method: 'PUT',
      body: { group_config: groupConfig },
    });
  }

  async setViewSort(table, view, sortConfig = []) {
    return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/views/${encodeURIComponent(view)}/sort`, {
      method: 'PUT',
      body: { sort_config: sortConfig },
    });
  }

  async setViewCard(table, view, card = {}) {
    return this.request(`/base/v3/bases/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(table)}/views/${encodeURIComponent(view)}/card`, {
      method: 'PUT',
      body: card,
    });
  }

  async ensureViews(table, viewSpecs = []) {
    const created = [];
    const configured = [];
    const warnings = [];
    for (const spec of viewSpecs) {
      const name = ensureText(spec.name);
      if (!name) continue;
      try {
        const view = await this.ensureView(table, spec);
        if (view.created) created.push(name);
        const id = view.viewId;
        let ok = true;
        const steps = [
          ['group', spec.group_config, () => this.setViewGroup(table, id, spec.group_config)],
          ['sort', spec.sort_config, () => this.setViewSort(table, id, spec.sort_config)],
          ['card', spec.card, () => this.setViewCard(table, id, spec.card)],
          ['visible_fields', spec.visible_fields, () => this.setViewVisibleFields(table, id, spec.visible_fields)],
        ];
        for (const [step, value, run] of steps) {
          if (!value) continue;
          try {
            await run();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('no operation produced')) continue;
            ok = false;
            warnings.push(`${name}.${step}: ${message}`);
          }
        }
        if (ok) configured.push(name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${name}: ${message}`);
      }
    }
    return { created, configured, warnings };
  }

  async listSourceKeyRecords(table, sourceKeyField = 'source_key') {
    const records = new Map();
    let pageToken = '';
    do {
      const data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records`), {
        query: {
          page_size: 500,
          page_token: pageToken,
          field_names: JSON.stringify([sourceKeyField]),
        },
      });
      for (const item of jsonArray(data.items)) {
        const id = recordId(item);
        const key = cellText(fieldMap(item)[sourceKeyField]);
        if (id && key) records.set(key, id);
      }
      pageToken = ensureText(data.page_token);
      if (!data.has_more) break;
    } while (pageToken);
    return records;
  }

  async listRecordsBySourceKey(table, {
    sourceKeyField = 'source_key',
    fieldNames = [],
    fullFields = false,
  } = {}) {
    const records = new Map();
      const projectedFields = [...new Set([sourceKeyField, ...fieldNames.map((name) => ensureText(name)).filter(Boolean)])];
    let pageToken = '';
    do {
      let data;
      try {
        data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records`), {
          query: {
            page_size: 500,
            page_token: pageToken,
            ...(fullFields ? {} : { field_names: JSON.stringify(projectedFields) }),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (fullFields || !message.includes('FieldNameNotFound') || projectedFields.length <= 1) throw error;
        data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records`), {
          query: {
            page_size: 500,
            page_token: pageToken,
            field_names: JSON.stringify([sourceKeyField]),
          },
        });
      }
      for (const item of jsonArray(data.items)) {
        const id = recordId(item);
        const fields = fieldMap(item);
        const key = cellText(fields[sourceKeyField]);
        if (id && key) records.set(key, { id, fields });
      }
      pageToken = ensureText(data.page_token);
      if (!data.has_more) break;
    } while (pageToken);
    return records;
  }

  async listRecordsMissingSourceKey(table, sourceKeyField = 'source_key') {
    const records = [];
    let pageToken = '';
    do {
      const data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records`), {
        query: {
          page_size: 500,
          page_token: pageToken,
          field_names: JSON.stringify([sourceKeyField]),
        },
      });
      for (const item of jsonArray(data.items)) {
        const id = recordId(item);
        const key = cellText(fieldMap(item)[sourceKeyField]);
        if (id && !key) records.push(id);
      }
      pageToken = ensureText(data.page_token);
      if (!data.has_more) break;
    } while (pageToken);
    return records;
  }

  async createRecords(table, rows, { batchSize = 500 } = {}) {
    const createdRecordIds = [];
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      if (!batch.length) continue;
      const data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records/batch_create`), {
        method: 'POST',
        body: {
          records: batch.map((fields) => ({ fields })),
        },
      });
      createdRecordIds.push(...jsonArray(data.records).map(recordId).filter(Boolean));
    }
    return createdRecordIds;
  }

  async updateRecords(table, updates, { batchSize = 500 } = {}) {
    const updatedRecordIds = [];
    for (let index = 0; index < updates.length; index += batchSize) {
      const batch = updates.slice(index, index + batchSize);
      if (!batch.length) continue;
      const data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records/batch_update`), {
        method: 'POST',
        body: {
          records: batch.map((item) => ({
            record_id: item.id,
            fields: item.row,
          })),
        },
      });
      const ids = jsonArray(data.records).map(recordId).filter(Boolean);
      updatedRecordIds.push(...(ids.length ? ids : batch.map((item) => item.id)));
    }
    return updatedRecordIds;
  }

  async updateRecordFields(table, record, fields) {
    const data = await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records/${encodeURIComponent(record)}`), {
      method: 'PUT',
      body: { fields },
    });
    return data.record || data;
  }

  async uploadMediaAll(filePath, {
    fileName = '',
    parentType = 'bitable_file',
    parentNode = this.appToken,
  } = {}) {
    const name = ensureText(fileName);
    if (!name) throw new Error('Feishu media upload requires fileName.');
    const bytes = await import('node:fs/promises').then((fs) => fs.readFile(filePath));
    if (bytes.length > DRIVE_MEDIA_SINGLE_PART_LIMIT_BYTES) {
      return this.uploadMediaMultipartBytes(bytes, {
        fileName: name,
        parentType,
        parentNode,
      });
    }
    const form = new FormData();
    form.set('file_name', name);
    form.set('parent_type', parentType);
    form.set('parent_node', parentNode);
    form.set('size', String(bytes.length));
    form.set('file', new Blob([bytes]), name);
    const data = await this.requestForm('/drive/v1/medias/upload_all', form);
    const fileToken = ensureText(data.file_token || data.file?.file_token || data.token);
    if (!fileToken) throw new Error('Feishu media upload response did not contain file_token.');
    return fileToken;
  }

  async uploadMediaMultipartBytes(bytes, {
    fileName = '',
    parentType = 'bitable_file',
    parentNode = this.appToken,
  } = {}) {
    const name = ensureText(fileName);
    const prepare = await this.request('/drive/v1/medias/upload_prepare', {
      method: 'POST',
      body: {
        file_name: name,
        parent_type: parentType,
        parent_node: parentNode,
        size: bytes.length,
      },
    });
    const uploadId = ensureText(prepare.upload_id);
    const blockSize = Number(prepare.block_size) || 4 * 1024 * 1024;
    const blockNum = Number(prepare.block_num) || Math.ceil(bytes.length / blockSize);
    if (!uploadId) throw new Error('Feishu media upload_prepare response did not contain upload_id.');

    for (let seq = 0; seq < blockNum; seq += 1) {
      const start = seq * blockSize;
      const chunk = bytes.subarray(start, Math.min(start + blockSize, bytes.length));
      const form = new FormData();
      form.set('upload_id', uploadId);
      form.set('seq', String(seq));
      form.set('size', String(chunk.length));
      form.set('file', new Blob([chunk]), name);
      await this.requestForm('/drive/v1/medias/upload_part', form);
    }

    const finish = await this.request('/drive/v1/medias/upload_finish', {
      method: 'POST',
      body: {
        upload_id: uploadId,
        block_num: blockNum,
      },
    });
    const fileToken = ensureText(finish.file_token || finish.file?.file_token || finish.token);
    if (!fileToken) throw new Error('Feishu media upload_finish response did not contain file_token.');
    return fileToken;
  }

  async deleteRecords(table, recordIds, { batchSize = 500 } = {}) {
    const deletedRecordIds = [];
    for (let index = 0; index < recordIds.length; index += batchSize) {
      const batch = recordIds.slice(index, index + batchSize);
      if (!batch.length) continue;
      await this.request(this.appPath(`/tables/${encodeURIComponent(table)}/records/batch_delete`), {
        method: 'POST',
        body: {
          records: batch,
        },
      });
      deletedRecordIds.push(...batch);
    }
    return deletedRecordIds;
  }

  async upsertRows(table, rows, { sourceKeyField = 'source_key' } = {}) {
    const existingBySourceKey = await this.listSourceKeyRecords(table, sourceKeyField);
    const creates = [];
    const updates = [];
    for (const row of rows) {
      const key = ensureText(row[sourceKeyField]);
      const id = existingBySourceKey.get(key);
      if (id) updates.push({ id, row });
      else creates.push(row);
    }

    const [createdRecordIds, updatedRecordIds] = await Promise.all([
      this.createRecords(table, creates),
      this.updateRecords(table, updates),
    ]);

    return {
      create_rows: creates.length,
      update_rows: updates.length,
      created_record_ids: createdRecordIds,
      updated_record_ids: updatedRecordIds,
    };
  }
}
