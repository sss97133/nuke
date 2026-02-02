import { useStore } from "../store/useStore";
import { PartyPopper, RotateCcw, ExternalLink } from "lucide-react";

export default function DoneStep() {
  const { syncedCount, approvedExtractions, reset } = useStore();

  function startOver() {
    reset();
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center">
        <div className="w-20 h-20 bg-nuke-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <PartyPopper size={40} className="text-nuke-400" />
        </div>
        <h2 className="text-3xl font-bold mb-2">All Done!</h2>
        <p className="text-gray-400">
          Your vehicle documents have been processed and uploaded.
        </p>
      </div>

      {/* Stats */}
      <div className="bg-gray-800 rounded-lg p-8">
        <div className="grid grid-cols-2 gap-8 text-center">
          <div>
            <div className="text-5xl font-bold text-nuke-400">{syncedCount}</div>
            <div className="text-gray-400 mt-2">Documents Synced</div>
          </div>
          <div>
            <div className="text-5xl font-bold text-blue-400">
              {approvedExtractions.filter((e) => e.extracted.vin).length}
            </div>
            <div className="text-gray-400 mt-2">Vehicles Identified</div>
          </div>
        </div>
      </div>

      {/* Next steps */}
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <h3 className="font-semibold">What happens next?</h3>
        <ul className="space-y-3 text-sm text-gray-300">
          <li className="flex items-start gap-3">
            <span className="text-nuke-400">1.</span>
            <span>
              Nuke processes each document and links them to existing vehicles or
              creates new records.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-nuke-400">2.</span>
            <span>
              VINs are verified against NHTSA and cross-referenced with known
              databases.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-nuke-400">3.</span>
            <span>
              Any corrections to existing data are logged with full audit trail.
            </span>
          </li>
        </ul>
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        <button
          onClick={startOver}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
        >
          <RotateCcw size={18} />
          Process More Documents
        </button>
        <a
          href="https://nuke.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition"
        >
          <ExternalLink size={18} />
          View in Nuke
        </a>
      </div>
    </div>
  );
}
