/**
 * Browser Fingerprint Type Definitions
 * 
 * This module defines all types for browser fingerprint profiles.
 * These types are used across main and renderer processes.
 */

/**
 * Operating System Type
 */
export type OSType = 'Windows' | 'macOS' | 'Linux'

/**
 * Screen Parameters
 */
export interface ScreenFingerprint {
  width: number
  height: number
  availWidth: number
  availHeight: number
  colorDepth: number
  pixelDepth: number
  devicePixelRatio: number
}

/**
 * Hardware Parameters
 */
export interface HardwareFingerprint {
  hardwareConcurrency: number // CPU cores
  deviceMemory: number // GB
  maxTouchPoints: number
}

/**
 * Canvas Fingerprint Parameters
 */
export interface CanvasFingerprint {
  noise: boolean
  seed: string // Hex string for seeded randomness
}

/**
 * WebGL Fingerprint Parameters
 */
export interface WebGLFingerprint {
  vendor: string
  renderer: string
  unmaskedVendor: string
  unmaskedRenderer: string
}

/**
 * Audio Context Fingerprint Parameters
 */
export interface AudioFingerprint {
  noise: boolean
  seed: string // Hex string for seeded randomness
}

/**
 * Timezone Configuration
 */
export interface TimezoneFingerprint {
  name: string // e.g., 'America/New_York'
  offset: number // Minutes offset from UTC
}

/**
 * WebRTC Configuration
 */
export interface WebRTCFingerprint {
  mode: 'disabled' | 'proxy' | 'real'
  publicIP?: string // Only if mode is 'proxy' or 'real'
}

/**
 * Navigator Parameters
 */
export interface NavigatorFingerprint {
  userAgent: string
  platform: string
  language: string
  languages: string[]
  doNotTrack: string | null
  webdriver: boolean
  pdfViewerEnabled: boolean
}

/**
 * Media Devices Configuration
 */
export interface MediaDevicesFingerprint {
  audioInputs: number
  audioOutputs: number
  videoInputs: number
}

/**
 * Complete Fingerprint Profile
 */
export interface FingerprintProfile {
  // Metadata
  id: string
  createdAt: number
  lastUsedAt: number
  
  // OS and Browser
  os: OSType
  navigator: NavigatorFingerprint
  
  // Display
  screen: ScreenFingerprint
  
  // Hardware
  hardware: HardwareFingerprint
  
  // Advanced Fingerprints
  canvas: CanvasFingerprint
  webgl: WebGLFingerprint
  audio: AudioFingerprint
  
  // Localization
  timezone: TimezoneFingerprint
  fonts: string[]
  
  // Network
  webrtc: WebRTCFingerprint
  
  // Media
  mediaDevices: MediaDevicesFingerprint
  
  // 反检测增强字段
  riskScore?: number           // 风险评分
  lastRiskUpdate?: number      // 最后风险更新时间
  usageCount?: number          // 使用次数
  associatedAccounts?: string[] // 关联账号ID列表
  detectionEvents?: number     // 检测事件数量
}

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}
