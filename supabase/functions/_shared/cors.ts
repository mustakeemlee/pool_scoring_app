// supabase/functions/_shared/cors.ts
//
// Edge Functions are plain Deno HTTP handlers -- unlike PostgREST/GoTrue
// (fronted by Supabase's own gateway, which already sends CORS headers on
// every response), nothing adds CORS headers for us here. Every response,
// including error responses, needs them, and every function needs to
// short-circuit the browser's preflight OPTIONS request before it reaches
// requireAdmin() -- a preflight carries no Authorization header, so letting
// it fall through returns a 401 with no CORS headers, which browsers report
// as an opaque "CORS policy" failure instead of the real 401.
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
