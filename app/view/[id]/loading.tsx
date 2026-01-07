export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto px-6 py-12 max-w-5xl">
        {/* Back button skeleton */}
        <div className="h-6 w-32 bg-slate-200 rounded animate-pulse mb-6"></div>

        {/* Main image card skeleton */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
          <div className="relative aspect-video bg-slate-200 animate-pulse"></div>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <div className="h-8 bg-slate-200 rounded animate-pulse mb-2 w-3/4"></div>
                <div className="h-5 bg-slate-200 rounded animate-pulse w-1/3"></div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="h-10 w-32 bg-slate-200 rounded-lg animate-pulse"></div>
                <div className="h-10 w-32 bg-slate-200 rounded-lg animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Group Representative skeleton */}
        <div className="mb-10">
          <div className="h-7 bg-slate-200 rounded animate-pulse mb-3 w-64"></div>
          <div className="bg-white rounded-xl p-4 shadow-md">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 bg-slate-200 rounded-md animate-pulse"></div>
              <div className="flex-1">
                <div className="h-5 bg-slate-200 rounded animate-pulse mb-2 w-2/3"></div>
                <div className="h-4 bg-slate-200 rounded animate-pulse w-1/2"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Related Ads skeleton */}
        <div className="mb-10">
          <div className="h-7 bg-slate-200 rounded animate-pulse mb-4 w-48"></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="relative aspect-video bg-slate-200 animate-pulse"></div>
                <div className="p-3">
                  <div className="h-4 bg-slate-200 rounded animate-pulse mb-2"></div>
                  <div className="h-3 bg-slate-200 rounded animate-pulse w-2/3"></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Loading text */}
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl px-8 py-6 flex items-center gap-4 z-50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="text-slate-900 font-medium text-lg">Loading ad details...</span>
        </div>
      </div>
    </div>
  );
}
