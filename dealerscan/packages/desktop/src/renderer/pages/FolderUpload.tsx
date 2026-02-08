import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createDeal, uploadAndExtract, mergeDeal, useAuth, useCredits } from '@dealerscan/shared'
import { FolderOpen, FileText, Loader2, CheckCircle, AlertCircle, X, Play } from 'lucide-react'
import toast from 'react-hot-toast'

interface ScannedFile {
  name: string
  path: string
  ext: string
  size: number
  status: 'queued' | 'uploading' | 'extracting' | 'done' | 'error'
  progress: number
  result?: any
  error?: string
}

function base64ToFile(base64: string, name: string, type: string): File {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], name, { type })
}

export default function FolderUpload() {
  const { user } = useAuth()
  const { credits, refresh: refreshCredits } = useCredits(user?.id)
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [files, setFiles] = useState<ScannedFile[]>([])
  const [dealName, setDealName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [dealId, setDealId] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSelectFolder = useCallback(async () => {
    if (!window.electronAPI) return
    const selected = await window.electronAPI.selectFolder()
    if (!selected) return

    setFolderPath(selected)
    const scanned = await window.electronAPI.readFilesInFolder(selected)
    setFiles(scanned.map(f => ({
      ...f,
      status: 'queued',
      progress: 0,
    })))

    // Auto-set deal name from folder name
    const folderName = selected.split('/').pop() || selected.split('\\').pop() || ''
    if (!dealName) {
      setDealName(folderName)
    }
  }, [dealName])

  const handleStartExtraction = async () => {
    const queued = files.filter(f => f.status === 'queued')
    if (queued.length === 0) return
    setProcessing(true)

    try {
      // Create deal
      let currentDealId = dealId
      if (!currentDealId) {
        const deal = await createDeal(dealName || undefined)
        currentDealId = deal.id
        setDealId(deal.id)
      }

      for (let i = 0; i < queued.length; i++) {
        const item = queued[i]

        setFiles(prev => prev.map(f =>
          f.path === item.path ? { ...f, status: 'uploading', progress: 5 } : f
        ))

        try {
          // Read file from disk via IPC
          const fileData = await window.electronAPI.readFileAsBuffer(item.path)
          const file = base64ToFile(fileData.buffer, fileData.name, fileData.type)

          setFiles(prev => prev.map(f =>
            f.path === item.path ? { ...f, progress: 20 } : f
          ))

          const result = await uploadAndExtract(
            currentDealId,
            file,
            i + 1,
            (pct) => setFiles(prev => prev.map(f =>
              f.path === item.path
                ? { ...f, status: pct > 50 ? 'extracting' : 'uploading', progress: pct }
                : f
            ))
          )

          setFiles(prev => prev.map(f =>
            f.path === item.path ? { ...f, status: 'done', progress: 100, result } : f
          ))
          refreshCredits()
        } catch (err: any) {
          if (err.message === 'NO_CREDITS') {
            toast.error('Out of credits! Purchase more to continue.')
            setFiles(prev => prev.map(f =>
              f.status === 'queued' ? { ...f, status: 'error', error: 'No credits' } : f
            ))
            break
          }
          setFiles(prev => prev.map(f =>
            f.path === item.path ? { ...f, status: 'error', error: err.message.substring(0, 100) } : f
          ))
        }
      }

      // Auto-merge when all files processed
      const doneCount = files.filter(f => f.status === 'done').length + queued.filter(f => f.status !== 'error').length
      if (doneCount > 0 && currentDealId) {
        try {
          await mergeDeal(currentDealId)
          toast.success('All files processed and deal merged!')
        } catch {
          toast.success('Files processed! You can merge the deal manually.')
        }
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setProcessing(false)
    }
  }

  const removeFile = (filePath: string) => {
    setFiles(prev => prev.filter(f => f.path !== filePath))
  }

  const queuedCount = files.filter(f => f.status === 'queued').length
  const doneCount = files.filter(f => f.status === 'done').length
  const errorCount = files.filter(f => f.status === 'error').length
  const reviewCount = files.filter(f => f.result?.needs_review).length
  const totalProgress = files.length > 0
    ? Math.round(files.reduce((sum, f) => sum + f.progress, 0) / files.length)
    : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 mt-12">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Scan Folder</h1>

      {/* Deal name */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Deal Name (optional)</label>
        <input
          type="text"
          value={dealName}
          onChange={e => setDealName(e.target.value)}
          placeholder="e.g. 2019 Toyota Camry - Smith"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          disabled={processing}
        />
      </div>

      {/* Folder picker */}
      <button
        onClick={handleSelectFolder}
        disabled={processing}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer disabled:opacity-50"
      >
        <FolderOpen className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        {folderPath ? (
          <>
            <p className="text-sm font-medium text-gray-900">{folderPath}</p>
            <p className="text-xs text-gray-500 mt-1">{files.length} supported files found. Click to change folder.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">Select a folder to scan</p>
            <p className="text-xs text-gray-500 mt-1">JPEG, PNG, HEIC, PDF, TIFF files will be detected</p>
          </>
        )}
      </button>

      {/* Overall progress bar */}
      {processing && files.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600">
              Processing {doneCount + errorCount + 1} of {files.length}
            </span>
            <span className="text-xs text-gray-500">{totalProgress}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">{files.length} files</p>
            {!processing && queuedCount > 0 && (
              <button
                onClick={() => { setFiles([]); setFolderPath(null) }}
                className="text-xs text-gray-500 hover:text-red-500"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {files.map(item => (
              <div key={item.path} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                  {item.status === 'done' ? (
                    item.result?.needs_review
                      ? <AlertCircle className="w-4 h-4 text-amber-500" />
                      : <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : item.status === 'uploading' || item.status === 'extracting' ? (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  ) : item.status === 'error' ? (
                    <X className="w-4 h-4 text-red-500" />
                  ) : (
                    <FileText className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  {(item.status === 'uploading' || item.status === 'extracting') && (
                    <div className="mt-1">
                      <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${item.progress}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{item.status === 'extracting' ? 'Extracting data...' : 'Uploading...'}</p>
                    </div>
                  )}
                  {item.result && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.result.document_type}
                      {item.result.needs_review ? ' - needs review' : ' - auto-accepted'}
                    </p>
                  )}
                  {item.error && <p className="text-xs text-red-500 mt-0.5">{item.error}</p>}
                </div>
                <div className="text-xs text-gray-400 flex-shrink-0">
                  {(item.size / 1024).toFixed(0)}KB
                </div>
                {item.status === 'queued' && !processing && (
                  <button onClick={() => removeFile(item.path)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {files.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {doneCount > 0 && <span className="text-green-600">{doneCount} done</span>}
            {errorCount > 0 && <span className="text-red-500">{doneCount > 0 ? ', ' : ''}{errorCount} failed</span>}
            {reviewCount > 0 && <span className="text-amber-600"> ({reviewCount} need review)</span>}
            {queuedCount > 0 && <span> {queuedCount} queued</span>}
          </p>
          <div className="flex gap-3">
            {doneCount > 0 && dealId && (
              <button
                onClick={() => navigate(`/deal/${dealId}`)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                View Deal
              </button>
            )}
            {queuedCount > 0 && (
              <button
                onClick={handleStartExtraction}
                disabled={processing}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {processing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><Play className="w-4 h-4" /> Extract {queuedCount} Files</>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Credits warning */}
      {credits && queuedCount > 0 && credits.total_available < queuedCount && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          You have {credits.total_available} credits but {queuedCount} files queued.
          Some extractions may not complete.{' '}
          <button onClick={() => navigate('/billing')} className="underline font-medium">Buy more credits</button>
        </div>
      )}
    </div>
  )
}
