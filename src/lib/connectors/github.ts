import { ActionResult, ConnectionStatus, Connector, ConnectorCredentials } from './types';

/**
 * GitHub connector — create gists (default OAuth scope: gist) and optionally
 * create issues (requires `repo` scope on the OAuth app / token).
 */

const API = 'https://api.github.com';

function authHeaders(creds: ConnectorCredentials) {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function createGist(
  params: Record<string, unknown>,
  creds: ConnectorCredentials
): Promise<ActionResult> {
  const filename =
    String(params.filename ?? params.file ?? 'shareai.md').trim() || 'shareai.md';
  const content = String(params.content ?? params.body ?? params.text ?? '').trim();
  const description = String(params.description ?? params.title ?? 'Created via shareAi').trim();
  const isPublic = params.public === true || params.public === 'true';

  if (!content) {
    return { ok: false, error: 'create_gist requires content (or body/text)' };
  }

  const res = await fetch(`${API}/gists`, {
    method: 'POST',
    headers: authHeaders(creds),
    body: JSON.stringify({
      description,
      public: isPublic,
      files: {
        [filename]: { content },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: `GitHub gist create failed: ${data?.message || res.statusText}`,
    };
  }
  return {
    ok: true,
    data: {
      id: data.id,
      html_url: data.html_url,
      description: data.description,
    },
  };
}

async function createIssue(
  params: Record<string, unknown>,
  creds: ConnectorCredentials
): Promise<ActionResult> {
  const owner = String(params.owner ?? '').trim();
  const repo = String(params.repo ?? params.repository ?? '').trim();
  const title = String(params.title ?? params.summary ?? '').trim();
  const body = String(params.body ?? params.text ?? params.content ?? '').trim();

  if (!owner || !repo) {
    return { ok: false, error: 'create_issue requires owner and repo' };
  }
  if (!title) {
    return { ok: false, error: 'create_issue requires a title' };
  }

  const res = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    method: 'POST',
    headers: authHeaders(creds),
    body: JSON.stringify({ title, body: body || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: `GitHub issue create failed: ${data?.message || res.statusText}`,
    };
  }
  return {
    ok: true,
    data: {
      number: data.number,
      html_url: data.html_url,
      title: data.title,
    },
  };
}

export const githubConnector: Connector = {
  id: 'github',
  name: 'GitHub',
  category: 'storage',
  authProviders: ['github'],
  supportedActions: ['create_gist', 'create_issue'],
  supportsDiscovery: false,

  async testConnection(creds: ConnectorCredentials): Promise<ConnectionStatus> {
    const res = await fetch(`${API}/user`, {
      headers: authHeaders(creds),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || 'GitHub /user failed' };
    }
    return { ok: true, info: { login: data.login, id: data.id } };
  },

  async executeAction(action, params, creds): Promise<ActionResult> {
    switch (action) {
      case 'create_gist':
        return createGist(params, creds);
      case 'create_issue':
        return createIssue(params, creds);
      default:
        return { ok: false, error: `Unsupported GitHub action: ${action}` };
    }
  },
};
