import { fetchAdByArchiveId, fetchRelatedAds, fetchGroupRepresentative, fetchAdRawByArchiveId, fetchGroupRepresentativeRaw, getImageUrl } from '@/lib/db';
import { RelatedAdsGrid } from '@/components/RelatedAdsGrid';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ViewDetailsPage({ params }: PageProps) {
  const { id: adArchiveId } = await params;
  const ad = await fetchAdByArchiveId(adArchiveId);

  if (!ad) {
    notFound();
  }

  const relatedAds = ad.vector_group && ad.vector_group !== -1
    ? await fetchRelatedAds(ad.vector_group, ad.ad_archive_id)
    : [];

  const representative = ad.vector_group && ad.vector_group !== -1
    ? await fetchGroupRepresentative(ad.vector_group)
    : null;

  const imageUrl = getImageUrl(ad.ad_archive_id);

  // Fetch full DB rows (all columns) for current ad and representative
  const adRaw = await fetchAdRawByArchiveId(ad.ad_archive_id);
  const representativeRaw = ad.vector_group && ad.vector_group !== -1
    ? await fetchGroupRepresentativeRaw(ad.vector_group)
    : null;

  const groupSize = ad.vector_group && ad.vector_group !== -1
    ? relatedAds.length + 1
    : 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-6 py-12 max-w-5xl">
        <Link 
          href="/" 
          className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-6"
        >
          ← Back to Gallery
        </Link>

        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
          <div className="relative aspect-video bg-slate-100">
            <Image
              src={imageUrl}
              alt={ad.title || ad.page_name}
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="p-6">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              {ad.title || 'Untitled'}
            </h1>
            <p className="text-slate-600 mb-4">{ad.page_name}</p>
            
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
          </div>
        </div>

        {representative && (
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Group Representative</h2>
            <div className="bg-white rounded-xl p-4 shadow-md">
              <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 rounded-md overflow-hidden bg-slate-100">
                  <Image
                    src={getImageUrl(representative.ad_archive_id)}
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
                </div>
              </div>
            </div>

            {/* Representative DB Data (excluding embedding_vec) */}
            {representativeRaw && (
              <div className="mt-4 bg-white rounded-xl p-4 shadow-sm">
                <h3 className="text-slate-900 font-semibold mb-3">Representative DB Data</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {Object.entries(representativeRaw)
                    .filter(([key]) => key !== 'embedding_vec')
                    .map(([key, value]) => (
                      <div key={key} className="contents">
                        <div className="text-slate-500 break-words">{key}</div>
                        <div className="max-h-32 overflow-y-auto border border-slate-200 rounded p-2 text-slate-900">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {relatedAds.length > 0 && (
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">
              Related Ads ({relatedAds.length})
            </h2>
            <RelatedAdsGrid ads={relatedAds} groupSize={groupSize} />
          </div>
        )}

      </div>
    </div>
  );
}
