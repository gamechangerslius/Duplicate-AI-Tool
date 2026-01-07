export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getImageUrl } from '@/utils/supabase/db';

const HEADWAY_TABLE = 'duplicate_2data_base_blinkist';
const HOLYWATER_TABLE = 'data_base';
const HEADWAY_BUCKET = 'blinkist2';
const HOLYWATER_BUCKET = 'test2';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vgParam = searchParams.get('vector_group');
    const lastId = searchParams.get('last_id');
    const limitParam = searchParams.get('limit');
    const currentId = searchParams.get('current_id');
    const tableParam = searchParams.get('table');

    if (!vgParam) {
      return NextResponse.json({ error: 'vector_group is required' }, { status: 400 });
    }
    const vector_group = Number(vgParam);
    const limit = Math.min(Math.max(Number(limitParam || '60'), 1), 500);
    const table = tableParam === HEADWAY_TABLE ? HEADWAY_TABLE : (tableParam === HOLYWATER_TABLE ? HOLYWATER_TABLE : HOLYWATER_TABLE);
    const bucket = table === HEADWAY_TABLE ? HEADWAY_BUCKET : HOLYWATER_BUCKET;

    let q = supabase
      .from(table)
      .select('ad_archive_id, title, page_name, text, caption, display_format, vector_group, url')
      .eq('vector_group', vector_group)
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

    const items = (data || []).map((ad) => ({
      id: ad.ad_archive_id,
      ad_archive_id: ad.ad_archive_id,
      title: ad.title,
      page_name: ad.page_name,
      ad_text: (ad as any).text ?? null,
      caption: (ad as any).caption ?? null,
      url: (ad as any).url ?? null,
      display_format: ad.display_format,
      created_at: new Date().toISOString(),
      vector_group: ad.vector_group,
      meta_ad_url: `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`,
      image_url: getImageUrl(ad.ad_archive_id, bucket),
    }));

    const nextCursor = items.length > 0 ? items[items.length - 1].ad_archive_id : null;
    const hasMore = items.length === limit;

    return NextResponse.json({ items, nextCursor, hasMore }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
