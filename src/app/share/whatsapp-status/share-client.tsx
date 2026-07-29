'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Download, Share2 } from 'lucide-react';

/**
 * Cross-platform helper: mobile uses Web Share API (Add to Status / share to WhatsApp).
 * Desktop shows download + open WhatsApp Web / app deep link.
 */
export default function WhatsAppStatusShareClient() {
  const params = useSearchParams();
  const mediaId = params.get('m') || '';
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const imageSrc = useMemo(
    () => (mediaId ? `/api/media/whatsapp-status/${encodeURIComponent(mediaId)}` : ''),
    [mediaId]
  );

  const waDeepLink = useMemo(() => {
    const text = caption
      ? `${caption}\n\n(Open this page on your phone to add the photo to Status)`
      : 'Open this page on your phone to add the photo to WhatsApp Status';
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [caption]);

  useEffect(() => {
    if (!mediaId) setError('Missing media id');
  }, [mediaId]);

  const shareNative = useCallback(async () => {
    if (!imageSrc) return;
    setSharing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(imageSrc);
      if (!res.ok) throw new Error('Photo expired or not found');
      const blob = await res.blob();
      const file = new File([blob], 'status.jpg', { type: blob.type || 'image/jpeg' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'WhatsApp Status',
          text: caption || 'Share to WhatsApp Status',
        });
        setInfo('Share sheet opened — choose WhatsApp → Status.');
        return;
      }

      if (navigator.share) {
        await navigator.share({
          title: 'WhatsApp Status',
          text: caption || 'Add this photo to your WhatsApp Status',
          url: window.location.href,
        });
        setInfo('Share sheet opened.');
        return;
      }

      setError(
        'Web Share is not available on this browser. Download the photo, then in WhatsApp: Status → add photo.'
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setInfo('Share cancelled.');
      } else {
        setError(err instanceof Error ? err.message : 'Share failed');
      }
    } finally {
      setSharing(false);
    }
  }, [imageSrc, caption]);

  async function downloadImage() {
    if (!imageSrc) return;
    const res = await fetch(imageSrc);
    if (!res.ok) {
      setError('Photo expired or not found');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'whatsapp-status.jpg';
    a.click();
    URL.revokeObjectURL(url);
    setInfo('Downloaded. Open WhatsApp → Status → gallery to post.');
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-8 flex justify-center">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Add photo to WhatsApp Status</h1>
        <p className="text-sm text-gray-400">
          Works on mobile (share sheet), desktop (download + WhatsApp), and WhatsApp Web.
          Meta&apos;s Cloud API cannot post Status directly — you confirm on your device.
        </p>

        {!mediaId ? (
          <div className="text-red-300 text-sm flex gap-2">
            <AlertCircle className="w-4 h-4" /> Missing photo
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt="Status preview"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 object-contain max-h-[60vh]"
            onError={() => setError('Photo expired or failed to load')}
          />
        )}

        <label className="block text-xs text-gray-400">
          Optional caption
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-sm text-white"
            placeholder="Caption for your status"
          />
        </label>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-md p-3 text-sm text-red-200 flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        {info && (
          <div className="bg-emerald-900/30 border border-emerald-700 rounded-md p-3 text-sm text-emerald-200 flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            {info}
          </div>
        )}

        <button
          type="button"
          disabled={!mediaId || sharing}
          onClick={shareNative}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-3 rounded-md flex items-center justify-center gap-2"
        >
          <Share2 className="w-4 h-4" />
          {sharing ? 'Opening…' : 'Share / Add to Status'}
        </button>

        <button
          type="button"
          disabled={!mediaId}
          onClick={downloadImage}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-md flex items-center justify-center gap-2 text-sm"
        >
          <Download className="w-4 h-4" />
          Download photo
        </button>

        <a
          href={waDeepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center bg-[#25D366] hover:brightness-110 text-slate-900 font-medium py-2.5 rounded-md text-sm"
        >
          Open WhatsApp (app / desktop / web)
        </a>
      </div>
    </div>
  );
}
