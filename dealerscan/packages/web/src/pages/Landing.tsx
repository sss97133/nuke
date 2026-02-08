import { Link } from 'react-router-dom'
import { FileText, Upload, CheckCircle, Download, Zap } from 'lucide-react'

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl text-gray-900">
            <FileText className="w-6 h-6 text-blue-600" />
            DealerScan
          </div>
          <Link to="/login" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 pt-20 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
          Extract dealer jacket data<br />
          <span className="text-blue-600">in seconds</span>
        </h1>
        <p className="mt-6 text-lg text-gray-600 max-w-2xl mx-auto">
          Upload photos of titles, bills of sale, cost sheets, and other dealership documents.
          Get structured, editable data back instantly with AI-powered OCR.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link to="/login" className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 text-lg">
            Start Free - 100 Extractions
          </Link>
        </div>
        <p className="mt-3 text-sm text-gray-500">No credit card required</p>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-12">How It Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
            {[
              { icon: Upload, title: 'Upload', desc: 'Snap a photo or drag and drop dealer jacket documents' },
              { icon: Zap, title: 'Extract', desc: 'AI reads every field - VINs, names, prices, dates' },
              { icon: CheckCircle, title: 'Review', desc: 'Verify flagged fields side-by-side with the original image' },
              { icon: Download, title: 'Export', desc: 'Download clean, structured data as JSON or CSV' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-12">Simple Pricing</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { name: 'Starter', credits: 100, price: '$20', per: '$0.20/each', popular: false },
              { name: 'Pro', credits: 500, price: '$90', per: '$0.18/each', popular: true },
              { name: 'Enterprise', credits: '1,000', price: '$160', per: '$0.16/each', popular: false },
            ].map(({ name, credits, price, per, popular }) => (
              <div key={name} className={`border rounded-xl p-6 ${popular ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}`}>
                {popular && <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Most Popular</span>}
                <h3 className="mt-3 font-semibold text-lg text-gray-900">{name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-bold text-gray-900">{price}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{credits} extractions ({per})</p>
                <Link to="/login" className={`mt-6 block text-center py-2 px-4 rounded-lg font-medium text-sm ${popular ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  Get Started
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-gray-500">
            Every new account gets <strong>100 free extractions</strong> to start.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500">
          DealerScan - AI-powered dealer jacket extraction
        </div>
      </footer>
    </div>
  )
}
