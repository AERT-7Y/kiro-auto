import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { clean, firstNonEmpty, onlyDigits, randomGuid, randomId, redactSecrets, sleep, trimMessage, type EventLogger } from './common'
import type { BillingProfile, CardInput } from './pro-input'

const DEFAULT_STRIPE_VERSION = '2025-03-31.basil'
const DEFAULT_JS_VERSION = '5412f474d5'
const DEFAULT_REFERRER_HOST = 'app.kiro.dev'
const DEFAULT_REFERRER = 'https://app.kiro.dev'

export type StripeCheckoutOptions = {
  checkoutSessionId: string
  publishableKey?: string
  checkoutUrl?: string
  card?: CardInput
  profile: BillingProfile
  dryRun?: boolean
  eligibilityOnly?: boolean
  headless?: boolean
  maxTotalCents?: number
  referrerHost?: string
  referrer?: string
  threeDS?: StripeThreeDSAutomation
  artifactDir?: string
  logger?: EventLogger
}

export type StripeThreeDSAutomation = {
  waitForCode: () => Promise<string>
  getCode?: () => Promise<string>
  timeoutMs?: number
  pollMs?: number
}

export type StripeCheckoutResult = {
  dryRun: boolean
  checkoutSessionId: string
  publishableKey: string
  merchant: string
  currency: string
  totalCents: number
  totalText: string
  paymentStatus: string
  checkoutStatus: string
  setupIntentStatus: string
  paymentIntentStatus: string
  submissionState: string
  nextActionType: string
  failureReason: string
  needsManual3DS: boolean
  amountDetected?: boolean
  trialEligible?: boolean
  eligibilityOnly?: boolean
  threeDSStatus?: string
  checkoutUrl?: string
  raw?: unknown
}

type StripeRequestOptions = {
  queryValues?: URLSearchParams
  bodyValues?: URLSearchParams
  publishableKey: string
}

type PaymentPageSnapshot = {
  raw: any
  paymentStatus: string
  checkoutStatus: string
  paymentIntentStatus: string
  setupIntentStatus: string
  failureReason: string
}

type BrowserAutomationResult = {
  completed: boolean
  status: string
  detail?: string
  paymentPage?: PaymentPageSnapshot
  submitted?: boolean
  sawRequiresAction?: boolean
  sawOtpInput?: boolean
}

function isPaidOrComplete(snapshot?: PaymentPageSnapshot): boolean {
  if (!snapshot) return false
  return snapshot.paymentStatus === 'paid'
    || snapshot.paymentIntentStatus === 'succeeded'
    || snapshot.setupIntentStatus === 'succeeded'
    || snapshot.checkoutStatus === 'complete'
}

function isPaymentMethodFailure(snapshot?: PaymentPageSnapshot): boolean {
  if (!snapshot) return false
  return snapshot.paymentIntentStatus === 'requires_payment_method'
    || snapshot.setupIntentStatus === 'requires_payment_method'
    || /card_declined|decline|requires_payment_method/i.test(snapshot.failureReason || '')
}

function normalizeCardNumber(raw: unknown): string {
  const digits = onlyDigits(raw)
  const out: string[] = []
  for (let i = 0; i < digits.length; i += 4) out.push(digits.slice(i, i + 4))
  return out.join(' ').trim()
}

function amountToCents(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw)
  const text = clean(raw)
  if (!text) return 0
  const numeric = text.replace(/[^0-9.-]/g, '')
  if (!numeric) return 0
  const value = Number(numeric)
  if (!Number.isFinite(value)) return 0
  if (/\$|usd|us\$/i.test(text) || numeric.includes('.')) return Math.round(value * 100)
  return Math.round(value)
}

function readTotalCents(payload: any): number {
  const candidates = [
    payload?.total_summary?.due,
    payload?.total_summary?.total,
    payload?.amount_total,
    payload?.total,
  ]
  for (const candidate of candidates) {
    const cents = amountToCents(candidate)
    if (cents > 0) return cents
  }
  return 0
}

function hasTotalAmountSignal(payload: any): boolean {
  const candidates = [
    payload?.total_summary?.due,
    payload?.total_summary?.total,
    payload?.amount_total,
    payload?.total,
  ]
  return candidates.some((candidate) => candidate !== undefined && candidate !== null && clean(candidate) !== '')
}

function readTotalText(payload: any): string {
  return firstNonEmpty(payload?.total_summary?.due, payload?.total_summary?.total, payload?.amount_total, payload?.total, '0')
}

function firstMeaningful(...values: unknown[]): string {
  return firstNonEmpty(...values).replace(/^unknown$/i, '')
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

function findPublishableKeys(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '')
  return Array.from(new Set(Array.from(text.matchAll(/pk_(?:live|test)_[A-Za-z0-9_\-]+/g)).map((m) => clean(m[0])).filter(Boolean)))
}

function findPublishableKey(value: unknown, expectedMode = ''): string {
  const keys = findPublishableKeys(value)
  if (!expectedMode) return keys[0] || ''
  return keys.find((key) => keyMode(key) === expectedMode) || ''
}

function assertSessionKeyMatch(checkoutSessionId: string, publishableKey: string): void {
  const csMode = sessionMode(checkoutSessionId)
  const pkMode = keyMode(publishableKey)
  if (csMode && pkMode && csMode !== pkMode) {
    throw new Error(`Stripe checkout session/key 模式不匹配: ${checkoutSessionId.slice(0, 8)}*** 不能使用 ${publishableKey.slice(0, 7)}***`)
  }
}

function findCurrency(payload: any): string {
  return firstNonEmpty(payload?.currency, payload?.presentment_currency, payload?.payment_intent?.currency, 'usd').toLowerCase()
}

function merchantName(payload: any): string {
  return firstNonEmpty(
    payload?.account_settings?.display_name,
    payload?.account_settings?.merchant_of_record_display_name,
    payload?.account_settings?.order_summary_display_name,
    payload?.business_name,
    'unknown',
  )
}

function readStatusField(payload: any, key: string): string {
  if (!payload || typeof payload !== 'object') return ''
  if (clean(payload[key])) return clean(payload[key])
  if (payload.checkout_session && typeof payload.checkout_session === 'object' && clean(payload.checkout_session[key])) return clean(payload.checkout_session[key])
  if (payload.session && typeof payload.session === 'object' && clean(payload.session[key])) return clean(payload.session[key])
  return ''
}

function parseNextActionType(raw: any): string {
  if (!raw) return ''
  if (typeof raw === 'string') return clean(raw)
  if (typeof raw !== 'object') return ''
  const outerType = clean(raw.type)
  if (!outerType) return firstNonEmpty(raw.challenge_type, raw.action_type)
  const nested = raw[outerType]
  if (nested && typeof nested === 'object') {
    const nestedType = firstNonEmpty(nested.type, nested.challenge_type)
    if (nestedType) return nestedType
  }
  if (outerType === 'use_stripe_sdk' && raw.use_stripe_sdk && typeof raw.use_stripe_sdk === 'object') {
    return firstNonEmpty(raw.use_stripe_sdk.type, raw.use_stripe_sdk?.stripe_js?.type, outerType)
  }
  return outerType
}

function detectNextActionType(payload: any): string {
  return parseNextActionType(payload?.next_action)
    || parseNextActionType(payload?.setup_intent?.next_action)
    || parseNextActionType(payload?.payment_intent?.next_action)
    || ''
}

function extractStripeErrorReason(raw: any): string {
  if (!raw) return ''
  if (typeof raw === 'string') return clean(raw)
  if (typeof raw !== 'object') return ''
  return firstNonEmpty(raw.code, raw.decline_code, raw.failure_code, raw.type, raw.message)
}

function collectObjects(value: unknown, out: any[] = [], depth = 0): any[] {
  if (!value || typeof value !== 'object' || depth > 10) return out
  const obj = value as Record<string, unknown>
  out.push(obj)
  for (const item of Array.isArray(value) ? value : Object.values(obj)) collectObjects(item, out, depth + 1)
  return out
}

