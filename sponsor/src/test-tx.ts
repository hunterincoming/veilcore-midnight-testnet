// Test helper: real ledger transactions built offline. The proofs are placeholders (the
// ledger accepts any well-formed proof bytes when assembling), which is enough to test
// what the sponsor reads; the network would reject them, and nothing here sends them.
// SPDX-License-Identifier: Apache-2.0

import {
  communicationCommitmentRandomness,
  ContractCallPrototype,
  ContractDeploy,
  ContractOperation,
  ContractState,
  CostModel,
  createShieldedCoinInfo,
  DustActions,
  Intent,
  MaintenanceUpdate,
  Proof,
  sampleCoinPublicKey,
  sampleContractAddress,
  sampleEncryptionPublicKey,
  sampleUserAddress,
  shieldedToken,
  Transaction,
  UnshieldedOffer,
  unshieldedToken,
  ZswapOffer,
  ZswapOutput,
  type UnprovenIntent,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v8';

export const VC = sampleContractAddress();
export const OTHER = sampleContractAddress();

const empty = { value: [], alignment: [] };
const placeholderProver = {
  check: () => Promise.resolve([]),
  prove: () => Promise.resolve(new Proof('0100').serialize()),
};

export const call = (circuit: string, address = VC) =>
  new ContractCallPrototype(
    address,
    circuit,
    new ContractOperation(),
    undefined,
    undefined,
    [],
    empty,
    empty,
    communicationCommitmentRandomness(),
    circuit,
  );

export const ttlIn = (ms: number, from = Date.now()) => new Date(from + ms);

export const intentWith = (ttl: Date, ...circuits: string[]): UnprovenIntent => {
  let i = Intent.new(ttl);
  for (const c of circuits) i = i.addCall(call(c));
  return i;
};

/** Prove with placeholder proofs and seal (bind): what the browser sends. */
export const seal = async (tx: UnprovenTransaction): Promise<Uint8Array> =>
  (await tx.prove(placeholderProver, CostModel.initialCostModel())).bind().serialize();

export const sealedCall = (circuit = 'anchor', ttl = ttlIn(10 * 60_000), address = VC) =>
  seal(Transaction.fromParts('preprod', undefined, undefined, Intent.new(ttl).addCall(call(circuit, address))));

export const hostile = {
  unproven: (ttl = ttlIn(600_000)) =>
    Transaction.fromParts('preprod', undefined, undefined, intentWith(ttl, 'anchor')).serialize(),
  provenNotBound: async (ttl = ttlIn(600_000)) =>
    (
      await Transaction.fromParts('preprod', undefined, undefined, intentWith(ttl, 'anchor')).prove(
        placeholderProver,
        CostModel.initialCostModel(),
      )
    ).serialize(),
  twoCalls: () => seal(Transaction.fromParts('preprod', undefined, undefined, intentWith(ttlIn(600_000), 'anchor', 'pairDna'))),
  deploy: () =>
    Transaction.fromParts('preprod', undefined, undefined, Intent.new(ttlIn(600_000)).addDeploy(new ContractDeploy(new ContractState())))
      .mockProve()
      .serialize(),
  maintenance: () =>
    Transaction.fromParts(
      'preprod',
      undefined,
      undefined,
      Intent.new(ttlIn(600_000)).addMaintenanceUpdate(new MaintenanceUpdate(VC, [], 0n)),
    )
      .mockProve()
      .serialize(),
  shieldedOffer: () => {
    const coin = createShieldedCoinInfo(shieldedToken().raw, 10n);
    const offer = ZswapOffer.fromOutput(
      ZswapOutput.new(coin, 0, sampleCoinPublicKey(), sampleEncryptionPublicKey()),
      shieldedToken().raw,
      10n,
    );
    return seal(Transaction.fromParts('preprod', offer, undefined, intentWith(ttlIn(600_000), 'anchor')));
  },
  unshieldedOffer: () => {
    const i = intentWith(ttlIn(600_000), 'anchor');
    i.guaranteedUnshieldedOffer = UnshieldedOffer.new([], [{ value: 5n, owner: sampleUserAddress(), type: unshieldedToken().raw }], []);
    return seal(Transaction.fromParts('preprod', undefined, undefined, i));
  },
  dustActions: () => {
    const i = intentWith(ttlIn(600_000), 'anchor');
    i.dustActions = new DustActions('signature', 'pre-proof', new Date(), [], []);
    return seal(Transaction.fromParts('preprod', undefined, undefined, i));
  },
  twoIntents: () => {
    const a = Transaction.fromPartsRandomized('preprod', undefined, undefined, intentWith(ttlIn(600_000), 'anchor'));
    const b = Transaction.fromPartsRandomized('preprod', undefined, undefined, intentWith(ttlIn(600_000), 'pairDna'));
    return seal(a.merge(b));
  },
};
