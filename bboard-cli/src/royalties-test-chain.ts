// The chain the royalties client tests run on: the real royalties contract in the
// simulator, the main VeilCore contract beside it, and a fake wallet that records what
// each call paid out. It can fail the next call, time out after it landed, or run other
// transactions between proving a call and landing it (as when proving takes minutes).
// SPDX-License-Identifier: Apache-2.0

import {
  type CircuitContext,
  CostModel,
  QueryContext,
  createCircuitContext,
  createConstructorContext,
} from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../../contract/src/managed/veilcore-royalties/contract/index.js';
import {
  type RoyaltiesPrivateState,
  emptyRoyaltiesPrivateState,
  royaltiesLedger,
  royaltiesWitnesses,
} from '../../contract/src/royalties.js';
import { RoyaltiesAPI } from '../../api/src/royalties-api.js';
import { type RoyaltiesProviders, royaltiesPrivateStateKey } from '../../api/src/royalties-types.js';
import { VeilcoreSimulator } from '../../contract/src/test/veilcore-simulator.js';

export const ROYALTIES = 'aa'.repeat(32);
export const MAIN = 'bb'.repeat(32);
const COIN = '0'.repeat(64);
export const now = (): bigint => BigInt(Math.floor(Date.now() / 1000));
export const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
type Ctx = CircuitContext<RoyaltiesPrivateState>;

/** One chain: the royalties contract in the simulator, the main contract beside it. */
export class Chain {
  ctx: Ctx;
  n = 0;
  /** The next call fails before it lands. */
  failNext = false;
  /** The next call lands, then the client is told it timed out. */
  timeoutAfterLanding = false;
  /**
   * Runs between proving the next call and landing it: other parties' transactions land
   * first. If the proof no longer lands, the call fails as midnight-js reports a transaction
   * that failed on chain (CallTxFailedError), and nothing of it lands.
   */
  beforeLanding: (() => Promise<void>) | undefined;
  readonly main = new VeilcoreSimulator();
  /** What the last call paid out, by token and recipient. */
  lastSpends: Array<[string, string, bigint]> = [];
  private spendTotals = new Map<string, bigint>();

  /** What `wallet` received of `color` in the last call. */
  paid(color: Uint8Array, wallet: Uint8Array): bigint {
    return this.lastSpends
      .filter(([t, to]) => t === hex(color) && to.includes(hex(wallet)))
      .reduce((a, [, , v]) => a + v, 0n);
  }

  constructor() {
    const c = new Contract<RoyaltiesPrivateState>(royaltiesWitnesses);
    const init = c.initialState(createConstructorContext(emptyRoyaltiesPrivateState(), COIN));
    this.ctx = createCircuitContext(ROYALTIES, COIN, init.currentContractState, emptyRoyaltiesPrivateState());
  }

  get ledger() {
    return royaltiesLedger(this.ctx.currentQueryContext.state);
  }

  party(): { api: RoyaltiesAPI; store: Map<string, RoyaltiesPrivateState> } {
    const store = new Map<string, RoyaltiesPrivateState>();
    const privateStateProvider = {
      setContractAddress: () => undefined,
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: RoyaltiesPrivateState) => Promise.resolve(void store.set(k, v)),
    };
    const publicDataProvider = {
      queryContractState: (addr: string) =>
        Promise.resolve({
          data:
            addr === MAIN
              ? (this.main as unknown as { ctx: Ctx }).ctx.currentQueryContext.state
              : this.ctx.currentQueryContext.state,
        }),
    };
    const callTx = new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          async (...args: unknown[]) =>
            this.call(name, store, args),
      },
    );
    const deployed = { deployTxData: { public: { contractAddress: ROYALTIES } }, callTx };
    const providers = { privateStateProvider, publicDataProvider } as unknown as RoyaltiesProviders;
    const Api = RoyaltiesAPI as unknown as new (d: unknown, p: RoyaltiesProviders) => RoyaltiesAPI;
    return { api: new Api(deployed, providers), store };
  }

  // A failed circuit throws before anything lands, as a rejected submission would.
  private async call(name: string, store: Map<string, RoyaltiesPrivateState>, args: unknown[]) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('submission failed (test)');
    }
    const c = new Contract<RoyaltiesPrivateState>(royaltiesWitnesses);
    this.ctx.currentQueryContext.block = { ...this.ctx.currentQueryContext.block, secondsSinceEpoch: now() };
    const ctx: Ctx = { ...this.ctx, currentPrivateState: store.get(royaltiesPrivateStateKey)! };
    type Run = { context: Ctx; proofData: { publicTranscript: unknown } };
    const circuits = c.impureCircuits as unknown as Record<string, (ctx: Ctx, ...a: unknown[]) => Run>;
    const r = circuits[name](ctx, ...args);
    const between = this.beforeLanding;
    if (between !== undefined) {
      this.beforeLanding = undefined;
      await between();
      // Land the proof on the chain as it is now, as a node would.
      const q = new QueryContext(this.ctx.currentQueryContext.state, this.ctx.currentQueryContext.address);
      q.block = { ...q.block, secondsSinceEpoch: now() };
      let landed: QueryContext;
      try {
        landed = q.runTranscript(
          {
            gas: { readTime: 10n ** 15n, computeTime: 10n ** 15n, bytesWritten: 10n ** 12n, bytesDeleted: 10n ** 12n },
            effects: r.context.currentQueryContext.effects,
            program: r.proofData.publicTranscript,
          } as Parameters<QueryContext['runTranscript']>[0],
          CostModel.initialCostModel(),
        );
      } catch {
        throw Object.assign(new Error(`The ${name} transaction failed on chain (test)`), { name: 'CallTxFailedError' });
      }
      this.ctx = { ...this.ctx, currentQueryContext: landed };
      this.lastSpends = [];
      store.set(royaltiesPrivateStateKey, r.context.currentPrivateState);
      this.n++;
      return { public: { txId: `tx${this.n}`, txHash: `h${this.n}`, blockHeight: this.n, nextContractState: null } };
    }
    this.ctx = r.context;
    const fx = r.context.currentQueryContext.effects as unknown as {
      claimedUnshieldedSpends: Map<[{ raw: string }, unknown], bigint>;
    };
    const totals = new Map<string, bigint>();
    for (const [[t, to], v] of fx.claimedUnshieldedSpends) {
      const k = JSON.stringify([t.raw, JSON.stringify(to)]);
      totals.set(k, (totals.get(k) ?? 0n) + v);
    }
    this.lastSpends = [...totals]
      .map(([k, v]) => {
        const [t, to] = JSON.parse(k) as [string, string];
        return [t, to, v - (this.spendTotals.get(k) ?? 0n)] as [string, string, bigint];
      })
      .filter(([, , v]) => v !== 0n);
    this.spendTotals = totals;
    store.set(royaltiesPrivateStateKey, r.context.currentPrivateState);
    this.n++;
    if (this.timeoutAfterLanding) {
      this.timeoutAfterLanding = false;
      throw new Error('timed out waiting for the transaction (test)');
    }
    return { public: { txId: `tx${this.n}`, txHash: `h${this.n}`, blockHeight: this.n, nextContractState: null } };
  }
}
