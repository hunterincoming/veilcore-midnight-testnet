// Shared by the tests: a temporary root for partner folders, and passwords that pass the
// kit's rule. The chain is the partner kit's own stand-in (partner-kit/test/local-chain.ts):
// the compiled contracts' real circuits, in memory, with no network and no proofs.
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLog } from '../src/audit.ts';
import { type Ctx, importPool } from '../src/operator.ts';
import { fingerprintOf, makePool, newMaster } from '../src/partner-keys.ts';
import { PartnerVault, type RecoveryHolder } from '../src/vault.ts';

export const PW = 'Lab-Vault-Pw-73xQ!';
export const PW2 = 'Breeder-Vault-Pw-48zK!';
export const NETWORK = 'undeployed';

export const tempRoot = async (): Promise<{ root: string; done: () => Promise<void> }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'veilcore-run-test-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
};

/**
 * A new partner, opened, with its audit log and the chain clients given. The partner has
 * made a master on "their computer" and VeilCore imported their bundle key (and `pool`
 * recovery commitments) with the fingerprint confirmed: `master` is what only they hold.
 */
export const newPartner = async (
  root: string,
  id: string,
  chain: Pick<Ctx, 'vc' | 'claims'>,
  o: { password?: string; recovery?: RecoveryHolder; pool?: number; noKey?: boolean } = {},
): Promise<Ctx & { vault: PartnerVault; master: Uint8Array }> => {
  const vault = await PartnerVault.create({
    root,
    id,
    displayName: `${id} (test)`,
    network: NETWORK,
    password: o.password ?? PW,
    defaultRecovery: o.recovery ?? 'custody',
  });
  const master = newMaster();
  const ctx = { vault, audit: new AuditLog(vault.dir, id, NETWORK, () => vault.secrets()), ...chain, master };
  if (o.noKey !== true) {
    const pool = makePool({ partner: id, network: NETWORK, master, count: o.pool ?? 0 });
    await importPool(ctx, pool, fingerprintOf(pool));
  }
  return ctx;
};

/** Every file under `dir`, as text (binary-safe enough for a substring search). */
export const allText = async (dir: string): Promise<string> => {
  let out = '';
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    out += (await readFile(path.join(e.parentPath, e.name))).toString('latin1') + '\n';
  }
  return out;
};

/** Every hex secret in `secrets` that appears in `text` (any case). */
export const leaked = (text: string, secrets: Iterable<string>): string[] => {
  const lower = text.toLowerCase();
  return [...secrets].filter((s) => s.length >= 16 && lower.includes(s.toLowerCase()));
};
