import { fetch } from 'undici'

export type BuilderIdStartResult =
  | {
      success: true
      userCode: string
      verificationUri: string
      expiresIn: number
      interval: number
      clientId: string
      clientSecret: string
      deviceCode: string
      expiresAt: number
    }
  | { success: false; error: string }

export type BuilderIdPollResult =
  | {
      success: true
      completed: false
      status: 'pending' | 'slow_down'
      interval?: number
    }
  | {
      success: true
      completed: true
      accessToken: string
      refreshToken: string
      clientId: string
      clientSecret: string
      region: string
      expiresIn: number
    }
  | { success: false; error: string }

const DEFAULT_SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
  'codewhisperer:transformations',
  'codewhisperer:taskassist'
]

export async function startBuilderIdDeviceLogin(region: string): Promise<BuilderIdStartResult> {
  const oidcBase = `https://oidc.${region}.amazonaws.com`
  const startUrl = 'https://view.awsapps.com/start'

  try {
    const regRes = await fetch(`${oidcBase}/client/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'Kiro Account Manager',
        clientType: 'public',
        scopes: DEFAULT_SCOPES,
        grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
        issuerUrl: startUrl
      })
    })

    if (!regRes.ok) {
      return { success: false, error: `注册客户端失败: ${await regRes.text()}` }
    }

    const regData = (await regRes.json()) as { clientId: string; clientSecret: string }
    const clientId = regData.clientId
    const clientSecret = regData.clientSecret
    if (!clientId || !clientSecret) return { success: false, error: '注册客户端返回缺少 clientId/clientSecret' }

    const authRes = await fetch(`${oidcBase}/device_authorization`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, startUrl })
    })

    if (!authRes.ok) {
      return { success: false, error: `设备授权失败: ${await authRes.text()}` }
    }

    const authData = (await authRes.json()) as {
      deviceCode: string
      userCode: string
      verificationUri: string
      verificationUriComplete?: string
      interval?: number
      expiresIn?: number
    }

    const deviceCode = authData.deviceCode
    const userCode = authData.userCode
    const verificationUri = authData.verificationUriComplete || authData.verificationUri
    const interval = authData.interval ?? 5
    const expiresIn = authData.expiresIn ?? 600

    if (!deviceCode || !userCode || !verificationUri) {
      return { success: false, error: '设备授权返回缺少 deviceCode/userCode/verificationUri' }
    }

    return {
      success: true,
      userCode,
      verificationUri,
      expiresIn,
      interval,
      clientId,
      clientSecret,
      deviceCode,
      expiresAt: Date.now() + expiresIn * 1000
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pollBuilderIdDeviceAuth(params: {
  region: string
  clientId: string
  clientSecret: string
  deviceCode: string
}): Promise<BuilderIdPollResult> {
  const oidcBase = `https://oidc.${params.region}.amazonaws.com`

  try {
    const tokenRes = await fetch(`${oidcBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        deviceCode: params.deviceCode
      })
    })

    if (tokenRes.status === 200) {
      const tokenData = (await tokenRes.json()) as { accessToken: string; refreshToken: string; expiresIn: number }
      return {
        success: true,
        completed: true,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        region: params.region,
        expiresIn: tokenData.expiresIn
      }
    }

    if (tokenRes.status === 400) {
      const errData = (await tokenRes.json()) as { error?: string }
      const error = errData.error
      if (error === 'authorization_pending') return { success: true, completed: false, status: 'pending' }
      if (error === 'slow_down') return { success: true, completed: false, status: 'slow_down' }
      if (error === 'expired_token') return { success: false, error: '设备码已过期' }
      if (error === 'access_denied') return { success: false, error: '用户拒绝授权' }
      return { success: false, error: `授权错误: ${error || 'unknown'}` }
    }

    return { success: false, error: `未知响应: ${tokenRes.status}` }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
