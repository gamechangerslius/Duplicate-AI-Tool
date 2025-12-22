interface ViewToggleProps {
  value: 'ALL' | 'IMAGE' | 'VIDEO';
  onChange: (value: 'ALL' | 'IMAGE' | 'VIDEO') => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="mb-8">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button
          onClick={() => onChange('ALL')}
          className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
            value === 'ALL'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All
        </button>
        <button
          onClick={() => onChange('IMAGE')}
          className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
            value === 'IMAGE'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Images
        </button>
        <button
          onClick={() => onChange('VIDEO')}
          className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${
            value === 'VIDEO'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Videos
        </button>
      </div>
    </div>
  );
}
