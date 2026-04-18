import { chromium, Browser, Page } from 'playwright'
import * as path from 'path'
import * as fs from 'fs'

type LogCallback = (message: string) => void

const SCREENSHOT_DIR = path.join(process.cwd(), 'show', 'screenshots')

async function ensureScreenshotDir() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
}

async function takeScreenshot(
  page: Page,
  log: LogCallback,
  name: string,
  fullPage: boolean = false
): Promise<string | null> {
  try {
    await ensureScreenshotDir()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${name}_${timestamp}.png`
    const filepath = path.join(SCREENSHOT_DIR, filename)
    await page.screenshot({ path: filepath, fullPage })
    log(`📸 截图已保存: ${filepath}`)
    return filepath
  } catch (error) {
    log(`📸 截图失败: ${error}`)
    return null
  }
}

async function dumpPageHtml(
  page: Page,
  log: LogCallback,
  name: string
): Promise<void> {
  try {
    await ensureScreenshotDir()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${name}_${timestamp}.html`
    const filepath = path.join(SCREENSHOT_DIR, filename)
    const html = await page.content()
    fs.writeFileSync(filepath, html, 'utf-8')
    log(`📄 HTML 已保存: ${filepath}`)
  } catch (error) {
    log(`📄 HTML 保存失败: ${error}`)
  }
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
  'aws'  // 模糊匹配
]

// 随机姓名生成
const FIRST_NAMES = ['James', 'Robert', 'John', 'Michael', 'David', 'William', 'Richard', 'Maria', 'Elizabeth', 'Jennifer', 'Linda', 'Barbara', 'Susan', 'Jessica']
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Thomas', 'Taylor']

function generateRandomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return `${first} ${last}`
}

// HTML 转文本 - 改进版本
function htmlToText(html: string): string {
  if (!html) return ''
  
  let text = html
  
  // 解码 HTML 实体
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  
  // 移除 style 和 script 标签及其内容
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  
  // 将 br 和 p 标签转换为换行
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n')
  text = text.replace(/<\/div>/gi, '\n')
  
  // 移除所有 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ')
  
  // 清理多余空白
  text = text.replace(/\s+/g, ' ')
  
  return text.trim()
}

// 从文本提取验证码 - 改进版本，与 Python 保持一致
function extractCode(text: string): string | null {
  if (!text) return null
  
  for (const pattern of CODE_PATTERNS) {
    // 重置正则表达式的 lastIndex
    pattern.lastIndex = 0
    
    let match
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1]
      if (code && /^\d{6}$/.test(code)) {
        // 获取上下文进行排除检查
        const start = Math.max(0, match.index - 20)
        const end = Math.min(text.length, match.index + match[0].length + 20)
        const context = text.slice(start, end)
        
        // 排除颜色代码 (#XXXXXX)
        if (context.includes('#' + code)) continue
        
        // 排除 CSS 颜色相关
        if (/color[:\s]*[^;]*\d{6}/i.test(context)) continue
        if (/rgb|rgba|hsl/i.test(context)) continue
        
        // 排除超过6位的数字（电话号码、邮编等）
        if (/\d{7,}/.test(context)) continue
        
        return code
      }
    }
  }
  return null
}


