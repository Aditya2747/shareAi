export interface ApiActionContext {
  userId: string;
}

export interface ApiActionRequest {
  action: string;
  args: Record<string, unknown>;
  requiredPermissions: string[];
}

export interface ApiActionValidation {
  ok: boolean;
  reason?: string;
}

export interface ApiActionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface ApiActionPlugin {
  id: string;
  supports(action: string): boolean;
  validate(input: ApiActionRequest, context: ApiActionContext): Promise<ApiActionValidation>;
  execute(input: ApiActionRequest, context: ApiActionContext): Promise<ApiActionResult>;
}
