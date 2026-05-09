import { chromium, Browser, Page } from 'playwright'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type LogCallback = (message: string) => void
type TempMailMessage = {
  id?: string
  from: string
  subject: string
  body?: string
  html?: string
  text?: string
}

type CloudflareTempEmailConfig = {
  baseUrl: string
  adminAuth: string
  customAuth: string
  domain: string
  useRandomSubdomain: boolean
}

const CODE_PATTERNS = [
  /(?:verification\s*code|验证码|Your code is|code is)[：:\s]*(\d{6})/gi,
  /(?:is|为)[：:\s]*(\d{6})\b/gi,
  /^\s*(\d{6})\s*$/gm,
  />\s*(\d{6})\s*</g,
]

const AWS_SENDERS = [
  'no-reply@signin.aws',
  'no-reply@login.awsapps.com',
  'noreply@amazon.com',
  'account-update@amazon.com',
  'no-reply@aws.amazon.com',
  'noreply@aws.amazon.com',
  'aws'
]

const FIRST_NAMES = ['James', 'Robert', 'John', 'Michael', 'David', 'William', 'Richard', 'Maria', 'Elizabeth', 'Jennifer', 'Linda', 'Barbara', 'Susan', 'Jessica']
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Thomas', 'Taylor']

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnvFiles(paths: string[] = ['.env.local', '.env']): void {
  for (const path of paths) {
    const candidates = [resolve(PROJECT_ROOT, path), resolve(process.cwd(), path)]
    for (const abs of candidates) {
      if (!existsSync(abs)) continue

      const content = readFileSync(abs, 'utf-8')
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue

        const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        if (!match) continue

        const key = match[1]
        if (process.env[key] !== undefined) continue

        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[key] = value
      }
    }
  }
}

loadDotEnvFiles()

function firstNonEmptyString(values: Array<unknown>): string {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const normalized = String(value).trim()
    if (normalized) return normalized
  }
  return ''
}

function generateAliasLocalPart(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const chars: string[] = []

  for (let i = 0; i < 6; i++) chars.push(letters[Math.floor(Math.random() * letters.length)])
  for (let i = 0; i < 4; i++) chars.push(digits[Math.floor(Math.random() * digits.length)])

  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}

function normalizeCloudflareTempEmailBaseUrl(rawValue = ''): string {
  const value = String(rawValue || '').trim()
  if (!value) return ''

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `https://${value}`
  try {
    const parsed = new URL(candidate)
    parsed.hash = ''
    parsed.search = ''
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
    return `${parsed.origin}${pathname}`
  } catch {
    return ''
  }
}

