// Shared by the tests: a temporary root for partner folders, and passwords that pass the
// kit's rule. The chain is the partner kit's own stand-in (partner-kit/test/local-chain.ts):
// the compiled contracts' real circuits, in memory, with no network and no proofs.
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLog } from '../src/audit.ts';
import { type Ctx } from '../src/operator.ts';
import { PartnerVault, type RecoveryHolder } from '../src/vault.ts';

export const PW = 'Lab-Vault-Pw-73xQ!';
export const PW2 = 'Breeder-Vault-Pw-48zK!';
export const PASSPHRASE = 'Partner-Own-Phrase-58!';
export const NETWORK = 'undeployed';

export const tempRoot = async (): Promise<{ root: string; done: () => Promise<void> }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'veilcore-run-test-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
};

/** A new partner, opened, with its audit log, and the chain clients given. */
export const newPartner = async (
  root: string,
  id: string,
  chain: Pick<Ctx, 'vc' | 'claims'>,
  o: { password?: string; recovery?: RecoveryHolder } = {},
): Promise<Ctx & { vault: PartnerVault }> => {
  const vault = await PartnerVault.create({
    root,
    id,
    displayName: `${id} (test)`,
    network: NETWORK,
    password: o.password ?? PW,
    defaultRecovery: o.recovery ?? 'custody',
  });
  return { vault, audit: new AuditLog(vault.dir, id, NETWORK, () => vault.secrets()), ...chain };
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
