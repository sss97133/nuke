// ToolboxView.swift — a person's tools as a grid of maker pack shots (user_toolbox_read).
//
// Each card is one matched tool record: the maker's catalog photo, name, part number, quantity
// and list value (maker list price × quantity). The header keeps the list value and, for the
// owner, what their receipts say they paid, in separate sections: neither is resale value.
// Sort and filter use only fields the reader returned. Records without a catalog match are
// counted in the footer and never described.

import SwiftUI

struct ToolboxView: View {
    let userId: String

    @State private var read: JobLoad<Toolbox> = .loading

    var body: some View {
        ToolboxContent(read: read, onRetry: { Task { await load() } })
            .task(id: userId) { await load() }
            .refreshable { await load() }
    }

    private func load() async {
        read = await ToolboxReaders.toolbox(userId: userId)
    }
}

/// The render, separated from the read so fixture tests drive it directly.
struct ToolboxContent: View {
    let read: JobLoad<Toolbox>
    var onRetry: (() -> Void)? = nil

    @State private var sort: ToolboxSort = .value
    @State private var category: String?

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            switch read {
            case .loading:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Loading the toolbox…").font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
            case .refused(let refusal):
                VStack(alignment: .leading, spacing: 10) {
                    JobRefusalRow(refusal: refusal)
                    if refusal.kind == .failed, let onRetry { Button("Try again", action: onRetry) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            case .loaded(let t):
                loaded(t)
            }
        }
        .navigationTitle("Toolbox")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func loaded(_ t: Toolbox) -> some View {
        let shown = ToolboxCopy.sorted(ToolboxCopy.filtered(t.items, category: category), by: sort)
        VStack(alignment: .leading, spacing: 16) {
            ToolboxTotalsHeader(toolbox: t)
            if !t.items.isEmpty { controls(t) }
            if t.items.isEmpty {
                Text(t.isOwner ? "None of your tool records match a maker's catalog product yet." : "No tool records match a maker's catalog product yet.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(shown) { item in
                        NavigationLink { ToolboxItemDetail(item: item, isOwner: t.isOwner) } label: {
                            ToolboxCard(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            ToolboxCoverageFooter(toolbox: t)
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }

    @ViewBuilder private func controls(_ t: Toolbox) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Sort", selection: $sort) {
                ForEach(ToolboxSort.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            Menu {
                Button("All categories") { category = nil }
                ForEach(t.categories, id: \.self) { c in
                    Button(c) { category = c }
                }
            } label: {
                Label(category ?? "All categories", systemImage: "line.3.horizontal.decrease.circle")
                    .font(.footnote)
                    .lineLimit(1)
            }
            if category != nil {
                Text("\(JobCopy.count(ToolboxCopy.filtered(t.items, category: category).count)) of \(JobCopy.count(t.items.count)) matched tools")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Header

struct ToolboxTotalsHeader: View {
    let toolbox: Toolbox

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                RootedValueView(label: "List value", value: ToolboxCopy.listValueTotal(toolbox), status: .attributed,
                                decay: ToolboxCopy.listValueDecay(toolbox))
            }
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
            if let paid = ToolboxCopy.paidTotal(toolbox) {
                VStack(alignment: .leading, spacing: 0) {
                    RootedValueView(label: "You paid", value: paid, status: .proven, decay: ToolboxCopy.paidDecay)
                    Text("Only you see this.").font(.caption2).foregroundStyle(.tertiary).padding(.bottom, 6)
                }
                .padding(.horizontal, 12)
                .background(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(.separator)))
            }
        }
    }
}

// MARK: - Card

struct ToolboxCard: View {
    let item: Toolbox.Item

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                ToolboxPackShot(item: item, width: 400)
                    .frame(height: 130)
                    .frame(maxWidth: .infinity)
                if item.quantity != nil {
                    Text(ToolboxCopy.quantity(item.quantity))
                        .font(.caption2.monospacedDigit().weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(Color(.systemBackground).opacity(0.9)))
                        .padding(6)
                }
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
            Text(ToolboxCopy.title(item))
                .font(.footnote.weight(.medium))
                .lineLimit(2, reservesSpace: true)
            if let line = ToolboxCopy.partLine(item) {
                Text(line).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
            }
            Text(ToolboxCopy.cardValue(item))
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(item.listValue == nil ? Color.secondary : Color.primary)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
        .accessibilityElement(children: .combine)
    }
}

struct ToolboxPackShot: View {
    let item: Toolbox.Item
    let width: Int

    var body: some View {
        if let url = ToolboxCopy.packShotURL(item.packShot?.imageUrl, width: width) {
            CachedAsyncImage(url: url, maxPixel: CGFloat(width)) { img in
                img.resizable().scaledToFit()
            } placeholder: {
                ProgressView()
            }
            .padding(6)
        } else {
            VStack(spacing: 4) {
                Image(systemName: "wrench.adjustable").font(.title2).foregroundStyle(.tertiary)
                Text("No maker photo").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Detail

struct ToolboxItemDetail: View {
    let item: Toolbox.Item
    let isOwner: Bool

    var body: some View {
        List {
            Section {
                ToolboxPackShot(item: item, width: 1000)
                    .frame(maxWidth: .infinity)
                    .frame(height: 280)
                    .listRowBackground(Color.white)
            } footer: {
                if item.packShot != nil {
                    Text(isOwner ? ToolboxCopy.packShotCaption : ToolboxCopy.packShotCaptionVisitor)
                }
            }
            Section {
                let name = ToolboxCopy.nameBasis(item, owner: isOwner)
                RootedValueView(label: "Name", value: ToolboxCopy.title(item), status: name.status, decay: name.words)
                if let b = item.brand { RootedValueView(label: "Brand", value: b, status: .attributed) }
                if let p = item.partNumber { RootedValueView(label: "Part number", value: p, status: .attributed) }
                if let c = item.category {
                    RootedValueView(label: "Category", value: c, status: .recorded,
                                    decay: isOwner ? "from your tool records" : "from their tool records")
                }
                RootedValueView(label: "Quantity", value: item.quantity.map(JobCopy.count) ?? "Not recorded", status: .recorded,
                                decay: isOwner ? "from your tool records" : "from their tool records")
                RootedValueView(label: "Catalog match", value: ToolboxCopy.matchBasis(item.matchBasis), status: .attributed)
            }
            Section {
                if let p = item.listPrice {
                    RootedValueView(label: "List price", value: ToolboxCopy.money(p.amount, p.currency), status: .attributed,
                                    decay: ToolboxCopy.captured(p))
                    if let v = item.listValue {
                        RootedValueView(label: "List value", value: ToolboxCopy.money(v, p.currency), status: .attributed,
                                        decay: ToolboxCopy.listValueBasis)
                    }
                    if let url = ToolboxCopy.makerPage(p) {
                        Link(destination: url) { Label(ToolboxCopy.makerPageLabel(url), systemImage: "safari") }
                    }
                } else {
                    Text("No list price captured from the maker's page yet.").font(.footnote).foregroundStyle(.secondary)
                }
            } header: {
                Text("Maker's list price")
            } footer: {
                Text("The maker's current list price, not resale value and not what was paid.")
            }
            if isOwner, let paid = item.paid {
                Section {
                    RootedValueView(label: "You paid", value: paid.total.map(ToolboxCopy.plainAmount) ?? "Not recorded", status: .proven,
                                    decay: ToolboxCopy.paidDecay)
                    if let n = paid.receipts {
                        RootedValueView(label: "Receipts", value: JobCopy.count(n), status: .proven)
                    }
                    if let d = JobCopy.day(paid.firstPurchase) {
                        RootedValueView(label: "First bought", value: d, status: .proven)
                    }
                    if let d = JobCopy.day(paid.lastPurchase), paid.lastPurchase != paid.firstPurchase {
                        RootedValueView(label: "Last bought", value: d, status: .proven)
                    }
                } header: {
                    Text("Your receipts")
                } footer: {
                    Text("Only you see this.")
                }
            }
        }
        .navigationTitle(item.partNumber ?? "Tool")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Footer

struct ToolboxCoverageFooter: View {
    let toolbox: Toolbox

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(ToolboxCopy.coverageLines(toolbox), id: \.self) { line in
                Text(line)
            }
            if let asOf = JobCopy.day(toolbox.asOf) { Text("As of \(asOf)") }
            Text("Matched by the same brand and exact part number. Pack shots are the maker's catalog photos.")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}
