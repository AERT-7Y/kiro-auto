/**
 * Fingerprint Consistency Validator
 * 
 * Validates that fingerprint parameters are logically consistent with each other.
 */

import type { FingerprintProfile, ValidationResult, OSType } from './types'

export class ConsistencyValidator {
  /**
   * Validate fingerprint profile consistency
   */
  validate(profile: FingerprintProfile): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check User Agent vs Platform consistency
    const uaOS = this.extractOSFromUserAgent(profile.navigator.userAgent)
    if (uaOS !== profile.os) {
      errors.push(`User Agent OS (${uaOS}) does not match profile OS (${profile.os})`)
    }

    const platformOS = this.extractOSFromPlatform(profile.navigator.platform)
    if (platformOS !== profile.os) {
      errors.push(`Platform (${profile.navigator.platform}) does not match profile OS (${profile.os})`)
    }

    // Check OS vs fonts consistency
    if (!this.validateFontsForOS(profile.fonts, profile.os)) {
      warnings.push(`Font list may not be typical for ${profile.os}`)
    }

    // Check screen resolution vs device memory reasonableness
    const totalPixels = profile.screen.width * profile.screen.height
    if (totalPixels > 8294400 && profile.hardware.deviceMemory < 8) {
      // 4K resolution (3840x2160) with less than 8GB RAM
      warnings.push(`High resolution (${profile.screen.width}x${profile.screen.height}) with low memory (${profile.hardware.deviceMemory}GB) is unusual`)
    }

    // Check CPU cores vs device memory ratio
    const coresPerGB = profile.hardware.hardwareConcurrency / profile.hardware.deviceMemory
    if (coresPerGB > 4 || coresPerGB < 0.25) {
      warnings.push(`CPU cores (${profile.hardware.hardwareConcurrency}) to memory (${profile.hardware.deviceMemory}GB) ratio is unusual`)
    }

    // Check WebGL vendor/renderer vs OS compatibility
    if (!this.validateWebGLForOS(profile.webgl.vendor, profile.os)) {
      errors.push(`WebGL vendor (${profile.webgl.vendor}) is not compatible with ${profile.os}`)
    }

    // Check device pixel ratio reasonableness
    if (profile.screen.devicePixelRatio > 3 || profile.screen.devicePixelRatio < 1) {
      warnings.push(`Device pixel ratio (${profile.screen.devicePixelRatio}) is unusual`)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Auto-fix inconsistent parameters
   */
  autoFixInconsistencies(profile: FingerprintProfile): FingerprintProfile {
    const fixed = { ...profile }

    // Fix platform to match OS
    fixed.navigator.platform = this.getPlatformForOS(profile.os)

    // Fix User Agent to match OS
    const uaOS = this.extractOSFromUserAgent(profile.navigator.userAgent)
    if (uaOS !== profile.os) {
      // Extract Chrome version from current UA
      const chromeMatch = profile.navigator.userAgent.match(/Chrome\/([\d.]+)/)
      const chromeVersion = chromeMatch ? chromeMatch[1] : '120.0.0.0'
      fixed.navigator.userAgent = this.generateUserAgentForOS(profile.os, chromeVersion)
    }

    // Fix WebGL vendor to match OS
    if (profile.os === 'macOS' && !profile.webgl.vendor.includes('Apple')) {
      fixed.webgl = {
        vendor: 'Apple Inc.',
        renderer: 'Apple M1',
        unmaskedVendor: 'Apple Inc.',
        unmaskedRenderer: 'Apple M1'
      }
    }

    return fixed
  }

  /**
   * Extract OS from User Agent string
   */
  private extractOSFromUserAgent(userAgent: string): OSType {
    if (userAgent.includes('Windows')) return 'Windows'
    if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS X')) return 'macOS'
    if (userAgent.includes('Linux') || userAgent.includes('X11')) return 'Linux'
    return 'Windows' // Default
  }

  /**
   * Extract OS from platform string
   */
  private extractOSFromPlatform(platform: string): OSType {
    if (platform.includes('Win')) return 'Windows'
    if (platform.includes('Mac')) return 'macOS'
    if (platform.includes('Linux')) return 'Linux'
    return 'Windows' // Default
  }

  /**
   * Get platform string for OS
   */
  private getPlatformForOS(os: OSType): string {
    switch (os) {
      case 'Windows': return 'Win32'
      case 'macOS': return 'MacIntel'
      case 'Linux': return 'Linux x86_64'
    }
  }

  /**
   * Generate User Agent for OS
   */
  private generateUserAgentForOS(os: OSType, chromeVersion: string): string {
    const webkit = '537.36'
    
    switch (os) {
      case 'Windows':
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkit}`
      
      case 'macOS':
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkit}`
      
      case 'Linux':
        return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkit}`
    }
  }

  /**
   * Validate fonts are typical for OS
   */
  private validateFontsForOS(fonts: string[], os: OSType): boolean {
    // Check for OS-specific fonts
    const windowsFonts = ['Segoe UI', 'Calibri', 'Cambria']
    const macFonts = ['Helvetica Neue', 'Avenir', 'San Francisco']
    const linuxFonts = ['Ubuntu', 'DejaVu Sans', 'Liberation Sans']

    switch (os) {
      case 'Windows':
        return windowsFonts.some(f => fonts.includes(f))
      case 'macOS':
        return macFonts.some(f => fonts.includes(f))
      case 'Linux':
        return linuxFonts.some(f => fonts.includes(f))
    }
  }

  /**
   * Validate WebGL vendor is compatible with OS
   */
  private validateWebGLForOS(vendor: string, os: OSType): boolean {
    if (os === 'macOS') {
      // macOS should use Apple GPU or AMD
      return vendor.includes('Apple') || vendor.includes('AMD')
    }
    // Windows and Linux can use any vendor
    return true
  }
}
