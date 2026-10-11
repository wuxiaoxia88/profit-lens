/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare module '*.md?raw' {
  const s: string;
  export default s;
}
