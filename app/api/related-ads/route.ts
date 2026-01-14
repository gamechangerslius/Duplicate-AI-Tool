export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getImageUrl, getBusinessSlug, getGroupDateRange, getEffectiveTitle } from '@/utils/supabase/db';

const ADS_TABLE = 'ads';

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

    let q = supabase
      .from(ADS_TABLE)
      .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group, url, competitor_niche, start_date_formatted, end_date_formatted, duplicates_count, cards_json')
      .eq('vector_group', vector_group)
      .eq('business_id', businessId)
      .order('ad_archive_id', { ascending: true })
      .limit(limit);

    if (currentId) {
      q = q.neq('ad_archive_id', currentId);
    }
    if (lastId) {
      q = q.gt('ad_archive_id', lastId);
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    // Get group dates once for all ads
    const groupDates = await getGroupDateRange(vector_group);

    const items = (data || []).map((ad: any) => {
      const effectiveTitle = getEffectiveTitle(ad.title, ad.cards_json, { 
        caption: ad.caption, 
        text: ad.text 
      });
      
      return {
        id: ad.ad_archive_id,
        ad_archive_id: ad.ad_archive_id,
        title: effectiveTitle,
        page_name: ad.page_name,
        ad_text: ad.text ?? null,
        caption: ad.caption ?? null,
        url: ad.url ?? null,
        competitor_niche: ad.competitor_niche ?? null,
        display_format: ad.display_format,
        created_at: new Date().toISOString(),
        vector_group: ad.vector_group,
        start_date_formatted: ad.start_date_formatted ?? groupDates.minStartDate ?? undefined,
        end_date_formatted: ad.end_date_formatted ?? groupDates.maxEndDate ?? undefined,
        duplicates_count: ad.duplicates_count,
        meta_ad_url: `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`,
        image_url: getImageUrl(ad.ad_archive_id, businessSlug),
      };
    });

    const nextCursor = items.length > 0 ? items[items.length - 1].ad_archive_id : null;
    const hasMore = items.length === limit;

    return NextResponse.json({ items, nextCursor, hasMore }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
