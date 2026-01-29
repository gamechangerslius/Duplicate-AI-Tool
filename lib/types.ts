export interface Ad {
  id: string;
  ad_archive_id: string;
  business_id?: string;
  title?: string;
  page_name: string;
  ad_text?: string;
  caption?: string;
  image_url?: string;
  video_storage_path?: string;
  url?: string;
  competitor_niche?: string;
  display_format: 'IMAGE' | 'VIDEO';
  created_at: string;
  processed_date?: string; // Date when this creative was processed/fetched
  start_date_formatted: string | null | undefined;
  end_date_formatted: string | null | undefined;
  vector_group: number | null;
  group_created_at?: string | null;
  new_count?: number;
  duplicates_count?: number;
  items?: number; // total items count from ads_groups_test
  group_items?: number; // raw `items` value from ads_groups_test table
  group_first_seen?: string | null;
  group_last_seen?: string | null;
  status?: 'New' | 'Scaling' | 'Inactive';
  diff_count?: number | null;
  meta_ad_url?: string;
  ai_description?: string;
  concept?: string;
  raw?: Record<string, any>;
}

export interface FilterOptions {
  businessId?: string;
  pageName?: string;
  duplicatesRange?: string;
}

