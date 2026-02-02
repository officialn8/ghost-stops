import { Search } from 'lucide-react';
import { useRef, useEffect } from 'react';

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
  const inputRef = useRef<HTMLInputElement>(null);

  // Blur input on scroll to dismiss keyboard
  useEffect(() => {
    const handleScroll = () => {
      if (inputRef.current && document.activeElement === inputRef.current) {
        inputRef.current.blur();
      }
    };

    // Add scroll listeners to various scrollable containers
    window.addEventListener('scroll', handleScroll, true); // Capture phase

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      inputRef.current?.blur();
      onChange('');
    } else if (e.key === 'Enter') {
      inputRef.current?.blur();
    }
  };

  return (
    <div className="mobile-search-bar">
      <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-foreground placeholder-muted-foreground"
        enterKeyHint="search"
        inputMode="search"
        autoCorrect="off"
        autoCapitalize="none"
      />
      {value && (
        <button
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="w-5 h-5 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
          aria-label="Clear search"
        >
          <span className="text-muted-foreground text-xs">×</span>
        </button>
      )}
    </div>
  );
}