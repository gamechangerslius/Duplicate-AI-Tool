interface ViewToggleProps {
  value: 'ALL' | 'IMAGE' | 'VIDEO';
  onChange: (value: 'ALL' | 'IMAGE' | 'VIDEO') => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  const options = [
    { id: 'ALL', label: 'All' },
    { id: 'IMAGE', label: 'Images' },
    { id: 'VIDEO', label: 'Videos' },
  ] as const;

  return (
    <div className="flex p-1 bg-zinc-100/50 rounded-xl border border-zinc-100 w-fit">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={`
            px-5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300
            ${value === option.id
              ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/50'
              : 'text-zinc-400 hover:text-zinc-600'
            }
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
} 