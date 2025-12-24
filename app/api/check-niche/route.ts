import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Check for passion records
    const { data: passionData, error: passionError } = await supabase
      .from('data_base')
      .select('ad_archive_id, competitor_niche, page_name')
      .eq('competitor_niche', 'passion')
      .limit(10);

    // Check for drama records
    const { data: dramaData, error: dramaError } = await supabase
      .from('data_base')
      .select('ad_archive_id, competitor_niche, page_name')
      .eq('competitor_niche', 'drama')
      .limit(10);

    // Get all unique competitor_niche values
    const { data: allNiches, error: allError } = await supabase
      .from('data_base')
      .select('competitor_niche')
      .not('competitor_niche', 'is', null)
      .limit(1000);

    const uniqueNiches = allNiches 
      ? Array.from(new Set(allNiches.map(row => row.competitor_niche)))
      : [];

    return NextResponse.json({
      passion: {
        count: passionData?.length || 0,
        error: passionError?.message,
        sample: passionData?.slice(0, 3),
      },
      drama: {
        count: dramaData?.length || 0,
        error: dramaError?.message,
        sample: dramaData?.slice(0, 3),
      },
      allUniqueNiches: uniqueNiches,
    });
  } catch (error) {
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
