// CommentCompass.swift — a 2D map of comment sentiment
//
// Axes:
//   X: CAR quality (issues ↔ excellent)
//   Y: DEAL value (overpriced ↔ good value)
//
// Each theme from the comment analysis plots as a point. Tap a quadrant
// to drill into the comments that fall there. This replaces the text dump
// of "What commenters wrote" with a visual summary that surfaces WHERE
// the community sentiment sits.
//
// Quadrants:
//   Top-right: Good car, good deal ("best restored, half the cost")
//   Top-left: Issues but cheap ("needs work but priced right")
//   Bottom-right: Good car, pricey ("beautiful but reserve too high")
//   Bottom-left: Issues and pricey ("problems AND overpriced")

import SwiftUI

/// One theme extracted from comments, with its position on the map.
struct CommentTheme: Identifiable {
    let id = UUID()
    let text: String
    let carScore: Double   // -1 (issues) to +1 (excellent)
    let dealScore: Double  // -1 (overpriced) to +1 (good value)
    let category: Category

    enum Category: String {
        case insight   // positive observation
        case concern   // issue raised
        case fact      // neutral statement
        case question  // question raised
    }

    var quadrant: Quadrant {
        switch (carScore >= 0, dealScore >= 0) {
        case (true, true): return .goodCarGoodDeal
        case (false, true): return .issuesCheap
        case (true, false): return .goodCarPricey
        case (false, false): return .issuesPricey
        }
    }

    enum Quadrant: String, CaseIterable {
        case goodCarGoodDeal = "Good car, good deal"
        case issuesCheap = "Issues but cheap"
        case goodCarPricey = "Good car, pricey"
        case issuesPricey = "Issues and pricey"

        var color: Color {
            switch self {
            case .goodCarGoodDeal: return .green
            case .issuesCheap: return .yellow
            case .goodCarPricey: return .orange
            case .issuesPricey: return .red
            }
        }
    }
}

/// The 2D comment sentiment map.
struct CommentCompass: View {
    let themes: [CommentTheme]
    let commentCount: Int
    var onQuadrantTap: ((CommentTheme.Quadrant) -> Void)? = nil

    private let gridSize: CGFloat = 200

    private func themesByQuadrant() -> [CommentTheme.Quadrant: [CommentTheme]] {
        Dictionary(grouping: themes, by: \.quadrant)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("COMMENT MAP")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(commentCount) comments")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            // The compass
            ZStack {
                // Grid background
                compassGrid

                // Axis labels
                axisLabels

                // Quadrant counts
                quadrantCounts

                // Theme dots (if we have per-theme coordinates)
                if themes.contains(where: { $0.carScore != 0 || $0.dealScore != 0 }) {
                    themeDots
                }
            }
            .frame(width: gridSize, height: gridSize)
            .frame(maxWidth: .infinity)

            // Legend
            legend
        }
        .padding()
        .nukeSurface()
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var compassGrid: some View {
        ZStack {
            // Background quadrants
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    quadrantCell(.issuesCheap)
                    quadrantCell(.goodCarGoodDeal)
                }
                HStack(spacing: 0) {
                    quadrantCell(.issuesPricey)
                    quadrantCell(.goodCarPricey)
                }
            }

