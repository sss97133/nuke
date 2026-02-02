import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useStore, WizardStep } from "./store/useStore";
import SetupStep from "./components/SetupStep";
import ScanStep from "./components/ScanStep";
import ProcessStep from "./components/ProcessStep";
import ReviewStep from "./components/ReviewStep";
import SyncStep from "./components/SyncStep";
import DoneStep from "./components/DoneStep";
import {
  Settings,
  FolderSearch,
  Cpu,
  CheckCircle,
  Upload,
  PartyPopper,
} from "lucide-react";

const steps: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
  { key: "setup", label: "Setup", icon: <Settings size={18} /> },
  { key: "scan", label: "Scan", icon: <FolderSearch size={18} /> },
  { key: "process", label: "Process", icon: <Cpu size={18} /> },
  { key: "review", label: "Review", icon: <CheckCircle size={18} /> },
  { key: "sync", label: "Sync", icon: <Upload size={18} /> },
  { key: "done", label: "Done", icon: <PartyPopper size={18} /> },
];

function App() {
  const { step, setOllamaConnected, setAvailableModels, setSelectedModel } =
    useStore();

  // Check Ollama on mount
  useEffect(() => {
    async function checkOllama() {
      try {
        const connected = await invoke<boolean>("check_ollama");
        setOllamaConnected(connected);

        if (connected) {
          const models = await invoke<string[]>("list_ollama_models");
          setAvailableModels(models);

          // Auto-select a vision model if available
          const visionModels = models.filter(
            (m) =>
              m.includes("llava") ||
              m.includes("bakllava") ||
              m.includes("vision")
          );
          if (visionModels.length > 0) {
            setSelectedModel(visionModels[0]);
          } else if (models.length > 0) {
            setSelectedModel(models[0]);
          }
        }
      } catch (e) {
        console.error("Failed to check Ollama:", e);
      }
    }
    checkOllama();
  }, []);

  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-nuke-500 rounded-lg flex items-center justify-center">
              <span className="text-xl font-bold">N</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold">Nuke Intake</h1>
              <p className="text-sm text-gray-400">
                Local vehicle document processing
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Progress bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-3">
        <div className="flex items-center justify-between">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`flex items-center gap-2 ${
                i <= stepIndex ? "text-nuke-400" : "text-gray-500"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  i < stepIndex
                    ? "bg-nuke-500 text-white"
                    : i === stepIndex
                    ? "bg-nuke-500/20 border-2 border-nuke-500"
                    : "bg-gray-700"
                }`}
              >
                {s.icon}
              </div>
              <span className="text-sm font-medium hidden sm:inline">
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={`w-12 h-0.5 ${
                    i < stepIndex ? "bg-nuke-500" : "bg-gray-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {step === "setup" && <SetupStep />}
        {step === "scan" && <ScanStep />}
        {step === "process" && <ProcessStep />}
        {step === "review" && <ReviewStep />}
        {step === "sync" && <SyncStep />}
        {step === "done" && <DoneStep />}
      </main>
    </div>
  );
}

export default App;
