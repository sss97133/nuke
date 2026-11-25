import SwiftUI
import Supabase

// vehicle_labor_appraisal, segment by segment, as the reader returns it: the phone twin of the web's
// nuke_frontend/src/pages/vehicle-profile/LaborAppraisal.tsx. One reader, two renderers: every hour figure, grade and
// count is the reader's; nothing is added, averaged or blended here, and the words match the web's line for line
// (UnitTests/LaborAppraisalTests.swift follows LaborAppraisal.test.tsx). The reader masks for untied viewers itself.

struct LaborRange: Decodable, Equatable {
    var hours_min: Double?
    var hours_typical: Double?
    var hours_max: Double?
}

struct LaborPart: Decodable, Equatable {
    struct CatalogPart: Decodable, Equatable { var catalog_part_id: String?; var name: String? }
    var item_id: String?
    var hours: Double?
    var operation_code: String?
    var name: String?
    var description: String?
    var part: CatalogPart?
    /// fitted | not_fitted | unwitnessed | cannot_tell
    var witness: String?
    var question_state: String?
}

struct LaborStageStep: Decodable, Equatable {
    var from_stage: String?
    var to_stage: String?
    var zone: String?
    var status: String?
    var photo_phase: String?
    var images: Int?
    var panel_count: Int?
    var hours_min: Double?
    var hours_typical: Double?
    var hours_max: Double?
    var pieces: [LaborPart]?
}

struct LaborWitnessShare: Decodable, Equatable {
    var pieces: [LaborPart]?
    var fitted_with_operation: Int?
    var fitted_without_operation: Int?
    var not_fitted: Int?
    var unwitnessed: Int?
    var cannot_tell: Int?
    var none_raised: Int?
}

struct LaborSegment: Decodable, Equatable, Identifiable {
    struct Reassembly: Decodable, Equatable { var matched: [LaborPart]?; var unmatched: [LaborPart]? }
    var segment: String
    var hours_min: Double?
    var hours_typical: Double?
    var hours_max: Double?
    var evidence_grade: String?
    var hours_basis: String?
    var paper_hours: Double?
    var book_hours: LaborRange?
    var range_below_paper: Bool?
    var evidence_count: Int?
    var hours_counted_elsewhere: Double?
    var stage_steps: [LaborStageStep]?
    var reassembly: Reassembly?
    /// The rule's identifier: kept off the screen (the web puts it in a title attribute).
    var citation: String?
    /// witnessed | unwitnessed_purchase: which of the reader's two totals the segment's hours belong to.
    var counts_in: String?
    var witnessed_hours_min: Double?
    var witnessed_hours_typical: Double?
    var witnessed_hours_max: Double?
    var witnessed_reason: String?
    var witness_share: LaborWitnessShare?
    var id: String { segment }
}

struct LaborAppraisal: Decodable, Equatable {
    struct WitnessedTotal: Decodable, Equatable {
        var hours_min: Double?
        var hours_typical: Double?
        var hours_max: Double?
        var unknown_min_segments: Int?
        /// false: the reader says its max is not witnessed (a book bound), so only the floor and typical are.
        var max_witnessed: Bool?
    }
    struct Totals: Decodable, Equatable {
        var hours_min: Double?
        var hours_typical: Double?
        var hours_max: Double?
        var by_grade: [String: LaborRange]?
        var witnessed: WitnessedTotal?
        var with_unwitnessed_purchases: LaborRange?
        var priced_segments: Int?
        var rule: String?
    }
    var vehicle_id: String?
    var as_of: String?
    var logic_version: String?
    var applicable: Bool?
    var segments: [LaborSegment]
    var totals: Totals?
}

