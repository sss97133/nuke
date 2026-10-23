// PaperworkScanView.swift — Paperwork scan mode: thousands of receipts, work orders and titles.
// One VisionKit document-camera session = one document (deskewed pages, order kept). The screen is
// deliberately bare: a running count, the open batch, the upload queue, and one big Scan button.

import SwiftUI
import VisionKit

struct PaperworkScanView: View {
    @ObservedObject private var queue = PaperworkQueue.shared
    @Environment(\.dismiss) private var dismiss
    @State private var scanning = false
    @State private var nextIsLabel = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        stat("\(queue.capturedCount)", "pages")
                        stat("\(queue.uploadedCount)", "uploaded")
                        stat("\(queue.pendingCount)", "queued")
                    }
                    if queue.held {
                        Label("Paused: phone is hot or in Low Power Mode. Scans are saved and resume on their own.", systemImage: "thermometer.sun")
                            .font(.footnote).foregroundStyle(.orange)
                    }
                    if let err = queue.lastError {
                        Text(err).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                Section("Current batch") {
                    if let b = queue.tracker.current {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(batchTitle(b)).font(.headline)
                            Text("\"\(b.labelText)\"").font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                            Text("\(queue.tracker.documentsInBatch) documents since this card · confidence \(Int(b.confidence * 100))%")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Button("End batch", role: .destructive) { queue.closeBatch() }
                    } else {
                        Text("No batch. Scan a label card (e.g. \"Box 3, R3500 receipts 2017\") to start one.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Toggle("This is a label card", isOn: $nextIsLabel)
                }
                if queue.pages.contains(where: { $0.attempts >= 8 }) {
                    Button("Retry failed uploads") { queue.retryFailed() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    scanning = true
                } label: {
                    Label(nextIsLabel ? "Scan label card" : "Scan document", systemImage: "doc.viewfinder")
                        .font(.title3.bold()).frame(maxWidth: .infinity).padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .padding()
                .disabled(!VNDocumentCameraViewController.isSupported)
                .accessibilityIdentifier("paperwork.scan")
            }
            .navigationTitle("Paperwork")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } } }
            .fullScreenCover(isPresented: $scanning) {
                DocumentCamera { images in
                    scanning = false
                    let label = nextIsLabel
                    nextIsLabel = false
                    Task { await queue.enqueue(document: images, explicitLabel: label) }
                } onCancel: { scanning = false }
                .ignoresSafeArea()
            }
            .onAppear { queue.kick() }
        }
    }

    private func stat(_ value: String, _ caption: String) -> some View {
        VStack {
            Text(value).font(.title2.monospacedDigit().bold())
            Text(caption).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }

    private func batchTitle(_ b: PaperworkBatch) -> String {
        [b.box.map { "Box \($0)" }, b.vehicleHint, b.yearHint.map(String.init)].compactMap { $0 }.joined(separator: " · ")
            .nonEmpty ?? "Label card"
    }
}

private extension String { var nonEmpty: String? { isEmpty ? nil : self } }

/// VisionKit's document camera: auto-edge detection and deskewed pages, returned in order.
struct DocumentCamera: UIViewControllerRepresentable {
    let onFinish: ([UIImage]) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }
    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let parent: DocumentCamera
        init(_ parent: DocumentCamera) { self.parent = parent }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let images = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
            parent.onFinish(images)
        }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { parent.onCancel() }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { parent.onCancel() }
    }
}
