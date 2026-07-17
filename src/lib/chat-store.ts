import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

export interface ChatTimelineItem {
  label: string;
  status: 'done' | 'in_progress' | 'blocked' | 'waiting';
  detail?: string;
}

export interface ChatMessageMeta {
  workflow?: {
    workflowId: string;
    shareableUrl: string;
    action: string;
    apis: string[];
  };
  plan?: {
    steps: number;
    blockedReasons: string[];
  };
  timeline?: ChatTimelineItem[];
}

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta: ChatMessageMeta;
  createdAt: string;
}

export async function getOrCreateThread(userId: string): Promise<string> {
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('chat_threads')
    .select('id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    throw new Error(`Failed to load chat thread: ${existingErr.message}`);
  }
  if (existing?.id) return existing.id;

  const threadId = `thread_${crypto.randomUUID()}`;
  const { error } = await supabaseAdmin.from('chat_threads').insert([
    {
      id: threadId,
      user_id: userId,
      title: 'Main chat',
    },
  ]);
  if (error) throw new Error(`Failed to create chat thread: ${error.message}`);
  return threadId;
}

export async function appendMessage(input: {
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: ChatMessageMeta;
}): Promise<string> {
  const messageId = `msg_${crypto.randomUUID()}`;
  const { error } = await supabaseAdmin.from('chat_messages').insert([
    {
      id: messageId,
      thread_id: input.threadId,
      role: input.role,
      content: input.content,
      message_meta: (input.meta ?? {}) as Record<string, unknown>,
    },
  ]);
  if (error) throw new Error(`Failed to append chat message: ${error.message}`);

  await supabaseAdmin
    .from('chat_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.threadId);

  return messageId;
}

export async function listMessages(
  threadId: string,
  limit = 100
): Promise<StoredChatMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, role, content, message_meta, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to list chat messages: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    meta: (row.message_meta ?? {}) as ChatMessageMeta,
    createdAt: row.created_at,
  }));
}
