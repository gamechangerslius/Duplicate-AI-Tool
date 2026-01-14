export interface Ad {
  id: string;
  ad_archive_id: string;
  business_id?: string;
  title?: string;
  page_name: string;
  ad_text?: string;
  caption?: string;
  image_url?: string;
  url?: string;
  competitor_niche?: string;
  display_format: 'IMAGE' | 'VIDEO';
  created_at: string;
  processed_date?: string; // Date when this creative was processed/fetched
  start_date_formatted: string | null | undefined;
  end_date_formatted: string | null | undefined;
  vector_group: number | null;
  duplicates_count?: number;
  meta_ad_url?: string;
  raw?: Record<string, any>;
}

export interface FilterOptions {
  businessId?: string;
  pageName?: string;
  duplicatesRange?: string;
}

