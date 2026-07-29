import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { encryptToken, decryptToken } from '@/lib/encryption';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

export type ChatAttachmentMeta = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export function isAllowedAttachmentMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime.toLowerCase());
}

export async function createChatAttachment(input: {
  userId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<ChatAttachmentMeta> {
  if (!isAllowedAttachmentMime(input.mimeType)) {
    throw new Error(`Unsupported file type: ${input.mimeType}`);
  }
  if (input.bytes.length === 0 || input.bytes.length > MAX_BYTES) {
    throw new Error('Attachment must be between 1 byte and 5MB');
  }

  const id = `att_${crypto.randomUUID()}`;
  const encrypted = encryptToken(input.bytes.toString('base64'));
  const { error } = await supabaseAdmin.from('chat_attachments').insert([
    {
      id,
      user_id: input.userId,
      message_id: null,
      filename: input.filename.slice(0, 200),
      mime_type: input.mimeType,
      size_bytes: input.bytes.length,
      encrypted_content: encrypted,
    },
  ]);
  if (error) throw new Error(`Failed to store attachment: ${error.message}`);

  return {
    id,
    filename: input.filename.slice(0, 200),
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    url: `/api/chat/attachments/${id}`,
  };
}

export async function linkAttachmentsToMessage(
  userId: string,
  messageId: string,
  attachmentIds: string[]
): Promise<ChatAttachmentMeta[]> {
  if (attachmentIds.length === 0) return [];
  const unique = Array.from(new Set(attachmentIds)).slice(0, 5);

  const { data, error } = await supabaseAdmin
    .from('chat_attachments')
    .select('id, filename, mime_type, size_bytes, user_id, message_id')
    .in('id', unique)
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to load attachments: ${error.message}`);

  const rows = data ?? [];
  if (rows.length !== unique.length) {
    throw new Error('One or more attachments were not found');
  }
  for (const row of rows) {
    if (row.message_id) {
      throw new Error('Attachment already linked to a message');
    }
  }

  const { error: updErr } = await supabaseAdmin
    .from('chat_attachments')
    .update({ message_id: messageId })
    .in('id', unique)
    .eq('user_id', userId);
  if (updErr) throw new Error(`Failed to link attachments: ${updErr.message}`);

  return rows.map((row) => ({
    id: row.id as string,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    sizeBytes: row.size_bytes as number,
    url: `/api/chat/attachments/${row.id}`,
  }));
}

export async function getAttachmentForUser(
  userId: string,
  attachmentId: string
): Promise<{
  filename: string;
  mimeType: string;
  bytes: Buffer;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_attachments')
    .select('filename, mime_type, encrypted_content, user_id')
    .eq('id', attachmentId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.user_id !== userId) return null;
  const b64 = decryptToken(data.encrypted_content as string);
  return {
    filename: data.filename as string,
    mimeType: data.mime_type as string,
    bytes: Buffer.from(b64, 'base64'),
  };
}

export async function listAttachmentMetaForIds(
  userId: string,
  ids: string[]
): Promise<ChatAttachmentMeta[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('chat_attachments')
    .select('id, filename, mime_type, size_bytes')
    .eq('user_id', userId)
    .in('id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    sizeBytes: row.size_bytes as number,
    url: `/api/chat/attachments/${row.id}`,
  }));
}

/** Best-effort client IP for rate limiting. */
export function clientIpFromRequest(request: NextRequest): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}
