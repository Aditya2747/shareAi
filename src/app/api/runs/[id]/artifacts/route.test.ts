import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserIdFromRequest = vi.fn();
const getRunDetails = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/auth', () => ({
  getUserIdFromRequest: (...args: unknown[]) => getUserIdFromRequest(...args),
}));

vi.mock('@/lib/v2/runs', () => ({
  getRunDetails: (...args: unknown[]) => getRunDetails(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: (...args: unknown[]) => maybeSingle(...args),
        }),
      }),
    }),
  },
}));

describe('GET /api/runs/[id]/artifacts auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    getUserIdFromRequest.mockReturnValue(null);

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/runs/run_1/artifacts');
    const res = await GET(req, { params: { id: 'run_1' } });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/not authenticated/i);
    expect(getRunDetails).not.toHaveBeenCalled();
  });

  it('returns 403 when authenticated user is not executed_by', async () => {
    getUserIdFromRequest.mockReturnValue('user_attacker');
    maybeSingle.mockResolvedValue({
      data: { id: 'run_1', executed_by: 'user_owner' },
      error: null,
    });

    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/runs/run_1/artifacts');
    const res = await GET(req, { params: { id: 'run_1' } });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
    expect(getRunDetails).not.toHaveBeenCalled();
  });
});
