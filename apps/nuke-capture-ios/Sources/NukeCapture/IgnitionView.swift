// IgnitionView.swift — the first-run sequence: scan → site → record.
//
// Styling doctrine (founder ruling, 2026-06-11): STOCK native iOS appearance
// — system backgrounds, system type, default List/controls. The only custom
// treatment is monospaced digits on data values. All effort goes into the
// windows-into-data-flow: the counter ticking as the library is read, thumbs
// landing in the grid as they're found, gauges appearing the moment their
// data exists. Copy is instrument register: counts, names, timestamps,
// one-word imperatives — the app reports, it never explains.
//
// Permission action tree — every button defines a data state, no path
// undefined:
//   Allow Full Access → full scan (ScanScreen)
//   Limit Access      → scan the granted subset; the scope is a ledger fact
//                       ("Scope · N granted") with Expand as a row; no nag
//   Don't Allow       → truthful empty state, the one action that exists
//                       (Settings) — DeniedScreen

import Photos
import PhotosUI
import SwiftUI

struct IgnitionView: View {
    @ObservedObject private var engine = IgnitionEngine.shared

    var body: some View {
        NavigationStack {
            Group {
                switch engine.phase {
                case .off:
                    // Pre-permission instant: blank system background; the
                    // system dialog is the only voice here.
                    Color(.systemGroupedBackground).ignoresSafeArea()
                case .scanning:
                    ScanScreen(engine: engine)
                case .site:
                    SiteScreen(engine: engine)
                case .record:
                    RecordScreen(engine: engine)
                case .denied:
                    DeniedScreen(engine: engine)
                }
            }
            .navigationTitle("Nuke")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await engine.start() }
    }
}

// ─── Scan: the counter rips, the grid floods, the gauge reads 0 ─────────────

private struct ScanScreen: View {
    @ObservedObject var engine: IgnitionEngine
    @ObservedObject private var sync = SyncEngine.shared

    private var fraction: Double {
        engine.totalToRead > 0
            ? Double(engine.photosRead) / Double(engine.totalToRead) : 0
    }

    var body: some View {
        List {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    // The counter — photos read off the library, live.
                    Text("\(engine.photosRead)")
                        .font(.system(size: 56, weight: .semibold))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(.linear(duration: 0.05), value: engine.photosRead)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Spacer()
                    // The privacy proof: the real upload count, watched
                    // while the read counter passes thousands.
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Uploaded")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("\(sync.totalSynced)")
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                    }
                }
                .padding(.vertical, 4)

                ProgressView(value: fraction)

                // Gauges power on the moment their data exists.
                if engine.gpsPhotosFound > 0 {
                    LabeledContent("Located") {
                        Text("\(engine.gpsPhotosFound)").monospacedDigit()
                    }
                }
            }

            if engine.limitedScope {
                ScopeSection(grantedCount: engine.totalToRead)
            }

            if !engine.floodAssetIDs.isEmpty {
                Section {
                    FloodGrid(assetIDs: engine.floodAssetIDs)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            }
        }
    }
}

/// Limited-access scope, reported as fact. One Expand row — the system
/// limited-library picker — and nothing else. Never a nag.
private struct ScopeSection: View {
    let grantedCount: Int

    var body: some View {
        Section {
            LabeledContent("Scope") {
                Text("\(grantedCount) granted").monospacedDigit()
            }
            Button("Expand…") {
                presentLimitedLibraryPicker()
            }
        }
    }

    private func presentLimitedLibraryPicker() {
        guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene }).first,
              let root = scene.keyWindow?.rootViewController
        else { return }
        PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: root)
    }
}

// ─── Site: the cluster reported, the cursor handed over ─────────────────────

private struct SiteScreen: View {
    @ObservedObject var engine: IgnitionEngine

