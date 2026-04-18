import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createInterface } from 'node:readline'
import { exec, spawn, execSync } from 'node:child_process'
import { promisify } from 'node:util'

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

const execAsync = promisify(exec)

type BuilderIdTemplateItem = {
  email?: string
  password?: string
  refreshToken: string
  clientId: string
  clientSecret: string
  provider?: 'BuilderId'
}

type SwitchState = {
  nextIndex: number
}

type SwitchOptions = {
  templatePath: string
  region: string
  startUrl: string
  statePath: string
  dryRun: boolean
  index?: number
  autoRestart: boolean
  resetMachineId: boolean
  interactive: boolean
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

function parseArgs(argv: string[]): SwitchOptions {
  const get = (name: string) => {
    const idx = argv.indexOf(name)
    if (idx === -1) return undefined
    return argv[idx + 1]
  }
  const has = (name: string) => argv.includes(name)

  return {
    templatePath: get('--template') ?? 'show/builderid-template.json',
    region: get('--region') ?? 'us-east-1',
    startUrl: get('--startUrl') ?? 'https://view.awsapps.com/start',
    statePath: get('--state') ?? 'show/switch-state.json',
    dryRun: has('--dry-run'),
    index: get('--index') ? Number.parseInt(get('--index')!, 10) : undefined,
    autoRestart: has('--restart') || has('-r'),
    resetMachineId: has('--reset-machine-id') || has('-m'),
    interactive: has('--interactive') || has('-i') || argv.length <= 1
  }
}

async function loadJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as T
}

async function saveJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

async function fileExists(path: string) {
  try {
    await readFile(path, 'utf-8')
    return true
  } catch {
    return false
  }
}

function computeClientIdHash(startUrl: string) {
  return crypto.createHash('sha1').update(JSON.stringify({ startUrl })).digest('hex')
}

async function backupIfExists(path: string) {
  if (!(await fileExists(path))) return
  const backupPath = `${path}.bak.${Date.now()}`
  await copyFile(path, backupPath)
  return backupPath
}

function getOSType(): 'windows' | 'macos' | 'linux' | 'unknown' {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    default:
      return 'unknown'
  }
}

function generateRandomMachineId(): string {
  return crypto.randomUUID().toLowerCase()
}

async function getWindowsMachineId(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid'
    )
    const match = stdout.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)
    return match?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

async function setWindowsMachineId(newMachineId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execAsync(
      `reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid /t REG_SZ /d "${newMachineId}" /f`
    )
    return { success: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : ''
    if (errorMsg.includes('Access is denied') || errorMsg.includes('拒绝访问')) {
      return { success: false, error: '没权限还敢玩这个？右键管理员运行懂不懂？' }
    }
    return { success: false, error: errorMsg || '改个机器码都能失败，你也是个人才' }
  }
}

async function getCurrentMachineId(): Promise<string | null> {
  const osType = getOSType()
  if (osType !== 'windows') {
    return null
  }
  return getWindowsMachineId()
}

async function resetMachineId(): Promise<boolean> {
  const osType = getOSType()
  if (osType !== 'windows') {
    log('yellow', '兄弟，机器码重置只支持 Windows，别为难我了')
    return false
  }

  const currentId = await getWindowsMachineId()
  if (currentId) {
    log('dim', `当前机器码: ${currentId} (马上就不是它了)`)
  }

  const newId = generateRandomMachineId()
  log('cyan', `新机器码: ${newId} (看起来是不是很专业？)`)

  const result = await setWindowsMachineId(newId)
  if (result.success) {
    log('green', '✓ 恭喜，你的电脑现在是"新"的了，AWS 再也认不出你了')
    return true
  } else {
    log('red', `✗ ${result.error}`)
    return false
  }
}

async function findKiroProcess(): Promise<{ pid: number; name: string } | null> {
  const osType = getOSType()

  try {
    if (osType === 'windows') {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-Process | Where-Object {$_.ProcessName -like \'*kiro*\'} | Select-Object Id,ProcessName | ConvertTo-Json"'
      )
      const trimmed = stdout.trim()
      if (!trimmed || trimmed === 'null' || trimmed === '') return null

      let processes: { Id: number; ProcessName: string }[] | { Id: number; ProcessName: string }
      try {
        processes = JSON.parse(trimmed)
      } catch {
        return null
      }

      if (!Array.isArray(processes)) {
        processes = [processes]
      }

      if (processes.length > 0) {
        return { pid: processes[0].Id, name: processes[0].ProcessName }
      }
    } else {
      const { stdout } = await execAsync('pgrep -f -i kiro || true')
      const pid = parseInt(stdout.trim(), 10)
      if (pid > 0) {
        return { pid, name: 'kiro' }
      }
    }
  } catch {
    return null
  }

  return null
}

