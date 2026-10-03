# Incident response

What to do when something is wrong with the deployed contract, the operator tool, the
registry service or the website. Written so either founder can follow it without the
other, and without a developer on hand.

## What counts as an incident

- A report or suspicion that a circuit accepts something it should refuse, or refuses
  what it should accept.
- The maintenance key exposed, lost, or used by someone other than us.
- A verifier (ours or anyone's) accepting a record or presentation that is not genuine.
- A secret (Blockfrost project id, wallet phrase, private-state password, registry token)
  seen anywhere it should not be.
- The registry service or website serving something wrong or being changed by someone
  else.

## The first hour

1. **Write it down.** Time, what was seen, who reported it, links. One note, kept
   up to date. Do not paste secrets into it.
2. **Tell the other founder.** Phone or message, not email.
3. **Do not delete or overwrite anything.** Logs in `bboard-cli/logs/`, the chain, and
   the report are the evidence.
4. **Decide the severity:**
   - **Critical:** records could be forged, a licence could be faked, the maintenance key
     is exposed, or someone else changed the contract.
   - **High:** a circuit can be used to block or grief holders; a secret other than the
     maintenance key is exposed.
   - **Normal:** anything else.
5. **Contain:**
   - Maintenance key exposed: replace the authority at once with a new key (CLI, then
     publish). See `docs/maintenance-policy.md`.
   - Blockfrost id or registry token exposed: revoke and replace it in its dashboard
     (Blockfrost; Railway for the registry).
   - A broken circuit that lets records be faked: remove that circuit's verifier key
     with the maintenance authority, so it can no longer be called, then fix it under
     `docs/release-checklist.md`. Removing a key is announced as soon as it is done.
   - Website or registry: roll back to the last good deploy (Vercel / Railway
     dashboards).

## Within 72 hours

- Fix under `docs/release-checklist.md`, with a test that fails on the old code.
- Publish what happened, what was affected, and what we changed: a deployment record
  revision for anything touching the contract, and a short note on the website.
- Thank and credit the reporter unless they ask not to be named.

## Contacts

- Founders: Hunter Roberts (hunter@veilcore.org), Makoto Steiner.
- Midnight, if the cause is in Midnight's software: report privately through the
  affected repository at https://github.com/midnightntwrk, or
  security@midnight.foundation.
- Blockfrost: support through the Blockfrost dashboard.

## After

Within two weeks: a short written review. What happened, why our checks missed it, and
which test or step now catches it. Add that step to `docs/release-checklist.md`.