function findDeepStatus(payload: any, status: string): any | null {
  const expected = clean(status)
  if (!expected) return null
  return collectObjects(payload).find((obj) => clean(obj.status) === expected) || null
}

function findDeepFailureReason(payload: any): string {
  for (const obj of collectObjects(payload)) {
    const reason = firstNonEmpty(
      extractStripeErrorReason(obj.last_payment_error),
      extractStripeErrorReason(obj.last_setup_error),
      extractStripeErrorReason(obj.error),
      obj.failure_reason,
      obj.failure_code,
      obj.decline_code,
      obj.code,
    )
    if (reason && !/^unknown$/i.test(reason)) return reason
  }
  return ''
}

function resolveFailureReason(payload: any, result: Record<string, string>): string {
  if (result.paymentStatus === 'paid' || result.paymentIntentStatus === 'succeeded' || result.setupIntentStatus === 'succeeded') return 'none'
  if (clean(payload?.three_ds_error)) return clean(payload.three_ds_error)
  if (clean(payload?.browser_3ds?.detail) && clean(payload.browser_3ds.detail) !== 'unknown') return clean(payload.browser_3ds.detail)
  if (clean(payload?.browser_3ds?.status) && clean(payload.browser_3ds.status) !== 'unknown') return clean(payload.browser_3ds.status)
  if (clean(result.nextActionType) && result.nextActionType !== 'unknown') return clean(result.nextActionType)
  return firstNonEmpty(
    extractStripeErrorReason(payload?.setup_intent?.last_setup_error),
    extractStripeErrorReason(payload?.payment_intent?.last_payment_error),
    findDeepFailureReason(payload),
    payload?.submission_attempt?.failure_reason,
    payload?.submission_attempt?.failure_code,
    result.setupIntentStatus,
    result.paymentIntentStatus,
    result.submissionState,
    result.checkoutStatus,
    result.paymentStatus,
    'unknown',
  )
}

function buildStatuses(payload: any): {
  paymentStatus: string
  checkoutStatus: string
  setupIntentStatus: string
  paymentIntentStatus: string
  submissionState: string
  nextActionType: string
} {
  return {
    paymentStatus: firstMeaningful(readStatusField(payload, 'payment_status')) || 'unknown',
    checkoutStatus: firstMeaningful(readStatusField(payload, 'status')) || 'unknown',
    setupIntentStatus: firstMeaningful(payload?.setup_intent?.status) || 'unknown',
    paymentIntentStatus: firstMeaningful(payload?.payment_intent?.status, findDeepStatus(payload, 'requires_payment_method')?.status, findDeepStatus(payload, 'requires_action')?.status) || 'unknown',
    submissionState: firstMeaningful(payload?.submission_attempt?.state) || 'unknown',
    nextActionType: firstMeaningful(detectNextActionType(payload)) || 'unknown',
  }
}

function collectNextActions(payload: any): any[] {
  const out: any[] = []
  if (payload?.next_action && typeof payload.next_action === 'object') out.push(payload.next_action)
  if (payload?.setup_intent?.next_action && typeof payload.setup_intent.next_action === 'object') out.push(payload.setup_intent.next_action)
  if (payload?.payment_intent?.next_action && typeof payload.payment_intent.next_action === 'object') out.push(payload.payment_intent.next_action)
  return out
}

function stableStringify(value: unknown, max = 120_000): string {
  const seen = new WeakSet<object>()
  const text = JSON.stringify(value, (_key, raw) => {
    if (typeof raw === 'object' && raw !== null) {
      if (seen.has(raw)) return '[Circular]'
      seen.add(raw)
    }
    return raw
  }) || ''
  return text.length <= max ? text : text.slice(0, max)
}

function findObjectWithKeys(value: unknown, keys: string[], depth = 0): any | null {
  if (!value || typeof value !== 'object' || depth > 10) return null
  const obj = value as Record<string, unknown>
  if (keys.some((key) => clean(obj[key]))) return obj
  for (const item of Array.isArray(value) ? value : Object.values(obj)) {
    const found = findObjectWithKeys(item, keys, depth + 1)
    if (found) return found
  }
  return null
}

function extractPossibleClientSecret(payload: any): string {
  return firstNonEmpty(
    payload?.payment_intent?.client_secret,
    payload?.setup_intent?.client_secret,
    payload?.intent?.client_secret,
    findObjectWithKeys(payload, ['client_secret'])?.client_secret,
  )
}

function extractIntentID(payload: any): string {
  const fromSecret = extractPossibleClientSecret(payload).match(/^(pi|seti)_[A-Za-z0-9]+_secret_/)?.[0]?.replace(/_secret_$/, '')
  return firstNonEmpty(payload?.payment_intent?.id, payload?.setup_intent?.id, payload?.intent?.id, fromSecret)
}

function extractThreeDSSource(payload: any): string {
  const text = stableStringify(payload)
  const source = text.match(/src_[A-Za-z0-9]+/)?.[0]
  return firstNonEmpty(
    payload?.source,
    payload?.three_d_secure_2_source,
    payload?.payment_intent?.next_action?.use_stripe_sdk?.three_d_secure_2_source,
    payload?.payment_intent?.next_action?.use_stripe_sdk?.stripe_js?.three_d_secure_2_source,
    source,
  )
}

function extractLastPaymentErrorCode(payload: any): string {
  const direct = firstNonEmpty(
    extractStripeErrorReason(payload?.payment_intent?.last_payment_error),
    extractStripeErrorReason(payload?.setup_intent?.last_setup_error),
  )
  if (direct) return direct
  for (const obj of collectObjects(payload)) {
    const reason = firstNonEmpty(
      extractStripeErrorReason(obj.last_payment_error),
      extractStripeErrorReason(obj.last_setup_error),
      extractStripeErrorReason(obj.error),
    )
    if (reason) return reason
  }
  return ''
}

function extractLatestChargeOutcome(payload: any): Record<string, string> {
  for (const obj of collectObjects(payload)) {
    const outcome = obj?.outcome && typeof obj.outcome === 'object' ? obj.outcome : null
    if (!outcome) continue
    const reason = firstNonEmpty(outcome.reason, outcome.type, outcome.network_status, outcome.seller_message)
    if (reason) {
      return {
        reason,
        type: clean(outcome.type),
        network_status: clean(outcome.network_status),
        seller_message: clean(outcome.seller_message),
      }
    }
  }
  return {}
}

function extract3DS2AuthenticateParams(payload: any): { source: string; clientSecret: string; intentID: string } {
  return {
    source: extractThreeDSSource(payload),
    clientSecret: extractPossibleClientSecret(payload),
    intentID: extractIntentID(payload),
  }
}

function hasChallengeSignal(payload: any): boolean {
  const text = stableStringify(payload, 40_000)
  return /challenge|three_d_secure_redirect|stripe_3ds2_challenge|use_stripe_sdk|requires_action/i.test(text)
}

function buildPaymentPageSnapshot(raw: any): PaymentPageSnapshot {
  const pi = raw?.payment_intent || findDeepStatus(raw, 'requires_action') || findDeepStatus(raw, 'requires_payment_method') || findDeepStatus(raw, 'succeeded')
  const si = raw?.setup_intent || findDeepStatus(raw, 'requires_action') || findDeepStatus(raw, 'requires_payment_method') || findDeepStatus(raw, 'succeeded')
  const statuses = {
    paymentStatus: firstMeaningful(readStatusField(raw, 'payment_status')) || 'unknown',
    checkoutStatus: firstMeaningful(readStatusField(raw, 'status')) || 'unknown',
    paymentIntentStatus: firstMeaningful(pi?.status, raw?.payment_intent?.status) || 'unknown',
    setupIntentStatus: firstMeaningful(raw?.setup_intent?.status, si?.object === 'setup_intent' ? si?.status : '') || 'unknown',
  }
  return {
    raw,
    ...statuses,
    failureReason: firstMeaningful(resolveFailureReason(raw, {
      ...statuses,
      submissionState: firstMeaningful(raw?.submission_attempt?.state) || 'unknown',
      nextActionType: firstMeaningful(detectNextActionType(raw)) || 'unknown',
    })) || statuses.paymentIntentStatus,
  }
}

