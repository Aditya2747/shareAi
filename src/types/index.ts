export interface Intent {
  id: string;
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
  parameters: Record<string, unknown>;
  confidence: number;
}

export interface WorkflowURL {
  id: string;
  createdBy: string;
  intentId: string;
  encryptedPayload: string;
  shareableUrl: string;
  expiresAt: Date | null;
  executedBy: string | null;
  executedAt: Date | null;
  status: 'pending' | 'executing' | 'success' | 'failed';
  createdAt: Date;
}

export interface OAuthToken {
  provider: string;
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionLog {
  id: string;
  workflowId: string;
  userId: string;
  status: 'pending' | 'success' | 'failed';
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
}
