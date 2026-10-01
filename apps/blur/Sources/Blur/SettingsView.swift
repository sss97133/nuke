// SettingsView.swift — about, the privacy promise, and the upgrade teaser.
//
// v0 has no account and no purchases — the upgrade row is a teaser only. When
// the paid "automatic image handling" phase ships, this is where the StoreKit
// paywall and (once accounts exist) sign-in + account deletion (App Store
// 5.1.1(v)) live.

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var library: LibraryEngine
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Image(systemName: "wand.and.stars")
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Automatic organization")
                                .font(.subheadline.weight(.semibold))
                            Text("Connect your own AI — a local model or your own subscription — and let Blur build and complete your galleries for you. Your photos stay yours; processing runs through the provider you choose. Coming soon.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Upgrade")
                } footer: {
                    Text("Free stays free and anonymous. Upgrading is optional and never required to use Blur.")
                }

                Section {
                    LabeledContent("Galleries", value: "\(library.galleries.count)")
                    LabeledContent("Hidden photos", value: "\(library.hiddenAssetIDs.count)")
                } header: {
                    Text("On this device")
                } footer: {
                    Text("Everything Blur does happens on your phone. Your photos and your choices never leave this device.")
                }

                Section("About") {
                    LabeledContent("App", value: Config.appName)
                    Text("A Nuke product.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
