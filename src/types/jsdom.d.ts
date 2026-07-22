// Minimal type for jsdom — only used in tests; install @types/jsdom if full types needed.
// `@typescript-eslint/no-explicit-any` is globally off in .eslintrc.cjs, so eslint-disable comments are not needed.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string);
    window: any;
  }
}
