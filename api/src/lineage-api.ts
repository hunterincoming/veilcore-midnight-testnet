// Lineage API — heritable rights over anchored records.
//
// The contract verifies Merkle paths but stores only a root, so something has to
// maintain the tree and produce paths. That is this class's main job: a caller says
// "encumber this record" and never touches a sibling hash.
//
// Two mechanisms decide a clean-descent claim, and both are needed:
//   the Merkle proof shows a claimed ancestor carries no obligation
//   the descent graph shows the claimed ancestor is the real one
//
// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import * as Lineage from '../../contract/src/managed/lineage/contract/index.js';
import { CompiledLineage } from '../../contract/src/lineage';
import { type DeployedLineageContract, type LineageProviders, lineagePrivateStateKey } from './lineage-types.js';
import { type LineagePrivateState, createLineagePrivateState } from '../../contract/src/witnesses.js';
import { assertDeploymentRecordCurrent } from './deploy-guard.js';
import * as utils from './utils/index.js';

/** A record's position and path in the obligation tree. */
export type SlotPath = {
  readonly directions: boolean[];
  readonly siblings: Uint8Array[];
};

/**
 * What is sitting in a record's slot.
 *
 * A slot is derived from the first DEPTH bytes of a commitment, so another record's
 * obligation can land in it — by collision, or because a squatter ground a secret
 * until it did. `proveAncestorClean` therefore shows the slot holds nothing binding
 * THIS record rather than that it is empty, and it rebuilds the occupant's leaf
 * in-circuit from these three values to fold the path.
 *
 * `ObligationTree.occupantOf()` returns exactly this shape.
 */
export type SlotOccupant = {
  readonly isEmpty: boolean;
  readonly record: Uint8Array;
  readonly obligation: Uint8Array;
  readonly beneficiary: Uint8Array;
};

const ZERO32 = (): Uint8Array => new Uint8Array(32);
const EMPTY_SLOT: SlotOccupant = {
  isEmpty: true,
  record: ZERO32(),
  obligation: ZERO32(),
  beneficiary: ZERO32(),
};

export class LineageAPI {
  private constructor(
    public readonly deployedContract: DeployedLineageContract,
    private readonly providers: LineageProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
  }

  readonly deployedContractAddress: ContractAddress;

