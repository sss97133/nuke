import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useStore } from "../store/useStore";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Download,
  ExternalLink,
} from "lucide-react";

export default function SetupStep() {
  const {
    ollamaConnected,
    setOllamaConnected,
    availableModels,
    setAvailableModels,
    selectedModel,
    setSelectedModel,
    setStep,
  } = useStore();

  const [checking, setChecking] = useState(false);

  async function checkOllama() {
    setChecking(true);
    try {
      const connected = await invoke<boolean>("check_ollama");
      setOllamaConnected(connected);

      if (connected) {
        const models = await invoke<string[]>("list_ollama_models");
        setAvailableModels(models);

        // Auto-select vision model
        const visionModels = models.filter(
          (m) =>
            m.includes("llava") ||
            m.includes("bakllava") ||
            m.includes("vision")
        );
        if (visionModels.length > 0 && !selectedModel) {
          setSelectedModel(visionModels[0]);
        }
      }
    } catch (e) {
      console.error(e);
    }
    setChecking(false);
  }

  const visionModels = availableModels.filter(
    (m) =>
      m.includes("llava") || m.includes("bakllava") || m.includes("vision")
  );

  const canProceed = ollamaConnected && selectedModel && visionModels.length > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Welcome to Nuke Intake</h2>
        <p className="text-gray-400">
          Let's set up local AI processing for your vehicle documents.
        </p>
      </div>

      {/* Ollama Status */}
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {ollamaConnected ? (
              <CheckCircle className="text-nuke-500" size={24} />
            ) : (
              <XCircle className="text-red-500" size={24} />
            )}
            <div>
              <h3 className="font-semibold">Ollama</h3>
              <p className="text-sm text-gray-400">
                {ollamaConnected
                  ? "Connected and ready"
                  : "Not running - start Ollama to continue"}
              </p>
            </div>
          </div>
          <button
            onClick={checkOllama}
            disabled={checking}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
          >
            <RefreshCw size={16} className={checking ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {!ollamaConnected && (
          <div className="bg-gray-700/50 rounded-lg p-4 space-y-3">
            <p className="text-sm">
              Ollama is a local AI runtime. Install it to process documents
              privately on your machine.
            </p>
            <div className="flex gap-3">
              <a
                href="https://ollama.ai/download"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition"
              >
                <Download size={16} />
                Download Ollama
              </a>
              <a
                href="https://ollama.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 transition"
              >
                <ExternalLink size={16} />
                Learn More
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Model Selection */}
      {ollamaConnected && (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <h3 className="font-semibold">Vision Model</h3>

          {visionModels.length === 0 ? (
            <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 space-y-3">
              <p className="text-yellow-200 text-sm">
                No vision model found. You need a model that can analyze images.
              </p>
              <div className="text-sm text-gray-400 space-y-2">
                <p>Run this command in your terminal:</p>
                <code className="block bg-gray-900 px-3 py-2 rounded font-mono text-nuke-400">
                  ollama pull llava
                </code>
              </div>
              <button
                onClick={checkOllama}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 rounded-lg hover:bg-yellow-500 transition"
              >
                <RefreshCw size={16} />
                Check Again
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-nuke-500"
              >
                {visionModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <p className="text-sm text-gray-400">
                {visionModels.length} vision model(s) available
              </p>
            </div>
          )}
        </div>
      )}

      {/* Continue */}
      <div className="flex justify-end">
        <button
          onClick={() => setStep("scan")}
          disabled={!canProceed}
          className="flex items-center gap-2 px-6 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Scan
        </button>
      </div>
    </div>
  );
}
