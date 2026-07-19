// web/src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Self-hosted production builds bake an EMPTY url on purpose: the frontend
// nginx proxies /rest, /auth, /storage and /functions to the API gateway on
// the same origin, so the client just uses wherever it was served from.
// Dev builds get a concrete URL from `npm run env:generate`.
const supabaseUrl =
  envUrl && envUrl.length > 0 ? envUrl : typeof window !== 'undefined' ? window.location.origin : undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Run `npm run env:generate` (requires `supabase start`).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
