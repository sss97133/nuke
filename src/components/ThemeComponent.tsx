import { useAtom } from 'jotai';
import { themeAtom } from '../atoms/theme';
import { Button as IOSButton } from './ios/Button';
import { Button as FigmaButton } from './figma/Button';
import { Button as GlassButton } from './glass/Button';

interface ThemeComponentProps {
  component: 'button';
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'small' | 'medium' | 'large';
  children: React.ReactNode;
  [key: string]: any;
}

export function ThemeComponent({ component, ...props }: ThemeComponentProps) {
  const [theme] = useAtom(themeAtom);

  switch (theme) {
    case 'ios':
      return <IOSButton {...props} />;
    case 'figma':
      return <FigmaButton {...props} />;
    case 'glass':
      return <GlassButton {...props} />;
    default:
      return <IOSButton {...props} />;
  }
} 