function buildThreeDSMethodData(action: {
  serverTransactionID?: string
  methodNotificationURL?: string
  merchant?: string
  threeDSSource?: string
}): string {
  const txID = clean(action.serverTransactionID)
  const notificationURL = firstNonEmpty(action.methodNotificationURL, buildStripeThreeDSMethodNotificationURL(action.merchant, action.threeDSSource))
  if (!txID || !notificationURL) return ''
  return Buffer.from(JSON.stringify({ threeDSServerTransID: txID, threeDSMethodNotificationURL: notificationURL })).toString('base64')
}

function buildStripeThreeDSMethodNotificationURL(merchant: unknown, source: unknown): string {
  const m = clean(merchant)
  const s = clean(source)
  if (!m || !s) return ''
  return `https://hooks.stripe.com/3d_secure_2/fingerprint/${encodeURIComponent(m)}/${encodeURIComponent(s)}`
}

function resolveThreeDSProvider(directoryServerName: unknown, methodURL: unknown): string {
  const ds = clean(directoryServerName).toLowerCase()
  let host = ''
  try {
    host = new URL(clean(methodURL)).hostname.toLowerCase()
  } catch {}
  if (host === 'acs-method.apata.io' || host.endsWith('.apata.io')) return 'apata'
  if (ds.includes('mastercard')) return 'mastercard'
  if (ds.includes('visa')) return 'visa'
  return 'default'
}

function extractThreeDSFingerprintAction(payload: any): any | null {
  const setupIntent = payload?.setup_intent && typeof payload.setup_intent === 'object' ? payload.setup_intent : {}
  for (const action of collectNextActions(payload)) {
    if (clean(action.type) !== 'use_stripe_sdk') continue
    const sdk = action.use_stripe_sdk && typeof action.use_stripe_sdk === 'object' ? action.use_stripe_sdk : null
    if (!sdk) continue
    const stripeJS = sdk.stripe_js && typeof sdk.stripe_js === 'object' ? sdk.stripe_js : null
    const sdkType = firstNonEmpty(sdk.type, stripeJS?.type)
    if (sdkType !== 'stripe_3ds2_fingerprint') continue
    const methodURL = firstNonEmpty(sdk.three_ds_method_url, sdk.threeDSMethodUrl, stripeJS?.three_ds_method_url, stripeJS?.threeDSMethodUrl, stripeJS?.url)
    let methodData = firstNonEmpty(sdk.threeDSMethodData, sdk.three_ds_method_data, sdk.threeds_method_data, stripeJS?.threeDSMethodData, stripeJS?.three_ds_method_data, stripeJS?.threeds_method_data)
    const directoryServerName = firstNonEmpty(sdk.directory_server_name, stripeJS?.directory_server_name)
    const serverTransactionID = firstNonEmpty(sdk.server_transaction_id, stripeJS?.server_transaction_id)
    const methodNotificationURL = firstNonEmpty(
      sdk.three_ds_method_notification_url,
      sdk.threeDSMethodNotificationURL,
      stripeJS?.three_ds_method_notification_url,
      stripeJS?.threeDSMethodNotificationURL,
    )
    const merchant = firstNonEmpty(sdk.merchant, stripeJS?.merchant)
    const threeDSSource = firstNonEmpty(sdk.three_d_secure_2_source, stripeJS?.three_d_secure_2_source)
    if (!methodData) {
      methodData = buildThreeDSMethodData({ serverTransactionID, methodNotificationURL, merchant, threeDSSource })
    }
    if (!methodURL || !methodData) return null
    return {
      methodURL,
      methodData,
      directoryServerName,
      serverTransactionID,
      methodNotificationURL,
      merchant,
      threeDSSource,
      provider: resolveThreeDSProvider(directoryServerName, methodURL),
      setupIntentID: setupIntent.id,
      setupIntentClientSecret: setupIntent.client_secret,
    }
  }
  return null
}

class StripeSessionClient {
  private readonly cookies = new Map<string, string>()

  async fetch(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers || {})
    const cookie = this.cookieHeader()
    if (cookie) headers.set('Cookie', cookie)
    const response = await fetch(url, { ...init, headers })
    this.captureCookies(response.headers)
    return response
  }

  private captureCookies(headers: Headers): void {
    const getSetCookie = (headers as any).getSetCookie as undefined | (() => string[])
    const values = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : splitSetCookie(headers.get('set-cookie') || '')
    for (const line of values) {
      const first = String(line).split(';')[0] || ''
      const idx = first.indexOf('=')
      if (idx <= 0) continue
      this.cookies.set(first.slice(0, idx), first.slice(idx + 1))
    }
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

function splitSetCookie(raw: string): string[] {
  if (!raw) return []
  const out: string[] = []
  let buffer = ''
  let inExpires = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    buffer += ch
    if (buffer.slice(-8).toLowerCase() === 'expires=') inExpires = true
    if (inExpires && ch === ';') inExpires = false
    if (!inExpires && ch === ',') {
      const next = raw.slice(i + 1)
      if (/^\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=/.test(next)) {
        out.push(buffer.slice(0, -1).trim())
        buffer = ''
      }
    }
  }
  if (buffer.trim()) out.push(buffer.trim())
  return out
}

async function stripeRequest(client: StripeSessionClient, method: 'GET' | 'POST', path: string, options: StripeRequestOptions): Promise<any> {
  const q = new URLSearchParams(options.queryValues || undefined)
  const b = new URLSearchParams(options.bodyValues || undefined)
  if (method === 'GET') {
    if (!q.get('key')) q.set('key', options.publishableKey)
    if (!q.get('_stripe_version')) q.set('_stripe_version', DEFAULT_STRIPE_VERSION)
  } else {
    if (!b.get('key')) b.set('key', options.publishableKey)
    if (!b.get('_stripe_version')) b.set('_stripe_version', DEFAULT_STRIPE_VERSION)
  }
  let url = `https://api.stripe.com${path}`
  if (q.toString()) url += `?${q.toString()}`
  const headers = new Headers({ Accept: 'application/json' })
  let body: string | undefined
  if (method === 'POST') {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    body = b.toString()
  }
  let response: Response
  try {
    response = await client.fetch(url, { method, headers, body })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`stripe fetch failed ${method} ${path}: ${trimMessage(reason)}`)
  }
  const text = await response.text()
  if (!response.ok) throw new Error(`stripe http ${response.status}: ${trimMessage(text || response.statusText)}`)
  return text ? JSON.parse(text) : {}
}

async function stripeRequestWithRetry(client: StripeSessionClient, method: 'GET' | 'POST', path: string, options: StripeRequestOptions & { retries?: number }): Promise<any> {
  const retries = options.retries ?? 2
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await stripeRequest(client, method, path, options)
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message : String(err)
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(message) || attempt >= retries) break
      await sleep(800 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'stripe request failed'))
}