/**
 * 从 Outlook 邮箱获取验证码
 * 使用 Microsoft Graph API，与 Python 版本保持一致
 */
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
  const checkInterval = 5000 // 5秒检查一次
  const checkedIds = new Set<string>()
  
  while (Date.now() - startTime < timeout * 1000) {
    try {
      // 刷新 access_token
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
      
      // 获取邮件
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
      
      // 搜索最新的 AWS 邮件
      for (const mail of mailData.value || []) {
        const fromEmail = mail.from?.emailAddress?.address?.toLowerCase() || ''
        const isAwsSender = AWS_SENDERS.some(s => fromEmail.includes(s.toLowerCase()))
        
        if (isAwsSender && !checkedIds.has(mail.id)) {
          checkedIds.add(mail.id)
          
          log(`\n=== 检查 AWS 邮件 ===`)
          log(`  发件人: ${fromEmail}`)
          log(`  主题: ${mail.subject?.substring(0, 50)}`)
          
          // 提取验证码
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

/**
 * 从 tempmail.lol 获取临时邮箱和 token
 */
export async function createTempMail(
  log: LogCallback,
  timeout: number = 30
): Promise<{ email: string; token: string; password?: string } | null> {
  // 尝试多个临时邮箱服务，每个服务尝试多次以获取不同域名
  const yydsMailApiKey = process.env.YYDS_MAIL_API_KEY || process.env.MALIAPI_215_API_KEY
  const services = [
    {
      name: '215.im (YYDS Mail)',
      createUrl: 'https://maliapi.215.im/v1/accounts',
      inboxUrl: (_token: string, email: string) => `https://maliapi.215.im/v1/messages?address=${email}`,
      maxAttempts: 10,
      preferredDomain: '0m0.abrdns.com'  // 你说这个域名能成功
    },
    {
      name: 'tempmail.lol',
      createUrl: 'https://api.tempmail.lol/v2/inbox/create',
      inboxUrl: (token: string) => `https://api.tempmail.lol/v2/inbox?token=${token}`,
      maxAttempts: 10
    },
    {
      name: 'mail.tm',
      createUrl: 'https://api.mail.tm/accounts',
      inboxUrl: (_token: string) => `https://api.mail.tm/messages`,
      requiresAuth: true,
      maxAttempts: 5
    },
    {
      name: '1secmail.com',
      createUrl: 'https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1',
      inboxUrl: (email: string) => `https://www.1secmail.com/api/v1/?action=getMessages&login=${email.split('@')[0]}&domain=${email.split('@')[1]}`,
      maxAttempts: 5
    },
    {
      name: 'tempmail.plus',
      createUrl: 'https://tempmail.plus/api/mails',
      inboxUrl: (email: string) => `https://tempmail.plus/api/mails/${email}`,
      maxAttempts: 5
    },
    {
      name: 'guerrillamail.com',
      createUrl: 'https://api.guerrillamail.com/ajax.php?f=get_email_address',
      inboxUrl: (token: string) => `https://api.guerrillamail.com/ajax.php?f=get_email_list&sid_token=${token}`,
      maxAttempts: 3
    }
  ]
  
  for (const service of services) {
    log(`========== 尝试从 ${service.name} 申请临时邮箱（尝试多个域名）==========`)
    const startTime = Date.now()
    let attemptCount = 0
    const usedDomains = new Set<string>()
    
    while (Date.now() - startTime < timeout * 1000 && attemptCount < service.maxAttempts) {
      try {
        attemptCount++
        
        if (service.name === '215.im (YYDS Mail)') {
          // 215.im API - 需要 API Key（不要硬编码进仓库）
          if (!yydsMailApiKey) {
            log('  ⚠ 未设置 YYDS_MAIL_API_KEY（或 MALIAPI_215_API_KEY），跳过 215.im 服务')
            break
          }
          
          // 先获取可用域名列表
          if (attemptCount === 1) {
            try {
              const domainsResp = await fetch('https://maliapi.215.im/v1/domains', {
                headers: {
                  'Accept': 'application/json'
                }
              })
              
              if (domainsResp.ok) {
                const domainsData = await domainsResp.json() as { success: boolean; data?: Array<{ domain: string; isPublic: boolean; isVerified: boolean }> }
                if (domainsData.success && domainsData.data) {
                  const availableDomains = domainsData.data
                    .filter(d => d.isPublic && d.isVerified)
                    .map(d => d.domain)
                  log(`  可用的公共域名: ${availableDomains.join(', ')}`)
                  
                  // 检查 0m0.abrdns.com 是否在列表中
                  if (availableDomains.includes('0m0.abrdns.com')) {
                    log(`  ✓ 找到目标域名: 0m0.abrdns.com`)
                  } else {
                    log(`  ⚠ 目标域名 0m0.abrdns.com 不在公共域名列表中`)
                  }
                }
              }
            } catch (e) {
              log(`  获取域名列表失败: ${e}`)
            }
          }
          
          // 创建邮箱 - 使用 API Key 并指定域名
          const randomPrefix = Math.random().toString(36).substring(2, 10)
          const requestBody = {
            address: randomPrefix,
            domain: '0m0.abrdns.com'  // 指定域名
          }
          
          log(`  尝试创建邮箱: ${randomPrefix}@0m0.abrdns.com (使用 API Key)`)
          
          const resp = await fetch(service.createUrl, {
            method: 'POST',
            headers: {
              'X-API-Key': yydsMailApiKey,  // 使用 API Key
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          })
          
          if (resp.ok) {
            const result = await resp.json() as { success: boolean; data?: { address: string; token: string } }
            if (result.success && result.data && result.data.address && result.data.token) {
              const domain = result.data.address.split('@')[1]
              usedDomains.add(domain)
              
              const password = Math.random().toString(36).slice(-8) + 'A1!'
              log(`✓ 成功获取临时邮箱: ${result.data.address} (域名: ${domain})`)
              log(`  Token: ${result.data.token.substring(0, 20)}...`)
              return { email: result.data.address, token: result.data.token, password }
            } else {
              log(`  API 返回格式错误: ${JSON.stringify(result)}`)
            }
          } else {
            const errorText = await resp.text()
            log(`  第 ${attemptCount} 次请求失败: ${resp.status} - ${errorText}`)
          }
        } else if (service.name === 'tempmail.lol') {
          const resp = await fetch(service.createUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json'
            }
          })
          
          if (resp.ok) {
            const data = await resp.json() as { address: string; token: string }
            if (data.address && data.token) {
              const domain = data.address.split('@')[1]
              usedDomains.add(domain)
              
              const password = Math.random().toString(36).slice(-8) + 'A1!'
              log(`✓ 成功获取临时邮箱: ${data.address} (域名: ${domain}, 第 ${attemptCount} 次尝试)`)
              log(`  已尝试的域名: ${Array.from(usedDomains).join(', ')}`)
              return { email: data.address, token: data.token, password }
            }
          } else {
            log(`  第 ${attemptCount} 次请求失败: ${resp.status}`)
          }
        } else if (service.name === '1secmail.com') {
          // 1secmail.com - 简单的临时邮箱服务
          const resp = await fetch(service.createUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json'
            }
          })
          
          if (resp.ok) {
            const data = await resp.json() as string[]
            if (data && data.length > 0 && data[0]) {
              const email = data[0]
              const domain = email.split('@')[1]
              usedDomains.add(domain)
              
              const password = Math.random().toString(36).slice(-8) + 'A1!'
              log(`✓ 成功获取临时邮箱: ${email} (域名: ${domain}, 第 ${attemptCount} 次尝试)`)
              // 1secmail 使用邮箱地址作为 token
              return { email, token: email, password }
            }
          }
        } else if (service.name === 'tempmail.plus') {
          // tempmail.plus - 另一个临时邮箱服务
          const resp = await fetch(service.createUrl, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          })
          
          if (resp.ok) {
            const data = await resp.json() as { email: string; token?: string }
            if (data && data.email) {
              const domain = data.email.split('@')[1]
              usedDomains.add(domain)
              
              const password = Math.random().toString(36).slice(-8) + 'A1!'
              log(`✓ 成功获取临时邮箱: ${data.email} (域名: ${domain}, 第 ${attemptCount} 次尝试)`)
              return { email: data.email, token: data.token || data.email, password }
            }
          }
        } else if (service.name === 'guerrillamail.com') {
          // guerrillamail.com - 老牌临时邮箱服务
          const resp = await fetch(service.createUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json'
            }
          })
          
          if (resp.ok) {
            const data = await resp.json() as { email_addr: string; sid_token: string }
            if (data && data.email_addr && data.sid_token) {
              const domain = data.email_addr.split('@')[1]
              usedDomains.add(domain)
              
              const password = Math.random().toString(36).slice(-8) + 'A1!'
              log(`✓ 成功获取临时邮箱: ${data.email_addr} (域名: ${domain}, 第 ${attemptCount} 次尝试)`)
              return { email: data.email_addr, token: data.sid_token, password }
            }
          }
        } else if (service.name === 'mail.tm') {
          // mail.tm 需要先创建账号
          const randomUser = 'user' + Math.random().toString(36).slice(-8)
          const password = Math.random().toString(36).slice(-8) + 'A1!'
          
          // 获取可用域名
          const domainsResp = await fetch('https://api.mail.tm/domains', {
            headers: {
              'Accept': 'application/json'
            }
          })
          
          if (!domainsResp.ok) {
            log(`mail.tm 获取域名失败，跳过`)
            break
          }
          
          const domainsData = await domainsResp.json() as { 'hydra:member': Array<{ domain: string }> }
          const domains = domainsData['hydra:member'] || []
          
          if (domains.length === 0) {
            log(`mail.tm 无可用域名，跳过`)
            break
          }
          
          const email = `${randomUser}@${domains[0].domain}`
          
          // 创建账号
          const createResp = await fetch(service.createUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ address: email, password })
          })
          
          if (!createResp.ok) {
            log(`mail.tm 创建账号失败: ${createResp.status}`)
            break
          }
          
          // 登录获取 token
          const loginResp = await fetch('https://api.mail.tm/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ address: email, password })
          })
          
          if (loginResp.ok) {
            const loginData = await loginResp.json() as { token: string }
            if (loginData.token) {
              log(`✓ 成功获取临时邮箱: ${email}`)
              return { email, token: loginData.token, password }
            }
          }
        }
      } catch (error) {
        log(`${service.name} 第 ${attemptCount} 次申请失败: ${error}`)
      }
      
      // 短暂延迟后继续尝试
      if (attemptCount < service.maxAttempts) {
        await new Promise(r => setTimeout(r, 500))
      }
    }
    
    log(`✗ ${service.name} 尝试了 ${attemptCount} 次，获取的域名: ${Array.from(usedDomains).join(', ')}`)
    log(`  继续尝试下一个服务...`)
  }
  
  log('✗ 所有临时邮箱服务均失败')
  return null
}

