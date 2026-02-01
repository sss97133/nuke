#!/usr/bin/env npx tsx
/**
 * Local Forensics Processor
 *
 * 100% FREE - No API costs
 *
 * Uses:
 * - whisper.cpp or faster-whisper (local, free)
 * - Ollama with Llama/Mistral (local, free)
 * - yt-dlp for video download (free)
 *
 * Requirements:
 *   brew install ffmpeg
 *   # Option A: whisper.cpp
 *   brew install whisper-cpp
 *   # Option B: faster-whisper (Python)
 *   pip install faster-whisper
 *   # For LLM extraction:
 *   brew install ollama
 *   ollama pull llama3.2
 *
 * Usage:
 *   npx tsx scripts/forensics-local.ts <youtube-url>
 *   npx tsx scripts/forensics-local.ts --check  # Check dependencies
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = '/tmp/forensics-local';
const WHISPER_MODEL = 'base.en'; // base.en, small.en, medium.en, large

interface LocalConfig {
  whisperPath: string | null;
  whisperType: 'cpp' | 'python' | null;
  ollamaAvailable: boolean;
  ollamaModel: string;
}

function checkDependencies(): LocalConfig {
  console.log('\n🔍 Checking local dependencies...\n');

  const config: LocalConfig = {
    whisperPath: null,
    whisperType: null,
    ollamaAvailable: false,
    ollamaModel: 'llama3.2',
  };

  // Check whisper.cpp (binary is whisper-cli)
  try {
    const result = spawnSync('which', ['whisper-cli'], { encoding: 'utf-8' });
    if (result.stdout.trim()) {
      config.whisperPath = result.stdout.trim();
      config.whisperType = 'cpp';
      console.log('✅ whisper-cli found:', config.whisperPath);
    }
  } catch {}

  // Check faster-whisper (Python)
  if (!config.whisperPath) {
    try {
      const result = spawnSync('python3', ['-c', 'import faster_whisper; print("ok")'], { encoding: 'utf-8' });
      if (result.stdout.includes('ok')) {
        config.whisperType = 'python';
        config.whisperPath = 'faster-whisper';
        console.log('✅ faster-whisper (Python) available');
      }
    } catch {}
  }

  if (!config.whisperPath) {
    console.log('❌ No local Whisper found. Install with:');
    console.log('   brew install whisper-cpp  # provides whisper-cli');
    console.log('   # Then download model:');
    console.log('   curl -L -o ~/.whisper/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin');
    console.log('   OR: pip install faster-whisper');
  }

  // Check Ollama
  try {
    const result = spawnSync('ollama', ['list'], { encoding: 'utf-8' });
    if (result.status === 0) {
      config.ollamaAvailable = true;
      console.log('✅ Ollama available');

      // Check for models
      const models = result.stdout;
      if (models.includes('llama3')) {
        config.ollamaModel = 'llama3.2';
      } else if (models.includes('mistral')) {
        config.ollamaModel = 'mistral';
      } else if (models.includes('phi')) {
        config.ollamaModel = 'phi3';
      }
      console.log('   Model:', config.ollamaModel);
    }
  } catch {
    console.log('❌ Ollama not found. Install with:');
    console.log('   brew install ollama');
    console.log('   ollama pull llama3.2');
  }

  // Check yt-dlp
  try {
    spawnSync('yt-dlp', ['--version'], { encoding: 'utf-8' });
    console.log('✅ yt-dlp available');
  } catch {
    console.log('❌ yt-dlp not found. Install with: brew install yt-dlp');
  }

  // Check ffmpeg
  try {
    spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
    console.log('✅ ffmpeg available');
  } catch {
    console.log('❌ ffmpeg not found. Install with: brew install ffmpeg');
  }

  console.log('');
  return config;
}

async function transcribeLocal(audioPath: string, config: LocalConfig): Promise<string> {
  if (config.whisperType === 'cpp') {
    // Use whisper.cpp (whisper-cli)
    const outputPath = audioPath.replace('.wav', '');
    const modelPath = `${process.env.HOME}/.whisper/ggml-${WHISPER_MODEL}.bin`;
    execSync(
      `whisper-cli -m "${modelPath}" "${audioPath}" -otxt -of "${outputPath}"`,
      { timeout: 600000, stdio: 'pipe' }
    );
    return fs.readFileSync(`${outputPath}.txt`, 'utf-8');
  } else if (config.whisperType === 'python') {
    // Use faster-whisper
    const result = spawnSync('python3', ['-c', `
from faster_whisper import WhisperModel
model = WhisperModel("${WHISPER_MODEL}", device="cpu", compute_type="int8")
segments, info = model.transcribe("${audioPath}")
for segment in segments:
    print(f"[{segment.start:.1f}] {segment.text}")
    `], { encoding: 'utf-8', timeout: 600000 });
    return result.stdout;
  }
  throw new Error('No whisper available');
}

async function extractLotsLocal(transcript: string, config: LocalConfig): Promise<any[]> {
  if (!config.ollamaAvailable) {
    console.log('⚠️ No Ollama - using regex fallback');
    return extractLotsRegex(transcript);
  }

  const prompt = `Extract auction lots from this transcript. For each lot return JSON with:
- lot_number (Mecum format: S98, F123, etc)
- vehicle (year make model)
- outcome (sold/no_sale)
- final_price (number if sold)
- start_time (seconds)
- end_time (seconds)

Transcript:
${transcript.slice(0, 8000)}

Return ONLY valid JSON array: [{"lot_number": "S98", ...}, ...]`;

  const result = spawnSync('ollama', ['run', config.ollamaModel, prompt], {
    encoding: 'utf-8',
    timeout: 120000,
  });

  try {
    // Find JSON array in response
    const match = result.stdout.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    console.log('⚠️ LLM parse failed, using regex fallback');
  }

  return extractLotsRegex(transcript);
}

function extractLotsRegex(transcript: string): any[] {
  const lots: any[] = [];

  // Pattern for Mecum lot numbers
  const lotPattern = /\[(\d+\.?\d*)\].*?lot\s*([STFK]\d+(?:\.\d+)?)/gi;
  const soldPattern = /sold|hammer|congratulations/gi;
  const pricePattern = /\$?([\d,]+)\s*(?:thousand|grand|k)?/gi;

  let match;
  while ((match = lotPattern.exec(transcript)) !== null) {
    const timestamp = parseFloat(match[1]);
    const lotNumber = match[2].toUpperCase();

    // Look for price and outcome in nearby text
    const context = transcript.slice(match.index, match.index + 500);
    const isSold = soldPattern.test(context);

    let price = 0;
    const priceMatch = context.match(pricePattern);
    if (priceMatch) {
      const numStr = priceMatch[0].replace(/[^\d]/g, '');
      price = parseInt(numStr);
      if (price < 1000 && /thousand|grand|k/i.test(priceMatch[0])) {
        price *= 1000;
      }
    }

    lots.push({
      lot_number: lotNumber,
      vehicle: 'Unknown',
      outcome: isSold ? 'sold' : 'no_sale',
      final_price: price,
      start_time: timestamp,
      end_time: timestamp + 60,
    });
  }

  return lots;
}

async function processVideoLocal(videoUrl: string) {
  const config = checkDependencies();

  if (!config.whisperPath) {
    console.log('\n❌ Cannot process without local Whisper. Install it first.\n');
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Get video ID
  const videoId = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)?.[1] || 'video';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  LOCAL FORENSICS PROCESSOR (FREE)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Video:', videoUrl);
  console.log('');

  // Download audio (first 15 min for testing)
  const audioPath = path.join(DATA_DIR, `${videoId}.wav`);

  if (!fs.existsSync(audioPath)) {
    console.log('📥 Downloading audio (first 15 min)...');
    execSync(
      `yt-dlp -f "bestaudio" --download-sections "*0:00:00-0:15:00" ` +
      `-x --audio-format wav --postprocessor-args "-ar 16000 -ac 1" ` +
      `-o "${audioPath}" "${videoUrl}" 2>/dev/null`,
      { timeout: 300000 }
    );
    console.log('   Done\n');
  } else {
    console.log('📥 Using cached audio\n');
  }

  // Transcribe locally
  console.log('🎤 Transcribing with local Whisper...');
  console.log(`   Model: ${WHISPER_MODEL}`);
  const startTime = Date.now();
  const transcript = await transcribeLocal(audioPath, config);
  const transcribeTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Done in ${transcribeTime}s\n`);

  // Save transcript
  const transcriptPath = path.join(DATA_DIR, `${videoId}_transcript.txt`);
  fs.writeFileSync(transcriptPath, transcript);
  console.log(`📝 Transcript saved: ${transcriptPath}\n`);

  // Extract lots
  console.log('🔍 Extracting lots...');
  const lots = await extractLotsLocal(transcript, config);
  console.log(`   Found ${lots.length} lots\n`);

  // Show results
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const lot of lots) {
    console.log(`📍 ${lot.lot_number}: ${lot.vehicle}`);
    console.log(`   ${lot.outcome === 'sold' ? '✅ Sold' : '❌ No sale'}: $${lot.final_price?.toLocaleString() || 0}`);
    console.log(`   Time: ${Math.floor(lot.start_time / 60)}:${String(Math.floor(lot.start_time % 60)).padStart(2, '0')}`);
    console.log('');
  }

  // Save results
  const resultsPath = path.join(DATA_DIR, `${videoId}_lots.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(lots, null, 2));
  console.log(`💾 Results saved: ${resultsPath}`);

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('💰 Cost: $0.00 (processed locally)');
  console.log('───────────────────────────────────────────────────────────────\n');
}

// Main
const arg = process.argv[2];

if (!arg) {
  console.log('\nLocal Forensics Processor - 100% FREE\n');
  console.log('Usage:');
  console.log('  npx tsx scripts/forensics-local.ts --check');
  console.log('  npx tsx scripts/forensics-local.ts <youtube-url>\n');
  process.exit(0);
}

if (arg === '--check') {
  checkDependencies();
} else {
  processVideoLocal(arg);
}