async function executeThreeDSMethodRequest(client: StripeSessionClient, action: any): Promise<void> {
  const body = new URLSearchParams({ threeDSMethodData: action.methodData })
  const resp = await client.fetch(action.methodURL, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://js.stripe.com',
      Referer: 'https://js.stripe.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: body.toString(),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`3DS method http ${resp.status}: ${trimMessage(text || resp.statusText)}`)
}

function build3DS2BrowserPayload(fingerprintData = ''): string {
  return JSON.stringify({
    fingerprintAttempted: true,
    ...(fingerprintData ? { fingerprintData } : {}),
    challengeWindowSize: '05',
    threeDSCompInd: 'Y',
    browserJavaEnabled: false,
    browserJavascriptEnabled: true,
    browserLanguage: 'en-US',
    browserColorDepth: '24',
    browserScreenHeight: '960',
    browserScreenWidth: '1440',
    browserTZ: '-480',
    browserUserAgent: 'Mozilla/5.0',
  })
}

async function authenticate3DS2IfPossible(client: StripeSessionClient, payload: any, publishableKey: string, action?: any): Promise<any> {
  const params = extract3DS2AuthenticateParams(payload)
  const source = firstNonEmpty(params.source, action?.threeDSSource)
  if (!source) {
    payload.three_ds2_authenticate_error = 'missing_source'
    return payload
  }
  const body = new URLSearchParams()
  body.set('source', source)
  body.set('browser', build3DS2BrowserPayload(firstNonEmpty(action?.methodData)))
  body.set('one_click_authn_device_support[hosted]', 'false')
  body.set('one_click_authn_device_support[same_origin_frame]', 'false')
  body.set('one_click_authn_device_support[spc_eligible]', 'true')
  body.set('one_click_authn_device_support[webauthn_eligible]', 'true')
  body.set('one_click_authn_device_support[publickey_credentials_get_allowed]', 'true')
  try {
    payload.three_ds2_authenticate = await stripeRequestWithRetry(client, 'POST', '/v1/3ds2/authenticate', { bodyValues: body, publishableKey })
    const state = clean(payload.three_ds2_authenticate?.state)
    if (state && state !== 'succeeded') payload.three_ds2_authenticate_error = `state=${state}`
  } catch (err) {
    payload.three_ds2_authenticate_error = err instanceof Error ? err.message : String(err)
  }
  return payload
}

async function refreshIntentAndPage(client: StripeSessionClient, payload: any, checkoutSessionId: string, publishableKey: string): Promise<any> {
  const intentID = extractIntentID(payload)
  const clientSecret = extractPossibleClientSecret(payload)
  if (intentID) {
    try {
      const query = new URLSearchParams()
      query.set('is_stripe_sdk', 'false')
      if (clientSecret) query.set('client_secret', clientSecret)
      const path = intentID.startsWith('seti_') ? `/v1/setup_intents/${encodeURIComponent(intentID)}` : `/v1/payment_intents/${encodeURIComponent(intentID)}`
      const intent = await stripeRequestWithRetry(client, 'GET', path, { queryValues: query, publishableKey })
      if (intentID.startsWith('seti_')) payload.setup_intent = intent
      else payload.payment_intent = intent
    } catch (err) {
      payload.intent_refresh_error = err instanceof Error ? err.message : String(err)
    }
  }
  try {
    const latest = await stripeRequestWithRetry(client, 'GET', `/v1/payment_pages/${encodeURIComponent(checkoutSessionId)}`, { publishableKey })
    Object.assign(payload, latest)
  } catch (err) {
    payload.payment_page_refresh_error = err instanceof Error ? err.message : String(err)
  }
  return payload
}

async function runNextActionIfNeeded(client: StripeSessionClient, payload: any, checkoutSessionId: string, publishableKey: string): Promise<any> {
  const action = extractThreeDSFingerprintAction(payload)
  if (!action) return payload
  try {
    await executeThreeDSMethodRequest(client, action)
    payload.three_ds_executed = true
    payload.three_ds_provider = action.provider
  } catch (err) {
    payload.three_ds_executed = false
    payload.three_ds_error = err instanceof Error ? err.message : String(err)
    return payload
  }
  await authenticate3DS2IfPossible(client, payload, publishableKey, action)
  return refreshIntentAndPage(client, payload, checkoutSessionId, publishableKey)
}

export async function discoverPublishableKey(checkoutUrl: string, checkoutSessionId: string): Promise<string> {
  const expectedMode = sessionMode(checkoutSessionId)
  const fromUrl = findPublishableKey(checkoutUrl, expectedMode)
  if (fromUrl) return fromUrl
  const response = await fetch(checkoutUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      Referer: 'https://app.kiro.dev/',
      'User-Agent': 'Mozilla/5.0',
    },
  })
  const text = await response.text()
  const key = findPublishableKey(text, expectedMode)
  if (!key) {
    const modes = findPublishableKeys(text).map((k) => keyMode(k)).filter(Boolean).join(',') || 'none'
    throw new Error(`未发现匹配 ${expectedMode || 'unknown'} checkout session 的 Stripe publishable key: ${checkoutSessionId}; 页面 key modes=${modes}`)
  }
  return key
}

async function complete3DSInBrowser(options: {
  checkoutUrl: string
  automation: StripeThreeDSAutomation
  logger?: EventLogger
  artifactDir?: string
}): Promise<BrowserAutomationResult> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  })
  const page = await context.newPage()
  let latestPaymentPage: PaymentPageSnapshot | undefined
  let sawRequiresAction = false
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.includes('/v1/payment_pages/')) return
    const ct = resp.headers()['content-type'] || ''
    if (!/json/i.test(ct)) return
    try {
      const raw = await resp.json()
      latestPaymentPage = buildPaymentPageSnapshot(raw)
      if (latestPaymentPage.paymentIntentStatus === 'requires_action' || latestPaymentPage.setupIntentStatus === 'requires_action' || hasChallengeSignal(raw)) {
        sawRequiresAction = true
      }
      await options.logger?.event('stripe.browser.payment_page', {
        url,
        paymentStatus: latestPaymentPage.paymentStatus,
        checkoutStatus: latestPaymentPage.checkoutStatus,
        paymentIntentStatus: latestPaymentPage.paymentIntentStatus,
        setupIntentStatus: latestPaymentPage.setupIntentStatus,
        failureReason: latestPaymentPage.failureReason,
      })
    } catch {}
  })
  try {
    await options.logger?.info('尝试浏览器自动完成 Stripe 3DS challenge')
    await page.goto(options.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const deadline = Date.now() + (options.automation.timeoutMs || 5 * 60_000)
    let requestedCode = false
    let lastText = ''
    while (Date.now() < deadline) {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined)
      const pageText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
      lastText = pageText.slice(0, 500)
      if (isPaidOrComplete(latestPaymentPage)) {
        return { completed: true, status: 'completed', paymentPage: latestPaymentPage, sawRequiresAction }
      }
      const failedPaymentPage = isPaymentMethodFailure(latestPaymentPage)
      if (failedPaymentPage) {
        await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, 'stripe-3ds-requires-payment-method')
        return { completed: false, status: 'requires_payment_method', detail: latestPaymentPage?.failureReason, paymentPage: latestPaymentPage, sawRequiresAction }
      }
      if (/payment successful|thank you|订阅成功|支付成功/i.test(pageText)) {
        return { completed: true, status: 'completed', paymentPage: latestPaymentPage, sawRequiresAction }
      }
      if (/declined|failed|unable|error|拒绝|失败/i.test(pageText) && !/verification|code|验证码/i.test(pageText)) {
        await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, 'stripe-3ds-failed')
        return { completed: false, status: 'failed', detail: trimMessage(lastText, 300), paymentPage: latestPaymentPage, sawRequiresAction }
      }
      const codeInputSelector = 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[id*="otp" i], input[id*="code" i], input[type="tel"], input[inputmode="numeric"]'
      let codeInput = page.locator(codeInputSelector).first()
      let codeVisible = await codeInput.isVisible({ timeout: 1000 }).catch(() => false)
      if (!codeVisible) {
        for (const frame of page.frames()) {
          const candidate = frame.locator(codeInputSelector).first()
          if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
            codeInput = candidate
            codeVisible = true
            break
          }
        }
      }
      if (codeVisible) {
        await options.logger?.event('stripe.browser.3ds_input_visible', { waiting_for_code: true })
        const otp = await maybeRead3DSCode(options.automation)
        if (!otp) {
          requestedCode = true
          await options.logger?.event('stripe.browser.3ds_input_waiting_code', { status: 'waiting_for_sms' })
          await sleep(options.automation.pollMs || 5000)
          continue
        }
        sawRequiresAction = true
        await codeInput.fill(otp, { timeout: 10_000 })
        let clicked = await page
          .locator('button:has-text("Submit"), button:has-text("Continue"), button:has-text("Verify"), button:has-text("Complete"), button:has-text("Pay"), input[type="submit"]')
          .first()
          .click({ timeout: 3000 })
          .then(() => true)
          .catch(() => false)
        if (!clicked) {
          for (const frame of page.frames()) {
            clicked = await frame
              .locator('button:has-text("Submit"), button:has-text("Continue"), button:has-text("Verify"), button:has-text("Complete"), button:has-text("Pay"), input[type="submit"]')
              .first()
              .click({ timeout: 1000 })
              .then(() => true)
              .catch(() => false)
            if (clicked) break
          }
        }
        if (!clicked) await page.keyboard.press('Enter').catch(() => undefined)
        await options.logger?.info('已提交 Stripe 3DS 验证码')
        requestedCode = true
        await sleep(5000)
        sawRequiresAction = true
        continue
      }
      if (/approve|authorize|confirm|complete authentication/i.test(pageText)) {
        const clicked = await page
          .locator('button:has-text("Approve"), button:has-text("Authorize"), button:has-text("Confirm"), button:has-text("Continue"), input[type="submit"]')
          .first()
          .click({ timeout: 3000 })
          .then(() => true)
          .catch(() => false)
        if (clicked) {
          await sleep(5000)
          continue
        }
      }
      await sleep(options.automation.pollMs || (requestedCode ? 3000 : 5000))
    }
    await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, requestedCode ? 'stripe-3ds-submitted-timeout' : 'stripe-3ds-challenge-not-found')
    return {
      completed: false,
      status: requestedCode ? 'submitted_timeout' : 'challenge_not_found',
      detail: trimMessage(lastText, 300),
      paymentPage: latestPaymentPage,
      submitted: requestedCode,
      sawRequiresAction,
      sawOtpInput: requestedCode,
    }
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

