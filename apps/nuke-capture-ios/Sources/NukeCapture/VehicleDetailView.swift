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
import UIKit

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

    // Inline provenance — the {field}_source columns. Non-null here means the
    // value drills to a real source row (get_field_provenance), so the spec row
    // gets a tap affordance; null means the value stays honest dead text (the
    // three-shelf law / click-through-ready rule — an empty drill is worse than
    // no drill). Only the fields that carry a _source column on vehicles.
    let vin_source: String?
    let mileage_source: String?
    let transmission_source: String?
    let engine_source: String?
    let color_source: String?

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
/// Carries the per-image analysis atoms so a tap opens the photo's analysis
/// (the photo→analysis path) without a second fetch. All atom fields optional —
/// a photo renders "Not analyzed yet" when they're absent, never a fabrication.
private struct VehicleGalleryImage: Decodable, Identifiable {
    let id: UUID
    let image_url: String?
    let thumbnail_url: String?
    let is_primary: Bool?
    // Analysis atoms (vision verdict) — present once the image is understood.
    let taken_at: String?
    let labels: [String]?      // 'scene:x' / 'phase:y' / 'intent:z' + components
    let ai_processing_status: String?
}

/// The signed-in viewer's ASSET relationship to this vehicle — his ownership /
/// provenance. Read from the SAME tables the web uses (vehicle_user_permissions
/// + ownership_verifications), never fabricated. nil when the vehicle is not the
/// viewer's (tenet 5 / C0): the app never claims ownership of a vehicle that
/// isn't his (e.g. a sold truck).
private struct VehiclePermissionRow: Decodable {
    let role: String?
    let granted_at: String?
    let is_active: Bool?
    let revoked_at: String?
}
private struct OwnershipVerificationRow: Decodable {
    let status: String?            // approved | expired | pending | rejected
    let approved_at: String?
    let verification_type: String?
    let verification_category: String?
}
struct VehicleRelationship {
    let role: String               // owner | co_owner | contributor | …
    let since: String?             // "yyyy-MM-dd" granted_at
    let titleVerified: Bool        // an APPROVED title verification exists
    let verificationStatus: String? // honest state when not approved (expired/pending)
    let verifiedAt: String?
}

struct VehicleDetailView: View {
    let vehicleId: String
    /// TRUE (default) = wrap in own NavigationStack + show Done (sheet call sites).
    /// FALSE = pushed onto an existing stack; that stack owns the bar/back chevron.
    var embedInNavigationStack: Bool = true
    /// DEBUG screenshot loop only: auto-open this spec field's provenance sheet on
    /// load (deterministic capture of the drill state, no fragile sim-tapping).
    var debugOpenField: String? = nil
    @Environment(\.dismiss) private var dismiss

    @State private var vehicle: VehicleHeaderRow?
    @State private var images: [VehicleGalleryImage] = []
    @State private var relationship: VehicleRelationship?   // ASSET window (owner-scoped)
    @State private var loadError: String?
    @State private var loaded = false
    @State private var galleryOpen = false
    @State private var selectedPhoto: VehicleGalleryImage?  // photo→analysis drill
    @State private var provenanceDrill: SpecDrill?          // spec value → its source

