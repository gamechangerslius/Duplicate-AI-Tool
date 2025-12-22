export interface Ad {
  id: string;
  ad_archive_id: string;
  title?: string;
  page_name: string;
  ad_text?: string;
  caption?: string;
  business?: string;
  display_format: 'IMAGE' | 'VIDEO';
  created_at: string;
  vector_group: number | null;
  duplicates_count?: number;
  meta_ad_url?: string;
  raw?: Record<string, any>;
}

export interface FilterOptions {
  business?: string;
  pageName?: string;
  duplicatesRange?: string;
}

export const DUPLICATES_RANGES = [
  { label: '>100', min: 100, max: Infinity },
  { label: '50-90', min: 50, max: 90 },
  { label: '30-50', min: 30, max: 50 },
  { label: '<20', min: 0, max: 20 },
];
