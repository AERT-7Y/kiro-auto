import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import cbor from 'cbor'
import { chromium, type BrowserContext, type Cookie, type Page } from 'playwright'
import { clean, type EventLogger, sleep, trimMessage } from './common'

export const KIRO_ORIGIN = 'https://app.kiro.dev'
export const KIRO_SIGNIN_URL = `${KIRO_ORIGIN}/signin`
export const SUBSCRIPTION_TYPE_PRO = 'Q_DEVELOPER_STANDALONE_PRO'

type LoginCredentials = {
  email: string
  password?: string
  recoveryEmail?: string
}

type KiroClientOptions = {
  profileDir: string
  headless?: boolean
  logger: EventLogger
  credentials?: LoginCredentials
  freshProfile?: boolean
  artifactDir?: string
  existingContext?: BrowserContext
  existingPage?: Page
  closeExistingContext?: boolean
}

export type KiroSessionInfo = {
  profileArn: string
  userInfo: unknown
  usage: unknown
  cookies: Cookie[]
}

export type KiroCheckoutInfo = {
  checkoutUrl: string
  profileArn: string
  subscriptionType: string
  raw: unknown
}



export type KiroSocialCredential = {
  email: string
  refreshToken: string
  accessToken?: string
  idp?: string
  userId?: string
  profileArn?: string
  expiresAt?: string
  region: string
}

export type KiroSubscriptionState = {
  type: string
  title: string
  managementTarget: string
  upgradeCapability: string
  isPaid: boolean
}

export function readSubscriptionState(usage: unknown): KiroSubscriptionState {
  const info = (usage as any)?.subscriptionInfo || {}
  const type = clean(info.type)
  const title = clean(info.subscriptionTitle)
  const managementTarget = clean(info.subscriptionManagementTarget)
  const upgradeCapability = clean(info.upgradeCapability)
  return {
    type,
    title,
    managementTarget,
    upgradeCapability,
    isPaid: !!type && type !== 'Q_DEVELOPER_STANDALONE_FREE' && /PRO|POWER|STUDENT/i.test(type),
  }
}

function encodeCbor(payload: unknown): Buffer {
  return cbor.encode(payload)
}

function decodeCbor(buf: ArrayBuffer | NodeJS.ArrayBufferView): unknown {
  const buffer = Buffer.isBuffer(buf)
    ? buf
    : ArrayBuffer.isView(buf)
      ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
      : Buffer.from(buf)
  if (!buffer.length) return null
  return cbor.decodeFirstSync(buffer)
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (value === null || value === undefined) return out
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out)
  }
  return out
}

function findProfileArn(...values: unknown[]): string {
  for (const value of values) {
    const found = collectStrings(value).find((s) => /^arn:aws:codewhisperer:[^:]+:\d+:profile\/[A-Z0-9]+/i.test(s))
    if (found) return found
  }
  return ''
}

function findOperationError(...values: unknown[]): string {
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    for (const obj of collectObjects(value)) {
      const type = clean(obj.__type || obj.type || obj.code)
      const message = clean(obj.message || obj.errorMessage || obj.error)
      if (type || message) {
        return [type, message].filter(Boolean).join(': ')
      }
    }
  }
  return ''
}

function isSuspendedOperation(value: unknown): boolean {
  return isKiroSuspendedText(findOperationError(value))
}

function isKiroSuspendedText(value: unknown): boolean {
  const text = clean(value).toLowerCase()
  return /suspended|temporarily suspended|unusual user activity|account.*locked|user id is temporarily suspended|authentication error|authentication failed/.test(text)
}

function collectObjects(value: unknown, out: Array<Record<string, any>> = [], depth = 0): Array<Record<string, any>> {
  if (!value || typeof value !== 'object' || depth > 10) return out
  const obj = value as Record<string, any>
  out.push(obj)
  for (const item of Array.isArray(value) ? value : Object.values(obj)) collectObjects(item, out, depth + 1)
  return out
}

