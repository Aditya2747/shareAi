import crypto from 'crypto';
import { encryptToken } from './encryption';
import { supabaseAdmin } from './supabase';
import { Intent, WorkflowURL } from '@/types';

interface WorkflowPayload {
  intentId: string;
  action: string;
  targetAPIs: string[];
  requiredScopes: Record<string, string[]>;
  parameters: Record<string, unknown>;
  createdAt: string;
}

export async function generateWorkflowURL(
  intent: Intent,
  userId: string
): Promise<WorkflowURL> {
  const payload: WorkflowPayload = {
    intentId: intent.id,
    action: intent.action,
    targetAPIs: intent.targetAPIs,
    requiredScopes: intent.requiredScopes,
    parameters: intent.parameters,
    createdAt: new Date().toISOString(),
  };

  const payloadJson = JSON.stringify(payload);
  const encryptedPayload = encryptToken(payloadJson);
  const workflowId = `wf_${crypto.randomBytes(12).toString('hex')}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const shareableUrl = `${appUrl}/execute/${workflowId}`;

  const { data, error } = await supabaseAdmin
    .from('workflows')
    .insert([
      {
        id: workflowId,
        created_by: userId,
        intent_id: intent.id,
        encrypted_payload: encryptedPayload,
        shareable_url: shareableUrl,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create workflow: ${error.message}`);
  }

  return {
    id: data.id,
    createdBy: data.created_by,
    intentId: data.intent_id,
    encryptedPayload: data.encrypted_payload,
    shareableUrl: data.shareable_url,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    executedBy: data.executed_by,
    executedAt: data.executed_at ? new Date(data.executed_at) : null,
    status: data.status,
    createdAt: new Date(data.created_at),
  };
}
