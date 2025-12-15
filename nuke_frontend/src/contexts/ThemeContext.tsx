/**
 * Theme + Appearance Context
 * - Theme preference: Auto / Dark / Light
 * - Auto sources: System (prefers-color-scheme) or Time (local schedule)
 * - UI colorways: applied via CSS variables (data-accent)
 * - Contrast profiles: standard / greyscale / high
 */

import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type Theme = 'dark' | 'light';
export type ThemePreference = 'auto' | Theme;
export type AutoThemeSource = 'system' | 'time';
export type ContrastProfile = 'standard' | 'greyscale' | 'high';
export type TextScale = 0.9 | 1 | 1.1 | 1.2;

export type TimeSchedule = {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
};

export type AccentId =
  | 'neutral'
  | 'gulf'
  | 'martini'
  | 'ricard'
  | 'rosso'
  | 'brg'
  | 'jps'
  | 'jaeger'
  | 'alitalia'
  | 'bmw-m'
  | 'papaya'
  | 'americana'
  | 'route-66'
  | 'denim'
  | 'desert';

interface ThemeContextType {
  // Effective theme applied to the document
  theme: Theme;

  // Theme selection
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;

  // Auto settings (only used when preference === 'auto')
  autoSource: AutoThemeSource;
  setAutoSource: (source: AutoThemeSource) => void;

  // Schedule settings (only used when preference === 'auto' && autoSource === 'time')
  schedule: TimeSchedule;
  setSchedule: (schedule: TimeSchedule) => void;

  // UI appearance
  accent: AccentId;
  setAccent: (accent: AccentId) => void;

  contrast: ContrastProfile;
  setContrast: (contrast: ContrastProfile) => void;

  textScale: TextScale;
  setTextScale: (scale: TextScale) => void;

