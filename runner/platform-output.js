import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function summarizeWeixinReport(report, reportFile) {
  if (!report) return null;
  const danmakuStatus = report.danmaku?.status || '';
  const danmakuRows = Number(report.danmaku?.danmaku_rows
    ?? report.danmaku?.exported_rows
    ?? 0);
  return {
    report_file: reportFile,
    status: report.status || '',
    harvest_status: report.harvest_status || '',
    work_rows: Number(report.counts?.work_rows ?? report.works?.length ?? 0),
    comment_rows: Number(report.counts?.comment_rows ?? 0),
    private_messages_status: report.private_messages?.status || '',
    private_messages_rows: Number(report.private_messages?.message_rows ?? report.private_messages?.exported_rows ?? 0),
    danmaku_status: danmakuStatus,
    danmaku_rows: danmakuRows,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

function summarizeWeixinPrivateMessagesReport(report, reportFile) {
  if (!report) return null;
  return {
    report_file: reportFile,
    status: report.status || '',
    harvest_status: '',
    work_rows: 0,
    comment_rows: 0,
    private_messages_status: report.status || '',
    private_messages_rows: Number(report.exported_rows ?? report.message_rows ?? 0),
    danmaku_status: '',
    danmaku_rows: 0,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

function summarizeWeixinDanmakuReport(report, reportFile) {
  if (!report) return null;
  const danmakuRows = Number(report.danmaku_rows ?? report.exported_rows ?? 0);
  return {
    report_file: reportFile,
    danmaku_report_file: reportFile,
    status: report.status || '',
    harvest_status: '',
    work_rows: 0,
    comment_rows: 0,
    private_messages_status: '',
    private_messages_rows: 0,
    danmaku_status: report.status || '',
    danmaku_rows: danmakuRows,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

function summarizeWeixinOutput(outputDir) {
  const reportFile = path.join(outputDir, 'run-report.json');
  const runReport = summarizeWeixinReport(readJsonIfExists(reportFile), reportFile);
  if (runReport) return runReport;
  const privateMessagesFile = path.join(outputDir, 'private-messages-report.json');
  const privateMessagesReport = summarizeWeixinPrivateMessagesReport(readJsonIfExists(privateMessagesFile), privateMessagesFile);
  if (privateMessagesReport) return privateMessagesReport;
  const danmakuFile = path.join(outputDir, 'danmaku-report.json');
  const danmakuReport = summarizeWeixinDanmakuReport(readJsonIfExists(danmakuFile), danmakuFile);
  if (danmakuReport) return danmakuReport;
  return null;
}

function summarizeDouyinReports(outputDir) {
  const indexFile = path.join(outputDir, 'index.json');
  const indexRows = readJsonIfExists(indexFile);
  const accountRows = Array.isArray(indexRows) ? indexRows : [];
  const accountReports = accountRows
    .map((row) => row?.report_file)
    .filter(Boolean)
    .map((reportFile) => readJsonIfExists(reportFile))
    .filter(Boolean);
  const privateMessagesFile = path.join(outputDir, 'private-messages-report.json');
  const privateMessagesReport = readJsonIfExists(privateMessagesFile);
  const hasPrivateMessagesReport = Boolean(privateMessagesReport);
  const creatorHarvestFile = path.join(outputDir, 'creator-harvest-report.json');
  const creatorHarvestReport = readJsonIfExists(creatorHarvestFile);
  const hasCreatorHarvestReport = Boolean(creatorHarvestReport);
  const failedAccount = accountRows.some((row) => row?.status === 'failed');
  const dataSources = [
    ...accountRows.map((row) => row?.data_source),
    ...accountReports.map((report) => report?.data_source),
    privateMessagesReport?.data_source,
    creatorHarvestReport?.data_source,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const uniqueDataSources = [...new Set(dataSources)];
  return {
    summary_file: fs.existsSync(indexFile) ? indexFile : '',
    report_file: fs.existsSync(creatorHarvestFile) ? creatorHarvestFile : '',
    status: failedAccount || creatorHarvestReport?.status === 'partial' ? 'partial' : (accountRows.length || hasPrivateMessagesReport || hasCreatorHarvestReport ? 'success' : ''),
    data_source: uniqueDataSources.length === 1 ? uniqueDataSources[0] : (uniqueDataSources.length > 1 ? 'mixed' : ''),
    data_sources: uniqueDataSources,
    account_count: accountRows.length,
    work_rows: accountRows.reduce((sum, row) => sum + Number(row?.work_rows || 0), 0) + Number(creatorHarvestReport?.counts?.work_rows || 0),
    comment_rows: accountReports.reduce((sum, report) => sum + Number(report?.counts?.comment_rows || 0), 0) + Number(creatorHarvestReport?.counts?.comment_rows || 0),
    creator_harvest_report_file: fs.existsSync(creatorHarvestFile) ? creatorHarvestFile : '',
    creator_harvest_status: creatorHarvestReport?.status || '',
    creator_harvest_work_rows: Number(creatorHarvestReport?.counts?.work_rows || 0),
    creator_harvest_comment_rows: Number(creatorHarvestReport?.counts?.comment_rows || 0),
    creator_harvest_danmaku_rows: Number(creatorHarvestReport?.counts?.danmaku_rows || 0),
    creator_harvest_top_level_comment_rows: Number(creatorHarvestReport?.counts?.top_level_comment_rows || 0),
    creator_harvest_reply_comment_rows: Number(creatorHarvestReport?.counts?.reply_comment_rows || 0),
    creator_harvest_reply_fetch_status_counts: creatorHarvestReport?.counts?.reply_fetch_status_counts || {},
    imported: accountRows.some((row) => Boolean(row?.imported)),
    private_messages_report_file: fs.existsSync(privateMessagesFile) ? privateMessagesFile : '',
    private_messages_status: privateMessagesReport?.status || '',
    private_messages_rows: Number(privateMessagesReport?.exported_rows || privateMessagesReport?.message_rows || 0),
    warnings: [
      ...accountReports.flatMap((report) => Array.isArray(report?.warnings) ? report.warnings : []),
      ...(Array.isArray(privateMessagesReport?.warnings) ? privateMessagesReport.warnings : []),
      ...(Array.isArray(creatorHarvestReport?.warnings) ? creatorHarvestReport.warnings : []),
    ],
  };
}

function summarizeDoctorOutput(stdout, outputDir, reportFileName = 'doctor-report.json') {
  const reportPath = path.join(outputDir, reportFileName);
  const parsed = readJsonFromText(stdout);
  if (parsed) {
    writeJson(reportPath, parsed);
    const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
    const issues = [
      ...(Array.isArray(parsed.issues) ? parsed.issues : []),
      ...checks.flatMap((check) => Array.isArray(check?.issues) ? check.issues : []),
      ...checks
        .filter((check) => check?.status === 'skipped')
        .map((check) => `${check.name || 'check'} skipped: ${check.reason || 'no reason provided'}`),
    ].map((issue) => String(issue || '').trim()).filter(Boolean);
    return {
      report_file: reportPath,
      status: parsed.status || '',
      checks: checks.length,
      failed_checks: checks.filter((check) => check?.status === 'failed').length,
      warning_checks: checks.filter((check) => check?.status === 'warning').length,
      issues,
    };
  }
  return {
    report_file: '',
    status: '',
    checks: 0,
    failed_checks: 0,
    warning_checks: 0,
    issues: [],
  };
}

function readJsonFromText(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function lastTaggedJsonFromText(text, prefix) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith(prefix)) continue;
    try {
      return JSON.parse(line.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

function taggedJsonValuesFromText(text, prefix) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => {
      try {
        return JSON.parse(line.slice(prefix.length));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeDouyinMainTableFileImport(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'IMPORT_SUMMARY ');
  if (!summary || summary.merge_scope !== 'scrm_file_only') return null;
  const verification = lastTaggedJsonFromText(stdout, 'IMPORT_VERIFICATION ');
  return {
    status: summary.status || 'success',
    work_rows: Number(verification?.verification?.matched_current_payload_rows?.works ?? summary.counts?.write_attempt_work_rows ?? 0),
    comment_rows: 0,
    danmaku_rows: 0,
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
  };
}

function summarizeDouyinContentImport(stdout = '') {
  const summaries = taggedJsonValuesFromText(stdout, 'IMPORT_SUMMARY ');
  const fileSummary = summaries.find((summary) => summary.merge_scope === 'scrm_file_only');
  const commentSummary = summaries.find((summary) => summary.merge_scope === 'scrm_comment_only');
  if (fileSummary || commentSummary) {
    const fileReport = fileSummary ? summarizeDouyinMainTableFileImport(`IMPORT_SUMMARY ${JSON.stringify(fileSummary)}`) : null;
    const commentReport = commentSummary ? summarizeDouyinMainTableCommentImport(`IMPORT_SUMMARY ${JSON.stringify(commentSummary)}`) : null;
    return {
      status: [fileReport?.status, commentReport?.status].filter(Boolean).find((status) => status !== 'ready') || 'success',
      work_rows: Number(fileReport?.work_rows || 0),
      comment_rows: Number(commentReport?.comment_rows || 0),
      danmaku_rows: 0,
      supplement_public_ip_enabled: Boolean(commentReport?.supplement_public_ip_enabled),
      comment_ip_filled_rows: Number(commentReport?.comment_ip_filled_rows || 0),
      comment_ip_missing_rows: Number(commentReport?.comment_ip_missing_rows || 0),
      semantic_overlapping_comment_candidates: Number(commentReport?.semantic_overlapping_comment_candidates || 0),
      semantic_creator_only_comment_candidates: Number(commentReport?.semantic_creator_only_comment_candidates || 0),
      warnings: [
        ...(Array.isArray(fileReport?.warnings) ? fileReport.warnings : []),
        ...(Array.isArray(commentReport?.warnings) ? commentReport.warnings : []),
      ],
    };
  }

  const verification = lastTaggedJsonFromText(stdout, 'IMPORT_VERIFICATION ');
  if (!verification) return null;
  return {
    status: 'success',
    work_rows: Number(verification?.verification?.matched_current_payload_rows?.works ?? verification?.verification?.payload_rows?.works ?? 0),
    comment_rows: Number(verification?.verification?.matched_current_payload_rows?.comments ?? verification?.verification?.payload_rows?.comments ?? 0),
    danmaku_rows: 0,
    warnings: [],
  };
}

function summarizeScrmContentImport(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'IMPORT_SUMMARY ');
  const verification = lastTaggedJsonFromText(stdout, 'IMPORT_VERIFICATION ');
  if (!summary && !verification) return null;
  const verifiedRows = verification?.verification?.matched_current_payload_rows || {};
  const writeAttemptRows = verification?.verification?.write_attempt_rows || {};
  const payloadRows = verification?.verification?.payload_rows || {};
  return {
    status: 'success',
    work_rows: Number(
      verifiedRows.works
      ?? writeAttemptRows.works
      ?? payloadRows.works
      ?? summary?.work_rows
      ?? 0
    ),
    comment_rows: Number(
      verifiedRows.comments
      ?? writeAttemptRows.comments
      ?? payloadRows.comments
      ?? summary?.comment_rows
      ?? 0
    ),
    danmaku_rows: 0,
    warnings: Array.isArray(summary?.warnings) ? summary.warnings : [],
  };
}

function summarizeDouyinMainTableCommentImport(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'IMPORT_SUMMARY ');
  if (!summary || summary.merge_scope !== 'scrm_comment_only') return null;
  const verification = lastTaggedJsonFromText(stdout, 'IMPORT_VERIFICATION ');
  const commentRows = Number(verification?.verification?.matched_current_payload_rows?.comments ?? summary.counts?.merged_comment_candidates ?? 0);
  const missingIpRows = Number(summary.identity_health?.merged?.missing_ip_location ?? 0);
  return {
    status: summary.status || 'success',
    work_rows: 0,
    comment_rows: commentRows,
    danmaku_rows: 0,
    supplement_public_ip_enabled: Boolean(summary.options?.supplement_public_ip),
    comment_ip_filled_rows: Math.max(commentRows - missingIpRows, 0),
    comment_ip_missing_rows: missingIpRows,
    semantic_overlapping_comment_candidates: Number(summary.counts?.semantic_overlapping_comment_candidates ?? 0),
    semantic_creator_only_comment_candidates: Number(summary.counts?.semantic_creator_only_comment_candidates ?? 0),
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
  };
}

function summarizeDouyinDanmakuImport(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'IMPORT_SUMMARY ');
  if (!summary || !Object.prototype.hasOwnProperty.call(summary, 'danmaku_rows')) return null;
  const verification = lastTaggedJsonFromText(stdout, 'IMPORT_VERIFICATION ');
  return {
    status: 'success',
    work_rows: 0,
    comment_rows: 0,
    danmaku_rows: Number(verification?.matched_rows ?? summary.write_attempt_rows ?? summary.danmaku_rows ?? 0),
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
  };
}

function summarizeAccountHarvestOutput(outputDir = '') {
  const reportFile = path.join(outputDir, 'account-profile-report.json');
  const report = readJsonIfExists(reportFile);
  if (!report) return null;
  return {
    report_file: reportFile,
    status: report.status || '',
    account_count: Number(report.count || 0),
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

function summarizeAccountImport(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'IMPORT_SUMMARY ');
  if (!summary || !Object.prototype.hasOwnProperty.call(summary, 'account_rows')) return null;
  const verification = lastTaggedJsonFromText(stdout, 'IMPORT_VERIFICATION ');
  return {
    status: 'success',
    account_count: Number(
      verification?.verification?.matched_current_payload_rows
      ?? summary.write_attempt_rows
      ?? summary.account_rows
      ?? 0
    ),
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
  };
}

function summarizeMetricSnapshotWrite(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'METRIC_SNAPSHOT_APPLIED ')
    || lastTaggedJsonFromText(stdout, 'METRIC_SNAPSHOT_SUMMARY ');
  if (!summary) return null;
  return {
    status: 'success',
    metric_snapshot_rows: Number(summary.write_attempt_rows ?? summary.snapshot_rows ?? 0),
    metric_delta_rows: 0,
    warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
  };
}

function summarizeMetricDeltaGenerate(stdout = '') {
  const summary = lastTaggedJsonFromText(stdout, 'METRIC_DELTA_APPLIED ')
    || lastTaggedJsonFromText(stdout, 'METRIC_DELTA_SUMMARY ');
  if (!summary) return null;
  return {
    status: 'success',
    metric_snapshot_rows: Number(summary.snapshot_rows ?? 0),
    metric_delta_rows: Number(summary.inserted_rows ?? summary.generated_rows ?? summary.event_rows ?? 0),
    metric_delta_generated_rows: Number(summary.generated_rows ?? summary.event_rows ?? 0),
    metric_delta_duplicate_rows: Number(summary.duplicate_rows ?? 0),
    warnings: [],
  };
}

export function summarizePlatformOutput(platformId, outputDir) {
  if (platformId === 'weixin-channels') {
    return summarizeWeixinOutput(outputDir);
  }
  if (platformId === 'douyin') {
    return summarizeDouyinReports(outputDir);
  }
  return null;
}

export function summarizeTaskOutput({ platformId = '', taskId = '', outputDir = '', stdout = '', task = null } = {}) {
  if (!platformId && taskId === 'diagnostic') {
    return summarizeDoctorOutput(stdout, outputDir, task?.reportFileName);
  }
  if (taskId === 'creator-account') {
    return summarizeAccountHarvestOutput(outputDir);
  }
  if (platformId === 'weixin-channels' && taskId === 'content-import') {
    return summarizeScrmContentImport(stdout) || summarizePlatformOutput(platformId, outputDir);
  }
  if (platformId === 'douyin' && taskId === 'content-import') {
    return summarizeDouyinContentImport(stdout);
  }
  if (taskId === 'account-import') {
    return summarizeAccountImport(stdout);
  }
  if (taskId === 'metric-snapshot-account' || taskId === 'metric-snapshot-work') {
    return summarizeMetricSnapshotWrite(stdout);
  }
  if (taskId === 'metric-delta-account' || taskId === 'metric-delta-work') {
    return summarizeMetricDeltaGenerate(stdout);
  }
  if (platformId === 'douyin' && taskId === 'danmaku-import') {
    return summarizeDouyinDanmakuImport(stdout);
  }
  if (platformId) return summarizePlatformOutput(platformId, outputDir);
  return null;
}
