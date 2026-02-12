import { useEffect } from 'react';
import { useTheme, type AccentId, type ThemePreference } from '../contexts/ThemeContext';
import type { StorefrontOrg } from './StorefrontApp';

interface Props {
  organization: StorefrontOrg;
  children: React.ReactNode;
}

const VALID_ACCENTS = new Set([
  'neutral', 'gulf', 'martini', 'ricard', 'rosso', 'brg', 'jps', 'jaeger',
  'alitalia', 'bmw-m', 'papaya', 'americana', 'route-66', 'denim', 'desert',
  'camo-od', 'camo-blaze', 'camo-snow', 'mopar-plum', 'mopar-sublime',
  'mopar-hemi', 'mopar-b5', 'flames-heat', 'flames-blue',
]);

export default function StorefrontThemeWrapper({ organization, children }: Props) {
  const { setPreference, setAccent } = useTheme();

  useEffect(() => {
    const config = organization.ui_config?.storefront;
    if (!config) return;

    // Apply theme preference
    if (config.theme && ['dark', 'light', 'auto'].includes(config.theme)) {
      setPreference(config.theme as ThemePreference);
    }

    // Apply accent colorway
    if (config.accentColor && VALID_ACCENTS.has(config.accentColor)) {
      setAccent(config.accentColor as AccentId);
    }

    // Apply custom primary color override
    if (config.primaryColor && /^#[0-9a-fA-F]{6}$/.test(config.primaryColor)) {
      document.documentElement.style.setProperty('--accent', config.primaryColor);
      document.documentElement.style.setProperty('--accent-bright', config.primaryColor);
    }

    // Cleanup custom color on unmount
    return () => {
      if (config.primaryColor) {
        document.documentElement.style.removeProperty('--accent');
        document.documentElement.style.removeProperty('--accent-bright');
      }
    };
  }, [organization, setPreference, setAccent]);

  return <>{children}</>;
}
