// Fails when the first load (index.html's own script and stylesheet) is over the budget, gzipped.
// Standard Notes reloads an editor that hasn't loaded in 4 seconds, so the first load stays small.
// Usage: node scripts/check-bundle.mjs dist
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BUDGET = 150 * 1024
const dist = process.argv[2] ?? 'dist'
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const files = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
let total = 0
for (const f of files) {
  const size = zlib.gzipSync(fs.readFileSync(path.join(dist, f))).length
  total += size
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${f}`)
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  first load, gzipped (budget ${BUDGET / 1024} KB)`)
if (total > BUDGET) {
  console.error('Over budget.')
  process.exit(1)
}
