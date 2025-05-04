// This is a temporary file to help identify the exact line numbers in SupabaseRealtimeProvider.tsx
// Run this file with Node.js to print out the line numbers of certain patterns

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../integrations/supabase/SupabaseRealtimeProvider.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Find postgres_changes event handlers
lines.forEach((line, index) => {
  if (line.includes("on('postgres_changes'")) {
    console.log(`postgres_changes handler at line ${index + 1}: ${line.trim()}`);
  }
});

// Find postgres_changes configuration
lines.forEach((line, index) => {
  if (line.includes('postgres_changes:')) {
    console.log(`postgres_changes config at line ${index + 1}: ${line.trim()}`);
    // Print next few lines to see the configuration
    for (let i = 1; i < 5; i++) {
      if (index + i < lines.length) {
        console.log(`  Line ${index + i + 1}: ${lines[index + i].trim()}`);
      }
    }
  }
});

console.log("\nFile has", lines.length, "total lines");
