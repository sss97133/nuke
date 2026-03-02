import { useTheme, type HeaderVariant } from '../../../contexts/ThemeContext';

export function useHeaderVariant(): [HeaderVariant, (v: HeaderVariant) => void] {
  const { headerVariant, setHeaderVariant } = useTheme();
  return [headerVariant, setHeaderVariant];
}
