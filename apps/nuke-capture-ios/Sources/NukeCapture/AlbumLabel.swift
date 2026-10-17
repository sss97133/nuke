// AlbumLabel.swift — reads "year make model" out of an owner's album name.
//
// The owner names albums after the vehicle ("1973 Dodge charger 360", "1977 K5 Chevrolet Blazer",
// "1983 GMC K2500 BLUE"); others name a client, a year or an org ("Heidi Reese 2025", "2022",
// "VLVA") and must not parse. A label needs a model year and a known make; everything else in the
// name, minus the year and the make, is the model text. Unknown stays unknown: no guessed make.

import Foundation

struct AlbumLabel: Equatable {
    let year: Int
    let make: String
    let model: String?

    /// Canonical make for each spelling seen in album names.
    static let makes: [String: String] = [
        "chevrolet": "Chevrolet", "chevy": "Chevrolet", "gmc": "GMC", "ford": "Ford", "dodge": "Dodge",
        "ram": "Ram", "plymouth": "Plymouth", "chrysler": "Chrysler", "jeep": "Jeep", "pontiac": "Pontiac",
        "buick": "Buick", "cadillac": "Cadillac", "oldsmobile": "Oldsmobile", "lincoln": "Lincoln",
        "mercury": "Mercury", "amc": "AMC", "international": "International", "porsche": "Porsche",
        "lexus": "Lexus", "toyota": "Toyota", "nissan": "Nissan", "datsun": "Datsun", "honda": "Honda",
        "mazda": "Mazda", "subaru": "Subaru", "mercedes": "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz",
        "bmw": "BMW", "volkswagen": "Volkswagen", "vw": "Volkswagen", "audi": "Audi", "ferrari": "Ferrari",
        "jaguar": "Jaguar", "land": "Land Rover", "rover": "Land Rover", "mg": "MG", "triumph": "Triumph",
        "shelby": "Shelby", "studebaker": "Studebaker", "willys": "Willys", "harley-davidson": "Harley-Davidson",
    ]

    static func parse(_ name: String?) -> AlbumLabel? {
        guard let name else { return nil }
        let tokens = name.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "," }).map(String.init)
        let thisYear = Calendar(identifier: .gregorian).component(.year, from: Date())
        guard let yearIndex = tokens.firstIndex(where: { t in
            guard t.count == 4, let y = Int(t) else { return false }
            return y >= 1900 && y <= thisYear + 1
        }), let year = Int(tokens[yearIndex]) else { return nil }
        guard let makeIndex = tokens.firstIndex(where: { makes[$0.lowercased()] != nil }),
              let make = makes[tokens[makeIndex].lowercased()] else { return nil }
        let skip: Set<Int> = make == "Land Rover"
            ? [yearIndex, makeIndex, makeIndex + 1] : [yearIndex, makeIndex]
        let rest = tokens.enumerated().filter { !skip.contains($0.offset) }.map(\.element)
            .filter { !$0.allSatisfy { !$0.isLetter && !$0.isNumber } }
        let model = rest.prefix(3).joined(separator: " ")
        return AlbumLabel(year: year, make: make, model: model.isEmpty ? nil : model)
    }
}
