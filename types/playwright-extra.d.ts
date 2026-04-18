declare module 'playwright-extra' {
  import { Browser, LaunchOptions } from 'playwright';
  
  export const chromium: {
    use(plugin: any): void;
    launch(options?: LaunchOptions): Promise<Browser>;
  };
}

declare module 'puppeteer-extra-plugin-stealth' {
  const StealthPlugin: () => any;
  export default StealthPlugin;
}