    var body: some View {
        if let cand = engine.currentCandidate {
            List {
                Section {
                    LabeledContent("Photos") {
                        Text("\(cand.photoCount)").monospacedDigit()
                    }
                    LabeledContent("Days") {
                        Text("\(cand.dayCount)").monospacedDigit()
                    }
                    LabeledContent("Years") {
                        Text(cand.yearRange).monospacedDigit()
                    }
                    LabeledContent("Center") {
                        Text(String(format: "%.4f, %.4f", cand.centerLat, cand.centerLon))
                            .monospacedDigit()
                    }
                    LabeledContent("Radius") {
                        Text("\(Int(cand.radiusMeters * 3.28084)) ft").monospacedDigit()
                    }
                } header: {
                    Text(engine.candidates.count == 1
                         ? "One site"
                         : String(format: "Site %02d of %02d",
                                  engine.candidateIndex + 1, engine.candidates.count))
                }

                Section {
                    HStack {
                        Text(String(format: "SITE %02d", engine.siteOrdinal))
                            .font(.body.weight(.semibold))
                            .monospacedDigit()
                        TextField("Name it", text: $engine.siteName)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Uploads") {
                        Text("This site only")
                    }
                }

                Section {
                    FloodGrid(assetIDs: cand.assets.suffix(8).map(\.id))
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }

                Section {
                    Button {
                        engine.confirmCurrentSite()
                    } label: {
                        Text("Confirm Site")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)

                    Button {
                        engine.rejectCurrentSite()
                    } label: {
                        Text("Not Mine")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
        }
    }
}

// ─── Record: D days, the year range, one button ─────────────────────────────

private struct RecordScreen: View {
    @ObservedObject var engine: IgnitionEngine

    var body: some View {
        List {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(engine.recordDayCount)")
                        .font(.system(size: 56, weight: .semibold))
                        .monospacedDigit()
                    Spacer()
                    Text(engine.recordYearRange)
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                LabeledContent("Days on record") {
                    Text("\(engine.recordDayCount)").monospacedDigit()
                }
                LabeledContent("Photos") {
                    Text("\(engine.recordPhotoCount)").monospacedDigit()
                }
            }

            if !engine.dayHeat.isEmpty {
                Section {
                    DayHeatGrid(counts: engine.dayHeat)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            }

            if !engine.recordSampleIDs.isEmpty {
                Section {
                    FloodGrid(assetIDs: engine.recordSampleIDs, columns: 5)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            }

            Section {
                Button {
                    engine.beginUpload()
                } label: {
                    Text(engine.recordPhotoCount > 0
                         ? "Upload \(engine.recordPhotoCount)"
                         : "Start")
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                }
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
    }
}

// ─── Denied: the truthful empty state ────────────────────────────────────────

private struct DeniedScreen: View {
    @ObservedObject var engine: IgnitionEngine
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        List {
            Section {
                LabeledContent("Photos") {
                    Text("Off")
                }
            }
            Section {
                Button("Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings → re-check; if access now exists, ignite.
            if phase == .active {
                Task { await engine.retryAfterSettings() }
            }
        }
    }
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

/// Square thumbnail grid fed by PHCachingImageManager — photos land here as
/// the scan finds them.
struct FloodGrid: View {
    let assetIDs: [String]
    var columns: Int = 4

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: columns),
            spacing: 2
        ) {
            ForEach(assetIDs, id: \.self) { id in
                IgnitionThumb(assetID: id)
            }
        }
    }
}

/// One square local thumbnail. Never hits the network — ignition reads the
/// library, it does not spend data.
struct IgnitionThumb: View {
    let assetID: String
    @State private var image: UIImage?

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                }
            }
            .clipped()
            .task(id: assetID) {
                image = await ThumbLoader.load(assetID)
            }
    }
}

/// Shared PHCachingImageManager front. deliveryMode .highQualityFormat ⇒
/// exactly one callback, so the continuation cannot double-resume.
enum ThumbLoader {
    private static let manager = PHCachingImageManager()

    static func load(_ identifier: String, side: CGFloat = 200) async -> UIImage? {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
        guard let asset = fetch.firstObject else { return nil }

        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = false

        return await withCheckedContinuation { continuation in
            manager.requestImage(
                for: asset,
                targetSize: CGSize(width: side, height: side),
                contentMode: .aspectFill,
                options: options
            ) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
}

/// One cell per recorded day, chronological, heat by photo count — the
/// record crystallized. GitHub-contribution grammar; data viz, not theme.
struct DayHeatGrid: View {
    let counts: [Int]
    private static let cols = 18

    var body: some View {
        let padded = counts + Array(
            repeating: 0,
            count: (Self.cols - counts.count % Self.cols) % Self.cols
        )
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: Self.cols),
            spacing: 2
        ) {
            ForEach(padded.indices, id: \.self) { i in
                Rectangle()
                    .fill(Self.heat(padded[i]))
                    .aspectRatio(1, contentMode: .fit)
            }
        }
    }

    private static func heat(_ count: Int) -> Color {
        switch count {
        case 0:      return Color(.systemFill)
        case 1...2:  return Color(red: 0.85, green: 0.98, blue: 0.62)   // #d9f99d
        case 3...5:  return Color(red: 0.29, green: 0.87, blue: 0.50)   // #4ade80
        case 6...9:  return Color(red: 0.08, green: 0.50, blue: 0.24)   // #15803d
        default:     return Color(red: 0.02, green: 0.37, blue: 0.27)   // #065f46
        }
    }
}
