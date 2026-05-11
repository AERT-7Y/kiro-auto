import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export type EventLogger = {
  event: (type: string, data?: Record<string, unknown>) => Promise<void>
  info: (message: string, data?: Record<string, unknown>) => Promise<void>
  warn: (message: string, data?: Record<string, unknown>) => Promise<void>
  error: (message: string, data?: Record<string, unknown>) => Promise<void>
}

export function clean(value: unknown): string {
  return String(value ?? '').trim()
}

export function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value)
    if (text) return text
  }
  return ''
}

export function trimMessage(value: unknown, max = 500): string {
  const text = clean(value)
  if (!text) return '-'
  return text.length <= max ? text : `${text.slice(0, max)}...`
}


export function maskEmail(value: unknown): string {
  const text = clean(value)
  const at = text.indexOf('@')
  if (at <= 0) return text ? '***' : ''
  const local = text.slice(0, at)
  const domain = text.slice(at + 1)
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${visible}***@${domain}`
}

export function redactSecrets(value: unknown): string {
  return String(value ?? '')
    .replace(/pk_(live|test)_[A-Za-z0-9_\-]+/g, 'pk_$1_***')
    .replace(/sk_(live|test)_[A-Za-z0-9_\-]+/g, 'sk_$1_***')
    .replace(/cs_(live|test)_[A-Za-z0-9_\-]+/g, 'cs_$1_***')
    .replace(/aor-[A-Za-z0-9_\-]+/g, 'aor-***')
    .replace(/\b[A-Z]{2}-[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}\b/g, 'CDK-***')
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{24,}\b/gi, 'Bearer ***')
    .replace(/(client_secret=)[^&\s]+/gi, '$1***')
    .replace(/(password=)[^&\s]+/gi, '$1***')
    .replace(/(card\]\[number\]=)[^&\s]+/gi, '$1***')
    .replace(/(card\]\[cvc\]=)[^&\s]+/gi, '$1***')
    .replace(/\b\d{12,19}\b/g, (m) => `${m.slice(0, 4)}***${m.slice(-4)}`)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => maskEmail(m))
}

function redactData<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactSecrets(value) as T
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => redactData(item)) as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase()
      if (/password|secret|token|authorization|cookie|cvc|cvv|cardnumber|number|api[_-]?key|bearer|otp|verification|captcha/.test(lower)) {
        out[key] = '***'
      } else if (/^(code|cdk|cdkcode)$/.test(lower) && typeof raw === 'string' && /\b[A-Z]{2}-[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}\b/.test(raw)) {
        out[key] = 'CDK-***'
      } else if (/email/.test(lower)) {
        out[key] = typeof raw === 'string' ? maskEmail(raw) : redactData(raw)
      } else {
        out[key] = redactData(raw)
      }
    }
    return out as T
  }
  return value
}

export function createEventLogger(path: string, opts: { jsonOutput?: boolean } = {}): EventLogger {
  let ready: Promise<void> | null = null
  const ensure = async () => {
    if (!ready) {
      ready = (async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, '', 'utf8')
      })()
    }
    await ready
  }
  const write = async (level: LogLevel, type: string, message?: string, data?: Record<string, unknown>) => {
    await ensure()
    const event = {
      at: new Date().toISOString(),
      level,
      type,
      message: message ? redactSecrets(message) : undefined,
      data: data ? redactData(data) : undefined,
    }
    await writeFile(path, `${JSON.stringify(event)}\n`, { flag: 'a' })
    if (!opts.jsonOutput && message && level !== 'debug') {
      const prefix = level === 'warn' ? '⚠' : level === 'error' ? '✗' : '•'
      console.log(`${prefix} ${redactSecrets(message)}`)
    }
  }
  return {
    event: (type, data) => write('debug', type, undefined, data),
    info: (message, data) => write('info', 'info', message, data),
    warn: (message, data) => write('warn', 'warn', message, data),
    error: (message, data) => write('error', 'error', message, data),
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function randomHex(bytes: number): string {
  const arr = new Uint8Array(Math.max(1, bytes))
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomGuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const raw = randomHex(16).padEnd(32, '0')
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomHex(4)}`
}
