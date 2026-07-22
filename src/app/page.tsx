'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  Sparkles,
  Copy,
  Check,
  AlertCircle,
  LogOut,
  Send,
  Link2,
  History,
} from 'lucide-react';

interface WorkflowResult {
  workflowId: string;
  shareableUrl: string;
  action: string;
  apis: string[];
}

interface TimelineItem {
  label: string;
  status: 'done' | 'in_progress' | 'blocked' | 'waiting';
  detail?: string;
}

interface ChatResponse {
  threadId?: string;
  assistantMessage: string;
  actionable: boolean;
  workflow?: WorkflowResult;
  timeline?: TimelineItem[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  workflow?: WorkflowResult;
  timeline?: TimelineItem[];
  createdAt?: string;
  error?: boolean;
}

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Describe what you want to automate. I will create a secure, shareable workflow link you can send to someone for execution.',
    },
  ]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedByMessage, setCopiedByMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.replace('/login?returnUrl=' + encodeURIComponent('/'));
          return;
        }
      } catch {
        router.replace('/login');
        return;
      } finally {
        setAuthLoading(false);
      }
    }
    checkAuth();
  }, [router]);

  useEffect(() => {
    if (!mounted || authLoading) return;

    async function loadHistory() {
      try {
        const res = await fetch('/api/chat');
        if (!res.ok) return;
        const data = (await res.json()) as {
          threadId: string;
          messages: Array<{
            id: string;
            role: 'user' | 'assistant';
            content: string;
            meta?: { workflow?: WorkflowResult; timeline?: TimelineItem[] };
            createdAt: string;
          }>;
        };

        setThreadId(data.threadId);
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(
            data.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              workflow: m.meta?.workflow,
              timeline: m.meta?.timeline,
              createdAt: m.createdAt,
            }))
          );
        }
      } catch {
        // keep local default welcome message if history load fails
      }
    }

    loadHistory();
  }, [mounted, authLoading]);

  function streamAssistantTyping(messageId: string, fullText: string) {
    if (!fullText) return;
    let idx = 0;
    const tick = () => {
      idx += 3;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content: fullText.slice(0, idx) } : m
        )
      );
      if (idx < fullText.length) {
        window.setTimeout(tick, 18);
      }
    };
    window.setTimeout(tick, 18);
  }

  async function handleSend() {
    const message = input.trim();
    if (!message) return;

    const userMessage: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: message,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process message');
      }

      const chat = data as ChatResponse;
      if (chat.threadId) setThreadId(chat.threadId);

      const assistantId = `a_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          workflow: chat.workflow,
          timeline: chat.timeline,
        },
      ]);
      streamAssistantTyping(assistantId, chat.assistantMessage);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Unknown error';
      setError(text);
      setMessages((prev) => [
        ...prev,
        {
          id: `a_err_${Date.now()}`,
          role: 'assistant',
          content: text,
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function copyUrl(messageId: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedByMessage(messageId);
    setTimeout(() => setCopiedByMessage(null), 2000);
  }

  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-slate-900 to-slate-800 px-4 py-10">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-blue-400" />
              Actionable Links
            </h1>
            <p className="text-gray-300">
              Chat-style automation assistant. Ask naturally and get secure executable links.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/runs"
              className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
            >
              <History className="w-4 h-4" />
              Runs
            </Link>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                router.replace('/login');
              }}
              className="text-gray-400 hover:text-white text-sm flex items-center gap-1"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </button>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-4">
          <div className="max-h-[56vh] overflow-y-auto space-y-4 pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg p-4 ${
                  m.role === 'user'
                    ? 'bg-blue-900/40 border border-blue-700 ml-8'
                    : m.error
                      ? 'bg-red-900/20 border border-red-700 mr-8'
                      : 'bg-slate-700 border border-slate-600 mr-8'
                }`}
              >
                <p className="text-sm text-gray-100 whitespace-pre-wrap">{m.content}</p>

                {m.timeline && m.timeline.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {m.timeline.map((t, idx) => (
                      <div
                        key={`${m.id}_timeline_${idx}`}
                        className="bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-gray-200">{t.label}</span>
                          <span
                            className={`uppercase text-[10px] tracking-wide ${
                              t.status === 'done'
                                ? 'text-green-400'
                                : t.status === 'in_progress'
                                  ? 'text-blue-300'
                                  : t.status === 'blocked'
                                    ? 'text-red-300'
                                    : 'text-gray-400'
                            }`}
                          >
                            {t.status.replace('_', ' ')}
                          </span>
                        </div>
                        {t.detail && (
                          <div className="text-gray-400 mt-1">{t.detail}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {m.workflow && (
                  <div className="mt-3 bg-slate-900 border border-slate-600 rounded-md p-3 space-y-3">
                    <div className="text-xs text-gray-300 flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5" />
                      Executable workflow link
                    </div>
                    <div className="text-xs text-gray-400">
                      Action: <span className="text-gray-200">{m.workflow.action}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {m.workflow.apis.map((api) => (
                        <span
                          key={`${m.id}_${api}`}
                          className="text-[11px] bg-slate-700 text-gray-200 rounded px-2 py-1 capitalize"
                        >
                          {api.replace(/-/g, ' ')}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={m.workflow.shareableUrl}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-blue-300 font-mono"
                      />
                      <button
                        onClick={() => copyUrl(m.id, m.workflow!.shareableUrl)}
                        className="bg-slate-700 hover:bg-slate-600 text-white rounded px-3 text-xs flex items-center gap-1"
                      >
                        {copiedByMessage === m.id ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedByMessage === m.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded-md p-3 text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask naturally, e.g. Create a calendar event and notify Slack..."
              rows={2}
              disabled={loading}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || input.trim().length === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white font-semibold px-4 rounded-md transition flex items-center justify-center gap-2 self-stretch"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Tip: include app names and parameters (channel, email, date/time) for best results.
          </p>
          <div className="text-xs text-gray-400 flex flex-wrap gap-2">
            <button
              onClick={() =>
                setInput(
                  'Create a Google Calendar event tomorrow at 3:00 PM titled "Project Sync" and send a Slack message in #general saying "Project Sync scheduled for 3 PM tomorrow."'
                )
              }
              className="bg-slate-700 hover:bg-slate-600 rounded px-2 py-1"
            >
              Example: Calendar + Slack
            </button>
            <button
              onClick={() =>
                setInput(
                  'Set dark mode on Windows and open https://app.slack.com'
                )
              }
              className="bg-slate-700 hover:bg-slate-600 rounded px-2 py-1"
            >
              Example: OS + Browser
            </button>
            <button
              onClick={() =>
                setInput(
                  'Call API via webhook https://webhook.site/your-id with message "test from shareAi"'
                )
              }
              className="bg-slate-700 hover:bg-slate-600 rounded px-2 py-1"
            >
              Example: HTTP webhook
            </button>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 text-xs text-gray-400">
          <p className="mb-1">Current flow remains intact:</p>
          <p>
            1) ask in chat -&gt; 2) get shareable link -&gt; 3) recipient opens execute page -&gt; 4) connect apps -&gt; 5) authorize and run.
          </p>
          {threadId && <p className="mt-2 text-gray-500">Thread: {threadId}</p>}
        </div>
      </div>
    </div>
  );
}
