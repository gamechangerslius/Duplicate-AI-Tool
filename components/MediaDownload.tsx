"use client";

import { useState } from 'react';

interface Props {
  imageUrl?: string | null;
  videoUrl?: string | null;
  imageName?: string;
  videoName?: string;
  videoAvailable?: boolean;
}

function filenameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const pathname = u.pathname || url;
    const last = pathname.split('/').filter(Boolean).pop();
    return last || 'download';
  } catch (e) {
    const parts = url.split('/');
    return parts[parts.length - 1] || 'download';
  }
}

export default function MediaDownload({ imageUrl, videoUrl, imageName, videoName, videoAvailable }: Props) {
  const [downloading, setDownloading] = useState<string | null>(null);

  async function downloadAs(url: string | null | undefined, suggestedName?: string) {
    if (!url) return;
    try {
      setDownloading(url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const blob = await res.blob();
      const ext = (suggestedName && suggestedName.includes('.')) ? '' : (blob.type ? ('.' + blob.type.split('/').pop()) : '');
      const name = suggestedName || filenameFromUrl(url) + ext;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('download failed', err);
      // Fallback: open in new tab so user can manually save
      if (url) window.open(url, '_blank');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex gap-3">
      {videoUrl && videoAvailable && (
        <button
          type="button"
          onClick={() => downloadAs(videoUrl, videoName)}
          disabled={!!downloading}
          className="h-9 px-4 bg-indigo-600 text-white rounded-lg flex items-center text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-50"
        >
          {downloading === videoUrl ? 'Downloading…' : 'Download Video'}
        </button>
      )}

      {imageUrl && (
        <button
          type="button"
          onClick={() => downloadAs(imageUrl, imageName)}
          disabled={!!downloading}
          className="h-9 px-4 bg-slate-200 text-zinc-900 rounded-lg flex items-center text-[10px] font-bold uppercase tracking-widest hover:bg-slate-300 transition-all disabled:opacity-50"
        >
          {downloading === imageUrl ? 'Downloading…' : 'Download Photo'}
        </button>
      )}
    </div>
  );
}