            // Cross lines
            Path { p in
                p.move(to: CGPoint(x: gridSize / 2, y: 0))
                p.addLine(to: CGPoint(x: gridSize / 2, y: gridSize))
                p.move(to: CGPoint(x: 0, y: gridSize / 2))
                p.addLine(to: CGPoint(x: gridSize, y: gridSize / 2))
            }
            .stroke(Color.primary.opacity(0.3), lineWidth: 1)
        }
    }

    private func quadrantCell(_ quadrant: CommentTheme.Quadrant) -> some View {
        let count = themesByQuadrant()[quadrant]?.count ?? 0
        return Rectangle()
            .fill(count > 0 ? quadrant.color.opacity(0.15) : Color.clear)
            .frame(width: gridSize / 2, height: gridSize / 2)
            .onTapGesture {
                if count > 0 {
                    onQuadrantTap?(quadrant)
                }
            }
    }

    private var axisLabels: some View {
        ZStack {
            // Top: "Good deal"
            Text("GOOD DEAL")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .offset(y: -gridSize / 2 - 10)

            // Bottom: "Overpriced"
            Text("OVERPRICED")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .offset(y: gridSize / 2 + 10)

            // Left: "Issues"
            Text("ISSUES")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .rotationEffect(.degrees(-90))
                .offset(x: -gridSize / 2 - 16)

            // Right: "Excellent"
            Text("EXCELLENT")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .rotationEffect(.degrees(90))
                .offset(x: gridSize / 2 + 20)
        }
    }

    private var quadrantCounts: some View {
        let byQuadrant = themesByQuadrant()
        return ZStack {
            ForEach(CommentTheme.Quadrant.allCases, id: \.rawValue) { q in
                let count = byQuadrant[q]?.count ?? 0
                if count > 0 {
                    Text("\(count)")
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .foregroundStyle(q.color)
                        .offset(quadrantOffset(q))
                }
            }
        }
    }

    private func quadrantOffset(_ q: CommentTheme.Quadrant) -> CGSize {
        let dx: CGFloat = gridSize / 4
        let dy: CGFloat = gridSize / 4
        switch q {
        case .goodCarGoodDeal: return CGSize(width: dx, height: -dy)
        case .issuesCheap: return CGSize(width: -dx, height: -dy)
        case .goodCarPricey: return CGSize(width: dx, height: dy)
        case .issuesPricey: return CGSize(width: -dx, height: dy)
        }
    }

    private var themeDots: some View {
        ForEach(themes) { theme in
            Circle()
                .fill(theme.quadrant.color)
                .frame(width: 8, height: 8)
                .offset(
                    x: theme.carScore * (gridSize / 2 - 20),
                    y: -theme.dealScore * (gridSize / 2 - 20)
                )
        }
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(CommentTheme.Quadrant.allCases, id: \.rawValue) { q in
                let count = themesByQuadrant()[q]?.count ?? 0
                if count > 0 {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(q.color)
                            .frame(width: 8, height: 8)
                        Text(q.rawValue)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(count)")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }
}

// MARK: - Derive themes from existing CommentIntel shape

extension CommentCompass {
    /// Convert the current prose-based intel into approximate map positions.
    /// This is a bridge until the analysis produces proper coordinates.
    static func themesFromIntel(
        insights: [String],
        concerns: [String],
        quotes: [String],
        priceSentiment: String?
    ) -> [CommentTheme] {
        var themes: [CommentTheme] = []

        // Insights are generally positive about the car
        for insight in insights.prefix(3) {
            themes.append(CommentTheme(
                text: insight,
                carScore: 0.6,  // positive about car
                dealScore: 0.3, // neutral-positive on deal
                category: .insight
            ))
        }

        // Concerns are negative, usually about car or deal
        for concern in concerns.prefix(3) {
            let isDealConcern = concern.lowercased().contains("price") ||
                                concern.lowercased().contains("reserve") ||
                                concern.lowercased().contains("value")
            themes.append(CommentTheme(
                text: concern,
                carScore: isDealConcern ? 0.2 : -0.5,
                dealScore: isDealConcern ? -0.6 : -0.2,
                category: .concern
            ))
        }

        // Price sentiment affects deal axis
        if let ps = priceSentiment?.lowercased() {
            let dealScore: Double
            if ps.contains("high") || ps.contains("expensive") || ps.contains("overpriced") {
                dealScore = -0.7
            } else if ps.contains("fair") || ps.contains("reasonable") {
                dealScore = 0.3
            } else if ps.contains("cheap") || ps.contains("bargain") || ps.contains("value") {
                dealScore = 0.7
            } else {
                dealScore = 0
            }
            if dealScore != 0 {
                themes.append(CommentTheme(
                    text: "Price sentiment: \(priceSentiment ?? "")",
                    carScore: 0,
                    dealScore: dealScore,
                    category: .fact
                ))
            }
        }

        return themes
    }
}

#Preview {
    CommentCompass(
        themes: [
            CommentTheme(text: "Best restored Isetta", carScore: 0.8, dealScore: 0.6, category: .insight),
            CommentTheme(text: "Half restoration cost", carScore: 0.5, dealScore: 0.8, category: .insight),
            CommentTheme(text: "Reserve not met", carScore: 0, dealScore: -0.5, category: .concern),
            CommentTheme(text: "Storage terms unclear", carScore: -0.3, dealScore: -0.2, category: .concern),
        ],
        commentCount: 23
    )
    .padding()
}