function normalizeCloudflareTempEmailDomain(rawValue = ''): string {
  let value = String(rawValue || '').trim().toLowerCase()
  if (!value) return ''
  value = value.replace(/^@+/, '')
  value = value.replace(/^https?:\/\//, '')
  value = value.replace(/\/.*$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return ''
  return value
}

function parseBooleanEnv(value?: string): boolean {
  return /^(1|true|yes|y|on)$/i.test(String(value || '').trim())
}

function getCloudflareTempEmailConfig(): CloudflareTempEmailConfig {
  return {
    baseUrl: normalizeCloudflareTempEmailBaseUrl(process.env.CLOUDFLARE_TEMP_EMAIL_BASE_URL),
    adminAuth: String(process.env.CLOUDFLARE_TEMP_EMAIL_ADMIN_AUTH || ''),
    customAuth: String(process.env.CLOUDFLARE_TEMP_EMAIL_CUSTOM_AUTH || ''),
    domain: normalizeCloudflareTempEmailDomain(process.env.CLOUDFLARE_TEMP_EMAIL_DOMAIN),
    useRandomSubdomain: parseBooleanEnv(process.env.CLOUDFLARE_TEMP_EMAIL_USE_RANDOM_SUBDOMAIN)
  }
}

function buildCloudflareTempEmailHeaders(config: CloudflareTempEmailConfig, json = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.adminAuth) headers['x-admin-auth'] = config.adminAuth
  if (config.customAuth) headers['x-custom-auth'] = config.customAuth
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

function joinCloudflareTempEmailUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeCloudflareTempEmailBaseUrl(baseUrl)
  const normalizedPath = String(path || '').trim()
  if (!normalizedBase || !normalizedPath) return normalizedBase || ''
  return `${normalizedBase}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`
}

function getCloudflareTempEmailMailRows(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  const obj = payload as Record<string, any>
  const candidates = [obj.data, obj.items, obj.messages, obj.mails, obj.results, obj.rows]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

function getCloudflareTempEmailAddressFromResponse(payload: any): string {
  return firstNonEmptyString([
    payload?.address,
    payload?.email,
    payload?.data?.address,
    payload?.data?.email
  ]).toLowerCase()
}

function normalizeCloudflareTempEmailMessage(row: any): TempMailMessage | null {
  if (!row || typeof row !== 'object') return null

  const raw = firstNonEmptyString([row.raw, row.source, row.mime, row.message])
  const from = firstNonEmptyString([
    row.from?.emailAddress?.address,
    row.from,
    row.sender,
    row.mail_from
  ])
  const subject = firstNonEmptyString([row.subject, row.title])
  const body = firstNonEmptyString([row.text, row.preview, row.body, row.bodyPreview, raw])
  const html = firstNonEmptyString([row.html, row.htmlBody, raw])

  return {
    id: firstNonEmptyString([row.id, row.mail_id]),
    from,
    subject,
    body,
    html,
    text: body
  }
}

async function requestCloudflareTempEmailJson(
  config: CloudflareTempEmailConfig,
  path: string,
  options: { method?: string; payload?: unknown; searchParams?: Record<string, unknown>; timeoutMs?: number } = {}
): Promise<any> {
  const method = options.method || 'GET'
  const timeoutMs = options.timeoutMs || 20000
  const url = new URL(joinCloudflareTempEmailUrl(config.baseUrl, path))

  for (const [key, value] of Object.entries(options.searchParams || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url.toString(), {
      method,
      headers: buildCloudflareTempEmailHeaders(config, options.payload !== undefined),
      body: options.payload !== undefined ? JSON.stringify(options.payload) : undefined,
      signal: controller.signal
    })
    const text = await response.text()
    let parsed: any = {}
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = text
    }

    if (!response.ok) {
      const payloadError = parsed && typeof parsed === 'object'
        ? (parsed.message || parsed.error || parsed.msg)
        : ''
      throw new Error(payloadError || text || `HTTP ${response.status}`)
    }

    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message === 'This operation was aborted'
      ? `Cloudflare Temp Email 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
      : `Cloudflare Temp Email 请求失败：${message}`)
  } finally {
    clearTimeout(timeoutId)
  }
}

function generateRandomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return `${first} ${last}`
}

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(r => setTimeout(r, delay))
}

async function simulateMouseMove(page: Page, targetX: number, targetY: number): Promise<void> {
  try {
    const steps = Math.floor(Math.random() * 10) + 5
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const controlX = targetX / 2 + (Math.random() - 0.5) * 50
      const controlY = targetY / 2 + (Math.random() - 0.5) * 50
      const pointX = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * controlX + t * t * targetX
      const pointY = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * controlY + t * t * targetY
      await page.mouse.move(Math.floor(pointX), Math.floor(pointY))
      if (Math.random() < 0.3) {
        await randomDelay(10, 50)
      }
    }
  } catch {}
}

async function simulateHumanClick(page: Page, selector: string, log: LogCallback): Promise<boolean> {
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout: 5000 })
    
    const box = await element.boundingBox()
    if (!box) {
      await element.click()
      return true
    }
    
    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 10
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 5
    
    await simulateMouseMove(page, targetX, targetY)
    await randomDelay(100, 300)
    await element.click()
    return true
  } catch {
    return false
  }
}

async function simulateHumanType(page: Page, selector: string, text: string, log: LogCallback): Promise<boolean> {
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout: 5000 })
    
    const box = await element.boundingBox()
    if (box) {
      const targetX = box.x + box.width / 2
      const targetY = box.y + box.height / 2
      await simulateMouseMove(page, targetX, targetY)
    }
    
    await randomDelay(100, 200)
    await element.click()
    await randomDelay(100, 200)
    await element.clear()
    
    for (const char of text) {
      await element.pressSequentially(char, { delay: Math.floor(Math.random() * 100) + 50 })
    }
    return true
  } catch {
    return false
  }
}

async function simulatePageScroll(page: Page): Promise<void> {
  try {
    const scrollAmount = Math.floor(Math.random() * 200) + 100
    const direction = Math.random() > 0.5 ? 1 : -1
    await page.evaluate((amount) => {
      window.scrollBy(0, amount)
    }, scrollAmount * direction)
    await randomDelay(200, 500)
  } catch {}
}

async function simulatePreRegistrationBehavior(page: Page, log: LogCallback): Promise<void> {
  log('[反检测] 模拟用户预热行为...')
  
  await randomDelay(500, 1500)
  
  for (let i = 0; i < 3; i++) {
    await simulatePageScroll(page)
    await randomDelay(300, 800)
  }
  
  const viewport = page.viewportSize()
  if (viewport) {
    for (let i = 0; i < 2; i++) {
      const x = Math.floor(Math.random() * viewport.width)
      const y = Math.floor(Math.random() * viewport.height)
      await simulateMouseMove(page, x, y)
      await randomDelay(200, 500)
    }
  }
  
  log('[反检测] ✓ 预热行为完成')
}

function htmlToText(html: string): string {
  if (!html) return ''
  
  let text = html
  
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n')
  text = text.replace(/<\/div>/gi, '\n')
  
  text = text.replace(/<[^>]+>/g, ' ')
  
  text = text.replace(/\s+/g, ' ')
  
  return text.trim()
}

function extractCode(text: string): string | null {
  if (!text) return null
  
  for (const pattern of CODE_PATTERNS) {
    pattern.lastIndex = 0
    
    let match
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1]
      if (code && /^\d{6}$/.test(code)) {
        const start = Math.max(0, match.index - 20)
        const end = Math.min(text.length, match.index + match[0].length + 20)
        const context = text.slice(start, end)
        
        if (context.includes('#' + code)) continue
        if (/color[:\s]*[^;]*\d{6}/i.test(context)) continue
        if (/rgb|rgba|hsl/i.test(context)) continue
        if (/\d{7,}/.test(context)) continue
        
        return code
      }
    }
  }
  return null
}

export async function getOutlookVerificationCode(
  refreshToken: string,
  clientId: string,
  log: LogCallback,
  timeout: number = 120
): Promise<string | null> {
  log('========== 开始获取邮箱验证码 ==========')
  log(`client_id: ${clientId}`)
  log(`refresh_token: ${refreshToken.substring(0, 30)}...`)
  
  const startTime = Date.now()
  const checkInterval = 5000
  const checkedIds = new Set<string>()
  
  while (Date.now() - startTime < timeout * 1000) {
    try {
      log('刷新 access_token...')
      let accessToken: string | null = null
      
      const tokenAttempts = [
        { url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', scope: null },
        { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: null },
      ]
      
      for (const attempt of tokenAttempts) {
        try {
          const tokenBody = new URLSearchParams()
          tokenBody.append('client_id', clientId)
          tokenBody.append('refresh_token', refreshToken)
          tokenBody.append('grant_type', 'refresh_token')
          if (attempt.scope) {
            tokenBody.append('scope', attempt.scope)
          }
          
          const tokenResponse = await fetch(attempt.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenBody.toString()
          })
          
          if (tokenResponse.ok) {
            const tokenResult = await tokenResponse.json() as { access_token: string }
            accessToken = tokenResult.access_token
            log('✓ 成功获取 access_token')
            break
          }
        } catch {
          continue
        }
      }
      
      if (!accessToken) {
        log('✗ token 刷新失败')
        return null
      }
      
      log('获取邮件列表...')
      const graphParams = new URLSearchParams({
        '$top': '50',
        '$orderby': 'receivedDateTime desc',
        '$select': 'id,subject,from,receivedDateTime,bodyPreview,body'
      })
      
      const mailResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${graphParams}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (!mailResponse.ok) {
        log(`获取邮件失败: ${mailResponse.status}`)
        await new Promise(r => setTimeout(r, checkInterval))
        continue
      }
      
      const mailData = await mailResponse.json() as {
        value: Array<{
          id: string
          subject: string
          from: { emailAddress: { address: string } }
          body: { content: string }
          bodyPreview: string
          receivedDateTime: string
        }>
      }
      
      log(`获取到 ${mailData.value?.length || 0} 封邮件`)
      
      for (const mail of mailData.value || []) {
        const fromEmail = mail.from?.emailAddress?.address?.toLowerCase() || ''
        const isAwsSender = AWS_SENDERS.some(s => fromEmail.includes(s.toLowerCase()))
        
        if (isAwsSender && !checkedIds.has(mail.id)) {
          checkedIds.add(mail.id)
          
          log(`\n=== 检查 AWS 邮件 ===`)
          log(`  发件人: ${fromEmail}`)
          log(`  主题: ${mail.subject?.substring(0, 50)}`)
          
          let code: string | null = null
          const bodyText = htmlToText(mail.body?.content || '')
          if (bodyText) {
            code = extractCode(bodyText)
          }
          if (!code) {
            code = extractCode(mail.body?.content || '')
          }
          if (!code) {
            code = extractCode(mail.bodyPreview || '')
          }
          
          if (code) {
            log(`\n========== 找到验证码: ${code} ==========`)
            return code
          }
        }
      }
      
      log(`未找到验证码，${checkInterval / 1000}秒后重试...`)
      await new Promise(r => setTimeout(r, checkInterval))
      
    } catch (error) {
      log(`获取验证码出错: ${error}`)
      await new Promise(r => setTimeout(r, checkInterval))
    }
  }
  
  log('获取验证码超时')
  return null
}

export async function createTempMail(
  log: LogCallback,
  timeout: number = 30
): Promise<{ email: string; token: string; password?: string } | null> {
  const config = getCloudflareTempEmailConfig()
  if (!config.baseUrl || !config.adminAuth || !config.domain) {
    log('⚠ Cloudflare Temp Email 配置不完整，必须设置 CLOUDFLARE_TEMP_EMAIL_BASE_URL / CLOUDFLARE_TEMP_EMAIL_ADMIN_AUTH / CLOUDFLARE_TEMP_EMAIL_DOMAIN')
    return null
  }

  const maxAttempts = 3
  const startTime = Date.now()
  let attemptCount = 0
  log('========== 使用 Cloudflare Temp Email 创建临时邮箱 ==========')

  while (Date.now() - startTime < timeout * 1000 && attemptCount < maxAttempts) {
    attemptCount++
    try {
      const localPart = generateAliasLocalPart()
      const payload = {
        enablePrefix: true,
        enableRandomSubdomain: config.useRandomSubdomain,
        name: localPart,
        domain: config.domain
      }

      log(`  第 ${attemptCount}/${maxAttempts} 次创建邮箱: ${localPart}@${config.domain}`)
      const result = await requestCloudflareTempEmailJson(config, '/admin/new_address', {
        method: 'POST',
        payload
      })
      const address = getCloudflareTempEmailAddressFromResponse(result)
      if (address) {
        const password = Math.random().toString(36).slice(-8) + 'A1!'
        log(`✓ 成功获取临时邮箱: ${address}`)
        return { email: address, token: `cloudflare-temp-email:${address}`, password }
      }

      log(`  API 返回格式错误: ${JSON.stringify(result)}`)
    } catch (error) {
      log(`Cloudflare Temp Email 第 ${attemptCount} 次申请失败: ${error}`)
    }

    if (attemptCount < maxAttempts) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  log('✗ Cloudflare Temp Email 创建邮箱失败')
  return null
}

export async function getTempMailCode(
  token: string,
  email: string,
  log: LogCallback,
  timeout: number = 120
): Promise<string | null> {
  log(`========== 开始等待 Cloudflare Temp Email ${email} 收到 AWS 验证码 ==========`)

  const config = getCloudflareTempEmailConfig()
  if (!config.baseUrl || !config.adminAuth) {
    log('Cloudflare Temp Email 配置不完整，无法轮询邮件')
    return null
  }

  const startTime = Date.now()
  const checkInterval = 3000
  const seenIds = new Set<string>()

  while (Date.now() - startTime < timeout * 1000) {
    try {
      const payload = await requestCloudflareTempEmailJson(config, '/admin/mails', {
        method: 'GET',
        searchParams: {
          limit: 20,
          offset: 0,
          address: email
        }
      })
      const messages = getCloudflareTempEmailMailRows(payload)
        .map((row) => normalizeCloudflareTempEmailMessage(row))
        .filter((message): message is TempMailMessage => Boolean(message))

      if (!messages || messages.length === 0) {
        await new Promise(r => setTimeout(r, checkInterval))
        continue
      }

      for (const msg of messages) {
        const content = `${msg.body || ''}\n${msg.html || ''}\n${msg.text || ''}`
        const msgHash = msg.id || `${msg.subject?.substring(0, 20)}_${content.length}`
        if (seenIds.has(msgHash)) continue
        seenIds.add(msgHash)

        const sender = (msg.from || '').toLowerCase()
        const subject = (msg.subject || '').toLowerCase()
        const isAwsSender = AWS_SENDERS.some(s => sender.includes(s.toLowerCase()))
        if (!isAwsSender && !subject.includes('aws') && !subject.includes('amazon') && !content.toLowerCase().includes('aws')) {
          continue
        }

        log(`\n=== 收到新邮件 ===`)
        log(`  发件人: ${sender}`)
        log(`  主题: ${subject}`)

        const bodyText = htmlToText(msg.html || '') || msg.body || ''
        const code = extractCode(subject) || extractCode(bodyText) || extractCode(content)
        if (code) {
          log(`\n========== 找到验证码: ${code} ==========`)
          return code
        }
      }
    } catch {
      // 忽略单次轮询错误，继续等待
    }

    await new Promise(r => setTimeout(r, checkInterval))
  }

  log('✗ 获取验证码超时')
  return null
}

async function waitAndFill(
  page: Page,
  selector: string,
  value: string,
  log: LogCallback,
  description: string,
  timeout: number = 30000
): Promise<boolean> {
  log(`等待${description}出现...`)
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout })
    
    const box = await element.boundingBox()
    if (box) {
      const targetX = box.x + box.width / 2
      const targetY = box.y + box.height / 2
      await simulateMouseMove(page, targetX, targetY)
    }
    
    await randomDelay(100, 300)
    await element.click()
    await randomDelay(100, 200)
    await element.clear()
    
    for (const char of value) {
      await element.pressSequentially(char, { delay: Math.floor(Math.random() * 100) + 50 })
    }

    await element.evaluate((el) => {
      const input = el as HTMLInputElement
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.blur()
    }).catch(() => {})

    const actualValue = await element.inputValue().catch(() => '')
    if (actualValue !== value) {
      log(`⚠ ${description}当前值和预期不一致，重填一次: "${actualValue}"`)
      await element.click()
      await element.fill(value)
      await element.evaluate((el) => {
        const input = el as HTMLInputElement
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.blur()
      }).catch(() => {})
    }

    log(`✓ 已输入${description}: ${value}`)
    return true
  } catch (error) {
    log(`✗ ${description}操作失败: ${error}`)
    return false
  }
}

async function humanClickElement(page: Page, element: ReturnType<Page['locator']>, log: LogCallback, description: string): Promise<boolean> {
  try {
    await element.waitFor({ state: 'visible', timeout: 10000 })
    await element.scrollIntoViewIfNeeded().catch(() => {})

    const box = await element.boundingBox()
    if (!box) {
      await element.click({ force: true })
      return true
    }

    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * Math.min(12, box.width * 0.2)
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * Math.min(8, box.height * 0.2)
    await simulateMouseMove(page, targetX, targetY)
    await randomDelay(250, 700)
    await page.mouse.down()
    await randomDelay(80, 180)
    await page.mouse.up()
    await randomDelay(300, 800)
    return true
  } catch (error) {
    log(`✗ ${description}真实鼠标点击失败: ${error}`)
    return false
  }
}

async function tryClickSelectors(
  page: Page,
  selectors: string[],
  log: LogCallback,
  description: string,
  timeout: number = 15000
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first()
      await element.waitFor({ state: 'visible', timeout: timeout / selectors.length })
      await page.waitForTimeout(300)
      await element.click()
      log(`✓ 已点击${description}`)
      return true
    } catch {
      continue
    }
  }
  log(`✗ 未找到${description}`)
  return false
}

async function checkAndRetryOnError(
  page: Page,
  buttonSelector: string,
  log: LogCallback,
  description: string,
  maxRetries: number = 5,
  retryDelay: number = 3000
): Promise<boolean> {
  const errorSelectors = [
    'div.awsui_content_mx3cw_97dyn_391',
    '[class*="awsui_content_"]',
    '.awsui-flash-error',
    '[data-testid="flash-error"]',
    'div[role="alert"]'
  ]
  
  const errorTexts = [
    '错误',
    '抱歉，处理您的请求时出错',
    'Sorry, there was an error processing your request',
    'error processing your request',
    'Please try again',
    '请重试'
  ]
  
  const closeButtonSelectors = [
    'button[aria-label="关闭"]',
    'button[aria-label="Close"]',
    'button.awsui_dismiss-button',
    '[class*="awsui_dismiss"]'
  ]
  
  for (let retry = 0; retry < maxRetries; retry++) {
    await page.waitForTimeout(2000)
    
    let hasError = false
    
    for (const selector of errorSelectors) {
      try {
        const errorElements = await page.locator(selector).all()
        for (const el of errorElements) {
          const text = await el.textContent()
          if (text && errorTexts.some(errText => text.includes(errText))) {
            hasError = true
            log(`⚠ 检测到错误弹窗: "${text.substring(0, 80)}..."`)
            break
          }
        }
        if (hasError) break
      } catch {
        continue
      }
    }
    
    if (!hasError) {
      return true
    }
    
    if (retry < maxRetries - 1) {
      log('尝试关闭错误弹窗...')
      let closed = false
      for (const closeSelector of closeButtonSelectors) {
        try {
          const closeBtn = page.locator(closeSelector).first()
          if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.click()
            log('✓ 已关闭错误弹窗')
            closed = true
            break
          }
        } catch {
          continue
        }
      }
      
      if (!closed) {
        log('未找到关闭按钮，尝试按 Escape 键')
        await page.keyboard.press('Escape')
      }
      
      log(`等待 ${retryDelay / 1000} 秒后重试点击${description} (${retry + 2}/${maxRetries})...`)
      await page.waitForTimeout(retryDelay)
      
      try {
        const button = page.locator(buttonSelector).first()
        await button.waitFor({ state: 'visible', timeout: 5000 })
        await humanClickElement(page, button, log, description)
        log(`✓ 已重新点击${description}`)
      } catch (e) {
        log(`✗ 重新点击${description}失败: ${e}`)
      }
    }
  }
  
  log(`✗ ${description}多次重试后仍然失败`)
  return false
}

async function waitAndClickWithRetry(
  page: Page,
  selector: string,
  log: LogCallback,
  description: string,
  timeout: number = 30000,
  maxRetries: number = 3
): Promise<boolean> {
  log(`等待${description}出现...`)
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout })
    
    const box = await element.boundingBox()
    if (box) {
      const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * 10
      const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * 5
      await simulateMouseMove(page, targetX, targetY)
    }
    
    await randomDelay(300, 800)
    if (!await humanClickElement(page, element, log, description)) {
      return false
    }
    log(`✓ 已点击${description}`)
    
    const success = await checkAndRetryOnError(page, selector, log, description, maxRetries)
    return success
  } catch (error) {
    log(`✗ 点击${description}失败: ${error}`)
    return false
  }
}

export async function activateOutlook(
  email: string,
  emailPassword: string,
  log: LogCallback,
  incognitoMode: boolean = true,
  headless: boolean = true
): Promise<{ success: boolean; error?: string }> {
  const activationUrl = 'https://go.microsoft.com/fwlink/p/?linkid=2125442'
  let browser: Browser | null = null
  
  log('========== 开始激活 Outlook 邮箱 ==========')
  log(`无痕模式: ${incognitoMode ? '已启用' : '已禁用'}`)
  log(`浏览器显示: ${headless ? '后台运行' : '前台可见'}`)
  log(`邮箱: ${email}`)
  
  try {
    log(`\n步骤1: 启动浏览器${incognitoMode ? '（无痕模式）' : ''}${headless ? '（后台运行）' : '（前台可见）'}，访问 Outlook 激活页面...`)
    
    const launchOptions: any = {
      headless,
      args: ['--disable-blink-features=AutomationControlled']
    }
    
    if (!incognitoMode) {
      launchOptions.args.push('--disable-session-crashed-bubble')
    }
    
    browser = await chromium.launch(launchOptions)
    
    const contextOptions: any = {
      viewport: { width: 1400, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    if (incognitoMode) {
      contextOptions.acceptDownloads = false
      contextOptions.ignoreHTTPSErrors = false
    }
    
    const context = await browser.newContext(contextOptions)
    
    const page = await context.newPage()
    
    await page.goto(activationUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log(`✓ 页面加载完成${incognitoMode ? '（无痕模式）' : ''}`)
    
    await simulatePreRegistrationBehavior(page, log)
    
    log('\n步骤2: 输入邮箱...')
    const emailInputSelectors = [
      'input#i0116[type="email"]',
      'input[name="loginfmt"]',
      'input[type="email"]'
    ]
    
    let emailFilled = false
    for (const selector of emailInputSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 10000 })
        await element.fill(email)
        log(`✓ 已输入邮箱: ${email}`)
        emailFilled = true
        break
      } catch {
        continue
      }
    }
    
    if (!emailFilled) {
      throw new Error('未找到邮箱输入框')
    }
    
    await page.waitForTimeout(1000)
    
    log('\n步骤3: 点击下一步按钮...')
    const firstNextSelectors = [
      'input#idSIButton9[type="submit"]',
      'input[type="submit"][value="下一步"]',
      'input[type="submit"][value="Next"]'
    ]
    
    if (!await tryClickSelectors(page, firstNextSelectors, log, '第一个下一步按钮')) {
      throw new Error('点击第一个下一步按钮失败')
    }
    
    await page.waitForTimeout(3000)
    
    log('\n步骤4: 输入密码...')
    const passwordInputSelectors = [
      'input#passwordEntry[type="password"]',
      'input#i0118[type="password"]',
      'input[name="passwd"][type="password"]',
      'input[type="password"]'
    ]
    
    let passwordFilled = false
    for (const selector of passwordInputSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 15000 })
        await element.fill(emailPassword)
        log('✓ 已输入密码')
        passwordFilled = true
        break
      } catch {
        continue
      }
    }
    
    if (!passwordFilled) {
      throw new Error('未找到密码输入框')
    }
    
    await page.waitForTimeout(1000)
    
    log('\n步骤5: 点击登录按钮...')
    const loginButtonSelectors = [
      'button[type="submit"][data-testid="primaryButton"]',
      'input#idSIButton9[type="submit"]',
      'button:has-text("下一步")',
      'button:has-text("登录")',
      'button:has-text("Sign in")',
      'button:has-text("Next")'
    ]
    
    if (!await tryClickSelectors(page, loginButtonSelectors, log, '登录按钮')) {
      throw new Error('点击登录按钮失败')
    }
    
    await page.waitForTimeout(3000)
    
    log('\n步骤6: 点击第一个"暂时跳过"链接...')
    const skipSelector = 'a#iShowSkip'
    try {
      const skipElement = page.locator(skipSelector).first()
      await skipElement.waitFor({ state: 'visible', timeout: 30000 })
      await skipElement.click()
      log('✓ 已点击第一个"暂时跳过"')
      await page.waitForTimeout(3000)
    } catch {
      log('未找到第一个"暂时跳过"链接，可能已跳过此步骤')
    }
    
    log('\n步骤7: 点击第二个"暂时跳过"链接...')
    try {
      const skipElement = page.locator(skipSelector).first()
      await skipElement.waitFor({ state: 'visible', timeout: 15000 })
      await skipElement.click()
      log('✓ 已点击第二个"暂时跳过"')
      await page.waitForTimeout(3000)
    } catch {
      log('未找到第二个"暂时跳过"链接，可能已跳过此步骤')
    }
    
    log('\n步骤8: 点击"取消"按钮（跳过密钥创建）...')
    const cancelButtonSelectors = [
      'button[data-testid="secondaryButton"]:has-text("取消")',
      'button[data-testid="secondaryButton"]:has-text("Cancel")',
      'button[type="button"]:has-text("取消")',
      'button[type="button"]:has-text("Cancel")'
    ]
    
    if (!await tryClickSelectors(page, cancelButtonSelectors, log, '"取消"按钮', 15000)) {
      log('未找到"取消"按钮，可能已跳过此步骤')
    }
    
    await page.waitForTimeout(3000)
    
    log('\n步骤9: 点击"是"按钮（保持登录状态）...')
    const yesButtonSelectors = [
      'button[type="submit"][data-testid="primaryButton"]:has-text("是")',
      'button[type="submit"][data-testid="primaryButton"]:has-text("Yes")',
      'input#idSIButton9[value="是"]',
      'input#idSIButton9[value="Yes"]',
      'button:has-text("是")',
      'button:has-text("Yes")'
    ]
    
    if (!await tryClickSelectors(page, yesButtonSelectors, log, '"是"按钮', 15000)) {
      log('未找到"是"按钮，可能已跳过此步骤')
    }
    
    await page.waitForTimeout(5000)
    
    log('\n步骤10: 等待 Outlook 邮箱加载完成...')
    const newMailSelectors = [
      'button[aria-label="New mail"]',
      'button:has-text("New mail")',
      'button:has-text("新邮件")',
      'span:has-text("New mail")',
      '[data-automation-type="RibbonSplitButton"]'
    ]
    
    let outlookLoaded = false
    for (const selector of newMailSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 30000 })
        log('✓ Outlook 邮箱激活成功！')
        outlookLoaded = true
        break
      } catch {
        continue
      }
    }
    
    if (!outlookLoaded) {
      const currentUrl = page.url()
      if (currentUrl.toLowerCase().includes('outlook') || currentUrl.toLowerCase().includes('mail')) {
        log('✓ 已进入 Outlook 邮箱页面，激活成功！')
        outlookLoaded = true
      }
    }
    
    await page.waitForTimeout(2000)
    await browser.close()
    browser = null
    
    if (outlookLoaded) {
      log('\n========== Outlook 邮箱激活完成 ==========')
      return { success: true }
    } else {
      log('\n⚠ Outlook 邮箱激活可能未完成')
      return { success: false, error: 'Outlook 邮箱激活可能未完成' }
    }
    
  } catch (error) {
    log(`\n✗ Outlook 激活失败: ${error}`)
    if (browser) {
      try { await browser.close() } catch {}
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function autoRegisterAWS(
  email: string | undefined,
  refreshToken: string | undefined,
  clientId: string | undefined,
  log: LogCallback,
  emailPassword?: string,
  skipOutlookActivation: boolean = false,
  proxyUrl?: string,
  incognitoMode: boolean = true,
  useTempMail: boolean = false,
  userCode?: string,
  verificationUri?: string,
  useFingerprint: boolean = true,
  fingerprintProfile?: any,
  headless: boolean = true
): Promise<{ success: boolean; ssoToken?: string; name?: string; error?: string; email?: string; password?: string }> {
  let tempMailToken = ''
  if (useTempMail) {
    const tempResult = await createTempMail(log, 30)
    if (!tempResult) {
      return { success: false, error: '获取临时邮箱失败' }
    }
    email = tempResult.email
    emailPassword = tempResult.password
    tempMailToken = tempResult.token
    log(`✓ 准备使用临时邮箱注册: ${email}`)
  }

  if (!email) {
    return { success: false, error: '未提供邮箱地址' }
  }

  const password = emailPassword || 'admin123456aA!'
  const randomName = generateRandomName()
  let browser: Browser | null = null
  
  log('========== 开始自动注册 AWS Builder ID ==========')
  log(`无痕模式: ${incognitoMode ? '已启用' : '已禁用'}`)
  if (!skipOutlookActivation && email.toLowerCase().includes('outlook') && emailPassword) {
    log('检测到 Outlook 邮箱，先进行激活（不使用代理）...')
    const activationResult = await activateOutlook(email, emailPassword, log, incognitoMode, headless)
    if (!activationResult.success) {
      log(`⚠ Outlook 激活可能未完成: ${activationResult.error}`)
      log('继续尝试 AWS 注册...')
    } else {
      log('Outlook 激活成功，开始 AWS 注册...')
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  
  log('========== 开始 AWS Builder ID 注册 ==========')
  log(`邮箱: ${email}`)
  log(`姓名: ${randomName}`)
  log(`密码: ${password}`)
  if (proxyUrl) {
    log(`代理: ${proxyUrl}`)
  }
  log(`使用指纹: ${useFingerprint ? '是' : '否'}`)
  log(`浏览器显示: ${headless ? '后台运行' : '前台可见'}`)
  
  let profile: any = fingerprintProfile
  if (useFingerprint && !profile) {
    log('\n[指纹] 生成新指纹配置...')
    const { FingerprintGenerator } = await import('./fingerprint/generator')
    const generator = new FingerprintGenerator()
    profile = generator.generate()
    log(`[指纹] User Agent: ${profile.navigator.userAgent}`)
    log(`[指纹] Platform: ${profile.navigator.platform}`)
    log(`[指纹] Screen: ${profile.screen.width}x${profile.screen.height}`)
    log(`[指纹] Hardware: ${profile.hardware.hardwareConcurrency} cores, ${profile.hardware.deviceMemory}GB RAM`)
  }
  
  try {
    log(`\n步骤1: 启动浏览器${incognitoMode ? '（无痕模式）' : ''}${useFingerprint ? '（应用指纹）' : ''}${headless ? '（后台运行）' : '（前台可见）'}，进入注册页面...`)
    
    const launchOptions: any = {
      headless,
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
      args: ['--disable-blink-features=AutomationControlled']
    }
    
    if (!incognitoMode) {
      launchOptions.args.push('--disable-session-crashed-bubble')
    }
    
    browser = await chromium.launch(launchOptions)
    
    const viewportWidth = 1400
    const viewportHeight = 1000
    
    const contextOptions: any = {
      viewport: { width: viewportWidth, height: viewportHeight },
      userAgent: useFingerprint && profile 
        ? profile.navigator.userAgent 
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      deviceScaleFactor: 1
    }
    
    if (useFingerprint && profile) {
      contextOptions.locale = profile.navigator.language
      contextOptions.timezoneId = profile.timezone.name
      if (profile.geolocation) {
        contextOptions.geolocation = profile.geolocation
        contextOptions.permissions = ['geolocation']
      }
    }
    
    if (incognitoMode) {
      contextOptions.acceptDownloads = false
      contextOptions.ignoreHTTPSErrors = false
    }
    
    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    
    if (useFingerprint && profile) {
      log('[指纹] 注入高级指纹脚本...')
      const { FingerprintInjector } = await import('./fingerprint/injector')
      const injector = new FingerprintInjector()
      const injectionCode = injector.generateInjectionCode(profile)
      
      await page.addInitScript(injectionCode)
      log('[指纹] ✓ 指纹脚本已注入')
    }
    
    const registerUrl = verificationUri || 'https://view.awsapps.com/start/#/device?user_code=PQCF-FCCN'
    log(`注册 URL: ${registerUrl}`)
    if (userCode) {
      log(`User Code: ${userCode}`)
    }
    await page.goto(registerUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log(`✓ 页面加载完成${incognitoMode ? '（无痕模式）' : ''}${useFingerprint ? '（指纹已应用）' : ''}`)
    
    await simulatePreRegistrationBehavior(page, log)
    
    const emailInputSelector = 'input[placeholder="username@example.com"]'
    if (!await waitAndFill(page, emailInputSelector, email, log, '邮箱输入框')) {
      throw new Error('未找到邮箱输入框')
    }
    
    await page.waitForTimeout(1000)
    
    const firstContinueSelector = 'button[data-testid="test-primary-button"]'
    if (!await waitAndClickWithRetry(page, firstContinueSelector, log, '第一个继续按钮')) {
      throw new Error('点击第一个继续按钮失败')
    }
    
    await page.waitForTimeout(3000)
    
    const loginHeadingSelector = 'span[class*="awsui_heading-text"]:has-text("Sign in with your AWS Builder ID")'
    const verifyHeadingSelector = 'span[class*="awsui_heading-text"]:has-text("Verify")'
    const verifyCodeInputSelector = 'input[placeholder="6-digit"]'
    const nameInputSelector = 'input[placeholder="Maria José Silva"]'
    
    let isLoginFlow = false
    let isVerifyFlow = false
    
    try {
      const loginHeading = page.locator(loginHeadingSelector).first()
      const verifyHeading = page.locator(verifyHeadingSelector).first()
      const verifyCodeInput = page.locator(verifyCodeInputSelector).first()
      const nameInput = page.locator(nameInputSelector).first()
      
      const result = await Promise.race([
        loginHeading.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login'),
        verifyHeading.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'verify'),
        verifyCodeInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'verify-input'),
        nameInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'register')
      ])
      
      if (result === 'login') {
        isLoginFlow = true
      } else if (result === 'verify' || result === 'verify-input') {
        isLoginFlow = true
        isVerifyFlow = true
      }
    } catch {
      try {
        await page.locator(loginHeadingSelector).first().waitFor({ state: 'visible', timeout: 3000 })
        isLoginFlow = true
      } catch {
        try {
          const hasVerify = await page.locator(verifyHeadingSelector).first().isVisible().catch(() => false)
          const hasVerifyInput = await page.locator(verifyCodeInputSelector).first().isVisible().catch(() => false)
          if (hasVerify || hasVerifyInput) {
            isLoginFlow = true
            isVerifyFlow = true
          }
        } catch {
          isLoginFlow = false
        }
      }
    }
    
    if (isLoginFlow) {
      if (isVerifyFlow) {
        log('\n⚠ 检测到验证页面，邮箱已注册，直接进入验证码步骤...')
      } else {
        log('\n⚠ 检测到邮箱已注册，切换到登录流程...')
      }
      
      if (!isVerifyFlow) {
        log('\n步骤2(登录): 输入密码...')
        const loginPasswordSelector = 'input[placeholder="Enter password"]'
        if (!await waitAndFill(page, loginPasswordSelector, password, log, '登录密码输入框')) {
          throw new Error('未找到登录密码输入框')
        }
        
        await page.waitForTimeout(1000)
        
        const loginContinueSelector = 'button[data-testid="test-primary-button"]'
        if (!await waitAndClickWithRetry(page, loginContinueSelector, log, '登录继续按钮')) {
          throw new Error('点击登录继续按钮失败')
        }
        
        await page.waitForTimeout(3000)
      }
      
      log('\n步骤3(登录): 获取并输入验证码...')
      const loginCodeSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]
      
      let loginCodeInput: string | null = null
      for (const selector of loginCodeSelectors) {
        try {
          await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 })
          loginCodeInput = selector
          log('✓ 登录验证码输入框已出现')
          break
        } catch {
          continue
        }
      }
      
      if (!loginCodeInput) {
        throw new Error('未找到登录验证码输入框')
      }
      
      await page.waitForTimeout(1000)
      
      let loginVerificationCode: string | null = null
      if (useTempMail) {
        loginVerificationCode = await getTempMailCode(tempMailToken, email, log, 120)
      } else if (refreshToken && clientId) {
        loginVerificationCode = await getOutlookVerificationCode(refreshToken, clientId, log, 120)
      } else {
        log('缺少 refresh_token 或 client_id，无法自动获取验证码')
      }
      
      if (!loginVerificationCode) {
        throw new Error('无法获取登录验证码')
      }
      
      if (!await waitAndFill(page, loginCodeInput, loginVerificationCode, log, '登录验证码')) {
        throw new Error('输入登录验证码失败')
      }
      
      await page.waitForTimeout(1000)
      
      const loginVerifySelector = 'button[data-testid="test-primary-button"]'
      if (!await waitAndClickWithRetry(page, loginVerifySelector, log, '登录验证码确认按钮')) {
        throw new Error('点击登录验证码确认按钮失败')
      }
      
      await page.waitForTimeout(5000)
      
    } else {
      log('\n步骤2: 输入姓名...')
      if (!await waitAndFill(page, nameInputSelector, randomName, log, '姓名输入框')) {
        throw new Error('未找到姓名输入框')
      }
      
      await page.waitForTimeout(1000)
      
      const secondContinueSelector = 'button[data-testid="signup-next-button"]'
      if (!await waitAndClickWithRetry(page, secondContinueSelector, log, '第二个继续按钮')) {
        throw new Error('点击第二个继续按钮失败')
      }
      
      await page.waitForTimeout(3000)
      
      log('\n步骤3: 获取并输入验证码...')
      const codeInputSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]
      
      log('等待验证码输入框出现...')
      let codeInputSelector: string | null = null
      for (const selector of codeInputSelectors) {
        try {
          await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30000 })
          codeInputSelector = selector
          log(`✓ 验证码输入框已出现 (selector: ${selector})`)
          break
        } catch {
          continue
        }
      }
      
      if (!codeInputSelector) {
        throw new Error('未找到验证码输入框')
      }
      
      await page.waitForTimeout(1000)
      
      let verificationCode: string | null = null
      if (useTempMail) {
        verificationCode = await getTempMailCode(tempMailToken, email, log, 120)
      } else if (refreshToken && clientId) {
        verificationCode = await getOutlookVerificationCode(refreshToken, clientId, log, 120)
      } else {
        log('缺少 refresh_token 或 client_id，无法自动获取验证码')
      }
      
      if (!verificationCode) {
        throw new Error('无法获取验证码')
      }
      
      if (!await waitAndFill(page, codeInputSelector, verificationCode, log, '验证码')) {
        throw new Error('输入验证码失败')
      }
      
      await page.waitForTimeout(1000)
      
      log('检查并处理 Cookie 弹窗...')
      const cookieAcceptSelectors = [
        'button:has-text("Accept")',
        'button:has-text("接受")',
        'button[id*="accept"]',
        'button[class*="accept"]'
      ]
      
      for (const selector of cookieAcceptSelectors) {
        try {
          const cookieButton = page.locator(selector).first()
          if (await cookieButton.isVisible({ timeout: 2000 })) {
            await cookieButton.click()
            log('✓ 已点击 Cookie Accept 按钮')
            await page.waitForTimeout(1000)
            break
          }
        } catch {
        }
      }
      
      // ========== 验证码提交步骤的额外处理 ==========
      // 这是唯一需要额外处理的步骤
      log('\n[特殊处理] 验证码提交步骤 - 增加重试和验证...')
      
      const verifyButtonSelector = 'button[data-testid="email-verification-verify-button"]'
      const passwordInputSelector = 'input[placeholder="Enter password"]'
      
      // 点击 Continue 按钮
      if (!await waitAndClickWithRetry(page, verifyButtonSelector, log, 'Continue 按钮', 30000, 10)) {
        throw new Error('点击 Continue 按钮失败')
      }
      
      // 验证是否成功进入密码输入页面
      await page.waitForTimeout(3000)
      let passwordPageAppeared = false
      const maxVerifyRetries = 15
      
      for (let retry = 0; retry < maxVerifyRetries; retry++) {
        try {
          const passwordInput = page.locator(passwordInputSelector).first()
          const isVisible = await passwordInput.isVisible({ timeout: 5000 })
          if (isVisible) {
            log(`✓ 密码输入页面已出现（第${retry + 1}次检查）`)
            passwordPageAppeared = true
            break
          }
        } catch {
        }
        
        if (!passwordPageAppeared) {
          const errorVisible = await page.locator('div[class*="awsui_content_"]').first().isVisible({ timeout: 2000 }).catch(() => false)
          const stillOnCodePage = await page.locator('input[placeholder="6-digit"]').first().isVisible({ timeout: 2000 }).catch(() => false)
          
          if (errorVisible || stillOnCodePage) {
            log(`⚠ 检测到仍在验证码页面或有错误弹窗（第${retry + 1}/${maxVerifyRetries}次），等待后重试...`)
            
            const closeBtn = page.locator('button[aria-label="关闭"], button[aria-label="Close"]').first()
            if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
              await closeBtn.click()
              log('✓ 已关闭错误弹窗')
            }
            
            await page.waitForTimeout(5000)
            await waitAndClickWithRetry(page, verifyButtonSelector, log, 'Continue 按钮（重试）', 10000, 1)
            await page.waitForTimeout(8000)
          } else {
            log(`等待密码输入框出现...（第${retry + 1}/${maxVerifyRetries}次）`)
            await page.waitForTimeout(3000)
          }
        }
      }
      
      if (!passwordPageAppeared) {
        log('✗ 多次重试后密码输入框仍未出现，可能卡在了验证码步骤')
        throw new Error('验证码提交失败，无法进入密码输入步骤（可能被 AWS 反检测拦截）')
      }
      
      // 步骤4: 等待密码输入框出现，输入密码
      log('\n步骤4: 输入密码...')
      
      const passwordInputSelectors = [
        'input[placeholder="Enter password"]',
        'input[placeholder="Create password"]',
        'input[placeholder="Password"]',
        'input[type="password"]',
        'input[name="password"]',
        'input[id*="password"]'
      ]
      
      let passwordFilled = false
      for (const selector of passwordInputSelectors) {
        try {
          const element = page.locator(selector).first()
          await element.waitFor({ state: 'visible', timeout: 10000 })
          log(`✓ 找到密码输入框: ${selector}`)
          
          await page.waitForTimeout(500)
          await element.clear()
          await element.fill(password)
          
          log('✓ 已输入密码')
          passwordFilled = true
          break
        } catch (e) {
          log(`⚠ 选择器 ${selector} 操作失败: ${e}`)
          continue
        }
      }
      
      if (!passwordFilled) {
        throw new Error('未找到密码输入框')
      }
      
      await page.waitForTimeout(500)
      
      const confirmPasswordSelectors = [
        'input[placeholder="Re-enter password"]',
        'input[placeholder="Confirm password"]',
        'input[placeholder="Confirm Password"]',
        'input[type="password"]:nth-of-type(2)',
        'input[name="confirmPassword"]',
        'input[id*="confirm"]'
      ]
      
      let confirmPasswordFilled = false
      for (const selector of confirmPasswordSelectors) {
        try {
          const element = page.locator(selector).first()
          await element.waitFor({ state: 'visible', timeout: 10000 })
          log(`✓ 找到确认密码输入框: ${selector}`)
          
          await page.waitForTimeout(500)
          await element.clear()
          await element.fill(password)
          
          log('✓ 已输入确认密码')
          confirmPasswordFilled = true
          break
        } catch {
          continue
        }
      }
      
      if (!confirmPasswordFilled) {
        throw new Error('未找到确认密码输入框')
      }
      
      await page.waitForTimeout(1000)
      
      const thirdContinueSelector = 'button[data-testid="test-primary-button"]'
      if (!await waitAndClickWithRetry(page, thirdContinueSelector, log, '第三个继续按钮（Confirm）')) {
        throw new Error('点击第三个继续按钮失败')
      }
      
      await page.waitForTimeout(5000)
    }
    
    log('\n步骤5: 等待授权请求页面（Authorization requested）...')
    const authConfirmSelectors = [
      'button:has-text("Confirm and continue")',
      'button:has-text("确认并继续")',
      'button[data-testid="confirm-button"]',
      'button.awsui-button-variant-primary:has-text("Confirm")'
    ]
    
    let authConfirmed = false
    for (const selector of authConfirmSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 20000 })
        await page.waitForTimeout(1000)
        await element.click()
        log('✓ 已点击 "Confirm and continue" 授权按钮')
        authConfirmed = true
        break
      } catch {
        continue
      }
    }
    
    if (!authConfirmed) {
      log('⚠ 未找到授权确认按钮，可能已自动授权或页面结构变化')
    }
    
    await page.waitForTimeout(5000)
    
    log('\n步骤6: 等待访问授权页面（Allow access）...')
    const allowAccessSelectors = [
      'button:has-text("Allow access")',
      'button:has-text("允许访问")',
      'button[data-testid="allow-access-button"]',
      'button.awsui-button-variant-primary:has-text("Allow")'
    ]
    
    let accessAllowed = false
    for (const selector of allowAccessSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 20000 })
        await page.waitForTimeout(1000)
        await element.click()
        log('✓ 已点击 "Allow access" 按钮')
        accessAllowed = true
        break
      } catch {
        continue
      }
    }
    
    if (!accessAllowed) {
      log('⚠ 未找到 "Allow access" 按钮，可能已自动授权或页面结构变化')
    }
    
    log('等待授权处理完成...')
    await page.waitForTimeout(10000)
    
    log('\n步骤7: 等待授权完全完成...')
    
    const successIndicators = [
      'text=Authorization successful',
      'text=授权成功',
      'text=You may now close this window',
      'text=您现在可以关闭此窗口',
      'text=You are now signed in',
      'text=您现在已登录',
      '[data-testid="success-message"]',
      '.awsui-alert-success'
    ]
    
    let authCompleted = false
    let ssoTokenFound = false
    let waitAfterCookie = 0
    
    for (let i = 0; i < 90; i++) {
      for (const indicator of successIndicators) {
        try {
          const element = page.locator(indicator).first()
          if (await element.isVisible({ timeout: 1000 })) {
            log(`✓ 检测到授权成功指示器: ${indicator}`)
            authCompleted = true
            break
          }
        } catch {
          continue
        }
      }
      
      if (authCompleted) break
      
      const currentUrl = page.url()
      if (currentUrl.includes('/start') && !currentUrl.includes('/device') && !currentUrl.includes('/signup')) {
        log(`✓ 页面已跳转到成功页面: ${currentUrl}`)
        authCompleted = true
        break
      }
      
      const cookies = await context.cookies()
      const ssoCookie = cookies.find(c => c.name === 'x-amz-sso_authn')
      if (ssoCookie) {
        if (!ssoTokenFound) {
          log(`✓ 检测到 SSO Cookie，继续等待授权完全完成...`)
          ssoTokenFound = true
        }
        waitAfterCookie++
        
        if (waitAfterCookie >= 15) {
          log(`✓ SSO Cookie 已稳定 ${waitAfterCookie} 秒，授权应该已完成`)
          authCompleted = true
          break
        }
      }
      
      log(`等待授权完成... (${i + 1}/90)${ssoTokenFound ? ` [Cookie 已获取 ${waitAfterCookie}s]` : ''}`)
      await page.waitForTimeout(1000)
    }
    
    if (!authCompleted) {
      throw new Error('授权未完成或超时')
    }
    
    log('\n步骤6: 获取 SSO Token...')
    let ssoToken: string | null = null
    const cookies = await context.cookies()
    const ssoCookie = cookies.find(c => c.name === 'x-amz-sso_authn')
    if (ssoCookie) {
      ssoToken = ssoCookie.value
      log(`✓ 成功获取 SSO Token: ${ssoToken.substring(0, 50)}...`)
    }
    
    await browser.close()
    browser = null
    
    if (ssoToken) {
      log('\n========== 操作成功! ==========')
      return { success: true, ssoToken, name: randomName, email: email, password: password }
    } else {
      throw new Error('未能获取 SSO Token，可能操作未完成')
    }
    
  } catch (error) {
    log(`\n✗ 注册失败: ${error}`)
    if (browser) {
      try {
        let page: Page | null = null
        try {
          const contexts = browser.contexts()
          if (contexts.length > 0) {
            const pages = contexts[0].pages()
            page = pages[0] || null
          }
        } catch {}
        await browser.close()
      } catch (e) {
        log(`关闭浏览器时出错: ${e}`)
      }
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export type TempMailRegisterOptions = {
  log: LogCallback
  proxyUrl?: string
  incognitoMode?: boolean
  userCode?: string
  verificationUri?: string
  useFingerprint?: boolean
  fingerprintProfile?: any
  headless?: boolean
}

export async function registerAwsBuilderIdTempMail(
  options: TempMailRegisterOptions
): Promise<{ success: boolean; ssoToken?: string; name?: string; error?: string; email?: string; password?: string }> {
  return await autoRegisterAWS(
    undefined,
    undefined,
    undefined,
    options.log,
    undefined,
    true,
    options.proxyUrl,
    options.incognitoMode ?? true,
    true,
    options.userCode,
    options.verificationUri,
    options.useFingerprint ?? true,
    options.fingerprintProfile,
    options.headless ?? true
  )
}
