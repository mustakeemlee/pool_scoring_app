// supabase/functions/_shared/requireAdmin.ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AdminUser {
  id: string;
  display_name: string;
  role: string;
}

export async function requireAdmin(
  authedClient: SupabaseClient,
  serviceRoleClient: SupabaseClient,
): Promise<AdminUser | null> {
  const { data: userData } = await authedClient.auth.getUser();
  if (!userData?.user) return null;

  const { data: adminRow } = await serviceRoleClient
    .from('admin_users')
    .select('id, display_name, role')
    .eq('id', userData.user.id)
    .maybeSingle();

  return (adminRow as AdminUser) ?? null;
}