/**
 * 获取临时邮箱收件箱中的验证码（支持多个服务）
 */
export async function getTempMailCode(
  token: string,
  email: string,
  log: LogCallback,
  timeout: number = 120
): Promise<string | null> {
  log(`========== 开始等待邮箱 ${email} 收到 AWS 验证码 ==========`)
  
  // 根据邮箱域名判断使用哪个服务
  const emailDomain = email.split('@')[1]?.toLowerCase() || ''
  const is215Im = emailDomain.includes('abrdns') || emailDomain.includes('yyds.dev')
  const isMailTm = emailDomain.includes('mail.tm') || emailDomain.endsWith('.tm')
  const is1SecMail = emailDomain.includes('1secmail') || emailDomain.includes('esiix') || emailDomain.includes('wwjmp') || emailDomain.includes('icznn')
  const isTempMailPlus = emailDomain.includes('tempmail.plus') || emailDomain.includes('tmpbox')
  const isGuerrillaMail = emailDomain.includes('guerrillamail') || emailDomain.includes('grr.la') || emailDomain.includes('sharklasers')
  
  let serviceName = 'tempmail.lol'
  if (is215Im) serviceName = '215.im'
  else if (isMailTm) serviceName = 'mail.tm'
  else if (is1SecMail) serviceName = '1secmail.com'
  else if (isTempMailPlus) serviceName = 'tempmail.plus'
  else if (isGuerrillaMail) serviceName = 'guerrillamail.com'
  
  log(`[DEBUG] 邮箱域名: ${emailDomain}, 使用服务: ${serviceName}`)
  
  const startTime = Date.now()
  const checkInterval = 3000
  const seenIds = new Set<string>()
  
  while (Date.now() - startTime < timeout * 1000) {
    try {
      let messages: Array<{ from: string; subject: string; body?: string; html?: string; text?: string }> = []
      
      if (serviceName === '215.im') {
        // 215.im (YYDS Mail) API
        const url = `https://maliapi.215.im/v1/messages?address=${encodeURIComponent(email)}`
        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as { success: boolean; data?: { messages: Array<{ id: string; from: { address: string }; subject: string; text?: string; html?: string[] }> } }
          if (data.success && data.data && data.data.messages) {
            // 获取每个邮件的详细内容
            for (const msg of data.data.messages) {
              try {
                // 获取邮件详情
                const detailResp = await fetch(`https://maliapi.215.im/v1/messages/${msg.id}`, {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                  }
                })
                
                if (detailResp.ok) {
                  const detailData = await detailResp.json() as { success: boolean; data?: { text?: string; html?: string[] } }
                  if (detailData.success && detailData.data) {
                    messages.push({
                      from: msg.from.address,
                      subject: msg.subject,
                      body: detailData.data.text || '',
                      html: Array.isArray(detailData.data.html) ? detailData.data.html.join('') : detailData.data.html
                    })
                  }
                } else {
                  // 如果获取详情失败，使用列表中的数据
                  messages.push({
                    from: msg.from.address,
                    subject: msg.subject,
                    body: msg.text || '',
                    html: Array.isArray(msg.html) ? msg.html.join('') : msg.html
                  })
                }
              } catch (e) {
                log(`获取邮件 ${msg.id} 详情失败: ${e}`)
              }
            }
          }
        }
      } else if (serviceName === 'mail.tm') {
        // mail.tm API
        const resp = await fetch('https://api.mail.tm/messages', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as { 'hydra:member': Array<{ id: string; from: { address: string }; subject: string; intro: string }> }
          messages = (data['hydra:member'] || []).map(msg => ({
            from: msg.from.address,
            subject: msg.subject,
            body: msg.intro,
            html: msg.intro
          }))
        }
      } else if (serviceName === '1secmail.com') {
        // 1secmail.com API
        const [login, domain] = email.split('@')
        const url = `https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as Array<{ id: number; from: string; subject: string; date: string }>
          for (const msg of data || []) {
            // 获取邮件详情
            const detailResp = await fetch(`https://www.1secmail.com/api/v1/?action=readMessage&login=${login}&domain=${domain}&id=${msg.id}`)
            if (detailResp.ok) {
              const detail = await detailResp.json() as { body: string; htmlBody: string; textBody: string }
              messages.push({
                from: msg.from,
                subject: msg.subject,
                body: detail.textBody || detail.body,
                html: detail.htmlBody
              })
            }
          }
        }
      } else if (serviceName === 'tempmail.plus') {
        // tempmail.plus API
        const url = `https://tempmail.plus/api/mails/${email}`
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as { mails: Array<{ from: string; subject: string; body: string; html: string }> }
          messages = (data.mails || []).map(msg => ({
            from: msg.from,
            subject: msg.subject,
            body: msg.body,
            html: msg.html
          }))
        }
      } else if (serviceName === 'guerrillamail.com') {
        // guerrillamail.com API
        const url = `https://api.guerrillamail.com/ajax.php?f=get_email_list&sid_token=${token}`
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as { list: Array<{ mail_id: string; mail_from: string; mail_subject: string; mail_excerpt: string }> }
          for (const msg of data.list || []) {
            // 获取邮件详情
            const detailResp = await fetch(`https://api.guerrillamail.com/ajax.php?f=fetch_email&sid_token=${token}&email_id=${msg.mail_id}`)
            if (detailResp.ok) {
              const detail = await detailResp.json() as { mail_body: string }
              messages.push({
                from: msg.mail_from,
                subject: msg.mail_subject,
                body: detail.mail_body,
                html: detail.mail_body
              })
            }
          }
        }
      } else {
        // tempmail.lol API
        const url = `https://api.tempmail.lol/v2/inbox?token=${token}`
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        })
        
        if (resp.ok) {
          const data = await resp.json() as { emails: Array<{ from: string; subject: string; body: string; html: string }> }
          messages = data.emails || []
        }
      }
      
      if (!messages || messages.length === 0) {
        await new Promise(r => setTimeout(r, checkInterval))
        continue
      }
      
      for (const msg of messages) {
        const content = `${msg.body || ''}\n${msg.html || ''}\n${msg.text || ''}`
        // 简单计算 hash （可以用 subject + body 长度）
        const msgHash = `${msg.subject?.substring(0,20)}_${content.length}`
        
        if (seenIds.has(msgHash)) continue
        seenIds.add(msgHash)
        
        const sender = (msg.from || '').toLowerCase()
        const subject = (msg.subject || '').toLowerCase()
        
        // 过滤 AWS 邮件
        const isAwsSender = AWS_SENDERS.some(s => sender.includes(s.toLowerCase()))
        if (!isAwsSender && !subject.includes('aws') && !subject.includes('amazon') && !content.includes('aws')) {
          continue
        }
        
        log(`\n=== 收到新邮件 ===`)
        log(`  发件人: ${sender}`)
        log(`  主题: ${subject}`)
        
        // 提取验证码
        const bodyText = htmlToText(msg.html || '') || msg.body || ''
        let code = extractCode(subject) || extractCode(bodyText) || extractCode(content)
        
        if (code) {
          log(`\n========== 找到验证码: ${code} ==========`)
          return code
        }
      }
    } catch (error) {
       // 忽略错误，继续轮询
    }
    
    await new Promise(r => setTimeout(r, checkInterval))
  }
  
  log('✗ 获取验证码超时')
  return null
}

