import { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '../atoms/theme';

const themes = [
  { id: 'ios', name: 'iOS', description: 'Apple\'s Human Interface Guidelines' },
  { id: 'figma', name: 'Figma', description: 'Modern design system' },
  { id: 'shadcn', name: 'Shadcn', description: 'Radix UI based components' },
  { id: 'glass', name: 'Glass', description: 'Frosted glass effect' },
];

export function ThemeSwitcher() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Apply theme class to body
    document.body.className = `theme-${theme}`;
  }, [theme]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background border border-border hover:bg-accent"
      >
        <span className="capitalize">{theme}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-background shadow-lg">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTheme(t.id);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2 text-left hover:bg-accent ${
                theme === t.id ? 'bg-accent' : ''
              }`}
            >
              <div className="font-medium">{t.name}</div>
              <div className="text-sm text-muted-foreground">{t.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
} 