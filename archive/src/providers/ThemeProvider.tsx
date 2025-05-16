import { ReactNode } from 'react';
import { useAtom } from 'jotai';
import { themeAtom } from '../atoms/theme';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme] = useAtom(themeAtom);

  return (
    <div className={`theme-${theme}`}>
      {children}
    </div>
  );
} 