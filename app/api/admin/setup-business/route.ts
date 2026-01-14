import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isUserAdmin } from '@/utils/supabase/admin';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { businessId } = body;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const userIsAdmin = await isUserAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ message: 'Forbidden: Admin only' }, { status: 403 });
    }

    // Verify business exists
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id, name, slug')
      .eq('id', businessId)
      .single();

    if (bizError || !business) {
      return NextResponse.json({ message: 'Business not found' }, { status: 404 });
    }

    console.log(`🚀 Admin setup initiated for business:`, business.name || business.slug);

    // In the future, this endpoint can:
    // 1. Check for stored setup tasks/links in database
    // 2. Run Apify scraping with those stored links
    // 3. Store results in database
    // For now, just return success with business info

    return NextResponse.json({
      message: `Setup process initiated for ${business.name || business.slug}`,
      businessId: business.id,
      businessName: business.name,
      businessSlug: business.slug,
      timestamp: new Date().toISOString(),
    }, { status: 200 });

  } catch (err: any) {
    console.error('Admin setup error:', err);
    return NextResponse.json(
      { message: err.message || 'Setup failed' },
      { status: 500 }
    );
  }
}
