import { type Ad } from '@/lib/types';
import Image from 'next/image';

interface AdCardProps {
  ad: Ad;
}

export function AdCard({ ad }: AdCardProps) {
  const isVideo = ad.display_format === 'VIDEO';
  // Prefer public storage_path when available, otherwise fall back to image_url
  const publicBase = process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/creatives/` : '';
  const imageUrl = ad.image_url || '';
  const isNewGroup = !!ad.group_created_at && (Date.now() - new Date(ad.group_created_at).getTime() <= 24 * 60 * 60 * 1000);
  const newCount = ad.new_count || 0;

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
          <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M5 3v18l15-9L5 3z" fill="currentColor" />
            </svg>
            <span className="font-semibold tracking-tight">Video</span>
          </div>
        )}
        {isNewGroup && (
          <div className="absolute top-3 left-3 bg-emerald-600 text-white text-xs px-2 py-1 rounded-full font-semibold shadow-sm">
            NEW + {newCount}
          </div>
        )}
        {ad.duplicates_count && ad.duplicates_count > 0 && (
          <div className={`absolute ${isNewGroup ? 'top-14' : 'top-2'} left-3 bg-violet-600 text-white text-xs px-2 py-1 rounded-full font-medium z-20`}>
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
              <p className="text-xs text-blue-600 truncate">First seen: {ad.start_date_formatted}</p>
            )}
            {ad.end_date_formatted && (
              <p className="text-xs text-blue-600 truncate">Last seen: {ad.end_date_formatted}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
