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
    /** Mainnet builds only, from api/src/deploy-guard.ts (vite.config.ts). Display only. */
    readonly VITE_MAINNET_CONTRACT_ADDRESS: string;
    readonly VITE_MAINNET_CLAIMS_ADDRESS: string;
    /** Mainnet builds only: 'true' when docs/maintenance-policy.md says APPROVED (vite.config.ts). */
    readonly VITE_MAINTENANCE_POLICY_APPROVED: string;
    /** "1" turns on real transactions from the demo (veilcore/chain/config.ts). Off otherwise. */
    readonly VITE_REAL_CHAIN?: string;
    /** The demo contract on the test network, 64 hex characters. */
    readonly VITE_REAL_CHAIN_CONTRACT_ADDRESS?: string;
    /** The sponsor service that pays the network fee. */
    readonly VITE_SPONSOR_URL?: string;
    /** Optional indexer override; the network's public indexer otherwise. */
    readonly VITE_INDEXER_URL?: string;
    readonly VITE_INDEXER_WS_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
