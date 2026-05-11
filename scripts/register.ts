import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { execSync } from 'node:child_process'
import { createTempMail, registerAwsBuilderIdTempMail, type RegistrationBrowserSession } from '../lib/register'
import { startBuilderIdDeviceLogin, pollBuilderIdDeviceAuth } from '../lib/auth'
import { KiroRsAdminClient } from '../lib/kiro-rs-admin'
import { createEventLogger, maskEmail, redactSecrets } from '../lib/common'
import { loadSubscribeInput, updateAccountStatus } from '../lib/pro-input'
import { extractCheckoutSessionId, KiroClient, readSubscriptionState } from '../lib/kiro-client'
import { runStripeCheckout } from '../lib/stripe-checkout'

if (process.platform === 'win32') {
  try {
    const stdout = execSync('chcp', { encoding: 'utf8' })
    if (!stdout.includes('65001')) {
      execSync('chcp 65001 >nul 2>&1')
    }
  } catch {}
}

process.stdin.setEncoding?.('utf8')
process.stdout.setDefaultEncoding?.('utf8')
process.stderr.setDefaultEncoding?.('utf8')

function loadDotEnvFiles(paths: string[] = ['.env.local', '.env']): void {
  for (const path of paths) {
    const abs = resolve(path)
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

loadDotEnvFiles()

type CliOptions = {
  count: number
  concurrency: number
  delayMs: number
  proxyUrl?: string
  incognitoMode: boolean
  useFingerprint: boolean
  headless: boolean
  region: string
  publishKiroRs: boolean
  kiroRsUrl: string
  kiroRsKey: string
  kiroRsPriority: number
  kiroRsEndpoint?: string
  kiroRsAuthRegion?: string
  kiroRsApiRegion?: string
  autoProTrial: boolean
  proTxtDir: string
  proProfileDir: string
  proResultPath: string
  proEventsPath: string
  proReuseProfile: boolean
}

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  magenta: '\x1b[35m'
}

function print(text: string): void {
  process.stdout.write(text + '\n')
}

function log(color: keyof typeof COLORS, text: string): void {
  process.stdout.write(COLORS[color] + text + COLORS.reset + '\n')
}

function toInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return ''
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const text = String(value || '').trim()
  if (!text) return fallback
  if (/^(1|true|yes|y|on)$/i.test(text)) return true
  if (/^(0|false|no|n|off)$/i.test(text)) return false
  return fallback
}

function resolveRequiredArg(value: string | undefined, name: string): string {
  const text = String(value || '').trim()
  if (!text || text.startsWith('--')) {
    throw new Error(`参数 ${name} 缺少值`)
  }
  return text
}

