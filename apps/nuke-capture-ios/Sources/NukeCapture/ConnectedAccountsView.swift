// ConnectedAccountsView.swift — what the user chooses to link to their profile.
//
// BYOK doctrine (laser-tag): Nuke owns the checklist + harness; the user brings
// their OWN compute — their ChatGPT / Claude / Grok / Gemini subscription. The key
// is theirs, the cost is theirs; Nuke never meters its own AI against the user.
// Mirrors the web `user_ai_providers` model (AIProviderSettings.tsx): a row per
// provider, the key stored base64 in api_key_encrypted, RLS-scoped to the user.
// Accounting (QuickBooks) links via the web OAuth hub.

import SwiftUI
import Supabase

private struct LinkedProvider: Decodable, Identifiable {
    let id: UUID
    let provider: String
    let model_name: String?
    let is_default: Bool?
    let is_active: Bool?
}

// The providers a user can bring. provider is free text in the DB, so xAI/Grok fits.
private struct ProviderOption: Identifiable {
    let key: String          // stored in user_ai_providers.provider
    let label: String        // "OpenAI (ChatGPT)"
    let defaultModel: String
    let icon: String
    var id: String { key }
}
private let providerOptions: [ProviderOption] = [
    .init(key: "openai",    label: "OpenAI · ChatGPT",  defaultModel: "gpt-4o",            icon: "bubble.left.and.text.bubble.right"),
    .init(key: "anthropic", label: "Anthropic · Claude", defaultModel: "claude-sonnet-4-6", icon: "sparkles"),
    .init(key: "xai",       label: "xAI · Grok",         defaultModel: "grok-2",            icon: "bolt"),
    .init(key: "google",    label: "Google · Gemini",    defaultModel: "gemini-1.5-pro",    icon: "diamond"),
]

struct ConnectedAccountsView: View {
    @State private var providers: [LinkedProvider] = []
    @State private var loaded = false
    @State private var loadError = false
    @State private var showAdd = false
    @State private var balanceCents: Int? = nil

    private func label(for key: String) -> String {
        providerOptions.first { $0.key == key }?.label ?? key.capitalized
    }
    private func icon(for key: String) -> String {
        providerOptions.first { $0.key == key }?.icon ?? "key"
    }
    // Which compute tier is driving: your own key (BYOK) > prepaid wallet > nothing.
    private var computeSource: String {
        if !providers.isEmpty { return "Your linked key" }
        if let c = balanceCents, c > 0 { return "Nuke wallet" }
        return "Not configured"
    }