/**
 * 等待输入框出现并输入内容
 */
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
    await page.waitForTimeout(500)
    await element.clear()
    await element.fill(value)
    log(`✓ 已输入${description}: ${value}`)
    return true
  } catch (error) {
    log(`✗ ${description}操作失败: ${error}`)
    await takeScreenshot(page, log, `error_${description.replace(/\s+/g, '_')}`)
    await dumpPageHtml(page, log, `error_${description.replace(/\s+/g, '_')}`)
    return false
  }
}

/**
 * 尝试多个选择器点击
 */
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

/**
 * 检测 AWS 错误弹窗并重试点击按钮
 * 错误弹窗选择器: div.awsui_content_mx3cw_97dyn_391 包含 "抱歉，处理您的请求时出错"
 */
async function checkAndRetryOnError(
  page: Page,
  buttonSelector: string,
  log: LogCallback,
  description: string,
  maxRetries: number = 5,
  retryDelay: number = 3000
): Promise<boolean> {
  // 错误弹窗的多种可能选择器
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
  
  // 关闭按钮选择器
  const closeButtonSelectors = [
    'button[aria-label="关闭"]',
    'button[aria-label="Close"]',
    'button.awsui_dismiss-button',
    '[class*="awsui_dismiss"]'
  ]
  
  for (let retry = 0; retry < maxRetries; retry++) {
    // 等待一下让页面响应
    await page.waitForTimeout(2000)
    
    // 检查是否有错误弹窗
    let hasError = false
    
    for (const selector of errorSelectors) {
      try {
        const errorElements = await page.locator(selector).all()
        for (const el of errorElements) {
          const text = await el.textContent()
          if (text && errorTexts.some(errText => text.includes(errText))) {
            hasError = true
            log(`⚠ 检测到错误弹窗: "${text.substring(0, 80)}..."`)
            await takeScreenshot(page, log, `error_dialog_${description.replace(/\s+/g, '_')}`)
            await dumpPageHtml(page, log, `error_dialog_${description.replace(/\s+/g, '_')}`)
            break
          }
        }
        if (hasError) break
      } catch {
        continue
      }
    }
    
    if (!hasError) {
      // 没有错误，操作成功
      return true
    }
    
    if (retry < maxRetries - 1) {
      // 尝试关闭错误弹窗
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
      
      // 重新点击按钮
      try {
        const button = page.locator(buttonSelector).first()
        await button.waitFor({ state: 'visible', timeout: 5000 })
        await button.click()
        log(`✓ 已重新点击${description}`)
      } catch (e) {
        log(`✗ 重新点击${description}失败: ${e}`)
      }
    }
  }
  
  log(`✗ ${description}多次重试后仍然失败`)
  return false
}

