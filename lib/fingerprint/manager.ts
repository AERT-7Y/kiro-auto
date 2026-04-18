/**
 * Embedded Browser Manager
 * 
 * Manages browser creation with fingerprint profiles applied.
 */

import { BrowserView, BrowserWindow, session, app } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { FingerprintGenerator } from './generator'
import { FingerprintInjector } from './injector'
import type { FingerprintProfile } from './types'

export interface Account {
  id: string
  email: string
  fingerprintProfile?: FingerprintProfile
  [key: string]: any
}

export interface BrowserCreationResult {
  view: BrowserView
  profile: FingerprintProfile
  sessionId: string
}

export class EmbeddedBrowserManager {
  private generator: FingerprintGenerator
  private injector: FingerprintInjector

  constructor() {
    this.generator = new FingerprintGenerator()
    this.injector = new FingerprintInjector()
  }

  /**
   * Create browser with fingerprint profile
   */
  async createBrowser(
    account: Account,
    mainWindow: BrowserWindow,
    proxyUrl?: string,
    onProfileUpdate?: (profile: FingerprintProfile) => void
  ): Promise<BrowserCreationResult> {
    // Get or generate fingerprint profile
    let profile = account.fingerprintProfile
    if (!profile) {
      console.log(`[FingerprintManager] Generating new fingerprint for account ${account.email}`)
      profile = this.generator.generate()
      
      // Notify caller to save the profile
      if (onProfileUpdate) {
        onProfileUpdate(profile)
      }
    } else {
      console.log(`[FingerprintManager] Using existing fingerprint for account ${account.email}`)
      
      // Update lastUsedAt
      profile.lastUsedAt = Date.now()
      if (onProfileUpdate) {
        onProfileUpdate(profile)
      }
    }

    // Create isolated session
    const sessionId = `fingerprint-${account.id}-${randomBytes(8).toString('hex')}`
    console.log(`[FingerprintManager] Creating isolated session: ${sessionId}`)
    const ses = session.fromPartition(sessionId, { cache: false })

    // Apply User Agent
    console.log(`[FingerprintManager] Setting User Agent: ${profile.navigator.userAgent}`)
    ses.setUserAgent(profile.navigator.userAgent)

    // Apply proxy if provided
    if (proxyUrl) {
      console.log(`[FingerprintManager] Setting proxy: ${proxyUrl}`)
      await ses.setProxy({ proxyRules: proxyUrl })
    }

    // Generate injection code
    const injectionCode = this.injector.generateInjectionCode(profile)

    // Create preload script
    const preloadPath = await this.createPreloadScript(injectionCode, account.id)
    console.log(`[FingerprintManager] Preload script created: ${preloadPath}`)

    // Create BrowserView
    const view = new BrowserView({
      webPreferences: {
        session: ses,
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        sandbox: true
      }
    })

    // Attach to main window
    mainWindow.setBrowserView(view)

    // Set bounds
    const bounds = mainWindow.getContentBounds()
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    view.setAutoResize({ width: true, height: true })

    console.log(`[FingerprintManager] Browser created successfully for ${account.email}`)

    return {
      view,
      profile,
      sessionId
    }
  }

  /**
   * Create preload script file with injection code
   */
  private async createPreloadScript(injectionCode: string, accountId: string): Promise<string> {
    const userDataPath = app.getPath('userData')
    const preloadDir = join(userDataPath, 'fingerprint-preloads')
    
    // Ensure directory exists
    if (!existsSync(preloadDir)) {
      await mkdir(preloadDir, { recursive: true })
    }

    // Create preload script file
    const preloadPath = join(preloadDir, `preload-${accountId}.js`)
    const preloadContent = `
// Fingerprint injection preload script
${injectionCode}
`

    await writeFile(preloadPath, preloadContent, 'utf-8')
    return preloadPath
  }

  /**
   * Clean up browser resources
   */
  cleanupBrowser(mainWindow: BrowserWindow, view: BrowserView): void {
    try {
      mainWindow.removeBrowserView(view)
      ;(view.webContents as any).destroy()
      console.log('[FingerprintManager] Browser cleaned up')
    } catch (error) {
      console.error('[FingerprintManager] Failed to cleanup browser:', error)
    }
  }
}
