import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { useStore } from "../store/useStore";
import { Cpu, ArrowLeft, ArrowRight, Pause, Play, SkipForward } from "lucide-react";

export default function ProcessStep() {
  const {
    scannedDocuments,
    selectedModel,
    extractions,
    addExtraction,
    clearExtractions,
    processingIndex,
    setProcessingIndex,
    isProcessing,
    setIsProcessing,
    setStep,
  } = useStore();

  const [currentPreview, setCurrentPreview] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentDoc = scannedDocuments[processingIndex];
  const progress = scannedDocuments.length > 0
    ? Math.round((processingIndex / scannedDocuments.length) * 100)
    : 0;

  useEffect(() => {
    if (currentDoc && currentDoc.file_type === "image") {
      setCurrentPreview(convertFileSrc(currentDoc.path));
    } else {
      setCurrentPreview(null);
    }
  }, [currentDoc]);

  async function processNext() {
    if (processingIndex >= scannedDocuments.length || paused) {
      setIsProcessing(false);
      return;
    }

    setIsProcessing(true);
    setError(null);
    const doc = scannedDocuments[processingIndex];

    try {
      const result = await invoke<any>("process_document", {
        path: doc.path,
        model: selectedModel,
      });
      addExtraction(result);
    } catch (e: any) {
      console.error(`Failed to process ${doc.filename}:`, e);
      setError(e.toString());
      // Add a failed entry
      addExtraction({
        path: doc.path,
        document_type: "error",
        confidence: 0,
        extracted: {},
        raw_response: e.toString(),
      });
    }

    setProcessingIndex(processingIndex + 1);
  }

  useEffect(() => {
    if (isProcessing && !paused && processingIndex < scannedDocuments.length) {
      const timer = setTimeout(processNext, 100);
      return () => clearTimeout(timer);
    }
  }, [isProcessing, paused, processingIndex]);

  function startProcessing() {
    clearExtractions();
    setProcessingIndex(0);
    setPaused(false);
    setIsProcessing(true);
  }

  function togglePause() {
    setPaused(!paused);
    if (paused) {
      // Resume
      processNext();
    }
  }

  function skip() {
    setProcessingIndex(processingIndex + 1);
  }

  const lastExtraction = extractions[extractions.length - 1];
  const canProceed = extractions.length > 0 && !isProcessing;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Processing Documents</h2>
        <p className="text-gray-400">
          AI is analyzing each document to extract vehicle information.
        </p>
      </div>

      {/* Progress */}
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">
            {processingIndex} of {scannedDocuments.length} processed
          </span>
          <span className="text-sm font-medium">{progress}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-nuke-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3">
          {!isProcessing && processingIndex === 0 ? (
            <button
              onClick={startProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition"
            >
              <Play size={18} />
              Start Processing
            </button>
          ) : (
            <>
              <button
                onClick={togglePause}
                disabled={processingIndex >= scannedDocuments.length}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
              >
                {paused ? <Play size={18} /> : <Pause size={18} />}
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={skip}
                disabled={processingIndex >= scannedDocuments.length || !isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
              >
                <SkipForward size={18} />
                Skip
              </button>
            </>
          )}
        </div>
      </div>

      {/* Current document preview */}
      {currentDoc && isProcessing && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Cpu size={18} className="animate-pulse text-nuke-400" />
              Processing: {currentDoc.filename}
            </h3>
            {currentPreview ? (
              <img
                src={currentPreview}
                alt={currentDoc.filename}
                className="w-full h-64 object-contain bg-gray-900 rounded"
              />
            ) : (
              <div className="w-full h-64 bg-gray-900 rounded flex items-center justify-center text-gray-500">
                {currentDoc.file_type === "pdf" ? "PDF Document" : "Preview unavailable"}
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-3">Last Extraction</h3>
            {lastExtraction ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Type:</span>
                  <span className="font-medium">{lastExtraction.document_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Confidence:</span>
                  <span
                    className={`font-medium ${
                      lastExtraction.confidence >= 0.7
                        ? "text-nuke-400"
                        : lastExtraction.confidence >= 0.4
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {Math.round(lastExtraction.confidence * 100)}%
                  </span>
                </div>
                {lastExtraction.extracted.vin && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">VIN:</span>
                    <span className="font-mono">{lastExtraction.extracted.vin}</span>
                  </div>
                )}
                {lastExtraction.extracted.year && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Year:</span>
                    <span>{lastExtraction.extracted.year}</span>
                  </div>
                )}
                {lastExtraction.extracted.make && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Make:</span>
                    <span>{lastExtraction.extracted.make}</span>
                  </div>
                )}
                {lastExtraction.extracted.model && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Model:</span>
                    <span>{lastExtraction.extracted.model}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Waiting for first result...</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-200 text-sm">
          Error: {error}
        </div>
      )}

      {/* Stats */}
      {extractions.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">{extractions.length}</div>
            <div className="text-sm text-gray-400">Processed</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-nuke-400">
              {extractions.filter((e) => e.extracted.vin).length}
            </div>
            <div className="text-sm text-gray-400">With VIN</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">
              {extractions.filter((e) => e.document_type === "title").length}
            </div>
            <div className="text-sm text-gray-400">Titles</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">
              {extractions.filter((e) => e.confidence < 0.5).length}
            </div>
            <div className="text-sm text-gray-400">Low Confidence</div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setStep("scan")}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          onClick={() => setStep("review")}
          disabled={!canProceed}
          className="flex items-center gap-2 px-6 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Review Results
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
