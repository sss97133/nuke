// TokenItemsSheet.swift — a header token's line items, as the web's kit/Items.tsx renders them.
//
// Tapping a header token on the web opens HeaderTokenItems: one row per item of
// `vehicle_facet_items`, grouped by facet (As built / Current / Decoded / Derived), each with its
// status, its sources (photo witness thumb, label, clock, what the source said, what it decoded,
// its limitation), its rule, its candidates (gear ratio sets), its cited availability rows, its
// equation and what would establish it. This is the same sheet on the phone. The reader decides
// every status, order and source; nothing here folds, ranks or computes. Location is read when it
// opens, exactly as the web does; every other token is carried by the profile read's masthead.
//
// `ItemText` is a port of Items.tsx's pure functions so the words match the web's character for
// character (UnitTests/TokenItemsTests.swift pins them to HeaderTokenItems.test.tsx).

import SwiftUI
import Supabase

/// The kit's words for items (`itemLabel`, `codeText`, `valueText`, `ratioText`, `equationText`).
enum ItemText {
    static func facetTitle(_ facet: String) -> String {
        switch facet {
        case "decode": return "Decoded"
        case "as_built": return "As built"
        case "current": return "Current"
        case "derived": return "Derived"
        default: return capitalizeFirst(facet.replacingOccurrences(of: "_", with: " "))
        }
    }

    /// Key segments that place the item (its facet, or the source list it belongs to), not its name.
    private static let facetSegments: Set<String> = ["as_built", "current", "derived", "sources"]

    /// The item's name from its key: `transmission.current.case_casting` → "Case casting".
    static func itemLabel(key: String, facet: String) -> String {
        let words = key.split(separator: ".", omittingEmptySubsequences: false).dropFirst()
            .map(String.init).filter { !facetSegments.contains($0) }
            .joined(separator: " ").replacingOccurrences(of: "_", with: " ")
            .trimmingCharacters(in: .whitespaces)
        return capitalizeFirst(words.isEmpty ? facetTitle(facet) : words)
    }

    static func itemLabel(_ item: FacetItem) -> String { itemLabel(key: item.key, facet: item.facet) }

    private static func capitalizeFirst(_ s: String) -> String {
        guard let f = s.first else { return s }
        return f.uppercased() + s.dropFirst()
    }

