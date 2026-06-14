// CameraEXIF.swift — in-memory TIFF EXIF extraction (ImageIO, no new deps).
//
// Used by SyncEngine as a who-shot-it discriminator: iMessage-received photos
// have EXIF stripped → make == nil → rejected. Photos shot on this device
// (or any Apple device) carry Make = "Apple".

import Foundation
import ImageIO

enum CameraEXIF {
    /// Extract TIFF Make and Model from raw image bytes.
    /// Returns (nil, nil) when the data has no TIFF dictionary (stripped EXIF,
    /// screenshots, received-via-iMessage, or non-JPEG/HEIC containers).
    static func cameraInfo(from data: Data) -> (make: String?, model: String?) {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
        else { return (nil, nil) }
        return (
            tiff[kCGImagePropertyTIFFMake] as? String,
            tiff[kCGImagePropertyTIFFModel] as? String
        )
    }
}
