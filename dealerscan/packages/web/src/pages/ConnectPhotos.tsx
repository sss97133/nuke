import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { connectPhotos, useAuth } from '@dealerscan/shared'
import { ImageIcon, Link2, ExternalLink, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Connect photos: link external image URLs to a deal. We store references only; analysis can fetch by URL when needed.
 * See docs/PRODUCT_DEAL_JACKET_PIPELINE.md § Connect photos (external galleries).
 */
export default function ConnectPhotos() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [urlsText, setUrlsText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const urls = urlsText
      .split(/\n/)
      .map((u) => u.trim())
      .filter(Boolean)
    if (urls.length === 0) {
      toast.error('Paste at least one image URL (one per line).')
      return
    }
    setSubmitting(true)
    try {
      const { deal_id } = await connectPhotos(urls)
      toast.success(`Connected ${urls.length} photo(s).`)
      navigate(`/deal/${deal_id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect photos.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-600">Sign in to connect photos.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Connect photos</h1>
            <p className="text-sm text-gray-500">Add image URLs to a deal (reference-only)</p>
          </div>
        </div>

        <p className="text-gray-600 mb-4">
          Paste image URLs (e.g. from SmugMug, Flickr, or any public image link), one per line.
          We store the references and use them in the deal jacket—we don’t download the files.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Image URLs (one per line)
          </label>
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Connecting…
              </>
            ) : (
              'Connect photos'
            )}
          </button>
        </form>

        <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-6">
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <ExternalLink className="w-4 h-4" /> Upload files instead
          </Link>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <Link2 className="w-4 h-4" /> Back to dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
