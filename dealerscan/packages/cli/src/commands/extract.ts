import { Command } from 'commander'
import { initSupabase, getSupabase, createDeal, uploadAndExtract, mergeDeal } from '@dealerscan/shared'
import { loadAuth } from './login'
import fs from 'fs'
import path from 'path'

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.pdf', '.tiff', '.tif']

function initFromAuth() {
  const auth = loadAuth()
  if (!auth) {
    console.error('Not logged in. Run: dealerscan login')
    process.exit(1)
  }
  initSupabase({ url: auth.supabaseUrl, anonKey: auth.supabaseAnonKey })
  return auth
}

export const extractCommand = new Command('extract')
  .description('Extract data from dealer jacket documents')
  .argument('<path>', 'File or folder path to process')
  .option('--deal-name <name>', 'Name for the deal')
  .option('--local', 'Use local Ollama extraction (free)')
  .action(async (inputPath, opts) => {
    const auth = initFromAuth()

    // Refresh session
    const supabase = getSupabase()
    const { error: refreshError } = await supabase.auth.setSession({
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
    })
    if (refreshError) {
      console.error('Session expired. Run: dealerscan login')
      process.exit(1)
    }

    const resolvedPath = path.resolve(inputPath)

    if (!fs.existsSync(resolvedPath)) {
      console.error(`Path not found: ${resolvedPath}`)
      process.exit(1)
    }

    // Collect files
    let files: string[] = []
    const stat = fs.statSync(resolvedPath)

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolvedPath)
      files = entries
        .filter(e => SUPPORTED_EXTENSIONS.includes(path.extname(e).toLowerCase()))
        .map(e => path.join(resolvedPath, e))
    } else {
      if (!SUPPORTED_EXTENSIONS.includes(path.extname(resolvedPath).toLowerCase())) {
        console.error(`Unsupported file type: ${path.extname(resolvedPath)}`)
        process.exit(1)
      }
      files = [resolvedPath]
    }

    if (files.length === 0) {
      console.error('No supported files found')
      process.exit(1)
    }

    console.log(`Found ${files.length} file(s) to process`)

    if (opts.local) {
      // Local extraction with Ollama
      console.log('Using local extraction (Ollama)...')
      const { checkOllamaConnection, listOllamaModels, extractWithOllama } = await import('@dealerscan/shared/services/ollamaService')

      const connected = await checkOllamaConnection()
      if (!connected) {
        console.error('Ollama is not running. Start it with: ollama serve')
        process.exit(1)
      }

      const models = await listOllamaModels()
      const visionModel = models.find(m => m.supportsVision)
      if (!visionModel) {
        console.error('No vision model found. Install one: ollama pull llava')
        process.exit(1)
      }

      console.log(`Using model: ${visionModel.name}`)

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i]
        const fileName = path.basename(filePath)
        console.log(`[${i + 1}/${files.length}] ${fileName}...`)

        const buffer = fs.readFileSync(filePath)
        const base64 = buffer.toString('base64')

        try {
          const result = await extractWithOllama(base64, visionModel.name)
          console.log(`  Type: ${result.document_type}`)
          if (result.extracted_data) {
            const data = result.extracted_data
            if (data.vin) console.log(`  VIN: ${data.vin}`)
            if (data.year || data.make || data.model) console.log(`  Vehicle: ${data.year} ${data.make} ${data.model}`)
            if (data.owner_name) console.log(`  Owner: ${data.owner_name}`)
            if (data.sale_price) console.log(`  Price: $${data.sale_price.toLocaleString()}`)
          }
        } catch (err: any) {
          console.error(`  Error: ${err.message}`)
        }
      }
    } else {
      // Cloud extraction
      const deal = await createDeal(opts.dealName || path.basename(resolvedPath))
      console.log(`Created deal: ${deal.id}`)

      let successCount = 0
      let errorCount = 0

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i]
        const fileName = path.basename(filePath)
        process.stdout.write(`[${i + 1}/${files.length}] ${fileName}... `)

        try {
          const buffer = fs.readFileSync(filePath)
          const ext = path.extname(filePath).toLowerCase()
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.heic': 'image/heic', '.pdf': 'application/pdf', '.tiff': 'image/tiff', '.tif': 'image/tiff',
          }
          const file = new File([buffer], fileName, { type: mimeTypes[ext] || 'application/octet-stream' })

          const result = await uploadAndExtract(deal.id, file, i + 1)
          console.log(`${result.document_type} ${result.needs_review ? '(needs review)' : '(ok)'}`)
          successCount++
        } catch (err: any) {
          if (err.message === 'NO_CREDITS') {
            console.log('NO CREDITS')
            console.error('\nOut of credits. Purchase more at dealerscan.com/billing')
            break
          }
          console.log(`ERROR: ${err.message}`)
          errorCount++
        }
      }

      // Auto-merge
      if (successCount > 0) {
        try {
          await mergeDeal(deal.id)
          console.log(`\nDeal merged. ${successCount} pages extracted, ${errorCount} errors.`)
        } catch {
          console.log(`\n${successCount} pages extracted, ${errorCount} errors. Merge manually at dealerscan.com`)
        }
      }
    }
  })
