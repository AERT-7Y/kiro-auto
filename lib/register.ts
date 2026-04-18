import { chromium, Browser, Page } from 'playwright'

type LogCallback = (message: string) => void

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
  const yydsMailApiKey = process.env.YYDS_MAIL_API_KEY || process.env.MALIAPI_215_API_KEY
  const services = [
    {
      name: '215.im (YYDS Mail)',
      createUrl: 'https://maliapi.215.im/v1/accounts',
      inboxUrl: (_token: string, email: string) => `https://maliapi.215.im/v1/messages?address=${email}`,
      maxAttempts: 10,
      preferredDomain: '0m0.abrdns.com'
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
          if (!yydsMailApiKey) {
            log('  ⚠ 未设置 YYDS_MAIL_API_KEY（或 MALIAPI_215_API_KEY），跳过 215.im 服务')
            break
          }
          
          const randomPrefix = Math.random().toString(36).substring(2, 10)
          const requestBody = {
            address: randomPrefix,
            domain: '0m0.abrdns.com'
          }
          
          log(`  尝试创建邮箱: ${randomPrefix}@0m0.abrdns.com (使用 API Key)`)
          
          const resp = await fetch(service.createUrl, {
            method: 'POST',
            headers: {
              'X-API-Key': yydsMailApiKey,
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
              return { email, token: email, password }
            }
          }
        } else if (service.name === 'tempmail.plus') {
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
          const randomUser = 'user' + Math.random().toString(36).slice(-8)
          const password = Math.random().toString(36).slice(-8) + 'A1!'
          
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

export async function getTempMailCode(
  token: string,
  email: string,
  log: LogCallback,
  timeout: number = 120
): Promise<string | null> {
  log(`========== 开始等待邮箱 ${email} 收到 AWS 验证码 ==========`)
  
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
            for (const msg of data.data.messages) {
              try {
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
        const msgHash = `${msg.subject?.substring(0,20)}_${content.length}`
        
        if (seenIds.has(msgHash)) continue
        seenIds.add(msgHash)
        
        const sender = (msg.from || '').toLowerCase()
        const subject = (msg.subject || '').toLowerCase()
        
        const isAwsSender = AWS_SENDERS.some(s => sender.includes(s.toLowerCase()))
        if (!isAwsSender && !subject.includes('aws') && !subject.includes('amazon') && !content.includes('aws')) {
          continue
        }
        
        log(`\n=== 收到新邮件 ===`)
        log(`  发件人: ${sender}`)
        log(`  主题: ${subject}`)
        
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
      await page.keyboard.type(char)
      await randomDelay(50, 150)
    }
    
    log(`✓ 已输入${description}: ${value}`)
    return true
  } catch (error) {
    log(`✗ ${description}操作失败: ${error}`)
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
    
    await randomDelay(100, 300)
    await element.click()
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
  incognitoMode: boolean = true
): Promise<{ success: boolean; error?: string }> {
  const activationUrl = 'https://go.microsoft.com/fwlink/p/?linkid=2125442'
  let browser: Browser | null = null
  
  log('========== 开始激活 Outlook 邮箱 ==========')
  log(`无痕模式: ${incognitoMode ? '已启用' : '已禁用'}`)
  log(`邮箱: ${email}`)
  
  try {
    log(`\n步骤1: 启动浏览器${incognitoMode ? '（无痕模式）' : ''}（后台运行），访问 Outlook 激活页面...`)
    
    const launchOptions: any = {
      headless: true,
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
  fingerprintProfile?: any
): Promise<{ success: boolean; ssoToken?: string; name?: string; error?: string; email?: string; password?: string }> {
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
  if (!skipOutlookActivation && email.toLowerCase().includes('outlook') && emailPassword) {
    log('检测到 Outlook 邮箱，先进行激活（不使用代理）...')
    const activationResult = await activateOutlook(email, emailPassword, log)
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
    log(`\n步骤1: 启动浏览器${incognitoMode ? '（无痕模式）' : ''}${useFingerprint ? '（应用指纹）' : ''}（后台运行），进入注册页面...`)
    
    const launchOptions: any = {
      headless: true,
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