async function killKiroProcess(): Promise<boolean> {
  const proc = await findKiroProcess()
  if (!proc) {
    log('yellow', 'Kiro 根本没在跑，你想杀空气吗？')
    return true
  }

  log('cyan', `正在送走 Kiro 进程 (PID: ${proc.pid})，一路走好...`)

  try {
    const osType = getOSType()
    if (osType === 'windows') {
      await execAsync(`taskkill /PID ${proc.pid} /F`)
    } else {
      await execAsync(`kill -9 ${proc.pid}`)
    }
    log('green', '✓ Kiro 已经安详地离去了')
    return true
  } catch (error) {
    log('red', `✗ 连杀个进程都失败: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function startKiro(): Promise<boolean> {
  const osType = getOSType()
  let kiroPath: string | undefined

  if (osType === 'windows') {
    const possiblePaths = [
      join(os.homedir(), 'AppData', 'Local', 'Programs', 'Kiro', 'Kiro.exe'),
      join(os.homedir(), 'AppData', 'Local', 'Kiro', 'Kiro.exe'),
      'C:\\Program Files\\Kiro\\Kiro.exe',
      'C:\\Program Files (x86)\\Kiro\\Kiro.exe'
    ]

    for (const p of possiblePaths) {
      if (await fileExists(p)) {
        kiroPath = p
        break
      }
    }

    if (!kiroPath) {
      try {
        const { stdout } = await execAsync('where kiro 2>nul || echo ""')
        const found = stdout.trim()
        if (found && found !== '') {
          kiroPath = found.split('\n')[0].trim()
        }
      } catch {}
    }
  } else if (osType === 'macos') {
    const possiblePaths = [
      '/Applications/Kiro.app/Contents/MacOS/Kiro',
      join(os.homedir(), 'Applications', 'Kiro.app', 'Contents', 'MacOS', 'Kiro')
    ]

    for (const p of possiblePaths) {
      if (await fileExists(p)) {
        kiroPath = p
        break
      }
    }
  } else {
    try {
      const { stdout } = await execAsync('which kiro 2>/dev/null || echo ""')
      const found = stdout.trim()
      if (found && found !== '') {
        kiroPath = found
      }
    } catch {}
  }

  if (!kiroPath) {
    log('yellow', '找不到 Kiro 装哪了，你自己手动开吧，我累了')
    return false
  }

  log('cyan', `正在召唤 Kiro: ${kiroPath}`)

  try {
    if (osType === 'windows') {
      spawn('cmd', ['/c', 'start', '', kiroPath], { detached: true, stdio: 'ignore' })
    } else {
      spawn(kiroPath, [], { detached: true, stdio: 'ignore' })
    }
    log('green', '✓ Kiro 已被召唤，请稍等它慢慢启动')
    return true
  } catch (error) {
    log('red', `✓ 启动失败: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function restartKiro(): Promise<boolean> {
  log('cyan', '正在重启 Kiro (给它来个复活甲)...')
  const killed = await killKiroProcess()
  if (!killed) return false

  await new Promise((resolve) => setTimeout(resolve, 1000))

  return startKiro()
}

async function switchAccount(options: SwitchOptions): Promise<{ success: boolean; nextIndex?: number }> {
  const templateAbs = resolve(options.templatePath)
  const stateAbs = resolve(options.statePath)

  if (!(await fileExists(templateAbs))) {
    log('red', `模板文件呢？被你吃了吗？ ${templateAbs}`)
    return { success: false }
  }

  const items = await loadJson<BuilderIdTemplateItem[]>(templateAbs)
  if (!Array.isArray(items) || items.length === 0) {
    log('red', `模板文件是空的，你存了个寂寞？ ${templateAbs}`)
    return { success: false }
  }

  const state: SwitchState = (await fileExists(stateAbs))
    ? await loadJson<SwitchState>(stateAbs)
    : { nextIndex: 0 }

  const pickIndex =
    typeof options.index === 'number' && Number.isFinite(options.index)
      ? Math.max(0, Math.min(items.length - 1, options.index))
      : state.nextIndex % items.length

  const item = items[pickIndex]
  if (!item?.refreshToken?.startsWith('aor')) {
    log('red', `这个账号的 refreshToken 有问题，不是以 "aor" 开头的，你是怎么存进来的？`)
    return { success: false }
  }
  if (!item.clientId || !item.clientSecret) {
    log('red', `clientId 或 clientSecret 呢？账号数据不完整啊`)
    return { success: false }
  }

  log('bright', '\n>>> 开始切换账号 <<<')
  log('dim', `模板位置: ${templateAbs}`)
  log('cyan', `第 ${pickIndex + 1} 个账号 / 共 ${items.length} 个`)
  if (item.email) {
    log('dim', `邮箱: ${item.email}`)
  }

  const ssoCache = join(os.homedir(), '.aws', 'sso', 'cache')
  const tokenPath = join(ssoCache, 'kiro-auth-token.json')
  const clientIdHash = computeClientIdHash(options.startUrl)
  const clientRegPath = join(ssoCache, `${clientIdHash}.json`)

  const tokenData = {
    accessToken: '',
    refreshToken: item.refreshToken,
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    clientIdHash,
    authMethod: 'IdC',
    provider: 'BuilderId',
    region: options.region
  }

  const clientData = {
    clientId: item.clientId,
    clientSecret: item.clientSecret,
    expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().replace('Z', ''),
    scopes: [
      'codewhisperer:completions',
      'codewhisperer:analysis',
      'codewhisperer:conversations',
      'codewhisperer:transformations',
      'codewhisperer:taskassist'
    ]
  }

  if (!options.dryRun) {
    await mkdir(ssoCache, { recursive: true })
    const b1 = await backupIfExists(tokenPath)
    const b2 = await backupIfExists(clientRegPath)
    if (b1) log('dim', `旧 token 已备份: ${b1}`)
    if (b2) log('dim', `旧 client 已备份: ${b2}`)

    await writeFile(tokenPath, JSON.stringify(tokenData, null, 2), 'utf-8')
    await writeFile(clientRegPath, JSON.stringify(clientData, null, 2), 'utf-8')
  }

  const newState: SwitchState = { nextIndex: (pickIndex + 1) % items.length }
  if (!options.dryRun) {
    await saveJson(stateAbs, newState)
  }

  log('green', `✓ 搞定！下次轮到第 ${newState.nextIndex + 1} 个账号`)

  return { success: true, nextIndex: newState.nextIndex }
}

async function interactiveMode(options: SwitchOptions): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve)
    })
  }

  const showBanner = () => {
    print('')
    log('bright', '╔══════════════════════════════════════════════╗')
    log('bright', '║   🎭 Kiro 账号切换大师 v1.0 - 专业换号工具  ║')
    log('bright', '║        (白嫖 AWS，从我做起)                  ║')
    log('bright', '╚══════════════════════════════════════════════╝')
  }

  let currentOptions = { ...options }
  let running = true

  const showMenu = async () => {
    showBanner()

    const templateAbs = resolve(currentOptions.templatePath)
    const stateAbs = resolve(currentOptions.statePath)

    let accountCount = 0
    let nextIndex = 1
    let kiroStatus = '躺平中'
    let machineId: string | null = null

    if (await fileExists(templateAbs)) {
      try {
        const items = await loadJson<BuilderIdTemplateItem[]>(templateAbs)
        accountCount = items.length
      } catch {}
    }

    if (await fileExists(stateAbs)) {
      try {
        const state = await loadJson<SwitchState>(stateAbs)
        nextIndex = state.nextIndex + 1
      } catch {}
    }

    const proc = await findKiroProcess()
    if (proc) {
      kiroStatus = `正在打工 (PID: ${proc.pid})`
    }

    machineId = await getCurrentMachineId()

    print('')
    log('dim', '┌─ 📊 当前状态 ───────────────────────────────')
    log('dim', `│ 账号库存: ${accountCount} 个  |  下一个出场: 第 ${nextIndex} 个`)
    log('dim', `│ Kiro 状态: ${kiroStatus}`)
    if (machineId) {
      log('dim', `│ 机器码: ${machineId.substring(0, 8)}... (太长了不看了)`)
    }
    log('dim', '└─────────────────────────────────────────────')
    print('')
    log('cyan', '┌─ 🎮 操作菜单 ───────────────────────────────')
    print(COLORS.cyan + '│' + COLORS.reset + '  [1] 换个账号 (手动重启党专用)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [2] 换号 + 重启 Kiro (懒人首选)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [3] 换号 + 重启 + 换机器码 (全套服务)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [4] 看看详细状态 (闲得慌)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [5] 送走 Kiro 进程 (让它休息会)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [6] 召唤 Kiro (把它叫回来)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [7] 重启 Kiro (不换号)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [8] 换个机器码 (假装是新电脑)')
    print(COLORS.cyan + '│' + COLORS.reset + '  [0] 退出 (不玩了)')
    log('cyan', '└─────────────────────────────────────────────')
    print('')
  }

  const showDetailedStatus = async () => {
    const templateAbs = resolve(currentOptions.templatePath)
    const stateAbs = resolve(currentOptions.statePath)

    print('')
    log('cyan', '═══ 📋 详细状态报告 ═══')

    if (await fileExists(templateAbs)) {
      const items = await loadJson<BuilderIdTemplateItem[]>(templateAbs)
      log('dim', `模板文件: ${templateAbs}`)
      log('dim', `账号总数: ${items.length} 个 (够你用一阵子了)`)
    } else {
      log('yellow', `模板文件不存在: ${templateAbs} (你还没注册账号吧？)`)
    }

    if (await fileExists(stateAbs)) {
      const state = await loadJson<SwitchState>(stateAbs)
      log('dim', `下一个索引: 第 ${state.nextIndex + 1} 个`)
    }

    const proc = await findKiroProcess()
    if (proc) {
      log('green', `Kiro 进程: 正在运行 (PID: ${proc.pid})`)
    } else {
      log('yellow', 'Kiro 进程: 没在跑 (你是想让它加班吗？)')
    }

    const machineId = await getCurrentMachineId()
    if (machineId) {
      log('dim', `当前机器码: ${machineId}`)
    }
  }

  await showMenu()

  while (running) {
    const input = await question(COLORS.green + '选个数字 [0-8] > ' + COLORS.reset)
    const cmd = input.trim()

    switch (cmd) {
      case '1':
        await switchAccount(currentOptions)
        log('yellow', '\n提示: 记得手动重启 Kiro，不然白换了')
        break

      case '2':
        currentOptions.autoRestart = true
        await switchAccount(currentOptions)
        await restartKiro()
        break

      case '3':
        currentOptions.autoRestart = true
        currentOptions.resetMachineId = true
        await switchAccount(currentOptions)
        await resetMachineId()
        await restartKiro()
        log('magenta', '\n🎉 全套服务完成！AWS 现在以为你是新用户')
        break

      case '4':
        await showDetailedStatus()
        break

      case '5':
        await killKiroProcess()
        break

      case '6':
        await startKiro()
        break

      case '7':
        await restartKiro()
        break

      case '8':
        await resetMachineId()
        break

      case '0':
      case 'q':
      case 'exit':
      case 'quit':
        running = false
        print('')
        log('green', '👋 拜拜！下次再来白嫖 AWS 哦~')
        break

      default:
        log('yellow', `输入 "${input}" 是几个意思？请输入 0-8`)
        break
    }

    if (running && cmd !== '4') {
      print('')
      await showMenu()
    }
  }

  rl.close()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.interactive) {
    await interactiveMode(args)
    return
  }

  const result = await switchAccount(args)
  if (!result.success) {
    process.exitCode = 1
    return
  }

  if (args.resetMachineId) {
    const resetOk = await resetMachineId()
    if (!resetOk) {
      log('yellow', '机器码重置失败，但账号已经换了，凑合用吧')
    }
  }

  if (args.autoRestart) {
    await restartKiro()
  } else {
    log('yellow', '\n记得手动重启 Kiro，不然新账号不生效哦')
  }
}

main().catch((e) => {
  process.stderr.write(`出大事了: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`)
  process.exitCode = 1
})
