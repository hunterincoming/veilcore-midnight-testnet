# Maintenance policy

**Status: PROPOSED, 3 October 2026. Not in force until both founders approve it and it
is published with deployment record revision 4.**

The VeilCore contract on Midnight mainnet keeps a maintenance authority. This page says
what that authority can do, why it is kept, who holds it, how it is used, and how
control is meant to move away from the founders over time. It replaces the "retire on a
published date" plan in `docs/design.md`.

## What the authority can do

On Midnight a contract's maintenance authority can do three things, and only three
([Midnight docs, deploy and operate](https://docs.midnight.network/guides/deploy-and-operate)):

1. Insert a circuit's verifier key. This can replace how a circuit behaves, or add a
   circuit.
2. Remove a circuit's verifier key. That circuit then can no longer be called.
3. Replace the authority itself, including handing it to a group of keys with a
   signature threshold.

It cannot change the kinds of data the contract stores (the ledger layout). A change of
that size means deploying a new contract version.

Whoever holds the authority controls the contract's rules. Holders of VeilCore records
should know that, and this policy is how we limit it.

## Why it is kept, and not retired on a date

- **Midnight upgrades its network.** A ledger upgrade can change the verifier keys a
  contract needs. Midnight's own maintainers say that where circuits compile
  differently after an upgrade, "a maintenance verifier-key update would be needed"
  ([midnight-node #1969](https://github.com/midnightntwrk/midnight-node/issues/1969)).
  The next upgrade, ledger v8 to v9, is expected in 2026 with no date announced
  ([midnight-js v5 migration guide](https://github.com/midnightntwrk/midnight-js/blob/main/docs/releases/v5.0.0/migration-guide.md)).
  A contract nobody can maintain may stop working at such an upgrade and could then
  only be replaced.
- **Fixes.** If a circuit is found to be wrong, the authority is how it is repaired or
  switched off without abandoning every record anchored on the contract.
- **Midnight's guidance** is that a contract with long-term state that cannot
  practically migrate needs a maintained authority, with custody spread across
  independent parties (deploy-and-operate guide above).

The 13 September record named relinquishment as the intended end state. This policy
changes that: the end state is an authority held by independent parties under published
rules (see *Where control goes*), because a registry meant to last decades has to survive
network upgrades.

## Who holds it

**At launch:** one signing key, as midnight-js 4.x supports only one
(`deployContract` and `replaceAuthority` take a single key). It exists only on paper:
two copies, one held by each founder (Hunter Roberts, Makoto Steiner), stored
separately and securely. It is never typed into a chat, email, notes app, photo,
password manager or cloud document. The deploy tool removes it from the deploying
computer when the deploy finishes.

**Next:** a committee of three keys with a threshold of two, one held by each founder
and one by an independent party named publicly when chosen. The Midnight ledger supports
this (`ContractMaintenanceAuthority(committee, threshold)`). midnight-js does not yet, so
it needs our own maintenance code. That is built and tested as part of the move to
midnight-js 5, which has to happen before the v8 to v9 upgrade in any case, and then the
authority is replaced by the committee in one published maintenance transaction.

## How it is used

Every use of the authority:

1. Is for one of these reasons only: a network upgrade, a security fix, a correctness
   fix, or a change both founders approved in writing.
2. Is announced at least 14 days before, with the reason and the source change, except
   for an urgent security fix, which is announced as soon as it is safe and no later
   than 72 hours after.
3. Follows `docs/release-checklist.md` in full: tests, adversarial review, preprod run,
   regenerated fingerprints.
4. Is published afterwards in a new revision of the deployment record: the transaction,
   the circuits changed, and the fingerprints of the new build, so anyone can check the
   chain against the source as `join` does.

The authority's counter is public on chain. Any change shows up there and through the
indexer, whether or not we announce it.

## If a key is lost or exposed

- **One paper copy lost or destroyed:** make a new key, replace the authority with it
  (one maintenance transaction), destroy the old copies, publish it.
- **Key exposed** (seen by someone else, photographed, typed somewhere it should not be):
  replace the authority at once, then publish what happened.
- **Both copies lost:** the contract can no longer be maintained. Records stay readable,
  and a successor contract version is deployed with a migration path. This is the
  failure the second copy and, later, the committee exist to prevent.

## Where control goes

1. Launch: one key, two founder-held paper copies.
2. With midnight-js 5 and before the ledger v9 upgrade: two-of-three committee including
   an independent holder.
3. As adoption grows: hand the committee to independent parties (for example a
   standards body, an accredited lab, or a foundation) under these same published rules.

Retirement remains possible if Midnight's network stops requiring contract maintenance
across upgrades. It is no longer planned on a date.
