# Nuke Desktop App

A native desktop application for scanning local files and syncing vehicle data to your Nuke account.

## Features

- **Local Scanning**: Scan folders for vehicle-related files (images, PDFs, spreadsheets)
- **Smart Detection**: Automatically detects vehicle info from filenames and paths
- **Local AI** (Optional): Use Ollama for on-device image analysis
- **Cloud Sync**: Sync detected vehicles to your Nuke account
- **Privacy First**: Your files stay local until you choose to sync

## Requirements

- **Node.js** 18+
- **Rust** (for Tauri)
- **Nuke Account**: Create one at [nuke.com](https://nuke.com)

### Optional

- **Ollama**: For local AI-powered image analysis
  ```bash
  # macOS
  brew install ollama
  ollama pull llava
  ollama serve
  ```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Building for Distribution

```bash
# macOS
npm run tauri build -- --target universal-apple-darwin

# Windows
npm run tauri build -- --target x86_64-pc-windows-msvc

# Linux
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

Built applications are output to `src-tauri/target/release/bundle/`.

## Architecture

```
nuke-desktop/
├── src/                    # React frontend
│   ├── App.tsx            # Main application
│   ├── main.tsx           # Entry point
│   └── styles.css         # Styles
├── src-tauri/             # Rust backend
│   ├── src/main.rs        # Tauri commands
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── package.json           # Node dependencies
└── vite.config.ts         # Vite configuration
```

## Tauri Commands

The app exposes these Rust commands to the frontend:

| Command | Description |
|---------|-------------|
| `scan_directories` | Scan folders for vehicle files |
| `parse_csv` | Parse CSV files for vehicle data |
| `check_ollama` | Check if Ollama is running |
| `analyze_image_local` | Process image with local Ollama |
| `sync_to_cloud` | Sync files to Nuke cloud |

## User Flow

1. **Sign In**: Create account or sign in with existing Nuke credentials
2. **Select Folders**: Choose folders to scan
3. **Scan**: App scans for images, documents, and spreadsheets
4. **Review**: See detected files and extracted vehicle info
5. **Sync**: Upload vehicles to your Nuke account

## Privacy

- Files are processed locally on your machine
- Only metadata and extracted data is synced (not the files themselves)
- Ollama runs entirely on-device (no cloud AI)
- You control what gets synced

## Troubleshooting

### Ollama not detected

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Scan not finding files

- Check folder permissions
- Ensure supported file types (.jpg, .png, .pdf, .csv, etc.)
- Try increasing scan depth in settings

### Sync failing

- Check internet connection
- Verify API key or login credentials
- Check Nuke server status

## License

MIT
