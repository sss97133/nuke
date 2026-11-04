// ScreenshotVehicleTerms.swift — does the text on a screenshot name a vehicle? Pure string logic.
//
// The text is read by Vision ON THE PHONE (ScreenshotOCR in VideoSyncEngine) and handed to this file in
// memory. It is never stored, logged or sent: only the matching class names leave the phone, in the
// preview row's match basis. A screenshot that does not match stays on the phone.
//
// Deliberately narrow, so a message that merely says "truck" does not match:
//   vin        a 17-character VIN whose check digit is valid (I, O and Q read as 1, 0 and 0, as OCR confuses them)
//   year_make  a model year 1900-2029 immediately followed by a vehicle make ("1972 Chevrolet", "2004 BMW")

import Foundation

enum ScreenshotVehicleTerms {
    struct Hit: Equatable, Sendable {
        let classes: [String]       // "vin", "year_make"
    }

    static let makes = [
        "chevrolet", "chevy", "ford", "dodge", "plymouth", "pontiac", "oldsmobile", "buick", "cadillac", "gmc",
        "jeep", "toyota", "nissan", "datsun", "honda", "acura", "lexus", "porsche", "mercedes", "bmw", "audi",
        "volkswagen", "vw", "jaguar", "ferrari", "lamborghini", "maserati", "mercury", "lincoln", "amc",
        "studebaker", "international", "land rover", "range rover", "mazda", "subaru", "volvo", "triumph", "mg",
        "austin healey", "lotus", "shelby", "ram", "tesla", "chrysler", "saab", "mini", "bentley", "rolls-royce",
        "aston martin", "delorean", "hudson", "packard", "willys", "kaiser", "ford bronco"
    ]

    static func hit(in text: String) -> Hit? {
        var classes: [String] = []
        if containsValidVIN(text) { classes.append("vin") }
        if containsYearMake(text) { classes.append("year_make") }
        return classes.isEmpty ? nil : Hit(classes: classes)
    }

    // ─── Year + make ─────────────────────────────────────────────────────────

    private static let yearMake: NSRegularExpression? = {
        let alternation = makes.map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|")
        return try? NSRegularExpression(pattern: "\\b(19[0-9]{2}|20[0-2][0-9])\\s+(?:\(alternation))\\b",
                                        options: [.caseInsensitive])
    }()

    static func containsYearMake(_ text: String) -> Bool {
        guard let re = yearMake else { return false }
        return re.firstMatch(in: text, options: [], range: NSRange(text.startIndex..., in: text)) != nil
    }

    // ─── VIN with check digit ────────────────────────────────────────────────

    private static let candidate: NSRegularExpression? =
        try? NSRegularExpression(pattern: "[A-Z0-9]{17}", options: [])

    static func containsValidVIN(_ text: String) -> Bool {
        guard let re = candidate else { return false }
        // Letters and digits only, one run at a time: spaces and punctuation end a candidate.
        let upper = text.uppercased()
        let runs = upper.split(whereSeparator: { !($0.isASCII && ($0.isLetter || $0.isNumber)) })
        for run in runs where run.count >= 17 {
            let chars = Array(run)
            for start in 0...(chars.count - 17) {
                let slice = String(chars[start..<(start + 17)])
                // A real VIN mixes letters and digits; a long run of digits (a tracking number) is not one.
                guard slice.filter({ $0.isLetter }).count >= 2, slice.filter({ $0.isNumber }).count >= 4 else { continue }
                let normalized = String(slice.map { c -> Character in
                    switch c { case "I": return "1"; case "O", "Q": return "0"; default: return c }
                })
                guard re.firstMatch(in: normalized, options: [], range: NSRange(normalized.startIndex..., in: normalized)) != nil
                else { continue }
                if checkDigitIsValid(normalized) { return true }
            }
        }
        return false
    }

    /// ISO 3779 / 49 CFR 565 check digit (position 9).
    static func checkDigitIsValid(_ vin: String) -> Bool {
        let chars = Array(vin.uppercased())
        guard chars.count == 17 else { return false }
        let values: [Character: Int] = [
            "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8,
            "J": 1, "K": 2, "L": 3, "M": 4, "N": 5, "P": 7, "R": 9,
            "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9
        ]
        let weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
        var sum = 0
        for (i, c) in chars.enumerated() {
            let v: Int
            if let d = c.wholeNumberValue, c.isASCII { v = d }
            else if let m = values[c] { v = m }
            else { return false }               // I, O, Q are not allowed in a VIN
            sum += v * weights[i]
        }
        let remainder = sum % 11
        let expected: Character = remainder == 10 ? "X" : Character(String(remainder))
        return chars[8] == expected
    }
}
