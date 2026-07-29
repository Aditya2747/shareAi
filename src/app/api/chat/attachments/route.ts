import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { createChatAttachment } from '@/lib/chat-attachments';

export const runtime = 'nodejs';

/** Upload a chat attachment (multipart field "file"). Max 5MB. */
export async function POST(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const attachment = await createChatAttachment({
      userId,
      filename: file.name || 'upload',
      mimeType: file.type || 'application/octet-stream',
      bytes,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
