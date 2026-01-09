export default function SetupLoading() {
  return (
    <div className="min-h-screen bg-white">
      {/* Simple Header Skeleton */}
      <header className="border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="h-5 w-32 bg-slate-200 rounded animate-pulse"></div>
          <div className="h-5 w-16 bg-slate-200 rounded animate-pulse"></div>
          <div className="h-5 w-20 bg-slate-200 rounded animate-pulse"></div>
        </div>
      </header>

      {/* Main Content Skeleton */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Title Section Skeleton */}
        <div className="mb-6">
          <div className="h-8 w-64 bg-slate-200 rounded animate-pulse mb-2"></div>
          <div className="h-5 w-96 bg-slate-100 rounded animate-pulse"></div>
        </div>

        {/* Buttons Skeleton */}
        <div className="flex gap-3 mb-6">
          <div className="h-10 w-28 bg-slate-200 rounded animate-pulse"></div>
          <div className="h-10 w-48 bg-slate-200 rounded animate-pulse"></div>
        </div>

        {/* Table Skeleton */}
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-6">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3">
            <div className="flex gap-4">
              <div className="h-4 w-8 bg-slate-200 rounded animate-pulse"></div>
              <div className="h-4 flex-1 bg-slate-200 rounded animate-pulse"></div>
              <div className="h-4 w-20 bg-slate-200 rounded animate-pulse"></div>
            </div>
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="border-b border-slate-200 px-4 py-3">
              <div className="flex gap-4 items-center">
                <div className="h-4 w-8 bg-slate-100 rounded animate-pulse"></div>
                <div className="h-10 flex-1 bg-slate-100 rounded animate-pulse"></div>
                <div className="h-4 w-20 bg-slate-100 rounded animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>

        {/* Send Button Skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-11 w-40 bg-slate-200 rounded animate-pulse"></div>
          <div className="h-4 w-64 bg-slate-100 rounded animate-pulse"></div>
        </div>

        {/* Info Note Skeleton */}
        <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="h-5 w-32 bg-slate-200 rounded animate-pulse mb-2"></div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-slate-100 rounded animate-pulse"></div>
            <div className="h-4 w-full bg-slate-100 rounded animate-pulse"></div>
            <div className="h-4 w-3/4 bg-slate-100 rounded animate-pulse"></div>
          </div>
        </div>
      </main>
    </div>
  );
}
