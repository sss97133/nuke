import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const ADMIN_USER_ID = '13450c45-3e8b-4124-9f5b-5c512094ff04';

const manuals = [
  {
    filename: '1973_Chevy_Service_Manual.pdf',
    title: '1973 Chevrolet Light Duty Truck Service Manual',
    year: 1973,
    year_range: [1973, 1976],
    source_url: 'http://www.73-87chevytrucks.com/techinfo/7387CKMans/Service/ST_330_73_1973_Chevrolet_Light_Truck_Service_Manual.pdf'
  },
  {
    filename: '1977_Chevy_Service_Manual.pdf',
    title: '1977 Chevrolet Light Duty Truck Service Manual',
    year: 1977,
    year_range: [1977, 1980],
    source_url: 'http://www.73-87chevytrucks.com/techinfo/7387CKMans/Service/ST_330_77_1977_Chevrolet_Light_Truck_Service_Manual.pdf'
  },
  {
    filename: '1981_Chevy_Service_Manual.pdf',
    title: '1981 Chevrolet Light Duty Truck 10-30 Service Manual',
    year: 1981,
    year_range: [1981, 1984],
    source_url: 'http://www.73-87chevytrucks.com/techinfo/7387CKMans/Service/ST_330_81_1981_Chevrolet_Light_Duty_Truck_10_to_30_Service_Manual.pdf'
  },
  {
    filename: '1987_Chevy_Service_Manual.pdf',
    title: '1987 Chevrolet Light Duty Truck Service Manual',
    year: 1987,
    year_range: [1985, 1987],
    source_url: 'http://www.73-87chevytrucks.com/techinfo/7387CKMans/Service/ST_330_87_1987_Chevrolet_Light_Duty_Truck_Service_Manual.pdf'
  }
];

async function uploadServiceManuals() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('UPLOADING GM SERVICE MANUALS TO LIBRARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const manual of manuals) {
    console.log(`📘 ${manual.title}`);
    
    try {
      // 1. Find or create reference library for this year range
      const { data: library, error: libError } = await supabase
        .from('reference_libraries')
        .select('id')
        .eq('make', 'chevrolet')
        .eq('series', 'C/K')
        .eq('year', manual.year)
        .maybeSingle();

      let libraryId;
      if (!library) {
        const { data: newLib } = await supabase
          .from('reference_libraries')
          .insert({
            year: manual.year,
            make: 'chevrolet',
            model: 'C/K',
            series: 'C/K',
            body_style: 'Pickup',
            description: `Factory service manual for ${manual.year} C/K trucks`
          })
          .select('id')
          .single();
        libraryId = newLib.id;
        console.log(`  ✅ Created library: ${libraryId}`);
      } else {
        libraryId = library.id;
        console.log(`  ✓ Library exists: ${libraryId}`);
      }

      // 2. Get file size (local check)
      const pdfPath = join(__dirname, '../reference_documents/service_manuals', manual.filename);
      const pdfBuffer = readFileSync(pdfPath);
      const fileSize = pdfBuffer.length;

      console.log(`  📄 File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

      // 3. Use source URL instead of uploading (PDFs too large for free tier)
      const publicUrl = manual.source_url;

      console.log(`  ✓ Using source URL (file too large for storage)`);

      // 5. Create library_documents entry
      const { data: doc, error: docError } = await supabase
        .from('library_documents')
        .insert({
          library_id: libraryId,
          document_type: 'service_manual',
          title: manual.title,
          file_url: publicUrl,
          file_size_bytes: fileSize,
          uploaded_by: ADMIN_USER_ID,
          year_published: manual.year,
          year_range_start: manual.year_range[0],
          year_range_end: manual.year_range[1],
          publisher: 'General Motors',
          is_factory_original: true,
          is_verified: true,
          verified_by: ADMIN_USER_ID,
          quality_rating: 5,
          tags: ['service_manual', 'factory', 'c/k_trucks']
        })
        .select()
        .single();

      if (docError) {
        console.error(`  ❌ Doc creation error: ${docError.message}`);
        continue;
      }

      console.log(`  ✅ Created library document: ${doc.id}`);
      console.log(`  📊 Status: Ready for indexing\n`);

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}\n`);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('UPLOAD COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nNext steps:');
  console.log('1. Create reference-documents storage bucket if needed');
  console.log('2. Run indexing pipeline on each document');
  console.log('3. Monitor reference_chunks table for progress\n');
}

uploadServiceManuals().catch(console.error);