function findCheckoutUrl(value: unknown): string {
  const strings = collectStrings(value)
  return strings.find((s) => /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_/i.test(s))
    || strings.find((s) => /^https:\/\/checkout\.stripe\.com\//i.test(s))
    || strings.find((s) => /cs_(live|test)_/i.test(s) && /^https?:\/\//i.test(s))
    || ''
}

function sessionMode(checkoutSessionId: string): 'live' | 'test' | '' {
  if (/^cs_live_/i.test(checkoutSessionId)) return 'live'
  if (/^cs_test_/i.test(checkoutSessionId)) return 'test'
  return ''
}

function keyMode(publishableKey: string): 'live' | 'test' | '' {
  if (/^pk_live_/i.test(publishableKey)) return 'live'
  if (/^pk_test_/i.test(publishableKey)) return 'test'
  return ''
}


function findCookieValue(cookies: Cookie[], name: string): string {
  const lower = name.toLowerCase()
  return clean(cookies.find((cookie) => cookie.name.toLowerCase() === lower)?.value)
}

function cookieExpiresAt(cookies: Cookie[], name: string): string | undefined {
  const lower = name.toLowerCase()
  const expires = cookies.find((cookie) => cookie.name.toLowerCase() === lower)?.expires
  if (!expires || expires < 0) return undefined
  return new Date(expires * 1000).toISOString()
}

function describeAuthCookies(cookies: Cookie[]): Record<string, unknown>[] {
  return cookies
    .filter((cookie) => /^(AccessToken|RefreshToken|Idp|IDP|UserId|SessionToken)$/i.test(cookie.name))
    .map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      valueLength: cookie.value.length,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      expiresAt: cookie.expires && cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : undefined,
    }))
}

function findPublishableKeys(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '')
  return Array.from(new Set(Array.from(text.matchAll(/pk_(?:live|test)_[A-Za-z0-9_\-]+/g)).map((m) => clean(m[0])).filter(Boolean)))
}

function findPublishableKeyForSession(value: unknown, checkoutSessionId: string): string {
  const expectedMode = sessionMode(checkoutSessionId)
  const keys = findPublishableKeys(value)
  return keys.find((key) => !expectedMode || keyMode(key) === expectedMode) || ''
}

function extractQueryKey(url: string, checkoutSessionId: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname.includes(`/payment_pages/${checkoutSessionId}`)) return ''
    return findPublishableKeyForSession(parsed.searchParams.get('key') || '', checkoutSessionId)
  } catch {
    return ''
  }
}

async function maybeClick(locator: ReturnType<Page['locator']>, timeout = 2500): Promise<boolean> {
  try {
    const target = locator.first()
    await target.waitFor({ state: 'visible', timeout })
    await target.click({ timeout })
    return true
  } catch {
    return false
  }
}

async function maybeFill(locator: ReturnType<Page['locator']>, value: string, timeout = 5000): Promise<boolean> {
  try {
    const target = locator.first()
    await target.waitFor({ state: 'visible', timeout })
    await target.fill(value, { timeout })
    return true
  } catch {
    return false
  }
}

async function maybePressNext(page: Page, selectors: string[], timeout = 5000): Promise<boolean> {
  for (const selector of selectors) {
    if (await maybeClick(page.locator(selector), timeout)) return true
  }
  await page.keyboard.press('Enter').catch(() => undefined)
  return true
}

async function maybeClickGoogleOAuthContinue(page: Page, logger?: EventLogger): Promise<boolean> {
  const url = page.url()
  const bodyText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')
  const isOAuthConsent = /accounts\.google\.com/.test(url)
    && (/Google will allow|Sign in with Google|This app wants permission|access this info about you|允许|授权|权限/i.test(bodyText)
      || /\/signin\/oauth\//i.test(url)
      || clean(await page.locator('c-wiz[data-view-id="ZYUIWc"]').first().getAttribute('data-view-id', { timeout: 500 }).catch(() => '')) === 'ZYUIWc')
  if (!isOAuthConsent) return false

  const clicked = await maybeClick(page.getByRole('button', { name: /^Continue$/i }), 3500)
    || await maybeClick(page.locator('button:has-text("Continue"), div[role="button"]:has-text("Continue")'), 3500)
    || await maybeClick(page.locator('[jsname="uRHG6"] button, [jsname="LgbsSe"]:has-text("Continue")'), 3500)
    || await maybeClick(page.getByRole('button', { name: /继续|同意|允许|授权/ }), 3500)
    || await maybeClick(page.locator('button:has-text("继续"), button:has-text("同意"), button:has-text("允许"), div[role="button"]:has-text("继续")'), 3500)
  if (clicked) {
    await logger?.info('已点击 Google OAuth 授权 Continue')
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
    await sleep(2000)
    return true
  }
  return false
}

