/**
 * Fingerprint Injector
 * 
 * Generates JavaScript code to inject fingerprint overrides into browser pages.
 */

import type { FingerprintProfile } from './types'
import { generateFontOverrides } from './font-injector'
import { generateClientRectsOverrides } from './clientrects-injector'
import { generateAdvancedOverrides } from './advanced-injector'

export class FingerprintInjector {
  /**
   * Generate complete injection code for a fingerprint profile
   */
  generateInjectionCode(profile: FingerprintProfile): string {
    return `
(function() {
  'use strict';
  
  // Prevent duplicate injection
  if (window.__fingerprint_injected__) {
    return;
  }
  window.__fingerprint_injected__ = true;

  console.log('[Fingerprint] Injecting fingerprint overrides...');

  ${this.generateSeededRandom(profile.canvas.seed)}
  
  ${this.generateNavigatorOverrides(profile)}
  
  ${this.generateScreenOverrides(profile)}
  
  ${this.generateCanvasOverrides(profile)}
  
  ${this.generateWebGLOverrides(profile)}
  
  ${this.generateAudioOverrides(profile)}
  
  ${this.generateTimezoneOverrides(profile)}
  
  ${this.generateWebRTCOverrides(profile)}
  
  ${this.generateMediaDevicesOverrides(profile)}
  
  ${generateFontOverrides(profile.fonts)}
  
  ${generateClientRectsOverrides(profile.canvas.seed)}
  
  ${generateAdvancedOverrides({
    plugins: [],
    battery: { charging: true, level: 0.85 },
    geolocation: undefined // 不伪装地理位置，避免暴露
  })}
  
  console.log('[Fingerprint] Fingerprint overrides applied successfully');
})();
`
  }

  /**
   * Generate seeded random number generator
   */
  private generateSeededRandom(seed: string): string {
    return `
  // Seeded random number generator for deterministic noise
  function seededRandom(seed) {
    let state = 0;
    for (let i = 0; i < seed.length; i++) {
      state = ((state << 5) - state) + seed.charCodeAt(i);
      state = state & state;
    }
    return function() {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }
  
  const canvasRandom = seededRandom('${seed}');
`
  }

  /**
   * Generate Navigator property overrides
   */
  private generateNavigatorOverrides(profile: FingerprintProfile): string {
    const { navigator: nav, hardware } = profile
    
    return `
  // Override Navigator properties
  try {
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: function() { return '${nav.platform}'; }
    });
    
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: function() { return ${hardware.hardwareConcurrency}; }
    });
    
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: function() { return ${hardware.deviceMemory}; }
    });
    
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
      get: function() { return ${hardware.maxTouchPoints}; }
    });
    
    Object.defineProperty(Navigator.prototype, 'language', {
      get: function() { return '${nav.language}'; }
    });
    
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: function() { return ${JSON.stringify(nav.languages)}; }
    });
    
    Object.defineProperty(Navigator.prototype, 'doNotTrack', {
      get: function() { return ${nav.doNotTrack === null ? 'null' : `'${nav.doNotTrack}'`}; }
    });
    
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: function() { return false; }
    });
    
    Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', {
      get: function() { return ${nav.pdfViewerEnabled}; }
    });
    
    console.log('[Fingerprint] Navigator overrides applied');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Navigator:', e);
  }
`
  }

  /**
   * Generate Screen property overrides
   */
  private generateScreenOverrides(profile: FingerprintProfile): string {
    const { screen } = profile
    
    return `
  // Override Screen properties
  try {
    Object.defineProperty(Screen.prototype, 'width', {
      get: function() { return ${screen.width}; }
    });
    
    Object.defineProperty(Screen.prototype, 'height', {
      get: function() { return ${screen.height}; }
    });
    
    Object.defineProperty(Screen.prototype, 'availWidth', {
      get: function() { return ${screen.availWidth}; }
    });
    
    Object.defineProperty(Screen.prototype, 'availHeight', {
      get: function() { return ${screen.availHeight}; }
    });
    
    Object.defineProperty(Screen.prototype, 'colorDepth', {
      get: function() { return ${screen.colorDepth}; }
    });
    
    Object.defineProperty(Screen.prototype, 'pixelDepth', {
      get: function() { return ${screen.pixelDepth}; }
    });
    
    Object.defineProperty(window, 'devicePixelRatio', {
      get: function() { return ${screen.devicePixelRatio}; }
    });
    
    console.log('[Fingerprint] Screen overrides applied');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Screen:', e);
  }
`
  }

  /**
   * Generate Canvas noise injection
   */
  private generateCanvasOverrides(profile: FingerprintProfile): string {
    if (!profile.canvas.noise) {
      return '// Canvas noise disabled'
    }
    
    return `
  // Override Canvas methods to inject noise
  try {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    
    HTMLCanvasElement.prototype.toDataURL = function() {
      const context = this.getContext('2d');
      if (context) {
        const imageData = context.getImageData(0, 0, this.width, this.height);
        const data = imageData.data;
        
        // Inject deterministic noise
        for (let i = 0; i < data.length; i += 4) {
          const noise = Math.floor(canvasRandom() * 5) - 2;
          data[i] = Math.max(0, Math.min(255, data[i] + noise));
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        }
        
        context.putImageData(imageData, 0, 0);
      }
      return originalToDataURL.apply(this, arguments);
    };
    
    CanvasRenderingContext2D.prototype.getImageData = function() {
      const imageData = originalGetImageData.apply(this, arguments);
      const data = imageData.data;
      
      // Inject deterministic noise
      for (let i = 0; i < data.length; i += 4) {
        const noise = Math.floor(canvasRandom() * 5) - 2;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
      
      return imageData;
    };
    
    console.log('[Fingerprint] Canvas noise injection applied');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Canvas:', e);
  }
`
  }

