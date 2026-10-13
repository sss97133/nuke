// VehicleIdentity.swift — the web's vehicle identity rule, in Swift (nuke_frontend/src/utils/vehicleIdentity.ts
// getVehicleIdentityTokens and sanitizeIdentityToken; hooks/usePageTitle.ts getVehicleTitle).
//
// Primary tokens: year, make, model (normalized_model first, else model), the model sanitized of listing
// boilerplate and of a leading year or make. Differentiators: series and trim unless the model already
// contains them, and the transmission only where it is high-signal (Porsche; BMW M cars) and manual or PDK;
// at most three. The masthead shows primary + differentiators; a title trims differentiators past 55
// characters. Read from the document's masthead identity_source, never recomposed from the vehicle row.

import Foundation

enum VehicleIdentity {
    struct Tokens: Equatable {
        let primary: [String]
        let differentiators: [String]
        var all: [String] { primary + differentiators }
    }

    static func tokens(_ s: IdentitySource) -> Tokens {
        tokens(year: s.year, make: s.make, model: s.model, normalizedModel: s.normalized_model, series: s.series,
               trim: s.trim, transmission: s.transmission, transmissionModel: s.transmission_model)
    }

    static func tokens(year: Int?, make: String?, model: String?, normalizedModel: String?, series: String?, trim: String?,
                       transmission: String?, transmissionModel: String?, maxDifferentiators: Int = 3) -> Tokens {
        let mk = (make ?? "").trimmingCharacters(in: .whitespaces)
        let modelSource = (normalizedModel?.isEmpty == false ? normalizedModel : model) ?? ""
        let modelTok = sanitize(modelSource, year: year, make: mk)
        let seriesTok = sanitize(series, year: year, make: mk)
        let trimTok = sanitize(trim, year: year, make: mk)
        var primary: [String] = []
        if let year { primary.append(String(year)) }
        if !mk.isEmpty { primary.append(mk) }
        if !modelTok.isEmpty { primary.append(modelTok) }
        let lowerModel = modelTok.lowercased()
        var diff: [String] = []
        if !seriesTok.isEmpty, !lowerModel.contains(seriesTok.lowercased()) { diff.append(seriesTok) }
        if !trimTok.isEmpty, !lowerModel.contains(trimTok.lowercased()) { diff.append(trimTok) }
        let raw = ((transmissionModel?.isEmpty == false ? transmissionModel : transmission) ?? "").trimmingCharacters(in: .whitespaces)
        let display = transmissionDisplay(raw)
        if !display.isEmpty, nicheCaresAboutTransmission(make: mk, model: modelSource), isManual(raw) || display == "PDK" {
            diff.append(display)
        }
        return Tokens(primary: primary, differentiators: Array(diff.prefix(max(0, maxDifferentiators))))
    }

    /// The web's getVehicleTitle: primary + differentiators, dropping differentiators past the length.
    static func title(_ t: Tokens, maxLength: Int = 55) -> String {
        var title = t.all.joined(separator: " ")
        if title.count > maxLength, !t.differentiators.isEmpty {
            for i in stride(from: t.differentiators.count - 1, through: 0, by: -1) {
                let shorter = (t.primary + t.differentiators.prefix(i)).joined(separator: " ")
                if shorter.count <= maxLength || i == 0 { title = shorter; break }
            }
        }
        return title
    }

    static func isManual(_ raw: String) -> Bool {
        raw.range(of: #"\b(manual|m/t|mt|stick|three[-\s]?pedal|3[-\s]?pedal)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func transmissionDisplay(_ raw: String) -> String {
        let r = raw.trimmingCharacters(in: .whitespaces)
        guard !r.isEmpty else { return "" }
        var speed = ""
        if let m = r.range(of: #"\b(\d{1,2})\s*[-\s]*speed\b"#, options: [.regularExpression, .caseInsensitive]) {
            speed = String(r[m]).filter { $0.isNumber }
        }
        if isManual(r) { return speed.isEmpty ? "Manual" : "\(speed)-speed manual" }
        if r.lowercased().contains("pdk") { return "PDK" }
        return ""
    }

    static func nicheCaresAboutTransmission(make: String, model: String) -> Bool {
        let mk = make.trimmingCharacters(in: .whitespaces).lowercased(), mo = model.trimmingCharacters(in: .whitespaces).lowercased()
        if mk == "porsche" { return true }
        if mk == "bmw", mo.range(of: #"\bm\b|\b(m2|m3|m4|m5|m6)\b"#, options: .regularExpression) != nil { return true }
        return false
    }

    /// The web's sanitizeIdentityToken: strip listing boilerplate, a leading year or make, price, color and location tails.
    static func sanitize(_ raw: String?, year: Int?, make: String) -> String {
        var s = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return "" }
        func drop(_ pattern: String, _ replacement: String = "", caseInsensitive: Bool = true) {
            let opts: String.CompareOptions = caseInsensitive ? [.regularExpression, .caseInsensitive] : [.regularExpression]
            s = s.replacingOccurrences(of: pattern, with: replacement, options: opts).trimmingCharacters(in: .whitespaces)
        }
        s = String(s.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false).first ?? "").trimmingCharacters(in: .whitespaces)
        drop(#"\bfor sale on BaT Auctions?\b"#); drop(#"\bon\s+BaT\s+Auctions\b"#); drop(#"\bBaT\s+Auctions\b"#)
        drop(#"\bBring\s+a\s+Trailer\b"#); drop(#"\bAuction\s+Result\b"#)
        drop(#"\bsold for \$[\d,]+ on [A-Z][a-z]+ \d{1,2}, \d{4}\b"#)
        drop(#"\bending\b[\s\S]*$"#)
        drop(#"\(\s*Lot\s*#.*?\)\s*"#, " ")
        drop(#"^\s*\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\s+"#)
        drop(#"^\s*\d{1,3}(?:,\d{3})+\s*[-\s]*mile\s+"#)
        if let year { drop("^\\s*\(year)\\s+") } else { drop(#"^\s*(19|20)\d{2}\s+"#) }
        if !make.isEmpty { drop("^\\s*\(NSRegularExpression.escapedPattern(for: make))\\s+") }
        if s.contains(" - $") || (s.contains(" - ") && s.range(of: #"\$[\d,]+"#, options: .regularExpression) != nil) {
            if let cut = s.range(of: #"\s*-\s*(?=\$|\([A-Z])"#, options: .regularExpression) {
                s = String(s[..<cut.lowerBound]).trimmingCharacters(in: .whitespaces)
            }
        }
        drop(#"\s*-\s*(BLACK|WHITE|RED|BLUE|GREEN|SILVER|GRAY|GREY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|TAN)\s*$"#)
        drop(#"\s*\([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\)\s*$"#, caseInsensitive: false)
        drop(#"\s+"#, " ")
        drop(#"[-–—]\s*$"#)
        if s.count > 80 { return "" }
        let low = s.lowercased()
        if low.contains("for sale"), low.contains("sold for") { return "" }
        if low.contains("for sale"), s.range(of: #"\$\d+"#, options: .regularExpression) != nil { return "" }
        if low.contains("auction"), s.contains("$") || s.range(of: #"Lot\s*#"#, options: [.regularExpression, .caseInsensitive]) != nil { return "" }
        drop(#"^\s*Euro\s+"#)
        return s
    }
}
