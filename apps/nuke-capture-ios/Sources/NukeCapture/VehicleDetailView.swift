// VehicleDetailView.swift — the drill target from a photo's "View vehicle" row
// AND from the Explore grid.
//
// Build-2 §5: a real record, drillable. A traditional build sheet — hero, the
// "YEAR MAKE MODEL TRIM" title, a SPEC TABLE (only the fields that exist), a
// PHOTOS strip into a full-screen gallery, the INVESTMENT proof ledger (proven
// vs projected), and a CTA out to the web profile. Read-only, anon-safe.
//
// Two call sites, one view:
//   • PhotoFullScreenView / ProfileTab present it as a .sheet → embedInNavigationStack
//     defaults to TRUE, so it carries its own NavigationStack + Done button.
//   • ExploreView PUSHES it via .navigationDestination → embedInNavigationStack:false,
//     so the pushing stack owns the bar/back chevron (no dead-end Done button).

import SwiftUI

/// One vehicles row — exact columns, read-only. Header + full spec set in a
/// single select so one fetch covers the title bar AND the spec table.
/// Hashable so it can be a NavigationLink/​.navigationDestination value.
struct VehicleHeaderRow: Decodable, Identifiable, Hashable {
    let id: UUID
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    let primary_image_url: String?

    // Spec columns (all optional — render only what exists, never a lone "—").
    let vin: String?
    let mileage: Int?
    let transmission: String?
    let drivetrain: String?
    let body_style: String?
    let color: String?
    let interior_color: String?
    let engine_type: String?
    let fuel_type: String?
    let city: String?
    let state: String?
    let price: Double?
    let sale_price: Double?
    let nuke_estimate: Double?
    let description: String?

    /// "YEAR MAKE MODEL TRIM" — only the parts that exist, never a lone "—".
    var title: String {
        var parts: [String] = []
        if let year { parts.append(String(year)) }   // String(): avoid "2,017" locale formatting
        if let make, !make.isEmpty { parts.append(make) }
        if let model, !model.isEmpty { parts.append(model) }
        if let trim, !trim.isEmpty { parts.append(trim) }
        return parts.joined(separator: " ").uppercased()
    }

    // Identity by id is enough — two rows with the same vehicle id are the same
    // record. Avoids hashing every optional spec column.
    static func == (lhs: VehicleHeaderRow, rhs: VehicleHeaderRow) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// One vehicle_images row — the gallery unit. Small Decodable, exact columns.
private struct VehicleGalleryImage: Decodable, Identifiable {
    let id: UUID
    let image_url: String?
    let thumbnail_url: String?
    let is_primary: Bool?
}

struct VehicleDetailView: View {
    let vehicleId: String
    /// TRUE (default) = wrap in own NavigationStack + show Done (sheet call sites).
    /// FALSE = pushed onto an existing stack; that stack owns the bar/back chevron.
    var embedInNavigationStack: Bool = true
    @Environment(\.dismiss) private var dismiss

    @State private var vehicle: VehicleHeaderRow?
    @State private var images: [VehicleGalleryImage] = []
    @State private var loadError: String?
    @State private var loaded = false
    @State private var galleryOpen = false

    init(vehicleId: String, embedInNavigationStack: Bool = true) {
        self.vehicleId = vehicleId
        self.embedInNavigationStack = embedInNavigationStack
    }

    var body: some View {
        // Two shells around one scrolling body: a sheet brings its own stack +
        // Done; a push lets the host stack own the bar.
        Group {
            if embedInNavigationStack {
                NavigationStack {
                    content
                        .navigationTitle("Vehicle")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("Done") { dismiss() }
                            }
                        }
                }
            } else {
                content
                    .navigationTitle("Vehicle")
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .task(id: vehicleId) { await load() }
        .fullScreenCover(isPresented: $galleryOpen) {
            FullScreenGalleryView(images: images.compactMap { $0.image_url })
        }
    }

