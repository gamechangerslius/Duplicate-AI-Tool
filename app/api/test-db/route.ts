import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Simple health check - just test if we can connect
    const { data, error } = await supabase
      .from('duplicate_2data_base_blinkist')
      .select('*')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 is "no rows returned" - means connection works but table is empty
      return NextResponse.json(
        { 
          success: false, 
          message: 'Database connection failed',
          error: error.message,
          code: error.code
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Database connected successfully',
      hasData: !!data,
      fields: data ? Object.keys(data) : [],
      sampleData: data,
    });
  } catch (error) {
    return NextResponse.json(
      { 
        success: false, 
        message: 'Connection error',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
