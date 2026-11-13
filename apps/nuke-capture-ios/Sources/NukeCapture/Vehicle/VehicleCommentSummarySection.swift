import SwiftUI
import Supabase

/// The stored comment summary for a vehicle, as `popup_vehicle_intel(p_vehicle_id).comment_intel` serves it: the same
/// read the web profile's Comment summary card uses. A quote opens its comment in place (author, date, stored text);
/// the listing address is the small source line. The model's sentiment and market labels are not shown as statuses.
struct CommentSummary: Decodable {
    struct Quote: Decodable, Identifiable {
        let quote: String
        let author: String?
        let is_seller: Bool?
        let posted_at: String?
        let url: String?
        let comment_text: String?
        var id: String { (url ?? "") + quote }

        private enum Keys: String, CodingKey { case quote, author, is_seller, posted_at, url, comment_text }
        init(from decoder: Decoder) throws {
            // Summaries written before 2026-11-13 hold a bare string or an object without the comment fields.
            if let text = try? decoder.singleValueContainer().decode(String.self) {
                quote = text; author = nil; is_seller = nil; posted_at = nil; url = nil; comment_text = nil
                return
            }
            let c = try decoder.container(keyedBy: Keys.self)
            quote = (try? c.decode(String.self, forKey: .quote)) ?? ""
            author = try? c.decode(String.self, forKey: .author)
            is_seller = try? c.decode(Bool.self, forKey: .is_seller)
            posted_at = try? c.decode(String.self, forKey: .posted_at)
            url = try? c.decode(String.self, forKey: .url)
            comment_text = try? c.decode(String.self, forKey: .comment_text)
        }
    }

    struct Concern: Decodable {
        let text: String
        private enum Keys: String, CodingKey { case concern }
        init(from decoder: Decoder) throws {
            if let s = try? decoder.singleValueContainer().decode(String.self) { text = s; return }
            let c = try decoder.container(keyedBy: Keys.self)
            text = (try? c.decode(String.self, forKey: .concern)) ?? ""
        }
    }

    let comment_count: Int?
    let comments_analyzed: Int?
    let analyzed_at: String?
    let model_used: String?
    let key_quotes: [Quote]?
    let community_concerns: [Concern]?

    var quotes: [Quote] { (key_quotes ?? []).filter { !$0.quote.isEmpty }.prefix(3).map { $0 } }
    var concerns: [String] { (community_concerns ?? []).map(\.text).filter { !$0.isEmpty }.prefix(3).map { $0 } }

    /// "claude-haiku-5-5 · written Nov 12, 2026 · read 59 of 59 comments", from the stored fields only.
    var provenance: String? {
        guard let model = model_used, let day = CommentSummary.day(analyzed_at) else { return nil }
        var parts = ["Stored model interpretation", model, "written \(day)"]
        if let read = comments_analyzed, let total = comment_count { parts.append("read \(read) of \(total) comments") }
        return parts.joined(separator: " · ")
    }

    static func day(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = parser.date(from: iso) ?? plain.date(from: iso) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

struct VehicleCommentSummarySection: View {
    let vehicleId: String
    @State private var summary: CommentSummary?

    private struct Intel: Decodable { let comment_intel: CommentSummary? }

    var body: some View {
        // A VStack, not a Group: an empty Group holds no view, so its .task would never run.
        VStack(alignment: .leading, spacing: 0) {
            if let summary, !summary.quotes.isEmpty || !summary.concerns.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("Comment summary", systemImage: "text.bubble")
                        Spacer()
                        if let n = summary.comment_count { Text("\(n) comments").foregroundStyle(.secondary) }
                    }.font(.caption)
                    Text(summary.provenance ?? "Stored interpretation. Model, date and input count were not recorded.")
                        .font(.caption2).foregroundStyle(.secondary)
                    if !summary.quotes.isEmpty {
                        Text("What commenters wrote").font(.caption.weight(.semibold))
                        ForEach(summary.quotes) { quote in
                            if quote.author != nil { QuoteRow(quote: quote) } else { Text(quote.quote).font(.subheadline) }
                        }
                    }
                    if !summary.concerns.isEmpty {
                        Text("Concerns the model read in the comments · not verified").font(.caption.weight(.semibold))
                        ForEach(summary.concerns, id: \.self) { Text($0).font(.subheadline) }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
        }
        .task(id: vehicleId) { await load() }
    }

    private func load() async {
        do {
            let intel: Intel? = try await SupabaseService.client
                .rpc("popup_vehicle_intel", params: ["p_vehicle_id": vehicleId])
                .execute()
                .value
            summary = intel?.comment_intel
        } catch {
            summary = nil
            NSLog("NukeCapture comment summary load failed: %@", String(describing: error))
        }
    }
}

/// One quote: tap to read the comment it came from, on this screen.
private struct QuoteRow: View {
    let quote: CommentSummary.Quote
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 6) {
                Text([quote.is_seller == true ? "Seller" : nil, quote.author.map { "@\($0)" }, CommentSummary.day(quote.posted_at)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
                if let text = quote.comment_text, !text.isEmpty { Text(text).font(.footnote) }
                if let raw = quote.url, raw.hasPrefix("https://"), let url = URL(string: raw) {
                    Link("Source: comment on the listing", destination: url).font(.caption2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
        } label: {
            Text(quote.quote).font(.subheadline).multilineTextAlignment(.leading).foregroundStyle(Color.primary)
        }
    }
}
