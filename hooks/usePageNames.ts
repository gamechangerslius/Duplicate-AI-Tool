import { useQuery } from '@tanstack/react-query';
import { fetchPageNames } from '@/utils/supabase/db';

/**
 * Hook to fetch advertiser page names for the filter dropdown.
 * Uses long-term caching since page names are relatively static.
 */
export function usePageNames(businessId?: string | null) {
  return useQuery({
    // Standard v5 object-based configuration
    queryKey: ['page-names', businessId],
    
    queryFn: async ({ signal }) => {
      if (!businessId) return [];
      
      // We pass signal here just in case, though fetchPageNames 
      // is usually a fast RPC call.
      return await fetchPageNames(businessId);
    },
    
    // Performance optimization:
    // Page names don't change often, so we cache them for 20 minutes
    staleTime: 1000 * 60 * 20, 
    gcTime: 1000 * 60 * 60, // Keep in garbage collector for 1 hour
    
    // Only run if we have a businessId
    enabled: !!businessId,
    
    // Prevent unnecessary background refreshes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });
}