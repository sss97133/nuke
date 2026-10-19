// JobSheetPresenter.swift — sheets on the job page are presented from the List itself.
//
// A section header can't host a sheet reliably: the List renders lazily, so once the header scrolls
// out of view its modifiers are gone and the button below it does nothing. JobPathContent puts a
// presenter in the environment and owns one list-level `.sheet`; sections apply `jobSheet` to their
// rows (modifiers on section content fan out to every row, so the trigger clears the binding before
// presenting and only the first row to see the change presents).

import SwiftUI

struct JobSheet: Identifiable {
    let id = UUID()
    let content: AnyView
}

private struct PresentJobSheetKey: EnvironmentKey {
    static let defaultValue: ((AnyView) -> Void)? = nil
}

extension EnvironmentValues {
    var presentJobSheet: ((AnyView) -> Void)? {
        get { self[PresentJobSheetKey.self] }
        set { self[PresentJobSheetKey.self] = newValue }
    }
}

extension View {
    /// Presents through the job page's presenter when there is one, else as an ordinary sheet.
    func jobSheet<Item: Identifiable, C: View>(item: Binding<Item?>, @ViewBuilder content: @escaping (Item) -> C) -> some View {
        modifier(JobSheetItem(item: item, sheet: content))
    }

    func jobSheet<C: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> C) -> some View {
        modifier(JobSheetFlag(isPresented: isPresented, sheet: content))
    }
}

private struct JobSheetItem<Item: Identifiable, C: View>: ViewModifier {
    @Environment(\.presentJobSheet) private var present
    @Binding var item: Item?
    let sheet: (Item) -> C

    func body(content: Content) -> some View {
        if let present {
            content.onChange(of: item?.id) { _, _ in
                guard let value = item else { return }
                item = nil
                present(AnyView(sheet(value)))
            }
        } else {
            content.sheet(item: $item, content: sheet)
        }
    }
}

private struct JobSheetFlag<C: View>: ViewModifier {
    @Environment(\.presentJobSheet) private var present
    @Binding var isPresented: Bool
    let sheet: () -> C

    func body(content: Content) -> some View {
        if let present {
            content.onChange(of: isPresented) { _, now in
                guard now, isPresented else { return }
                isPresented = false
                present(AnyView(sheet()))
            }
        } else {
            content.sheet(isPresented: $isPresented, content: sheet)
        }
    }
}
