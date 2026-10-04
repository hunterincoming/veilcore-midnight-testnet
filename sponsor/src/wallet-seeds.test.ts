// The sponsor derives its wallet keys with deriveRoleSeeds (wallet.ts) instead of
// testkit-js's WalletSeeds, so the process holding SPONSOR_SEED no longer loads test
// infrastructure. This proves the switch changes nothing: for fixed PUBLIC dev seeds the
// role seeds, the keys made from them and the addresses are byte-identical to testkit's.
// testkit-js stays a dev dependency for this test only; it is not deployed.
//
// No real wallet's seed appears here: 0…01 is the well-known local-devnet seed, and the
// others are fixed patterns and testkit's own public test mnemonic.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { WalletSeeds } from '@midnight-ntwrk/testkit-js';
import { createKeystore, DustAddress } from '@midnight-ntwrk/wallet-sdk';
import { DustSecretKey, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import { deriveRoleSeeds } from './wallet.js';

const DEV_SEED = '0'.repeat(63) + '1';
const SEEDS = [
  DEV_SEED,
  '00'.repeat(32),
  'ab'.repeat(32),
  '0123456789abcdef'.repeat(4),
  WalletSeeds.testWallet().masterSeed, // 64-byte seed from testkit's public test mnemonic
];
const NETWORKS = ['undeployed', 'preprod', 'preview'] as const;
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

/** Everything the sponsor makes from the role seeds (wallet.ts FacadeWallet.build). */
const derived = (s: { shielded: Uint8Array; unshielded: Uint8Array; dust: Uint8Array }, network: string) => {
  const zswap = ZswapSecretKeys.fromSeed(s.shielded);
  const dustKey = DustSecretKey.fromSeed(s.dust);
  return {
    shielded: hex(s.shielded),
    unshielded: hex(s.unshielded),
    dust: hex(s.dust),
    coinPublicKey: zswap.coinPublicKey,
    encryptionPublicKey: zswap.encryptionPublicKey,
    unshieldedAddress: createKeystore(s.unshielded, network as never).getBech32Address().asString(),
    dustPublicKey: String(dustKey.publicKey),
    dustAddress: DustAddress.encodePublicKey(network, dustKey.publicKey),
  };
};

describe('wallet key derivation without testkit-js', () => {
  it('gives byte-identical role seeds, keys and addresses to WalletSeeds.fromMasterSeed', () => {
    for (const seed of SEEDS) {
      const ours = deriveRoleSeeds(seed);
      const theirs = WalletSeeds.fromMasterSeed(seed);
      expect(Buffer.from(ours.shielded).equals(Buffer.from(theirs.shielded))).toBe(true);
      expect(Buffer.from(ours.unshielded).equals(Buffer.from(theirs.unshielded))).toBe(true);
      expect(Buffer.from(ours.dust).equals(Buffer.from(theirs.dust))).toBe(true);
      for (const network of NETWORKS) expect(derived(ours, network)).toEqual(derived(theirs, network));
    }
  });

  it('matches known answers for the public dev seed (holds even once testkit-js is gone)', () => {
    const d = derived(deriveRoleSeeds(DEV_SEED), 'undeployed');
    expect(d).toMatchObject({
      shielded: '9690d4013e42e6739d9496f836b2cbd4339451c02a00624b86e9fb15cc4197a8',
      unshielded: '22b8e577b3f638b2b361f36fd62d7138ed489d9afe3da5f7c325e2d0a95ae043',
      dust: 'b9b76cce66828aa6bd798abbb15b012331a6aa1e5f99e678724c37463b5775a1',
      coinPublicKey: '1bd4f827be97ff013c4a702e4b08f30ec378728a54670cf7cc92cb9b1a14eff6',
      unshieldedAddress: 'mn_addr_undeployed1h3ssm5ru2t6eqy4g3she78zlxn96e36ms6pq996aduvmateh9p9sk96u7s',
      dustAddress: 'mn_dust_undeployed1w0l54txthpu8q05j9j9ttk3j5dyu5766dc9zkz2s435vdglzwdr35dw790y',
    });
  });

  it('returns copies that survive the HD wallet being cleared, and refuses a non-hex seed', () => {
    const a = deriveRoleSeeds(DEV_SEED);
    expect(a.shielded.some((b) => b !== 0)).toBe(true);
    expect(hex(a.shielded)).toBe(hex(deriveRoleSeeds(DEV_SEED).shielded));
    expect(() => deriveRoleSeeds('not hex')).toThrow(/hex/);
    expect(() => deriveRoleSeeds('')).toThrow(/hex/);
  });
});
