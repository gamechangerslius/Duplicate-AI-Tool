/**
 * Utility functions for managing URL query parameters across the application
 * Ensures consistent parameter preservation during navigation
 */

export interface FilterParams {
  businessId?: string;
  displayFormat?: string;
  pageName?: string;
  startDate?: string;
  endDate?: string;
  aiDescription?: string;
  sortBy?: string;
  page?: number;
  returnTo?: string;
}

/**
 * Builds a query string from filter parameters
 * Only includes parameters that have values (excluding defaults)
 */
export function buildQueryString(params: FilterParams): string {
  const query = new URLSearchParams();
  
  if (params.businessId) query.set('businessId', params.businessId);
  if (params.displayFormat && params.displayFormat !== 'ALL') query.set('displayFormat', params.displayFormat);
  if (params.pageName) query.set('pageName', params.pageName);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.aiDescription) query.set('aiDescription', params.aiDescription);
  if (params.sortBy && params.sortBy !== 'newest') query.set('sortBy', params.sortBy);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  if (params.returnTo) query.set('returnTo', params.returnTo);
  
  return query.toString();
}

/**
 * Parses URL search params into FilterParams object
 */
export function parseFilterParams(searchParams: URLSearchParams): FilterParams {
  return {
    businessId: searchParams.get('businessId') || undefined,
    displayFormat: searchParams.get('displayFormat') || undefined,
    pageName: searchParams.get('pageName') || undefined,
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    aiDescription: searchParams.get('aiDescription') || undefined,
    sortBy: searchParams.get('sortBy') || undefined,
    page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined,
    returnTo: searchParams.get('returnTo') || undefined,
  };
}

/**
 * Builds a complete URL with current filters preserved
 */
export function buildUrlWithFilters(path: string, params: FilterParams): string {
  const queryString = buildQueryString(params);
  return queryString ? `${path}?${queryString}` : path;
}

/**
 * Adds returnTo parameter to current filters
 */
export function addReturnTo(params: FilterParams, returnToPath: string): FilterParams {
  return {
    ...params,
    returnTo: returnToPath,
  };
}
