import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { useStore } from "../store/useStore";
import {
  FolderPlus,
  Trash2,
  Search,
  FileImage,
  FileText,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

export default function ScanStep() {
  const {
    scanPaths,
    addScanPath,
    removeScanPath,
    scannedDocuments,
    setScannedDocuments,
    isScanning,
    setIsScanning,
    setStep,
  } = useStore();

  async function selectFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select folder to scan",
    });

    if (selected && typeof selected === "string") {
      addScanPath(selected);
    }
  }

  async function startScan() {
    setIsScanning(true);
    const allDocs: any[] = [];

    for (const path of scanPaths) {
      try {
        const docs = await invoke<any[]>("scan_directory", { path });
        allDocs.push(...docs);
      } catch (e) {
        console.error(`Failed to scan ${path}:`, e);
      }
    }

    setScannedDocuments(allDocs);
    setIsScanning(false);
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canProceed = scannedDocuments.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Select Folders to Scan</h2>
        <p className="text-gray-400">
          Choose folders containing vehicle documents (titles, registrations,
          invoices, photos).
        </p>
      </div>

      {/* Folder selection */}
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Folders</h3>
          <button
            onClick={selectFolder}
            className="flex items-center gap-2 px-4 py-2 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition"
          >
            <FolderPlus size={16} />
            Add Folder
          </button>
        </div>

        {scanPaths.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FolderPlus size={48} className="mx-auto mb-3 opacity-50" />
            <p>No folders selected</p>
            <p className="text-sm">Click "Add Folder" to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {scanPaths.map((path) => (
              <div
                key={path}
                className="flex items-center justify-between bg-gray-700 rounded-lg px-4 py-3"
              >
                <span className="font-mono text-sm truncate flex-1">{path}</span>
                <button
                  onClick={() => removeScanPath(path)}
                  className="text-gray-400 hover:text-red-400 transition ml-3"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}

        {scanPaths.length > 0 && (
          <button
            onClick={startScan}
            disabled={isScanning}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
          >
            <Search size={18} className={isScanning ? "animate-pulse" : ""} />
            {isScanning ? "Scanning..." : "Scan for Documents"}
          </button>
        )}
      </div>

      {/* Scan results */}
      {scannedDocuments.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              Found {scannedDocuments.length} Documents
            </h3>
            <div className="flex gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1">
                <FileImage size={14} />
                {scannedDocuments.filter((d) => d.file_type === "image").length}{" "}
                images
              </span>
              <span className="flex items-center gap-1">
                <FileText size={14} />
                {scannedDocuments.filter((d) => d.file_type === "pdf").length}{" "}
                PDFs
              </span>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1">
            {scannedDocuments.slice(0, 100).map((doc, i) => (
              <div
                key={doc.path}
                className="flex items-center gap-3 px-3 py-2 bg-gray-700/50 rounded text-sm"
              >
                {doc.file_type === "image" ? (
                  <FileImage size={16} className="text-blue-400" />
                ) : (
                  <FileText size={16} className="text-orange-400" />
                )}
                <span className="truncate flex-1">{doc.filename}</span>
                <span className="text-gray-500">{formatBytes(doc.size_bytes)}</span>
              </div>
            ))}
            {scannedDocuments.length > 100 && (
              <p className="text-center text-gray-500 text-sm py-2">
                ...and {scannedDocuments.length - 100} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setStep("setup")}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          onClick={() => setStep("process")}
          disabled={!canProceed}
          className="flex items-center gap-2 px-6 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Process Documents
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
