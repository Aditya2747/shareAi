'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  LogOut,
  Paperclip,
  PenSquare,
  Send,
  X,
} from 'lucide-react';

type TimelineItem = {
  label: string;
  status: 'done' | 'in_progress' | 'blocked' | 'waiting';
  detail?: string;
};

type AttachmentMeta = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
  timeline?: TimelineItem[];
  workflow?: {
    workflowId: string;
    shareableUrl: string;
    action: string;
    apis: string[];
  };
  attachments?: AttachmentMeta[];
};

type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
  uploading?: boolean;
  uploaded?: AttachmentMeta;
  error?: string;
};

const EXAMPLES = [
  'Schedule a calendar event tomorrow at 3pm titled Team sync',
  'Send a Slack message to #general saying deploy is live',
  'Create a GitHub gist with hello from shareAi',
  'Add this photo to my WhatsApp status',
];

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    async function boot() {
      try {
        const me = await fetch('/api/auth/me');
        if (!me.ok) {
          router.replace('/login?returnUrl=/');
          return;
        }
        const hist = await fetch('/api/chat');
        if (hist.ok) {
          const data = await hist.json();
          const mapped: ChatMessage[] = (data.messages ?? []).map(
            (m: {
              id: string;
              role: 'user' | 'assistant';
              content: string;
              meta?: {
                timeline?: TimelineItem[];
                workflow?: ChatMessage['workflow'];
                attachments?: AttachmentMeta[];
              };
            }) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timeline: m.meta?.timeline,
              workflow: m.meta?.workflow,
              attachments: m.meta?.attachments,
            })
          );
          setMessages(mapped);
        }
      } catch {
        router.replace('/login?returnUrl=/');
      } finally {
        setAuthLoading(false);
      }
    }
    void boot();
  }, [router]);

  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  async function uploadFile(file: File): Promise<AttachmentMeta> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/chat/attachments', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data.attachment as AttachmentMeta;
  }

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).slice(0, 5 - pending.length);
    for (const file of files) {
      const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = file.type.startsWith('image/')
        ? URL.createObjectURL(file)
        : undefined;
      setPending((prev) => [
        ...prev,
        { id: localId, file, previewUrl, uploading: true },
      ]);
      try {
        const uploaded = await uploadFile(file);
        setPending((prev) =>
          prev.map((p) =>
            p.id === localId ? { ...p, uploading: false, uploaded } : p
          )
        );
      } catch (e) {
        setPending((prev) =>
          prev.map((p) =>
            p.id === localId
              ? {
                  ...p,
                  uploading: false,
                  error: e instanceof Error ? e.message : 'Upload failed',
                }
              : p
          )
        );
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePending(id: string) {
    setPending((prev) => {
      const row = prev.find((p) => p.id === id);
      if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleSend() {
    const text = input.trim();
    const ready = pending.filter((p) => p.uploaded && !p.error);
    if ((!text && ready.length === 0) || loading) return;
    if (pending.some((p) => p.uploading)) {
      setError('Wait for uploads to finish');
      return;
    }

    setError(null);
    setLoading(true);
    setInput('');
    adjustTextarea();

    const attachmentIds = ready.map((p) => p.uploaded!.id);
    const userAttachments = ready.map((p) => p.uploaded!);
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text || '(attachment)',
      attachments: userAttachments,
    };
    setMessages((m) => [...m, userMsg]);
    setPending((prev) => {
      prev.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      return [];
    });

    const streamId = `a_${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: streamId, role: 'assistant', content: '', streaming: true },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text || 'Please use the attached file.',
          attachmentIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Chat failed');

      const full = String(data.assistantMessage || '');
      // Soft typewriter
      let i = 0;
      const step = Math.max(2, Math.ceil(full.length / 40));
      await new Promise<void>((resolve) => {
        const tick = () => {
          i = Math.min(full.length, i + step);
          setMessages((msgs) =>
            msgs.map((msg) =>
              msg.id === streamId
                ? {
                    ...msg,
                    content: full.slice(0, i),
                    streaming: i < full.length,
                    timeline: data.timeline,
                    workflow: data.workflow,
                  }
                : msg
            )
          );
          if (i < full.length) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
    } catch (e) {
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === streamId
            ? {
                ...msg,
                content: e instanceof Error ? e.message : 'Something went wrong',
                streaming: false,
                error: true,
              }
            : msg
        )
      );
    } finally {
      setLoading(false);
    }
  }

  function shareViaWhatsApp(url: string) {
    const text = `Open this shareAi workflow:\n${url}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    );
  }

  async function copyUrl(id: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  if (!mounted || authLoading) {
    return (
      <div className="h-full min-h-screen flex items-center justify-center bg-chat-bg">
        <Loader2 className="w-7 h-7 text-chat-accent animate-spin" />
      </div>
    );
  }

  const empty = messages.length === 0;

  return (
    <div className="h-[100dvh] flex flex-col bg-chat-bg">
      <header className="shrink-0 h-14 border-b border-chat-border/60 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMessages([])}
            className="p-2 rounded-lg hover:bg-chat-surface text-chat-muted hover:text-chat-text"
            title="New chat"
          >
            <PenSquare className="w-4 h-4" />
          </button>
          <span className="font-semibold tracking-tight text-chat-text">shareAi</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/runs"
            className="px-3 py-1.5 rounded-lg text-chat-muted hover:text-chat-text hover:bg-chat-surface"
          >
            Runs
          </Link>
          <button
            type="button"
            onClick={logout}
            className="p-2 rounded-lg text-chat-muted hover:text-chat-text hover:bg-chat-surface"
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center px-4 pb-8">
            <h1 className="text-3xl md:text-4xl font-semibold text-chat-text tracking-tight mb-2">
              What can I help automate?
            </h1>
            <p className="text-chat-muted text-sm mb-10 text-center max-w-md">
              Describe a workflow. I&apos;ll create a shareable link your teammate can run.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-chat">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setInput(ex);
                    textareaRef.current?.focus();
                  }}
                  className="text-left text-sm rounded-2xl border border-chat-border bg-chat-surface/50 hover:bg-chat-surface px-4 py-3 text-chat-muted hover:text-chat-text transition"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-chat px-4 py-6 space-y-6">
            {messages.map((m) => (
              <div key={m.id} className="flex gap-3">
                <div
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                    m.role === 'user'
                      ? 'bg-chat-accent text-chat-bg'
                      : 'bg-chat-surface-2 text-chat-text'
                  }`}
                >
                  {m.role === 'user' ? 'You' : 'AI'}
                </div>
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <div className="text-xs font-medium text-chat-muted">
                    {m.role === 'user' ? 'You' : 'shareAi'}
                  </div>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {m.attachments.map((a) =>
                        a.mimeType.startsWith('image/') ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={a.id}
                            src={a.url}
                            alt={a.filename}
                            className="max-h-48 rounded-xl border border-chat-border object-cover"
                          />
                        ) : (
                          <a
                            key={a.id}
                            href={a.url}
                            className="text-xs px-3 py-2 rounded-lg bg-chat-surface border border-chat-border text-chat-accent"
                          >
                            {a.filename}
                          </a>
                        )
                      )}
                    </div>
                  )}
                  <div
                    className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
                      m.error ? 'text-red-300' : 'text-chat-text'
                    }`}
                  >
                    {m.content}
                    {m.streaming && (
                      <span className="inline-block w-2 h-4 ml-0.5 bg-chat-muted/80 animate-pulse align-middle" />
                    )}
                  </div>

                  {m.workflow && (
                    <div className="mt-3 rounded-2xl border border-chat-border bg-chat-surface p-3 space-y-2">
                      <div className="text-xs text-chat-muted">
                        Workflow · {m.workflow.action}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.workflow.apis.map((api) => (
                          <span
                            key={api}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-chat-bg text-chat-muted capitalize"
                          >
                            {api.replace(/-/g, ' ')}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          readOnly
                          value={m.workflow.shareableUrl}
                          className="flex-1 min-w-[10rem] text-xs bg-chat-bg border border-chat-border rounded-lg px-2 py-1.5 font-mono text-chat-accent"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            copyUrl(m.id, m.workflow!.shareableUrl)
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-chat-surface-2 text-xs text-chat-text flex items-center gap-1"
                        >
                          {copiedId === m.id ? (
                            <Check className="w-3.5 h-3.5 text-chat-accent" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            shareViaWhatsApp(m.workflow!.shareableUrl)
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-[#25D366] text-xs font-medium text-chat-bg"
                        >
                          WhatsApp
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-chat-border/40 bg-chat-bg px-3 pb-4 pt-3">
        <div className="mx-auto w-full max-w-chat">
          {error && (
            <div className="mb-2 text-sm text-red-300 flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="relative group rounded-xl border border-chat-border bg-chat-surface overflow-hidden"
                >
                  {p.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.previewUrl}
                      alt=""
                      className="h-16 w-16 object-cover"
                    />
                  ) : (
                    <div className="h-16 w-28 px-2 flex items-center text-[11px] text-chat-muted truncate">
                      {p.file.name}
                    </div>
                  )}
                  {p.uploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  )}
                  {p.error && (
                    <div className="absolute inset-0 bg-red-900/80 text-[10px] p-1 text-white">
                      {p.error}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePending(p.id)}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-3xl border border-chat-border bg-chat-surface shadow-lg shadow-black/20 focus-within:ring-1 focus-within:ring-chat-accent/40">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                adjustTextarea();
              }}
              rows={1}
              placeholder="Message shareAi…"
              disabled={loading}
              className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] text-chat-text placeholder:text-chat-muted focus:outline-none max-h-40"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain"
                  className="hidden"
                  multiple
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || pending.length >= 5}
                  className="p-2 rounded-xl text-chat-muted hover:text-chat-text hover:bg-chat-surface-2 disabled:opacity-40"
                  title="Attach file"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = 'image/*';
                      fileInputRef.current.click();
                      fileInputRef.current.accept =
                        'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain';
                    }
                  }}
                  disabled={loading || pending.length >= 5}
                  className="p-2 rounded-xl text-chat-muted hover:text-chat-text hover:bg-chat-surface-2 disabled:opacity-40"
                  title="Attach image"
                >
                  <ImagePlus className="w-5 h-5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={
                  loading ||
                  (!input.trim() && !pending.some((p) => p.uploaded)) ||
                  pending.some((p) => p.uploading)
                }
                className="p-2 rounded-xl bg-chat-accent text-chat-bg disabled:opacity-30 hover:brightness-110 transition"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
          <p className="text-center text-[11px] text-chat-muted mt-2">
            Attach images for WhatsApp Status / send image · Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}
