import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { useStore } from "../store/useStore";
import {
  Check,
  X,
  ArrowLeft,
  ArrowRight,
  FileImage,
  Edit2,
  Save,
} from "lucide-react";

export default function ReviewStep() {
  const { extractions, approvedExtractions, approveExtraction, rejectExtraction, setStep } =
    useStore();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<any>(null);

  const validExtractions = extractions.filter(
    (e) => e.document_type !== "error" && e.document_type !== "unknown"
  );
  const current = validExtractions[selectedIndex];
  const isApproved = current && approvedExtractions.some((e) => e.path === current.path);

  function handleApprove() {
    if (current) {
      approveExtraction(current.path);
      if (selectedIndex < validExtractions.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      }
    }
  }

  function handleReject() {
    if (current) {
      rejectExtraction(current.path);
      if (selectedIndex < validExtractions.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      }
    }
  }

  function startEdit() {
    if (current) {
      setEditData({ ...current.extracted });
      setEditing(true);
    }
  }

  function saveEdit() {
    // In a real app, we'd update the extraction
    setEditing(false);
  }

  const approvalRate = validExtractions.length > 0
    ? Math.round((approvedExtractions.length / validExtractions.length) * 100)
    : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Review Extractions</h2>
        <p className="text-gray-400">
          Approve or reject each extraction before syncing to Nuke.
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between bg-gray-800 rounded-lg px-6 py-4">
        <div className="flex gap-6">
          <div>
            <span className="text-2xl font-bold">{validExtractions.length}</span>
            <span className="text-gray-400 ml-2">total</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-nuke-400">
              {approvedExtractions.length}
            </span>
            <span className="text-gray-400 ml-2">approved</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-red-400">
              {validExtractions.length - approvedExtractions.length - (validExtractions.length - selectedIndex - 1)}
            </span>
            <span className="text-gray-400 ml-2">rejected</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">{approvalRate}% approved</div>
          <div className="text-sm text-gray-400">
            {selectedIndex + 1} of {validExtractions.length}
          </div>
        </div>
      </div>

      {/* Review panel */}
      {current ? (
        <div className="grid grid-cols-2 gap-6">
          {/* Image preview */}
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold truncate">{current.path.split("/").pop()}</h3>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  current.confidence >= 0.7
                    ? "bg-nuke-500/20 text-nuke-400"
                    : current.confidence >= 0.4
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {Math.round(current.confidence * 100)}% confidence
              </span>
            </div>
            <img
              src={convertFileSrc(current.path)}
              alt="Document"
              className="w-full h-80 object-contain bg-gray-900 rounded"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          {/* Extracted data */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Extracted Data</h3>
              <div className="flex gap-2">
                {editing ? (
                  <button
                    onClick={saveEdit}
                    className="flex items-center gap-1 px-3 py-1 bg-nuke-600 rounded text-sm hover:bg-nuke-500 transition"
                  >
                    <Save size={14} />
                    Save
                  </button>
                ) : (
                  <button
                    onClick={startEdit}
                    className="flex items-center gap-1 px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600 transition"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Document Type</span>
                <span className="font-medium capitalize">{current.document_type}</span>
              </div>

              {[
                { key: "vin", label: "VIN" },
                { key: "year", label: "Year" },
                { key: "make", label: "Make" },
                { key: "model", label: "Model" },
                { key: "owner_name", label: "Owner" },
                { key: "mileage", label: "Mileage" },
                { key: "price", label: "Price" },
                { key: "date", label: "Date" },
              ].map(({ key, label }) => {
                const value = (current.extracted as any)[key];
                if (!value && !editing) return null;

                return (
                  <div key={key} className="flex justify-between items-center">
                    <span className="text-gray-400">{label}</span>
                    {editing ? (
                      <input
                        type="text"
                        value={editData?.[key] || ""}
                        onChange={(e) =>
                          setEditData({ ...editData, [key]: e.target.value })
                        }
                        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm w-48"
                      />
                    ) : (
                      <span className={`font-medium ${key === "vin" ? "font-mono" : ""}`}>
                        {key === "price" && value ? `$${value.toLocaleString()}` : value}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Approval status */}
            {isApproved && (
              <div className="bg-nuke-500/20 border border-nuke-500/50 rounded-lg px-4 py-2 flex items-center gap-2">
                <Check size={18} className="text-nuke-400" />
                <span className="text-nuke-200">Approved for sync</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleReject}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500/20 border border-red-500/50 rounded-lg hover:bg-red-500/30 transition text-red-200"
              >
                <X size={18} />
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={isApproved}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-nuke-500/20 border border-nuke-500/50 rounded-lg hover:bg-nuke-500/30 transition text-nuke-200 disabled:opacity-50"
              >
                <Check size={18} />
                {isApproved ? "Approved" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-12 text-center">
          <FileImage size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400">No valid extractions to review</p>
        </div>
      )}

      {/* Thumbnail navigation */}
      {validExtractions.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {validExtractions.map((ext, i) => {
            const isSelected = i === selectedIndex;
            const isApproved = approvedExtractions.some((e) => e.path === ext.path);

            return (
              <button
                key={ext.path}
                onClick={() => setSelectedIndex(i)}
                className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition ${
                  isSelected
                    ? "border-nuke-500"
                    : isApproved
                    ? "border-nuke-500/50"
                    : "border-transparent"
                }`}
              >
                <img
                  src={convertFileSrc(ext.path)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "";
                    (e.target as HTMLImageElement).className = "w-full h-full bg-gray-700";
                  }}
                />
                {isApproved && (
                  <div className="absolute inset-0 bg-nuke-500/30 flex items-center justify-center">
                    <Check size={24} className="text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setStep("process")}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          onClick={() => setStep("sync")}
          disabled={approvedExtractions.length === 0}
          className="flex items-center gap-2 px-6 py-3 bg-nuke-600 rounded-lg hover:bg-nuke-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Sync {approvedExtractions.length} to Nuke
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
