import { NextResponse } from 'next/server';
import { getGroupMetadata } from '../../../utils/supabase/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vectorGroup = searchParams.get('vectorGroup');
    const businessId = searchParams.get('businessId');

    if (!vectorGroup || !businessId) {
      return NextResponse.json(
        { error: 'Missing required parameters: vectorGroup, businessId' },
        { status: 400 }
      );
    }

    const groupId = parseInt(vectorGroup, 10);
    if (isNaN(groupId)) {
      return NextResponse.json(
        { error: 'Invalid vectorGroup: must be a number' },
        { status: 400 }
      );
    }

    const metadata = await getGroupMetadata(groupId, businessId);

    if (!metadata) {
      return NextResponse.json(
        { error: 'Failed to fetch group metadata' },
        { status: 404 }
      );
    }

    return NextResponse.json(metadata);
  } catch (err: any) {
    console.error('Error in group metadata API:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
