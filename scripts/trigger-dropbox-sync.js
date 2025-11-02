// Trigger Dropbox Auto-Sync for Viva's Inventory
// This script forces the image upload for all Dropbox-imported vehicles

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const IMPORT_PAGE_URL = `https://n-zero.dev/dealer/${VIVA_ORG_ID}/dropbox-import`;

console.log('🚀 To trigger the Dropbox auto-sync:');
console.log('');
console.log('1. Open this URL in your browser:');
console.log(`   ${IMPORT_PAGE_URL}`);
console.log('');
console.log('2. The auto-sync will:');
console.log('   - Scan Dropbox (finds 63 vehicles)');
console.log('   - Check which vehicles need images (finds all 60)');
console.log('   - Auto-match folders to vehicles');
console.log('   - Start uploading images automatically');
console.log('');
console.log('3. Watch the browser console for progress:');
console.log('   - "Auto-sync: X vehicles need images"');
console.log('   - "Auto-starting import for X vehicles..."');
console.log('   - "Importing: [vehicle name]"');
console.log('   - "Downloaded [image] (XKB)"');
console.log('   - "Uploaded X/Y"');
console.log('');
console.log('4. When complete, all 60 vehicles will have their Dropbox photos!');
console.log('');
console.log('⏱️  Expected time: ~5-10 minutes for all images');

