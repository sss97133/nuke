import { useEffect, useState } from 'react'
import { useAuth } from '@dealerscan/shared'
import type { ExtractionMode, OllamaModel } from '@dealerscan/shared'
import { Settings as SettingsIcon, Server, Cloud, Cpu, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user } = useAuth()
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('cloud')
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(setAppVersion)
    }
    checkOllama()
  }, [])

  const checkOllama = async () => {
    setOllamaStatus('checking')
    try {
      const resp = await fetch('http://localhost:11434/api/tags')
      if (resp.ok) {
        const data = await resp.json()
        const models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
          supportsVision: ['llava', 'bakllava', 'moondream', 'llama3.2-vision'].some(v => m.name.includes(v)),
        }))
        setOllamaModels(models)
        setOllamaStatus('connected')
        const visionModel = models.find((m: OllamaModel) => m.supportsVision)
        if (visionModel && !selectedModel) {
          setSelectedModel(visionModel.name)
        }
      } else {
        setOllamaStatus('disconnected')
      }
    } catch {
      setOllamaStatus('disconnected')
    }
  }

  const modes: { id: ExtractionMode; label: string; desc: string; icon: typeof Cloud }[] = [
    { id: 'cloud', label: 'Cloud', desc: 'Uses credits. Best accuracy via OpenAI/Anthropic.', icon: Cloud },
    { id: 'local', label: 'Local (Ollama)', desc: 'Free. Lower accuracy. Requires Ollama running locally.', icon: Cpu },
    { id: 'hybrid', label: 'Hybrid', desc: 'Cloud first, falls back to Ollama on failure or no credits.', icon: Server },
  ]

  const visionModels = ollamaModels.filter(m => m.supportsVision)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 mt-12">
      <div className="flex items-center gap-2 mb-6">
        <SettingsIcon className="w-5 h-5 text-gray-700" />
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
      </div>

      {/* Extraction Mode */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Extraction Mode</h2>
        <div className="space-y-2">
          {modes.map(mode => (
            <button
              key={mode.id}
              onClick={() => setExtractionMode(mode.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                extractionMode === mode.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <mode.icon className={`w-5 h-5 ${extractionMode === mode.id ? 'text-blue-600' : 'text-gray-400'}`} />
              <div>
                <p className={`text-sm font-medium ${extractionMode === mode.id ? 'text-blue-900' : 'text-gray-900'}`}>{mode.label}</p>
                <p className="text-xs text-gray-500">{mode.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Ollama Status */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Ollama Status</h2>
          <button onClick={checkOllama} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            Refresh
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          {ollamaStatus === 'checking' ? (
            <><Loader2 className="w-4 h-4 text-gray-400 animate-spin" /><span className="text-sm text-gray-500">Checking...</span></>
          ) : ollamaStatus === 'connected' ? (
            <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-sm text-green-700">Connected - {ollamaModels.length} models available</span></>
          ) : (
            <><XCircle className="w-4 h-4 text-red-500" /><span className="text-sm text-red-700">Not running</span></>
          )}
        </div>

        {ollamaStatus === 'disconnected' && (
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
            <p className="font-medium mb-1">To use local extraction:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Install Ollama from <span className="font-mono">ollama.com</span></li>
              <li>Run: <span className="font-mono bg-gray-200 px-1 rounded">ollama pull llava</span></li>
              <li>Ensure Ollama is running, then click Refresh</li>
            </ol>
          </div>
        )}

        {visionModels.length > 0 && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Vision Model</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {visionModels.map(m => (
                <option key={m.name} value={m.name}>{m.name} ({(m.size / 1e9).toFixed(1)}GB)</option>
              ))}
            </select>
          </div>
        )}

        {ollamaStatus === 'connected' && visionModels.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mt-3">
            No vision models found. Run: <span className="font-mono bg-amber-100 px-1 rounded">ollama pull llava</span>
          </div>
        )}
      </div>

      {/* Account */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Account</h2>
        <p className="text-sm text-gray-600">{user?.email}</p>
        {appVersion && <p className="text-xs text-gray-400 mt-2">DealerScan Desktop v{appVersion}</p>}
      </div>
    </div>
  )
}
