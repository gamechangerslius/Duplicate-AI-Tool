'use client';

import { useEffect, useState } from 'react';

interface GroupMetadataProps {
  vectorGroup: number | null;
  businessId: string | null;
}

export function GroupMetadata({ vectorGroup, businessId }: GroupMetadataProps) {
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vectorGroup === -1 || vectorGroup == null || !businessId) {
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/group-metadata?vectorGroup=${vectorGroup}&businessId=${businessId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setMetadata(data);
        }
      })
      .catch(err => {
        console.error('Error fetching group metadata:', err);
        setError('Failed to fetch metadata');
      })
      .finally(() => setLoading(false));
  }, [vectorGroup, businessId]);

  if (vectorGroup === -1 || vectorGroup == null) {
    return null;
  }

  if (loading) {
    return (
      <div className="inline-block bg-slate-100 text-slate-700 text-sm px-3 py-1 rounded-full animate-pulse">
        Loading metadata...
      </div>
    );
  }

  if (error || !metadata) {
    return null;
  }

  const contentTypeLabel = metadata.content_types?.join('/') || 'Unknown';
  const activePeriod = metadata.active_period_days || 0;

  return (
    <div className="space-y-3 mt-4 pt-4 border-t border-slate-200">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <div className="text-xs font-semibold text-blue-700 mb-1">Duplicates</div>
          <div className="text-lg font-bold text-blue-900">{metadata.count}</div>
        </div>

        <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
          <div className="text-xs font-semibold text-purple-700 mb-1">Content Type</div>
          <div className="text-lg font-bold text-purple-900">
            {metadata.content_types && metadata.content_types.length === 1
              ? (metadata.content_types[0] === 'IMAGE' ? 'Image' : 'Video')
              : (metadata.content_types && metadata.content_types.length > 1 ? 'Mixed' : 'Unknown')}
          </div>
        </div>

        <div className="bg-green-50 p-3 rounded-lg border border-green-200">
          <div className="text-xs font-semibold text-green-700 mb-1">First Seen</div>
          <div className="text-xs font-mono text-green-900">{metadata.first_seen || 'N/A'}</div>
        </div>

        <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
          <div className="text-xs font-semibold text-orange-700 mb-1">Last Seen</div>
          <div className="text-xs font-mono text-orange-900">{metadata.last_seen || 'N/A'}</div>
        </div>

        <div className="bg-red-50 p-3 rounded-lg border border-red-200 col-span-2">
          <div className="text-xs font-semibold text-red-700 mb-1">Active Period</div>
          <div className="text-lg font-bold text-red-900">{activePeriod ?? 0} days</div>
        </div>
      </div>
    </div>
  );
}
