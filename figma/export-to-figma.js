import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the structure of your Figma files
const figmaStructure = {
  'main-design.fig': {
    description: 'Main design system and component library',
    sections: [
      'Layout',
      'Navigation',
      'Cards',
      'Forms',
      'Buttons',
      'Data Display',
      'Feedback',
      'Media'
    ]
  },
  'pages/dashboard.fig': {
    description: 'Dashboard layout and components',
    sections: [
      'Overview',
      'Analytics',
      'Recent Activity',
      'Quick Actions'
    ]
  },
  'pages/vehicles.fig': {
    description: 'Vehicle-related pages',
    sections: [
      'Vehicle List',
      'Vehicle Details',
      'Vehicle Card',
      'Search and Filters'
    ]
  },
  'pages/profile.fig': {
    description: 'User profile pages',
    sections: [
      'Profile Overview',
      'Settings',
      'Preferences',
      'Account Management'
    ]
  },
  'pages/marketplace.fig': {
    description: 'Marketplace and auction pages',
    sections: [
      'Marketplace List',
      'Auction Details',
      'Bidding Interface',
      'Search and Filters'
    ]
  },
  'pages/garage.fig': {
    description: 'Garage and vehicle management',
    sections: [
      'Garage Overview',
      'Vehicle Management',
      'Service History',
      'Maintenance Schedule'
    ]
  },
  'pages/service.fig': {
    description: 'Service and maintenance pages',
    sections: [
      'Service Dashboard',
      'Maintenance Records',
      'Service Schedule',
      'Diagnostics'
    ]
  }
};

// Create a Figma file template
function createFigmaTemplate(filePath, content) {
  const template = {
    name: path.basename(filePath, '.fig'),
    description: content.description,
    sections: content.sections,
    components: [],
    styles: {
      colors: [],
      typography: [],
      spacing: [],
      effects: []
    }
  };

  return template;
}

// Create the Figma files
Object.entries(figmaStructure).forEach(([filePath, content]) => {
  const fullPath = path.join(__dirname, 'designs', filePath);
  const dir = path.dirname(fullPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create the Figma file template
  const template = createFigmaTemplate(filePath, content);

  // Write the template to a JSON file (Figma uses a binary format, but this helps with organization)
  fs.writeFileSync(
    fullPath.replace('.fig', '.json'),
    JSON.stringify(template, null, 2)
  );
});

console.log('Figma file structure created successfully!');
console.log('\nTo use these files:');
console.log('1. Open Figma Desktop');
console.log('2. Create new files with the names specified in the designs directory');
console.log('3. Copy the structure from the JSON files into your Figma files');
console.log('4. Start designing your components and pages!'); 