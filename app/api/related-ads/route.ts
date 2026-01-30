export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCreativeUrl, getBusinessSlug } from '@/utils/supabase/db';

const ADS_TABLE = 'ads';
const ADS_GROUPS_TABLE = 'ads_groups_test';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vgParam = searchParams.get('vector_group');
    const lastId = searchParams.get('last_id');
    const limitParam = searchParams.get('limit');
    const currentId = searchParams.get('current_id');
    const businessId = searchParams.get('business_id');

    if (!vgParam) {
      return NextResponse.json({ error: 'vector_group is required' }, { status: 400 });
    }
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const vector_group = Number(vgParam);
    const limit = Math.min(Math.max(Number(limitParam || '60'), 1), 500);

    // Get business slug for image URLs
    const businessSlug = await getBusinessSlug(businessId);
    if (!businessSlug) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Get a single representative from ads_groups_test to avoid duplicates
    const { data: groupRow } = await supabase
      .from(ADS_GROUPS_TABLE)
      .select('rep_ad_archive_id, items')
      .eq('vector_group', vector_group)
      .eq('business_id', businessId)
      .maybeSingle();

    const representativeId = groupRow?.rep_ad_archive_id;

    // Determine which ad to return (representative when it differs from current)
    let q;
    if (representativeId && representativeId !== currentId) {
      q = supabase
        .from(ADS_TABLE)
        .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, competitor_niche, start_date_formatted, end_date_formatted, duplicates_count, cards_json')
        .eq('ad_archive_id', representativeId)
        .eq('business_id', businessId)
        .limit(1);
    } else {
      // Fallback: pick the first ad in the group (excluding current) if representative missing/identical
      q = supabase
        .from(ADS_TABLE)
        .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, competitor_niche, start_date_formatted, end_date_formatted, duplicates_count, cards_json')
        .eq('vector_group', vector_group)
        .eq('business_id', businessId)
        .order('ad_archive_id', { ascending: true })
        .limit(1);

      if (currentId) {
        q = q.neq('ad_archive_id', currentId);
      }
      if (lastId) {
        q = q.gt('ad_archive_id', lastId);
      }
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    // Fetch group status analytics
    const { data: statusRow } = await supabase
      .from('ads_groups_with_status')
      .select('status, diff_count')
      .eq('vector_group', vector_group)
      .eq('business_id', businessId)
      .maybeSingle();

    const groupStatus = statusRow?.status as 'New' | 'Scaling' | 'Inactive' | undefined;
    const groupDiffCount = statusRow?.diff_count ?? null;

    const items = await Promise.all((data || []).map(async (ad: any) => {
      return {
        id: ad.ad_archive_id,
        ad_archive_id: ad.ad_archive_id,
        page_name: ad.page_name,
        ad_text: ad.text ?? null,
        caption: ad.caption ?? null,
        url: ad.url ?? null,
        competitor_niche: ad.competitor_niche ?? null,
        display_format: ad.display_format,
        created_at: new Date().toISOString(),
        vector_group: ad.vector_group,
        start_date_formatted: ad.start_date_formatted ?? undefined,
        end_date_formatted: ad.end_date_formatted ?? undefined,
        duplicates_count: groupRow?.items ?? ad.duplicates_count,
        status: groupStatus,
        diff_count: groupDiffCount,
        meta_ad_url: `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`,
        image_url: await getCreativeUrl(ad.ad_archive_id, businessSlug),
      };
    }));

    return NextResponse.json({ items, nextCursor: null, hasMore: false }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
