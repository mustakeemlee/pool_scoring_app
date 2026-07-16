// web/src/lib/edgeFunctions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}));

import { enterMatch, correctMatch } from './edgeFunctions';

describe('edgeFunctions', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  });

  it('sends a POST with the bearer token and JSON body for enterMatch', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ match_id: 'm1' }),
    });

    const result = await enterMatch({
      season_id: 's1',
      match_date: '2026-01-22',
      player_a_id: 'p1',
      player_b_id: 'p2',
      frames_a: 5,
      frames_b: 2,
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:54321/functions/v1/enter-match',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
    expect(result).toEqual({ match_id: 'm1' });
  });

  it('throws the response body error verbatim on failure', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Cannot correct a match whose week has already closed' }),
    });

    await expect(
      correctMatch({ match_id: 'm1', frames_a: 5, frames_b: 3 }),
    ).rejects.toThrow('Cannot correct a match whose week has already closed');
  });

  it('throws when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(
      enterMatch({ season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2 }),
    ).rejects.toThrow('Not signed in.');
  });
});
