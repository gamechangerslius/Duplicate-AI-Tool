import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const vgParam = url.searchParams.get('vector_group');
    const adArchiveId = url.searchParams.get('ad_archive_id');
    const businessId = url.searchParams.get('business_id');

    if (!vgParam) return NextResponse.json({ error: 'vector_group query param required' }, { status: 400 });
    const vector_group = Number(vgParam);

    const supabase = await createClient();

    // 1) authoritative count via head:true
    let countQuery = supabase
      .from('ads')
      .select('ad_archive_id', { head: true, count: 'exact' })
      .eq('vector_group', vector_group);
    if (businessId) countQuery = countQuery.eq('business_id', businessId);
    const countRes = await countQuery;
    const authoritativeCount = (countRes && (countRes as any).count) ?? null;

    // 2) fetch actual rows from ads for inspection
    let adsQuery = supabase
      .from('ads')
      .select('*')
      .eq('vector_group', vector_group)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (businessId) adsQuery = adsQuery.eq('business_id', businessId);
    const { data: adsRows, error: adsErr } = await adsQuery;

    // 3) fetch group row from ads_groups_test
    const { data: groupRow } = await supabase
      .from('ads_groups_test')
      .select('*')
      .eq('vector_group', vector_group)
      .maybeSingle();

    // 4) fetch status/view row
    const { data: statusRow } = await supabase
      .from('ads_groups_with_status')
      .select('*')
      .eq('vector_group', vector_group)
      .maybeSingle();

    return NextResponse.json({
      vector_group,
      ad_archive_id: adArchiveId,
      business_id: businessId,
      authoritativeCount,
      adsError: adsErr || null,
      adsRows: (adsRows || []).slice(0, 200),
      adsRowsLength: (adsRows || []).length,
      groupRow: groupRow || null,
      statusRow: statusRow || null,
    });
  } catch (err) {
    console.error('group-inspect error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