async function saveBrowserDiagnosticArtifacts(
  page: any,
  artifactDir: string | undefined,
  logger: EventLogger | undefined,
  stem: string,
): Promise<void> {
  if (!artifactDir) {
    const frames = page.frames().map((frame: any) => ({ url: redactSecrets(frame.url()) }))
    await logger?.event('stripe.browser.frames', { frames })
    return
  }
  try {
    await mkdir(artifactDir, { recursive: true })
    const base = join(artifactDir, stem)
    const frameSummaries: Array<{ url: string; text: string }> = []
    for (const frame of page.frames()) {
      const text = await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '')
      frameSummaries.push({ url: redactSecrets(frame.url()), text: trimMessage(redactSecrets(text), 1000) })
    }
    const dom = await page.content().catch(() => '')
    const screenshotPath = `${base}.png`
    const domPath = `${base}.html`
    const framesPath = `${base}.frames.json`
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
    await writeFile(domPath, redactSecrets(dom), 'utf8').catch(() => undefined)
    await writeFile(framesPath, JSON.stringify(frameSummaries, null, 2), 'utf8').catch(() => undefined)
    await logger?.event('stripe.browser.diagnostics', {
      screenshot: screenshotPath,
      dom: domPath,
      frames: framesPath,
      frame_count: frameSummaries.length,
    })
  } catch (err) {
    await logger?.warn('保存 Stripe 3DS 诊断失败', { error: err instanceof Error ? err.message : String(err) })
  }
}

async function fillFirstVisible(scopes: any[], selectors: string[], value: string, logger: EventLogger | undefined, label: string): Promise<boolean> {
  const text = clean(value)
  if (!text) return false
  for (const scope of scopes) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first()
      if (!(await locator.isVisible({ timeout: 350 }).catch(() => false))) continue
      await locator.fill(text, { timeout: 5000 })
      await logger?.event('stripe.browser.fill', { label, selector })
      return true
    }
  }
  return false
}

async function selectFirstVisible(scopes: any[], selectors: string[], value: string, logger: EventLogger | undefined, label: string): Promise<boolean> {
  const text = clean(value)
  if (!text) return false
  for (const scope of scopes) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first()
      if (!(await locator.isVisible({ timeout: 350 }).catch(() => false))) continue
      const ok = await locator.selectOption(text, { timeout: 3000 }).then(() => true).catch(() => false)
      if (ok) {
        await logger?.event('stripe.browser.select', { label, selector })
        return true
      }
    }
  }
  return false
}

async function clickFirstVisible(scopes: any[], selectors: string[], logger: EventLogger | undefined, label: string): Promise<boolean> {
  for (const scope of scopes) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first()
      if (!(await locator.isVisible({ timeout: 500 }).catch(() => false))) continue
      const ok = await locator.click({ timeout: 5000 }).then(() => true).catch(() => false)
      if (ok) {
        await logger?.event('stripe.browser.click', { label, selector })
        return true
      }
    }
  }
  return false
}

function pageScopes(page: any): any[] {
  return [page, ...page.frames()]
}

async function isInLikely3DSContext(page: any): Promise<boolean> {
  const urls = page.frames().map((frame: any) => clean(frame.url()).toLowerCase()).join('\n')
  if (/3d_secure|three_d_secure|acs|challenge|stripe\.com\/3ds|hooks\.stripe\.com|secure|authentication/i.test(urls)) return true
  const text = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')
  return /verification code|one.?time|authentication code|security code sent|enter.*code|3d secure|3ds|短信|验证码|动态码|认证码|银行|sent.*code/i.test(text)
}

async function hasVisibleBlockingError(page: any): Promise<string> {
  const selectors = [
    '[role="alert"]',
    '[aria-live="assertive"]',
    '[data-testid*="error" i]',
    '.Error',
    '.error',
  ]
  const scopes = pageScopes(page)
  for (const scope of scopes) {
    for (const selector of selectors) {
      const text = await scope.locator(selector).first().innerText({ timeout: 500 }).catch(() => '')
      if (clean(text) && /declined|failed|unable|invalid|error|拒绝|失败|无效/i.test(text)) return trimMessage(text, 300)
    }
  }
  return ''
}

async function maybeRead3DSCode(automation: StripeThreeDSAutomation): Promise<string> {
  if (typeof automation.getCode === 'function') return clean(await automation.getCode().catch(() => ''))
  return ''
}

