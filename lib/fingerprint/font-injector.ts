/**
 * Font Fingerprint Injector
 * 
 * 字体指纹是最重要的指纹之一，必须正确实现
 */

export function generateFontOverrides(fonts: string[]): string {
  return `
  // Override Font Detection
  try {
    // 1. 覆盖 document.fonts API
    const originalFonts = document.fonts;
    const fakeFonts = new Set(${JSON.stringify(fonts)});
    
    Object.defineProperty(document, 'fonts', {
      get: function() {
        return {
          ...originalFonts,
          check: function(font, text) {
            const fontFamily = font.match(/['"]([^'"]+)['"]/)?.[1] || font.split(' ').pop();
            if (fakeFonts.has(fontFamily)) {
              return true;
            }
            return originalFonts.check.call(originalFonts, font, text);
          },
          load: function(font, text) {
            return Promise.resolve([]);
          },
          forEach: function(callback) {
            fakeFonts.forEach((font) => {
              callback({ family: font, style: 'normal', weight: '400' });
            });
          },
          values: function() {
            return Array.from(fakeFonts).map(font => ({ family: font, style: 'normal', weight: '400' }));
          },
          size: fakeFonts.size
        };
      }
    });
    
    // 2. 覆盖 Canvas 字体测量
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      const result = originalMeasureText.call(this, text);
      
      // 为不同字体返回略微不同的测量值
      const currentFont = this.font || '';
      const fontFamily = currentFont.match(/['"]([^'"]+)['"]/)?.[1] || currentFont.split(' ').pop();
      
      if (fakeFonts.has(fontFamily)) {
        // 添加微小的确定性偏移
        const offset = (fontFamily.charCodeAt(0) % 10) * 0.1;
        return {
          ...result,
          width: result.width + offset
        };
      }
      
      return result;
    };
    
    console.log('[Fingerprint] Font overrides applied:', fakeFonts.size, 'fonts');
  } catch (e) {
    console.warn('[Fingerprint] Failed to override fonts:', e);
  }
`;
}
