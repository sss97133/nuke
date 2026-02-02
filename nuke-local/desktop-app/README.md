# Nuke Intake

Local desktop app for batch processing vehicle documents with AI.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Nuke Intake App                         │
├─────────────────────────────────────────────────────────────┤
│  React Frontend (Vite + Tailwind)                           │
│  ├── SetupStep: Check/configure Ollama                      │
│  ├── ScanStep: Select folders, find documents               │
│  ├── ProcessStep: Run each doc through AI                   │
│  ├── ReviewStep: Approve/reject/edit extractions            │
│  ├── SyncStep: Upload to Supabase                           │
│  └── DoneStep: Summary                                      │
├─────────────────────────────────────────────────────────────┤
│  Tauri Backend (Rust)                                       │
│  ├── scan_directory: Walk filesystem for images/PDFs        │
│  ├── check_ollama: Verify local AI is running               │
│  ├── list_ollama_models: Get available models               │
│  ├── process_document: Send to Ollama for extraction        │
│  └── sync_to_supabase: Upload approved items                │
├─────────────────────────────────────────────────────────────┤
│  Ollama (localhost:11434)                                   │
│  └── llava or other vision model                            │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Rust** - https://rustup.rs/
2. **Node.js 18+** - https://nodejs.org/
3. **Ollama** - https://ollama.ai/download

## Setup

```bash
# Install dependencies
npm install

# Pull a vision model
ollama pull llava

# Start Ollama (if not running)
ollama serve

# Run in development
npm run tauri:dev
```

## Build for Distribution

```bash
# Build optimized binary
npm run tauri:build

# Output in:
# - macOS: src-tauri/target/release/bundle/dmg/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/deb/
```

## Workflow

1. **Setup**: App checks for Ollama connection, selects vision model
2. **Scan**: User picks folders containing vehicle docs (titles, registrations, invoices)
3. **Process**: Each image/PDF sent to local LLM for data extraction
4. **Review**: User approves/rejects/edits each extraction
5. **Sync**: Approved items uploaded to Nuke via Supabase API
6. **Done**: Summary of what was uploaded

## Supported Documents

- **Titles** - VIN, owner, year/make/model
- **Registrations** - VIN, plate, owner
- **Invoices/Receipts** - Price, date, description
- **Photos** - Vehicle identification

## Local Processing

All document analysis happens locally via Ollama. No images or documents are sent to external APIs during the processing step. Only the extracted structured data is sent to Supabase when you explicitly sync.

## Environment

For development, create a `.env` file:

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

For production builds, users enter their credentials in the app.

## Project Structure

```
desktop-app/
├── src/                    # React frontend
│   ├── components/         # Wizard step components
│   ├── store/              # Zustand state
│   └── lib/                # Utilities
├── src-tauri/              # Rust backend
│   └── src/main.rs         # Tauri commands
├── package.json
└── README.md
```
