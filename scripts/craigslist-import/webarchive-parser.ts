/**
 * Safari Webarchive Parser
 * Extracts HTML content and embedded resources from Safari .webarchive files
 *
 * Safari webarchive files are Apple binary plist format containing:
 * - WebMainResource.WebResourceData - Main HTML content
 * - WebSubresources - Embedded images/CSS/JS
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface WebarchiveContent {
  html: string;
  mainResourceUrl: string | null;
  mimeType: string | null;
  subresources: WebarchiveSubresource[];
}

export interface WebarchiveSubresource {
  url: string;
  mimeType: string;
  data: Buffer;
  filename: string;
}

/**
 * Parse a Safari .webarchive file and extract its contents
 * Uses macOS plutil to convert binary plist to XML, then parses XML
 */
export async function parseWebarchive(filePath: string): Promise<WebarchiveContent | null> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return null;
    }

    // Try to parse using macOS plutil (converts binary plist to JSON)
    try {
      const result = parseWithPlutil(filePath);
      if (result) return result;
    } catch (plutilError) {
      console.warn(`plutil parsing failed for ${filePath}:`, plutilError);
    }

    // Fallback: Try to extract HTML directly using binary search
    try {
      const result = parseWithBinarySearch(filePath);
      if (result) return result;
    } catch (binaryError) {
      console.warn(`Binary search parsing failed for ${filePath}:`, binaryError);
    }

    return null;
  } catch (error) {
    console.error(`Error parsing webarchive ${filePath}:`, error);
    return null;
  }
}

function parseWithPlutil(filePath: string): WebarchiveContent | null {
  // Convert binary plist to JSON using plutil (macOS only)
  const tempJsonPath = `/tmp/webarchive-${Date.now()}.json`;

  try {
    // plutil -convert json -o output.json input.webarchive
    execSync(`plutil -convert json -o "${tempJsonPath}" "${filePath}"`, {
      encoding: 'utf-8',
      timeout: 30000,
    });

    const jsonContent = fs.readFileSync(tempJsonPath, 'utf-8');
    const plist = JSON.parse(jsonContent);

    // Clean up temp file
    fs.unlinkSync(tempJsonPath);

    return extractFromPlist(plist);
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }
    throw error;
  }
}

function extractFromPlist(plist: any): WebarchiveContent | null {
  const mainResource = plist.WebMainResource;
  if (!mainResource) {
    console.error('No WebMainResource found in plist');
    return null;
  }

  // WebResourceData can be a base64 string or binary data
  let html: string;
  const resourceData = mainResource.WebResourceData;

  if (typeof resourceData === 'string') {
    // Base64 encoded
    html = Buffer.from(resourceData, 'base64').toString('utf-8');
  } else if (Buffer.isBuffer(resourceData)) {
    html = resourceData.toString('utf-8');
  } else if (resourceData && typeof resourceData === 'object') {
    // plutil JSON output stores binary as base64 in a $data field
    if (resourceData.$data) {
      html = Buffer.from(resourceData.$data, 'base64').toString('utf-8');
    } else {
      console.error('Unknown WebResourceData format:', typeof resourceData);
      return null;
    }
  } else {
    console.error('Unknown WebResourceData format:', typeof resourceData);
    return null;
  }

  const mainResourceUrl = mainResource.WebResourceURL || null;
  const mimeType = mainResource.WebResourceMIMEType || null;

  // Extract subresources
  const subresources: WebarchiveSubresource[] = [];
  const webSubresources = plist.WebSubresources || [];

  for (const sub of webSubresources) {
    if (!sub.WebResourceData || !sub.WebResourceURL) continue;

    let data: Buffer;
    const subData = sub.WebResourceData;

    if (typeof subData === 'string') {
      data = Buffer.from(subData, 'base64');
    } else if (Buffer.isBuffer(subData)) {
      data = subData;
    } else if (subData && subData.$data) {
      data = Buffer.from(subData.$data, 'base64');
    } else {
      continue;
    }

    const url = sub.WebResourceURL;
    const mimeType = sub.WebResourceMIMEType || 'application/octet-stream';

    // Generate filename from URL
    let filename = path.basename(new URL(url).pathname);
    if (!filename || filename === '/') {
      filename = `resource-${subresources.length}`;
    }

    subresources.push({
      url,
      mimeType,
      data,
      filename,
    });
  }

  return {
    html,
    mainResourceUrl,
    mimeType,
    subresources,
  };
}

