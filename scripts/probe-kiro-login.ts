import { chromium } from 'playwright'

async function main() {
  const headless = process.argv.includes('--headless')
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' })
  const page = await context.newPage()
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.includes('/operation/')) return
    console.log('[operation]', resp.status(), url)
    const text = await resp.text().catch(() => '')
    if (text) console.log(text.slice(0, 300))
  })
  await page.goto('https://app.kiro.dev/signin', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(3000)
  console.log('url=', page.url())
  console.log((await page.locator('body').innerText({ timeout: 5000 }).catch((e) => String(e))).slice(0, 2000))
  await page.screenshot({ path: 'artifacts/probe-kiro-login.png', fullPage: true }).catch(() => undefined)
  console.log('screenshot=artifacts/probe-kiro-login.png')
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
