import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clean, firstNonEmpty, onlyDigits } from './common'

export type AccountRecord = {
  lineIndex: number
  email: string
  password: string
  recoveryEmail?: string
  status?: string
  rawParts: string[]
}

export type CardInput = {
  number: string
  expMonth: string
  expYear: string
  cvc: string
}

export type BillingProfile = {
  name: string
  email: string
  phone?: string
  country: string
  line1: string
  line2?: string
  city: string
  state: string
  postal: string
}

export type SubscribeInput = {
  email: string
  password?: string
  recoveryEmail?: string
  account?: AccountRecord
  accountPoolPath: string
  card?: CardInput
  profile: BillingProfile
}

export type SubscribeInputOptions = {
  cardFile?: string
  email?: string
  password?: string
  recoveryEmail?: string
  eligibilityOnly?: boolean
}

type LoadedCardProfile = {
  card: CardInput
  name?: string
  phone?: string
  address?: Partial<BillingProfile>
}

const DEFAULT_ADDRESS = {
  country: 'US',
  line1: '38 Pearl Avenue',
  city: 'Louisville',
  state: 'MS',
  postal: '39339',
}

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

function parseKeyValueLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    const match = text.match(/^([^:：=]+)[:：=]\s*(.*)$/)
    if (match) out[match[1]!.trim().toLowerCase()] = match[2]!.trim()
  }
  return out
}

function findByKey(data: Record<string, string>, names: string[]): string {
  const lowered = names.map((v) => v.toLowerCase())
  for (const [key, value] of Object.entries(data)) {
    if (lowered.some((name) => key.includes(name))) return value
  }
  return ''
}

function normalizeStatus(status: string | undefined): string {
  return clean(status).replace(/^\uFEFF/, '')
}

function isAvailableStatus(status: string | undefined): boolean {
  const text = normalizeStatus(status)
  if (!text) return true
  return /^(未注册|unused|new|todo|需3DS|3DS处理中|试用检测中)$/i.test(text) || /^失败[:：]/.test(text) || /^试用资格[:：]/.test(text) || /^无试用资格[:：]/.test(text)
}

function sanitizePoolStatus(status: string): string {
  return clean(status)
    .replace(/\r?\n/g, ' ')
    .replace(/----/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}


export function parseAccountPool(raw: string): AccountRecord[] {
  const records: AccountRecord[] = []
  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split('----').map((part) => part.trim())
    const email = parts[0] || ''
    if (!EMAIL_RE.test(email) && !line.includes('----')) continue
    const password = parts[1] || ''
    const recoveryEmail = parts[2] || undefined
    const status = normalizeStatus(parts[3]) || undefined
    if (!email) continue
    records.push({ lineIndex: i, email, password, recoveryEmail, status, rawParts: parts })
  }
  return records
}

export function pickUnregisteredAccount(records: AccountRecord[]): AccountRecord {
  const invalid = records.find((record) => !EMAIL_RE.test(record.email) || !record.password)
  if (invalid) {
    throw new Error(`邮箱池第 ${invalid.lineIndex + 1} 行格式不正确，应为 邮箱----密码----安全邮箱----状态`)
  }
  const picked = records.find((record) => isAvailableStatus(record.status))
  if (!picked) throw new Error('邮箱池没有未注册账号；请清空 邮箱.txt 对应行第四项状态后再重试')
  return picked
}

export function pickAccountByEmail(records: AccountRecord[], email: string): AccountRecord {
  const target = clean(email).toLowerCase()
  if (!EMAIL_RE.test(target)) throw new Error(`指定邮箱格式不正确: ${email}`)
  const record = records.find((item) => item.email.toLowerCase() === target)
  if (!record) throw new Error(`邮箱池未找到指定邮箱: ${email}`)
  if (!EMAIL_RE.test(record.email) || !record.password) {
    throw new Error(`邮箱池第 ${record.lineIndex + 1} 行格式不正确，应为 邮箱----密码----安全邮箱----状态`)
  }
  return record
}

