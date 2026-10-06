// Tests only: turn the real-chain build settings on for the chain tests, before any chain
// module reads them. Import it first. Set per test file (not in a shared vitest config) so
// the site's own tests, which run real builds, never see the flag.
// SPDX-License-Identifier: Apache-2.0
import { vi } from 'vitest';

vi.stubEnv('VITE_NETWORK_ID', 'preprod');
vi.stubEnv('VITE_REAL_CHAIN', '1');
vi.stubEnv('VITE_REAL_CHAIN_CONTRACT_ADDRESS', 'c0'.repeat(32));
vi.stubEnv('VITE_SPONSOR_URL', 'https://sponsor.test');
