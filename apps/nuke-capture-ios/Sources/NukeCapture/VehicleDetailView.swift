// VehicleDetailView.swift — the drill target from a photo's "View vehicle" row.
//
// MINIMAL by design: a hero image + "YEAR MAKE MODEL TRIM" title. This is the
// landing a photo points at, NOT a full profile (the web profile is the rich
// surface). Read-only, anon-safe — the same select shape the web uses:
//   vehicles.select(id,year,make,model,trim,primary_image_url).eq(id).limit(1)
//
// Presented from PhotoFullScreenView (a fullScreenCover, so it carries its own
// NavigationStack for the title bar + dismiss).

import SwiftUI

/// One vehicles row — exact columns, read-only.
struct VehicleHeaderRow: Decodable, Identifiable {
    let id: UUID
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    let primary_image_url: String?

    /// "YEAR MAKE MODEL TRIM" — only the parts that exist, never a lone "—".
    var title: String {
        var parts: [String] = []
        if let year { parts.append(String(year)) }   // String(): avoid "2,017" locale formatting
        if let make, !make.isEmpty { parts.append(make) }
        if let model, !model.isEmpty { parts.append(model) }
        if let trim, !trim.isEmpty { parts.append(trim) }
        return parts.joined(separator: " ").uppercased()
    }
}

struct VehicleDetailView: View {
    let vehicleId: String
    @Environment(\.dismiss) private var dismiss

    @State private var vehicle: VehicleHeaderRow?
    @State private var loadError: String?
    @State private var loaded = false

    init(vehicleId: String) {
        self.vehicleId = vehicleId
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Hero
                    if let urlStr = vehicle?.primary_image_url, let url = URL(string: urlStr) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Color(.secondarySystemFill)
                                .overlay { ProgressView() }
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

                    // Title + state
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

                    if vehicle != nil {
                        InvestmentProofView(vehicleId: vehicleId)
                    }

                    Spacer(minLength: 0)
                }
            }
            .navigationTitle("Vehicle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task(id: vehicleId) { await load() }
    }

    private func load() async {
        do {
            let rows: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,primary_image_url")
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
        loaded = true
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
