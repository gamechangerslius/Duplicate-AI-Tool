import { type Ad } from '@/lib/types';
import Image from 'next/image';

interface AdCardProps {
  ad: Ad;
}

export function AdCard({ ad }: AdCardProps) {
  const isVideo = ad.display_format === 'VIDEO';
  // image_url should already be set from server, no fallback needed
  const imageUrl = ad.image_url || '';

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden cursor-pointer h-full flex flex-col">
      <div className="relative aspect-video bg-slate-100 flex-shrink-0">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={ad.title || ad.page_name}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            No Image
          </div>
        )}
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
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="font-semibold text-slate-900 text-sm mb-1 line-clamp-2 min-h-[2.5rem]">
          {ad.title || 'Untitled'}
        </h3>
        <p className="text-xs text-slate-500 truncate mb-1">{ad.page_name}</p>
        {ad.competitor_niche && (
          <p className="text-xs text-purple-600 truncate mb-2">📂 {ad.competitor_niche}</p>
        )}
        {(ad.start_date_formatted || ad.end_date_formatted) && (
          <div className="mt-auto pt-2 border-t border-slate-200">
            {ad.start_date_formatted && (
              <p className="text-xs text-blue-600 truncate">Start: {ad.start_date_formatted}</p>
            )}
            {ad.end_date_formatted && (
              <p className="text-xs text-blue-600 truncate">End: {ad.end_date_formatted}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
