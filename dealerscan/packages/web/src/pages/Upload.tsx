import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createDeal, uploadAndExtract, useAuth, useCredits } from '@dealerscan/shared'
import { Upload as UploadIcon, Camera, X, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

interface FileItem {
  file: File
  id: string
  status: 'queued' | 'uploading' | 'extracting' | 'done' | 'error'
  progress: number
  result?: any
  error?: string
}

export default function Upload() {
  const { user } = useAuth()
  const { credits, refresh: refreshCredits } = useCredits(user?.id)
  const [dealName, setDealName] = useState('')
  const [files, setFiles] = useState<FileItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [dealId, setDealId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const addFiles = useCallback((input: HTMLInputElement) => {
    const newFiles = input.files
    if (!newFiles || newFiles.length === 0) return

    const items: FileItem[] = Array.from(newFiles)
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      .map(f => ({
        file: f,
        id: crypto.randomUUID(),
        status: 'queued' as const,
        progress: 0,
      }))

    setFiles(prev => [...prev, ...items])
    input.value = ''
  }, [])

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const items: FileItem[] = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      .map(f => ({
        file: f,
        id: crypto.randomUUID(),
        status: 'queued' as const,
        progress: 0,
      }))
    setFiles(prev => [...prev, ...items])
  }, [])

  const handleStartExtraction = async () => {
    const queued = files.filter(f => f.status === 'queued')
    if (queued.length === 0) return
    setProcessing(true)

    try {
      let currentDealId = dealId
      if (!currentDealId) {
        const deal = await createDeal(dealName || undefined)
        currentDealId = deal.id
        setDealId(deal.id)
      }

      for (let i = 0; i < queued.length; i++) {
        const item = queued[i]

        setFiles(prev => prev.map(f =>
          f.id === item.id ? { ...f, status: 'uploading', progress: 5 } : f
        ))

        try {
          const result = await uploadAndExtract(
            currentDealId,
            item.file,
            files.indexOf(item) + 1,
            (pct) => setFiles(prev => prev.map(f =>
              f.id === item.id ? { ...f, status: pct > 50 ? 'extracting' : 'uploading', progress: pct } : f
            ))
          )
          setFiles(prev => prev.map(f =>
            f.id === item.id ? { ...f, status: 'done', progress: 100, result } : f
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
            f.id === item.id ? { ...f, status: 'error', error: err.message.substring(0, 100) } : f
          ))
        }
      }

      const doneNow = files.filter(f => f.status === 'done').length
      if (doneNow > 0) {
        toast.success(`${doneNow} pages extracted!`)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setProcessing(false)
    }
  }

  const queuedCount = files.filter(f => f.status === 'queued').length
  const doneCount = files.filter(f => f.status === 'done').length
  const errorCount = files.filter(f => f.status === 'error').length
  const reviewCount = files.filter(f => f.result?.needs_review).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Upload Documents</h1>

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

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-700">Drop documents here or click to browse</p>
        <p className="text-xs text-gray-500 mt-1">JPEG, PNG, HEIC, PDF - up to 15MB each. Select multiple files.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={e => e.target && addFiles(e.target)}
        />
      </div>

      {/* Camera button (mobile) */}
      <button
        onClick={() => cameraInputRef.current?.click()}
        className="mt-3 w-full flex items-center justify-center gap-2 border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:hidden"
      >
        <Camera className="w-4 h-4" /> Take Photo
      </button>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => e.target && addFiles(e.target)}
      />

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">{files.length} files selected</p>
            {!processing && queuedCount > 0 && (
              <button
                onClick={() => setFiles([])}
                className="text-xs text-gray-500 hover:text-red-500"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {files.map(item => (
              <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                  {item.status === 'done' ? (
                    item.result?.needs_review ?
                      <AlertCircle className="w-4 h-4 text-amber-500" /> :
                      <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : item.status === 'uploading' || item.status === 'extracting' ? (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  ) : item.status === 'error' ? (
                    <X className="w-4 h-4 text-red-500" />
                  ) : (
                    <FileText className="w-4 h-4 text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.file.name}</p>
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
                  {(item.file.size / 1024).toFixed(0)}KB
                </div>
                {item.status === 'queued' && !processing && (
                  <button onClick={() => removeFile(item.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
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
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing {files.filter(f => f.status === 'uploading' || f.status === 'extracting').length > 0 ? `(${doneCount + errorCount + 1}/${files.length})` : '...'}</>
                ) : (
                  `Extract ${queuedCount} Files`
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
          Some extractions may not complete. <button onClick={() => navigate('/billing')} className="underline font-medium">Buy more credits</button>
        </div>
      )}
    </div>
  )
}
