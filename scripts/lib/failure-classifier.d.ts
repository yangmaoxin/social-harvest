export type TaskFailureCategory =
  | 'chrome_unreachable'
  | 'opencli_unavailable'
  | 'platform_not_logged_in'
  | 'platform_access_unavailable'
  | 'account_missing'
  | 'database_unavailable'
  | 'ai_unavailable'
  | 'report_missing'
  | 'report_damaged'
  | 'unknown';

export type TaskFailureClassification = {
  category: TaskFailureCategory;
  title: string;
  description: string;
  nextActions: string[];
  recoverable: boolean;
};

export function classifyTaskFailure(input?: {
  error?: string;
  stderr?: string;
  platformReport?: unknown;
}): TaskFailureClassification | null;
