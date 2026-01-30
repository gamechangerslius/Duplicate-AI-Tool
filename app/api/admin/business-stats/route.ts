import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Node runtime for DB work
export const runtime = 'edge';

const cache = new Map<string, { min: number; max: number; time: number }>();
const TTL = 60 * 1000; // 1 minute

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const businessId = url.searchParams.get('businessId');
    if (!businessId) return NextResponse.json({ message: 'Missing businessId' }, { status: 400 });

    // Try Supabase-backed cache table first (if exists)
    try {
      const { data: cachedRow, error: cacheErr } = await supabase.from('business_stats_cache').select('min,max,updated_at').eq('business_id', businessId).maybeSingle();
      if (!cacheErr && cachedRow && cachedRow.updated_at) {
        const ts = new Date(cachedRow.updated_at).getTime();
        if (Date.now() - ts < TTL) {
          return NextResponse.json({ min: Number(cachedRow.min), max: Number(cachedRow.max) });
        }
      }
    } catch (e) {
      // table may not exist or permission errors; fall back to in-memory cache
    }

    // Return cached value if fresh (in-memory fallback)
    const cached = cache.get(businessId);
    if (cached && Date.now() - cached.time < TTL) {
      return NextResponse.json({ min: cached.min, max: cached.max });
    }

    // Efficient min/max using ordered limits
    const { data: maxRow, error: maxErr } = await supabase.from('ads_groups_test').select('items').eq('business_id', businessId).order('items', { ascending: false }).limit(1).maybeSingle();
    const { data: minRow, error: minErr } = await supabase.from('ads_groups_test').select('items').eq('business_id', businessId).order('items', { ascending: true }).limit(1).maybeSingle();

    if (maxErr || minErr) {
      console.error('business-stats error', maxErr || minErr);
      return NextResponse.json({ min: 0, max: 0 }, { status: 500 });
    }

    const max = maxRow && typeof maxRow.items !== 'undefined' && maxRow.items !== null ? Number(maxRow.items) : 0;
    const min = minRow && typeof minRow.items !== 'undefined' && minRow.items !== null ? Number(minRow.items) : 0;

    // Try upserting result to Supabase cache table (best-effort)
    try {
      await supabase.from('business_stats_cache').upsert({ business_id: businessId, min, max, updated_at: new Date().toISOString() });
    } catch (e) {
      // ignore; keep in-memory cache
    }

    cache.set(businessId, { min, max, time: Date.now() });
    return NextResponse.json({ min, max });
  } catch (err) {
    console.error('business-stats GET error', err);
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
