import { Search } from 'lucide-react';

interface MobileSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function MobileSearchBar({
  value,
  onChange,
  placeholder = "Search stations..."
}: MobileSearchBarProps) {
  return (
    <div className="mobile-search-bar">
      <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-400"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center hover:bg-gray-300 transition-colors"
        >
          <span className="text-gray-600 text-xs">×</span>
        </button>
      )}
    </div>
  );
}