async function submitCheckoutInBrowser(options: {
  checkoutUrl: string
  card: CardInput
  profile: BillingProfile
  automation: StripeThreeDSAutomation
  logger?: EventLogger
  artifactDir?: string
}): Promise<BrowserAutomationResult> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  })
  const page = await context.newPage()
  let latestPaymentPage: PaymentPageSnapshot | undefined
  let sawRequiresAction = false
  let sawOtpInput = false
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.includes('/v1/payment_pages/')) return
    const ct = resp.headers()['content-type'] || ''
    if (!/json/i.test(ct)) return
    try {
      const raw = await resp.json()
      latestPaymentPage = buildPaymentPageSnapshot(raw)
      if (latestPaymentPage.paymentIntentStatus === 'requires_action' || latestPaymentPage.setupIntentStatus === 'requires_action' || hasChallengeSignal(raw)) {
        sawRequiresAction = true
      }
      await options.logger?.event('stripe.browser.payment_page', {
        url,
        paymentStatus: latestPaymentPage.paymentStatus,
        checkoutStatus: latestPaymentPage.checkoutStatus,
        paymentIntentStatus: latestPaymentPage.paymentIntentStatus,
        setupIntentStatus: latestPaymentPage.setupIntentStatus,
        failureReason: latestPaymentPage.failureReason,
      })
    } catch {}
  })

  try {
    await options.logger?.info('使用浏览器提交 Stripe Checkout 以触发真实 3DS 发码')
    await page.goto(options.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)

    const scopes = pageScopes(page)
    await clickFirstVisible(scopes, [
      'text=/^Card$/i',
      'button:has-text("Card")',
      '[role="tab"]:has-text("Card")',
      '[data-testid*="card" i]',
    ], options.logger, 'card_tab').catch(() => false)

    await fillFirstVisible(scopes, [
      'input[name="email"]',
      'input[type="email"]',
      'input[autocomplete="email"]',
    ], options.profile.email, options.logger, 'email')
    await fillFirstVisible(scopes, [
      'input[autocomplete="cc-name"]',
      'input[name*="name" i]',
      'input[id*="name" i]',
    ], options.profile.name, options.logger, 'name')

    const cardFilled = await fillFirstVisible(scopes, [
      'input[autocomplete="cc-number"]',
      'input[name="cardnumber"]',
      'input[name="number"]',
      'input[id*="cardNumber" i]',
      'input[aria-label*="card number" i]',
      'input[placeholder*="card number" i]',
      'input[inputmode="numeric"]',
    ], normalizeCardNumber(options.card.number), options.logger, 'card_number')

    const expText = `${options.card.expMonth} / ${options.card.expYear}`
    const expFilled = await fillFirstVisible(scopes, [
      'input[autocomplete="cc-exp"]',
      'input[name="exp-date"]',
      'input[name="expiry"]',
      'input[id*="exp" i]',
      'input[aria-label*="expiration" i]',
      'input[placeholder*="MM" i]',
    ], expText, options.logger, 'expiry')

    const cvcFilled = await fillFirstVisible(scopes, [
      'input[autocomplete="cc-csc"]',
      'input[name="cvc"]',
      'input[name="cvv"]',
      'input[id*="cvc" i]',
      'input[id*="cvv" i]',
      'input[aria-label*="security" i]',
      'input[placeholder*="CVC" i]',
      'input[placeholder*="CVV" i]',
    ], options.card.cvc, options.logger, 'cvc')

    if (cardFilled && (!expFilled || !cvcFilled)) {
      await page.keyboard.press('Tab').catch(() => undefined)
      if (!expFilled) {
        await page.keyboard.type(expText).catch(() => undefined)
        await page.keyboard.press('Tab').catch(() => undefined)
      }
      if (!cvcFilled) {
        await page.keyboard.type(options.card.cvc).catch(() => undefined)
      }
    }

    await selectFirstVisible(scopes, [
      'select[autocomplete="country"]',
      'select[name*="country" i]',
      'select[id*="country" i]',
    ], options.profile.country, options.logger, 'country')
    await fillFirstVisible(scopes, [
      'input[autocomplete="address-line1"]',
      'input[name*="line1" i]',
      'input[id*="line1" i]',
      'input[placeholder*="address" i]',
    ], options.profile.line1, options.logger, 'line1')
    await fillFirstVisible(scopes, [
      'input[autocomplete="address-level2"]',
      'input[name*="city" i]',
      'input[id*="city" i]',
    ], options.profile.city, options.logger, 'city')
    await fillFirstVisible(scopes, [
      'input[autocomplete="address-level1"]',
      'input[name*="state" i]',
      'input[id*="state" i]',
    ], options.profile.state, options.logger, 'state')
    await fillFirstVisible(scopes, [
      'input[autocomplete="postal-code"]',
      'input[name*="postal" i]',
      'input[name*="zip" i]',
      'input[id*="postal" i]',
      'input[id*="zip" i]',
    ], options.profile.postal, options.logger, 'postal')

    if (!cardFilled) {
      await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, 'stripe-checkout-card-fields-not-found')
      return { completed: false, status: 'card_fields_not_found', detail: '未找到 Stripe 卡号输入框', paymentPage: latestPaymentPage, sawRequiresAction, sawOtpInput }
    }

    const preSubmitPaymentPage = latestPaymentPage
    const submitClickedAt = Date.now()
    const clickedPay = await clickFirstVisible(scopes, [
      'button[type="submit"]',
      'button:has-text("Subscribe")',
      'button:has-text("Pay")',
      'button:has-text("Continue")',
      'button:has-text("Complete")',
      'button:has-text("Start")',
      'button:has-text("订阅")',
      'button:has-text("支付")',
      'button:has-text("继续")',
      'input[type="submit"]',
    ], options.logger, 'submit_checkout')
    if (!clickedPay) {
      await page.keyboard.press('Enter').catch(() => undefined)
      await options.logger?.event('stripe.browser.click', { label: 'submit_checkout', selector: 'keyboard.Enter' })
    }
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)

    const deadline = Date.now() + (options.automation.timeoutMs || 5 * 60_000)
    let requestedCode = false
    let lastText = ''
    while (Date.now() < deadline) {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined)
      const pageText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
      lastText = pageText.slice(0, 500)
      const elapsedSinceSubmit = Date.now() - submitClickedAt
      if (isPaidOrComplete(latestPaymentPage)) {
        return { completed: true, status: 'completed', paymentPage: latestPaymentPage, submitted: true, sawRequiresAction, sawOtpInput }
      }
      if (/payment successful|thank you|订阅成功|支付成功/i.test(pageText)) {
        return { completed: true, status: 'completed', paymentPage: latestPaymentPage, submitted: true, sawRequiresAction, sawOtpInput }
      }

      const codeInputSelector = 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[id*="otp" i], input[id*="code" i], input[type="tel"], input[inputmode="numeric"]'
      let codeInput = page.locator(codeInputSelector).first()
      let codeVisible = await codeInput.isVisible({ timeout: 1000 }).catch(() => false)
      if (!codeVisible) {
        for (const frame of page.frames()) {
          const candidate = frame.locator(codeInputSelector).first()
          if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
            codeInput = candidate
            codeVisible = true
            break
          }
        }
      }
      if (codeVisible) {
        await options.logger?.event('stripe.browser.3ds_input_visible', { waiting_for_code: true })
        sawOtpInput = true
        const otp = await maybeRead3DSCode(options.automation)
        if (!otp) {
          requestedCode = true
          await options.logger?.event('stripe.browser.3ds_input_waiting_code', { status: 'waiting_for_sms' })
          await sleep(options.automation.pollMs || 5000)
          continue
        }
        await codeInput.fill(otp, { timeout: 10_000 })
        const clicked = await clickFirstVisible(pageScopes(page), [
          'button:has-text("Submit")',
          'button:has-text("Continue")',
          'button:has-text("Verify")',
          'button:has-text("Complete")',
          'button:has-text("Pay")',
          'button:has-text("提交")',
          'button:has-text("继续")',
          'button:has-text("验证")',
          'input[type="submit"]',
        ], options.logger, 'submit_3ds_otp')
        if (!clicked) await page.keyboard.press('Enter').catch(() => undefined)
        await options.logger?.info('已提交 Stripe 3DS 验证码')
        requestedCode = true
        await sleep(5000)
        continue
      }

      if (/approve|authorize|confirm|complete authentication/i.test(pageText)) {
        const clicked = await clickFirstVisible(pageScopes(page), [
          'button:has-text("Approve")',
          'button:has-text("Authorize")',
          'button:has-text("Confirm")',
          'button:has-text("Continue")',
          'input[type="submit"]',
        ], options.logger, 'approve_3ds')
        if (clicked) {
          sawRequiresAction = true
          await sleep(5000)
          continue
        }
      }

      const failedPaymentPage = isPaymentMethodFailure(latestPaymentPage)
      if (failedPaymentPage) {
        await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, 'stripe-checkout-requires-payment-method')
        return {
          completed: false,
          status: 'requires_payment_method',
          detail: latestPaymentPage?.failureReason,
          paymentPage: latestPaymentPage,
          submitted: true,
          sawRequiresAction,
          sawOtpInput,
        }
      }
      const blockingError = await hasVisibleBlockingError(page)
      if (blockingError || (/declined|failed|unable|error|拒绝|失败/i.test(pageText) && !/verification|code|验证码/i.test(pageText))) {
        await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, 'stripe-checkout-submit-failed')
        return { completed: false, status: 'failed', detail: blockingError || trimMessage(lastText, 300), paymentPage: latestPaymentPage, submitted: true, sawRequiresAction, sawOtpInput }
      }
      if (elapsedSinceSubmit > 20_000 && latestPaymentPage === preSubmitPaymentPage && !sawRequiresAction && !sawOtpInput) {
        await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, 'stripe-checkout-submit-no-state-change')
        return {
          completed: false,
          status: 'submit_no_state_change',
          detail: trimMessage(lastText, 300),
          paymentPage: latestPaymentPage,
          submitted: true,
          sawRequiresAction,
          sawOtpInput,
        }
      }
      await sleep(options.automation.pollMs || (requestedCode ? 3000 : 5000))
    }

    await saveBrowserDiagnosticArtifacts(page, options.artifactDir, options.logger, requestedCode ? 'stripe-checkout-submitted-timeout' : 'stripe-checkout-3ds-not-found')
    return {
      completed: false,
      status: requestedCode ? 'submitted_timeout' : 'challenge_not_found',
      detail: trimMessage(lastText, 300),
      paymentPage: latestPaymentPage,
      submitted: true,
      sawRequiresAction,
      sawOtpInput,
    }
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