function parseArgs(argv: string[]): Partial<CliOptions> {
  const get = (name: string) => {
    const idx = argv.indexOf(name)
    if (idx === -1) return undefined
    return argv[idx + 1]
  }

  const has = (name: string) => argv.includes(name)

  const result: Partial<CliOptions> = {}

  if (has('--count') || has('-n')) {
    result.count = toInt(resolveRequiredArg(get('--count') ?? get('-n'), '--count'), 1)
  }
  if (has('--concurrency') || has('-c')) {
    result.concurrency = toInt(resolveRequiredArg(get('--concurrency') ?? get('-c'), '--concurrency'), 1)
  }
  if (has('--delayMs') || has('--delay') || has('-d')) {
    result.delayMs = toInt(resolveRequiredArg(get('--delayMs') ?? get('--delay') ?? get('-d'), '--delayMs'), 0)
  }
  if (has('--proxyUrl') || has('--proxy')) {
    result.proxyUrl = resolveRequiredArg(get('--proxyUrl') ?? get('--proxy'), '--proxy')
  }
  if (has('--region')) {
    result.region = resolveRequiredArg(get('--region'), '--region')
  }
  if (has('--kiro-rs-url')) {
    result.kiroRsUrl = resolveRequiredArg(get('--kiro-rs-url'), '--kiro-rs-url')
  }
  if (has('--kiro-rs-key')) {
    result.kiroRsKey = resolveRequiredArg(get('--kiro-rs-key'), '--kiro-rs-key')
  }
  if (has('--priority') || has('--kiro-rs-priority')) {
    result.kiroRsPriority = toInt(resolveRequiredArg(get('--priority') ?? get('--kiro-rs-priority'), '--priority'), 0)
  }
  if (has('--endpoint')) {
    result.kiroRsEndpoint = resolveRequiredArg(get('--endpoint'), '--endpoint')
  }
  if (has('--auth-region')) {
    result.kiroRsAuthRegion = resolveRequiredArg(get('--auth-region'), '--auth-region')
  }
  if (has('--api-region')) {
    result.kiroRsApiRegion = resolveRequiredArg(get('--api-region'), '--api-region')
  }
  if (has('--publish-kiro-rs')) {
    result.publishKiroRs = true
  }
  if (has('--no-publish-kiro-rs')) {
    result.publishKiroRs = false
  }
  if (has('--incognito')) {
    result.incognitoMode = true
  }
  if (has('--no-incognito')) {
    result.incognitoMode = false
  }
  if (has('--fingerprint')) {
    result.useFingerprint = true
  }
  if (has('--no-fingerprint')) {
    result.useFingerprint = false
  }
  if (has('--headed') || has('--show-browser')) {
    result.headless = false
  }
  if (has('--headless')) {
    result.headless = true
  }
  if (has('--auto-pro-trial') || has('--check-pro-trial')) {
    result.autoProTrial = true
  }
  if (has('--no-auto-pro-trial')) {
    result.autoProTrial = false
  }
  if (has('--pro-txt-dir')) {
    result.proTxtDir = resolve(resolveRequiredArg(get('--pro-txt-dir'), '--pro-txt-dir'))
  }
  if (has('--pro-profile')) {
    result.proProfileDir = resolve(resolveRequiredArg(get('--pro-profile'), '--pro-profile'))
  }
  if (has('--pro-output')) {
    result.proResultPath = resolve(resolveRequiredArg(get('--pro-output'), '--pro-output'))
  }
  if (has('--pro-events')) {
    result.proEventsPath = resolve(resolveRequiredArg(get('--pro-events'), '--pro-events'))
  }
  if (has('--pro-reuse-profile')) {
    result.proReuseProfile = true
  }

  return result
}

async function runWithConcurrency<TItem>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem, idx: number) => Promise<void>
) {
  let nextIdx = 0

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = nextIdx++
      if (idx >= items.length) return
      await worker(items[idx], idx)
    }
  })

  await Promise.all(runners)
}

const DEFAULT_OPTIONS: CliOptions = {
  count: 3,
  concurrency: 1,
  delayMs: 0,
  proxyUrl: undefined,
  incognitoMode: true,
  useFingerprint: true,
  headless: false,
  region: process.env.KIRO_AUTH_REGION || 'us-east-1',
  publishKiroRs: parseBooleanEnv(process.env.KIRO_RS_UPLOAD_ENABLED, true),
  kiroRsUrl: firstEnv('KIRO_RS_ADMIN_URL', 'KIRO_RS_URL') || 'https://kiro.leftcode.xyz/admin',
  kiroRsKey: firstEnv('KIRO_RS_ADMIN_KEY', 'KIRO_RS_SK', 'KIRO_RS_API_KEY', 'ADMIN_API_KEY'),
  kiroRsPriority: toInt(process.env.KIRO_RS_PRIORITY, 0),
  kiroRsEndpoint: process.env.KIRO_RS_ENDPOINT,
  kiroRsAuthRegion: process.env.KIRO_RS_AUTH_REGION,
  kiroRsApiRegion: process.env.KIRO_RS_API_REGION,
  autoProTrial: parseBooleanEnv(firstEnv('KIRO_AUTO_PRO_TRIAL', 'AUTO_PRO_TRIAL'), false),
  proTxtDir: resolve(firstEnv('KIRO_PRO_TXT_DIR') || 'txt'),
  proProfileDir: resolve(firstEnv('KIRO_PRO_PROFILE_DIR') || '.browser-profile/kiro-pro-trial'),
  proResultPath: resolve(firstEnv('KIRO_PRO_RESULT_PATH') || 'show/pro-trial-result.json'),
  proEventsPath: resolve(firstEnv('KIRO_PRO_EVENTS_PATH') || 'artifacts/pro-trial-events.ndjson'),
  proReuseProfile: parseBooleanEnv(process.env.KIRO_PRO_REUSE_PROFILE, false)
}


