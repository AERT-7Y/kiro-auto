/**
 * Fingerprint Generator
 * 
 * Generates unique, realistic browser fingerprint profiles with proper OS consistency.
 */

import { randomBytes, randomUUID } from 'crypto'
import type {
  FingerprintProfile,
  OSType,
  ScreenFingerprint,
  HardwareFingerprint,
  CanvasFingerprint,
  WebGLFingerprint,
  AudioFingerprint,
  TimezoneFingerprint,
  WebRTCFingerprint,
  NavigatorFingerprint,
  MediaDevicesFingerprint
} from './types'

/**
 * Common timezones with their UTC offsets
 */
const TIMEZONES = [
  { name: 'America/New_York', offset: -300 },
  { name: 'America/Chicago', offset: -360 },
  { name: 'America/Denver', offset: -420 },
  { name: 'America/Los_Angeles', offset: -480 },
  { name: 'Europe/London', offset: 0 },
  { name: 'Europe/Paris', offset: 60 },
  { name: 'Europe/Berlin', offset: 60 },
  { name: 'Asia/Tokyo', offset: 540 },
  { name: 'Asia/Shanghai', offset: 480 },
  { name: 'Asia/Singapore', offset: 480 },
  { name: 'Australia/Sydney', offset: 600 }
]

/**
 * Common screen resolutions by OS
 */
const SCREEN_RESOLUTIONS = {
  Windows: [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 3840, height: 2160 }
  ],
  macOS: [
    { width: 2560, height: 1600 }, // MacBook Pro 16"
    { width: 2880, height: 1800 }, // MacBook Pro 15"
    { width: 2560, height: 1440 }, // iMac 27"
    { width: 1920, height: 1080 }, // MacBook Air
    { width: 3024, height: 1964 }  // MacBook Pro 14"
  ],
  Linux: [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1600, height: 900 }
  ]
}

/**
 * Chrome versions for User Agent generation
 */
const CHROME_VERSIONS = [
  '120.0.0.0',
  '121.0.0.0',
  '122.0.0.0',
  '123.0.0.0',
  '124.0.0.0'
]

/**
 * Common fonts by OS
 */
const FONTS_BY_OS = {
  Windows: [
    'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Cambria Math', 'Comic Sans MS',
    'Consolas', 'Courier', 'Courier New', 'Georgia', 'Impact', 'Lucida Console',
    'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe UI',
    'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'
  ],
  macOS: [
    'American Typewriter', 'Andale Mono', 'Arial', 'Arial Black', 'Arial Narrow',
    'Arial Rounded MT Bold', 'Avenir', 'Baskerville', 'Big Caslon', 'Bodoni 72',
    'Bradley Hand', 'Brush Script MT', 'Chalkboard', 'Cochin', 'Comic Sans MS',
    'Copperplate', 'Courier', 'Courier New', 'Didot', 'Futura', 'Geneva', 'Georgia',
    'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Herculanum', 'Hoefler Text',
    'Impact', 'Lucida Grande', 'Luminari', 'Marker Felt', 'Monaco', 'Optima',
    'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'Savoye LET', 'SignPainter',
    'Skia', 'Snell Roundhand', 'Tahoma', 'Times', 'Times New Roman', 'Trattatello',
    'Trebuchet MS', 'Verdana', 'Zapfino'
  ],
  Linux: [
    'Arial', 'Courier', 'Courier New', 'DejaVu Sans', 'DejaVu Sans Mono',
    'DejaVu Serif', 'FreeMono', 'FreeSans', 'FreeSerif', 'Georgia', 'Liberation Mono',
    'Liberation Sans', 'Liberation Serif', 'Nimbus Mono L', 'Nimbus Roman No9 L',
    'Nimbus Sans L', 'Times New Roman', 'Ubuntu', 'Ubuntu Mono', 'Verdana'
  ]
}

/**
 * WebGL vendors and renderers by OS
 */
const WEBGL_CONFIGS = {
  Windows: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3060' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce GTX 1660 Ti' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)', unmaskedVendor: 'AMD', unmaskedRenderer: 'AMD Radeon RX 580' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)', unmaskedVendor: 'Intel Inc.', unmaskedRenderer: 'Intel(R) UHD Graphics 630' }
  ],
  macOS: [
    { vendor: 'Apple Inc.', renderer: 'Apple M1', unmaskedVendor: 'Apple Inc.', unmaskedRenderer: 'Apple M1' },
    { vendor: 'Apple Inc.', renderer: 'Apple M2', unmaskedVendor: 'Apple Inc.', unmaskedRenderer: 'Apple M2' },
    { vendor: 'Apple Inc.', renderer: 'Apple M1 Pro', unmaskedVendor: 'Apple Inc.', unmaskedRenderer: 'Apple M1 Pro' },
    { vendor: 'Apple Inc.', renderer: 'AMD Radeon Pro 5500M', unmaskedVendor: 'Apple Inc.', unmaskedRenderer: 'AMD Radeon Pro 5500M' }
  ],
  Linux: [
    { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce GTX 1060/PCIe/SSE2', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce GTX 1060/PCIe/SSE2' },
    { vendor: 'AMD', renderer: 'AMD Radeon RX 570 Series', unmaskedVendor: 'AMD', unmaskedRenderer: 'AMD Radeon RX 570 Series' },
    { vendor: 'Intel Open Source Technology Center', renderer: 'Mesa DRI Intel(R) UHD Graphics 620', unmaskedVendor: 'Intel Open Source Technology Center', unmaskedRenderer: 'Mesa DRI Intel(R) UHD Graphics 620' }
  ]
}