export async function runStripeCheckout(options: StripeCheckoutOptions): Promise<StripeCheckoutResult> {
  const client = new StripeSessionClient()
  const checkoutSessionId = clean(options.checkoutSessionId)
  let publishableKey = clean(options.publishableKey)
  if (!publishableKey) publishableKey = await discoverPublishableKey(options.checkoutUrl || '', checkoutSessionId)
  assertSessionKeyMatch(checkoutSessionId, publishableKey)
  const referrerHost = clean(options.referrerHost) || DEFAULT_REFERRER_HOST
  const referrer = clean(options.referrer) || DEFAULT_REFERRER

  const initBody = new URLSearchParams()
  initBody.set('browser_locale', 'en-US')
  initBody.set('browser_timezone', 'Asia/Shanghai')
  initBody.set('redirect_type', 'url')
  const initJSON = await stripeRequestWithRetry(client, 'POST', `/v1/payment_pages/${encodeURIComponent(checkoutSessionId)}/init`, {
    bodyValues: initBody,
    publishableKey,
  })

  const merchant = merchantName(initJSON)
  if (!/kiro/i.test(merchant)) throw new Error(`Stripe 商户不是 Kiro: ${merchant}`)

  const taxBody = new URLSearchParams()
  taxBody.set('tax_region[country]', options.profile.country)
  if (options.profile.line1) taxBody.set('tax_region[line1]', options.profile.line1)
  if (options.profile.city) taxBody.set('tax_region[city]', options.profile.city)
  if (options.profile.postal) taxBody.set('tax_region[postal_code]', options.profile.postal)
  if (options.profile.state) taxBody.set('tax_region[state]', options.profile.state)
  const taxJSON = await stripeRequestWithRetry(client, 'POST', `/v1/payment_pages/${encodeURIComponent(checkoutSessionId)}`, {
    bodyValues: taxBody,
    publishableKey,
  })

  const pageJSON = { ...initJSON, ...taxJSON }
  const totalCents = readTotalCents(pageJSON)
  const maxTotalCents = options.maxTotalCents ?? 3000
  if (!options.eligibilityOnly && totalCents > maxTotalCents) {
    throw new Error(`金额超过保护阈值: total=${totalCents} cents, max=${maxTotalCents} cents`)
  }
  const currency = findCurrency(pageJSON)
  if (currency !== 'usd') throw new Error(`币种不是 USD: ${currency}`)

  const amountDetected = hasTotalAmountSignal(pageJSON)
  const baseResult = {
    checkoutSessionId,
    publishableKey,
    merchant,
    currency,
    totalCents,
    totalText: readTotalText(pageJSON),
    amountDetected,
    checkoutUrl: options.checkoutUrl,
  }

  if (options.dryRun || options.eligibilityOnly) {
    const trialEligible = amountDetected && totalCents === 0
    return {
      dryRun: !!options.dryRun,
      ...baseResult,
      paymentStatus: firstNonEmpty(readStatusField(pageJSON, 'payment_status'), 'not_submitted'),
      checkoutStatus: firstNonEmpty(readStatusField(pageJSON, 'status'), 'not_submitted'),
      setupIntentStatus: firstNonEmpty(pageJSON?.setup_intent?.status, 'not_submitted'),
      paymentIntentStatus: firstNonEmpty(pageJSON?.payment_intent?.status, 'not_submitted'),
      submissionState: firstNonEmpty(pageJSON?.submission_attempt?.state, 'not_submitted'),
      nextActionType: firstNonEmpty(detectNextActionType(pageJSON), 'none'),
      failureReason: options.eligibilityOnly ? (trialEligible ? 'trial_eligible' : amountDetected ? 'trial_not_eligible' : 'trial_amount_unknown') : 'dry_run',
      needsManual3DS: false,
      trialEligible,
      eligibilityOnly: !!options.eligibilityOnly,
      raw: pageJSON,
    }
  }

  if (!options.card) {
    throw new Error('提交付款需要卡信息；PRO 试用资格检测模式不会读取或使用信用卡')
  }

  if (options.threeDS && options.checkoutUrl) {
    const browserSubmit = await submitCheckoutInBrowser({
      checkoutUrl: options.checkoutUrl,
      card: options.card,
      profile: options.profile,
      automation: options.threeDS,
      logger: options.logger,
      artifactDir: options.artifactDir,
    })
    let browserJSON: any = browserSubmit.paymentPage?.raw || {}
    browserJSON.browser_3ds = browserSubmit
    browserJSON = await refreshIntentAndPage(client, browserJSON, checkoutSessionId, publishableKey)
    if (browserSubmit.paymentPage?.raw) browserJSON.browser_payment_page = browserSubmit.paymentPage.raw
    await options.logger?.event('stripe.debug.summary', {
      payment_status: readStatusField(browserJSON, 'payment_status'),
      checkout_status: readStatusField(browserJSON, 'status'),
      payment_intent_status: firstNonEmpty(browserJSON?.payment_intent?.status, findDeepStatus(browserJSON, 'requires_payment_method')?.status, findDeepStatus(browserJSON, 'requires_action')?.status),
      setup_intent_status: firstNonEmpty(browserJSON?.setup_intent?.status),
      next_action_type: detectNextActionType(browserJSON),
      failure_reason: findDeepFailureReason(browserJSON),
      last_payment_error: extractLastPaymentErrorCode(browserJSON),
      charge_outcome: extractLatestChargeOutcome(browserJSON),
      browser_submit_status: browserSubmit.status,
      browser_submit_detail: browserSubmit.detail,
      browser_saw_requires_action: browserSubmit.sawRequiresAction,
      browser_saw_otp_input: browserSubmit.sawOtpInput,
    })
    const statuses = buildStatuses(browserJSON)
    const failureReason = resolveFailureReason(browserJSON, statuses)
    return {
      dryRun: false,
      ...baseResult,
      ...statuses,
      failureReason,
      needsManual3DS: browserSubmit.status === 'challenge_not_found' || browserSubmit.sawRequiresAction === true && browserSubmit.completed === false && browserSubmit.status !== 'requires_payment_method',
      threeDSStatus: browserSubmit.status,
      raw: browserJSON,
    }
  }

  const clientSessionID = randomId('csn')
  const seededElementsSessionID = randomId('elements')
  const expectedAmount = String(totalCents)
  const elementsQuery = new URLSearchParams()
  elementsQuery.set('deferred_intent[mode]', 'subscription')
  elementsQuery.set('deferred_intent[amount]', expectedAmount)
  elementsQuery.set('deferred_intent[currency]', 'usd')
  elementsQuery.set('deferred_intent[setup_future_usage]', 'off_session')
  elementsQuery.set('deferred_intent[payment_method_types][0]', 'card')
  elementsQuery.set('currency', 'usd')
  elementsQuery.set('elements_init_source', 'checkout')
  elementsQuery.set('referrer_host', referrerHost)
  elementsQuery.set('stripe_js_id', clientSessionID)
  elementsQuery.set('locale', 'en')
  elementsQuery.set('type', 'deferred_intent')
  elementsQuery.set('checkout_session_id', checkoutSessionId)
  const elementsJSON = await stripeRequestWithRetry(client, 'GET', '/v1/elements/sessions', { queryValues: elementsQuery, publishableKey })
  const elementsSessionID = firstNonEmpty(elementsJSON.session_id, seededElementsSessionID)

  const confirmBody = new URLSearchParams()
  confirmBody.set('guid', randomGuid())
  confirmBody.set('muid', randomGuid())
  confirmBody.set('sid', randomGuid())
  confirmBody.set('payment_method_data[billing_details][name]', options.profile.name)
  confirmBody.set('payment_method_data[billing_details][email]', options.profile.email)
  if (options.profile.phone) confirmBody.set('payment_method_data[billing_details][phone]', options.profile.phone)
  confirmBody.set('payment_method_data[billing_details][address][line1]', options.profile.line1)
  if (options.profile.line2) confirmBody.set('payment_method_data[billing_details][address][line2]', options.profile.line2)
  confirmBody.set('payment_method_data[billing_details][address][city]', options.profile.city)
  confirmBody.set('payment_method_data[billing_details][address][state]', options.profile.state)
  confirmBody.set('payment_method_data[billing_details][address][postal_code]', options.profile.postal)
  confirmBody.set('payment_method_data[billing_details][address][country]', options.profile.country)
  confirmBody.set('payment_method_data[type]', 'card')
  confirmBody.set('payment_method_data[card][number]', normalizeCardNumber(options.card.number))
  confirmBody.set('payment_method_data[card][cvc]', options.card.cvc)
  confirmBody.set('payment_method_data[card][exp_year]', options.card.expYear)
  confirmBody.set('payment_method_data[card][exp_month]', options.card.expMonth)
  confirmBody.set('payment_method_data[allow_redisplay]', 'unspecified')
  confirmBody.set('payment_method_data[pasted_fields]', 'number,cvc')
  confirmBody.set('payment_method_data[payment_user_agent]', `stripe.js/${DEFAULT_JS_VERSION}; stripe-js-v3/${DEFAULT_JS_VERSION}; payment-element; deferred-intent`)
  confirmBody.set('payment_method_data[referrer]', referrer)
  confirmBody.set('payment_method_data[time_on_page]', '120000')
  confirmBody.set('payment_method_data[client_attribution_metadata][client_session_id]', clientSessionID)
  confirmBody.set('payment_method_data[client_attribution_metadata][checkout_session_id]', checkoutSessionId)
  confirmBody.set('payment_method_data[client_attribution_metadata][merchant_integration_source]', 'checkout')
  confirmBody.set('payment_method_data[client_attribution_metadata][merchant_integration_subtype]', 'payment-element')
  confirmBody.set('payment_method_data[client_attribution_metadata][merchant_integration_version]', 'custom')
  confirmBody.set('payment_method_data[client_attribution_metadata][payment_intent_creation_flow]', 'deferred')
  confirmBody.set('payment_method_data[client_attribution_metadata][payment_method_selection_flow]', 'automatic')
  confirmBody.set('payment_method_data[client_attribution_metadata][elements_session_id]', elementsSessionID)
  confirmBody.set('version', DEFAULT_JS_VERSION)
  confirmBody.set('expected_amount', expectedAmount)
  confirmBody.set('expected_payment_method_type', 'card')
  if (clean(pageJSON.return_url)) confirmBody.set('return_url', clean(pageJSON.return_url))
  confirmBody.set('elements_session_client[elements_init_source]', 'checkout')
  confirmBody.set('elements_session_client[referrer_host]', referrerHost)
  confirmBody.set('elements_session_client[session_id]', elementsSessionID)
  confirmBody.set('elements_session_client[stripe_js_id]', clientSessionID)
  confirmBody.set('elements_session_client[locale]', 'en')
  confirmBody.set('elements_session_client[is_aggregation_expected]', 'false')
  confirmBody.set('client_attribution_metadata[client_session_id]', clientSessionID)
  confirmBody.set('client_attribution_metadata[checkout_session_id]', checkoutSessionId)
  confirmBody.set('client_attribution_metadata[merchant_integration_source]', 'checkout')
  confirmBody.set('client_attribution_metadata[merchant_integration_subtype]', 'payment-element')
  confirmBody.set('client_attribution_metadata[merchant_integration_version]', 'custom')
  confirmBody.set('client_attribution_metadata[payment_intent_creation_flow]', 'deferred')
  confirmBody.set('client_attribution_metadata[payment_method_selection_flow]', 'automatic')
  confirmBody.set('client_attribution_metadata[elements_session_id]', elementsSessionID)

  let confirmJSON = await stripeRequest(client, 'POST', `/v1/payment_pages/${encodeURIComponent(checkoutSessionId)}/confirm`, {
    bodyValues: confirmBody,
    publishableKey,
  })
  confirmJSON = await runNextActionIfNeeded(client, confirmJSON, checkoutSessionId, publishableKey)

  let threeDSStatus = clean(confirmJSON?.three_ds_status)
  if (options.threeDS && options.checkoutUrl && hasChallengeSignal(confirmJSON)) {
    const browser3DS = await complete3DSInBrowser({
      checkoutUrl: options.checkoutUrl,
      automation: options.threeDS,
      logger: options.logger,
      artifactDir: options.artifactDir,
    })
    threeDSStatus = browser3DS.status
    confirmJSON.browser_3ds = browser3DS
    confirmJSON = await refreshIntentAndPage(client, confirmJSON, checkoutSessionId, publishableKey)
    if (browser3DS.paymentPage?.raw) {
      confirmJSON.browser_payment_page = browser3DS.paymentPage.raw
    }
  }

  await options.logger?.event('stripe.debug.summary', {
    payment_status: readStatusField(confirmJSON, 'payment_status'),
    checkout_status: readStatusField(confirmJSON, 'status'),
    payment_intent_status: firstNonEmpty(confirmJSON?.payment_intent?.status, findDeepStatus(confirmJSON, 'requires_payment_method')?.status, findDeepStatus(confirmJSON, 'requires_action')?.status),
    setup_intent_status: firstNonEmpty(confirmJSON?.setup_intent?.status),
    next_action_type: detectNextActionType(confirmJSON),
    failure_reason: findDeepFailureReason(confirmJSON),
    last_payment_error: extractLastPaymentErrorCode(confirmJSON),
    charge_outcome: extractLatestChargeOutcome(confirmJSON),
    three_ds_executed: confirmJSON?.three_ds_executed,
    three_ds_provider: confirmJSON?.three_ds_provider,
    three_ds_error: confirmJSON?.three_ds_error,
    three_ds2_authenticate_error: confirmJSON?.three_ds2_authenticate_error,
    browser_3ds_status: confirmJSON?.browser_3ds?.status,
    browser_3ds_detail: confirmJSON?.browser_3ds?.detail,
    browser_3ds_saw_requires_action: confirmJSON?.browser_3ds?.sawRequiresAction,
    browser_3ds_saw_otp_input: confirmJSON?.browser_3ds?.sawOtpInput,
  })

  const statuses = buildStatuses(confirmJSON)
  const failureReason = resolveFailureReason(confirmJSON, statuses)
  return {
    dryRun: false,
    ...baseResult,
    ...statuses,
    failureReason,
    needsManual3DS: /challenge|redirect|authenticate|3ds/i.test(failureReason) && failureReason !== 'none' && threeDSStatus !== 'completed',
    threeDSStatus: threeDSStatus || undefined,
    raw: confirmJSON,
  }
}
