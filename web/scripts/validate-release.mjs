/** Verify the exact committed browser payload and (optionally) the Pages artifact. */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isDist = process.argv[2] === '--dist'
if (process.argv.length > 3 || (process.argv[2] && !isDist)) {
  throw new Error('Usage: node scripts/validate-release.mjs [--dist]')
}
const sourceDir = path.join(webRoot, 'public', 'model-data')
const dataDir = isDist ? path.join(webRoot, 'dist', 'model-data') : sourceDir
const names = ['contributions.json', 'manifest.json', 'overview.json', 'segments.json', 'simulator.json']
const forbidden = /TRANSACTION_ID|FILE_SUBMISSION_ID|ACCOUNT_LOYALTY_ID_NUMBER|CONTACT_NAME|EMAIL_ADDRESS|PHONE_NUMBER|UPC14|SOURCE_TRANSACTIONS|SOURCE_STORES|SOURCE_BRANDS|RSS_SILVER|CAREDX|\bMSA\b/i
const actual = (await readdir(dataDir)).sort()
if (actual.join('|') !== names.join('|')) throw new Error(`Unexpected public data files: ${actual.join(', ')}`)

const bytes = new Map()
for (const name of names) {
  const content = await readFile(path.join(dataDir, name))
  if (forbidden.test(content.toString('utf8'))) throw new Error(`${name} contains a forbidden source identifier`)
  bytes.set(name, content)
}
const manifest = JSON.parse(bytes.get('manifest.json').toString('utf8'))
if (manifest.schema_version !== 'm4-1' || manifest.reference_model !== 'partial' ||
    Object.keys(manifest.files).sort().join('|') !== names.filter(name => name !== 'manifest.json').join('|')) {
  throw new Error('Manifest version or payload inventory mismatch')
}
for (const name of names.filter(name => name !== 'manifest.json')) {
  const content = bytes.get(name)
  const digest = createHash('sha256').update(content).digest('hex')
  if (content.byteLength !== manifest.files[name].bytes || digest !== manifest.files[name].sha256) {
    throw new Error(`${name} differs from the committed manifest checksum or byte count`)
  }
  const payload = JSON.parse(content.toString('utf8'))
  if (payload.bundle_id !== manifest.bundle_id || payload.schema_version !== manifest.schema_version) {
    throw new Error(`${name} uses a different export bundle`)
  }
}
const simulator = JSON.parse(bytes.get('simulator.json').toString('utf8'))
if (simulator.draw_count !== 96 || simulator.draws.length !== 96 ||
    simulator.source_posterior_draw_count <= 96) {
  throw new Error('Public simulator must contain only the approved 96-draw subset')
}

if (isDist) {
  for (const name of names) {
    const committed = await readFile(path.join(sourceDir, name))
    if (!committed.equals(bytes.get(name))) throw new Error(`Built ${name} differs from committed export`)
  }
  const root = (await readdir(path.join(webRoot, 'dist'))).sort()
  if (root.join('|') !== 'assets|index.html|model-data') throw new Error(`Unexpected Pages artifact entries: ${root}`)
  const assetNames = await readdir(path.join(webRoot, 'dist', 'assets'))
  if (!assetNames.length || assetNames.some(name => !/^[\w.-]+\.(js|css)$/.test(name))) {
    throw new Error(`Unexpected built asset: ${assetNames}`)
  }
  const html = await readFile(path.join(webRoot, 'dist', 'index.html'), 'utf8')
  if (!html.includes('/bayesian-mmm-lab/assets/') || /(?:src|href)=["']\/assets\//.test(html)) {
    throw new Error('Built asset URLs do not use the repository Pages base')
  }
  for (const name of assetNames) {
    const asset = await readFile(path.join(webRoot, 'dist', 'assets', name), 'utf8')
    if (forbidden.test(asset)) throw new Error(`Built asset ${name} contains a forbidden source identifier`)
  }
}
const total = names.reduce((sum, name) => sum + bytes.get(name).byteLength, 0)
console.log(`${isDist ? 'Pages artifact' : 'Committed public data'} verified: ${names.length} JSON files, ${total} bytes; 96 of ${simulator.source_posterior_draw_count} posterior draws.`)