export class KiroClient {
  private context: BrowserContext | null = null
  private cookies: Cookie[] = []
  private capturedOperations = new Map<string, unknown>()

  constructor(private readonly options: KiroClientOptions) {}

  async close(): Promise<void> {
    if (this.context) {
      if (this.options.existingContext && this.options.closeExistingContext === false) {
        this.context = null
        return
      }
      await this.context.close().catch(() => undefined)
      this.context = null
    }
  }

  async ensureSession(): Promise<KiroSessionInfo> {
    await this.resetProfileIfRequested()
    await mkdir(dirname(resolve(this.options.profileDir)), { recursive: true })
    await this.openContext(this.options.headless ?? true)
    let session = await this.tryReadSession()
    if (!session && this.options.headless) {
      await this.close()
      await this.openContext(false)
      session = await this.loginAutomaticallyAndReadSession()
    } else if (!session) {
      session = await this.loginAutomaticallyAndReadSession()
    }
    if (!session) throw new Error('Kiro 登录态不可用')
    return session
  }

  private async resetProfileIfRequested(): Promise<void> {
    if (this.options.existingContext) return
    if (this.options.freshProfile === false) return
    await this.options.logger.info(`清理浏览器登录环境: ${this.options.profileDir}`)
    await rm(this.options.profileDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
    this.capturedOperations.clear()
    this.cookies = []
  }


  async readSocialCredential(email: string, region = 'us-east-1', session?: KiroSessionInfo): Promise<KiroSocialCredential> {
    if (!this.context) throw new Error('browser context 未初始化')
    const cookies = await this.context.cookies(KIRO_ORIGIN)
    this.cookies = cookies
    const refreshToken = findCookieValue(cookies, 'RefreshToken')
    const accessToken = findCookieValue(cookies, 'AccessToken')
    const idp = findCookieValue(cookies, 'Idp') || findCookieValue(cookies, 'IDP')
    const userId = findCookieValue(cookies, 'UserId')
    const profileArn = session?.profileArn || findProfileArn(...Array.from(this.capturedOperations.values())) || await this.readBrowserStateProfileArn()
    await this.options.logger.event('kiro.social.cookies', { cookies: describeAuthCookies(cookies), idp, hasRefreshToken: !!refreshToken })
    if (!refreshToken) {
      throw new Error('Kiro Google 登录完成后未找到 RefreshToken cookie；请确认使用的是 app.kiro.dev 的 Google 登录流程')
    }
    if (!refreshToken.startsWith('aor')) {
      await this.options.logger.warn('Kiro RefreshToken cookie 前缀不是 aor，继续上传前请留意 kiro.rs 是否接受该格式', { valueLength: refreshToken.length })
    }
    if (refreshToken.length < 100 || refreshToken.includes('...')) {
      throw new Error(`Kiro RefreshToken 看起来不是完整 token（长度 ${refreshToken.length}）`)
    }
    if (idp && !/^Google$/i.test(idp)) {
      await this.options.logger.warn(`当前 Kiro 登录 IdP 不是 Google: ${idp}`)
    }
    await this.options.logger.info('已从 Kiro Google 登录态读取 social RefreshToken', {
      email,
      region,
      idp: idp || 'unknown',
      refreshTokenLength: refreshToken.length,
      accessTokenLength: accessToken.length || 0,
      profileArn: profileArn || undefined,
    })
    return {
      email,
      refreshToken,
      accessToken: accessToken || undefined,
      idp: idp || undefined,
      userId: userId || undefined,
      profileArn: profileArn || undefined,
      expiresAt: cookieExpiresAt(cookies, 'RefreshToken'),
      region,
    }
  }

  async generateSubscriptionManagementUrl(profileArn: string): Promise<KiroCheckoutInfo> {
    if (!this.context) throw new Error('browser context 未初始化')
    const page = this.context.pages()[0] || await this.context.newPage()
    if (!page.url().startsWith(KIRO_ORIGIN)) {
      await page.goto(`${KIRO_ORIGIN}/account/usage`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined)
    }
    const raw = await this.generateSubscriptionManagementUrlViaClient(page, profileArn).catch(async (err) => {
      await this.options.logger.warn(`前端 SDK 生成订阅链接失败，回退到直接 operation: ${err instanceof Error ? err.message : String(err)}`)
      return this.callOperation('GenerateSubscriptionManagementUrl', {
        statusOnly: false,
        provider: 'STRIPE',
        subscriptionType: SUBSCRIPTION_TYPE_PRO,
        profileArn,
      }).catch(async (fallbackErr) => {
        await this.saveDiagnosticPage(page, 'kiro-subscription-url-failed')
        throw fallbackErr
      })
    })
    const checkoutUrl = findCheckoutUrl(raw)
    if (!checkoutUrl) {
      throw new Error(`GenerateSubscriptionManagementUrl 未返回 Stripe checkout URL: ${trimMessage(JSON.stringify(raw), 500)}`)
    }
    await this.options.logger.info('已生成 Kiro Pro Stripe checkout 链接')
    await this.options.logger.event('kiro.checkout_url', { checkoutUrl })
    return { checkoutUrl, profileArn, subscriptionType: SUBSCRIPTION_TYPE_PRO, raw }
  }



  private async saveDiagnosticPage(page: Page, stem: string): Promise<void> {
    const artifactDir = this.options.artifactDir
    if (!artifactDir) return
    try {
      await mkdir(artifactDir, { recursive: true })
      const base = join(artifactDir, stem)
      const html = await page.content().catch(() => '')
      const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')
      await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => undefined)
      await writeFile(`${base}.html`, html, 'utf8').catch(() => undefined)
      await writeFile(`${base}.txt`, text, 'utf8').catch(() => undefined)
      await this.options.logger.event('kiro.browser.diagnostics', {
        screenshot: `${base}.png`,
        html: `${base}.html`,
        text: `${base}.txt`,
        url: page.url(),
      })
    } catch (err) {
      await this.options.logger.warn('保存 Kiro 页面诊断失败', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async generateSubscriptionManagementUrlViaClient(page: Page, profileArn: string): Promise<unknown> {
    return page.evaluate(async ({ subscriptionType }) => {
      const mainScript = Array.from(document.scripts)
        .map((script) => script.src)
        .find((src) => /\/main\.js(?:\?|$)/.test(src))
      if (!mainScript) throw new Error('未找到 Kiro main.js')
      const mainModule: any = await import(mainScript)
      const vendorScript = Array.from(document.scripts)
        .map((script) => script.src)
        .find((src) => /\/vendor\.js(?:\?|$)/.test(src))
      const vendorModule: any = vendorScript ? await import(vendorScript) : null
      const clientFactory = mainModule.g
      const CommandCtor = vendorModule?.cD
      if (typeof clientFactory !== 'function' || typeof CommandCtor !== 'function') {
        throw new Error(`Kiro 前端 SDK 导出不完整: client=${typeof clientFactory}, command=${typeof CommandCtor}`)
      }
      const client = clientFactory('us-east-1')
      return await client.send(new CommandCtor({ statusOnly: false, provider: 'STRIPE', subscriptionType }))
    }, { subscriptionType: SUBSCRIPTION_TYPE_PRO, profileArn })
  }


  async discoverStripePublishableKey(checkoutUrl: string, checkoutSessionId: string): Promise<string> {
    if (!this.context) throw new Error('browser context 未初始化')
    const expectedMode = sessionMode(checkoutSessionId)
    const fromUrl = findPublishableKeyForSession(checkoutUrl, checkoutSessionId)
    if (fromUrl) return fromUrl

    let capturedKey = ''
    const capture = async (url: string, body?: string | null) => {
      if (capturedKey) return
      if (!url.includes('stripe.com')) return
      const urlKey = extractQueryKey(url, checkoutSessionId)
      const bodyKey = body ? findPublishableKeyForSession(body, checkoutSessionId) : ''
      const key = urlKey || bodyKey
      if (key) {
        capturedKey = key
        await this.options.logger.event('stripe.browser.publishable_key', { mode: expectedMode, url, publishableKey: key })
      }
    }

    const page = await this.context.newPage()
    page.on('request', (req) => {
      capture(req.url(), req.postData()).catch(() => undefined)
    })
    page.on('response', async (resp) => {
      if (capturedKey) return
      const url = resp.url()
      if (!url.includes('stripe.com')) return
      const urlKey = extractQueryKey(url, checkoutSessionId)
      if (urlKey) {
        await capture(url)
        return
      }
      const ct = resp.headers()['content-type'] || ''
      if (/json|text|javascript|html/i.test(ct)) {
        const text = await resp.text().catch(() => '')
        await capture(url, text)
      }
    })

    try {
      await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
      const deadline = Date.now() + 45_000
      while (!capturedKey && Date.now() < deadline) {
        const htmlKey = await page.evaluate((sessionId) => {
          const text = document.documentElement?.innerHTML || ''
          const expected = sessionId.startsWith('cs_live_') ? 'pk_live_' : sessionId.startsWith('cs_test_') ? 'pk_test_' : 'pk_'
          return Array.from(new Set(Array.from(text.matchAll(/pk_(?:live|test)_[A-Za-z0-9_\-]+/g)).map((m) => m[0]))).find((key) => key.startsWith(expected)) || ''
        }, checkoutSessionId).catch(() => '')
        if (htmlKey) capturedKey = clean(htmlKey)
        if (capturedKey) break
        await sleep(500)
      }
      if (!capturedKey) {
        const seenModes = await page.evaluate(() => Array.from(new Set(Array.from(document.documentElement?.innerHTML.matchAll(/pk_(?:live|test)_[A-Za-z0-9_\-]+/g) || []).map((m) => m[0].startsWith('pk_live_') ? 'live' : 'test'))).join(',')).catch(() => '')
        throw new Error(`未从 Stripe checkout 浏览器链路捕获匹配 ${expectedMode || 'unknown'} session 的 publishable key; 页面 key modes=${seenModes || 'none'}`)
      }
      return capturedKey
    } finally {
      await page.close().catch(() => undefined)
    }
  }

  async getUsage(profileArn: string): Promise<unknown> {
    return this.callOperation('GetUserUsageAndLimits', {
      origin: 'KIRO_IDE',
      isEmailRequired: true,
      profileArn,
    })
  }

  private async openContext(headless: boolean): Promise<void> {
    if (this.context) return
    if (this.options.existingContext) {
      await this.options.logger.info('复用当前注册浏览器打开 Kiro 页面')
      this.context = this.options.existingContext
      await this.installOperationCapture()
      this.cookies = await this.context.cookies(KIRO_ORIGIN)
      return
    }
    this.options.logger.info(`打开 Kiro 专用浏览器 profile: ${this.options.profileDir}${headless ? ' (headless)' : ''}`)
    this.context = await chromium.launchPersistentContext(this.options.profileDir, {
      headless,
      viewport: { width: 1440, height: 960 },
      locale: 'en-US',
      timezoneId: 'Asia/Shanghai',
      args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check', '--disable-session-crashed-bubble'],
    })
    await this.installOperationCapture()
    this.cookies = await this.context.cookies(KIRO_ORIGIN)
  }

  private async installOperationCapture(): Promise<void> {
    if (!this.context) return
    const attach = (page: Page) => {
      page.on('response', async (resp) => {
        const match = resp.url().match(/\/operation\/([^/?#]+)/)
        if (!match) return
        try {
          const buf = await resp.body()
          if (!buf.length) return
          const decoded = decodeCbor(buf)
          this.capturedOperations.set(match[1]!, decoded)
          if (match[1] === 'ExchangeToken') {
            await this.refreshCsrfFromExchange(decoded)
          }
          await this.options.logger.event(`kiro.browser.${match[1]}`, { response: decoded })
        } catch {}
      })
    }
    for (const page of this.context.pages()) attach(page)
    this.context.on('page', attach)
  }

  private async refreshCsrfFromExchange(decoded: unknown): Promise<void> {
    const csrfToken = clean((decoded as Record<string, unknown> | null)?.csrfToken)
    const accessToken = clean((decoded as Record<string, unknown> | null)?.accessToken)
    if (!csrfToken || !this.context) return
    for (const page of this.context.pages()) {
      await page.evaluate(({ csrfToken: token, accessToken: access }) => {
        try {
          window.dispatchEvent(new CustomEvent('kiro:csrf-token-updated', { detail: { token } }))
          window.dispatchEvent(new CustomEvent('kiro:tokens-updated', { detail: { csrfToken: token, accessToken: access || undefined } }))
        } catch {}
      }, { csrfToken, accessToken }).catch(() => undefined)
    }
  }

  private async loginAutomaticallyAndReadSession(): Promise<KiroSessionInfo | null> {
    if (!this.context) throw new Error('browser context 未初始化')
    const credentials = this.options.credentials
    if (!credentials?.email || !credentials.password) {
      throw new Error('缺少 Google 账号或密码，无法自动登录；请检查 txt/邮箱.txt 是否包含 邮箱----密码')
    }
    const page = this.options.existingPage || this.context.pages()[0] || await this.context.newPage()
    await this.options.logger.info(this.options.existingContext ? '使用当前浏览器打开 Kiro 并继续登录' : '开始自动 Google 登录 Kiro')
    await page.goto(KIRO_SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await this.options.logger.event('kiro.login.goto', { url: page.url(), text: await this.readPageText(page) })
    if (this.options.existingContext) {
      await this.clickBuilderIdLogin(page)
      await this.fillBuilderIdLogin(page, credentials.email, credentials.password)
    } else {
      await this.clickGoogleLogin(page)
      await this.fillGoogleLogin(page, credentials.email, credentials.password)
    }
    return await this.waitForSession(page)
  }

  private async clickBuilderIdLogin(page: Page): Promise<void> {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (/signin\.aws|amazoncognito\.com/.test(page.url())) return
      await maybeClick(page.locator('button[aria-label="Accept all cookies"], button:has-text("Accept")'), 1200).catch(() => false)
      await this.options.logger.event('kiro.builder_id.click_tick', { url: page.url(), text: await this.readPageText(page) })
      const clicked = await maybeClick(page.locator('button:has-text("Builder ID"), a:has-text("Builder ID"), [role="button"]:has-text("Builder ID")'), 3000)
      if (clicked) {
        await this.options.logger.info('已点击 Kiro Builder ID 登录入口')
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
        await sleep(1500)
        return
      }
      await sleep(1000)
    }
    throw new Error('未找到 Builder ID 登录按钮')
  }

  private async fillBuilderIdLogin(page: Page, email: string, password: string): Promise<void> {
    const deadline = Date.now() + 3 * 60_000
    let emailDone = false
    let passwordDone = false
    let lastTick = 0
    while (Date.now() < deadline) {
      const url = page.url()
      if (url.startsWith(KIRO_ORIGIN) && !url.includes('/signin')) return
      await maybeClick(page.locator('button[aria-label="Accept all cookies"], button:has-text("Accept")'), 1000).catch(() => false)
      if (Date.now() - lastTick > 5000) {
        lastTick = Date.now()
        const pageText = await this.readPageText(page)
        await this.options.logger.event('kiro.builder_id.login_tick', {
          url,
          emailDone,
          passwordDone,
          text: pageText,
        })
        if (isKiroSuspendedText(pageText)) {
          throw new Error(`Kiro 账号不可用/被临时锁定: ${pageText}`)
        }
      }

      if (!emailDone) {
        const filled = await maybeFill(page.locator('input[placeholder="username@example.com"], input[type="email"], input[name="email"], input[type="text"]'), email, 4000)
        if (filled) {
          emailDone = true
          await this.options.logger.info('已填写 Kiro Builder ID 邮箱')
          await maybePressNext(page, ['button[data-testid="test-primary-button"]', 'button:has-text("Continue")', 'button:has-text("Next")'], 5000)
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
          await sleep(1500)
          continue
        }
      }

      if (emailDone && !passwordDone) {
        const filled = await maybeFill(page.locator('input[placeholder="Enter password"], input[type="password"], input[name="password"]'), password, 8000)
        if (filled) {
          passwordDone = true
          await this.options.logger.info('已填写 Kiro Builder ID 密码')
          await maybePressNext(page, ['button[data-testid="test-primary-button"]', 'button:has-text("Continue")', 'button:has-text("Sign in")', 'button:has-text("Next")'], 5000)
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
          await sleep(2500)
          continue
        }
      }

      const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')
      if (isKiroSuspendedText(bodyText)) {
        throw new Error(`Kiro 账号不可用/被临时锁定: ${trimMessage(bodyText.replace(/\s+/g, ' '), 600)}`)
      }
      if (/6-digit|verification code|Verify your email|验证码|验证代码/i.test(bodyText)) {
        throw new Error('Builder ID 登录 Kiro 需要邮箱验证码；当前浏览器未直接复用成功')
      }
      if (/Authorization requested|Allow access|Confirm and continue|允许访问|确认并继续/i.test(bodyText)) {
        const clicked = await maybeClick(page.locator('button:has-text("Confirm and continue"), button:has-text("Allow access"), button:has-text("Continue"), button:has-text("确认并继续"), button:has-text("允许访问")'), 3000)
        if (clicked) {
          await sleep(2500)
          continue
        }
      }
      await sleep(1000)
    }
    await this.saveDiagnosticPage(page, 'kiro-builder-id-login-timeout')
    throw new Error('Builder ID 自动登录 Kiro 超时')
  }

  private async clickGoogleLogin(page: Page): Promise<void> {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      if (/accounts\.google\.com|amazoncognito\.com/.test(page.url())) return
      const clicked = await maybeClick(page.getByText('Google', { exact: false }), 3000)
        || await maybeClick(page.locator('button:has-text("Google"), a:has-text("Google"), [role="button"]:has-text("Google")'), 3000)
      if (clicked) {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
        return
      }
      await sleep(1000)
    }
    throw new Error('未找到 Google 登录按钮')
  }

  private async fillGoogleLogin(page: Page, email: string, password: string): Promise<void> {
    const credentials = this.options.credentials || { email, password }
    const deadline = Date.now() + 3 * 60_000
    let emailDone = false
    let passwordDone = false
    while (Date.now() < deadline) {
      const url = page.url()
      if (url.startsWith(KIRO_ORIGIN) && !url.includes('/signin')) return

      if (await maybeClickGoogleOAuthContinue(page, this.options.logger)) {
        continue
      }

      if (!emailDone) {
        const filled = await maybeFill(page.locator('input[type="email"], input#identifierId, input[name="identifier"]'), email, 4000)
        if (filled) {
          emailDone = true
          await maybePressNext(page, ['#identifierNext button', 'button:has-text("Next")', 'div[role="button"]:has-text("Next")'], 5000)
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
          await sleep(1500)
          continue
        }
      }

      if (emailDone && !passwordDone) {
        const filled = await maybeFill(page.locator('input[type="password"], input[name="Passwd"]'), password, 8000)
        if (filled) {
          passwordDone = true
          await maybePressNext(page, ['#passwordNext button', 'button:has-text("Next")', 'div[role="button"]:has-text("Next")'], 5000)
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
          await sleep(2500)
          continue
        }
      }

      const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')
      if (credentials.recoveryEmail && /Confirm your recovery email|Enter recovery email|Recovery email|确认辅助邮箱|恢复邮箱|安全邮箱/i.test(bodyText)) {
        const clickedRecovery = await maybeClick(page.locator('div[role="link"]:has-text("Confirm your recovery email"), div[role="button"]:has-text("Confirm your recovery email"), li:has-text("Confirm your recovery email")'), 5000)
        if (clickedRecovery) {
          await sleep(1200)
          continue
        }
        const recoveryFilled = await maybeFill(page.locator('input[type="email"], input[name="knowledgePreregisteredEmailResponse"], input[aria-label*="email" i]'), credentials.recoveryEmail, 5000)
        if (recoveryFilled) {
          await maybePressNext(page, ['button:has-text("Next")', 'div[role="button"]:has-text("Next")'], 5000)
          await sleep(2000)
          continue
        }
      }
      if (/2-Step Verification|Verify it.?s you|Enter a verification code|Passkey|验证码|验证/i.test(bodyText)) {
        throw new Error('Google 需要额外验证，自动登录暂停；当前只支持账号密码和安全邮箱校验')
      }
      await sleep(1000)
    }
    throw new Error('Google 自动登录超时')
  }

  private async waitForSession(page: Page): Promise<KiroSessionInfo | null> {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      await maybeClickGoogleOAuthContinue(page, this.options.logger).catch(() => false)
      if (!page.url().startsWith(KIRO_ORIGIN) && !/accounts\.google\.com|amazoncognito\.com/.test(page.url())) {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
      }
      if (page.url().startsWith(KIRO_ORIGIN) && !page.url().includes('/account/usage')) {
        await page.goto(`${KIRO_ORIGIN}/account/usage`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined)
      }
      const session = await this.tryReadSession()
      if (session) return session
      await this.options.logger.event('kiro.wait_login_tick', { url: page.url(), captured: Array.from(this.capturedOperations.keys()) })
      await sleep(2000)
    }
    await this.saveDiagnosticPage(page, 'kiro-wait-session-timeout')
    return null
  }

  private async readPageText(page: Page, max = 800): Promise<string> {
    const text = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')
    return trimMessage(text.replace(/\s+/g, ' '), max)
  }

  private async readBrowserStateProfileArn(): Promise<string> {
    if (!this.context) return ''
    const page = this.context.pages()[0] || await this.context.newPage()
    try {
      const stateText = await page.evaluate(() => {
        const parts: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i) || ''
          parts.push(`${key}=${localStorage.getItem(key) || ''}`)
        }
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i) || ''
          parts.push(`${key}=${sessionStorage.getItem(key) || ''}`)
        }
        parts.push(document.body?.innerText || '')
        return parts.join('\n')
      }).catch(() => '')
      return findProfileArn(stateText)
    } catch {
      return ''
    }
  }

