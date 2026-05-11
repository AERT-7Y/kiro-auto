declare module 'electron' {
  export const app: any
  export class BrowserWindow {
    constructor(...args: any[])
    [key: string]: any
  }
  export class BrowserView {
    constructor(...args: any[])
    [key: string]: any
  }
  export const session: any
}