function parseWithBinarySearch(filePath: string): WebarchiveContent | null {
  // Fallback method: search for HTML content directly in binary file
  const content = fs.readFileSync(filePath);

  // Look for HTML doctype or html tag
  const htmlStartPatterns = [
    Buffer.from('<!DOCTYPE html'),
    Buffer.from('<!doctype html'),
    Buffer.from('<html'),
    Buffer.from('<HTML'),
  ];

  let htmlStart = -1;
  for (const pattern of htmlStartPatterns) {
    const index = content.indexOf(pattern);
    if (index !== -1 && (htmlStart === -1 || index < htmlStart)) {
      htmlStart = index;
    }
  }

  if (htmlStart === -1) {
    return null;
  }

  // Look for end of HTML
  const htmlEndPatterns = [
    Buffer.from('</html>'),
    Buffer.from('</HTML>'),
  ];

  let htmlEnd = -1;
  for (const pattern of htmlEndPatterns) {
    const index = content.indexOf(pattern, htmlStart);
    if (index !== -1) {
      htmlEnd = index + pattern.length;
      break;
    }
  }

  if (htmlEnd === -1) {
    // Take everything from htmlStart if no closing tag found
    htmlEnd = content.length;
  }

  // Extract HTML
  let html = content.slice(htmlStart, htmlEnd).toString('utf-8');

  // Clean up any binary data that might have been included
  html = html.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Try to extract URL from the binary content
  let mainResourceUrl: string | null = null;
  const urlMatch = content.toString('utf-8', 0, Math.min(content.length, 5000))
    .match(/WebResourceURL[^\x00]*?(https?:\/\/[^\x00\s"]+)/);
  if (urlMatch) {
    mainResourceUrl = urlMatch[1];
  }

  return {
    html,
    mainResourceUrl,
    mimeType: 'text/html',
    subresources: [],
  };
}

/**
 * Extract images from webarchive subresources and save to temporary files
 */
export async function extractImagesToTempDir(
  content: WebarchiveContent,
  tempDir: string
): Promise<Map<string, string>> {
  const urlToPathMap = new Map<string, string>();

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  for (const sub of content.subresources) {
    if (!sub.mimeType.startsWith('image/')) continue;

    // Determine file extension
    let ext = '.bin';
    if (sub.mimeType === 'image/jpeg') ext = '.jpg';
    else if (sub.mimeType === 'image/png') ext = '.png';
    else if (sub.mimeType === 'image/gif') ext = '.gif';
    else if (sub.mimeType === 'image/webp') ext = '.webp';

    // Create safe filename
    let filename = sub.filename;
    if (!filename.includes('.')) {
      filename += ext;
    }
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    const outputPath = path.join(tempDir, filename);
    fs.writeFileSync(outputPath, sub.data);

    urlToPathMap.set(sub.url, outputPath);
  }

  return urlToPathMap;
}

// Test function
async function testParse(filePath: string) {
  console.log(`Parsing: ${filePath}`);
  const result = await parseWebarchive(filePath);

  if (result) {
    console.log('Success!');
    console.log('Main URL:', result.mainResourceUrl);
    console.log('MIME Type:', result.mimeType);
    console.log('HTML length:', result.html.length);
    console.log('Subresources:', result.subresources.length);
    console.log('\nFirst 500 chars of HTML:');
    console.log(result.html.substring(0, 500));
  } else {
    console.log('Failed to parse webarchive');
  }
}

// Run test if called directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const testFile = process.argv[2];
  if (testFile) {
    testParse(testFile);
  } else {
    console.log('Usage: npx tsx webarchive-parser.ts <file.webarchive>');
  }
}
