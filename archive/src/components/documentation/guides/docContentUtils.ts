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
    
    // Core Features
    '/docs/features': { title: 'Core Features', content: FEATURES },
    '/docs/features/vehicle-management': { title: 'Vehicle Management', content: FEATURES, section: '🚗 Vehicle Management' },
    '/docs/features/inventory-management': { title: 'Inventory Management', content: FEATURES, section: '📦 Inventory Management' },
    '/docs/features/service-operations': { title: 'Service Operations', content: FEATURES, section: '🔧 Service Operations' },
    '/docs/features/professional-development': { title: 'Professional Development', content: FEATURES, section: '👥 Professional Development' },
    '/docs/features/analytics-diagnostics': { title: 'Analytics & Diagnostics', content: FEATURES, section: '📊 Analytics & Diagnostics' },
    
    // Business Operations
    '/docs/business-ops': { title: 'Business Operations', content: BUSINESS_OPS },
    '/docs/business-ops/onboarding': { title: 'Business Onboarding System', content: BUSINESS_OPS, section: '🎯 Business Onboarding System' },
    '/docs/business-ops/garage-management': { title: 'Garage Management', content: BUSINESS_OPS, section: '🏢 Garage Management' },
    '/docs/business-ops/analytics': { title: 'Business Analytics', content: BUSINESS_OPS, section: '💼 Business Analytics' },
    
    // Media Production
    '/docs/media-production': { title: 'Media Production', content: MEDIA_PRODUCTION },
    '/docs/media-production/workspace': { title: 'Workspace Media Production', content: MEDIA_PRODUCTION, section: '🎥 Workspace Media Production' },
    '/docs/media-production/streaming': { title: 'Technician Streaming Platform', content: MEDIA_PRODUCTION, section: '🎙️ Technician Streaming Platform' },
    '/docs/media-production/content': { title: 'Long Form Source Material', content: MEDIA_PRODUCTION, section: '📚 Long Form Source Material' },
    '/docs/media-production/studio': { title: 'Studio Configuration', content: MEDIA_PRODUCTION, section: '🎬 Studio Configuration' },
    
    // Market Analysis
    '/docs/market-analysis': { title: 'Market Analysis', content: MARKET_ANALYSIS },
    '/docs/market-analysis/valuation': { title: 'Vehicle Valuation Tools', content: MARKET_ANALYSIS, section: '📈 Vehicle Valuation Tools' },
    '/docs/market-analysis/token-economics': { title: 'Token Economics', content: MARKET_ANALYSIS, section: '💱 Token Economics' },
    '/docs/market-analysis/predictive': { title: 'Predictive Analytics', content: MARKET_ANALYSIS, section: '🔮 Predictive Analytics' },
    
    // Predictive Staking
    '/docs/predictive-staking': { title: 'Predictive Staking', content: PREDICTIVE_STAKING },
    '/docs/predictive-staking/system': { title: 'Token Staking System', content: PREDICTIVE_STAKING, section: '🏦 Token Staking System' },
    '/docs/predictive-staking/dashboard': { title: 'Analytics Dashboard', content: PREDICTIVE_STAKING, section: '📊 Analytics Dashboard' },
    '/docs/predictive-staking/ai': { title: 'AI-Powered Predictions', content: PREDICTIVE_STAKING, section: '🤖 AI-Powered Predictions' },
    
    // Studio
    '/docs/studio': { title: 'Studio Module Architecture', content: STUDIO },
    '/docs/studio/configuration': { title: 'Configuration Tools', content: STUDIO, section: '🎬 Configuration Tools' },
    '/docs/studio/recording': { title: 'Recording Management', content: STUDIO, section: '📹 Recording Management' },
    '/docs/studio/podcasting': { title: 'Podcasting Tools', content: STUDIO, section: '🎙️ Podcasting Tools' },
    
    // Technical Documentation
    '/docs/technical': { title: 'Technical Documentation', content: TECHNICAL },
    '/docs/technical/architecture': { title: 'System Architecture', content: TECHNICAL, section: '🧰 System Architecture' },
    '/docs/technical/data-models': { title: 'Data Models', content: TECHNICAL, section: '💾 Data Models' },
    '/docs/technical/api': { title: 'API Reference', content: TECHNICAL, section: '🔌 API Reference' },
    '/docs/technical/security': { title: 'Security Implementation', content: TECHNICAL, section: '🔒 Security Implementation' },
    
    // Other Documentation
    '/docs/user-manual': { title: 'User Manual', content: 'User Manual content would be here.' },
    '/docs/admin-guide': { title: 'Administrator Guide', content: 'Administrator Guide content would be here.' },
    '/docs/best-practices': { title: 'Best Practices', content: 'Best Practices content would be here.' },
    '/docs/faq': { title: 'Frequently Asked Questions', content: 'FAQ content would be here.' },
    '/docs/troubleshooting': { title: 'Troubleshooting Guide', content: 'Troubleshooting content would be here.' },
    '/docs/integrations': { title: 'Third-Party Integrations', content: 'Integrations content would be here.' },
  };
};