  private async tryReadSession(): Promise<KiroSessionInfo | null> {
    if (!this.context) throw new Error('browser context 未初始化')
    this.cookies = await this.context.cookies(KIRO_ORIGIN)
    const operationError = findOperationError(...Array.from(this.capturedOperations.values()))
    if (operationError) {
      await this.options.logger.warn(`Kiro operation 返回错误: ${operationError}`)
      if (Array.from(this.capturedOperations.values()).some((value) => isSuspendedOperation(value))) {
        throw new Error(`Kiro 账号不可用/被临时锁定: ${operationError}`)
      }
    }
    const capturedProfileArn = findProfileArn(...Array.from(this.capturedOperations.values()))
    if (capturedProfileArn) {
      await this.options.logger.info('Kiro 浏览器会话已捕获 profileArn', { profileArn: capturedProfileArn })
      return { profileArn: capturedProfileArn, userInfo: this.capturedOperations.get('GetUserInfo') || null, usage: this.capturedOperations.get('GetUserUsageAndLimits') || null, cookies: this.cookies }
    }
    const stateProfileArn = await this.readBrowserStateProfileArn()
    if (stateProfileArn) {
      await this.options.logger.info('Kiro 页面状态已发现 profileArn', { profileArn: stateProfileArn })
      return { profileArn: stateProfileArn, userInfo: null, usage: null, cookies: this.cookies }
    }
    return null
  }

