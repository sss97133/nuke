# Nuke Scanner

Open source vehicle data scanner and extractor. Scans files, extracts vehicle information, and outputs structured data.

## Features

- **File Scanning**: Recursively scan directories for vehicle-related files
- **Smart Extraction**: Extract vehicle data from filenames, paths, and file contents
- **CSV Parsing**: Parse spreadsheets for bulk vehicle data
- **Deduplication**: Automatically merge and deduplicate found vehicles
- **CLI Tool**: Easy command-line interface

## Installation

```bash
npm install -g @nuke/scanner
```

Or use directly with npx:

```bash
npx @nuke/scanner scan ~/Documents/cars
```

## CLI Usage

### Scan Directories

```bash
# Scan a directory
nuke-scan scan ~/Documents/cars

# Scan multiple directories
nuke-scan scan ~/Documents ~/Downloads --depth 5

# Output to JSON
nuke-scan scan ~/Documents/cars -o results.json

# Verbose output
nuke-scan scan ~/Documents/cars -v
```

### Extract Vehicle Data

```bash
# Extract from scanned files
nuke-scan extract ~/Documents/cars

# Output to JSON
nuke-scan extract ~/Documents/cars -o vehicles.json

# Include duplicates
nuke-scan extract ~/Documents/cars --no-dedupe
```

### Parse CSV Files

```bash
# Parse a CSV file
nuke-scan csv inventory.csv

# Output to JSON
nuke-scan csv inventory.csv -o vehicles.json
```

## Library Usage

```typescript
import { FileScanner, VehicleExtractor, CsvParser } from '@nuke/scanner';

// Scan directories
const scanner = new FileScanner({
  paths: ['./documents', './photos'],
  fileTypes: {
    images: true,
    documents: true,
    spreadsheets: true,
  },
});

const files = await scanner.scan();
console.log(`Found ${files.length} files`);

// Extract vehicle data
const extractor = new VehicleExtractor();
const results = await extractor.extractBatch(files);

// Get all vehicles
let vehicles = results.flatMap(r => r.vehicles);

// Deduplicate
vehicles = VehicleExtractor.deduplicate(vehicles);

console.log(`Found ${vehicles.length} vehicles`);
for (const vehicle of vehicles) {
  console.log(`${vehicle.year} ${vehicle.make} ${vehicle.model}`);
}
```

### CSV Parsing

```typescript
import { CsvParser } from '@nuke/scanner';

const parser = new CsvParser();
const vehicles = await parser.parse('./inventory.csv');

for (const vehicle of vehicles) {
  console.log(`${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  if (vehicle.vin) console.log(`  VIN: ${vehicle.vin}`);
}
```

## Supported File Types

### Images
- JPG, JPEG, PNG, GIF
- HEIC, HEIF (Apple)
- WebP, TIFF, BMP

### Documents
- PDF
- DOC, DOCX
- TXT, RTF

### Spreadsheets
- CSV
- XLSX, XLS
- Numbers (Apple)
- ODS

## How Extraction Works

### Path-Based Extraction

The scanner looks for vehicle information in file paths and names:

```
/Users/john/Cars/1974 Chevrolet C10/receipts/oil_change.pdf
                 ↑                ↑
              Year/Make/Model  Context
```

### CSV Column Mapping

The CSV parser automatically maps common column names:

| Standard Field | Recognized Headers |
|----------------|-------------------|
| `year` | Year, Model Year, Yr |
| `make` | Make, Manufacturer, Brand |
| `model` | Model, Model Name |
| `vin` | VIN, Vehicle Identification Number |
| `mileage` | Mileage, Miles, Odometer |
| `price` | Price, Asking Price, Sale Price |
| `color` | Color, Exterior Color |

### VIN Detection

VINs are detected using the standard 17-character format:
- 17 alphanumeric characters
- No I, O, or Q (per VIN standard)

## Confidence Scores

Each extracted vehicle includes a confidence score (0-1):

| Source | Confidence Boost |
|--------|-----------------|
| VIN detected | +0.5 |
| Year found | +0.3 |
| Make found | +0.3 |
| Model found | +0.3 |
| Mileage found | +0.1 |
| Price found | +0.1 |

## Output Format

```json
{
  "year": 1974,
  "make": "Chevrolet",
  "model": "C10",
  "vin": "CCY144Z123456",
  "mileage": 87000,
  "price": 35000,
  "color": "Red",
  "transmission": "Automatic",
  "engine": "350 V8",
  "description": "Original paint",
  "sourceFile": "/path/to/file.csv",
  "confidence": 0.85
}
```

## Integration with Nuke Platform

Upload extracted vehicles to your Nuke account:

```bash
# Extract and upload
nuke-scan extract ~/Documents/cars -o vehicles.json

# Use the Nuke API to upload
curl -X POST "https://api.nuke.com/v1/batch" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @vehicles.json
```

Or use the [Nuke Desktop App](https://nuke.com/desktop) for a GUI experience.

## Development

```bash
# Clone the repository
git clone https://github.com/nukeplatform/nuke-scanner.git
cd nuke-scanner

# Install dependencies
npm install

# Build
npm run build

# Run locally
npm start scan ~/Documents
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - See [LICENSE](LICENSE) for details.

## Links

- [Nuke Platform](https://nuke.com)
- [API Documentation](https://nuke.com/docs/api)
- [Desktop App](https://nuke.com/desktop)
- [GitHub Issues](https://github.com/nukeplatform/nuke-scanner/issues)
