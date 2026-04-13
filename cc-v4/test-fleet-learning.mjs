// test-fleet-learning.mjs — Verify fleet-learning page in production
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const errors = []
page.on('pageerror', err => errors.push(err.message))
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })

await page.goto('https://orchestrator-production-c27e.up.railway.app/fleet-learning', { waitUntil: 'domcontentloaded', timeout: 30000 })

const hasError = await page.getByText('Application Error').isVisible().catch(() => false)
const hasCrash = await page.getByText('Cannot read properties').isVisible().catch(() => false)
const title = await page.locator('h1').textContent().catch(() => null)
const kpiValues = await page.locator('.text-2xl.font-bold').count().catch(() => 0)

console.log('=== Fleet Learning Page Test ===')
console.log('URL:', page.url())
console.log('Application Error:', hasError ? 'YES ❌' : 'No ✅')
console.log('Crash Error:', hasCrash ? 'YES ❌' : 'No ✅')
console.log('Console/Page Errors:', errors.length > 0 ? errors.join(', ') : 'None ✅')
console.log('Page title:', title)
console.log('KPI values found:', kpiValues)

await page.screenshot({ path: '../fleet-learning-test.png', fullPage: true })
console.log('Screenshot: ../fleet-learning-test.png')
await browser.close()

if (hasError || hasCrash || errors.length > 0) { console.log('\n❌ FAILED'); process.exit(1) }
else { console.log('\n✅ PASSED'); process.exit(0) }
