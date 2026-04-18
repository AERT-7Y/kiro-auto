import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { execSync } from 'node:child_process'
import { registerAwsBuilderIdTempMail } from '../lib/register'
import { startBuilderIdDeviceLogin, pollBuilderIdDeviceAuth } from '../lib/auth'

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

type CliOptions = {
  count: number
  concurrency: number
  delayMs: number
  proxyUrl?: string
  incognitoMode: boolean
  useFingerprint: boolean
  outputPath: string
  region: string
  emitBuilderIdTemplate: boolean
  templateOutputPath: string
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

function parseArgs(argv: string[]): Partial<CliOptions> {
  const get = (name: string) => {
    const idx = argv.indexOf(name)
    if (idx === -1) return undefined
    return argv[idx + 1]
  }

  const has = (name: string) => argv.includes(name)

  const result: Partial<CliOptions> = {}

  if (has('--count') || has('-n')) {
    result.count = toInt(get('--count') ?? get('-n'), 1)
  }
  if (has('--concurrency') || has('-c')) {
    result.concurrency = toInt(get('--concurrency') ?? get('-c'), 1)
  }
  if (has('--delayMs') || has('--delay') || has('-d')) {
    result.delayMs = toInt(get('--delayMs') ?? get('--delay') ?? get('-d'), 0)
  }
  if (has('--proxyUrl') || has('--proxy')) {
    result.proxyUrl = get('--proxyUrl') ?? get('--proxy')
  }
  if (has('--output')) {
    result.outputPath = get('--output')
  }
  if (has('--region')) {
    result.region = get('--region')
  }
  if (has('--emit-builderid-template') || has('--emit-builderid') || has('--builderid-template')) {
    result.emitBuilderIdTemplate = true
  }
  if (has('--templateOutput')) {
    result.templateOutputPath = get('--templateOutput')
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

  return result
}

async function fileExists(path: string) {
  try {
    await readFile(path, 'utf-8')
    return true
  } catch {
    return false
  }
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
  count: 1,
  concurrency: 1,
  delayMs: 0,
  proxyUrl: undefined,
  incognitoMode: true,
  useFingerprint: true,
  outputPath: 'show/results.json',
  region: 'us-east-1',
  emitBuilderIdTemplate: true,
  templateOutputPath: 'show/builderid-template.json'
}

async function runRegistration(opts: CliOptions): Promise<{ ok: number; fail: number }> {
  const outPathAbs = resolve(opts.outputPath)
  const outDirAbs = resolve(opts.outputPath, '..')
  await mkdir(outDirAbs, { recursive: true })

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

  const templateOutAbs = resolve(opts.templateOutputPath)
  
  const allRecords: Array<{
    email?: string
    password?: string
    name?: string
    refreshToken?: string
    clientId?: string
    clientSecret?: string
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
      log('正在向 AWS 伸手要设备码...')
      const start = await startBuilderIdDeviceLogin(opts.region)
      if (!start.success) {
        throw new Error(start.error)
      }

      log(`拿到 userCode: ${start.userCode}，浏览器启动！自动化走起！`)

      const result = await registerAwsBuilderIdTempMail({
        log,
        proxyUrl: opts.proxyUrl,
        incognitoMode: opts.incognitoMode,
        userCode: start.userCode,
        verificationUri: start.verificationUri,
        useFingerprint: opts.useFingerprint
      })

      let refreshToken: string | undefined
      let clientId: string | undefined
      let clientSecret: string | undefined

      if (opts.emitBuilderIdTemplate && result.success) {
        const endAt = start.expiresAt
        let intervalMs = Math.max(1000, start.interval * 1000)

        log('等 AWS 确认中...（它可能懵了）')
        while (Date.now() < endAt) {
          const poll = await pollBuilderIdDeviceAuth({
            region: opts.region,
            clientId: start.clientId,
            clientSecret: start.clientSecret,
            deviceCode: start.deviceCode
          })

          if (!poll.success) {
            throw new Error(poll.error)
          }

          if (poll.completed) {
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
      }

      allRecords[idx] = {
        email: result.email,
        password: result.password,
        name: result.name,
        refreshToken,
        clientId,
        clientSecret,
        success: result.success,
        error: result.error
      }

      completed++
      if (result.success) {
        log(`✅ 拿下！邮箱: ${result.email}！AWS 又损失一员大将！`)
      } else {
        log(`❌ 翻车了: ${result.error}...AWS 这波防住了`)
      }
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

  const successRecords = allRecords.filter(r => r?.success && r?.refreshToken)

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

  await writeFile(outPathAbs, JSON.stringify(allRecords.filter(Boolean), null, 2), { encoding: 'utf-8' })
  log('green', `\n📁 结果文件已保存: ${outPathAbs}`)

  if (opts.emitBuilderIdTemplate && successRecords.length > 0) {
    const templateDirAbs = resolve(opts.templateOutputPath, '..')
    await mkdir(templateDirAbs, { recursive: true })
    const templateData = successRecords.map(r => ({
      email: r.email,
      password: r.password,
      refreshToken: r.refreshToken,
      clientId: r.clientId,
      clientSecret: r.clientSecret
    }))
    await writeFile(templateOutAbs, JSON.stringify(templateData, null, 2), { encoding: 'utf-8' })
    log('green', `📁 模板文件已保存: ${templateOutAbs}`)
    log('dim', `   (拿去切换工具用，别浪费了！)`)
  }

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
    log('dim', `│ 生成模板: ${currentOptions.emitBuilderIdTemplate ? '✅ 会生成' : '❌ 不生成'}`)
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
    print(COLORS.cyan + '│' + COLORS.reset + '  [7] 切换是否生成模板')
    print(COLORS.cyan + '│' + COLORS.reset + '  [8] 设置代理 (不想被追踪就设一个)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [9] 看看历史战绩')
    print(COLORS.cyan + '│' + COLORS.reset + '  [0] 退出 (不玩了)')
    log('cyan', '└─────────────────────────────────────────────')
    print('')
  }

  const showHistory = async () => {
    const resultPath = resolve(currentOptions.outputPath)
    const templatePath = resolve(currentOptions.templateOutputPath)

    print('')
    log('cyan', '═══ 📊 历史战绩 ═══')

    if (await fileExists(templatePath)) {
      try {
        const raw = await readFile(templatePath, 'utf-8')
        const items = JSON.parse(raw)
        log('green', `✅ 模板文件: ${templatePath}`)
        log('dim', `   已有 ${Array.isArray(items) ? items.length : 0} 个账号躺在这里`)
      } catch {
        log('yellow', `⚠️ 模板文件读不了: ${templatePath}`)
      }
    } else {
      log('yellow', `⚠️ 模板文件不存在: ${templatePath}`)
      log('dim', `   (还没注册过账号吧？)`)
    }

    if (await fileExists(resultPath)) {
      try {
        const raw = await readFile(resultPath, 'utf-8')
        const records = JSON.parse(raw)
        const success = records.filter((r: any) => r.success).length
        const failed = records.filter((r: any) => !r.success).length
        log('dim', `📝 结果文件: ${resultPath}`)
        log('dim', `   总共 ${records.length} 条记录 (成功: ${success}, 失败: ${failed})`)
        if (failed > success) {
          log('yellow', `   (失败率有点高啊，是不是 AWS 发现你了？)`)
        }
      } catch {
        log('yellow', `⚠️ 结果文件读不了: ${resultPath}`)
      }
    } else {
      log('yellow', `⚠️ 结果文件不存在: ${resultPath}`)
    }
  }

  await showMenu()

  while (running) {
    const input = await question(COLORS.green + '选个数字 [0-9] > ' + COLORS.reset)
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
        currentOptions.emitBuilderIdTemplate = !currentOptions.emitBuilderIdTemplate
        if (currentOptions.emitBuilderIdTemplate) {
          log('green', '✓ 会生成模板文件 (方便切换工具使用)')
        } else {
          log('yellow', '⚠️ 不生成模板 (注册了也白注册)')
        }
        break
      }

      case '8': {
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

      case '9': {
        await showHistory()
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
        log('yellow', `输入 "${input}" 是啥意思？请输入 0-9`)
        break
    }

    if (running && cmd !== '9') {
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