/// The web renderer's words (LaborAppraisal.tsx), ported one function to one function.
enum LaborWords {
    private static let number: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US"); f.numberStyle = .decimal; f.maximumFractionDigits = 2
        return f
    }()

    static func h(_ n: Double?) -> String? {
        guard let n else { return nil }
        return "\(number.string(from: NSNumber(value: n)) ?? String(n)) h"
    }

    /// "8 h to 16 h, typical 12 h", or one figure when the reader's min and max agree.
    static func range(_ min: Double?, _ typical: Double?, _ max: Double?) -> String? {
        guard let typical else { return nil }
        guard let min, let max, min != max else { return h(typical) }
        return "\(h(min)!) to \(h(max)!), typical \(h(typical)!)"
    }

    static func range(_ r: LaborRange?) -> String? { r.flatMap { range($0.hours_min, $0.hours_typical, $0.hours_max) } }

    static func step(_ s: LaborStageStep) -> String {
        [
            [s.from_stage, s.to_stage].compactMap { $0 }.map(ItemText.codeText).joined(separator: " to "),
            s.zone.flatMap { $0 != "*" && !$0.contains("*") ? ItemText.codeText($0) : nil },
            s.status.map(ItemText.codeText),
            s.photo_phase.map { "photographed as \(ItemText.codeText($0))" },
            s.images.map { "\($0) \($0 == 1 ? "photo" : "photos")" },
            s.panel_count.map { "\($0) panels" },
            range(s.hours_min, s.hours_typical, s.hours_max),
        ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func partWords(_ p: LaborPart) -> String? {
        [p.part?.name, p.name, p.description].compactMap { $0 }.first { !$0.isEmpty }
    }

    /// Each named part with its hours, the rest counted. Operation codes are keys, not words: never printed.
    static func parts(_ title: String, _ parts: [LaborPart]) -> String {
        let said = parts.compactMap { p in partWords(p).map { [$0, h(p.hours)].compactMap { $0 }.joined(separator: ", ") } }
        let others = parts.count - said.count
        var line = "\(title): \(parts.count)"
        if !said.isEmpty { line += ". " + said.joined(separator: "; ") }
        if !said.isEmpty && others > 0 { line += "; \(others) more" }
        return line
    }

    private static func said(_ n: Int?, _ words: String) -> String? {
        guard let n, n > 0 else { return nil }
        return "\(n) \(words)"
    }

    /// The reader's witness counts for a segment. A piece bought but not seen fitted is never "not fitted".
    static func witness(_ s: LaborSegment) -> String? {
        var out: [String?] = []
        if let ws = s.witness_share, ws.fitted_with_operation != nil || ws.unwitnessed != nil {
            out += [
                said(ws.fitted_with_operation, "fitted with a book operation"),
                said(ws.fitted_without_operation, "fitted without a book operation"),
                said(ws.not_fitted, "not fitted"),
                (ws.unwitnessed ?? 0) > 0
                    ? "\(ws.unwitnessed!) bought, not seen fitted" + ((ws.none_raised ?? 0) > 0 ? " (\(ws.none_raised!) with no fitted question raised)" : "")
                    : nil,
                said(ws.cannot_tell, "cannot tell"),
            ]
        }
        let pieces = ((s.stage_steps ?? []).flatMap { $0.pieces ?? [] }
                      + (s.reassembly?.matched ?? []) + (s.reassembly?.unmatched ?? [])).filter { $0.witness != nil }
        if !pieces.isEmpty {
            func count(_ f: (LaborPart) -> Bool) -> Int { pieces.filter(f).count }
            var states: [String] = []
            for p in pieces where p.witness == "unwitnessed" {
                let st = p.question_state ?? "not raised"
                if !states.contains(st) { states.append(st) }
            }
            out.append(said(count { $0.witness == "fitted" }, "fitted"))
            out.append(said(count { $0.witness == "not_fitted" }, "not fitted"))
            for st in states {
                out.append(said(count { $0.witness == "unwitnessed" && ($0.question_state ?? "not raised") == st },
                                "bought; fitted question \(ItemText.codeText(st))"))
            }
            out.append(said(count { $0.witness == "cannot_tell" }, "cannot tell"))
        }
        let line = out.compactMap { $0 }.joined(separator: " · ")
        return line.isEmpty ? nil : line
    }

    /// The segment's witnessed hours when they differ from its hours. A missing minimum is said, never filled.
    static func witnessedHours(_ s: LaborSegment) -> String? {
        let lo = s.witnessed_hours_min, mid = s.witnessed_hours_typical, hi = s.witnessed_hours_max
        if lo == nil && mid == nil && hi == nil { return s.witnessed_reason.map { "Witnessed: \($0)" } }
        if lo == s.hours_min && mid == s.hours_typical && hi == s.hours_max { return nil }
        let r = mid != nil ? range(lo, mid, hi) : hi.map { "minimum unknown, at most \(h($0)!)" }
        return "Witnessed: " + [s.witnessed_reason, r].compactMap { $0 }.joined(separator: "; ")
    }

    /// The witnessed total as the reader marks it: a floor when the reader marks its max unwitnessed or sends none.
    static func witnessedTotal(_ w: LaborAppraisal.WitnessedTotal?) -> String? {
        guard let w, let typical = w.hours_typical else { return nil }
        if w.max_witnessed == false || (w.hours_max == nil && w.hours_min != nil) {
            if let lo = w.hours_min, lo != typical { return "at least \(h(lo)!), typical \(h(typical)!)" }
            return "at least \(h(typical)!)"
        }
        return range(w.hours_min, typical, w.hours_max)
    }

    /// How the segment's hours are known, then its witness, stages and parts: the web's caption lines in order.
    static func lines(_ s: LaborSegment) -> [String] {
        let known = [
            s.evidence_grade.map { "Evidence: \(ItemText.codeText($0))" } ?? "Ungraded by the reader",
            s.counts_in == "unwitnessed_purchase" ? "counted with purchases not seen fitted" : nil,
            s.hours_basis.map { "hours from \(ItemText.codeText($0))" },
            s.paper_hours.map { "\(h($0)!) on shop paper" },
            range(s.book_hours).map { "book range \($0)" },
            s.hours_counted_elsewhere.map { "\(h($0)!) counted in other segments" },
            s.evidence_count.map { "\($0) evidence rows" },
        ].compactMap { $0 }.joined(separator: " · ")
        var out = [known]
        if let w = witnessedHours(s) { out.append(w) }
        if let w = witness(s) { out.append("Pieces: \(w)") }
        if s.range_below_paper == true { out.append("The book range is below the hours on shop paper; the paper hours are used.") }
        if let steps = s.stage_steps, !steps.isEmpty { out.append("Stages: " + steps.map(step).joined(separator: "; ")) }
        if let m = s.reassembly?.matched, !m.isEmpty { out.append(parts("Fitted parts with a book operation", m)) }
        if let u = s.reassembly?.unmatched, !u.isEmpty { out.append(parts("Fitted parts without a book operation", u)) }
        return out
    }

    /// The coverage line, as the kit's CoverageView prints it.
    static func coverage(_ a: LaborAppraisal) -> String {
        let priced = a.segments.filter { $0.hours_typical != nil }.count
        return "\(priced) of \(a.segments.count) segments with hours" + (ProfileClock.day(a.as_of).map { " · \($0)" } ?? "")
    }
}

/// The vehicle profile's labor appraisal. Nothing until the reader answers; nothing when it has no priced segment,
/// except the reader's own "nothing priced" answer, which is printed as one.
struct VehicleLaborAppraisalSection: View {
    let vehicleId: String
    @State private var appraisal: LaborAppraisal?
    @State private var failed = false
    @State private var loading = true

    var body: some View {
        // A VStack, not a Group: an empty Group holds no view, so its .task would never run.
        VStack(alignment: .leading, spacing: 0) {
            if let appraisal { LaborAppraisalContent(appraisal: appraisal) }
            else if loading { Text("Reading the labor appraisal…").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16) }
            else if failed {
                HStack {
                    Text("The labor appraisal could not load.").font(.caption).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }.font(.caption)
                }.padding(.horizontal, 16)
            }
        }
        .accessibilityIdentifier("vehicle-labor-appraisal")
        .task(id: vehicleId) { await load() }
    }

    private func load() async {
        loading = true; failed = false
        defer { loading = false }
        // The reader is 1-2 s warm and slower under load: two retries with backoff, as the web hook does.
        for attempt in 0..<3 {
            do {
                let read: LaborAppraisal = try await SupabaseService.client
                    .rpc("vehicle_labor_appraisal", params: ["p_vehicle_id": vehicleId]).execute().value
                guard !Task.isCancelled else { return }
                appraisal = read
                return
            } catch {
                if Task.isCancelled { return }
                NSLog("NukeCapture labor appraisal read failed: %@", String(describing: error))
                if attempt < 2 { try? await Task.sleep(nanoseconds: UInt64(1_500_000_000 * pow(2.0, Double(attempt)))) }
            }
        }
        appraisal = nil; failed = true
    }
}

