import { NextRequest, NextResponse } from 'next/server';
import { getStatusMedia } from '@/lib/v2/whatsapp-status-media';

/** Public short-lived media for WhatsApp Status share helper. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const media = getStatusMedia(params.id);
  if (!media) {
    return NextResponse.json({ error: 'Media not found or expired' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      'Content-Type': media.contentType,
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `inline; filename="whatsapp-status-${params.id}"`,
    },
  });
}