function publicStripeResult(result: any): Record<string, unknown> {
  return {
    dry_run: result.dryRun,
    checkout_session_id: redactSecrets(result.checkoutSessionId),
    publishable_key: redactSecrets(result.publishableKey),
    merchant: result.merchant,
    currency: result.currency,
    total_cents: result.totalCents,
    total_text: result.totalText,
    amount_detected: result.amountDetected,
    payment_status: result.paymentStatus,
    checkout_status: result.checkoutStatus,
    setup_intent_status: result.setupIntentStatus,
    payment_intent_status: result.paymentIntentStatus,
    submission_state: result.submissionState,
    next_action_type: result.nextActionType,
    failure_reason: result.failureReason,
    needs_manual_3ds: result.needsManual3DS,
    trial_eligible: result.trialEligible,
    eligibility_only: result.eligibilityOnly,
    checkout_url: redactSecrets(result.checkoutUrl || '')
  }
}

async function detectProTrialEligibility(
  opts: CliOptions,
  taskLog: (message: string) => void,
  taskEmail?: string,
  taskPassword?: string,
  browserSession?: RegistrationBrowserSession
): Promise<{
  checked: boolean
  success: boolean
  trialEligible?: boolean
  totalCents?: number
  totalText?: string
  error?: string
}> {
  const startedAt = Date.now()
  const logger = createEventLogger(opts.proEventsPath)
  let kiro: KiroClient | null = null
  let selectedAccount: { path: string; lineIndex: number } | null = null

  try {
    taskLog('开始检测 Kiro PRO 试用资格（只看 checkout 金额，不提交付款）')
    await logger.info(`读取 PRO 检测输入资料: ${opts.proTxtDir}`)
    const input = await loadSubscribeInput(opts.proTxtDir, { email: taskEmail, password: taskPassword, eligibilityOnly: true })
    if (input.account) {
      selectedAccount = { path: input.accountPoolPath, lineIndex: input.account.lineIndex }
      await updateAccountStatus(input.accountPoolPath, input.account.lineIndex, '试用检测中')
    }
    await logger.event('pro_trial.input_loaded', {
      account_line: input.account ? input.account.lineIndex + 1 : undefined,
      email: input.email,
      card: 'not_required_for_eligibility'
    })

    kiro = new KiroClient({
      profileDir: opts.proProfileDir,
      headless: opts.headless,
      logger,
      freshProfile: browserSession ? false : !opts.proReuseProfile,
      artifactDir: `${resolve('.')}/artifacts`,
      credentials: { email: input.email, password: input.password, recoveryEmail: input.recoveryEmail },
      existingContext: browserSession?.context,
      existingPage: browserSession?.page,
      closeExistingContext: false
    })

    const session = await kiro.ensureSession()
    await logger.info('已取得 Kiro profileArn', { profileArn: session.profileArn })
    const subscriptionState = readSubscriptionState(session.usage)
    await logger.event('kiro.subscription_state', subscriptionState)

    if (subscriptionState.isPaid) {
      const result = {
        success: true,
        mode: 'pro_trial_eligibility_check',
        already_subscribed: true,
        trial_eligible: false,
        stopped_before_payment: true,
        reason: 'already_subscribed',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        elapsed_ms: Date.now() - startedAt,
        account: maskEmail(input.email),
        account_line: input.account ? input.account.lineIndex + 1 : undefined,
        profile_arn: session.profileArn,
        subscription: subscriptionState,
        events_path: opts.proEventsPath
      }
      await saveJson(opts.proResultPath, result)
      if (input.account) await updateAccountStatus(input.accountPoolPath, input.account.lineIndex, '已是PRO')
      taskLog('账号已是 PRO/付费状态，已停止')
      return { checked: true, success: true, trialEligible: false }
    }

    const checkout = await kiro.generateSubscriptionManagementUrl(session.profileArn)
    const checkoutSessionId = extractCheckoutSessionId(checkout.checkoutUrl)
    if (!checkoutSessionId) throw new Error(`无法从 checkout URL 提取 checkout_session_id: ${checkout.checkoutUrl}`)
    await logger.info('已提取 Stripe checkout_session_id', { checkoutSessionId })

    const publishableKey = await kiro.discoverStripePublishableKey(checkout.checkoutUrl, checkoutSessionId)
    await logger.info('已从 Stripe checkout 浏览器链路捕获 publishable_key', { publishableKey })

    const stripeResult = await runStripeCheckout({
      checkoutSessionId,
      publishableKey,
      checkoutUrl: checkout.checkoutUrl,
      profile: input.profile,
      eligibilityOnly: true,
      maxTotalCents: Number.MAX_SAFE_INTEGER,
      referrerHost: 'app.kiro.dev',
      referrer: 'https://app.kiro.dev',
      artifactDir: `${resolve('.')}/artifacts`,
      logger
    })
    await logger.event('stripe.result', publicStripeResult(stripeResult))

    const trialEligible = stripeResult.trialEligible === true
    const result = {
      success: trialEligible,
      mode: 'pro_trial_eligibility_check',
      auto_pro_trial: true,
      trial_eligible: trialEligible,
      stopped_before_payment: true,
      reason: trialEligible ? 'checkout_total_is_zero' : stripeResult.amountDetected === false ? 'checkout_total_unknown' : 'checkout_total_is_not_zero',
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      account: maskEmail(input.email),
      account_line: input.account ? input.account.lineIndex + 1 : undefined,
      profile_arn: session.profileArn,
      subscription_type: checkout.subscriptionType,
      stripe: publicStripeResult(stripeResult),
      events_path: opts.proEventsPath
    }
    await saveJson(opts.proResultPath, result)
    if (input.account) {
      const status = trialEligible ? '试用资格:金额0' : `无试用资格:${stripeResult.totalText || `${stripeResult.totalCents} cents`}`
      await updateAccountStatus(input.accountPoolPath, input.account.lineIndex, status)
    }
    taskLog(trialEligible
      ? `✓ 检测到 PRO 试用资格：付款金额为 0，结果已保存 ${opts.proResultPath}`
      : `✗ 未检测到 PRO 试用资格：付款金额 ${stripeResult.totalText || stripeResult.totalCents}，结果已保存 ${opts.proResultPath}`)
    return { checked: true, success: trialEligible, trialEligible, totalCents: stripeResult.totalCents, totalText: stripeResult.totalText }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const lockedByKiro = /suspended|temporarily suspended|unusual user activity|account.*locked|账号不可用|临时锁定|authentication error|authentication failed/i.test(message)
    await logger.error(message).catch(() => undefined)
    if (selectedAccount) {
      await updateAccountStatus(selectedAccount.path, selectedAccount.lineIndex, lockedByKiro ? 'Kiro锁号/无资格' : `失败:${redactSecrets(message).slice(0, 80)}`).catch(() => undefined)
    }
    await saveJson(opts.proResultPath, {
      success: false,
      mode: 'pro_trial_eligibility_check',
      trial_eligible: false,
      stopped_before_payment: true,
      reason: lockedByKiro ? 'kiro_account_suspended' : 'pro_trial_check_failed',
      error: redactSecrets(message),
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      events_path: opts.proEventsPath
    }).catch(() => undefined)
    taskLog(lockedByKiro
      ? `PRO 试用资格检测结束：账号被 Kiro 临时锁定，无试用资格结果。${redactSecrets(message)}`
      : `PRO 试用资格检测失败: ${redactSecrets(message)}`)
    return { checked: true, success: false, trialEligible: false, error: redactSecrets(message) }
  } finally {
    await kiro?.close().catch(() => undefined)
  }
}