struct LaborAppraisalContent: View {
    let appraisal: LaborAppraisal

    private var priced: [LaborSegment] { appraisal.segments.filter { $0.hours_typical != nil } }

    var body: some View {
        if appraisal.applicable == true, appraisal.totals?.priced_segments == 0, !appraisal.segments.isEmpty {
            section { caption("Not appraised: the reader has no segment with hours for this car yet.") }
        } else if appraisal.applicable == true, !priced.isEmpty {
            section {
                caption("Each segment carries its own hours and how they are witnessed. Segments are not added into one figure.")
                if let totals = appraisal.totals, totals.witnessed != nil, let with = LaborWords.range(totals.with_unwitnessed_purchases) {
                    Text("Hours, two totals side by side").font(.caption.weight(.semibold)).padding(.top, 4)
                    row("Witnessed", (LaborWords.witnessedTotal(totals.witnessed) ?? "none established")
                        + ((totals.witnessed?.unknown_min_segments ?? 0) > 0
                           ? " (\(totals.witnessed!.unknown_min_segments!) segments with no witnessed minimum)" : ""))
                    row("With purchases not seen fitted", with)
                }
                if let byGrade = appraisal.totals?.by_grade, !byGrade.isEmpty {
                    Text("Hours by evidence grade").font(.caption.weight(.semibold)).padding(.top, 4)
                    ForEach(byGrade.keys.sorted(), id: \.self) { grade in
                        row(ItemText.codeText(grade), LaborWords.range(byGrade[grade]) ?? "No hours")
                    }
                }
                ForEach(priced) { segment in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(LaborWords.lines(segment).enumerated()), id: \.offset) { _, line in caption(line) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                    } label: {
                        HStack(alignment: .firstTextBaseline) {
                            Text(ItemText.codeText(segment.segment)).font(.subheadline).foregroundStyle(Color.primary)
                            Spacer()
                            Text(LaborWords.range(segment.hours_min, segment.hours_typical, segment.hours_max) ?? "No hours")
                                .font(.subheadline.monospacedDigit()).foregroundStyle(Color.primary)
                        }
                    }
                    .accessibilityIdentifier("labor-segment-\(segment.segment)")
                }
            }
        }
    }

    private func section<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Labor appraisal by segment", systemImage: "wrench.and.screwdriver")
                Spacer()
                Text(LaborWords.coverage(appraisal)).foregroundStyle(.secondary)
            }.font(.caption)
            content()
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    private func caption(_ s: String) -> some View {
        Text(s).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption)
            Spacer()
            Text(value).font(.caption.monospacedDigit()).multilineTextAlignment(.trailing)
        }
    }
}
