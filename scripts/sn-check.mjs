// Runs the built plugin inside the real Standard Notes web app (offline, no account): installs it
// through Manage Plugins, makes a note, switches it to Tasks (Dev), starts a task list, creates a
// task with quick add, exports it as CSV, then reads the note back as plain text. Screenshots and the saved text go to
// <outDir> (keep it outside the repo). Needs Chromium (/snap/bin/chromium on bshome).
// The plugin is served from a fake https origin through page.route, with the CORS headers
// Standard Notes needs (manifest: origin echoed + credentials; iframe assets: *).
// Usage: npm run build && node scripts/sn-check.mjs dist <outDir>
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const [distDir, outDir] = process.argv.slice(2)
const ORIGIN = 'https://tasks-dev.example'
const manifest = {
  identifier: 'com.beshoysabri.sn-tasks.dev', name: 'Tasks (Dev)', content_type: 'SN|Component', area: 'editor-editor',
  note_type: 'markdown', file_type: 'md', version: '1.0.0', description: 'dev', url: `${ORIGIN}/index.html`,
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const log = []
const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block', bypassCSP: true })
await ctx.route(`${ORIGIN}/**`, async (route) => {
  const req = route.request()
  const u = new URL(req.url())
  const origin = req.headers()['origin']
  if (u.pathname === '/ext.json') {
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin || '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(manifest) })
  }
  const file = path.join(distDir, u.pathname === '/' ? 'index.html' : u.pathname)
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nope' })
  return route.fulfill({ status: 200, contentType: types[path.extname(file)] ?? 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) })
})
const page = await ctx.newPage()
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') log.push(`console: ${m.text().slice(0, 200)}`) })
const shot = (n) => page.screenshot({ path: path.join(outDir, `sn-${n}.png`) })
await page.goto('https://app.standardnotes.com/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
for (const label of ['Not now', 'Skip', 'Continue without an account']) {
  const b = page.getByRole('button', { name: label })
  if (await b.count()) await b.first().click().catch(() => {})
}
await page.waitForTimeout(1500)
await shot('1-start')
// A new note, switched to Tasks (Dev).
await page.getByRole('button', { name: 'Create a new note' }).first().click().catch((e) => log.push(`new note: ${e.message}`))
await page.waitForTimeout(1000)
await page.locator('#note-title-editor').fill('Personal tasks').catch(() => {})
await page.getByRole('button', { name: /Change note type/i }).first().click().catch((e) => log.push(`note type: ${e.message}`))
await page.waitForTimeout(800)
await page.getByText('Manage Plugins').first().click().catch((e) => log.push(`manage plugins: ${e.message}`))
await page.waitForTimeout(1500)
const input = page.getByPlaceholder('Enter Plugin URL')
log.push(`plugin input: ${await input.count()}`)
await input.fill(`${ORIGIN}/ext.json`).catch((e) => log.push(`fill: ${e.message}`))
await page.locator('button:has-text("Install")').last().click().catch((e) => log.push(`install: ${e.message}`))
await page.waitForTimeout(2500)
await shot('3-install')
const confirm = page.getByRole('button', { name: /^Install$/ })
if (await confirm.count()) await confirm.last().click().catch(() => {})
await page.waitForTimeout(1500)
await shot('3b-installed')
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
for (let i = 0; i < 3 && !(await page.getByText('Choose a note type').count()); i++) {
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /Change note type/i }).first().click().catch((e) => log.push(`note type 2: ${e.message}`))
  await page.waitForTimeout(800)
}
await shot('4-note-type')
log.push('menu items: ' + (await page.getByRole('menuitemradio').allInnerTexts()).join(' | '))
await page.getByRole('menuitemradio', { name: /Tasks \(Dev\)/ }).first().click().catch((e) => log.push(`pick editor: ${e.message}`))
await page.waitForTimeout(2500)
await page.getByRole('button', { name: 'Continue' }).first().click().catch((e) => log.push(`continue: ${e.message}`))
await page.waitForTimeout(3000)
await shot('5-editor')
const frame = page.frameLocator('iframe').first()
await frame.getByLabel('First project').fill('Website').catch((e) => log.push(`first project: ${e.message}`))
await frame.getByRole('button', { name: 'Create project' }).click().catch((e) => log.push(`create project: ${e.message}`))
await page.waitForTimeout(1500)
await frame.locator('body').press('c').catch(() => {})
await page.waitForTimeout(800)
await frame.getByLabel('Task title').fill('Fix the signup link #bug !urgent tomorrow').catch((e) => log.push(`title: ${e.message}`))
await page.waitForTimeout(300)
await frame.getByLabel('Task title').press('Enter').catch(() => {})
await page.waitForTimeout(1500)
await shot('6-task')
// Export: the editor's iframe is sandboxed, so check that a CSV download gets out of it.
log.push(`iframe sandbox: ${await page.locator('iframe').first().getAttribute('sandbox').catch(() => '?')}`)
await frame.locator('.sidebar .sb-item', { hasText: 'Settings' }).first().click().catch((e) => log.push(`settings: ${e.message}`))
await page.waitForTimeout(800)
const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
await frame.getByRole('button', { name: 'CSV', exact: true }).click().catch((e) => log.push(`csv: ${e.message}`))
const file = await download
// The file itself can't be read back here: snap Chromium writes downloads into its own private /tmp.
log.push(file ? `export: download started, ${file.suggestedFilename()}` : 'export: no download')
await shot('6b-export')
// What Standard Notes saved: switch the note to plain text and read it.
await page.getByRole('button', { name: /Change note type/i }).first().click().catch(() => {})
await page.waitForTimeout(500)
await page.getByRole('menuitemradio', { name: /Plain text/i }).first().click().catch((e) => log.push(`plain: ${e.message}`))
await page.waitForTimeout(1500)
const text = await page.locator('#note-text-editor').inputValue().catch(() => '')
fs.writeFileSync(path.join(outDir, 'sn-saved-note.md'), text)
await shot('7-plain')
log.push(`saved text length ${text.length}; starts ${JSON.stringify(text.slice(0, 40))}`)
await browser.close()
console.log(log.join('\n'))
