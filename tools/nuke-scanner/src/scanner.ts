/**
 * File Scanner
 *
 * Recursively scans directories for vehicle-related files.
 */

import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

export interface ScanOptions {
  /** Directories to scan */
  paths: string[];
  /** Include hidden files/directories */
  includeHidden?: boolean;
  /** Maximum recursion depth */
  maxDepth?: number;
  /** File types to include */
  fileTypes?: {
    images?: boolean;
    documents?: boolean;
    spreadsheets?: boolean;
  };
  /** Custom file extensions to include */
  extensions?: string[];
}

export interface ScanResult {
  path: string;
  filename: string;
  extension: string;
  category: 'image' | 'document' | 'spreadsheet' | 'unknown';
  size: number;
  modified: Date;
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'tiff', 'bmp'];
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'rtf'];
const SPREADSHEET_EXTENSIONS = ['csv', 'xlsx', 'xls', 'numbers', 'ods'];

export class FileScanner {
  private options: ScanOptions;

  constructor(options: ScanOptions) {
    this.options = {
      includeHidden: false,
      maxDepth: 10,
      fileTypes: {
        images: true,
        documents: true,
        spreadsheets: true,
      },
      ...options,
    };
  }

  /**
   * Scan directories and return matching files
   */
  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const extensions = this.getAllowedExtensions();

    for (const basePath of this.options.paths) {
      // Check if path exists
      if (!fs.existsSync(basePath)) {
        console.warn(`Path does not exist: ${basePath}`);
        continue;
      }

      const stat = fs.statSync(basePath);

      if (stat.isFile()) {
        // Single file
        const result = this.processFile(basePath);
        if (result && extensions.includes(result.extension)) {
          results.push(result);
        }
      } else if (stat.isDirectory()) {
        // Directory - use glob
        const pattern = this.options.includeHidden
          ? '**/*'
          : '**/[!.]*';

        const files = await glob(pattern, {
          cwd: basePath,
          nodir: true,
          absolute: true,
          maxDepth: this.options.maxDepth,
          ignore: this.options.includeHidden ? [] : ['**/.*', '**/node_modules/**'],
        });

        for (const filePath of files) {
          const result = this.processFile(filePath);
          if (result && extensions.includes(result.extension)) {
            results.push(result);
          }
        }
      }
    }

    return results;
  }

  /**
   * Process a single file and return scan result
   */
  private processFile(filePath: string): ScanResult | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;

      const extension = path.extname(filePath).slice(1).toLowerCase();
      const category = this.categorizeFile(extension);

      return {
        path: filePath,
        filename: path.basename(filePath),
        extension,
        category,
        size: stat.size,
        modified: stat.mtime,
      };
    } catch (error) {
      console.warn(`Could not process file: ${filePath}`);
      return null;
    }
  }

  /**
   * Categorize file by extension
   */
  private categorizeFile(extension: string): ScanResult['category'] {
    if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
    if (DOCUMENT_EXTENSIONS.includes(extension)) return 'document';
    if (SPREADSHEET_EXTENSIONS.includes(extension)) return 'spreadsheet';
    return 'unknown';
  }

  /**
   * Get all allowed extensions based on options
   */
  private getAllowedExtensions(): string[] {
    const extensions: string[] = [];
    const { fileTypes, extensions: customExtensions } = this.options;

    if (fileTypes?.images) extensions.push(...IMAGE_EXTENSIONS);
    if (fileTypes?.documents) extensions.push(...DOCUMENT_EXTENSIONS);
    if (fileTypes?.spreadsheets) extensions.push(...SPREADSHEET_EXTENSIONS);
    if (customExtensions) extensions.push(...customExtensions);

    return [...new Set(extensions)];
  }

  /**
   * Get scan statistics
   */
  static getStats(results: ScanResult[]): {
    total: number;
    byCategory: Record<string, number>;
    totalSize: number;
  } {
    const byCategory: Record<string, number> = {};
    let totalSize = 0;

    for (const result of results) {
      byCategory[result.category] = (byCategory[result.category] || 0) + 1;
      totalSize += result.size;
    }

    return {
      total: results.length,
      byCategory,
      totalSize,
    };
  }
}