export async function loadAccountPool(path: string): Promise<AccountRecord[]> {
  const raw = await readFile(path, 'utf8')
  return parseAccountPool(raw)
}

export async function updateAccountStatus(path: string, lineIndex: number, status: string): Promise<void> {
  const raw = await readFile(path, 'utf8')
  const hasFinalNewline = /\r?\n$/.test(raw)
  const lines = raw.split(/\r?\n/)
  if (hasFinalNewline && lines[lines.length - 1] === '') lines.pop()
  if (lineIndex < 0 || lineIndex >= lines.length) throw new Error(`邮箱池行号不存在: ${lineIndex + 1}`)
  const originalLine = lines[lineIndex] || ''
  const parts = originalLine.split('----')
  while (parts.length < 4) parts.push('')
  parts[3] = sanitizePoolStatus(status)
  lines[lineIndex] = parts.slice(0, Math.max(4, parts.length)).join('----')
  await writeFile(path, lines.join('\n') + (hasFinalNewline ? '\n' : ''), 'utf8')
}

function normalizeCard(raw: Record<string, string>): CardInput {
  const number = onlyDigits(findByKey(raw, ['卡号', 'card number', 'card']))
  const cvc = onlyDigits(findByKey(raw, ['cvv', 'cvc', '安全码']))
  const expiry = findByKey(raw, ['有效期', 'expiry', 'exp'])
  let expMonth = onlyDigits(findByKey(raw, ['月份', 'month', 'exp_month']))
  let expYear = onlyDigits(findByKey(raw, ['年份', 'year', 'exp_year']))
  if ((!expMonth || !expYear) && expiry) {
    const parts = expiry.match(/\d+/g) || []
    if (parts.length >= 2) {
      if (parts[0]!.length === 4 && parts[1]!.length <= 2) {
        expYear = parts[0]!
        expMonth = parts[1]!
      } else {
        expMonth = parts[0]!
        expYear = parts[1]!
      }
    }
  }
  if (expMonth.length === 1) expMonth = `0${expMonth}`
  if (expYear.length === 4) expYear = expYear.slice(2)
  if (number.length < 12) throw new Error('卡号格式不正确')
  if (!/^(0[1-9]|1[0-2])$/.test(expMonth)) throw new Error('有效期月份格式不正确')
  if (!/^\d{2}$/.test(expYear)) throw new Error('有效期年份格式不正确')
  if (cvc.length < 3) throw new Error('CVV/CVC 格式不正确')
  return { number, expMonth, expYear, cvc }
}

function parseAddress(raw: string): Partial<BillingProfile> {
  const parts = raw.split(/[|,，]/).map((x) => x.trim()).filter(Boolean)
  const out: Partial<BillingProfile> = {}
  if (parts.length >= 5 && /^[A-Za-z]{2}$/.test(parts[2] || '') && /^\d{4,10}$/.test(parts[3] || '')) {
    out.line1 = parts[0]
    out.city = parts[1]
    out.state = parts[2]!.toUpperCase()
    out.postal = parts[3]
    out.country = parts[4]!.toUpperCase()
  } else if (parts.length >= 4) {
    out.line1 = parts[0]
    out.city = parts[1]
    const stateZip = parts[2] || ''
    const m = stateZip.match(/^([A-Za-z]{2})\s+(\d{4,10})$/)
    if (m) {
      out.state = m[1]!.toUpperCase()
      out.postal = m[2]!
    } else {
      out.state = stateZip
    }
    out.country = parts[3]!.toUpperCase()
  } else if (parts.length >= 3) {
    out.line1 = parts[0]
    out.country = parts[2]!.toUpperCase()
    const cityZip = parts[1] || ''
    const zip = cityZip.match(/(\d{4,10})(?!.*\d)/)?.[1]
    out.postal = zip || undefined
    out.city = cityZip.replace(/\d{4,10}(?!.*\d)/, '').trim()
  } else if (raw.trim()) {
    out.line1 = raw.trim()
  }
  return out
}