  /**
   * Offer a parent. The CHILD's holder asks, and nothing is established yet.
   *
   * `declareParent` was one call that asserted the child's preimage and took the
   * parent on their word, so a seller whose real mother was encumbered could declare
   * descent from any clean record they liked — and the edge it produced was
   * indistinguishable from a real one. An edge now takes both parties, the same
   * propose/approve shape as licence transfer.
   *
   * ONE LIVE PROPOSAL PER CHILD. A cross has two parents, so declaring both is two
   * rounds: propose, confirm, propose, confirm.
   */
  async proposeParent(childCommitment: Uint8Array, parentCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`proposing parentage: ${toHex(childCommitment)} <- ${toHex(parentCommitment)}`);
    const txData = await this.deployedContract.callTx.proposeParent(childCommitment, parentCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proposeParent',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Accept being named as a parent. ONLY THE PARENT'S HOLDER, under their own secret.
   *
   * This is what closes substitution: a seller can still name any record, but the
   * record they named has to agree before the edge exists.
   *
   * The caller must hold the PARENT's secret in private state, not the child's — the
   * circuit derives the confirmer's commitment from the witness and compares it to
   * `parentCommitment`.
   *
   * A record whose parent has no holder can never have that edge confirmed. Descent
   * through a landrace or a collection accession that never joined is not
   * expressible, which is why a registry should require a confirmed path to an origin
   * it recognises rather than reading a sparse graph as a clean one.
   */
  async confirmParent(childCommitment: Uint8Array, parentCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`confirming parentage: ${toHex(childCommitment)} <- ${toHex(parentCommitment)}`);
    const txData = await this.deployedContract.callTx.confirmParent(childCommitment, parentCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'confirmParent',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /** Retract a proposal. The proposer only. */
  async withdrawParent(childCommitment: Uint8Array): Promise<void> {
    this.logger?.info(`withdrawing parentage proposal for ${toHex(childCommitment)}`);
    const txData = await this.deployedContract.callTx.withdrawParent(childCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'withdrawParent',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Attach an obligation to a record.
   *
   * `path` must be current: it is verified against the root on chain, so a path
   * computed before someone else's transaction will fail the fold. That is the
   * intended behaviour — it is what stops a stale view from overwriting the tree.
   */
  async encumber(
    recordCommitment: Uint8Array,
    obligationCommitment: Uint8Array,
    path: SlotPath,
    beneficiarySecret: Uint8Array,
  ): Promise<void> {
    // CALLED BY THE BENEFICIARY, not by the encumbered party. A holder has no reason
    // to encumber their own record and every reason not to, so a circuit only they
    // could call made the whole mechanism voluntary. The beneficiary proves their
    // secret here and again at discharge, and their commitment goes inside the leaf.
    await this.setPath(path, undefined, undefined, beneficiarySecret);
    this.logger?.info(`encumbering ${toHex(recordCommitment)}`);
    const txData = await this.deployedContract.callTx.encumber(recordCommitment, obligationCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'encumber',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Clear an obligation, returning the record's slot to null. ONLY THE BENEFICIARY.
   *
   * This used to require the encumbered record's secret, which meant the party who
   * owed discharged the debt. The fold only reproduces the current root if the
   * beneficiary in the leaf is the one calling, so a stranger's discharge fails on
   * the root comparison rather than needing a separate check.
   */
  async discharge(
    recordCommitment: Uint8Array,
    obligationCommitment: Uint8Array,
    path: SlotPath,
    beneficiarySecret: Uint8Array,
  ): Promise<void> {
    await this.setPath(path, undefined, undefined, beneficiarySecret);
    this.logger?.info(`discharging ${toHex(recordCommitment)}`);
    const txData = await this.deployedContract.callTx.discharge(recordCommitment, obligationCommitment);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'discharge',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Prove one ancestor carries no obligation.
   *
   * One path per proof rather than a whole lineage in one circuit: bundling five
   * paths quadrupled the prover key, which put it out of reach of a browser. A
   * verifier collects one proof per generation instead.
   */
  async proveAncestorClean(
    ancestorCommitment: Uint8Array,
    path: SlotPath,
    occupant: SlotOccupant = EMPTY_SLOT,
  ): Promise<{ ancestor: Uint8Array; txHash: string; blockHeight: number; root: Uint8Array }> {
    // `occupant` defaults to empty, which is the common case and the one the old
    // signature assumed. Pass what ObligationTree.occupantOf() returns when the slot
    // is shared: a leaf binding a DIFFERENT record says nothing about this ancestor,
    // and refusing it would report an obligation the ancestor never incurred.
    await this.setPath(path, [ancestorCommitment], occupant);
    this.logger?.info('proving ancestor clean (zk)');
    const txData = await this.deployedContract.callTx.proveAncestorClean();
    this.logger?.trace({
      transactionAdded: {
        circuit: 'proveAncestorClean',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });

    // The circuit discloses which ancestor it cleared and writes it to
    // lastClearedAncestor. Returning void discarded it, which is the same defect this
    // layer had with proveOwnership: a verifier cannot join the proof to a declared
    // descent edge without knowing what was proven clean, and a proof with no subject
    // is one a caller whose real parent is encumbered could produce against any clean
    // record.
    // `root` is lastProofRoot — WHICH root the proof folded against. The circuit
    // accepts the current root or any of the seven before it, so that a reader is not
    // starved by unrelated traffic between proving and inclusion. The cost is that a
    // freshly attached obligation is not binding on a proof citing an older root, so
    // a verifier deciding anything that matters requires this to equal the current
    // encumberedRoot. Returning void left the caller unable to make that check.
    const ledgerState = await this.currentLedger();
    return {
      ancestor: ancestorCommitment,
      txHash: txData.public.txHash,
      blockHeight: txData.public.blockHeight,
      root: ledgerState.lastProofRoot,
    };
  }

  /** The contract's current ledger state. */
  private async currentLedger(): Promise<Lineage.Ledger> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (contractState === null) throw new Error('the lineage contract has no state at its address');
    return Lineage.ledger(contractState.data);
  }

  /**
   * Write the witnesses a call needs into private state.
   *
   * Everything here is set immediately before the call that reads it, because a path
   * is only valid against the root current at that moment. Calling with a stale path
   * fails the fold, which is the intended behaviour rather than an error to work
   * around.
   */
  private async setPath(
    path: SlotPath,
    ancestry?: Uint8Array[],
    occupant: SlotOccupant = EMPTY_SLOT,
    beneficiarySecret?: Uint8Array,
  ): Promise<void> {
    const current = (await this.providers.privateStateProvider.get(lineagePrivateStateKey)) as LineagePrivateState;

    // Four slots because the witness is a fixed vector, though the circuit reads only
    // element 0 — one ancestor per proof, by design, since bundling a whole lineage
    // quadrupled the prover key. The padding is not dead weight in the proof, it is
    // the shape the witness declares.
    const chain = Array.from({ length: 4 }, (_, i) => ancestry?.[i] ?? ZERO32());

    const next: LineagePrivateState = {
      ...current,
      siblings: path.siblings,
      directions: path.directions,
      ancestry: chain,
      slotIsEmpty: occupant.isEmpty,
      slotOccupantRecord: occupant.record,
      slotOccupantObligation: occupant.obligation,
      slotOccupantBeneficiary: occupant.beneficiary,
      // Defaults to the caller's own secret, which is what a party who is not acting
      // as a beneficiary would supply anyway; encumber and discharge pass the real one.
      beneficiarySecret: beneficiarySecret ?? current.geneticSecret,
    };
    await this.providers.privateStateProvider.set(lineagePrivateStateKey, next);
  }

  /**
   * Deploy the lineage contract, behind the same deployment-record gate as veilcore.
   *
   * READ THIS BEFORE TRUSTING IT. Until the lineage service is changed to call it,
   * this guard is not on the path that deploys lineage.compact in practice. That
   * deploy happens outside this repository: there is no `deployContract` call for
   * lineage anywhere in this tree, `LineageAPI` had no factory at all, and the
   * service therefore reaches the class some other way. TypeScript's `private` on
   * the constructor is erased at compile time — `dist/api/src/lineage-api.js` emits
   * a plain public constructor — so `new LineageAPI(deployed, providers)` from
   * outside compiles to nothing that stops it and skips every static on this class.
   *
   * So this static is the entry point for the service to adopt, not a gate that
   * already holds. The thing that closes the hole is the service calling
   * `assertDeploymentRecordCurrent('lineage', logger)` at its own deploy site —
   * which is why that function is exported from the package rather than kept
   * module-private the way the first version of this guard was.
   *
   * The gate is deliberately not on the constructor. The constructor is also the
   * read path — walking lineage, resolving descent, serving verification — and
   * refusing there would take the registry down on any network not on the
   * allowlist, rather than refusing a deploy.
   */
  static async deploy(providers: LineageProviders, logger?: Logger): Promise<LineageAPI> {
    // Refuses unless the target network is one where the deployment record is not a
    // gate, or a sufficient revision has been declared as filed. Closed by default:
    // an unknown network, an unset network, a missing revision or a mistyped one all
    // refuse. Same record and same revision counter as veilcore — see the note on
    // REQUIRED_RECORD_REVISION in deploy-guard.ts for why it is not its own.
    assertDeploymentRecordCurrent('lineage', logger);

    logger?.info('deployContract — lineage');

    const deployedLineageContract = await deployContract(providers, {
      compiledContract: CompiledLineage,
      privateStateId: lineagePrivateStateKey,
      initialPrivateState: createLineagePrivateState(utils.randomBytes(32)),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedLineageContract.deployTxData.public,
      },
    });

    return new LineageAPI(deployedLineageContract, providers, logger);
  }
}

// verifyDescentClaim was here and is deliberately gone.
//
// It was the third implementation of descent verification in this project, and it
// carried the same defect as the other two: it walked the claimed chain as a single
// line, so a cross — a seed parent and a pollen parent, which is every cannabis
// variety — could not be verified by any chain a caller supplied. One parent was
// refused as an omitted generation, both were refused because the second is not the
// first's parent.
//
// Nothing imported it. Deleting beats fixing, because the next person needing this
// might have found this copy rather than the correct one.
//
// The verifier walks the graph rather than the caller's list, in
// contract/src/descent.mjs (verifyDescent) and behind POST /lineage/verify on the
// registry. Both take the set of ancestors a caller holds clean proofs for and
// require every declared ancestor to be covered, which also closes omission: a
// seller whose grandparent is encumbered cannot pass by declaring only the parent.
