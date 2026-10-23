// PaperworkQueue.swift — the persisted Paperwork pipeline: scan → on-device OCR → classify (label
// card / batch / date hint) → upload to the documents path.
//
// Storage: Application Support/PaperworkQueue/<page-id>.jpg + <page-id>.json. A page leaves the
// queue only after paperwork-intake confirms it, so a force-quit or reboot loses nothing.
//
// Where pages go: the paperwork-intake edge function (service role on the server) writes the JPEG to
// the private deal-documents bucket under documents/YYYY/MM/DD/, adds a pending document_ocr_queue
// row (what document-ocr-worker drains) and a paperwork_page_evidence row. NEVER vehicle_images,
// never a capture set.
//
// Heat: OCR and upload both stop when SyncEngine.deviceTooHotOrLow (serious/critical thermal, or Low
// Power Mode on battery), the same gate the photo drain uses, and resume when it lifts.

import Foundation
import Supabase
import UIKit
import Vision

enum PaperworkOCR {
    /// Accurate-mode text recognition for one page. Call off the main thread.
    static func recognize(_ cgImage: CGImage) -> String {
        autoreleasepool {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do { try handler.perform([request]) } catch { return "" }
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        }
    }
}

@MainActor
final class PaperworkQueue: ObservableObject {
    static let shared = PaperworkQueue()

    @Published private(set) var pages: [PaperworkPage] = []
    @Published private(set) var tracker = BatchTracker()
    @Published private(set) var uploadedCount: Int
    @Published private(set) var held = false
    @Published private(set) var lastError: String?
    private var running = false
    private var observers: [NSObjectProtocol] = []

    private static let uploadedKey = "paperwork.uploadedCount"
    private static let trackerKey = "paperwork.batchTracker"
    private static let sequenceKey = "paperwork.sequence"