async function loadCardProfileFromJson(path: string): Promise<LoadedCardProfile> {
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const data = ((parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed) as Record<string, unknown>
  const card = normalizeCard({
    'card number': firstNonEmpty(data.cardNumber, data.number, data.card),
    cvv: firstNonEmpty(data.cvv, data.cvc),
    month: firstNonEmpty(data.expiryMonth, data.expMonth, data.exp_month),
    year: firstNonEmpty(data.expiryYear, data.expYear, data.exp_year),
  })
  const addressRaw = firstNonEmpty(data.billingAddress, data.address, data.nodeInstructions)
  return {
    card,
    name: firstNonEmpty(data.nameOnCard, data.name),
    phone: firstNonEmpty(data.phone, data.phoneNumber),
    address: addressRaw ? parseAddress(addressRaw) : undefined,
  }
}

export async function loadSubscribeInput(txtDir: string, options: SubscribeInputOptions = {}): Promise<SubscribeInput> {
  const emailPath = join(txtDir, '邮箱.txt')
  let records: AccountRecord[] = []
  let account: AccountRecord | undefined
  if (options.email) {
    try {
      records = await loadAccountPool(emailPath)
      account = pickAccountByEmail(records, options.email)
    } catch (error) {
      if (!options.password) throw error
    }
  } else {
    records = await loadAccountPool(emailPath)
    account = pickUnregisteredAccount(records)
  }
  const email = account?.email || clean(options.email)
  const password = account?.password || clean(options.password)
  const recoveryEmail = account?.recoveryEmail || clean(options.recoveryEmail) || undefined
  if (!email || !password) throw new Error('PRO 检测缺少 Kiro 登录邮箱或密码')

  let data: Record<string, string> = {}
  let cardProfile: LoadedCardProfile | undefined
  if (!options.eligibilityOnly) {
    const cardRaw = await readFile(join(txtDir, '信用卡.txt'), 'utf8')
    data = parseKeyValueLines(cardRaw)
    cardProfile = options.cardFile
      ? await loadCardProfileFromJson(options.cardFile)
      : { card: normalizeCard(data), address: parseAddress(findByKey(data, ['地址', 'address'])) }
  }
  const card = cardProfile?.card
  const address = cardProfile?.address || parseAddress(findByKey(data, ['地址', 'address']))
  const name = firstNonEmpty(cardProfile?.name, findByKey(data, ['姓名', 'name']), email.split('@')[0])
  const phone = firstNonEmpty(cardProfile?.phone, findByKey(data, ['电话', 'phone']))
  return {
    email,
    password,
    recoveryEmail,
    account,
    accountPoolPath: emailPath,
    ...(card ? { card } : {}),
    profile: {
      name,
      email,
      phone: phone || undefined,
      country: firstNonEmpty(address.country, DEFAULT_ADDRESS.country).toUpperCase(),
      line1: firstNonEmpty(address.line1, DEFAULT_ADDRESS.line1),
      line2: address.line2,
      city: firstNonEmpty(address.city, DEFAULT_ADDRESS.city),
      state: firstNonEmpty(address.state, DEFAULT_ADDRESS.state).toUpperCase(),
      postal: firstNonEmpty(address.postal, DEFAULT_ADDRESS.postal),
    },
  }
}

export function describeAccount(record: AccountRecord): Record<string, unknown> {
  return {
    line: record.lineIndex + 1,
    email: record.email,
    recovery_email: record.recoveryEmail,
    status: record.status || '',
  }
}

export function describeInput(input: SubscribeInput): Record<string, unknown> {
  return {
    account: input.account ? describeAccount(input.account) : { email: input.email, recovery_email: input.recoveryEmail },
    card: input.card ? `${input.card.number.slice(0, 4)}***${input.card.number.slice(-4)}` : 'not_required_for_eligibility',
    exp: input.card ? `${input.card.expMonth}/${input.card.expYear}` : '',
    profile: {
      name: input.profile.name,
      country: input.profile.country,
      city: input.profile.city,
      state: input.profile.state,
      postal: input.profile.postal,
    },
  }
}
