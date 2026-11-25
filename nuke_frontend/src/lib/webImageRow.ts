/**
 * The vehicle_images row a web upload inserts: the iOS row (apps/nuke-capture-ios SupabaseService.VehicleImageRow,
 * built by buildImageRow) plus the columns only the web form has. webImageRow.parity.test.ts reads the Swift struct and
 * fails when the two diverge in columns, so a column added on one side is either added here or listed as a known
 * difference there.
 *
 * Values the browser cannot witness are not copied: no PHAsset uuid, no Apple Vision labels, no owner_verified.
 */
export const WEB_IMAGE_SOURCE = 'user_upload_web';

/** How a filed row came to be on its car: the uploader picked the car in the upload dialog at submit (a Sign-tier act),
 *  recorded with the uploader's id. A row the system files later carries its own basis through its own writer. */
export const UPLOADER_PICK_BASIS = 'uploader_pick_at_upload';

export interface WebImageRowInput {
  userId: string;
  vehicleId: string | null;
  publicUrl: string; // for a paper, its URL in the private bucket: it opens only once a reader signs it
  storagePath: string;
  fileName: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  fileHash: string;
  latitude: number | null;
  longitude: number | null;
  takenAt: string | null;
  exif: Record<string, unknown>;
  cameraMake: string | null;
  cameraModel: string | null;
  isPaper: boolean;
  aiProcessingStatus: string;
  web: {
    category: string;
    perceptualHash: string | null;
    dhash: string | null;
    duplicateOf: string | null;
    isPrimary: boolean;
    isDocument: boolean;
    documentCategory: string | null;
    documentClassification: string | null;
  };
  nowIso: string;
}

export function webImageRow(i: WebImageRowInput): Record<string, unknown> {
  return {
    // The iOS columns, same names, same meaning.
    image_url: i.publicUrl,
    storage_path: i.storagePath,
    source: WEB_IMAGE_SOURCE,
    mime_type: i.mimeType,
    file_name: i.fileName,
    file_size: i.fileSize,
    is_external: false,
    ai_processing_status: i.aiProcessingStatus,
    user_id: i.userId,
    documented_by_user_id: i.userId,
    latitude: i.latitude,
    longitude: i.longitude,
    taken_at: i.takenAt,
    file_hash: i.fileHash,
    exif_data: {
      ...i.exif,
      original_filename: i.originalFilename,
      synced_by: 'web-upload',
      camera_make: i.cameraMake,
      camera_model: i.cameraModel,
      ...(i.vehicleId ? { filing: { basis: UPLOADER_PICK_BASIS, by_user_id: i.userId, at: i.nowIso } } : {}),
    },
    // The web form's own columns.
    vehicle_id: i.vehicleId,
    filename: i.originalFilename,
    category: i.web.category,
    perceptual_hash: i.web.perceptualHash,
    dhash: i.web.dhash,
    duplicate_of: i.web.duplicateOf,
    is_duplicate: Boolean(i.web.duplicateOf),
    is_primary: i.web.isPrimary,
    is_sensitive: false,
    variants: i.isPaper ? null : { full: i.publicUrl },
    is_document: i.web.isDocument,
    document_category: i.web.documentCategory,
    document_classification: i.web.documentClassification,
    organization_status: i.vehicleId ? 'organized' : 'unorganized',
  };
}
