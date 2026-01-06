import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  console.log('🔵 API called: /api/group_date_range');
  
  const { searchParams } = new URL(request.url);
  const vectorGroup = searchParams.get('vector_group');
  const table = searchParams.get('table') || 'duplicate_2data_base_blinkist';

  console.log('📥 Parameters:', { vectorGroup, table });

  // Validate vector_group parameter
  if (!vectorGroup) {
    console.log('❌ Missing vector_group');
    return NextResponse.json(
      { error: 'Missing required parameter: vector_group' },
      { status: 400 }
    );
  }

  const groupId = parseInt(vectorGroup, 10);
  if (isNaN(groupId)) {
    console.log('❌ Invalid vector_group:', vectorGroup);
    return NextResponse.json(
      { error: 'Invalid vector_group: must be a number' },
      { status: 400 }
    );
  }

  // Validate table parameter
  const validTables = ['data_base', 'duplicate_2data_base_blinkist'];
  if (!validTables.includes(table)) {
    console.log('❌ Invalid table:', table);
    return NextResponse.json(
      { error: `Invalid table: must be one of ${validTables.join(', ')}` },
      { status: 400 }
    );
  }

  console.log('✅ Validation passed, calling RPC...');

  try {
    const { data, error } = await supabase.rpc('get_group_date_range', {
      target_table: table,
      group_id: groupId,
    });

    console.log('📤 RPC Response:', { data, error });

    if (error) {
      console.error('❌ RPC Error:', error);
      return NextResponse.json(
        { 
          error: `Database error: ${error.message}`,
          details: error.details,
          hint: error.hint,
          code: error.code 
        },
        { status: 500 }
      );
    }

    // Handle empty results
    if (!data || data.length === 0) {
      console.log('ℹ️  No data found, returning null');
      return NextResponse.json(null);
    }

    console.log('✅ Success, returning data:', data[0]);
    return NextResponse.json(data[0]);
  } catch (err) {
    console.error('💥 Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: String(err) },
      { status: 500 }
    );
  }
}