    let directory: URL

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PaperworkQueue", isDirectory: true)
        self.directory = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        uploadedCount = UserDefaults.standard.integer(forKey: Self.uploadedKey)
        if let data = UserDefaults.standard.data(forKey: Self.trackerKey),
           let t = try? JSONDecoder().decode(BatchTracker.self, from: data) { tracker = t }
        pages = Self.loadPages(from: base)
        let center = NotificationCenter.default
        for name in [ProcessInfo.thermalStateDidChangeNotification, Notification.Name.NSProcessInfoPowerStateDidChange,
                     UIDevice.batteryStateDidChangeNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.kick() }
            })
        }
    }

    var pendingCount: Int { pages.count }
    var capturedCount: Int { uploadedCount + pages.count }

    // MARK: capture

    /// Persists one scan session (one document, pages in order). Images are written before anything else runs.
    func enqueue(document images: [UIImage], explicitLabel: Bool, scannedAt: Date = Date()) async {
        guard !images.isEmpty else { return }
        let documentId = UUID().uuidString.lowercased()
        var seq = UserDefaults.standard.integer(forKey: Self.sequenceKey)
        let dir = directory
        var newPages: [PaperworkPage] = []
        for (i, image) in images.enumerated() {
            seq += 1
            let page = PaperworkPage(id: UUID().uuidString.lowercased(), documentId: documentId, pageIndex: i,
                                     pageCount: images.count, scannedAt: scannedAt, sequence: seq, explicitLabel: explicitLabel)
            let ok = await Task.detached(priority: .userInitiated) { () -> Bool in
                autoreleasepool {
                    guard let jpeg = image.jpegData(compressionQuality: 0.8) else { return false }
                    do {
                        try jpeg.write(to: dir.appendingPathComponent("\(page.id).jpg"), options: .atomic)
                        try JSONEncoder().encode(page).write(to: dir.appendingPathComponent("\(page.id).json"), options: .atomic)
                        return true
                    } catch { return false }
                }
            }.value
            if ok { newPages.append(page) } else { lastError = "Couldn't save page \(i + 1) to the phone" }
        }
        UserDefaults.standard.set(seq, forKey: Self.sequenceKey)
        pages.append(contentsOf: newPages)
        kick()
    }

    /// Ends the open batch (e.g. a box is finished and the next has no card).
    func closeBatch() { tracker.close(); saveTracker() }

    // MARK: pipeline

    func kick() {
        held = SyncEngine.deviceTooHotOrLow
        guard !running, !held else { return }
        running = true
        Task { await run(); running = false }
    }

    private func run() async {
        while !SyncEngine.deviceTooHotOrLow {
            // 1. OCR + classify the oldest document that hasn't been read, strictly in capture order,
            //    because a label card governs the documents after it.
            if let docId = pages.first(where: { !$0.ocrDone })?.documentId {
                await ocrAndClassify(documentId: docId)
                continue
            }
            // 2. Upload the oldest read page.
            guard let next = pages.first(where: { $0.ocrDone && $0.attempts < 8 }) else { break }
            let uploaded = await upload(next)
            if !uploaded { break }   // offline or refused: stop; a later kick retries
        }
        held = SyncEngine.deviceTooHotOrLow
    }

    private func ocrAndClassify(documentId: String) async {
        let dir = directory
        var docPages = pages.filter { $0.documentId == documentId }.sorted { $0.pageIndex < $1.pageIndex }
        for i in docPages.indices where !docPages[i].ocrDone {
            let url = dir.appendingPathComponent("\(docPages[i].id).jpg")
            let text = await Task.detached(priority: .utility) { () -> String in
                autoreleasepool {
                    guard let img = UIImage(contentsOfFile: url.path), let cg = img.cgImage else { return "" }
                    return PaperworkOCR.recognize(cg)
                }
            }.value
            docPages[i].ocrText = text
            docPages[i].ocrDone = true
        }
        var t = tracker
        docPages = PaperworkRules.classify(document: docPages, tracker: &t)
        tracker = t
        saveTracker()
        for p in docPages { save(p) }
    }

    private func upload(_ page: PaperworkPage) async -> Bool {
        let url = directory.appendingPathComponent("\(page.id).jpg")
        guard let data = try? Data(contentsOf: url) else { remove(page); return true }
        let payload = PaperworkPagePayload.make(page: page, imageData: data)
        do {
            let _: AnyJSON = try await SupabaseService.client.functions.invoke("paperwork-intake",
                options: FunctionInvokeOptions(body: payload))
            remove(page)
            uploadedCount += 1
            UserDefaults.standard.set(uploadedCount, forKey: Self.uploadedKey)
            lastError = nil
            return true
        } catch {
            var p = page
            p.attempts += 1
            p.lastError = String(describing: error).prefix(200).description
            save(p)
            lastError = p.lastError
            return false
        }
    }

    /// Re-arms pages that gave up after repeated failures.
    func retryFailed() {
        for var p in pages where p.attempts >= 8 { p.attempts = 0; save(p) }
        kick()
    }

    // MARK: persistence

    private func save(_ page: PaperworkPage) {
        if let i = pages.firstIndex(where: { $0.id == page.id }) { pages[i] = page }
        try? JSONEncoder().encode(page).write(to: directory.appendingPathComponent("\(page.id).json"), options: .atomic)
    }

    private func remove(_ page: PaperworkPage) {
        pages.removeAll { $0.id == page.id }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(page.id).jpg"))
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(page.id).json"))
    }

    private func saveTracker() {
        if let data = try? JSONEncoder().encode(tracker) { UserDefaults.standard.set(data, forKey: Self.trackerKey) }
    }

    nonisolated static func loadPages(from dir: URL) -> [PaperworkPage] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(PaperworkPage.self, from: Data(contentsOf: $0)) }
            .sorted { ($0.sequence, $0.pageIndex) < ($1.sequence, $1.pageIndex) }
    }
}
