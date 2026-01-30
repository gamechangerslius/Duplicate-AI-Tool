import { useQuery } from '@tanstack/react-query';
import { fetchDuplicatesStats } from '@/utils/supabase/db';

/**
 * Hook to fetch min/max duplicate counts for a specific business.
 * Used to initialize the range slider.
 */
export function useDuplicatesStats(businessId: string | null) {
  return useQuery({
    // Important: We only depend on businessId. 
    // We don't want to refetch stats when the slider itself moves.
    queryKey: ['duplicates-stats', businessId],
    
    queryFn: async ({ signal }) => {
      if (!businessId) return { min: 1, max: 100 };
      
      const res = await fetchDuplicatesStats(businessId);
      
      // Ensure we always have sensible numbers for the UI
      return {
        min: Math.max(1, res?.min ?? 1),
        max: Math.max(1, res?.max ?? 100),
      };
    },
    
    // Stats don't change often, so we can keep them "fresh" longer
    staleTime: 1000 * 60 * 10, // 10 minutes
    gcTime: 1000 * 60 * 30,    // 30 minutes
    
    // Only run if businessId exists
    enabled: !!businessId,
    
    refetchOnWindowFocus: false,
  });
}