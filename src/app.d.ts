// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  // CDN globals (di-load dari app.html — Monaco, MathJax, require.js)
  interface Window {
    MathJax?: {
      typesetPromise: (elements?: Element[]) => Promise<void>;
      [key: string]: unknown;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco?: any;
  }

}

export {};
