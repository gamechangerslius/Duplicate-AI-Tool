import { fetchAdByArchiveId, fetchRelatedAds, getImageUrl } from '@/lib/db';
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

  const imageUrl = getImageUrl(ad.ad_archive_id);

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

        {relatedAds.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">
              Related Ads ({relatedAds.length})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {relatedAds.map((relatedAd) => (
                <a
                  key={relatedAd.id}
                  href={relatedAd.meta_ad_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group"
                >
                  <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden">
                    <div className="relative aspect-square bg-slate-100">
                      <Image
                        src={getImageUrl(relatedAd.ad_archive_id)}
                        alt={relatedAd.title || relatedAd.page_name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        unoptimized
                      />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {ad.vector_group === -1 && (
          <div className="text-center py-8 text-slate-500">
            <p>This is a unique creative with no duplicates</p>
          </div>
        )}
      </div>
    </div>
  );
}
