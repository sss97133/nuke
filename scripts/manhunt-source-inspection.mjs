import { createHash } from "node:crypto";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const publicReferencePrefix = "/storage/v1/object/public/reference-docs/";

// A bucket-relative file_url is already a storage key, not a URL. Absolute
// public URLs are decoded exactly once; no other host implies our bucket.
function validateStorageKey(key, decode) {
  if (!key || key.includes("\\") || key.includes("\0")) {
    throw new Error("Invalid reference-docs storage key");
  }
  return key.split("/").map((part) => {
    let value;
    try { value = decode ? decodeURIComponent(part) : part; }
    catch { throw new Error("Invalid encoding in reference-docs storage key"); }
    if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) {
      throw new Error("Invalid reference-docs storage key segment");
    }
    // Encoded separators/dot segments are ambiguous across clients and
    // proxies, including when an absolute URL encoded the percent sign itself.
    if (/%(?:2e|2f|5c|00)/i.test(value)) {
      throw new Error("Ambiguous encoded reference-docs storage key");
    }
    return value;
  }).join("/");
}

export function resolveReferenceSource(fileUrl, projectUrl) {
  if (typeof fileUrl !== "string" || !fileUrl || fileUrl !== fileUrl.trim()) {
    throw new Error("Missing or invalid document file_url");
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(fileUrl)) {
    if (fileUrl.startsWith("/") || /[?#]/.test(fileUrl)) {
      throw new Error("Invalid relative reference-docs storage key");
    }
    return { kind: "storage", path: validateStorageKey(fileUrl, false) };
  }

  const url = new URL(fileUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only HTTP(S) source URLs without credentials are supported");
  }
  const project = new URL(projectUrl);
  // URL normalizes dot segments, so examine the original path before using it.
  const rawPath = fileUrl.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i)?.[1] || "/";
  if (url.origin === project.origin &&
      (rawPath.startsWith(publicReferencePrefix) || url.pathname.startsWith(publicReferencePrefix))) {
    if (!rawPath.startsWith(publicReferencePrefix) || url.search || url.hash) {
      throw new Error("Invalid public reference-docs URL");
    }
    return { kind: "storage", path: validateStorageKey(rawPath.slice(publicReferencePrefix.length), true) };
  }
  return { kind: "external", url: url.href };
}

const imageOps = new Set(Object.entries(OPS)
  .filter(([name]) => /^paint.*Image/i.test(name))
  .map(([, value]) => value));

// This inventories what the text parser can see. An image/path operator is not
// a classified diagram, and low text is not evidence that the page is blank.
export async function inspectPdfBuffer(buffer, openDocument = getDocument) {
  const bytes = Buffer.from(buffer);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pdf = await openDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item) => item.str || "").join(" ").trim();
        const operators = await page.getOperatorList();
        const functions = operators.fnArray;
        pages.push({
          page_number: number,
          text_characters: text.length,
          text_sha256: createHash("sha256").update(text).digest("hex"),
          below_text_chunk_threshold: text.length < 20,
          image_paint_operators: functions.filter((op) => imageOps.has(op)).length,
          path_construction_operators: functions.filter((op) => op === OPS.constructPath).length,
        });
      } finally {
        page.cleanup?.();
      }
    }
  } finally {
    await pdf.destroy();
  }
  return {
    source_sha256: sha256,
    source_bytes: bytes.length,
    page_count: pages.length,
    pages_below_text_chunk_threshold: pages.filter((p) => p.below_text_chunk_threshold).length,
    pages_with_image_paint_operators: pages.filter((p) => p.image_paint_operators > 0).length,
    pages_with_path_construction_operators: pages.filter((p) => p.path_construction_operators > 0).length,
    pages,
  };
}