  // Convenience / back-compat
  setTheme: (theme: Theme) => void; // sets preference to explicit theme
  toggleTheme: () => void; // toggles explicit dark/light (exits auto)
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEYS = {
  preference: 'themePreference',
  autoSource: 'themeAutoSource',
  schedule: 'themeSchedule',
  accent: 'uiAccent',
  contrast: 'uiContrast',
  textScale: 'uiTextScale',
} as const;

function parseTextScale(v: string | null): TextScale | null {
  if (!v) return null;
  const n = Number(v);
  if (n === 0.9 || n === 1 || n === 1.1 || n === 1.2) return n;
  return null;
}

function isValidHHMM(v: string): boolean {
  return /^\d{2}:\d{2}$/.test(v);
}

function parseHHMM(v: string): { h: number; m: number } | null {
  if (!isValidHHMM(v)) return null;
  const [hh, mm] = v.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { h: hh, m: mm };
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isDarkBySchedule(now: Date, schedule: TimeSchedule): boolean {
  const s = parseHHMM(schedule.start);
  const e = parseHHMM(schedule.end);
  if (!s || !e) return false;

  const start = s.h * 60 + s.m;
  const end = e.h * 60 + e.m;
  const cur = minutesSinceMidnight(now);

  // If start < end: dark within [start, end)
  // If start > end: wraps midnight, dark if cur >= start OR cur < end
  if (start === end) return true;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function nextScheduleBoundaryMs(now: Date, schedule: TimeSchedule): number {
  const s = parseHHMM(schedule.start);
  const e = parseHHMM(schedule.end);
  if (!s || !e) return 60_000;

  const boundaries = [
    { h: s.h, m: s.m },
    { h: e.h, m: e.m },
  ];

  let soonest: number | null = null;
  for (const b of boundaries) {
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(b.h, b.m, 0, 0);

    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);

    const delta = candidate.getTime() - now.getTime();
    if (soonest === null || delta < soonest) soonest = delta;
  }

  return Math.max(1000, soonest ?? 60_000);
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const prefersDarkQuery = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);

  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.preference);
    if (saved === 'auto' || saved === 'dark' || saved === 'light') return saved;
    // Back-compat: older builds stored only 'theme' as 'dark'|'light'
    const legacy = localStorage.getItem('theme');
    if (legacy === 'dark' || legacy === 'light') return legacy;
    return 'auto';
  });

  const [autoSource, setAutoSourceState] = useState<AutoThemeSource>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.autoSource);
    if (saved === 'system' || saved === 'time') return saved;
    return 'system';
  });

  const [schedule, setScheduleState] = useState<TimeSchedule>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.schedule);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.start === 'string' && typeof parsed.end === 'string') {
          return {
            start: isValidHHMM(parsed.start) ? parsed.start : '19:00',
            end: isValidHHMM(parsed.end) ? parsed.end : '07:00',
          };
        }
      } catch {
        // ignore
      }
    }
    return { start: '19:00', end: '07:00' };
  });

  const [accent, setAccentState] = useState<AccentId>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.accent) as AccentId | null;
    if (
      saved === 'neutral' ||
      saved === 'gulf' ||
      saved === 'martini' ||
      saved === 'ricard' ||
      saved === 'rosso' ||
      saved === 'brg' ||
      saved === 'jps' ||
      saved === 'jaeger' ||
      saved === 'alitalia' ||
      saved === 'bmw-m' ||
      saved === 'papaya' ||
      saved === 'americana' ||
      saved === 'route-66' ||
      saved === 'denim' ||
      saved === 'desert'
    ) {
      return saved;
    }
    return 'neutral';
  });

  const [contrast, setContrastState] = useState<ContrastProfile>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.contrast) as ContrastProfile | null;
    if (saved === 'standard' || saved === 'greyscale' || saved === 'high') return saved;
    return 'standard';
  });

  const [textScale, setTextScaleState] = useState<TextScale>(() => {
    const saved = parseTextScale(localStorage.getItem(STORAGE_KEYS.textScale));
    return saved ?? 1;
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => prefersDarkQuery.matches);
  const [, forceTimeRecalc] = useState(0);
  const timeTimerRef = useRef<number | null>(null);

  // Keep system preference updated
  useEffect(() => {
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    prefersDarkQuery.addEventListener('change', handler);
    return () => prefersDarkQuery.removeEventListener('change', handler);
  }, [prefersDarkQuery]);

  // When using time-based auto, schedule a wake-up at the next boundary
  useEffect(() => {
    if (timeTimerRef.current) {
      window.clearTimeout(timeTimerRef.current);
      timeTimerRef.current = null;
    }

    if (!(preference === 'auto' && autoSource === 'time')) return;

    const now = new Date();
    const ms = nextScheduleBoundaryMs(now, schedule);

    timeTimerRef.current = window.setTimeout(() => {
      forceTimeRecalc((x) => x + 1);
    }, ms);

    return () => {
      if (timeTimerRef.current) {
        window.clearTimeout(timeTimerRef.current);
        timeTimerRef.current = null;
      }
    };
  }, [preference, autoSource, schedule]);

  const theme: Theme = useMemo(() => {
    if (preference === 'dark' || preference === 'light') return preference;
    if (autoSource === 'system') return systemPrefersDark ? 'dark' : 'light';
    return isDarkBySchedule(new Date(), schedule) ? 'dark' : 'light';
  }, [preference, autoSource, systemPrefersDark, schedule]);

  // Apply to document + persist settings
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-accent', accent);
    root.setAttribute('data-contrast', contrast);
    root.style.setProperty('--font-scale', String(textScale));

    // Helps native controls match
    (root.style as any).colorScheme = theme;

    localStorage.setItem(STORAGE_KEYS.preference, preference);
    localStorage.setItem(STORAGE_KEYS.autoSource, autoSource);
    localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(schedule));
    localStorage.setItem(STORAGE_KEYS.accent, accent);
    localStorage.setItem(STORAGE_KEYS.contrast, contrast);
    localStorage.setItem(STORAGE_KEYS.textScale, String(textScale));
  }, [theme, preference, autoSource, schedule, accent, contrast, textScale]);

  const setPreference = (pref: ThemePreference) => setPreferenceState(pref);
  const setAutoSource = (source: AutoThemeSource) => setAutoSourceState(source);
  const setSchedule = (s: TimeSchedule) => setScheduleState(s);
  const setAccent = (a: AccentId) => setAccentState(a);
  const setContrast = (c: ContrastProfile) => setContrastState(c);
  const setTextScale = (s: TextScale) => setTextScaleState(s);

  const setTheme = (t: Theme) => setPreferenceState(t);

  const toggleTheme = () => {
    // Toggle between explicit dark/light and exit Auto
    setPreferenceState((prev) => {
      const effective: Theme = prev === 'auto' ? theme : prev;
      return effective === 'dark' ? 'light' : 'dark';
    });
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        preference,
        setPreference,
        autoSource,
        setAutoSource,
        schedule,
        setSchedule,
        accent,
        setAccent,
        contrast,
        setContrast,
        textScale,
        setTextScale,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};

