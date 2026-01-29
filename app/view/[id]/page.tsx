export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { fetchAdByArchiveId, fetchRelatedAds, fetchGroupRepresentative, getImageUrl } from '@/utils/supabase/db';
import { RelatedAdsGrid } from '@/components/RelatedAdsGrid';
import { GroupMetadata } from '@/components/GroupMetadata';
import MediaDownload from '@/components/MediaDownload';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ViewDetailsPage({ params, searchParams: searchParamsPromise }: PageProps) {
  const { id: adArchiveId } = await params;
  const searchParams = await searchParamsPromise;
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  let businessId: string | null = null;
  if (typeof searchParams?.businessId === 'string') {
    businessId = searchParams.businessId;
  } else {
    const { data: businesses } = await supabase.from('businesses').select('id, slug').eq('owner_id', user.id);
    if (!businesses?.length) notFound();
    businessId = businesses[0].id;
  }

  const { data: business } = await supabase.from('businesses').select('id, slug').eq('id', businessId).single();
  if (!business) notFound();

  const ad = await fetchAdByArchiveId(adArchiveId, business.id);
  if (!ad) notFound();

  const hasGroup = ad.vector_group !== -1 && ad.vector_group !== null;
  const [relatedAds, representative] = await Promise.all([
    hasGroup ? fetchRelatedAds(ad.vector_group as number, ad.ad_archive_id, business.id) : Promise.resolve([]),
    hasGroup ? fetchGroupRepresentative(ad.vector_group as number, business.id) : Promise.resolve(null),
  ]);

  const imageUrl = ad.image_url ?? await getImageUrl(ad.ad_archive_id, business.slug);
  const representativeImageUrl = representative ? (representative.image_url ?? await getImageUrl(representative.ad_archive_id, business.slug)) : null;
  // Build video URLs directly from stored storage path (which already includes business slug)
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/creatives/` : null;
  const representativeVideoUrl = representative && representative.video_storage_path && publicBase
    ? `${publicBase}${representative.video_storage_path}`
    : null;

  // Main ad video URL (if stored)
  const videoUrl = ad.video_storage_path && publicBase ? `${publicBase}${ad.video_storage_path}` : null;
  // Check if video is actually accessible (HEAD) to avoid broken players; fallback to image if not
  let videoAvailable = false;
  let videoCheckWarn = false;
  if (videoUrl) {
    try {
      const headRes = await fetch(videoUrl, { method: 'HEAD' });
      if (headRes.ok) {
        const ct = headRes.headers.get('content-type') || '';
        if (ct.startsWith('video/')) videoAvailable = true;
        else videoAvailable = true; // allow even if content-type missing
      } else {
        videoCheckWarn = true;
      }
    } catch (e) {
      videoCheckWarn = true;
    }
  }
  const groupSize = ad.duplicates_count || (hasGroup ? relatedAds.length + 1 : 1);

  // Get return URL from searchParams
  const returnUrl = typeof searchParams?.returnTo === 'string' ? searchParams.returnTo : '/';

  // Data processing for breakdowns
  const groupMembersMap = new Map();
  groupMembersMap.set(ad.ad_archive_id, ad);
  relatedAds.forEach(m => groupMembersMap.set(m.ad_archive_id, m));
  if (representative) groupMembersMap.set(representative.ad_archive_id, representative);
  const groupMembers = Array.from(groupMembersMap.values());

  const pageBreakdown = groupMembers.reduce((acc, m) => {
    const key = m.page_name || 'Unknown';
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  return (
    <div className="min-h-screen bg-white text-zinc-900 selection:bg-zinc-100">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        
        {/* Navigation */}
        <header className="mb-10 flex items-center justify-between">
          <Link href={returnUrl} className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 hover:text-zinc-900 transition-colors">
            ← Gallery
          </Link>
          <div className="flex gap-3">
            <a href={`https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`} target="_blank" className="h-9 px-4 bg-zinc-900 text-white rounded-lg flex items-center text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all">
              Meta Library
            </a>
            {/* Client-side automatic download component */}
            <MediaDownload
              imageUrl={imageUrl}
              videoUrl={videoUrl}
              imageName={`${ad.ad_archive_id}.jpg`}
              videoName={`${ad.ad_archive_id}.mp4`}
              videoAvailable={videoAvailable}
            />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Media & Core Info */}
          <div className="lg:col-span-7 space-y-10">
            <section className="relative aspect-video bg-zinc-50 rounded-2xl overflow-hidden border border-zinc-100">
              {videoUrl && videoAvailable ? (
                <video src={videoUrl} controls className="h-full w-full object-contain" />
              ) : (
                imageUrl && <Image src={imageUrl} alt={ad.title || ""} fill className="object-contain" unoptimized />
              )}
              {videoUrl && videoCheckWarn && (
                <div className="absolute top-4 right-4 bg-yellow-50 text-yellow-800 px-3 py-1 rounded-md text-sm font-semibold">Video not available — showing image</div>
              )}
            </section>

            <section className="space-y-6">
              <div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{ad.page_name}</span>
                <h1 className="text-3xl font-bold tracking-tight mt-1">{ad.title || 'Untitled Campaign'}</h1>
              </div>

              {ad.concept && (
                <div className="p-6 bg-zinc-50 rounded-2xl border border-zinc-100 text-zinc-700 text-sm leading-relaxed">
                  <span className="not-italic font-black text-[9px] uppercase tracking-widest text-zinc-400 block mb-2">Concept</span>
                  &quot;{ad.concept}&quot;
                </div>
              )}
              {ad.ai_description && (
                <div className="p-6 bg-zinc-50 rounded-2xl border border-zinc-100 italic text-zinc-600 text-sm leading-relaxed">
                  <span className="not-italic font-black text-[9px] uppercase tracking-widest text-zinc-400 block mb-2">AI Analysis</span>
                  &quot;{ad.ai_description}&quot;
                </div>
              )}
            </section>

            {/* Current Metadata - Minimalist Grid */}
            <section className="pt-10 border-t border-zinc-100">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-6">Technical Metadata</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {Object.entries((ad as any)?.raw || ad)
                  .filter(([k, v]) => !/^embedding/i.test(k) && v !== null && typeof v !== 'object')
                  .map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1 py-2 border-b border-zinc-50">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-tighter">{key}</span>
                      <span className="text-xs font-medium text-zinc-900 truncate" title={String(value)}>{String(value)}</span>
                    </div>
                  ))}
              </div>
            </section>
          </div>

          {/* Right Column: Group Analysis & Related */}
          <div className="lg:col-span-5 space-y-12">
            
            {/* Group Status Card */}
            <section className="p-8 bg-zinc-50 rounded-[32px] border border-zinc-100 space-y-6">
              <div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-4">Group Intelligence</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white rounded-2xl border border-zinc-100">
                    <span className="block text-[9px] font-black text-zinc-300 uppercase mb-1">Scale</span>
                    <span className="text-xl font-bold">{groupSize} <span className="text-xs font-medium text-zinc-400">Ads</span></span>
                  </div>
                  <div className="p-4 bg-white rounded-2xl border border-zinc-100">
                    <span className="block text-[9px] font-black text-zinc-300 uppercase mb-1">Group ID</span>
                    <span className="text-xl font-bold tabular-nums">#{ad.vector_group || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Page Breakdown Visualization */}
                  {pageBreakdown.size > 0 && (
                <div className="space-y-3">
                  <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Distribution by Page</span>
                  <div className="space-y-2">
                    {Array.from((pageBreakdown as Map<string, number>).entries()).map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between text-xs">
                        <span className="font-bold text-zinc-700">{name}</span>
                        <span className="px-2 py-0.5 bg-zinc-200 rounded text-[10px] font-black">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Representative Preview */}
            {representative && (
              <section className="space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Representative</h3>
                <div className="group flex items-center gap-4 p-4 bg-white border border-zinc-100 rounded-2xl hover:border-zinc-300 transition-all">
                  <div className="relative h-16 w-16 rounded-xl overflow-hidden bg-zinc-50 flex items-center justify-center">
                    {representativeVideoUrl ? (
                      <video src={representativeVideoUrl} controls className="h-full w-full object-cover" />
                    ) : (
                      <Image src={representativeImageUrl || ''} alt="" fill className="object-cover" unoptimized />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-zinc-900 truncate">{representative.title || 'Untitled'}</p>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-tighter mt-0.5">{representative.page_name}</p>
                  </div>
                </div>
              </section>
            )}

            {/* Additional Creatives Grid */}
            <GroupMetadata vectorGroup={ad.vector_group} businessId={businessId} />
          </div>
        </div>

        {/* Related Ads - Full Width Section */}
        {relatedAds.length > 0 && (
          <section className="mt-24 pt-16 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-10">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">Related Creatives</h2>
              <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">{relatedAds.length} units detected</span>
            </div>
            <RelatedAdsGrid 
              ads={relatedAds} 
              groupSize={groupSize} 
              vectorGroup={ad.vector_group as number} 
              currentAdArchiveId={ad.ad_archive_id} 
              businessId={business.id} 
              businessSlug={business.slug}
              searchParams={searchParams}
            />
          </section>
        )}

      </div>
    </div>
  );
}