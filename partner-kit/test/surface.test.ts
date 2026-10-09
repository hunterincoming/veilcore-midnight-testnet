// The public surface: what @veilcore/contracts exports, from the sources and from the
// built bundle, holds nothing of VeilCore's operator work (deploying, circuit keys, the
// maintenance authority), and the clients do not hand out the operator API they wrap.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const fake = vi.hoisted(() => ({ find: undefined as undefined | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock('@midnight-ntwrk/midnight-js-contracts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, findDeployedContract: (...a: unknown[]) => fake.find!(...a) };
});

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PKG = path.join(HERE, '..');

/** Operator-only names, from api/src (deploy, deploy-fragments, maintenance, deploy-guard, memory-overlays). */
const OPERATOR = [
  'deploy',
  'finishDeploy',
  'addMissingCircuitKeys',
  'addMissingKeys',
  'deployInFragments',
  'FIRST_FRAGMENT',
  'isBlockLimit',
  'isStaleDustTime',
  'nodeRefusal',
  'unknownCircuits',
  'retireMaintenanceAuthority',
  'retireMaintenanceAuthorityProvably',
  'retiredAuthority',
  'provableRetirementUpdate',
  'assertDeploymentRecordCurrent',
  'assertClaimsDeployAllowed',
  'decide',
  'REQUIRED_RECORD_REVISION',
  'REVISION_VAR',
  'compiledVeilcoreDeploying',
  'compiledClaimsDeploying',
  'veilcoreDeployingContract',
  'claimsDeployingContract',
  'CompiledVeilcore',
  'CompiledVeilcoreClaims',
  'VeilcoreAPI',
  'ClaimsAPI',
  'memorySigningKeys',
  'transientSecrets',
  'actAs',
  'deployedContract',
  'contractMaintenanceTx',
  'circuitMaintenanceTx',
  'insertVerifierKey',
  'removeVerifierKey',
  'replaceAuthority',
];
const OPERATOR_PATTERN = /deploy(?!TxId)|maintenance|retire|fragment|signingkey|verifierkey(?!s?$)|replaceauthority/i;

/** Every name reachable on an export: the export, and a class's static and prototype members. */
const reachable = (mod: Record<string, unknown>): string[] => {
  const names = new Set<string>();
  for (const [k, v] of Object.entries(mod)) {
    names.add(k);
    if (typeof v === 'function') {
      for (const s of Object.getOwnPropertyNames(v)) names.add(s);
      const proto = (v as { prototype?: object }).prototype;
      if (proto !== undefined) for (const p of Object.getOwnPropertyNames(proto)) names.add(p);
    } else if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v)) {
      for (const p of Object.keys(v)) names.add(p);
    }
  }
  return [...names];
};

const checkSurface = (mod: Record<string, unknown>): void => {
  const names = reachable(mod);
  for (const bad of OPERATOR) expect(names, `"${bad}" is reachable`).not.toContain(bad);
  // The ZK config provider legitimately has getVerifierKey(s): reading a key is not adding one.
  const flagged = names.filter((n) => OPERATOR_PATTERN.test(n) && !/^getVerifierKeys?$/.test(n));
  expect(flagged).toEqual([]);
};

describe('the export list (sources)', () => {
  it('holds no operator-only function, on any export or any class member', async () => {
    checkSurface(await import('../src/index'));
  });

  it('holds what a partner needs', async () => {
    const m = (await import('../src/index')) as Record<string, unknown>;
    for (const need of [
      'connect',
      'seedWallet',
      'encryptedPrivateState',
      'VeilCore',
      'VeilCoreClaims',
      'sealFields',
      'commit',
      'newSecret',
      'newChallenge',
      'signRecord',
      'checkPresentation',
      'checkOwnership',
      'checkPairing',
      'checkBatchAnchor',
      'pairingEvidence',
      'readPairingEvidence',
      'reportHashOf',
      'readClaim',
      'verifyClaim',
      'checkKeys',
    ])
      expect(typeof m[need], need).not.toBe('undefined');
    const vc = m.VeilCore as { prototype: object };
    for (const op of [
      'anchor',
      'anchorBatch',
      'pairDna',
      'pairReport',
      'pairings',
      'checkPairing',
      'proveOwnership',
      'issueLicense',
      'countersignLicense',
      'proveLicense',
      'revokeLicense',
      'proposeTransfer',
      'approveTransfer',
      'proposeParent',
      'confirmParent',
      'encumberOwnRecord',
      'discharge',
      'rotateRecordSecret',
      'recoverRecordSecret',
    ])
      expect(Object.getOwnPropertyNames(vc.prototype)).toContain(op);
  });
});

describe('the export list (the built bundle that ships)', () => {
  beforeAll(() => {
    if (!existsSync(path.join(PKG, 'dist', 'index.js')))
      execFileSync(process.execPath, [path.join(PKG, 'scripts', 'build.mjs')], { stdio: 'inherit' });
  }, 120_000);

  it('is the same list as the sources, and holds no operator-only function', async () => {
    const built = (await import(path.join(PKG, 'dist', 'index.js'))) as Record<string, unknown>;
    const src = (await import('../src/index')) as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(Object.keys(src).sort());
    checkSurface(built);
  });
});

describe('a joined client', () => {
  it('exposes no field, and no path to the operator API it wraps', async () => {
    setNetworkId('undeployed');
    const { fakeChain, VEILCORE_ADDR, CLAIMS_ADDR } = await import('./local-chain');
    const { VeilCore } = await import('../src/veilcore');
    const { VeilCoreClaims } = await import('../src/claims');
    const chain = fakeChain(fake as never);
    const vc = await VeilCore.join(chain.conn, { address: VEILCORE_ADDR });
    const cl = await VeilCoreClaims.join(chain.conn, { address: CLAIMS_ADDR });
    for (const client of [vc, cl] as object[]) {
      expect(Object.getOwnPropertyNames(client)).toEqual([]);
      expect(Object.getOwnPropertySymbols(client)).toEqual([]);
      expect(JSON.stringify(client)).toBe('{}');
      for (const bad of OPERATOR) expect((client as Record<string, unknown>)[bad], bad).toBeUndefined();
    }
    vi.unstubAllGlobals();
  });
});