    var body: some View {
        List {
            // ── Compute status (read-only) ─────────────────────────────────────
            Section {
                HStack {
                    Text("Running on").foregroundStyle(.secondary)
                    Spacer()
                    Text(computeSource).font(.callout.monospacedDigit())
                }
                if let c = balanceCents, c > 0 {
                    HStack {
                        Text("Nuke wallet").foregroundStyle(.secondary)
                        Spacer()
                        Text(String(format: "$%.2f", Double(c) / 100)).font(.callout.monospacedDigit())
                    }
                }
            } header: {
                Text("Compute")
            } footer: {
                Text("Analysis runs on your linked key when present. The Nuke wallet is prepaid managed compute, funded on the web.")
            }

            // ── BYOK AI ────────────────────────────────────────────────────────
            Section {
                if !loaded {
                    HStack(spacing: 8) { ProgressView(); Text("Loading…").font(.footnote).foregroundStyle(.secondary) }
                } else if loadError {
                    HStack {
                        Label("Couldn't load", systemImage: "wifi.exclamationmark").font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await load() } }.font(.footnote)
                    }
                } else if providers.isEmpty {
                    Text("Link your ChatGPT, Claude, Grok, or Gemini subscription — the app runs analysis on YOUR key, never metered against ours.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    ForEach(providers) { p in
                        HStack {
                            Image(systemName: icon(for: p.provider)).foregroundStyle(.secondary).frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(label(for: p.provider)).foregroundStyle(.primary)
                                Text(p.model_name ?? "—").font(.caption2.monospaced()).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if p.is_default == true {
                                Text("default").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .onDelete { idx in Task { await remove(idx) } }
                }
                Button { showAdd = true } label: { Label("Link a provider", systemImage: "plus") }
            } header: {
                Text("AI · bring your own")
            } footer: {
                Text("Your key, your subscription, your cost. Stored on your account, used only for your vehicles.")
            }

            // ── Accounting ─────────────────────────────────────────────────────
            Section {
                Link(destination: URL(string: "https://nuke.ag/settings")!) {
                    HStack {
                        Label("QuickBooks", systemImage: "building.columns")
                        Spacer()
                        Text("Connect").foregroundStyle(.blue)
                        Image(systemName: "arrow.up.right.square").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Accounting")
            } footer: {
                Text("QuickBooks links through the web (OAuth) — opens nuke.ag/settings.")
            }
        }
        .navigationTitle("Connected accounts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            AddProviderSheet { await load() }
        }
    }

    private func load() async {
        loadError = false
        do {
            providers = try await SupabaseService.client
                .from("user_ai_providers")
                .select("id,provider,model_name,is_default,is_active")
                .order("is_default", ascending: false)
                .execute().value
        } catch {
            loadError = true
            NSLog("NukeCapture providers load failed: %@", String(describing: error))
        }
        // Read-only prepaid wallet balance (RLS-scoped to the caller via auth.uid()).
        if let c: Int = try? await SupabaseService.client.rpc("my_ai_credit_balance").execute().value {
            balanceCents = c
        }
        loaded = true
    }

    private func remove(_ offsets: IndexSet) async {
        let ids = offsets.map { providers[$0].id }
        do {
            for id in ids {
                try await SupabaseService.client
                    .from("user_ai_providers").delete().eq("id", value: id.uuidString.lowercased()).execute()
            }
            await load()
        } catch {
            NSLog("NukeCapture provider remove failed: %@", String(describing: error))
        }
    }
}

// ── Link-a-provider sheet ──────────────────────────────────────────────────────
private struct AddProviderSheet: View {
    var onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected = providerOptions[0]
    @State private var model = providerOptions[0].defaultModel
    @State private var apiKey = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Provider") {
                    Picker("Provider", selection: Binding(
                        get: { selected.key },
                        set: { k in
                            selected = providerOptions.first { $0.key == k } ?? providerOptions[0]
                            model = selected.defaultModel
                        }
                    )) {
                        ForEach(providerOptions) { p in Text(p.label).tag(p.key) }
                    }
                    TextField("Model", text: $model).autocorrectionDisabled().textInputAutocapitalization(.never)
                }
                Section {
                    SecureField("API key", text: $apiKey)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                } header: { Text("Your \(selected.label) key") }
                footer: { Text("Stored on your account, used only to analyze your own vehicles. You can remove it anytime.") }

                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Link provider")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Link") { Task { await save() } }
                        .disabled(saving || apiKey.trimmingCharacters(in: .whitespaces).isEmpty || model.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        guard SupabaseService.currentUserId != nil else { error = "Not signed in"; return }
        saving = true; error = nil
        defer { saving = false }
        let trimmed = apiKey.trimmingCharacters(in: .whitespaces)
        // Reject a Claude OAuth subscription token pasted as an API key. sk-ant-oat… is a
        // subscription bearer (it routes through the OAuth path), NOT an API key — pasting it
        // here produces a dead, mis-classified credential. Anthropic API keys start sk-ant-api.
        if selected.key == "anthropic" && trimmed.hasPrefix("sk-ant-oat") {
            error = "That's a Claude subscription token, not an API key. Paste a key that starts with sk-ant-api… (Anthropic Console → API Keys)."
            return
        }
        // Send the PLAINTEXT key to set-ai-provider over TLS; it encrypts at rest with the
        // server key (AES-GCM). The client never writes the api_key_encrypted column directly.
        struct Body: Encodable { let provider: String; let api_key: String; let model_name: String }
        do {
            try await SupabaseService.client.functions.invoke(
                "set-ai-provider",
                options: FunctionInvokeOptions(body: Body(
                    provider: selected.key,
                    api_key: trimmed,
                    model_name: model.trimmingCharacters(in: .whitespaces))))
            await onDone()
            dismiss()
        } catch {
            self.error = "Couldn't link — check the key and try again."
            NSLog("NukeCapture provider link failed: %@", String(describing: error))
        }
    }
}
