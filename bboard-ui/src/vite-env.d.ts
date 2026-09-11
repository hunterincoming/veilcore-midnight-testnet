import 'vite/client';

// Without this every `import.meta.env.VITE_*` read is `any`, which then flows
// into whatever it touches. Declaring the variables the app actually uses means
// a typo in an env name is a compile error rather than `undefined` at runtime.
//
// `declare global` is required because the import above makes this file a
// module: without it these interfaces are local and augment nothing.
declare global {
  interface ImportMetaEnv {
    /** Base URL of the metadata API. Empty string means same-origin. */
    readonly VITE_API_BASE: string;
    /** Midnight network the UI talks to. */
    readonly VITE_NETWORK_ID: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