async function detectProTrialEligibilityWithFallback(
  opts: CliOptions,
  taskLog: (message: string) => void,
  taskEmail?: string,
  taskPassword?: string,
  browserSession?: RegistrationBrowserSession
): Promise<{
  checked: boolean
  success: boolean
  trialEligible?: boolean
  totalCents?: number
  totalText?: string
  error?: string
}> {
  const primary = await detectProTrialEligibility(opts, taskLog, taskEmail, taskPassword, browserSession)
  if (primary.success || !browserSession) return primary
  if (/suspended|temporarily suspended|unusual user activity|account.*locked|账号不可用|临时锁定/i.test(primary.error || '')) {
    taskLog(`当前账号 Kiro 不可用/被临时锁定，不再兜底重试: ${primary.error}`)
    return primary
  }
  taskLog(`当前注册浏览器检测失败，兜底使用专用 Kiro profile 重试一次: ${primary.error || 'unknown'}`)
  return detectProTrialEligibility(opts, taskLog, taskEmail, taskPassword)
}

async function saveJson(path: string, data: unknown): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
}

async function runRegistration(opts: CliOptions): Promise<{ ok: number; fail: number }> {
  const startedAt = Date.now()
  const total = Math.max(1, opts.count)

  const logInfo = (msg: string) => {
    process.stdout.write(`${msg}\n`)
  }

  const funnyMessages = [
    '奥里给！冲！',
    '干就完了！',
    '怕什么！干！',
    '冲冲冲！',
    '不要怂！就是干！',
    '奥里给！',
    '干就完事了！',
    '冲啊兄弟们！',
    '不要怕！上！',
    '奥里给！冲冲冲！'
  ]

  const getRandomFunny = () => funnyMessages[Math.floor(Math.random() * funnyMessages.length)]

  logInfo(`🔥 奥里给！准备造 ${opts.count} 个账号！并发 ${opts.concurrency} 个！`)
  logInfo(`   (AWS: 你们礼貌吗？？？)\n`)

  
  const allRecords: Array<{
    email?: string
    name?: string
    uploadedToKiroRs?: boolean
    kiroRsCredentialId?: number
    proTrialChecked?: boolean
    proTrialEligible?: boolean
    proTrialTotalCents?: number
    proTrialTotalText?: string
    success: boolean
    error?: string
  }> = new Array(total).fill(null)

  let completed = 0

  const tasks = Array.from({ length: total }, (_, i) => i)

  await runWithConcurrency(tasks, opts.concurrency, async (idx) => {
    if (opts.delayMs > 0 && idx > 0) {
      await new Promise((r) => setTimeout(r, opts.delayMs))
    }

    const taskNum = idx + 1
    const log = (message: string) => {
      const funny = getRandomFunny()
      process.stdout.write(`[${funny}] 第${taskNum}号选手: ${message}\n`)
    }

    try {
      // 设置代理环境变量（让 fetch 请求也走代理）
      if (opts.proxyUrl) {
        process.env.HTTP_PROXY = opts.proxyUrl
        process.env.HTTPS_PROXY = opts.proxyUrl
        process.env.http_proxy = opts.proxyUrl
        process.env.https_proxy = opts.proxyUrl
      }
      
      log('正在向 AWS 伸手要设备码...')
      const start = await startBuilderIdDeviceLogin(opts.region)
      if (start.success === false) {
        throw new Error(start.error)
      }

      log(`拿到 userCode: ${start.userCode}，浏览器启动！自动化走起！`)

      const result = await registerAwsBuilderIdTempMail({
        log,
        proxyUrl: opts.proxyUrl,
        incognitoMode: opts.incognitoMode,
        userCode: start.userCode,
        verificationUri: start.verificationUri,
        useFingerprint: opts.useFingerprint,
        headless: opts.headless,
        keepBrowserOpen: opts.autoProTrial
      })

      let uploadedToKiroRs = false
      let kiroRsCredentialId: number | undefined

      let proTrialChecked = false
      let proTrialEligible: boolean | undefined
      let proTrialTotalCents: number | undefined
      let proTrialTotalText: string | undefined
      let proTrialError: string | undefined
      let taskSuccess = result.success

      if (result.success && opts.autoProTrial) {
        log('PRO 试用检测已开启：当前流程只执行 注册 -> 检测资格，然后停止；不会付款，也不会发布到 kiro.rs')
        const proTrial = await detectProTrialEligibilityWithFallback(opts, log, result.email, result.password, result.browserSession)
        proTrialChecked = proTrial.checked
        proTrialEligible = proTrial.trialEligible
        proTrialTotalCents = proTrial.totalCents
        proTrialTotalText = proTrial.totalText
        proTrialError = proTrial.error
        taskSuccess = proTrial.success
      } else if (result.success) {
        const endAt = start.expiresAt
        let intervalMs = Math.max(1000, start.interval * 1000)
        let refreshToken: string | undefined
        let clientId: string | undefined
        let clientSecret: string | undefined

        log('等 AWS 确认中...（它可能懵了）')
        while (Date.now() < endAt) {
          const poll = await pollBuilderIdDeviceAuth({
            region: opts.region,
            clientId: start.clientId,
            clientSecret: start.clientSecret,
            deviceCode: start.deviceCode
          })

          if (poll.success === false) {
            throw new Error(poll.error)
          }

          if (poll.completed === true) {
            refreshToken = poll.refreshToken
            clientId = poll.clientId
            clientSecret = poll.clientSecret
            break
          }

          if (poll.status === 'slow_down') {
            intervalMs += 5000
            log('AWS 说：慢点慢点！你太快了！')
          }

          await new Promise((r) => setTimeout(r, intervalMs))
        }

        if (!refreshToken || !clientId || !clientSecret) {
          throw new Error('AWS 授权已完成页面流程，但未取到 refreshToken/clientId/clientSecret')
        }

        if (opts.publishKiroRs) {
          if (!opts.kiroRsKey) {
            throw new Error('缺少 kiro.rs admin API key；请在 .env 配置 KIRO_RS_ADMIN_KEY')
          }
          const admin = new KiroRsAdminClient({
            baseUrl: opts.kiroRsUrl,
            apiKey: opts.kiroRsKey,
            log: (message) => log(message)
          })
          const upload = await admin.addBuilderIdCredential({
            refreshToken,
            clientId,
            clientSecret,
            region: opts.region,
            email: result.email
          }, {
            priority: opts.kiroRsPriority,
            endpoint: opts.kiroRsEndpoint,
            authRegion: opts.kiroRsAuthRegion,
            apiRegion: opts.kiroRsApiRegion,
            proxyUrl: opts.proxyUrl
          })
          uploadedToKiroRs = upload.success
          kiroRsCredentialId = upload.credentialId || upload.credential_id
          log(`✓ 已自动发布到 kiro.rs${kiroRsCredentialId ? `，credentialId=${kiroRsCredentialId}` : ''}`)
        }
      }

      allRecords[idx] = {
        email: result.email,
        name: result.name,
        uploadedToKiroRs,
        kiroRsCredentialId,
        proTrialChecked,
        proTrialEligible,
        proTrialTotalCents,
        proTrialTotalText,
        success: taskSuccess,
        error: result.error || proTrialError
      }

      completed++
      if (result.success && opts.autoProTrial) {
        if (taskSuccess && proTrialEligible === true) {
          log(`✅ 注册完成，PRO 试用资格确认：金额 0。邮箱: ${result.email}`)
        } else if (proTrialChecked) {
          log(`⚠️ 注册完成，但 PRO 试用资格未通过/检测失败: ${proTrialError || proTrialTotalText || '未检测到金额 0'}`)
        } else {
          log(`⚠️ 注册完成，但 PRO 试用资格未检测完成`)
        }
      } else if (result.success) {
        log(`✅ 拿下！邮箱: ${result.email}！AWS 又损失一员大将！`)
      } else {
        log(`❌ 翻车了: ${result.error}...AWS 这波防住了`)
      }
      await result.browserSession?.close().catch(() => undefined)
    } catch (e) {
      completed++
      allRecords[idx] = {
        success: false,
        error: e instanceof Error ? e.message : String(e)
      }
      log(`💥 炸了: ${allRecords[idx]!.error}！但是不要慌！`)
    }
  })

  const ok = allRecords.filter(r => r?.success).length
  const fail = allRecords.filter(r => r && !r.success).length
  const elapsedMs = Date.now() - startedAt
  const elapsedSec = Math.round(elapsedMs / 1000)


  print('')
  if (ok > 0 && fail === 0) {
    log('green', `🎉 奥里给！${ok} 个账号全部拿下！耗时 ${elapsedSec} 秒！`)
    log('cyan', `   AWS: "我太难了..."`)
  } else if (ok > 0) {
    log('yellow', `😅 还行！拿下 ${ok} 个，翻车 ${fail} 个，耗时 ${elapsedSec} 秒`)
    log('dim', `   (翻车的那些...下次再战！)`)
  } else {
    log('red', `💀 全军覆没！一个都没成！耗时 ${elapsedSec} 秒`)
    log('dim', `   (是不是网不行？还是 AWS 开挂了？)`)
  }

  log('dim', '\n授权信息不会写本地 show/*.json；开启 kiro.rs 发布时会自动上传')

  return { ok, fail }
}

