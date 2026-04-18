/**
 * Advanced API Fingerprint Injector
 * 
 * 覆盖更多高级 API 以提高反检测能力
 */

export function generateAdvancedOverrides(profile: {
  plugins?: Array<{ name: string; description: string; filename: string }>;
  geolocation?: { latitude: number; longitude: number; accuracy: number };
  battery?: { charging: boolean; level: number };
}): string {
  return `
  // ============ Plugins API ============
  try {
    const fakePlugins = ${JSON.stringify(profile.plugins || [])};
    
    Object.defineProperty(Navigator.prototype, 'plugins', {
      get: function() {
        return {
          length: fakePlugins.length,
          item: function(index) {
            return fakePlugins[index] || null;
          },
          namedItem: function(name) {
            return fakePlugins.find(p => p.name === name) || null;
          },
          refresh: function() {},
          [Symbol.iterator]: function*() {
            for (const plugin of fakePlugins) {
              yield plugin;
            }
          }
        };
      }
    });
    
    console.log('[Fingerprint] Plugins API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Plugins:', e);
  }
  
  // ============ Speech Synthesis API ============
  try {
    const fakeSpeechVoices = [
      { name: 'Google US English', lang: 'en-US', default: true, localService: false, voiceURI: 'Google US English' },
      { name: 'Google UK English Female', lang: 'en-GB', default: false, localService: false, voiceURI: 'Google UK English Female' }
    ];
    
    if (window.speechSynthesis) {
      const originalGetVoices = window.speechSynthesis.getVoices;
      window.speechSynthesis.getVoices = function() {
        return fakeSpeechVoices;
      };
      
      // 触发 voiceschanged 事件
      setTimeout(() => {
        window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
      }, 100);
    }
    
    console.log('[Fingerprint] Speech Synthesis API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Speech Synthesis:', e);
  }
  
  // ============ Battery API ============
  ${profile.battery ? `
  try {
    if (navigator.getBattery) {
      const originalGetBattery = navigator.getBattery;
      navigator.getBattery = async function() {
        return {
          charging: ${profile.battery.charging},
          chargingTime: Infinity,
          dischargingTime: Infinity,
          level: ${profile.battery.level},
          addEventListener: function() {},
          removeEventListener: function() {},
          dispatchEvent: function() { return true; }
        };
      };
    }
    
    console.log('[Fingerprint] Battery API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Battery API:', e);
  }
  ` : ''}
  
  // ============ Geolocation API ============
  ${profile.geolocation ? `
  try {
    if (navigator.geolocation) {
      const fakePosition = {
        coords: {
          latitude: ${profile.geolocation.latitude},
          longitude: ${profile.geolocation.longitude},
          accuracy: ${profile.geolocation.accuracy},
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        timestamp: Date.now()
      };
      
      navigator.geolocation.getCurrentPosition = function(success, error, options) {
        setTimeout(() => success(fakePosition), 100);
      };
      
      navigator.geolocation.watchPosition = function(success, error, options) {
        setTimeout(() => success(fakePosition), 100);
        return 1;
      };
    }
    
    console.log('[Fingerprint] Geolocation API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Geolocation:', e);
  }
  ` : ''}
  
  // ============ Permissions API ============
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = function(permissionDesc) {
        // 默认拒绝所有权限请求
        return Promise.resolve({
          state: 'denied',
          onchange: null,
          addEventListener: function() {},
          removeEventListener: function() {},
          dispatchEvent: function() { return true; }
        });
      };
    }
    
    console.log('[Fingerprint] Permissions API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Permissions:', e);
  }
  
  // ============ Connection API ============
  try {
    if (navigator.connection || navigator.mozConnection || navigator.webkitConnection) {
      const fakeConnection = {
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false,
        onchange: null,
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return true; }
      };
      
      Object.defineProperty(Navigator.prototype, 'connection', {
        get: function() { return fakeConnection; }
      });
    }
    
    console.log('[Fingerprint] Connection API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Connection:', e);
  }
  
  // ============ Chrome Object (for Chrome detection) ============
  try {
    if (!window.chrome) {
      window.chrome = {
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
          OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
          PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", MIPS64EL: "mips64el", MIPSel: "mipsel", X86_32: "x86-32", X86_64: "x86-64" },
          PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", MIPS64EL: "mips64el", MIPSel: "mipsel", MIPSel64: "mipsel64", X86_32: "x86-32", X86_64: "x86-64" },
          PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
          RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" }
        },
        app: {
          isInstalled: false,
          InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
          RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" }
        }
      };
    }
    
    console.log('[Fingerprint] Chrome object injected');
  } catch (e) {
    console.warn('[Fingerprint] Failed to inject Chrome object:', e);
  }
  
  // ============ Notification API ============
  try {
    if (window.Notification) {
      const originalNotification = window.Notification;
      window.Notification = function(title, options) {
        // 静默处理通知请求
        return {
          close: function() {},
          addEventListener: function() {},
          removeEventListener: function() {},
          dispatchEvent: function() { return true; }
        };
      };
      window.Notification.permission = 'default';
      window.Notification.requestPermission = function() {
        return Promise.resolve('default');
      };
    }
    
    console.log('[Fingerprint] Notification API overridden');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override Notification:', e);
  }
  
  // ============ WebDriver Detection Bypass ============
  try {
    // 删除 webdriver 属性
    delete Object.getPrototypeOf(navigator).webdriver;
    
    // 覆盖 Chrome 的自动化检测
    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_', {
      get: function() { return undefined; },
      set: function(val) { return true; }
    });
    
    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Array', {
      get: function() { return undefined; },
      set: function(val) { return true; }
    });
    
    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Promise', {
      get: function() { return undefined; },
      set: function(val) { return true; }
    });
    
    Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Symbol', {
      get: function() { return undefined; },
      set: function(val) { return true; }
    });
    
    console.log('[Fingerprint] WebDriver detection bypassed');
  } catch (e) {
    console.warn('[Fingerprint] Failed to bypass WebDriver detection:', e);
  }
`;
}
