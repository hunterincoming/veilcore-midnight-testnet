// @veilcore/contracts: integrate VeilCore's Midnight contracts into your own systems.
// SPDX-License-Identifier: Apache-2.0
//
// Everything a lab, registry, certifier or software vendor needs, and nothing of
// VeilCore's operator work: no deploy, no circuit keys, no maintenance authority
// (test/surface.test.ts checks this list). Every name is exported explicitly; nothing is
// re-exported wholesale from the operator code this is built on.

// ── connecting ───────────────────────────────────────────────────────────────
export { connect, isLocalUrl, type Connection, type ConnectOptions } from './connect.js';
export {
  DEFAULT_PROOF_SERVER,
  MAINNET_ADDRESSES,
  NETWORKS,
  PREPROD_ADDRESSES,
  PROOF_SERVER_IMAGE,
  assertAddressFor,
  defaultAddress,
  endpointsFor,
  isNetwork,
  type ContractKind,
  type Endpoints,
  type Network,
} from './network.js';
export {
  SeedWallet,
  WalletProgressNotOpenedError,
  isSynced,
  seedWallet,
  type SeedWalletOptions,
  type WalletBalances,
} from './wallet.js';
export {
  defaultStateDir,
  encryptedPrivateState,
  memoryPrivateState,
  passwordProblem,
  type ClaimsPrivateStateProvider,
  type EncryptedPrivateStateOptions,
  type PrivateStateStores,
  type VeilcorePrivateStateProvider,
} from './private-state.js';
export {
  DEFAULT_KEYS_URL,
  KeyFingerprintError,
  VerifiedZkConfigProvider,
  checkKeys,
  circuitsOf,
  defaultCacheDir,
  type ContractName,
  type KeySource,
} from './keys.js';
export { FINGERPRINTS, FINGERPRINTS_BUILT } from './fingerprints.js';

// ── the contracts ────────────────────────────────────────────────────────────
export { VeilCore, type JoinOptions, type SealResult, type TxRef, type WhoAmI } from './veilcore.js';
export {
  VeilCoreClaims,
  sealFields,
  type ClaimReading,
  type ClaimRef,
  type LabSignature,
  type RangeDirection,
  type SealedFields,
  type SealedRecord,
} from './claims.js';
export {
  LandedButUnconfirmedError,
  RecoveryReplacedButUnconfirmedError,
  RevokedLicenceError,
} from '../../api/src/veilcore-api.js';
export { StartingStateUnreachableError } from '../../api/src/starting-state.js';
export { errorChain, isContractRefusal } from './errors.js';

// ── secrets and commitments (offline) ────────────────────────────────────────
export { commit, fromHex, newChallenge, newSecret, toHex } from './commitments.js';
export {
  attesterKeyOf as labKeyOf,
  newAttesterKey as newLabKey,
  signRecord,
  verifyRecordSignature,
  type AttestationSignature,
  type JubjubPoint,
} from '../../contract/src/attest.js';
export {
  committedJsonDigest,
  fieldSchemaId,
  type FieldSchema,
  type FieldSetFile,
  type TypedSlotValue,
} from '../../contract/src/field-schema.js';
export { numberFrom } from '../../contract/src/fields.js';

// ── verifying (no wallet) ────────────────────────────────────────────────────
export {
  checkBatchAnchor,
  checkOwnership,
  checkPresentation,
  readClaim,
  readAuthority,
  readClaimsAuthority,
  readLedger,
  type ReadOptions,
  type Verdict,
  type WhenLanded,
  type WithAuthority,
} from './verify.js';
export { ContractStateMismatchError, type AuthorityReport } from '../../api/src/state-check.js';
export {
  ChallengeBook,
  MAX_PRESENTATION_AGE_MS,
  acceptOwnership,
  acceptOwnershipOnce,
  acceptPresentation,
  acceptPresentationAt,
  acceptPresentationOnce,
  acceptPresentationScoped,
  checkLineage,
  commitmentsOf,
  currentHead,
  identityOf,
  isAnchored,
  isLive,
  openObligations,
  type ChallengeEntry,
  type ChallengeKind,
  type LineageReport,
} from '../../contract/src/verify.js';
export {
  claimFromCells,
  verifyClaim,
  type Claim,
  type ClaimVerdict,
  type ClaimVerifyInput,
} from '../../contract/src/verify-claims.js';
export { type Ledger } from '../../contract/src/managed/veilcore/contract/index.js';
