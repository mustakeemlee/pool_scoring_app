// web/src/hooks/useIsAdmin.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useIsAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ['isAdmin', userId ?? ''],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('admin_users')
        .select('id')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },
    enabled: userId !== undefined,
  });
}