async function interactiveMode(initialOptions: Partial<CliOptions>): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve)
    })
  }

  const questionWithDefault = async (prompt: string, defaultValue: string): Promise<string> => {
    const answer = await question(`${prompt} [默认: ${defaultValue}]: `)
    return answer.trim() || defaultValue
  }

  let currentOptions: CliOptions = { ...DEFAULT_OPTIONS, ...initialOptions }
  let running = true

  const showBanner = () => {
    print('')
    log('bright', '╔══════════════════════════════════════════════╗')
    log('bright', '║  🤖 AWS 账号批量生产机 v1.0                  ║')
    log('bright', '║     (白嫖 AWS，人人有责)                     ║')
    log('bright', '╚══════════════════════════════════════════════╝')
  }

  const showMenu = async () => {
    showBanner()

    print('')
    log('dim', '┌─ ⚙️ 当前配置 ───────────────────────────────')
    log('dim', `│ 要造几个: ${currentOptions.count} 个`)
    log('dim', `│ 同时开几个: ${currentOptions.concurrency} 个`)
    log('dim', `│ 每个隔多久: ${currentOptions.delayMs}ms`)
    log('dim', `│ 隐身模式: ${currentOptions.incognitoMode ? '✅ 开着呢' : '❌ 关了'}`)
    log('dim', `│ 指纹伪装: ${currentOptions.useFingerprint ? '✅ 伪装中' : '❌ 原始状态'}`)
    log('dim', `│ 浏览器显示: ${currentOptions.headless ? '❌ 后台运行' : '✅ 前台可见'}`)
    log('dim', `│ 发布 kiro.rs: ${currentOptions.autoProTrial ? '⏸ PRO检测开启，暂不发布' : currentOptions.publishKiroRs ? '✅ 自动发布' : '❌ 不发布'}`)
    log('dim', `│ PRO试用资格检测: ${currentOptions.autoProTrial ? '✅ 开启（检测后停止）' : '❌ 不检测'}`)
    if (currentOptions.proxyUrl) {
      log('dim', `│ 走代理: ${currentOptions.proxyUrl}`)
    } else {
      log('dim', `│ 走代理: 无 (直连，AWS 知道你是谁)`)
    }
    log('dim', '└─────────────────────────────────────────────')
    print('')
    log('cyan', '┌─ 🎮 操作菜单 ───────────────────────────────')
    print(COLORS.cyan + '│' + COLORS.reset + '  [1] 🚀 开始造号！')
    print(COLORS.cyan + '│' + COLORS.reset + '  [2] 改一下要造几个')
    print(COLORS.cyan + '│' + COLORS.reset + '  [3] 改一下并发数 (别太贪心)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [4] 改一下间隔时间')
    print(COLORS.cyan + '│' + COLORS.reset + '  [5] 切换隐身模式')
    print(COLORS.cyan + '│' + COLORS.reset + '  [6] 切换指纹伪装')
    print(COLORS.cyan + '│' + COLORS.reset + '  [7] 切换浏览器显示')
    print(COLORS.cyan + '│' + COLORS.reset + '  [8] 切换是否发布 kiro.rs')
    print(COLORS.cyan + '│' + COLORS.reset + '  [9] 切换PRO试用资格检测')
    print(COLORS.cyan + '│' + COLORS.reset + '  [10] 设置代理')
    print(COLORS.cyan + '│' + COLORS.reset + '  [0] 退出 (不玩了)')
    log('cyan', '└─────────────────────────────────────────────')
    print('')
  }


  await showMenu()

  while (running) {
    const input = await question(COLORS.green + '选个数字 [0-10] > ' + COLORS.reset)
    const cmd = input.trim()

    switch (cmd) {
      case '1': {
        print('')
        log('cyan', '🔥 开始造号！AWS 准备好接招了吗？')
        log('dim', '───────────────────────────────────────')
        const result = await runRegistration(currentOptions)
        log('dim', '───────────────────────────────────────')
        if (result.ok > 0) {
          log('magenta', `\n🎉 收工！成功造了 ${result.ok} 个账号！`)
        }
        break
      }

      case '2': {
        const answer = await questionWithDefault('要造几个账号', String(currentOptions.count))
        const val = toInt(answer, currentOptions.count)
        if (val < 1) {
          log('red', '至少造 1 个吧，你输入的是啥？')
        } else if (val > 50) {
          currentOptions.count = val
          log('yellow', `⚠️ 设置为 ${val} 个...你这是要搞大事啊，小心被封`)
        } else {
          currentOptions.count = val
          log('green', `✓ 好的，准备造 ${val} 个账号`)
        }
        break
      }

      case '3': {
        const answer = await questionWithDefault('并发数', String(currentOptions.concurrency))
        const val = toInt(answer, currentOptions.concurrency)
        if (val < 1) {
          log('red', '并发数至少 1 个，别闹')
        } else if (val > 5) {
          currentOptions.concurrency = val
          log('yellow', `⚠️ 并发 ${val} 个...你的电脑扛得住吗？`)
        } else {
          currentOptions.concurrency = val
          log('green', `✓ 并发数设为 ${val}`)
        }
        break
      }

      case '4': {
        const answer = await questionWithDefault('任务间隔(ms)', String(currentOptions.delayMs))
        const val = toInt(answer, currentOptions.delayMs)
        if (val < 0) {
          log('red', '时间不能倒流，输入正数')
        } else {
          currentOptions.delayMs = val
          if (val === 0) {
            log('green', `✓ 不设间隔，全速前进！(AWS: 救命)`)
          } else {
            log('green', `✓ 间隔设为 ${val}ms，稳一点好`)
          }
        }
        break
      }

      case '5': {
        currentOptions.incognitoMode = !currentOptions.incognitoMode
        if (currentOptions.incognitoMode) {
          log('green', '✓ 隐身模式已开启 (浏览器不留痕迹)')
        } else {
          log('yellow', '⚠️ 隐身模式已关闭 (你确定？会留痕迹的)')
        }
        break
      }

      case '6': {
        currentOptions.useFingerprint = !currentOptions.useFingerprint
        if (currentOptions.useFingerprint) {
          log('green', '✓ 指纹伪装已开启 (每个浏览器看起来都不一样)')
        } else {
          log('yellow', '⚠️ 指纹伪装已关闭 (AWS 可能会认出你)')
        }
        break
      }

      case '7': {
        currentOptions.headless = !currentOptions.headless
        if (currentOptions.headless) {
          log('green', '✓ 浏览器改为后台运行')
        } else {
          log('green', '✓ 浏览器改为前台可见，你可以直接看注册流程')
        }
        break
      }

      case '8': {
        currentOptions.publishKiroRs = !currentOptions.publishKiroRs
        if (currentOptions.publishKiroRs) {
          log('green', '✓ 注册成功后会自动发布到 kiro.rs')
        } else {
          log('yellow', '⚠️ 已关闭 kiro.rs 自动发布')
        }
        break
      }

      case '9': {
        currentOptions.autoProTrial = !currentOptions.autoProTrial
        if (currentOptions.autoProTrial) {
          log('green', '✓ 注册成功后只检测 PRO 试用资格；检测完立刻停止，不付款、不发布 kiro.rs')
        } else {
          log('yellow', '⚠️ 已关闭 PRO 试用资格检测；注册成功后按原逻辑发布 kiro.rs')
        }
        break
      }

      case '10': {
        const current = currentOptions.proxyUrl || '无'
        const answer = await question(`代理地址 (留空清除) [当前: ${current}]: `)
        if (answer.trim() === '') {
          currentOptions.proxyUrl = undefined
          log('green', '✓ 代理已清除 (直连 AWS)')
        } else {
          currentOptions.proxyUrl = answer.trim()
          log('green', `✓ 代理设为: ${answer.trim()}`)
          log('dim', '  (希望你的代理靠谱)')
        }
        break
      }

      case '0':
      case 'q':
      case 'exit':
      case 'quit':
        running = false
        print('')
        log('green', '👋 拜拜！记得用切换工具把账号用起来~')
        break

      default:
        log('yellow', `输入 "${input}" 是啥意思？请输入 0-10`)
        break
    }

    if (running && cmd !== '10') {
      print('')
      await showMenu()
    }
  }

  rl.close()
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2))
  const hasCliArgs = Object.keys(cliArgs).length > 0
  const nonInteractive = process.argv.includes('--non-interactive') || process.argv.includes('-y')
  const testMailProvider = process.argv.includes('--test-mail')

  if (testMailProvider) {
    const opts: CliOptions = { ...DEFAULT_OPTIONS, ...cliArgs }
    log('cyan', '正在自测临时邮箱渠道')
    const result = await createTempMail((message) => log('dim', message), 15)
    if (!result) {
      log('red', '✗ 临时邮箱渠道自测失败')
      process.exitCode = 1
      return
    }
    log('green', `✓ 临时邮箱渠道自测成功: ${result.email}`)
    return
  }

  if (hasCliArgs && nonInteractive) {
    const opts: CliOptions = { ...DEFAULT_OPTIONS, ...cliArgs }
    const result = await runRegistration(opts)
    process.exitCode = result.fail > 0 ? 1 : 0
  } else {
    await interactiveMode(cliArgs)
  }
}

main().catch((e) => {
  process.stderr.write(`💥 出大事了: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`)
  process.exitCode = 1
})
