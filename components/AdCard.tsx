import { type Ad } from '@/lib/types';
import { getImageUrl } from '@/lib/db';
import Image from 'next/image';

interface AdCardProps {
  ad: Ad;
}

export function AdCard({ ad }: AdCardProps) {
  const isVideo = ad.display_format === 'VIDEO';
  const imageUrl = ad.image_url || getImageUrl(ad.ad_archive_id);

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden cursor-pointer">
      <div className="relative aspect-video bg-slate-100">
        <Image
          src={imageUrl}
          alt={ad.title || ad.page_name}
          fill
          className="object-cover"
          unoptimized
        />
        {isVideo && (
          <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
            VIDEO
          </div>
        )}
        {ad.duplicates_count && ad.duplicates_count > 0 && (
          <div className="absolute top-2 left-2 bg-violet-600 text-white text-xs px-2 py-1 rounded-full font-medium">
            {ad.duplicates_count} duplicates
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-slate-900 text-sm mb-1 truncate">
          {ad.title || 'Untitled'}
        </h3>
        <p className="text-xs text-slate-500 truncate">{ad.page_name}</p>
      </div>
    </div>
  );
}
