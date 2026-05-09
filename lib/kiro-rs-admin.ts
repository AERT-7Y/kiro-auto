type LogCallback = (message: string) => void | Promise<void>

export type KiroRsAdminOptions = {
  baseUrl: string
  apiKey: string
  log?: LogCallback
}

export type KiroRsCredentialUploadOptions = {
  priority?: number
  authRegion?: string
  apiRegion?: string
  endpoint?: string
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
  authMethod?: string
  provider?: string
}

export type BuilderIdCredential = {
  refreshToken: string
  clientId: string
  clientSecret: string
  region: string
  email?: string
}

export type KiroRsAddCredentialResponse = {
  success: boolean
  message?: string
  credentialId?: number
  credential_id?: number
  email?: string
  raw: unknown
}

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

function trimMessage(value: string, limit = 500): string {
  const text = clean(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b(aor[0-9A-Za-z_\-.]{12,})\b/g, 'aor***')
    .replace(/\b(sk-[0-9A-Za-z_\-.]{8,})\b/g, 'sk-***')
    .replace(/("?(?:refreshToken|clientSecret|apiKey|x-api-key)"?\s*[:=]\s*)"?[^",\s}]+/gi, '$1"***"')
}

function normalizeBaseUrl(value: string): string {
  const text = clean(value).replace(/\/+$/, '')
  if (!text) throw new Error('缺少 kiro.rs admin 地址')
  return text.endsWith('/admin') ? text.slice(0, -'/admin'.length) : text
}

async function readResponse(response: Response): Promise<{ text: string; json: any }> {
  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { text, json }
}

function applyOptionalCredentialFields(payload: Record<string, unknown>, options: KiroRsCredentialUploadOptions): void {
  if (options.authRegion) payload.authRegion = options.authRegion
  if (options.apiRegion) payload.apiRegion = options.apiRegion
  if (options.endpoint) payload.endpoint = options.endpoint
  if (options.proxyUrl) payload.proxyUrl = options.proxyUrl
  if (options.proxyUsername) payload.proxyUsername = options.proxyUsername
  if (options.proxyPassword) payload.proxyPassword = options.proxyPassword
}

export class KiroRsAdminClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly log?: LogCallback

  constructor(options: KiroRsAdminOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.apiKey = clean(options.apiKey)
    this.log = options.log
    if (!this.apiKey) throw new Error('缺少 kiro.rs admin API key')
  }

  async addBuilderIdCredential(
    credential: BuilderIdCredential,
    options: KiroRsCredentialUploadOptions = {},
  ): Promise<KiroRsAddCredentialResponse> {
    const payload: Record<string, unknown> = {
      refreshToken: credential.refreshToken,
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
      authMethod: options.authMethod || 'IdC',
      provider: options.provider || 'BuilderId',
      priority: options.priority ?? 0,
      region: credential.region,
      email: credential.email,
    }
    applyOptionalCredentialFields(payload, options)
    return this.addCredential(payload, '上传 AWS Builder ID 授权到 kiro.rs')
  }

  private async addCredential(
    payload: Record<string, unknown>,
    message: string,
  ): Promise<KiroRsAddCredentialResponse> {
    const url = `${this.baseUrl}/api/admin/credentials`
    await this.log?.(`${message}: ${url}`)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
    })
    const body = await readResponse(response)
    if (!response.ok) {
      const rawMessage = clean(body.json?.error?.message || body.json?.message || body.text || response.statusText)
      throw new Error(`kiro.rs 添加凭据失败: HTTP ${response.status} ${trimMessage(redactSecrets(rawMessage), 500)}`)
    }

    return {
      success: body.json?.success !== false,
      message: clean(body.json?.message) || undefined,
      credentialId: Number(body.json?.credentialId || body.json?.credential_id || 0) || undefined,
      credential_id: Number(body.json?.credential_id || body.json?.credentialId || 0) || undefined,
      email: clean(body.json?.email) || undefined,
      raw: body.json,
    }
  }
}