  /**
   * Generate WebGL parameter overrides
   */
  private generateWebGLOverrides(profile: FingerprintProfile): string {
    const { webgl } = profile
    
    return `
  // Override WebGL parameters
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
        return '${webgl.unmaskedVendor}';
      }
      if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
        return '${webgl.unmaskedRenderer}';
      }
      if (parameter === 7936) { // VENDOR
        return '${webgl.vendor}';
      }
      if (parameter === 7937) { // RENDERER
        return '${webgl.renderer}';
      }
      return getParameter.apply(this, arguments);
    };
    
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) {
        return '${webgl.unmaskedVendor}';
      }
      if (parameter === 37446) {
        return '${webgl.unmaskedRenderer}';
      }
      if (parameter === 7936) {
        return '${webgl.vendor}';
      }
      if (parameter === 7937) {
        return '${webgl.renderer}';
      }
      return getParameter2.apply(this, arguments);
    };
    
    console.log('[Fingerprint] WebGL overrides applied');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override WebGL:', e);
  }
`
  }

  /**
   * Generate Audio Context noise injection
   */
  private generateAudioOverrides(profile: FingerprintProfile): string {
    if (!profile.audio.noise) {
      return '// Audio noise disabled'
    }
    
    return `
  // Override Audio Context to inject noise
  try {
    const audioRandom = seededRandom('${profile.audio.seed}');
    
    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (OriginalAudioContext) {
      const createOscillator = OriginalAudioContext.prototype.createOscillator;
      OriginalAudioContext.prototype.createOscillator = function() {
        const oscillator = createOscillator.apply(this, arguments);
        const originalStart = oscillator.start;
        oscillator.start = function() {
          // Inject slight frequency variation
          const noise = (audioRandom() - 0.5) * 0.001;
          if (oscillator.frequency) {
            oscillator.frequency.value += noise;
          }
          return originalStart.apply(this, arguments);
        };
        return oscillator;
      };
      
      console.log('[Fingerprint] Audio noise injection applied');
    }
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Audio:', e);
  }
`
  }

  /**
   * Generate timezone overrides
   */
  private generateTimezoneOverrides(profile: FingerprintProfile): string {
    const { timezone } = profile
    
    return `
  // Override timezone
  try {
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
      return ${timezone.offset};
    };
    
    // Override Intl.DateTimeFormat
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function() {
      const options = arguments[1] || {};
      options.timeZone = '${timezone.name}';
      return new OriginalDateTimeFormat(arguments[0], options);
    };
    Intl.DateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
    
    console.log('[Fingerprint] Timezone overrides applied');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override timezone:', e);
  }
`
  }

  /**
   * Generate WebRTC overrides
   */
  private generateWebRTCOverrides(profile: FingerprintProfile): string {
    if (profile.webrtc.mode !== 'disabled') {
      return '// WebRTC not disabled'
    }
    
    return `
  // Disable WebRTC to prevent IP leaks
  try {
    if (window.RTCPeerConnection) {
      window.RTCPeerConnection = function() {
        throw new Error('WebRTC is disabled');
      };
    }
    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = function() {
        throw new Error('WebRTC is disabled');
      };
    }
    if (window.mozRTCPeerConnection) {
      window.mozRTCPeerConnection = function() {
        throw new Error('WebRTC is disabled');
      };
    }
    
    console.log('[Fingerprint] WebRTC disabled');
  } catch (e) {
    console.warn('[Fingerprint] Failed to disable WebRTC:', e);
  }
`
  }

  /**
   * Generate MediaDevices overrides
   */
  private generateMediaDevicesOverrides(profile: FingerprintProfile): string {
    const { mediaDevices } = profile
    
    return `
  // Override MediaDevices.enumerateDevices
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
      navigator.mediaDevices.enumerateDevices = async function() {
        const devices = [];
        
        // Add audio inputs
        for (let i = 0; i < ${mediaDevices.audioInputs}; i++) {
          devices.push({
            deviceId: 'audioinput_' + i,
            kind: 'audioinput',
            label: 'Microphone ' + (i + 1),
            groupId: 'group_audio_' + i
          });
        }
        
        // Add audio outputs
        for (let i = 0; i < ${mediaDevices.audioOutputs}; i++) {
          devices.push({
            deviceId: 'audiooutput_' + i,
            kind: 'audiooutput',
            label: 'Speaker ' + (i + 1),
            groupId: 'group_audio_' + i
          });
        }
        
        // Add video inputs
        for (let i = 0; i < ${mediaDevices.videoInputs}; i++) {
          devices.push({
            deviceId: 'videoinput_' + i,
            kind: 'videoinput',
            label: 'Camera ' + (i + 1),
            groupId: 'group_video_' + i
          });
        }
        
        return devices;
      };
      
      console.log('[Fingerprint] MediaDevices overrides applied');
    }
  } catch (e) {
    console.warn('[Fingerprint] Failed to override MediaDevices:', e);
  }
`
  }
}
