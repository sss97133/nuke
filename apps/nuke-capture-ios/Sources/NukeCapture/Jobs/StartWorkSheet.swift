// StartWorkSheet.swift — "Start work" for the accepted technician (start_work), pinned to the hash
// in the job view's start_work action: the accepted quote, or the accepted offer's terms.

import SwiftUI

struct StartWorkSheet: View {
    let action: JobAction
    let workOrderId: String
    var jobTitle: String? = nil
    var onDone: () -> Void = {}

    var body: some View {
        SignStepSheet(title: "Start work",
                      says: [PostJobCopy.startSays(action.termsBasis), PostJobCopy.startClock],
                      doesNotSay: action.doesNotBind.isEmpty ? PostJobCopy.startDoesNotSay : action.doesNotBind.map(PostJobCopy.startDoesNotBind),
                      saysTitle: "Starting says",
                      confirmTitle: "Start work", successTitle: "Started",
                      successDetail: "The job shows Work as started, with this time.",
                      confirmEnabled: PostJobDrafting.start(action, workOrderId: workOrderId) != nil,
                      details: {
                          Section {
                              if let jobTitle { RootedValueView(label: "Job", value: jobTitle, status: .attributed) }
                              RootedValueView(label: "Terms", value: JobCopy.termsBasis(action.termsBasis), status: .attributed,
                                              decay: "pinned to exactly what was accepted")
                          } header: {
                              Text("You're starting")
                          }
                      },
                      confirm: start, onDone: onDone)
    }

    private func start() async -> String? {
        guard let p = PostJobDrafting.start(action, workOrderId: workOrderId) else {
            return "This can't be started from here. Refresh the job and try again."
        }
        if case .failure(let f) = await PostJobReaders.write("start_work", p) { return f.text }
        return nil
    }
}
