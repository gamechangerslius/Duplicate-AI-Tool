export interface Ad {
  id: string;
  ad_archive_id: string;
  title?: string;
  page_name: string;
  ad_text?: string;
  caption?: string;
  business?: string;
  image_url?: string;
  url?: string;
  competitor_niche?: string;
  display_format: 'IMAGE' | 'VIDEO';
  created_at: string;
  start_date_formatted?: string;
  end_date_formatted?: string;
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

