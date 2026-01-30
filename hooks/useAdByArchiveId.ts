import { useQuery } from '@tanstack/react-query';
import { fetchAdByArchiveId } from '@/utils/supabase/db';

export function useAdByArchiveId(adArchiveId: string, businessId?: string) {
  return useQuery({
    queryKey: ['ad-by-archive-id', adArchiveId, businessId],
    queryFn: async () => {
      if (!adArchiveId) return null;
      return await fetchAdByArchiveId(adArchiveId, businessId);
    },
    enabled: !!adArchiveId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
