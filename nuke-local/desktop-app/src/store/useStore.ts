import { create } from "zustand";

export interface ScannedDocument {
  path: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  modified: string;
}

export interface ExtractedData {
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  owner_name: string | null;
  mileage: number | null;
  price: number | null;
  date: string | null;
}

export interface ExtractionResult {
  path: string;
  document_type: string;
  confidence: number;
  extracted: ExtractedData;
  raw_response: string;
}

export type WizardStep = "setup" | "scan" | "process" | "review" | "sync" | "done";

interface AppStore {
  // Wizard state
  step: WizardStep;
  setStep: (step: WizardStep) => void;

  // Ollama state
  ollamaConnected: boolean;
  setOllamaConnected: (connected: boolean) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  availableModels: string[];
  setAvailableModels: (models: string[]) => void;

  // Scan state
  scanPaths: string[];
  addScanPath: (path: string) => void;
  removeScanPath: (path: string) => void;
  scannedDocuments: ScannedDocument[];
  setScannedDocuments: (docs: ScannedDocument[]) => void;
  isScanning: boolean;
  setIsScanning: (scanning: boolean) => void;

  // Processing state
  extractions: ExtractionResult[];
  addExtraction: (result: ExtractionResult) => void;
  clearExtractions: () => void;
  processingIndex: number;
  setProcessingIndex: (index: number) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;

  // Review state
  approvedExtractions: ExtractionResult[];
  approveExtraction: (path: string) => void;
  rejectExtraction: (path: string) => void;

  // Sync state
  syncedCount: number;
  setSyncedCount: (count: number) => void;
  isSyncing: boolean;
  setIsSyncing: (syncing: boolean) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  step: "setup" as WizardStep,
  ollamaConnected: false,
  selectedModel: "",
  availableModels: [],
  scanPaths: [],
  scannedDocuments: [],
  isScanning: false,
  extractions: [],
  processingIndex: 0,
  isProcessing: false,
  approvedExtractions: [],
  syncedCount: 0,
  isSyncing: false,
};

export const useStore = create<AppStore>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setOllamaConnected: (connected) => set({ ollamaConnected: connected }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setAvailableModels: (models) => set({ availableModels: models }),

  addScanPath: (path) =>
    set((state) => ({
      scanPaths: state.scanPaths.includes(path)
        ? state.scanPaths
        : [...state.scanPaths, path],
    })),
  removeScanPath: (path) =>
    set((state) => ({
      scanPaths: state.scanPaths.filter((p) => p !== path),
    })),
  setScannedDocuments: (docs) => set({ scannedDocuments: docs }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),

  addExtraction: (result) =>
    set((state) => ({
      extractions: [...state.extractions, result],
    })),
  clearExtractions: () => set({ extractions: [], approvedExtractions: [] }),
  setProcessingIndex: (index) => set({ processingIndex: index }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),

  approveExtraction: (path) => {
    const extraction = get().extractions.find((e) => e.path === path);
    if (extraction) {
      set((state) => ({
        approvedExtractions: [...state.approvedExtractions, extraction],
      }));
    }
  },
  rejectExtraction: (path) => {
    set((state) => ({
      approvedExtractions: state.approvedExtractions.filter((e) => e.path !== path),
    }));
  },

  setSyncedCount: (count) => set({ syncedCount: count }),
  setIsSyncing: (syncing) => set({ isSyncing: syncing }),

  reset: () => set(initialState),
}));