    private static let grouped: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        return f
    }()

    /// Whole numbers with separators ("2,450"); others as written ("4.1").
    static func numberText(_ n: Double) -> String {
        if n.isFinite, n == n.rounded(), abs(n) < 1e15 {
            return grouped.string(from: NSNumber(value: n)) ?? String(Int64(n))
        }
        return String(n)
    }

    private static let codePattern = try! NSRegularExpression(pattern: #"\b[a-z0-9]+(?:_[a-z0-9]+)+\b"#)

    /// Machine codes the reader sent without a label (`not_original_unit`), as words.
    static func codeText(_ s: String) -> String {
        let ns = s as NSString
        var out = s
        for m in codePattern.matches(in: s, range: NSRange(location: 0, length: ns.length)).reversed() {
            guard let r = Range(m.range, in: out) else { continue }
            out.replaceSubrange(r, with: ns.substring(with: m.range).replacingOccurrences(of: "_", with: " "))
        }
        return out
    }

    /// Gear and axle ratios read to two places (1 → "1.00"), the way ratio charts print them.
    static func ratioText(_ v: ItemJSON?) -> String? {
        guard let v else { return nil }
        let list = v.array ?? [v]
        let parts = list.compactMap { $0.number.map { String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), $0) } }
        return parts.isEmpty ? nil : parts.joined(separator: " / ")
    }

    /// An equation as the reader wrote it, with its names as words; the arithmetic is unchanged.
    static func equationText(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"\bpi\(\)"#, with: "π", options: .regularExpression)
        t = t.replacingOccurrences(of: "<>", with: "≠")
        t = t.replacingOccurrences(of: #"([a-z_])\.([a-z_])"#, with: "$1 $2", options: .regularExpression)
        return codeText(t)
    }

    /// A value as words. Arrays are sequences (gear ratios); objects are the area shapes location carries.
    static func valueText(_ value: ItemJSON?, unit: String? = nil) -> String? {
        guard let value else { return nil }
        func withUnit(_ t: String) -> String { if let unit, !unit.isEmpty { return "\(t) \(unit)" }; return t }
        switch value {
        case .null: return nil
        case .bool(let b): return b ? "Yes" : "No"
        case .number(let n): return withUnit(numberText(n))
        case .string(let s): return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : withUnit(s)
        case .array(let a):
            let parts = a.compactMap { valueText($0) }
            return parts.isEmpty ? nil : withUnit(parts.joined(separator: " / "))
        case .object(let o):
            if let label = o["label"]?.string { return label }
            if let areas = o["areas"]?.array {
                let text = areas.compactMap { $0.object.map(areaText) }.joined(separator: "; ")
                return text.isEmpty ? nil : text
            }
            if let n = o["observations"]?.number {
                return "\(numberText(n)) \(n == 1 ? "observation" : "observations"), \(day(o["first_at"]?.string)) to \(day(o["last_at"]?.string))"
            }
            return nil
        }
    }

    static func areaText(_ a: [String: ItemJSON]) -> String {
        func n(_ k: String) -> String? { a[k]?.number.map(numberText) }
        var parts: [String] = []
        if let label = a["label"]?.string, !label.isEmpty { parts.append(label) }
        if let p = n("photos") { parts.append("\(p) photos") }
        if let d = n("days") { parts.append("\(d) days") }
        if let first = a["first_taken_at"]?.string, let last = a["last_taken_at"]?.string, !first.isEmpty, !last.isEmpty {
            parts.append("\(day(first)) to \(day(last))")
        }
        return parts.joined(separator: " · ")
    }

    /// The kit's `day()`: "Jan 2, 2026", or "unknown date".
    static func day(_ iso: String?) -> String { ProfileClock.day(iso) ?? "unknown date" }

    /// Who a source is: its label, else its slug, else its kind.
    static func sourceName(_ s: FacetItemSource) -> String {
        for v in [s.label, s.slug, s.kind] { if let v, !v.isEmpty { return v } }
        return "source"
    }

    /// What a source said: the reader's label for it, else the value with codes as words.
    static func said(_ s: FacetItemSource) -> String? {
        if let l = s.value_label { return l }
        if let str = s.value?.string { return codeText(str) }
        return valueText(s.value)
    }

    /// What a source decoded, "key: value" joined; keys in a fixed order (a JSON object has none on the phone).
    static func decodedLine(_ s: FacetItemSource) -> String? {
        guard let d = s.decoded else { return nil }
        let entries = d.filter { !$0.value.isNull && $0.value != .string("") }.sorted { $0.key < $1.key }
        guard !entries.isEmpty else { return nil }
        return entries.map { "\($0.key.replacingOccurrences(of: "_", with: " ")): \(valueText($0.value) ?? "")" }.joined(separator: " · ")
    }

    /// "Rule: <label>" (or its key as words), its code and its effect.
    static func ruleText(_ rule: [String: ItemJSON]) -> String {
        var t = rule["label"]?.string ?? rule["key"]?.string.map(codeText) ?? "rule"
        if let code = rule["code"]?.string { t += " · code \(code)" }
        if let effect = rule["effect"]?.string { t += " · \(effect)" }
        return t
    }

    static func ruleName(_ rule: [String: ItemJSON]) -> String {
        rule["label"]?.string ?? rule["key"]?.string.map(codeText) ?? "rule"
    }

    static func equationLine(_ equation: [String: ItemJSON]?) -> String? {
        guard let e = equation?["expression"]?.string else { return nil }
        return "Computed: \(equationText(e))"
    }

    /// A gear ratio candidate: "M20 · 2.56 / 1.91 / 1.48 / 1.00 · reverse 3.16 · 7/8 in countershaft".
    static func candidateLine(_ c: [String: ItemJSON]) -> String {
        var parts: [String] = []
        if let code = c["code"].flatMap({ valueText($0) }) { parts.append(code) }
        if let g = ratioText(c["gears"]) { parts.append(g) }
        if let r = c["reverse"], !r.isNull, let rt = ratioText(r) { parts.append("reverse \(rt)") }
        if let cs = c["countershaft_in"].flatMap({ valueText($0) }) { parts.append("\(cs) in countershaft") }
        return parts.joined(separator: " · ")
    }

    static func availableWord(_ v: ItemJSON?) -> String? {
        switch v {
        case .bool(true)?, .string("true")?: return "available"
        case .bool(false)?, .string("false")?: return "not available"
        case .string("implied")?: return "available by inference"
        default: return nil
        }
    }

    /// A cited availability row: "US · not available · M20 4-speed".
    static func availabilityLine(_ a: [String: ItemJSON]) -> String {
        [a["market"].flatMap { valueText($0) }, availableWord(a["available"]), a["transmission"].flatMap { valueText($0) }]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func examinedLine(_ e: [String: ItemJSON]) -> String {
        let what = e["result"].flatMap { valueText($0) } ?? e["method"].flatMap { valueText($0) } ?? ""
        return "Examined: \(codeText(what)) · \(day(e["observed_at"]?.string))"
    }

    /// Runs of items sharing a facet, in the reader's order (a facet may appear in more than one run).
    static func groups(_ items: [FacetItem]) -> [(facet: String, items: [FacetItem])] {
        var out: [(facet: String, items: [FacetItem])] = []
        for item in items {
            if let last = out.indices.last, out[last].facet == item.facet { out[last].items.append(item) }
            else { out.append((item.facet, [item])) }
        }
        return out
    }

    /// The token's one value for the header row: the reader's lead item, else its first established
    /// item, else its first item with a value. Nil when the reader established nothing.
    static func headline(_ items: [FacetItem]) -> FacetItem? {
        let valued = items.filter { valueText($0.value, unit: $0.unit) != nil }
        return valued.first(where: \.lead) ?? valued.first(where: { $0.status == "established" }) ?? valued.first
    }

    /// The item's status on the app's one trust ladder. Nothing is proven from the read alone.
    static func rootStatus(_ status: String) -> RootStatus {
        switch status {
        case "established", "reading", "claim": return .attributed
        case "conflict": return .conflicting
        default: return .pending
        }
    }
}

/// A header token awaiting its line items sheet.
struct TokenDrill: Identifiable {
    let dimension: String
    let title: String
    /// The strip's claim for this token, when it has one: opened from the sheet, as before.
    var claim: Claim? = nil
    var spec: SpecDrill? = nil
    var id: String { "token:\(dimension)" }
}

/// The token's items: carried by the read, or (location) read when the sheet opens.
struct TokenItemsSheet: View {
    let vehicleId: String
    let drill: TokenDrill
    let carried: [FacetItem]
    @Environment(\.dismiss) private var dismiss
    @State private var loaded: [FacetItem]?
    @State private var loadError: String?
    @State private var claimDrill: ClaimDrill?

    private var readsOnOpen: Bool { drill.dimension == "location" }
    private var items: [FacetItem] { readsOnOpen ? (loaded ?? []) : carried }

    var body: some View {
        NavigationStack {
            List {
                if readsOnOpen && loaded == nil && loadError == nil {
                    Text("Reading location…").font(.footnote).foregroundStyle(.secondary)
                } else if let loadError {
                    Text("Location read failed: \(loadError)").font(.footnote).foregroundStyle(.secondary)
                } else if items.isEmpty {
                    Text("No line items read for \(drill.dimension.replacingOccurrences(of: "_", with: " ")).")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(Array(ItemText.groups(items).enumerated()), id: \.offset) { _, group in
                    Section(ItemText.facetTitle(group.facet)) {
                        ForEach(Array(group.items.enumerated()), id: \.offset) { _, item in
                            TokenItemRow(item: item)
                        }
                    }
                }
                if let claim = drill.claim {
                    Section {
                        Button {
                            claimDrill = ClaimDrill(title: drill.title, claim: claim, spec: drill.spec)
                        } label: {
                            Label("Header value: \(claim.sourceLine)", systemImage: "doc.text.magnifyingglass")
                        }
                        .accessibilityIdentifier("token-items-header-claim")
                    }
                }
            }
            .accessibilityIdentifier("token-items-\(drill.dimension)")
            .navigationTitle(drill.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .task(id: drill.id) { if readsOnOpen && loaded == nil { await loadLocation() } }
        .sheet(item: $claimDrill) { d in ClaimSourceSheet(vehicleId: vehicleId, drill: d) }
    }

    /// Location's sources are photo areas the profile read does not carry; read them on open, as the web does.
    private func loadLocation() async {
        do {
            let list: LossyList<FacetItem> = try await SupabaseService.client
                .rpc("vehicle_facet_items", params: ["p_vehicle_id": vehicleId, "p_dimension": "location"])
                .execute()
                .value
            loaded = list.items
        } catch {
            loadError = error.localizedDescription
            NSLog("NukeCapture location items read failed: %@", String(describing: error))
        }
    }
}

/// One item, as the web's ItemRow: name, value and status, then sources (or conflicting sides),
/// candidates, examined readings, availability, rule, equation, and what would establish it.
struct TokenItemRow: View {
    let item: FacetItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(ItemText.itemLabel(item)).font(.footnote).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                if let v = ItemText.valueText(item.value, unit: item.unit) {
                    Text(v).font(.system(.footnote, design: .monospaced)).multilineTextAlignment(.trailing)
                }
                ItemStatusChip(status: item.status)
            }
            if let stated = item.stated { caption("Stated: \(stated)") }
            if !item.sides.isEmpty {
                ForEach(Array(item.sides.enumerated()), id: \.offset) { _, side in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(ItemText.valueText(side.value) ?? "No value").font(.footnote)
                        ForEach(Array(side.sources.enumerated()), id: \.offset) { _, s in ItemSourceLine(source: s) }
                    }
                    .padding(.leading, 8)
                }
            } else {
                ForEach(Array(item.sources.enumerated()), id: \.offset) { _, s in ItemSourceLine(source: s) }
            }
            ForEach(Array(item.candidates.enumerated()), id: \.offset) { _, c in
                VStack(alignment: .leading, spacing: 2) {
                    Text(ItemText.candidateLine(c)).font(.system(.footnote, design: .monospaced))
                    citation(c)
                }
            }
            ForEach(Array(item.examined.enumerated()), id: \.offset) { _, e in caption(ItemText.examinedLine(e)) }
            ForEach(Array(item.availability.enumerated()), id: \.offset) { _, a in
                VStack(alignment: .leading, spacing: 2) {
                    Text(ItemText.availabilityLine(a)).font(.footnote)
                    if let q = a["quoted"]?.string { caption("Quoted: “\(q)”") }
                    if let i = a["inference"]?.string { caption("Inference: \(i)") }
                    if let w = a["conflicts_with"]?.string { caption("Disagrees with: \(w)") }
                    citation(a)
                }
            }
            if let rule = item.rule {
                if let url = WebLink.url(rule["citation_url"]?.string), rule["citation_url"]?.string?.lowercased().hasPrefix("http") == true {
                    Link(destination: url) { Text("Rule: \(ItemText.ruleText(rule))").font(.caption) }
                } else {
                    caption("Rule: \(ItemText.ruleText(rule))")
                }
            }
            if let eq = ItemText.equationLine(item.equation) { caption(eq) }
            if let needed = item.needed, item.status != "established" { caption("Needed: \(needed)") }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("token-item-\(item.key)")
    }

    private func caption(_ s: String) -> some View {
        Text(s).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func citation(_ row: [String: ItemJSON]) -> some View {
        if let raw = row["citation_url"]?.string, raw.lowercased().hasPrefix("http"), let url = WebLink.url(raw) {
            let title = row["citation_title"].flatMap { ItemText.valueText($0) } ?? "citation"
            let locator = row["citation_locator"]?.string.map { " · \($0)" } ?? ""
            Link(destination: url) { Text(title + locator).font(.caption) }
        }
    }
}

/// The reader's status word, tinted on the trust ladder's colors.
struct ItemStatusChip: View {
    let status: String
    var body: some View {
        Text(status.replacingOccurrences(of: "_", with: " "))
            .font(.system(.caption2, design: .monospaced))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(color.opacity(0.5), lineWidth: 0.75))
    }
    private var color: Color {
        switch status {
        case "established": return .green
        case "conflict": return .orange
        case "missing": return .secondary
        default: return .primary
        }
    }
}

/// One source: its photo witness, who said it (opening the source when it is a web page), when,
/// what it said, what it decoded and its limitation.
struct ItemSourceLine: View {
    let source: FacetItemSource

    private var thumbURL: URL? {
        guard source.witness?.kind == "image", let t = source.witness?.thumb else { return nil }
        return NukeImage.thumb(t, width: 120)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let url = thumbURL {
                CachedAsyncImage(url: url, maxPixel: 120) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Color(.secondarySystemBackground)
                }
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .accessibilityLabel("Photo witness for \(ItemText.sourceName(source))")
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if let raw = source.url, raw.lowercased().hasPrefix("http"), let url = WebLink.url(raw) {
                        Link(ItemText.sourceName(source), destination: url).font(.caption.weight(.semibold))
                    } else {
                        Text(ItemText.sourceName(source)).font(.caption.weight(.semibold))
                    }
                    Text(ItemText.day(source.observed_at)).font(.system(.caption2, design: .monospaced)).foregroundStyle(.tertiary)
                }
                if let said = ItemText.said(source) { Text(said).font(.caption).foregroundStyle(.secondary) }
                if let d = ItemText.decodedLine(source) { Text(d).font(.caption).foregroundStyle(.secondary) }
                if let l = source.limitation {
                    Text("Limitation: \(l)").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
