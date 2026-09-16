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

    /// The TRUE capture instant, read from the file's embedded EXIF
    /// DateTimeOriginal (+ OffsetTimeOriginal when present). This is the raw
    /// source of truth — it survives intact even when PHAsset.creationDate is
    /// the date the photo was *re-added* to the library (iCloud restore, shared
    /// album, AirDrop), which is how 2018/2019 photos got stamped "today" and
    /// contaminated the wrong vehicle's timeline. Always prefer this over the
    /// OS-supplied creationDate. Returns nil only when the file carries no
    /// DateTimeOriginal (stripped EXIF) — caller falls back to creationDate.
    static func captureDate(from data: Data) -> Date? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
              let original = exif[kCGImagePropertyExifDateTimeOriginal] as? String
        else { return nil }

        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")

        // DateTimeOriginal is local wall-clock ("yyyy:MM:dd HH:mm:ss").
        // OffsetTimeOriginal ("-07:00") pins it to a real instant when present.
        if let offset = exif[kCGImagePropertyExifOffsetTimeOriginal] as? String {
            fmt.dateFormat = "yyyy:MM:dd HH:mm:ssXXXXX"
            if let d = fmt.date(from: original + offset) { return d }
        }
        // No embedded offset: interpret the wall-clock in the device's current
        // zone. Still the file's own date — never the re-add date.
        fmt.dateFormat = "yyyy:MM:dd HH:mm:ss"
        fmt.timeZone = .current
        return fmt.date(from: original)
    }
}
