import { useQuery } from '@tanstack/react-query';
import { fetchGroupRepresentative } from '@/utils/supabase/db';

export function useGroupRepresentative(vectorGroup?: number, businessId?: string) {
  return useQuery({
    queryKey: ['group-representative', vectorGroup, businessId],
    queryFn: async () => {
      if (!vectorGroup || !businessId) return null;
      return await fetchGroupRepresentative(vectorGroup, businessId);
    },
    enabled: !!vectorGroup && !!businessId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