    // ─── Scrolling build sheet ───────────────────────────────────────────────
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                titleBlock
                specTable
                photoStrip
                if vehicle != nil {
                    InvestmentProofView(vehicleId: vehicleId)
                }
                webCTA
                Spacer(minLength: 0)
            }
        }
    }

    // ─── Hero (full-res original; the only place we use the un-rendered url) ──
    @ViewBuilder private var hero: some View {
        if let urlStr = vehicle?.primary_image_url, let url = URL(string: urlStr) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color(.secondarySystemFill).overlay { ProgressView() }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 240)
            .clipped()
        } else if loaded && loadError == nil {
            // Loaded, no image — a flat plate, never a broken frame.
            Color(.secondarySystemFill)
                .frame(maxWidth: .infinity)
                .frame(height: 160)
                .overlay {
                    Image(systemName: "car.side")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                }
        }
    }

    // ─── Title + load state ──────────────────────────────────────────────────
    @ViewBuilder private var titleBlock: some View {
        Group {
            if let v = vehicle {
                Text(v.title.isEmpty ? "VEHICLE" : v.title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
            } else if let loadError {
                Text(loadError)
                    .font(.footnote)
                    .foregroundStyle(.red)
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }

    // ─── Spec table — only the non-null fields, traditional LabeledContent rows
    // with monospaced values. Skip any empty field entirely (no lone "—" rows).
    @ViewBuilder private var specTable: some View {
        if let v = vehicle, hasAnySpec(v) {
            VStack(alignment: .leading, spacing: 0) {
                Text("SPECIFICATIONS")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                VStack(spacing: 0) {
                    specRow("VIN", v.vin)
                    specRow("Mileage", v.mileage.map { "\($0.formatted()) mi" })
                    specRow("Transmission", v.transmission)
                    specRow("Drivetrain", v.drivetrain)
                    specRow("Body", v.body_style)
                    specRow("Color", v.color)
                    specRow("Interior", v.interior_color)
                    specRow("Engine", v.engine_type)
                    specRow("Fuel", v.fuel_type)
                    specRow("Location", location(v))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    /// One spec row — renders ONLY if the value is present and non-empty.
    @ViewBuilder private func specRow(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            LabeledContent {
                Text(value)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.trailing)
            } label: {
                Text(label)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 5)
            Divider()
        }
    }

    private func location(_ v: VehicleHeaderRow) -> String? {
        let parts = [v.city, v.state].compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private func hasAnySpec(_ v: VehicleHeaderRow) -> Bool {
        let strings = [v.vin, v.transmission, v.drivetrain, v.body_style, v.color,
                       v.interior_color, v.engine_type, v.fuel_type, location(v)]
        return v.mileage != nil || strings.contains { ($0?.isEmpty == false) }
    }

    // ─── Photos strip — render-endpoint thumbs (200px); tap opens full-screen
    // gallery using the original image_url at full size.
    @ViewBuilder private var photoStrip: some View {
        if !images.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("PHOTOS")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("View all \(images.count) photos") { galleryOpen = true }
                        .font(.caption)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(images) { img in
                            Button { galleryOpen = true } label: {
                                Color(.secondarySystemFill)
                                    .frame(width: 110, height: 110)
                                    .overlay {
                                        AsyncImage(url: renderThumb(img.image_url, width: 200)) { i in
                                            i.resizable().scaledToFill()
                                        } placeholder: {
                                            Image(systemName: "car.side").foregroundStyle(.secondary)
                                        }
                                    }
                                    .clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    // ─── CTA — the web profile (verified 200). A plain bordered button, no skin.
    @ViewBuilder private var webCTA: some View {
        if let url = URL(string: "https://nuke.ag/vehicle/\(vehicleId)") {
            Link(destination: url) {
                HStack {
                    Text("Open on nuke.ag")
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                }
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    // ─── Render-endpoint thumbnail. Handles nested capture-relay paths AND
    // external CDN urls (the render endpoint can't transcode those — use as-is).
    private func renderThumb(_ raw: String?, width: Int) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        if let r = raw.range(of: "/vehicle-photos/") {
            let path = String(raw[r.upperBound...])
            return URL(string: "\(Config.supabaseURL)/render/image/public/vehicle-photos/\(path)?width=\(width)&resize=contain")
        }
        return URL(string: raw) // external CDN image: render endpoint can't transcode it, use as-is
    }

    private func load() async {
        do {
            // One select covers header + spec table.
            let rows: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,vin,mileage,transmission,drivetrain,body_style,color,interior_color,engine_type,fuel_type,city,state,price,sale_price,nuke_estimate,primary_image_url,description")
                .eq("id", value: vehicleId)
                .limit(1)
                .execute()
                .value
            vehicle = rows.first
            loadError = rows.first == nil ? "Vehicle not found" : nil
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture vehicle detail load failed: %@", String(describing: error))
        }
        // Gallery is independent — a load failure here never blocks the spec sheet.
        do {
            images = try await SupabaseService.client
                .from("vehicle_images")
                .select("id,image_url,thumbnail_url,is_primary")
                .eq("vehicle_id", value: vehicleId)
                .order("is_primary", ascending: false)
                .order("created_at", ascending: false)
                .limit(12)
                .execute()
                .value
        } catch {
            NSLog("NukeCapture vehicle gallery load failed: %@", String(describing: error))
        }
        loaded = true
    }
}

// ─── Full-screen gallery — in-app, full-res originals. A paged TabView; every
// CTA resolves in-app (C10 dead-link rule). Carries its own dismiss.
private struct FullScreenGalleryView: View {
    let images: [String]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TabView {
                ForEach(images, id: \.self) { urlStr in
                    if let url = URL(string: urlStr) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFit()
                        } placeholder: {
                            Color.black.overlay { ProgressView().tint(.white) }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .background(Color.black.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// ─── Investment proof: proven vs projected — the asset-provenance file ───────
// Renders compute_vehicle_investment_proof as a traditional ledger: proven
// (receipts/payments/confirmed labor) above the line, projected below, every
// cell labeled with its source + confidence. The value an auditor can verify.

struct InvestmentProof: Decodable {
    struct Cell: Decodable {
        let value: Double?
        let count: Int?
        let source: String?
        let confidence: String?
    }
    struct Proven: Decodable {
        let parts: Cell
        let confirmed_labor: Cell
        let money_in: Cell
        let money_out: Cell
    }
    struct Projected: Decodable { let labor: Cell }
    struct Totals: Decodable {
        let invested_proven: Double?
        let invested_with_projected: Double?
        let proven_income: Double?
        let net_proven: Double?
        let roi_proven_pct: Double?
    }
    let is_owner_view: Bool
    let proven: Proven
    let projected: Projected
    let market: Cell
    let totals: Totals
}

struct InvestmentProofView: View {
    let vehicleId: String
    @State private var proof: InvestmentProof?

    private func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        return v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    var body: some View {
        Group {
            if let p = proof {
                VStack(alignment: .leading, spacing: 0) {
                    Text("INVESTMENT")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Color.secondary)
                        .padding(.top, 8).padding(.bottom, 4)

                    line("Parts", p.proven.parts.value, sub: "\(p.proven.parts.count ?? 0) receipts · proven")
                    if (p.proven.confirmed_labor.value ?? 0) > 0 {
                        line("Labor (confirmed)", p.proven.confirmed_labor.value, sub: "proven")
                    }
                    if (p.proven.money_in.value ?? 0) > 0 {
                        line("Income", p.proven.money_in.value,
                             sub: "\(p.proven.money_in.count ?? 0) payments · proven", positive: true)
                    }

                    Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)

                    line("Labor (projected)", p.projected.labor.value,
                         sub: "\(p.projected.labor.count ?? 0) sessions · unconfirmed", dim: true)
                    line("Market est.", p.market.value, sub: p.market.confidence ?? "", dim: true)

                    Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)

                    line("Invested (proven)", p.totals.invested_proven,
                         sub: "+ projected: \(money(p.totals.invested_with_projected))", bold: true)
                    if let roi = p.totals.roi_proven_pct {
                        line("ROI (proven)", nil, sub: "on proven spend", bold: true, rawValue: "\(Int(roi))%")
                    }
                }
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        .task(id: vehicleId) { await load() }
    }

    @ViewBuilder private func line(_ label: String, _ value: Double?, sub: String,
                                   positive: Bool = false, dim: Bool = false,
                                   bold: Bool = false, rawValue: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).foregroundStyle(dim ? Color.secondary : Color.primary)
                if !sub.isEmpty {
                    Text(sub).font(.system(.caption2, design: .monospaced)).foregroundStyle(Color.secondary)
                }
            }
            Spacer(minLength: 8)
            Text(rawValue ?? money(value))
                .fontWeight(bold ? .semibold : .regular)
                .foregroundStyle(positive ? Color.green : (dim ? Color.secondary : Color.primary))
        }
        .padding(.vertical, 3)
    }

    private func load() async {
        do {
            proof = try await SupabaseService.client
                .rpc("compute_vehicle_investment_proof", params: ["p_vehicle_id": vehicleId])
                .execute()
                .value
        } catch {
            NSLog("NukeCapture investment proof failed: %@", String(describing: error))
        }
    }
}
