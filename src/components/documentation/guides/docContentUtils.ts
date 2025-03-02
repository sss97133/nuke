
import { 
  GETTING_STARTED, FEATURES, BUSINESS_OPS, MEDIA_PRODUCTION, 
  MARKET_ANALYSIS, PREDICTIVE_STAKING, STUDIO, TECHNICAL 
} from '../content/markdown/content';

export interface DocContent {
  path: string;
  title: string;
  content: string;
  section?: string;
}

export const getDocContents = () => {
  return {
    '/docs/getting-started': { title: 'Getting Started Guide', content: GETTING_STARTED },
    '/docs/features': { title: 'Core Features', content: FEATURES },
    '/docs/features/vehicle-management': { title: 'Vehicle Management', content: FEATURES, section: '🚗 Vehicle Management' },
    '/docs/features/inventory-management': { title: 'Inventory Management', content: FEATURES, section: '📦 Inventory Management' },
    '/docs/features/service-operations': { title: 'Service Operations', content: FEATURES, section: '🔧 Service Operations' },
    '/docs/features/professional-development': { title: 'Professional Development', content: FEATURES, section: '👥 Professional Development' },
    '/docs/business-ops': { title: 'Business Operations', content: BUSINESS_OPS },
    '/docs/media-production': { title: 'Media Production', content: MEDIA_PRODUCTION },
    '/docs/market-analysis': { title: 'Market Analysis', content: MARKET_ANALYSIS },
    '/docs/predictive-staking': { title: 'Predictive Staking', content: PREDICTIVE_STAKING },
    '/docs/studio': { title: 'Studio Module Architecture', content: STUDIO },
    '/docs/technical': { title: 'Technical Documentation', content: TECHNICAL },
    '/docs/user-manual': { title: 'User Manual', content: 'User Manual content would be here.' },
    '/docs/admin-guide': { title: 'Administrator Guide', content: 'Administrator Guide content would be here.' },
    '/docs/best-practices': { title: 'Best Practices', content: 'Best Practices content would be here.' },
  };
};
