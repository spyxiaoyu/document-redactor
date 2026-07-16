// Minimal type for jsdom — only used in tests; install @types/jsdom if full types needed.
declare module 'jsdom' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class JSDOM {
    constructor(html: string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window: any;
  }
}
