#!/usr/bin/env node
/**
 * Batch update all timeline_events references to vehicle_timeline_events
 */

const fs = require('fs');
const path = require('path');

// Files that need updating
const filesToUpdate = [
  'nuke_frontend/src/components/VehicleTimeline.tsx',
  'nuke_frontend/src/services/timelineEventService.ts',
  'nuke_frontend/src/services/eventPipeline.ts',
  'nuke_frontend/src/components/SimpleTimeline.tsx',
  'nuke_frontend/src/services/imageTrackingService.ts',
  'nuke_frontend/src/components/EventDetailModal.tsx',
  'nuke_frontend/src/services/feedService.ts',
  'nuke_frontend/src/pages/VehicleProfile.tsx',
  'nuke_frontend/src/components/mobile/MobileVehicleProfile.tsx',
  'nuke_frontend/src/components/feed/DiscoveryHighlights.tsx',
  'nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx',
  'nuke_frontend/src/components/feed/DiscoveryFeed.tsx',
  'nuke_frontend/src/components/vehicle/VehicleIntelligenceDashboard.tsx',
  'nuke_frontend/src/components/search/IntelligentSearch.tsx',
  'nuke_frontend/src/components/image/ImageLightbox.tsx',
  'nuke_frontend/src/services/advancedValuationService.ts',
  'nuke_frontend/src/components/SimpleImageViewer.tsx',
  'nuke_frontend/src/services/profileService.ts',
  'nuke_frontend/src/components/vehicle/ReceiptManager.tsx',
  'nuke_frontend/src/components/vehicle/VehicleProfileWindows95.tsx',
  'nuke_frontend/src/components/analytics/ComprehensiveAnalytics.tsx',
  'nuke_frontend/src/components/WorkDocumentationPanel.tsx',
  'nuke_frontend/src/components/TimelineEventDetailsPanel.tsx',
  'nuke_frontend/src/components/SimplePhotoTagger.tsx',
  'nuke_frontend/src/components/EventMap.tsx',
  'nuke_frontend/src/components/DiscoveryFeed.tsx',
  'nuke_frontend/src/components/debug/DatabaseDiagnostic.tsx',
  'nuke_frontend/src/services/CommentService.ts'
];

const rootDir = path.join(__dirname, '..');
let totalUpdated = 0;
let totalFiles = 0;

console.log('Starting batch update of timeline_events → vehicle_timeline_events\n');

for (const file of filesToUpdate) {
  const filePath = path.join(rootDir, file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${file}`);
    continue;
  }
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Replace .from('timeline_events') with .from('vehicle_timeline_events')
    content = content.replace(/\.from\(['"]timeline_events['"]\)/g, ".from('vehicle_timeline_events')");
    
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      const changes = (originalContent.match(/\.from\(['"]timeline_events['"]\)/g) || []).length;
      console.log(`✅ Updated ${file} (${changes} occurrence${changes !== 1 ? 's' : ''})`);
      totalUpdated += changes;
      totalFiles++;
    }
  } catch (error) {
    console.error(`❌ Error updating ${file}:`, error.message);
  }
}

console.log(`\n📊 Summary: Updated ${totalUpdated} occurrence(s) across ${totalFiles} file(s)`);

