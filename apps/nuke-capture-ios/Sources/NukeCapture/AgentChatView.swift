// AgentChatView.swift — the in-app two-way agent (operate in the app, off Claude Code).
//
// The conversational face of the SAME correction verbs the photo drill's buttons use:
// "the interior shots are my white daily-driver, not this truck" → the agent lists the
// garage, creates the profile if needed, and moves the photo (relink_testimony) — the
// identical organs as the "Not this vehicle?" button. Grounded in the photo/vehicle in
// front of you (passed as context); owner-gated (runs as you, server-side).
//
// Backend: the agent-chat edge function (STAGED for deploy; needs ANTHROPIC_API_KEY).
// Until it's deployed, this surface renders but every send returns the upstream error —
// honestly, not a fake reply.

import Foundation
import Supabase
import SwiftUI

// ─── Wire to the agent-chat edge function ────────────────────────────────────
// Kept here (not in SupabaseService) to avoid colliding with concurrent edits there.

enum AgentService {
    struct Message: Codable { let role: String; let content: String }
    struct Action: Decodable { let tool: String? }
    struct Reply: Decodable { let reply: String?; let actions: [Action]?; let error: String? }

    private struct Body: Encodable {
        let messages: [Message]
        let context: Context
        struct Context: Encodable { let vehicle_id: String?; let image_id: String? }
    }

    static func ask(_ messages: [Message], vehicleId: String?, imageId: String?) async throws -> Reply {
        let body = Body(messages: messages, context: .init(vehicle_id: vehicleId, image_id: imageId))
        return try await SupabaseService.client.functions
            .invoke("agent-chat", options: FunctionInvokeOptions(body: body))
    }

    // The car's own agent (vehicle-agent), as the web garage card's "Ask this car's agent" calls it: one
    // message plus the earlier turns, writes allowed (it records observations through ingest-observation).
    struct VehicleReply: Decodable {
        struct Wrote: Decodable { let id: String? }
        let reply: String?; let wrote: [Wrote]?; let error: String?
    }
    private struct VehicleBody: Encodable {
        let vehicle_id: String; let message: String; let history: [Message]; let allow_writes: Bool
    }

    static func askVehicle(_ message: String, history: [Message], vehicleId: String) async throws -> VehicleReply {
        let body = VehicleBody(vehicle_id: vehicleId, message: message, history: history, allow_writes: true)
        do {
            return try await SupabaseService.client.functions
                .invoke("vehicle-agent", options: FunctionInvokeOptions(body: body))
        } catch FunctionsError.httpError(_, let data) {
            // The function answers its refusals as {"error": "..."}; say that, not a transport error.
            if let r = try? JSONDecoder().decode(VehicleReply.self, from: data), r.error != nil { return r }
            throw FunctionsError.httpError(code: 0, data: data)
        }
    }
}

// ─── The chat surface — restrained, the app's grammar ────────────────────────

struct AgentChatView: View {
    /// Which agent answers: the app's agent-chat, or one car's vehicle-agent (the garage card's).
    enum Backend { case agentChat, vehicleAgent }

    /// Context the agent is grounded in (the photo/vehicle you opened it from).
    var vehicleId: String? = nil
    var imageId: String? = nil
    var backend: Backend = .agentChat
    /// The first line shown before any message (the garage card names the car).
    var prompt: String? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var messages: [ChatMsg] = []
    @State private var draft = ""
    @State private var sending = false

    /// `isError` bubbles are shown but never sent back as history.
    struct ChatMsg: Identifiable { let id = UUID(); let role: String; let text: String; var isError = false; var note: String? = nil }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            if messages.isEmpty {
                                Text(prompt ?? "Tell me what's off and I'll fix it — e.g. “the interior shots are my white daily-driver, not this truck.”")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                    .padding()
                            }
                            ForEach(messages) { m in bubble(m).id(m.id) }
                            if sending {
                                HStack { ProgressView().padding(.leading, 16); Spacer() }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let last = messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                Divider()
                HStack(spacing: 8) {
                    TextField("Ask the agent…", text: $draft, axis: .vertical)
                        .lineLimit(1...4)
                        .textFieldStyle(.roundedBorder)
                    Button { Task { await send() } } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                    .accessibilityLabel("Send")
                    .disabled(sending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(10)
            }
            .navigationTitle("Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } } }
        }
    }

    @ViewBuilder private func bubble(_ m: ChatMsg) -> some View {
        HStack {
            if m.role == "user" { Spacer(minLength: 44) }
            Text(m.note.map { "\(m.text)\n\n\($0)" } ?? m.text)
                .font(.callout)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(
                    m.role == "user" ? Color.accentColor.opacity(0.9) : Color(.secondarySystemFill),
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .foregroundStyle(m.role == "user" ? Color.white : Color.primary)
                .fixedSize(horizontal: false, vertical: true)
            if m.role != "user" { Spacer(minLength: 44) }
        }
        .padding(.horizontal, 12)
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        if backend == .vehicleAgent, let vehicleId {
            let history = messages.filter { !$0.isError }.map { AgentService.Message(role: $0.role, content: $0.text) }
            messages.append(ChatMsg(role: "user", text: text))
            draft = ""
            sending = true
            do {
                let r = try await AgentService.askVehicle(text, history: history, vehicleId: vehicleId)
                if let err = r.error {
                    messages.append(ChatMsg(role: "assistant", text: err, isError: true))
                } else {
                    let wrote = r.wrote?.count ?? 0
                    messages.append(ChatMsg(role: "assistant", text: r.reply ?? "No answer.", note: wrote > 0 ? "\(wrote) recorded" : nil))
                }
            } catch {
                messages.append(ChatMsg(role: "assistant", text: "The agent did not answer.", isError: true))
            }
            sending = false
            return
        }
        messages.append(ChatMsg(role: "user", text: text))
        draft = ""
        sending = true
        let payload = messages.map { AgentService.Message(role: $0.role, content: $0.text) }
        do {
            let r = try await AgentService.ask(payload, vehicleId: vehicleId, imageId: imageId)
            if let err = r.error {
                messages.append(ChatMsg(role: "assistant", text: "⚠️ " + err))
            } else {
                messages.append(ChatMsg(role: "assistant", text: r.reply ?? "(no reply)"))
            }
        } catch {
            messages.append(ChatMsg(role: "assistant", text: "⚠️ Couldn't reach the agent (it deploys with the agent-chat function)."))
        }
        sending = false
    }
}
