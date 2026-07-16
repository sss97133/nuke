export const meta = {
  name: 'appraise-vehicle',
  description: 'Blind 3-pass Eye appraisal of one 1965-66 Mustang from a local image dir (observe → cross-examine → appraise), writes JSON for landing',
  phases: [
    { title: 'Observe', detail: 'blind per-image-chunk observation vs canon', model: 'sonnet' },
    { title: 'CrossExamine', detail: 'contradictions, story-as-testimony, coverage' },
    { title: 'Appraise', detail: 'grades, condition class, defensible as-is band' },
  ],
}
const A = typeof args === 'string' ? JSON.parse(args) : args
const B = '/Users/skylar/nuke/docs/architecture/data/appraisal-method'
const IMG = A.imgDir, OUT = A.outDir, CANON = `${B}/canon_v2.md`, P = `${B}/prompts`
const CHUNK = A.chunkSize || 10

// list images
const LIST = { type:'object', properties:{ files:{type:'array', items:{type:'string'}} }, required:['files'], additionalProperties:false }
const l = await agent(`Run \`ls ${IMG}\` with Bash and return the sorted .jpg basenames as {files:[...]}. Nothing else.`,
  { label:`list:${A.carId}`, schema:LIST, model:'haiku', effort:'low' })
if (!l) throw new Error('image listing failed')
const IMAGES = l.files.map(f => `${IMG}/${f}`)
const chunks = []
for (let i=0;i<IMAGES.length;i+=CHUNK) chunks.push(IMAGES.slice(i,i+CHUNK))
log(`${A.carId}: ${IMAGES.length} images → ${chunks.length} observe chunks of ≤${CHUNK}`)

phase('Observe')
const OBS = { type:'object', properties:{ saved_to:{type:'string'}, n_images:{type:'number'}, n_canon_checks:{type:'number'}, n_fail_or_suspect:{type:'number'}, headline:{type:'string'} }, required:['saved_to','n_images','n_canon_checks','n_fail_or_suspect','headline'], additionalProperties:false }
const obs = await parallel(chunks.map((c,i)=>()=>agent(
  `Read ${P}/observer_v1.md and follow it EXACTLY (it points you to the canon at ${CANON}).\n`+
  `Your assigned images for this 1965-66 Mustang — Read EVERY file, in order. Each file is named <image_id>.jpg; PRESERVE the exact filename as the "image_file" field of each per-image observation so it can be linked later:\n${c.join('\n')}\n`+
  `Write your full observation JSON {"images":[...]} to ${OUT}/pass1_chunk${String(i).padStart(2,'0')}.json using Write, then return the compact summary.`,
  { label:`observe:${A.carId}:${i}`, phase:'Observe', schema:OBS, model:'sonnet' })))
const ok = obs.filter(Boolean)
if (!ok.length) throw new Error('all observe chunks failed')
log(`${A.carId}: observe ${ok.length}/${chunks.length} chunks · ${ok.reduce((s,o)=>s+o.n_fail_or_suspect,0)} fail/suspect`)

phase('CrossExamine')
const X = { type:'object', properties:{ saved_to:{type:'string'}, n_findings:{type:'number'}, n_contradictions:{type:'number'}, identity_verdict:{type:'string'}, coverage_overall:{type:'number'}, top_findings:{type:'array', items:{type:'string'}, maxItems:5} }, required:['saved_to','n_findings','identity_verdict','coverage_overall','top_findings'], additionalProperties:false }
const p1 = ok.map(o=>o.saved_to)
const x = await agent(
  `Read ${P}/cross_examiner_v1.md and follow it EXACTLY. Canon: ${CANON}\n`+
  `Pass-1 observation files for car ${A.carId} (read all):\n${p1.join('\n')}\n`+
  `Seller story (testimony to cross-examine — NOT ground truth): ${A.storyPath}\n`+
  `Write your full JSON to ${OUT}/pass2_crossexam.json, then return the compact summary.`,
  { label:`crossexam:${A.carId}`, phase:'CrossExamine', schema:X })
if (!x) throw new Error('cross-examiner failed')
log(`${A.carId}: cross-exam ${x.n_findings} findings · identity: ${x.identity_verdict}`)

phase('Appraise')
const AP = { type:'object', properties:{ saved_to:{type:'string'}, condition_class:{type:'string'}, band_low:{type:'number'}, band_high:{type:'number'}, confidence:{type:'number'}, priceable:{type:'boolean'}, one_liner:{type:'string'} }, required:['saved_to','condition_class','band_low','band_high','confidence','priceable','one_liner'], additionalProperties:false }
const ap = await agent(
  `Read ${P}/appraiser_v1.md and follow it EXACTLY. Canon: ${CANON}\n`+
  `Cross-examiner output for car ${A.carId}: ${OUT}/pass2_crossexam.json (read fully). You are PRICE-BLIND — no sale price is provided; never guess one from priors.\n`+
  `Write your full JSON to ${OUT}/pass3_appraisal.json, then return the compact summary.`,
  { label:`appraise:${A.carId}`, phase:'Appraise', schema:AP })
if (!ap) throw new Error('appraiser failed')
log(`${A.carId}: ${ap.condition_class} · $${ap.band_low}-$${ap.band_high} (conf ${ap.confidence})`)
return { carId:A.carId, chunks:chunks.length, observed:ok.length, crossexam:x, appraisal:ap }