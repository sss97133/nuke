import Foundation
import SwiftUI

/// A current local document read never identifies another photo or establishes ownership.
struct LocalDocumentContext: Equatable {
    enum State { case unavailable, notDocument, unresolved, decoded }
    let state: State
    var year: Int? = nil
    var make: String? = nil
    var printedIdentifier: String? = nil
    /// Preserve ordinary retained analysis when no album read exists, without
    /// representing it as a current source read. Local-only unknown/document
    /// views and positively personal/document-classified frames remain held.
    func showsRetainedNarrative(localOnly: Bool, isPersonal: Bool, hasPerson: Bool = false, labels: [String], isScreenshot: Bool) -> Bool {
        guard !isPersonal, !hasPerson, !VisionEngine.isUnnecessary(labels: labels, isScreenshot: isScreenshot) else { return false }
        return state == .notDocument || !localOnly && state == .unavailable
    }

    static func read(_ review: LocalAlbumImageReview?, assetId: String, sourceVersion: String?, method: String,
                     makes: [String] = CaptureContextReader.bundledMakes) -> Self {
        guard let review, let sourceVersion, review.localIdentifier == assetId,
              review.sourceVersion == sourceVersion, review.methodVersion == method,
              review.inputSHA256.count == 64,
              review.inputSHA256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            return .init(state: .unavailable)
        }
        let text = review.textLines.joined(separator: " ")
        let document = text.range(of: #"\b(TITLE|CERTIFICATE|REGISTRATION|INVOICE|RECEIPT)\b"#,
            options: [.regularExpression, .caseInsensitive]) != nil ||
            VisionEngine.isIdentityDocument(labels: review.labels, isScreenshot: false, ocrLines: review.textLines)
        guard document else { return .init(state: review.hasPerson ? .unavailable : .notDocument) }
        guard !review.hasPerson, let decoded = CaptureContextReader.decodeDocument(review.textLines, makes: makes) else {
            return .init(state: .unresolved)
        }
        return .init(state: .decoded, year: decoded.year, make: decoded.make, printedIdentifier: decoded.serial)
    }
}

struct LocalDocumentContextRows: View {
    let context: LocalDocumentContext
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if context.state == .decoded {
                if let year = context.year { field("Year", String(year)) }
                if let make = context.make { field("Make", make) }
                field("Printed identifier", context.printedIdentifier ?? "Not resolved")
            } else {
                Text("No unambiguous vehicle context is available from this document reading.")
            }
            field("Ownership", "Unknown")
            Text("Document context only. It does not establish current ownership, identify another photograph, or file photos to a vehicle.")
                .font(.caption).foregroundStyle(.secondary)
            Text("Personal document text is not shown.").font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func field(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
    }
}
