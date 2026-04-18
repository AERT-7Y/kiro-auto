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
`;
}
