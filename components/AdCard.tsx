import { type Ad } from '@/lib/types';
import Image from 'next/image';

interface AdCardProps {
  ad: Ad;
}

export function AdCard({ ad }: AdCardProps) {
  const isVideo = ad.display_format === 'VIDEO';
  const imageUrl = ad.image_url || '';
  const isNewGroup = !!ad.group_created_at && (Date.now() - new Date(ad.group_created_at).getTime() <= 24 * 60 * 60 * 1000);
  const newCount = ad.new_count || 0;

  return (
    <div className="group bg-white rounded-2xl border border-zinc-100 transition-all duration-500 hover:shadow-2xl hover:shadow-zinc-200/50 hover:-translate-y-1 overflow-hidden cursor-pointer h-full flex flex-col">
      
      {/* Media Section */}
      <div className="relative aspect-[4/5] bg-zinc-50 flex-shrink-0 overflow-hidden">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={ad.title || ad.page_name}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[10px] font-bold uppercase tracking-widest text-zinc-300">
            No Media
          </div>
        )}

        {/* Top Overlay Badges */}
        <div className="absolute top-3 left-3 right-3 flex justify-between items-start z-20">
          <div className="flex flex-col gap-2">
            {isNewGroup && (
              <div className="bg-zinc-950 text-white text-[9px] px-2 py-1 rounded-full font-black uppercase tracking-tighter">
                New +{newCount}
              </div>
            )}
            {ad.duplicates_count && ad.duplicates_count > 0 && (
              <div className="bg-white/90 backdrop-blur-md border border-zinc-200 text-zinc-900 text-[9px] px-2 py-1 rounded-full font-bold uppercase tracking-tighter shadow-sm">
                {ad.duplicates_count} Duplicates
              </div>
            )}
          </div>

          <div className="flex gap-1.5">
            {isVideo && (
              <div className="bg-white/90 backdrop-blur-md border border-zinc-200 p-1.5 rounded-lg shadow-sm">
                <svg className="w-3 h-3 text-zinc-900" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
            {ad.ai_description && (
              <div className="bg-white/90 backdrop-blur-md border border-zinc-200 p-1.5 rounded-lg shadow-sm" title="AI Enhanced">
                <svg className="w-3 h-3 text-zinc-900" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info Section */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] truncate">
              {ad.page_name}
            </span>
          </div>
          <h3 className="font-bold text-zinc-900 text-xs leading-snug line-clamp-2 group-hover:text-indigo-600 transition-colors">
            {ad.title || 'Untitled Campaign'}
          </h3>
        </div>

        {ad.competitor_niche && (
          <div className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-zinc-300" />
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">
              {ad.competitor_niche}
            </span>
          </div>
        )}

        {ad.ai_description && (
          <div className="border-l-2 border-zinc-100 pl-3 py-1">
            <p className="text-[11px] leading-relaxed text-zinc-500 line-clamp-2 italic">
              {ad.ai_description.replace(/^\*\*|\*\*$/g, '')}
            </p>
          </div>
        )}

        {/* Date/Status Footer */}
        <div className="mt-auto pt-3 border-t border-zinc-50 flex justify-between items-center">
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] font-black text-zinc-300 uppercase tracking-widest">Visibility</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-zinc-900 tabular-nums">
                {ad.start_date_formatted?.split(',')[0] || 'N/A'}
              </span>
              <span className="text-zinc-200 text-[10px]">→</span>
              <span className="text-[10px] font-bold text-zinc-900 tabular-nums">
                {ad.end_date_formatted?.split(',')[0] || 'Active'}
              </span>
            </div>
          </div>
          <div className="h-8 w-8 rounded-full border border-zinc-100 flex items-center justify-center group-hover:bg-zinc-950 group-hover:text-white transition-all">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}