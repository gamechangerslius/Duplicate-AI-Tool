import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchAds } from '@/utils/supabase/db';

type Params = {
  businessId?: string | null;
  pageName?: string;
  startDate?: string;
  endDate?: string;
  displayFormat?: string;
  duplicatesRange?: { min: number; max: number };
  aiDescription?: string;
  sortBy?: string;
  page?: number;
  perPage?: number;
};

export function useAds(params: Params) {
  // We use the whole params object in the key so any filter change triggers a refetch
  const queryKey = ['ads', params];

  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      // Return empty results if no businessId is provided to avoid unnecessary DB calls
      if (!params.businessId) {
        return { ads: [], total: 0 };
      }

      const res = await fetchAds(
        {
          businessId: params.businessId,
          pageName: params.pageName,
          startDate: params.startDate,
          endDate: params.endDate,
          displayFormat: params.displayFormat,
          duplicatesRange: params.duplicatesRange,
          aiDescription: params.aiDescription,
          sortBy: params.sortBy as any
        },
        { 
          page: params.page ?? 1, 
          perPage: params.perPage ?? 24 
        },
        { signal } // Critical for canceling previous requests on filter change
      );

      return res;
    },
    // Configuration for v5 compatibility
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // v5: cacheTime is now gcTime
    placeholderData: keepPreviousData, // Replaces keepPreviousData: true
    refetchOnWindowFocus: false,
    enabled: !!params.businessId, // Only run the query if we have a businessId
  });
}