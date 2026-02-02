# Contributing to Nuke Scanner

Thank you for your interest in contributing to Nuke Scanner! This document provides guidelines for contributions.

## Code of Conduct

Be respectful and constructive. We welcome contributors of all skill levels.

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use the bug report template
3. Include:
   - Node.js version
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior
   - Sample files (if possible)

### Suggesting Features

1. Check existing feature requests
2. Open an issue with:
   - Clear description of the feature
   - Use case explanation
   - Potential implementation approach

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Write/update tests
5. Run tests (`npm test`)
6. Commit with clear messages
7. Push and open a PR

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/nuke-scanner.git
cd nuke-scanner

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run in watch mode
npm run dev
```

## Project Structure

```
nuke-scanner/
├── src/
│   ├── index.ts         # Main exports
│   ├── scanner.ts       # File scanner
│   ├── extractor.ts     # Vehicle extractor
│   ├── cli.ts           # CLI interface
│   └── parsers/
│       ├── csv.ts       # CSV parser
│       └── path.ts      # Path parser
├── package.json
├── tsconfig.json
└── README.md
```

## Coding Standards

### TypeScript

- Use strict mode
- Prefer `const` over `let`
- Use explicit types for function parameters and returns
- Document public APIs with JSDoc

### Naming

- `camelCase` for variables and functions
- `PascalCase` for classes and interfaces
- `UPPER_SNAKE_CASE` for constants

### Code Style

```typescript
// Good
export interface ScanResult {
  path: string;
  filename: string;
  category: 'image' | 'document' | 'spreadsheet' | 'unknown';
}

// Good
async function scanDirectory(path: string): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  // ...
  return results;
}
```

## Adding New Parsers

To add a new file parser:

1. Create `src/parsers/yourparser.ts`
2. Implement the parsing logic
3. Export from `src/index.ts`
4. Add CLI command in `src/cli.ts`
5. Update documentation

Example:

```typescript
// src/parsers/pdf.ts
import { ExtractedVehicle } from '../extractor.js';

export class PdfParser {
  async parse(filePath: string): Promise<ExtractedVehicle[]> {
    // Implementation
  }
}
```

## Adding Vehicle Makes/Models

To add new makes or models, update:

```typescript
// src/parsers/path.ts
const MAKES = new Map([
  // Add new makes here
  ['newmake', 'NewMake'],
]);

const MODELS = new Set([
  // Add new models here
  'newmodel',
]);
```

## Testing

Write tests for:

- New parsers
- Edge cases
- Bug fixes

```typescript
// __tests__/csv.test.ts
import { CsvParser } from '../src/parsers/csv';

describe('CsvParser', () => {
  it('should parse basic CSV', async () => {
    const parser = new CsvParser();
    const result = await parser.parseContent('year,make,model\n1974,Chevrolet,C10');
    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(1974);
  });
});
```

## Documentation

- Update README.md for new features
- Add JSDoc comments to public APIs
- Include usage examples

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create PR to main
4. After merge, tag release

## Questions?

- Open an issue for questions
- Join our Discord (coming soon)
- Email: contributors@nuke.com

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