    init(vehicleId: String, embedInNavigationStack: Bool = true, debugOpenField: String? = nil) {
        self.vehicleId = vehicleId
        self.embedInNavigationStack = embedInNavigationStack
        self.debugOpenField = debugOpenField
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
                            ToolbarItem(placement: .topBarTrailing) { shareButton }
                        }
                }
            } else {
                content
                    .navigationTitle("Vehicle")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) { shareButton }
                    }
            }
        }
        .task(id: vehicleId) { await load() }
        .sheet(item: $provenanceDrill) { drill in
            FieldProvenanceSheet(vehicleId: vehicleId, drill: drill)
        }
        .fullScreenCover(isPresented: $galleryOpen) {
            FullScreenGalleryView(images: galleryURLs)
        }
        // Photo→analysis drill: open the tapped image's vision atoms +
        // provenance. Reuses the shared AnalyzedEvidenceView so there's one
        // analysis surface, not a parallel one. Atoms parsed from the row's
        // labels; an unanalyzed image shows "Analysis pending" with a path,
        // never fabricated atoms.
        .fullScreenCover(item: $selectedPhoto) { img in
            AnalyzedEvidenceView(photo: analyzedPhoto(from: img))
        }
    }

    /// Build an AnalyzedPhoto (the shared evidence-view model) from a gallery
    /// row. Parses the 'scene:'/'phase:'/'intent:' label facets the BYOK vision
    /// pipeline writes; everything else becomes a component. Real atoms only —
    /// when labels are empty the evidence view renders "Analysis pending".
    private func analyzedPhoto(from img: VehicleGalleryImage) -> AnalyzedPhoto {
        let labels = img.labels ?? []
        func facet(_ prefix: String) -> String? {
            labels.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
        }
        let components = labels.filter {
            !$0.hasPrefix("scene:") && !$0.hasPrefix("phase:") && !$0.hasPrefix("intent:")
        }
        return AnalyzedPhoto(
            id: img.id,
            url: img.image_url,
            thumb: img.thumbnail_url ?? img.image_url,
            vehicle_id: UUID(uuidString: vehicleId),
            taken_at: img.taken_at,
            file_name: nil,
            scene: facet("scene:"),
            phase: facet("phase:"),
            intent: facet("intent:"),
            components: components.isEmpty ? nil : components,
            analyzed_at: nil,
            analyzed_by: nil
        )
    }

    // ─── Scrolling build sheet ───────────────────────────────────────────────
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                titleBlock
                assetWindow          // ASSET: his relationship/provenance
                specTable            // TECHNICAL
                photoStrip           // CONTENT (each photo → its analysis)
                if vehicle != nil {
                    InvestmentProofView(vehicleId: vehicleId)   // COMMODITY
                }
                webCTA
                Spacer(minLength: 0)
            }
        }
    }

    // ─── Hero — sized render thumb (NOT the raw original), tap → full gallery.
    // The hero is a 240pt strip, not a full-screen view, so it must NOT load the
    // raw object url: measured, that was a 2.9 MB decode on the main thread per
    // appear. width=1000 keeps it crisp full-bleed at ~60 KB. Full-res lives
    // only in the full-screen gallery (tap the hero to get there).
    @ViewBuilder private var hero: some View {
        if let urlStr = vehicle?.primary_image_url {
            Button { galleryOpen = true } label: {
                CachedAsyncImage(url: NukeImage.thumb(urlStr, width: 1000)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color(.secondarySystemFill).overlay { ProgressView() }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 240)
                .clipped()
                .overlay(alignment: .bottomTrailing) {
                    // A quiet affordance that the hero opens the full set.
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(.black.opacity(0.35), in: Circle())
                        .padding(8)
                }
            }
            .buttonStyle(.plain)
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

    // ─── ASSET window — the viewer's real relationship to this vehicle.
    // His ownership/provenance: is it his, what role, title-verified, since
    // when. Sourced from vehicle_user_permissions + ownership_verifications
    // (the same tables the web reads). Renders ONLY when an active permission
    // exists for the signed-in viewer — a vehicle that isn't his shows nothing
    // here, never a false ownership claim (tenet 5 / C0). The title-verified
    // rung lights ONLY on an approved verification; expired/pending read
    // honestly. Each row is a flat record line, structure not color.
    @ViewBuilder private var assetWindow: some View {
        if let rel = relationship {
            VStack(alignment: .leading, spacing: 0) {
                Text("ASSET")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                // Role — his relationship to the asset (owner / co-owner / …).
                LabeledContent {
                    Text(rel.role.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.primary)
                } label: {
                    Text("Your role").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.vertical, 5)
                Divider()

                // Title-verified rung — honest about the verification state.
                LabeledContent {
                    if rel.titleVerified {
                        Label("Title-verified", systemImage: "checkmark.seal.fill")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.green)
                    } else if let vs = rel.verificationStatus {
                        // A verification exists but isn't approved — say so.
                        Text("Title \(vs)")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Not title-verified")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                } label: {
                    Text("Verification").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.vertical, 5)

                // Since when — granted_at (verified date when present).
                if let since = rel.verifiedAt ?? rel.since {
                    Divider()
                    LabeledContent {
                        Text(since)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.primary)
                    } label: {
                        Text(rel.verifiedAt != nil ? "Verified" : "Since")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 5)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    // ─── Spec table — only the non-null fields. Every value that has a recorded
    // source (a {field}_source) is TAPPABLE → its provenance: the door-jamb VIN
    // plate photo, the observation that recorded it, how sure, from where. A
    // value with no recorded source stays honest dead text — an empty drill is
    // worse than no drill (the three-shelf law / "no number without a table
    // behind it"). Long-press any value to copy it.
    @ViewBuilder private var specTable: some View {
        if let v = vehicle, hasAnySpec(v) {
            VStack(alignment: .leading, spacing: 0) {
                Text("SPECIFICATIONS")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                VStack(spacing: 0) {
                    ForEach(specItems(v)) { item in
                        specRow(item)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    /// Spec rows in display order. `field` = the get_field_provenance key (nil →
    /// never drillable); `source` = the inline {field}_source value (non-nil →
    /// the value drills to a real source row). Only present values survive.
    private func specItems(_ v: VehicleHeaderRow) -> [SpecItem] {
        [
            SpecItem(label: "VIN",          value: v.vin,                                    field: "vin",          source: v.vin_source),
            SpecItem(label: "Mileage",      value: v.mileage.map { "\($0.formatted()) mi" }, field: "mileage",      source: v.mileage_source),
            SpecItem(label: "Transmission", value: v.transmission,                           field: "transmission", source: v.transmission_source),
            SpecItem(label: "Drivetrain",   value: v.drivetrain,                             field: nil,            source: nil),
            SpecItem(label: "Body",         value: v.body_style,                             field: nil,            source: nil),
            SpecItem(label: "Color",        value: v.color,                                  field: "color",        source: v.color_source),
            SpecItem(label: "Interior",     value: v.interior_color,                         field: nil,            source: nil),
            SpecItem(label: "Engine",       value: v.engine_type,                            field: "engine",       source: v.engine_source),
            SpecItem(label: "Fuel",         value: v.fuel_type,                              field: nil,            source: nil),
            SpecItem(label: "Location",     value: location(v),                              field: nil,            source: nil),
        ].filter { $0.value?.isEmpty == false }
    }

    /// One spec row. Drillable rows (value + recorded source) carry a chevron and
    /// open the field's provenance sheet; the rest are plain. Long-press to copy.
    @ViewBuilder private func specRow(_ item: SpecItem) -> some View {
        let drillable = item.field != nil && (item.source?.isEmpty == false)
        Group {
            if drillable {
                Button {
                    provenanceDrill = SpecDrill(label: item.label, value: item.value ?? "", field: item.field!)
                } label: {
                    specRowBody(item, drillable: true)
                }
                .buttonStyle(.plain)
            } else {
                specRowBody(item, drillable: false)
            }
        }
        .contextMenu {
            if let value = item.value, !value.isEmpty {
                Button {
                    UIPasteboard.general.string = value
                } label: { Label("Copy \(item.label)", systemImage: "doc.on.doc") }
            }
        }
        Divider()
    }

    @ViewBuilder private func specRowBody(_ item: SpecItem, drillable: Bool) -> some View {
        LabeledContent {
            HStack(spacing: 6) {
                Text(item.value ?? "")
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.trailing)
                if drillable {
                    Image(systemName: "chevron.right.circle")
                        .font(.caption2)
                        .foregroundStyle(.blue)
                }
            }
        } label: {
            Text(item.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }

    /// Share the public vehicle record (the same page the web CTA opens).
    @ViewBuilder private var shareButton: some View {
        if let url = URL(string: "https://nuke.ag/vehicle/\(vehicleId)") {
            ShareLink(item: url, subject: Text(vehicle?.title ?? "Vehicle")) {
                Image(systemName: "square.and.arrow.up")
            }
        }
    }

    /// Full-screen gallery list: every loaded photo, or the hero alone as a
    /// fallback so tapping the hero never opens an empty gallery.
    private var galleryURLs: [String] {
        let urls = images.compactMap { $0.image_url }
        if !urls.isEmpty { return urls }
        if let primary = vehicle?.primary_image_url { return [primary] }
        return []
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
                            // Tap a photo → ITS analysis (vision atoms +
                            // provenance), not a flat gallery. The image is a
                            // window into the analysis (the explicit priority).
                            Button { selectedPhoto = img } label: {
                                Color(.secondarySystemFill)
                                    .frame(width: 110, height: 110)
                                    .overlay {
                                        CachedAsyncImage(url: NukeImage.thumb(img.image_url, width: 200)) { i in
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

    private func load() async {
        do {
            // One select covers header + spec table.
            let rows: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,vin,mileage,transmission,drivetrain,body_style,color,interior_color,engine_type,fuel_type,city,state,price,sale_price,nuke_estimate,primary_image_url,description,vin_source,mileage_source,transmission_source,engine_source,color_source")
                .eq("id", value: vehicleId)
                .limit(1)
                .execute()
                .value
            vehicle = rows.first
            loadError = rows.first == nil ? "Vehicle not found" : nil
            #if DEBUG
            if let f = debugOpenField, let v = vehicle,
               let item = specItems(v).first(where: { $0.field == f && ($0.source?.isEmpty == false) }) {
                provenanceDrill = SpecDrill(label: item.label, value: item.value ?? "", field: f)
            }
            #endif
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture vehicle detail load failed: %@", String(describing: error))
        }
        // Gallery is independent — a load failure here never blocks the spec
        // sheet. Pulls the analysis atoms (labels/taken_at/status) so a photo
        // tap opens its analysis without a second round-trip.
        do {
            images = try await SupabaseService.client
                .from("vehicle_images")
                .select("id,image_url,thumbnail_url,is_primary,taken_at,labels,ai_processing_status")
                .eq("vehicle_id", value: vehicleId)
                .order("is_primary", ascending: false)
                .order("created_at", ascending: false)
                .limit(12)
                .execute()
                .value
        } catch {
            NSLog("NukeCapture vehicle gallery load failed: %@", String(describing: error))
        }
        // ASSET window — the viewer's relationship. Owner-scoped via RLS; a
        // signed-out viewer or a non-owner simply gets no rows → nil → the
        // section doesn't render (no false ownership claim).
        await loadRelationship()
        loaded = true
    }

    /// Load the viewer's ASSET relationship from the same tables the web reads.
    /// vehicle_user_permissions (role/since) + ownership_verifications (title
    /// rung). RLS scopes both to the signed-in user, so a non-owner gets empty
    /// results and the ASSET window stays hidden. Never claims ownership the
    /// data doesn't support (tenet 5 / C0).
    private func loadRelationship() async {
        // anon: no asset window. The relationship is THIS viewer's, so it must
        // be scoped to the signed-in user id — vehicle_user_permissions is
        // publicly readable, so without the user_id filter a signed-in viewer
        // would see ANOTHER owner's grant and the UI would falsely claim the
        // vehicle is theirs (tenet 5 violation). Scope to currentUserId.
        guard let uid = SupabaseService.currentUserId else { return }
        do {
            let perms: [VehiclePermissionRow] = try await SupabaseService.client
                .from("vehicle_user_permissions")
                .select("role,granted_at,is_active,revoked_at")
                .eq("vehicle_id", value: vehicleId)
                .eq("user_id", value: uid)
                .execute()
                .value
            // Active, non-revoked grants only; prefer 'owner'.
            let active = perms.filter { ($0.is_active ?? true) && $0.revoked_at == nil }
            guard let perm = active.first(where: { $0.role == "owner" }) ?? active.first,
                  let role = perm.role else {
                relationship = nil
                return
            }

            // Title verification rung — approved lights the badge; other states
            // surface honestly.
            let vers: [OwnershipVerificationRow] = try await SupabaseService.client
                .from("ownership_verifications")
                .select("status,approved_at,verification_type,verification_category")
                .eq("vehicle_id", value: vehicleId)
                .eq("user_id", value: uid)
                .execute()
                .value
            let titleVers = vers.filter {
                $0.verification_type == "title" || $0.verification_category == "title_document"
            }
            let approved = titleVers.first { $0.status == "approved" }
            let anyVer = approved ?? titleVers.first

            relationship = VehicleRelationship(
                role: role,
                since: perm.granted_at.map { String($0.prefix(10)) },
                titleVerified: approved != nil,
                verificationStatus: approved == nil ? anyVer?.status : nil,
                verifiedAt: approved?.approved_at.map { String($0.prefix(10)) }
            )
        } catch {
            NSLog("NukeCapture vehicle relationship load failed: %@", String(describing: error))
        }
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
    /// The attributed / owner-stated rung: paid-by-other (no receipt) + gifted
    /// value. Above projected, below proven on the trust ladder.
    struct Attributed: Decodable { let cost: Cell; let income: Cell }
    struct Totals: Decodable {
        let invested_proven: Double?
        let invested_with_attributed: Double?
        let invested_with_projected: Double?
        let proven_income: Double?
        let net_proven: Double?
        let roi_proven_pct: Double?
    }
    /// One counterparty's net contribution to the asset — the per-party rung.
    /// Owner-only; empty when no recorded payments carry a counterparty.
    /// trust = "proven" (receipted/paid) or "attributed" (owner-stated).
    struct Party: Decodable, Identifiable {
        let party: String
        let direction: String?
        let count: Int?
        let total: Double?
        let trust: String?
        var id: String { party + (direction ?? "") + (trust ?? "") }
    }
    let is_owner_view: Bool
    let proven: Proven
    let attributed: Attributed?
    let projected: Projected
    let market: Cell
    let totals: Totals
    let by_party: [Party]?
}

struct InvestmentProofView: View {
    let vehicleId: String
    @State private var proof: InvestmentProof?
    @State private var showAttest = false

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

                    // ATTRIBUTED — owner-stated (paid-by-other / gifted). A rung
                    // below proven, above projected: real value, owner's word.
                    if let attr = p.attributed,
                       (attr.cost.value ?? 0) > 0 || (attr.income.value ?? 0) > 0 {
                        Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)
                        if (attr.cost.value ?? 0) > 0 {
                            line("Cost (owner-stated)", attr.cost.value,
                                 sub: "\(attr.cost.count ?? 0) attributed · paid by others")
                        }
                        if (attr.income.value ?? 0) > 0 {
                            line("Income (owner-stated)", attr.income.value,
                                 sub: "attributed", positive: true)
                        }
                    }

                    Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)

                    line("Labor (projected)", p.projected.labor.value,
                         sub: "\(p.projected.labor.count ?? 0) sessions · unconfirmed", dim: true)
                    line("Market est.", p.market.value, sub: p.market.confidence ?? "", dim: true)

                    Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)

                    line("Invested (proven)", p.totals.invested_proven,
                         sub: "+ projected: \(money(p.totals.invested_with_projected))", bold: true)
                    if let attr = p.attributed, (attr.cost.value ?? 0) > 0 {
                        line("Invested (+ owner-stated)", p.totals.invested_with_attributed,
                             sub: "proven + attributed", bold: true)
                    }
                    if let roi = p.totals.roi_proven_pct {
                        line("ROI (proven)", nil, sub: "on proven spend", bold: true, rawValue: "\(Int(roi))%")
                    }

                    // BY PARTY — who the money moved with. Each counterparty's
                    // net to the asset (owner-only; from payment_events).
                    if let parties = p.by_party, !parties.isEmpty {
                        Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)
                        Text("BY PARTY")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Color.secondary)
                            .padding(.bottom, 2)
                        ForEach(parties) { party in
                            line(party.party, party.total,
                                 sub: "\(party.count ?? 0) \(party.direction == "in" ? "received" : "paid") · \(party.trust ?? "proven")",
                                 positive: party.direction == "in",
                                 dim: party.trust == "attributed")
                        }
                    }

                    // Owner attests a contribution → record_owner_contribution
                    // writes an owner-stated payment_event; the proof re-rolls.
                    if p.is_owner_view {
                        Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)
                        Button { showAttest = true } label: {
                            Label("Add a contribution", systemImage: "plus.circle")
                                .font(.system(.footnote, design: .monospaced))
                                .foregroundStyle(.blue)
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 2)
                    }
                }
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        .task(id: vehicleId) { await load() }
        .sheet(isPresented: $showAttest) {
            AttestContributionView(vehicleId: vehicleId) { Task { await load() } }
        }
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

// ─── Attest a contribution: the owner-stated rung's write surface ────────────
// The owner records a party's contribution (dad bought the tires; seats
// reupholstered, no payment). Lands as an owner-stated payment_event via
// record_owner_contribution; the proof re-rolls with a new attributed rung.
// The owner's attestation IS the value-confirmation signal (the $410 guard).

private struct AttestContributionView: View {
    let vehicleId: String
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var party = ""
    @State private var amount = ""
    @State private var direction = "out"
    @State private var basis = ""
    @State private var saving = false
    @State private var error: String?

    /// Mixed-type RPC params need an Encodable struct (not a [String:String] dict).
    private struct Params: Encodable {
        let p_vehicle_id: String
        let p_party: String
        let p_amount: Double
        let p_direction: String
        let p_basis: String
    }

    private var amountValue: Double? {
        Double(amount.trimmingCharacters(in: .whitespaces))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Who contributed") {
                    TextField("Party — e.g. Dad", text: $party)
                        .textInputAutocapitalization(.words)
                }
                Section("What") {
                    TextField("Amount (USD)", text: $amount)
                        .keyboardType(.decimalPad)
                    Picker("Type", selection: $direction) {
                        Text("Cost — paid for it").tag("out")
                        Text("Income — paid in").tag("in")
                    }
                    TextField("Basis — e.g. bought tires, no receipt",
                              text: $basis, axis: .vertical)
                }
                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Owner-stated")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || (amountValue ?? 0) <= 0)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        guard let amt = amountValue, amt > 0 else { return }
        saving = true; error = nil
        defer { saving = false }
        do {
            _ = try await SupabaseService.client
                .rpc("record_owner_contribution", params: Params(
                    p_vehicle_id: vehicleId,
                    p_party: party.trimmingCharacters(in: .whitespaces),
                    p_amount: amt,
                    p_direction: direction,
                    p_basis: basis.trimmingCharacters(in: .whitespaces)
                ))
                .execute()
            onSaved()
            dismiss()
        } catch {
            self.error = "Couldn't save — \(error.localizedDescription)"
            NSLog("NukeCapture record_owner_contribution failed: %@", String(describing: error))
        }
    }
}

// ─── Spec drill-to-source: the value, then the table behind it ───────────────
// A spec row descriptor + the tapped-field token + the provenance sheet. This is
// the three-shelf law applied to the spec table: a value that has a recorded
// source opens to that source — the inline source string, how sure, the SOURCE
// PHOTO (e.g. the door-jamb VIN plate), and the observations that recorded it.
// Nothing renders here that the data didn't call into existence.

/// One spec-table row, built from the vehicle row.
struct SpecItem: Identifiable {
    let label: String
    let value: String?
    let field: String?     // get_field_provenance key; nil = never drillable
    let source: String?    // inline {field}_source; non-nil = drills to a source
    var id: String { label }
}

/// A tapped spec value awaiting its provenance sheet.
struct SpecDrill: Identifiable {
    let label: String
    let value: String
    let field: String
    var id: String { field + value }
}

/// get_field_provenance(vehicle, field) → one jsonb object. Every piece optional
/// so a sparse field still decodes; the sheet renders only what exists.
struct FieldProvenance: Decodable {
    let field: String?
    let value: String?
    let inline_source: String?
    let inline_confidence: String?     // to_jsonb text ("1","0.95")
    let source_image_url: String?
    let evidence: [Evidence]
    let observations: [Observation]

    struct Evidence: Decodable, Identifiable {
        let source: String?
        let value: String?
        let source_type: String?
        let confidence: Double?
        let verified: Bool?
        let reasoning: String?
        let image_id: String?
        let at: String?
        var id: String { (source_type ?? "") + (at ?? "") + (value ?? "") }
    }
    struct Observation: Decodable, Identifiable {
        let id: UUID
        let content: String?
        let value: String?
        let confidence: Double?
        let observed_at: String?
        let kind: String?
        let source_slug: String?
        let trust: Double?
        let source_url: String?
    }
}

struct FieldProvenanceSheet: View {
    let vehicleId: String
    let drill: SpecDrill
    @Environment(\.dismiss) private var dismiss

    @State private var prov: FieldProvenance?
    @State private var loaded = false
    @State private var zoomURL: String?
    @State private var zoomOpen = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    valueHeader
                    Divider()
                    if let p = prov {
                        sourceLine(p)
                        if let img = p.source_image_url, !img.isEmpty { sourceImage(img) }
                        if !p.observations.isEmpty { observationsSection(p.observations) }
                        if !p.evidence.isEmpty { evidenceSection(p.evidence) }
                        if hasNothing(p) { emptyState }
                    } else if loaded {
                        emptyState
                    } else {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Tracing source…").font(.footnote).foregroundStyle(.secondary)
                        }.padding(16)
                    }
                }
            }
            .navigationTitle(drill.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
        .fullScreenCover(isPresented: $zoomOpen) {
            FullScreenGalleryView(images: zoomURL.map { [$0] } ?? [])
        }
    }

    // ─── Value header — the figure, its confidence, copy ─────────────────────
    private var valueHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(drill.value)
                .font(.system(.title3, design: .monospaced).weight(.semibold))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 14) {
                if let c = confidenceText {
                    Label(c, systemImage: "gauge.with.dots.needle.50percent")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button { UIPasteboard.general.string = drill.value } label: {
                    Label("Copy", systemImage: "doc.on.doc").font(.caption)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    @ViewBuilder private func sourceLine(_ p: FieldProvenance) -> some View {
        if let src = p.inline_source, !src.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text("RECORDED SOURCE")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                Text(src).font(.footnote).foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider()
        }
    }

    @ViewBuilder private func sourceImage(_ url: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SOURCE PHOTO")
                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            Button { zoomURL = url; zoomOpen = true } label: {
                CachedAsyncImage(url: NukeImage.thumb(url, width: 1000)) { i in
                    i.resizable().scaledToFit()
                } placeholder: {
                    Color(.secondarySystemFill).frame(height: 200).overlay { ProgressView() }
                }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            Text("The on-vehicle evidence this value was read from. Tap to enlarge.")
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(16)
        Divider()
    }

    @ViewBuilder private func observationsSection(_ obs: [FieldProvenance.Observation]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("OBSERVED")
                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            ForEach(obs) { o in
                VStack(alignment: .leading, spacing: 5) {
                    if let c = o.content, !c.isEmpty {
                        Text(c).font(.footnote).foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 6) {
                        ForEach(observationFacets(o), id: \.self) { facet in
                            Text(facet).font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let u = o.source_url, let link = URL(string: u) {
                        Link("View source ↗", destination: link).font(.caption2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(16)
    }

    @ViewBuilder private func evidenceSection(_ ev: [FieldProvenance.Evidence]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("EXTRACTION EVIDENCE")
                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            ForEach(ev) { e in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(e.source_type ?? "source").font(.footnote.weight(.medium))
                        Spacer()
                        if let c = pct(e.confidence) {
                            Text(c).font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                        }
                        if e.verified == true {
                            Image(systemName: "checkmark.seal.fill").font(.caption2).foregroundStyle(.green)
                        }
                    }
                    if let r = e.reasoning, !r.isEmpty {
                        Text(r).font(.caption2).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(16)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("This value is on the vehicle record but isn't yet traced to an observation.")
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    // ─── helpers ─────────────────────────────────────────────────────────────
    private func hasNothing(_ p: FieldProvenance) -> Bool {
        (p.inline_source?.isEmpty != false) && p.source_image_url == nil
            && p.observations.isEmpty && p.evidence.isEmpty
    }

    private func observationFacets(_ o: FieldProvenance.Observation) -> [String] {
        var f: [String] = []
        if let s = o.source_slug, !s.isEmpty { f.append(s) }
        if let t = pct(o.trust) { f.append("trust \(t)") }
        if let c = pct(o.confidence) { f.append(c) }
        if let at = o.observed_at { f.append(String(at.prefix(10))) }
        return f
    }

    private var confidenceText: String? {
        guard let raw = prov?.inline_confidence, let v = Double(raw) else { return nil }
        return pct(v).map { "Confidence \($0)" }
    }

    /// 0–1 fractions scale ×100; values already >1 are treated as whole percent.
    private func pct(_ v: Double?) -> String? {
        guard let v else { return nil }
        let p = v <= 1.0 ? v * 100 : v
        return "\(Int(p.rounded()))%"
    }

    private func load() async {
        do {
            prov = try await SupabaseService.client
                .rpc("get_field_provenance",
                     params: ["p_vehicle_id": vehicleId, "p_field": drill.field])
                .execute()
                .value
        } catch {
            NSLog("NukeCapture field provenance failed: %@", String(describing: error))
        }
        loaded = true
    }
}
