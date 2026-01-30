import { useQuery } from '@tanstack/react-query';
import { fetchRelatedAds } from '@/utils/supabase/db';

export function useRelatedAds(vectorGroup?: number, adArchiveId?: string, businessId?: string) {
  return useQuery({
    queryKey: ['related-ads', vectorGroup, adArchiveId, businessId],
    queryFn: async () => {
      if (!vectorGroup || !adArchiveId || !businessId) return [];
      return await fetchRelatedAds(vectorGroup, adArchiveId, businessId);
    },
    enabled: !!vectorGroup && !!adArchiveId && !!businessId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
