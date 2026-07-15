import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  it('constructs a client when env vars are present', async () => {
    const { supabase } = await import('./supabaseClient');
    expect(supabase).toBeDefined();
    expect(supabase.supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('throws a clear error when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    await expect(import('./supabaseClient')).rejects.toThrow(/Missing VITE_SUPABASE_URL/);
  });
});
