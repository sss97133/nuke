import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useStore } from "../store/useStore";
import { ArrowLeft, Upload, CheckCircle, AlertCircle, Key } from "lucide-react";

export default function SyncStep() {
  const {
    approvedExtractions,
    syncedCount,
    setSyncedCount,
    isSyncing,
    setIsSyncing,
    setStep,
  } = useStore();

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function configure() {
    try {
      await invoke("configure_supabase", {
        url: supabaseUrl,
        key: supabaseKey,
      });
      setConfigured(true);
      setError(null);
    } catch (e: any) {
      setError(e.toString());
    }
  }

  async function startSync() {
    setIsSyncing(true);
    setError(null);

    try {
      const count = await invoke<number>("sync_to_supabase", {
        extractions: approvedExtractions,
      });
      setSyncedCount(count);
      setStep("done");
    } catch (e: any) {
      setError(e.toString());
    }

    setIsSyncing(false);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Sync to Nuke</h2>
        <p className="text-gray-400">
          Connect to your Nuke account and upload the approved extractions.
        </p>
      </div>

      {/* Summary */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-bold text-nuke-400">
              {approvedExtractions.length}
            </div>
            <div className="text-gray-400">documents ready to sync</div>
          </div>
          <div className="text-right text-sm text-gray-400">
            <div>
              {approvedExtractions.filter((e) => e.extracted.vin).length} with VIN
            </div>
            <div>
              {approvedExtractions.filter((e) => e.document_type === "title").length}{" "}
              titles
            </div>
          </div>
        </div>
      </div>

      {/* Supabase config */}
      {!configured ? (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Key size={20} />
            <h3 className="font-semibold">Connect to Nuke</h3>
          </div>

          <p className="text-sm text-gray-400">
            Enter your Nuke/Supabase credentials. These are stored locally and never
            leave your machine.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Supabase URL
              </label>
              <input
                type="text"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxxx.supabase.co"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-nuke-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Service Role Key
              </label>
              <input
                type="password"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-nuke-500"
              />
            </div>
          </div>

          <button
            onClick={configure}
            disabled={!supabaseUrl || !supabaseKey}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition disabled:opacity-50"
          >
            Connect
          </button>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 text-nuke-400">
            <CheckCircle size={20} />
            <span>Connected to Nuke</span>
          </div>

          <button
            onClick={startSync}
            disabled={isSyncing || approvedExtractions.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition disabled:opacity-50"
          >
            <Upload size={20} className={isSyncing ? "animate-bounce" : ""} />
            {isSyncing
              ? "Syncing..."
              : `Upload ${approvedExtractions.length} Extractions`}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-red-200 text-sm">{error}</div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setStep("review")}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
        >
          <ArrowLeft size={18} />
          Back
        </button>
      </div>
    </div>
  );
}