export class FingerprintGenerator {
  /**
   * Generate a complete fingerprint profile
   */
  generate(): FingerprintProfile {
    const os = this.selectOS()
    const navigator = this.generateNavigator(os)
    const screen = this.generateScreen(os)
    const hardware = this.generateHardware()
    const webgl = this.generateWebGL(os)
    const fonts = this.generateFonts(os)
    const timezone = this.selectTimezone()
    const canvas = this.generateCanvas()
    const audio = this.generateAudio()
    const webrtc = this.generateWebRTC()
    const mediaDevices = this.generateMediaDevices()

    return {
      id: randomUUID(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      os,
      navigator,
      screen,
      hardware,
      canvas,
      webgl,
      audio,
      timezone,
      fonts,
      webrtc,
      mediaDevices
    }
  }

  /**
   * Select OS with weighted randomness
   * Windows: 70%, macOS: 20%, Linux: 10%
   */
  private selectOS(): OSType {
    const rand = Math.random()
    if (rand < 0.7) return 'Windows'
    if (rand < 0.9) return 'macOS'
    return 'Linux'
  }

  /**
   * Generate Navigator parameters based on OS
   */
  private generateNavigator(os: OSType): NavigatorFingerprint {
    const chromeVersion = this.randomChoice(CHROME_VERSIONS)
    const userAgent = this.generateUserAgent(os, chromeVersion)
    const platform = this.getPlatform(os)

    return {
      userAgent,
      platform,
      language: 'en-US',
      languages: ['en-US', 'en'],
      doNotTrack: null,
      webdriver: false,
      pdfViewerEnabled: true
    }
  }

  /**
   * Generate User Agent string
   */
  private generateUserAgent(os: OSType, chromeVersion: string): string {
    const webkit = '537.36'
    
    switch (os) {
      case 'Windows':
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkit}`
      
      case 'macOS':
        const macVersions = ['10_15_7', '11_0_0', '12_0_0', '13_0_0']
        const macVersion = this.randomChoice(macVersions)
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVersion}) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkit}`
      
      case 'Linux':
        return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkit}`
    }
  }

  /**
   * Get platform string for OS
   */
  private getPlatform(os: OSType): string {
    switch (os) {
      case 'Windows': return 'Win32'
      case 'macOS': return 'MacIntel'
      case 'Linux': return 'Linux x86_64'
    }
  }

  /**
   * Generate screen parameters
   */
  private generateScreen(os: OSType): ScreenFingerprint {
    const resolution = this.randomChoice(SCREEN_RESOLUTIONS[os])
    const colorDepth = 24
    const pixelDepth = 24
    
    // Device pixel ratio varies by OS
    let devicePixelRatio: number
    if (os === 'macOS') {
      devicePixelRatio = this.randomChoice([2, 2.5, 3]) // Retina displays
    } else {
      devicePixelRatio = this.randomChoice([1, 1.25, 1.5, 2])
    }

    return {
      width: resolution.width,
      height: resolution.height,
      availWidth: resolution.width,
      availHeight: resolution.height - (os === 'Windows' ? 40 : 25), // Taskbar/menu bar
      colorDepth,
      pixelDepth,
      devicePixelRatio
    }
  }

  /**
   * Generate hardware parameters
   */
  private generateHardware(): HardwareFingerprint {
    const hardwareConcurrency = this.randomChoice([4, 6, 8, 12, 16])
    const deviceMemory = this.randomChoice([4, 8, 16, 32])
    const maxTouchPoints = 0 // Desktop typically has 0

    return {
      hardwareConcurrency,
      deviceMemory,
      maxTouchPoints
    }
  }

  /**
   * Generate WebGL parameters
   */
  private generateWebGL(os: OSType): WebGLFingerprint {
    return this.randomChoice(WEBGL_CONFIGS[os])
  }

  /**
   * Generate font list based on OS
   */
  private generateFonts(os: OSType): string[] {
    return [...FONTS_BY_OS[os]]
  }

  /**
   * Select timezone
   */
  private selectTimezone(): TimezoneFingerprint {
    return this.randomChoice(TIMEZONES)
  }

  /**
   * Generate Canvas fingerprint with seed
   */
  private generateCanvas(): CanvasFingerprint {
    return {
      noise: true,
      seed: randomBytes(16).toString('hex')
    }
  }

  /**
   * Generate Audio fingerprint with seed
   */
  private generateAudio(): AudioFingerprint {
    return {
      noise: true,
      seed: randomBytes(16).toString('hex')
    }
  }

  /**
   * Generate WebRTC configuration
   */
  private generateWebRTC(): WebRTCFingerprint {
    return {
      mode: 'disabled' // Disable WebRTC to prevent IP leaks
    }
  }

  /**
   * Generate media devices configuration
   */
  private generateMediaDevices(): MediaDevicesFingerprint {
    return {
      audioInputs: this.randomInt(1, 2),
      audioOutputs: this.randomInt(1, 3),
      videoInputs: this.randomInt(0, 1)
    }
  }

  /**
   * Random choice from array
   */
  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]
  }

  /**
   * Random integer between min and max (inclusive)
   */
  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }
}
