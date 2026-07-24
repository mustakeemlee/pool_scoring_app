// web/src/lib/playerPhotos.ts
import { supabase } from '@/lib/supabaseClient';

// The player-photos storage bucket is private (20260724020000_private_player_photos.sql),
// so players.photo_url stores a bare storage object path, not a fetchable URL.
// Signed URLs are short-lived by design -- a page reload or query refetch
// resolves fresh ones, so a generous TTL just reduces unnecessary re-signing.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Batch-resolves storage object paths to signed URLs in a single request.
// Paths that fail to resolve (missing file, etc.) are silently omitted --
// callers fall back to no photo (PlayerAvatar shows initials) rather than
// failing the whole page over one broken photo.
export async function resolvePlayerPhotoUrls(
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (uniquePaths.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from('player-photos')
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  const urlByPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }
  return urlByPath;
}

export function pickResolvedUrl(urlByPath: Map<string, string>, path: string | null | undefined): string | null {
  return path ? (urlByPath.get(path) ?? null) : null;
}
