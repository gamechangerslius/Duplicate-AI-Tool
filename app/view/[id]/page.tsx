export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { fetchAdByArchiveId, fetchRelatedAds, fetchGroupRepresentative, getImageUrl } from '@/utils/supabase/db';
import { RelatedAdsGrid } from '@/components/RelatedAdsGrid';
import { GroupMetadata } from '@/components/GroupMetadata';
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
  
  // Get user's business
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    notFound();
  }

  // Get businessId from URL params or use first business
  let businessId: string | null = null;
  if (typeof searchParams?.businessId === 'string') {
    businessId = searchParams.businessId;
  } else {
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, slug')
      .eq('owner_id', user.id);
    
    if (!businesses || businesses.length === 0) {
      notFound();
    }
    businessId = businesses[0].id;
  }

  // Get business details
  const { data: business } = await supabase
    .from('businesses')
    .select('id, slug')
    .eq('id', businessId)
    .single();

  if (!business) {
    notFound();
  }

  const ad = await fetchAdByArchiveId(adArchiveId, business.id);

  if (!ad) {
    notFound();
  }

  const hasGroup = ad.vector_group !== -1 && ad.vector_group !== null && ad.vector_group !== undefined;

  // Parallelize all remaining queries
  const [relatedAds, representative] = await Promise.all([
    hasGroup ? fetchRelatedAds(ad.vector_group as number, ad.ad_archive_id, business.id) : Promise.resolve([]),
    hasGroup ? fetchGroupRepresentative(ad.vector_group as number, business.id) : Promise.resolve(null),
  ]);

  const imageUrl = ad.image_url ?? await getImageUrl(ad.ad_archive_id, business.slug);
  const representativeImageUrl = representative ? (representative.image_url ?? await getImageUrl(representative.ad_archive_id, business.slug)) : null;
  
  // Use real duplicates_count from database, fallback to calculated size
  const actualDuplicatesCount = ad.duplicates_count || (hasGroup ? relatedAds.length + 1 : 1);
  const groupSize = actualDuplicatesCount;

  // Build consolidated list of group members (current + related + representative) to derive page distribution
  const groupMembersMap = new Map<string, any>();
  groupMembersMap.set(ad.ad_archive_id, ad);
  relatedAds.forEach(member => groupMembersMap.set(member.ad_archive_id, member));
  if (representative && !groupMembersMap.has(representative.ad_archive_id)) {
    groupMembersMap.set(representative.ad_archive_id, representative);
  }
  const groupMembers = Array.from(groupMembersMap.values());
  const pageBreakdown = Array.from(
    groupMembers.reduce((acc, member) => {
      const key = member.page_name || 'Unknown';
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map<string, number>())
  ) as Array<[string, number]>;

  // Determine if multiple URLs (products) are present in the group
  const urlBreakdown = Array.from(
    groupMembers.reduce((acc, member) => {
      const key = member.url || member.page_name || 'Unknown';
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map<string, number>())
  ) as Array<[string, number]>;

  const hasMultiplePages = pageBreakdown.length > 1;
  const hasMultipleUrls = urlBreakdown.length > 1;

  // Group related ads by URL (fallback to page_name) for separate blocks when multiple products exist
  const relatedBySource = relatedAds.reduce((acc, item) => {
    const key = item.url || item.page_name || 'Unknown';
    if (!acc[key]) acc[key] = { page: item.page_name, url: item.url, items: [] as typeof relatedAds };
    acc[key].items.push(item);
    return acc;
  }, {} as Record<string, { page?: string; url?: string; items: typeof relatedAds }>);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-6 py-12 max-w-5xl">
        <Link 
          href={(() => {
            const allowed = ['businessId', 'page', 'niche', 'duplicates', 'format', 'startDate', 'endDate'];
            const params = new URLSearchParams();
            if (searchParams) {
              for (const key of allowed) {
                const v = searchParams[key];
                if (Array.isArray(v)) {
                  // preserve first occurrence for simplicity
                  if (v[0]) params.set(key, String(v[0]));
                } else if (typeof v === 'string' && v.length) {
                  params.set(key, v);
                }
              }
            }
            const qs = params.toString();
            return qs ? `/?${qs}` : '/';
          })()} 
          className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-6"
        >
          ← Back to Gallery
        </Link>

        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
          <div className="relative aspect-video bg-slate-100">
            {imageUrl && (
              <Image
                src={imageUrl}
                alt={ad.title || ad.page_name}
                fill
                className="object-contain"
                unoptimized
              />
            )}
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                  {ad.title || 'Untitled'}
                </h1>
                <p className="text-slate-600 mb-4">{ad.page_name}</p>
              </div>
              <div className="flex flex-col gap-2">
                <a
                  href={`https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition whitespace-nowrap"
                >
                  🎬 View in Meta
                </a>
                <a
                  href={`https://www.facebook.com/ads/library/`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-200 text-slate-900 text-sm hover:bg-slate-300 transition whitespace-nowrap"
                >
                  📚 Ad Library
                </a>
              </div>
            </div>
            
            {ad.vector_group === -1 && (
              <div className="inline-block bg-amber-100 text-amber-800 text-sm px-3 py-1 rounded-full">
                Unique Creative
              </div>
            )}
            {ad.duplicates_count && ad.duplicates_count > 0 && (
              <div className="inline-block bg-slate-100 text-slate-700 text-sm px-3 py-1 rounded-full ml-2">
                {ad.duplicates_count} duplicates
              </div>
            )}

            {/* Group Metadata Component */}
            <GroupMetadata vectorGroup={ad.vector_group} businessId={businessId} />
          </div>
        </div>

        {representative && (
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Group Representative</h2>
            <div className="bg-white rounded-xl p-4 shadow-md">
              <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 rounded-md overflow-hidden bg-slate-100">
                  <Image
                    src={representativeImageUrl || ''}
                    alt={representative.title || representative.page_name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-900 font-medium truncate">
                    {representative.title || 'Untitled'}
                  </div>
                  <div className="text-slate-600 text-sm truncate">
                    {representative.page_name} • Group {representative.vector_group}
                  </div>
                  <div className="text-slate-600 text-xs mt-1">
                    Duplicates in group: {groupSize}
                  </div>
                  {pageBreakdown.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-slate-700">
                      {pageBreakdown.map(([name, count]) => (
                        <span key={name} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 border border-slate-200">
                          <span className="font-medium">{name}</span>
                          <span className="text-slate-500">({count})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Representative DB Data (excluding embedding_vec) */}
            {ad.raw && (
              <div className="mt-4 bg-white rounded-xl p-4 shadow-sm">
                <h3 className="text-slate-900 font-semibold mb-3">Representative DB Data</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {Object.entries(ad.raw as Record<string, any>)
                    .filter(([key]) => !['embedding_vec_512', 'cards_json', 'cards_count', 'raw_json'].includes(key))
                    .map(([key, value]) => {
                      const isLink = typeof value === 'string' && /^https?:\/\//i.test(value);
                      const renderedValue = isLink
                        ? (
                            <a
                              href={value}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:text-blue-700 break-words"
                            >
                              {value}
                            </a>
                          )
                        : typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value);

                      return (
                        <div key={key} className="contents">
                          <div className="text-slate-500 break-words">{key}</div>
                          <div className="max-h-32 overflow-y-auto border border-slate-200 rounded p-2 text-slate-900">
                            {renderedValue}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Additional Creatives (cards_json) */}
            {ad.raw && (ad.raw as any).cards_json && (() => {
              try {
                const cards = JSON.parse((ad.raw as any).cards_json);
                if (Array.isArray(cards) && cards.length > 0) {
                  return (
                    <div className="mt-4 bg-white rounded-xl p-4 shadow-sm">
                      <h3 className="text-slate-900 font-semibold mb-3">Additional Creatives ({cards.length})</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {cards.map(async (card: any, idx: number) => {
                          const cardId = card.ad_archive_id || card.id;
                          const imageUrl = cardId ? await getImageUrl(cardId, business.slug) : null;
                          const linkUrl = card.link_url || imageUrl;
                          return linkUrl && imageUrl ? (
                            <a
                              key={idx}
                              href={linkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="relative aspect-video bg-slate-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition group"
                            >
                              <Image
                                src={imageUrl}
                                alt={`Creative ${idx + 1}`}
                                fill
                                className="object-cover"
                                unoptimized
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
                                <span className="opacity-0 group-hover:opacity-100 text-white text-sm font-medium">
                                  🔗 Open
                                </span>
                              </div>
                            </a>
                          ) : null;
                        })}
                      </div>
                    </div>
                  );
                }
              } catch (e) {
                return null;
              }
              return null;
            })()}
          </div>
        )}

        {relatedAds.length > 0 && (
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">
              Related Ads ({relatedAds.length})
            </h2>

            {hasMultiplePages || hasMultipleUrls ? (
              <div className="space-y-6">
                {Object.entries(relatedBySource).map(([key, payload]) => {
                  const p = payload as { page?: string; url?: string; items: any[] };
                  return (
                    <div key={key} className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
                      <div className="text-slate-900 font-semibold mb-3">
                        {p.page || 'Unknown'} {p.url ? `• ${p.url}` : ''} ({p.items.length})
                      </div>
                      <RelatedAdsGrid ads={p.items} groupSize={groupSize} vectorGroup={ad.vector_group as number} currentAdArchiveId={ad.ad_archive_id} businessId={business.id} businessSlug={business.slug} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <RelatedAdsGrid ads={relatedAds} groupSize={groupSize} vectorGroup={ad.vector_group as number} currentAdArchiveId={ad.ad_archive_id} businessId={business.id} businessSlug={business.slug} />
            )}
          </div>
        )}

      </div>
    </div>
  );
}