  private async callOperation(operation: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.context) throw new Error('browser context 未初始化')
    const page = this.context.pages()[0] || await this.context.newPage()
    if (!page.url().startsWith(KIRO_ORIGIN)) {
      await page.goto(`${KIRO_ORIGIN}/account/usage`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined)
    }
    const capturedCsrf = clean((this.capturedOperations.get('ExchangeToken') as Record<string, unknown> | undefined)?.csrfToken)
    if (capturedCsrf) {
      await page.evaluate(({ token, accessToken }) => {
        try {
          window.dispatchEvent(new CustomEvent('kiro:csrf-token-updated', { detail: { token } }))
          window.dispatchEvent(new CustomEvent('kiro:tokens-updated', { detail: { csrfToken: token, accessToken: accessToken || undefined } }))
        } catch {}
      }, { token: capturedCsrf, accessToken: clean((this.capturedOperations.get('ExchangeToken') as Record<string, unknown> | undefined)?.accessToken) }).catch(() => undefined)
    }
    const encoded = encodeCbor(payload).toString('base64')
    const result = await page.evaluate(async ({ op, encodedBody }) => {
      const bytes = Uint8Array.from(atob(encodedBody), (c) => c.charCodeAt(0))
      const resp = await fetch(`/service/KiroWebPortalService/operation/${op}`, {
        method: 'POST',
        headers: { Accept: 'application/cbor', 'Content-Type': 'application/cbor' },
        body: bytes,
      })
      const buf = await resp.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      return { ok: resp.ok, status: resp.status, statusText: resp.statusText, body: b64 }
    }, { op: operation, encodedBody: encoded })
    const raw = Buffer.from(result.body, 'base64')
    if (!result.ok) {
      throw new Error(`Kiro ${operation} http ${result.status}: ${trimMessage(raw.toString('utf8') || result.statusText)}`)
    }
    const decoded = raw.length ? decodeCbor(raw) : null
    await this.options.logger.event(`kiro.${operation}`, { request: payload, response: decoded })
    return decoded
  }
}

export function extractCheckoutSessionId(checkoutUrl: string): string {
  const m = checkoutUrl.match(/cs_(?:live|test)_[A-Za-z0-9_\-]+/)
  return clean(m?.[0])
}
