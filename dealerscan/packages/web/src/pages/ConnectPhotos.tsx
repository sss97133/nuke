import { Link } from 'react-router-dom'
import { ImageIcon, Link2, ExternalLink } from 'lucide-react'

/**
 * Connect photos: link external image galleries (SmugMug, etc.).
 * We store image URLs only—no download. We use them in analysis like Bring a Trailer.
 * See docs/PRODUCT_DEAL_JACKET_PIPELINE.md § Connect photos (external galleries).
 */
export default function ConnectPhotos() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Connect photos</h1>
            <p className="text-sm text-gray-500">Link image galleries from external sources</p>
          </div>
        </div>

        <p className="text-gray-600 mb-6">
          Connect galleries (e.g. <strong>SmugMug</strong>, Flickr, Google Photos) so we can use your existing
          photos in analysis. Like Bring a Trailer: we keep images where they are—we don’t download them.
          We store references (URLs) and use them when we run document extraction and organization.
        </p>

        <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-800 mb-6">
          <strong>Coming soon.</strong> We’re adding SmugMug and other providers. You’ll be able to connect
          a gallery, then we’ll discover image URLs and run the same deal-jacket pipeline (separate, name, extract)
          without copying files.
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <ExternalLink className="w-4 h-4" /> Upload files instead
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            <Link2 className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
