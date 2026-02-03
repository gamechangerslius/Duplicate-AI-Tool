"use client";

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAdByArchiveId } from '@/hooks/useAdByArchiveId';
import { useRelatedAds } from '@/hooks/useRelatedAds';
import { useGroupRepresentative } from '@/hooks/useGroupRepresentative';
import { RelatedAdsGrid } from '@/components/RelatedAdsGrid';
import { GroupMetadata } from '@/components/GroupMetadata';
import MediaDownload from '@/components/MediaDownload';
import Image from 'next/image';
import Link from 'next/link';

export default function ViewDetailsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const adArchiveId = params?.id as string;
  const businessId = (searchParams.get('businessId') as string) || '';
  const businessSlug = (searchParams.get('businessSlug') as string) || '';
  const returnUrl = searchParams.get('returnTo') || '/';

  // Compose returnUrl with filters
  const filterParams = new URLSearchParams(searchParams as any).toString();
  const returnUrlWithFilters = filterParams ? `/?${filterParams}` : "/";

  // Main ad
  const { data: ad, isLoading: adLoading, error: adError } = useAdByArchiveId(adArchiveId, businessId);
  // Related ads
  const hasGroup = ad && ad.vector_group !== -1 && ad.vector_group !== null;
  const { data: relatedAds = [] } = useRelatedAds(
    hasGroup && ad.vector_group !== null ? ad.vector_group : undefined,
    adArchiveId,
    businessId
  );
  // Representative
  const { data: representative } = useGroupRepresentative(
    hasGroup && ad.vector_group !== null ? ad.vector_group : undefined,
    businessId
  );

  // Media URLs
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/creatives/` : null;
  const imageUrl = ad?.image_url;
  const representativeImageUrl = representative?.image_url;
  const representativeVideoUrl = representative && representative.video_storage_path && publicBase
    ? `${publicBase}${representative.video_storage_path}`
    : null;
  const videoUrl = ad?.video_storage_path && publicBase ? `${publicBase}${ad.video_storage_path}` : null;

  // Video check (client only)
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [videoCheckWarn, setVideoCheckWarn] = useState(false);
  useEffect(() => {
    let ignore = false;
    if (videoUrl) {
      fetch(videoUrl, { method: 'HEAD' })
        .then(res => {
          if (!ignore) setVideoAvailable(res.ok);
        })
        .catch(() => { if (!ignore) setVideoCheckWarn(true); });
    }
    return () => { ignore = true; };
  }, [videoUrl]);

  // Group size
  const groupSize = useMemo(() => {
    if (!ad) return 1;
    if (typeof (ad as any).items === 'number') return (ad as any).items;
    if (ad.duplicates_count) return ad.duplicates_count;
    if (hasGroup) return (relatedAds?.length || 0) + 1;
    return 1;
  }, [ad, relatedAds, hasGroup]);

  // Group members breakdown
  const groupMembersMapMemo = useMemo(() => {
    const map = new Map();
    if (ad) map.set(ad.ad_archive_id, ad);
    (relatedAds || []).forEach((m: any) => map.set(m.ad_archive_id, m));
    if (representative) map.set(representative.ad_archive_id, representative);
    return map;
  }, [ad, relatedAds, representative]);
  const groupMembers = Array.from(groupMembersMapMemo.values());
  const pageBreakdown = groupMembers.reduce((acc, m) => {
    const key = m.page_name || 'Unknown';
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  // Convert searchParams to plain object for RelatedAdsGrid
  const searchParamsObj: Record<string, string | string[] | undefined> = {};
  searchParams.forEach((value, key) => {
    if (searchParamsObj[key]) {
      if (Array.isArray(searchParamsObj[key])) {
        (searchParamsObj[key] as string[]).push(value);
      } else {
        searchParamsObj[key] = [searchParamsObj[key] as string, value];
      }
    } else {
      searchParamsObj[key] = value;
    }
  });

  if (adLoading) return <div className="p-10 text-center">Loading...</div>;
  if (adError || !ad) return <div className="p-10 text-center text-red-500">Ad not found or error loading ad.</div>;


  return (
    <div className="min-h-screen bg-white text-zinc-900 selection:bg-zinc-100">
      <div className="max-w-screen-xl mx-auto px-6 py-8">
        
        {/* Navigation */}
        <header className="mb-10 flex items-center justify-between">
          <Link href={returnUrlWithFilters} className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 hover:text-zinc-900 transition-colors">
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
                imageUrl ? <Image src={imageUrl} alt={ad.title || ""} fill className="object-contain" unoptimized /> : null
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
                    {(() => { console.log('representativeImageUrl', representativeImageUrl); return null; })()}
                    {representativeVideoUrl ? (
                      <video src={representativeVideoUrl} controls className="h-full w-full object-cover" />
                    ) : (
                      representativeImageUrl ? <Image src={representativeImageUrl} alt="" fill className="object-cover" unoptimized /> : null
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
              businessId={businessId} 
              businessSlug={businessSlug}
              searchParams={searchParamsObj}
            />
          </section>
        )}

      </div>
    </div>
  );
}