/**
 * 等待按钮出现并点击，带错误检测和自动重试
 */
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
    await page.waitForTimeout(500)
    await element.click()
    log(`✓ 已点击${description}`)
    
    // 检查是否有错误弹窗，如果有则重试
    const success = await checkAndRetryOnError(page, selector, log, description, maxRetries)
    return success
  } catch (error) {
    log(`✗ 点击${description}失败: ${error}`)
    return false
  }
}

/**
 * Outlook 邮箱激活
 * 在 AWS 注册之前激活 Outlook 邮箱，确保能正常接收验证码
 */
export async function activateOutlook(
  email: string,
  emailPassword: string,
  log: LogCallback,
  incognitoMode: boolean = true
): Promise<{ success: boolean; error?: string }> {
  const activationUrl = 'https://go.microsoft.com/fwlink/p/?linkid=2125442'
  let browser: Browser | null = null
  
  log('========== 开始激活 Outlook 邮箱 ==========')
  log(`无痕模式: ${incognitoMode ? '已启用' : '已禁用'}`)
  log(`邮箱: ${email}`)
  
  try {
    // 启动浏览器（无头模式 - 完全隐藏）
    log(`\n步骤1: 启动浏览器${incognitoMode ? '（无痕模式）' : ''}（后台运行），访问 Outlook 激活页面...`)
    
    // 无痕模式：使用临时用户数据目录
    const launchOptions: any = {
      headless: true,  // 无头模式 - 完全隐藏浏览器界面
      args: ['--disable-blink-features=AutomationControlled']
    }
    
    // 如果启用无痕模式，不设置用户数据目录（使用临时目录）
    if (!incognitoMode) {
      // 正常模式可以保留数据
      launchOptions.args.push('--disable-session-crashed-bubble')
    }
    
    browser = await chromium.launch(launchOptions)
    
    const contextOptions: any = {
      viewport: { width: 1400, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    // 无痕模式配置
    if (incognitoMode) {
      contextOptions.acceptDownloads = false
      contextOptions.ignoreHTTPSErrors = false
      // 不设置 storageState，每次都是全新的上下文
    }
    
    const context = await browser.newContext(contextOptions)
    
    const page = await context.newPage()
    
    await page.goto(activationUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log(`✓ 页面加载完成${incognitoMode ? '（无痕模式）' : ''}`)
    await page.waitForTimeout(2000)
    
    // 步骤2: 等待邮箱输入框出现并输入邮箱
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
    
    // 步骤3: 点击第一个下一步按钮
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
    
    // 步骤4: 等待密码输入框出现并输入密码
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
    
    // 步骤5: 点击第二个下一步/登录按钮
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
    
    // 步骤6: 等待第一个"暂时跳过"链接并点击
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
    
    // 步骤7: 等待第二个"暂时跳过"链接并点击
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
    
    // 步骤8: 等待"取消"按钮（密钥创建对话框）并点击
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
    
    // 步骤9: 等待"是"按钮（保持登录状态）并点击
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
    
    // 步骤10: 等待 Outlook 邮箱加载完成
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
      // 检查是否已经在收件箱页面
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

/**
 * AWS Builder ID 自动注册
 * @param email 邮箱地址
 * @param refreshToken OAuth2 刷新令牌
 * @param clientId Graph API 客户端ID
 * @param log 日志回调
 * @param emailPassword 邮箱密码（用于 Outlook 激活）
 * @param skipOutlookActivation 是否跳过 Outlook 激活
 * @param proxyUrl 代理地址（仅用于 AWS 注册，不用于 Outlook 激活和获取验证码）
 * @param incognitoMode 是否使用无痕模式
 * @param useTempMail 是否使用 tempmail.lol 注册账号（如果为 true，忽略传入的 email/password）
 * @param useFingerprint 是否使用指纹浏览器（默认 true）
 * @param fingerprintProfile 指纹配置（如果不提供则自动生成）
 */
export async function autoRegisterAWS(
  email: string | undefined, // 修改为可能为空
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
  fingerprintProfile?: any
): Promise<{ success: boolean; ssoToken?: string; name?: string; error?: string; email?: string; password?: string }> {
  // 如果使用 TempMail，先获取临时邮箱
  let tempMailToken = ''
  if (useTempMail) {
    const tempResult = await createTempMail(log)
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
  // 如果是 Outlook 邮箱且提供了密码，先激活（不使用代理）
  if (!skipOutlookActivation && email.toLowerCase().includes('outlook') && emailPassword) {
    log('检测到 Outlook 邮箱，先进行激活（不使用代理）...')
    const activationResult = await activateOutlook(email, emailPassword, log)
    if (!activationResult.success) {
      log(`⚠ Outlook 激活可能未完成: ${activationResult.error}`)
      log('继续尝试 AWS 注册...')
    } else {
      log('Outlook 激活成功，开始 AWS 注册...')
    }
    // 等待一下再继续
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
  
  // 生成或使用指纹配置
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
    // 步骤1: 创建浏览器，进入注册页面（使用代理和指纹）
    log(`\n步骤1: 启动浏览器${incognitoMode ? '（无痕模式）' : ''}${useFingerprint ? '（应用指纹）' : ''}（后台运行），进入注册页面...`)
    
    // 无痕模式：使用临时用户数据目录
    const launchOptions: any = {
      headless: true,  // 无头模式 - 完全隐藏浏览器界面
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
      args: ['--disable-blink-features=AutomationControlled']
    }
    
    // 如果启用无痕模式，不设置用户数据目录（使用临时目录）
    if (!incognitoMode) {
      // 正常模式可以保留数据
      launchOptions.args.push('--disable-session-crashed-bubble')
    }
    
    log(`[DEBUG] 正在启动 Playwright Chromium...`)
    browser = await chromium.launch(launchOptions)
    log(`[DEBUG] ✓ Playwright Chromium 已启动！`)
    
    // 使用固定的窗口尺寸，确保所有按钮都可见
    // 设置较大的viewport以避免Cookie弹窗遮挡Continue按钮
    const viewportWidth = 1400
    const viewportHeight = 1000
    
    const contextOptions: any = {
      viewport: { width: viewportWidth, height: viewportHeight },
      userAgent: useFingerprint && profile 
        ? profile.navigator.userAgent 
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      deviceScaleFactor: 1  // 确保设备像素比为 1，避免内容放大
    }
    
    // 应用指纹配置
    if (useFingerprint && profile) {
      contextOptions.locale = profile.navigator.language
      contextOptions.timezoneId = profile.timezone.name
      if (profile.geolocation) {
        contextOptions.geolocation = profile.geolocation
        contextOptions.permissions = ['geolocation']
      }
    }
    
    // 无痕模式配置
    if (incognitoMode) {
      contextOptions.acceptDownloads = false
      contextOptions.ignoreHTTPSErrors = false
      // 不设置 storageState，每次都是全新的上下文
    }
    
    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    
    // 注入高级指纹脚本（在页面加载前）
    if (useFingerprint && profile) {
      log('[指纹] 注入高级指纹脚本...')
      const { FingerprintInjector } = await import('./fingerprint/injector')
      const injector = new FingerprintInjector()
      const injectionCode = injector.generateInjectionCode(profile)
      
      await page.addInitScript(injectionCode)
      log('[指纹] ✓ 指纹脚本已注入')
    }
    
    // 使用传入的 verificationUri 或默认 URL
    const registerUrl = verificationUri || 'https://view.awsapps.com/start/#/device?user_code=PQCF-FCCN'
    log(`注册 URL: ${registerUrl}`)
    if (userCode) {
      log(`User Code: ${userCode}`)
    }
    await page.goto(registerUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log(`✓ 页面加载完成${incognitoMode ? '（无痕模式）' : ''}${useFingerprint ? '（指纹已应用）' : ''}`)
    await page.waitForTimeout(2000)
    
    await takeScreenshot(page, log, 'step1_page_loaded')
    
    // 等待邮箱输入框出现并输入邮箱
    // 选择器: input[placeholder="username@example.com"]
    const emailInputSelector = 'input[placeholder="username@example.com"]'
    if (!await waitAndFill(page, emailInputSelector, email, log, '邮箱输入框')) {
      throw new Error('未找到邮箱输入框')
    }
    
    await page.waitForTimeout(1000)
    
    // 点击第一个继续按钮（带错误检测和自动重试）
    // 选择器: button[data-testid="test-primary-button"]
    const firstContinueSelector = 'button[data-testid="test-primary-button"]'
    if (!await waitAndClickWithRetry(page, firstContinueSelector, log, '第一个继续按钮')) {
      throw new Error('点击第一个继续按钮失败')
    }
    
    await page.waitForTimeout(3000)
    
    // 检测是否是已注册账号（登录页面或验证页面）
    // 登录页面标识1: span 包含 "Sign in with your AWS Builder ID"
    // 登录页面标识2: 页面包含 "verify" 字样且有验证码输入框
    const loginHeadingSelector = 'span[class*="awsui_heading-text"]:has-text("Sign in with your AWS Builder ID")'
    const verifyHeadingSelector = 'span[class*="awsui_heading-text"]:has-text("Verify")'
    const verifyCodeInputSelector = 'input[placeholder="6-digit"]'
    const nameInputSelector = 'input[placeholder="Maria José Silva"]'
    
    let isLoginFlow = false
    let isVerifyFlow = false  // 直接进入验证码步骤的登录流程
    
    try {
      // 同时检测登录页面、验证页面和注册页面的元素
      const loginHeading = page.locator(loginHeadingSelector).first()
      const verifyHeading = page.locator(verifyHeadingSelector).first()
      const verifyCodeInput = page.locator(verifyCodeInputSelector).first()
      const nameInput = page.locator(nameInputSelector).first()
      
      // 等待其中一个元素出现
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
      // 如果都没找到，尝试单独检测
      try {
        await page.locator(loginHeadingSelector).first().waitFor({ state: 'visible', timeout: 3000 })
        isLoginFlow = true
      } catch {
        try {
          // 检测 verify 标题或验证码输入框
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
      // ========== 登录流程（邮箱已注册）==========
      if (isVerifyFlow) {
        log('\n⚠ 检测到验证页面，邮箱已注册，直接进入验证码步骤...')
      } else {
        log('\n⚠ 检测到邮箱已注册，切换到登录流程...')
      }
      
      // 如果不是直接验证流程，需要先输入密码
      if (!isVerifyFlow) {
        // 步骤2(登录): 输入密码
        log('\n步骤2(登录): 输入密码...')
        const loginPasswordSelector = 'input[placeholder="Enter password"]'
        if (!await waitAndFill(page, loginPasswordSelector, password, log, '登录密码输入框')) {
          throw new Error('未找到登录密码输入框')
        }
        
        await page.waitForTimeout(1000)
        
        // 点击继续按钮
        const loginContinueSelector = 'button[data-testid="test-primary-button"]'
        if (!await waitAndClickWithRetry(page, loginContinueSelector, log, '登录继续按钮')) {
          throw new Error('点击登录继续按钮失败')
        }
        
        await page.waitForTimeout(3000)
      }
      
      // 步骤3(登录): 等待验证码输入框出现，获取并输入验证码
      log('\n步骤3(登录): 获取并输入验证码...')
      // 登录验证码输入框选择器（支持多种 placeholder）
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
      
      // 自动获取验证码
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
      
      // 输入验证码
      if (!await waitAndFill(page, loginCodeInput, loginVerificationCode, log, '登录验证码')) {
        throw new Error('输入登录验证码失败')
      }
      
      await page.waitForTimeout(1000)
      
      // 点击验证码确认按钮
      const loginVerifySelector = 'button[data-testid="test-primary-button"]'
      if (!await waitAndClickWithRetry(page, loginVerifySelector, log, '登录验证码确认按钮')) {
        throw new Error('点击登录验证码确认按钮失败')
      }
      
      await page.waitForTimeout(5000)
      
    } else {
      // ========== 注册流程（新账号）==========
      // 步骤2: 等待姓名输入框出现，输入姓名
      log('\n步骤2: 输入姓名...')
      if (!await waitAndFill(page, nameInputSelector, randomName, log, '姓名输入框')) {
        throw new Error('未找到姓名输入框')
      }
      
      await page.waitForTimeout(1000)
      await takeScreenshot(page, log, 'step2_after_name_input')
      
      // 点击第二个继续按钮（带错误检测和自动重试）
      // 选择器：button[data-testid="signup-next-button"]
      const secondContinueSelector = 'button[data-testid="signup-next-button"]'
      if (!await waitAndClickWithRetry(page, secondContinueSelector, log, '第二个继续按钮')) {
        throw new Error('点击第二个继续按钮失败')
      }
      
      await page.waitForTimeout(3000)
      
      // 验证步骤2是否真正成功：检查是否出现了验证码输入框
      log('验证步骤2是否成功：检查验证码输入框是否出现...')
      let codePageAppeared = false
      const maxNameRetries = 10
      
      for (let retry = 0; retry < maxNameRetries; retry++) {
        try {
          const codeInput = page.locator('input[placeholder="6-digit"]').first()
          const isVisible = await codeInput.isVisible({ timeout: 5000 })
          if (isVisible) {
            log(`✓ 验证码页面已出现（第${retry + 1}次检查）`)
            codePageAppeared = true
            break
          }
        } catch {
          // 忽略
        }
        
        if (!codePageAppeared) {
          // 检查是否有错误弹窗
          const errorVisible = await page.locator('div[class*="awsui_content_"]').first().isVisible({ timeout: 2000 }).catch(() => false)
          if (errorVisible) {
            log(`⚠ 检测到错误弹窗（第${retry + 1}/${maxNameRetries}次），等待后重试...`)
            await takeScreenshot(page, log, `name_step_retry_${retry + 1}`)
            
            // 尝试关闭错误弹窗
            const closeBtn = page.locator('button[aria-label="关闭"], button[aria-label="Close"]').first()
            if (await closeBtn.isVisible({ timeout: 2000 })) {
              await closeBtn.click()
              log('✓ 已关闭错误弹窗')
            }
            
            // 重新点击继续按钮
            log(`重新点击继续按钮（第${retry + 1}/${maxNameRetries}次）...`)
            await waitAndClickWithRetry(page, secondContinueSelector, log, '第二个继续按钮（重试）', 10000, 1)
            
            await page.waitForTimeout(5000)
          } else {
            log(`等待验证码框出现...（第${retry + 1}/${maxNameRetries}次）`)
            await page.waitForTimeout(3000)
          }
        }
      }
      
      if (!codePageAppeared) {
        log('✗ 多次重试后验证码输入框仍未出现，可能卡在了姓名步骤')
        await takeScreenshot(page, log, 'stuck_at_name')
        await dumpPageHtml(page, log, 'stuck_at_name')
        throw new Error('姓名提交失败，无法进入验证码步骤（可能被 AWS 反检测拦截）')
      }
      
      // 步骤3: 等待验证码输入框出现，获取并输入验证码
      log('\n步骤3: 获取并输入验证码...')
      await takeScreenshot(page, log, 'step3_before_code_input')
      // 选择器: 支持多种 placeholder（英文和中文）
      const codeInputSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]
      
      // 先等待验证码输入框出现
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
      
      // 自动获取验证码
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
      
      // 输入验证码
      if (!await waitAndFill(page, codeInputSelector, verificationCode, log, '验证码')) {
        throw new Error('输入验证码失败')
      }
      
      await page.waitForTimeout(1000)
      
      // 先处理 Cookie 弹窗（如果存在）
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
          // 没有找到或不可见，继续
        }
      }
      
      // 点击 Continue 按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="email-verification-verify-button"]
      const verifyButtonSelector = 'button[data-testid="email-verification-verify-button"]'
      if (!await waitAndClickWithRetry(page, verifyButtonSelector, log, 'Continue 按钮')) {
        throw new Error('点击 Continue 按钮失败')
      }
      
      await page.waitForTimeout(3000)
      
      // 验证步骤3是否真正成功：检查是否出现了密码输入框
      // 如果没出现，说明被 AWS 反检测拦截了，需要重试
      log('验证步骤是否成功：检查密码输入框是否出现...')
      let passwordPageAppeared = false
      const maxVerificationRetries = 10
      
      for (let retry = 0; retry < maxVerificationRetries; retry++) {
        try {
          const passwordInput = page.locator('input[placeholder="Enter password"]').first()
          const isVisible = await passwordInput.isVisible({ timeout: 5000 })
          if (isVisible) {
            log(`✓ 密码页面已出现（第${retry + 1}次检查）`)
            passwordPageAppeared = true
            break
          }
        } catch {
          // 忽略
        }
        
        if (!passwordPageAppeared) {
          // 检查是否有错误弹窗
          const errorVisible = await page.locator('div[class*="awsui_content_"]').first().isVisible({ timeout: 2000 }).catch(() => false)
          if (errorVisible) {
            log(`⚠ 检测到错误弹窗（第${retry + 1}/${maxVerificationRetries}次），等待后重试...`)
            await takeScreenshot(page, log, `verification_retry_${retry + 1}`)
            
            // 尝试关闭错误弹窗
            const closeBtn = page.locator('button[aria-label="关闭"], button[aria-label="Close"]').first()
            if (await closeBtn.isVisible({ timeout: 2000 })) {
              await closeBtn.click()
              log('✓ 已关闭错误弹窗')
            }
            
            // 重新点击 Continue 按钮
            log(`重新点击 Continue 按钮（第${retry + 1}/${maxVerificationRetries}次）...`)
            await waitAndClickWithRetry(page, verifyButtonSelector, log, 'Continue 按钮（重试）', 10000, 1)
            
            await page.waitForTimeout(5000)
          } else {
            log(`等待密码框出现...（第${retry + 1}/${maxVerificationRetries}次）`)
            await page.waitForTimeout(3000)
          }
        }
      }
      
      if (!passwordPageAppeared) {
        log('✗ 多次重试后密码输入框仍未出现，可能卡在了验证码步骤')
        await takeScreenshot(page, log, 'stuck_at_verification')
        await dumpPageHtml(page, log, 'stuck_at_verification')
        throw new Error('验证码提交失败，无法进入密码设置页面（可能被 AWS 反检测拦截）')
      }
      
      // 步骤4: 等待密码输入框出现，输入密码
      log('\n步骤4: 输入密码...')
      await takeScreenshot(page, log, 'step4_before_password')
      // 选择器: input[placeholder="Enter password"]
      const passwordInputSelector = 'input[placeholder="Enter password"]'
      if (!await waitAndFill(page, passwordInputSelector, password, log, '密码输入框')) {
        throw new Error('未找到密码输入框')
      }
      
      await page.waitForTimeout(500)
      
      // 输入确认密码
      // 选择器: input[placeholder="Re-enter password"]
      const confirmPasswordSelector = 'input[placeholder="Re-enter password"]'
      if (!await waitAndFill(page, confirmPasswordSelector, password, log, '确认密码输入框')) {
        throw new Error('未找到确认密码输入框')
      }
      
      await page.waitForTimeout(1000)
      await takeScreenshot(page, log, 'step4_after_password_input')
      
      // 点击第三个继续按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="test-primary-button"]
      const thirdContinueSelector = 'button[data-testid="test-primary-button"]'
      if (!await waitAndClickWithRetry(page, thirdContinueSelector, log, '第三个继续按钮（Confirm）')) {
        throw new Error('点击第三个继续按钮失败')
      }
      
      await page.waitForTimeout(5000)
      await takeScreenshot(page, log, 'step4_after_confirm')
    }
    
    // 步骤5: 等待并点击 "Confirm and continue" 授权按钮（注册和登录流程共用）
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
    
    // 步骤6: 等待并点击 "Allow access" 按钮
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
    await page.waitForTimeout(10000)  // 等待 10 秒让 AWS 完成授权流程
    
    // 步骤7: 等待授权完全完成（不要过早关闭浏览器）
    log('\n步骤7: 等待授权完全完成...')
    
    // 等待页面跳转到成功页面或出现特定元素
    // AWS 授权成功后通常会跳转到 view.awsapps.com/start 或显示成功消息
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
      // 检查是否有成功指示器
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
      
      // 检查 URL 是否包含成功标识
      const currentUrl = page.url()
      if (currentUrl.includes('/start') && !currentUrl.includes('/device') && !currentUrl.includes('/signup')) {
        log(`✓ 页面已跳转到成功页面: ${currentUrl}`)
        authCompleted = true
        break
      }
      
      // 检查是否有 SSO cookie
      const cookies = await context.cookies()
      const ssoCookie = cookies.find(c => c.name === 'x-amz-sso_authn')
      if (ssoCookie) {
        if (!ssoTokenFound) {
          log(`✓ 检测到 SSO Cookie，继续等待授权完全完成...`)
          ssoTokenFound = true
        }
        waitAfterCookie++
        
        // 在检测到 cookie 后再等待至少 15 秒，确保授权完全完成
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
    
    // 获取 SSO Token
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
          const pages = await browser.pages()
          page = pages[0] || null
        } catch {}
        if (page) {
          await takeScreenshot(page, log, 'final_error')
          await dumpPageHtml(page, log, 'final_error')
        } else {
          log('无法获取页面截图（浏览器可能未正确初始化）')
        }
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
    options.fingerprintProfile
  )
}
