# VeilCore-run: VeilCore operates for you

**Managed service v1, for mainnet launch. Code: `veilcore-run/`. Last updated 6 October 2026.**

For partners with no developers, such as a tissue-culture lab. VeilCore runs the on-chain side for
you, with the same partner kit (`@veilcore/contracts`) a partner's own developer would use, and
holds your secrets for you in a store of your own, with a way out whenever you want it.

The first part is for the lab owner. The rest is for VeilCore's operator, and for anyone checking
how it works.

---

## Part 1, in plain English (for a lab owner)

### What VeilCore does for you

You tell VeilCore what to do (by email, a form, or a call; the agreement says how), and VeilCore
does it on Midnight for you and pays the network fees:

- put a record on chain for a sample, plant or lot, and date your records;
- pair a lab report's fingerprint with a record;
- prove to a customer that you hold a record (they send a one-time challenge, VeilCore answers it);
- issue, accept, prove and revoke licences;
- confirm parentage (both sides) and place or release obligations such as royalties;
- prove one fact about a record ("germination at least 95%") without showing the rest, and sign
  records as a laboratory.

Every action is written in your own audit log: what was done, when, and the transaction id, which
anyone can look up on the chain. You can ask for the log at any time. It holds no secrets.

### What VeilCore holds for you

Each of these is a long random number (a "secret"). Whoever holds one can do what it controls.

| Secret | What it lets VeilCore do |
| --- | --- |
| A record secret, one per record | act as that record: prove you hold it, issue licences from it, confirm parentage, release obligations owed to it, move it to a new secret |
| A licence secret, for each licence you hold from someone else | show that licence to whoever asks |
| The hidden values behind a sealed record, and its field secret | prove facts about that record. A "value" claim publishes the value; VeilCore asks you first |
| Your laboratory's claims key, if you want VeilCore to sign as your lab | sign records as your laboratory |
| The terms and the salt of each obligation | show later what an obligation means |

They are kept in a store that is yours alone: one encrypted file with its own password, in its
own folder on VeilCore's operations computer. No other partner's secrets are in it, and VeilCore's
own keys are not in it.

### What you hold: your master recovery secret (recommended)

Every record also has a **recovery secret**. It outranks the record secret: whoever holds it can take
the record back from anyone, VeilCore included, at once.

We recommend that **you** hold the recovery secrets, not VeilCore. You make one **master recovery
secret** on your own computer, once. It is printed on one sheet of paper, which you keep in two safe
places. Every record's recovery secret is worked out from it. VeilCore only ever receives a list of
"recovery commitments" (fingerprints of the recovery secrets, which are not secret and cannot be
worked back). VeilCore never sees your master or any recovery secret.

With that sheet you can always take every record back, even if VeilCore disappears, refuses, or is
hacked. That is what makes leaving real.

If you cannot keep a sheet of paper safe, VeilCore can hold the recovery secrets too ("custody
mode"). Then VeilCore holds everything, and if VeilCore's computer were broken into, your records
could be taken over for good (see Part 3). We advise against it.

### What VeilCore can and cannot do with your secrets

**Can:** everything in the table above, for your records, when you ask. Technically it could also do
those things when you did not ask. The agreement forbids it, the audit log records everything
VeilCore's software does, and the chain is public, so an action you did not ask for can be seen.
But a log is not a lock: you are trusting VeilCore here, and the agreement is what that trust rests on.

**Cannot (if you hold your recovery sheet):** keep your records against your will. Your recovery
secret takes any record back in one transaction, and VeilCore cannot change it.

**Cannot, ever:** see what your records describe (only fingerprints go on chain), change a record
after it is sealed, or make a fact true that is not (a claim proves what was sealed, not that it is
true).

**Cannot undo, once done:** a value it published in a claim, a parentage it confirmed, an
obligation it released.

### How to leave

You can leave at any time. There are two ways.

1. **VeilCore does it for you (assisted).** VeilCore gives you a small file (not secret). On your own
   computer you make a new master recovery secret and send VeilCore back a list of commitments (not
   secret). VeilCore then, for each record:
   - installs your new recovery commitment in place of the one VeilCore held (custody mode only);
   - moves the record to a brand-new record secret that is written only into your encrypted bundle.

   VeilCore's old copies then control nothing; the chain shows it. VeilCore pays the fees. The new
   record secrets did pass through VeilCore's software once; your recovery secret outranks them, and
   using it once per record gives you a record secret no VeilCore software has ever touched.
2. **You do it yourself (self).** VeilCore hands you everything and stops acting for you. You, or a
   developer you choose, send one transaction per record with the partner kit (a wallet with DUST is
   needed). Until you do, VeilCore's copies still work on chain (VeilCore will not use them).

Either way you receive:

- **your bundle**: a file holding every secret, locked with a passphrase **you** choose and type
  yourself. VeilCore cannot open it.
- optionally **a printed sheet** of the same secrets, for a safe.
- **written steps** for what is left (the bundle carries them).
- **your audit log.**

Then, when you confirm you can open your bundle, VeilCore deletes every secret it still holds for you
("purge") and keeps only the audit log. Ask for the log line that says so.

Two things cannot be changed on chain, whoever runs it: a sealed record's hidden values can always be
used by whoever holds them to prove facts about that record, and a laboratory claims key cannot be
replaced on chain (you make a new one and tell your customers to stop trusting the old one). For those,
you rely on VeilCore deleting its copies.

Licences you hold move to a secret only you hold when the issuer approves the move; VeilCore proposes
it, the issuer approves.

### If VeilCore disappears

Your records stay on Midnight and keep verifying. With your master recovery sheet and the partner kit
(free, Apache-2.0) you, or anyone you hire, can take every record back without VeilCore. Ask VeilCore
for an export bundle now and then, so you also hold your record secrets and hidden values.

### The three ways to use VeilCore at launch

| | VeilCore-run (this) | Partner kit (self-run) | Website self-custody |
| --- | --- | --- | --- |
| Who sends transactions | VeilCore | you | you, in your browser |
| Who pays fees | VeilCore (fees per the agreement) | you (DUST) | you |
| Who holds record secrets | VeilCore, in a store of yours | you | you |
| Who holds recovery secrets | you (recommended) or VeilCore | you | you |
| You need | a safe for one sheet of paper | a developer, a server, a DUST wallet | a browser and a wallet |
| Available | at launch | at launch (docs/PARTNERS.md) | after launch |

---

## Part 2, the operator procedure (VeilCore staff)

### The machine

- One operations computer, used for nothing else. Disk encryption on (FileVault). Automatic login off.
  Screen lock on. Not shared.
- Node 24, Docker, this repository at a tagged commit. The proof server runs **on this machine**
  (`docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v`);
  VeilCore-run refuses any other, because every proof sends it partners' secrets.
- Keep `~/.veilcore/managed/` out of Time Machine and cloud sync, or use a backup that is itself
  encrypted and kept offline (see Backups).
- The operator wallet (it pays fees) is VeilCore's: not the maintenance key, and not any partner's.
  Its seed comes from the password manager (`VEILCORE_WALLET_SEED`, `VEILCORE_WALLET_PASSWORD`) or is
  typed at the hidden prompt.

### Every command

From the repository folder: `npm run managed -- <command> --partner <id> [options]`. `npm run managed -- help`
lists them all. The network is `--network` or `VEILCORE_NETWORK` (default preprod). Each command asks
for that partner's store password (hidden), does one thing, and closes the store. Commands that send a
transaction also start the operator wallet.

### Onboarding a partner

1. `add-partner --partner <id> --name "<Name>"` (default: the partner keeps recovery secrets). Press
   Enter at the password question to have one made; it is shown once. Save it in the password manager
   as its own entry, "VeilCore-run: <id>". One password per partner, never reused.
2. The partner makes their master recovery secret **on their own computer**:
   `npm run managed -- partner-keys --partner <id> --out-dir <folder> --count 200 --network <network>`.
   It writes `master-sheet.txt` (print two copies, then delete the file) and
   `recovery-pool-….json` (not secret). If they have no one to run it, a VeilCore person may run it on
   **the partner's** laptop, with the screen turned to the partner, and must not read or photograph the
   sheet.
3. They send you the pool file. `import-pool --partner <id> --file <pool.json>`.
4. Sign the agreement (docs/legal/managed-service-agreement-DRAFT.md, once a lawyer has reviewed it).

Custody mode instead: `add-partner … --recovery custody`, and skip steps 2-3. Tell the partner in
writing what that means (Part 1, and Part 3 below).

### Day to day

- `anchor --label <L>`: a new record. Its secret is stored before anything is sent; running it again
  finishes one that was interrupted. When fewer than 10 recovery commitments are left it says so: ask
  the partner for a new pool (`partner-keys` with their existing master and `--start` at the next
  index).
- `date`, `seal-fields`, `pair-dna`, `prove-ownership`, `rotate`; `licence-*`; `lineage-*`;
  `obligation-*`; `lab-key`, `claim`. Only on the partner's written instruction, and keep the
  instruction with the audit log.
- `claim --kind value` publishes a value for good and needs `--publish-value`; have the partner confirm
  that specific value in writing first.
- `seal-fields --file` reads a field-set file holding hidden values: delete the file securely once it is
  in custody.
- `list --partner <id> [--chain]`: what VeilCore runs for them; `--chain` adds whether VeilCore's copy
  still controls each record (no wallet needed).
- `audit --partner <id>`: their log, and whether its chain of hashes is intact. Send it to them on request.
- `export --out <file> [--sheet <file>]`: a copy for the partner, who types their own passphrase.

### A partner leaves

1. Agree which way (assisted or self) in writing.
2. Assisted: `exit-request --partner <id> --out request.json` (no secrets) and send it. The partner runs
   `partner-keys --partner <id> --out-dir <folder> --request request.json` on their computer (a new
   master, or their existing one with `--start`), and sends back `exit-answer.json` (no secrets). Then,
   **with the partner present to type their passphrase**:
   `exit --partner <id> --mode assisted --answer exit-answer.json --out <bundle> [--sheet <file>]`.
   It writes the bundle first, then sends the transactions. If it stops part-way it says so and does
   not retire the store: fix the cause, then run it again with `--previous <bundle> --out <new bundle>`,
   and give the partner **both** bundles.
3. Self: `exit --partner <id> --mode self --out <bundle> [--sheet <file>]`, the partner typing their
   passphrase.
4. Either way the store is now retired: every command for that partner is refused.
5. Hand over the bundle (and sheet). Never send the passphrase; the partner chose it.
6. When the partner confirms they opened the bundle (`open-bundle` on their side): `purge --partner <id>`
   (type `PURGE <id>`). Delete the partner's password manager entry. Delete old backups that hold their
   store (see Backups). Send them the purge line of their audit log.

### Backups

A partner's store is one file (`custody.vcbox`) encrypted under that partner's password. Back up
`~/.veilcore/managed/<network>/` to an encrypted, offline disk kept at the office, never to a cloud
service. Note that a backup taken before a purge still holds that partner's secrets (under their old
password): after a purge, delete the backups that hold their store, or keep a written list of backups
still holding it and their dates.

### Passwords

- Store passwords: one per partner, made by `add-partner`, kept only in the password manager.
  `change-password` if one may have been seen.
- Never type a partner's store password anywhere but the `npm run managed` prompt. Never paste one into
  a chat (including Claude), an email or a document. The same rule as `docs/runbook.md`.

---

## Part 3, the security model

### What protects each partner's secrets

- **One store per partner.** Folder `~/.veilcore/managed/<network>/<id>/` (0700), file `custody.vcbox`
  (0600). Encrypted with a key made from that partner's password by **scrypt (N = 2^17, r = 8, p = 1)**,
  about half a second and 128 MiB per guess, then **AES-256-GCM**. The partner id, network and file
  kind are authenticated with the data, so one partner's file cannot be swapped in for another's. A
  file others can read, or a link, is refused.
- **Never in the operator's own state.** The chain clients run with in-memory private state
  (`memoryPrivateState`); each command gives the one record secret it needs, for that command.
  Nothing a partner owns is written to the CLI's store, the wallet's progress file or any log.
- **Never printed or logged.** Output passes through a filter that removes every secret of the open
  store and every password typed; errors are shown the same way. The vault object prints as
  `PartnerVault { …, secrets: [redacted] }`. The audit log refuses any line that contains a secret.
  The tests check all of this (`veilcore-run/test/`).
- **Stored before used.** Every new secret (record, recovery, licence, rotation target, obligation
  salt) is written to the store, flushed and renamed into place, before the transaction that uses it.
- **The partner kit's public surface only.** VeilCore-run imports nothing but `@veilcore/contracts`
  (checked by a test), so it can do exactly what a partner's own developer could, and nothing of
  VeilCore's operator powers (deploy, circuit keys, the maintenance authority) is in reach.
- **A local proof server only.** Every proof sends the proof server its private inputs.
- **Audit log.** One line per action with a hash of the line before it, so a removed or changed line
  shows (`audit` says whether the chain is intact). It is not encrypted, so the operator can read it
  without the partner's password. It links the partner to their records' public fingerprints, which
  the chain alone does not, so it is kept 0600 like the store.

### What it does not protect against

- **JavaScript cannot reliably wipe memory.** While a command runs, the secrets it uses are in the
  process's memory (and could reach swap). Keys and buffers are overwritten where Node allows; strings
  cannot be.
- **A copy of a file is a copy.** Deleting or purging a store does not reach backups, or blocks an SSD
  has not yet reused. FileVault covers a stolen disk; it does not cover a backup made elsewhere.
- **The operator is trusted.** The agreement and the audit log are what stand between VeilCore and
  misuse. Nothing technical stops VeilCore, while it holds a record secret, from acting as that record.

### If VeilCore's operations computer is compromised

Honestly, this is what it means.

**Stolen files only** (a lost laptop, a stolen backup): each store is scrypt-encrypted under a long
random password. With the passwords VeilCore-run makes (32 random characters), guessing one is
not practical. Weak, reused or written-down passwords change that.

**Someone controlling the running computer** (malware, remote access): they can capture each partner's
password as it is typed, and so every store opened while they are in. For each such partner they can:

- act as every record, until the partner takes it back: prove ownership, issue licences, pair reports,
  propose and confirm parentage, release obligations owed to the partner, make claims (including
  publishing values), present licences the partner holds, sign as the partner's laboratory;
- move records to secrets of their own.

What happens next depends on who holds the recovery secrets:

- **The partner holds them (recommended):** the attacker cannot touch them. The partner (or anyone they
  choose, with the kit and DUST) recovers each record with their master sheet and takes it straight
  back, whatever the attacker did with the record secrets. What the attacker already did stays done:
  a published value, a confirmed parentage, a released obligation, a licence presented or issued in the
  meantime. Licences the partner holds must be moved (the issuer approves); lab keys replaced.
- **VeilCore holds them (custody mode):** the attacker can use the recovery secret to move a record to
  secrets of their own **and** install a recovery commitment of their own in the same transaction. Then
  the record is theirs, for good; no one can take it back. Whoever acts first wins: on discovering a
  compromise, VeilCore would immediately, from a clean computer and the offline backup, recover each
  custody record to new secrets with recovery commitments the partners make. That is a race, not a
  guarantee.

**What VeilCore does on discovering a compromise:** stop the computer; tell every partner the same day
with what is known; for custody partners, start the recovery race above from a clean machine; for
partner-held recovery, help each partner recover (VeilCore can prepare the transactions; the partner's
recovery secret is the one input VeilCore must not see); move the operator wallet; publish what happened.
`docs/incident-response.md` applies.

---

## Part 4, for a partner's developer

### The bundle file

A `.vcb` file is JSON:

```
{ "format": "veilcore-run/box/1", "kind": "exit-bundle", "partner": "<id>", "network": "<network>",
  "kdf": { "name": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<hex>" },
  "cipher": "aes-256-gcm", "iv": "<hex, 12 bytes>", "tag": "<hex, 16 bytes>", "ciphertext": "<base64>" }
```

Key: `scrypt(NFC(passphrase), salt, 32, {N, r, p})`. Additional authenticated data: the UTF-8 JSON of
the array `[format, kind, partner, network, kdf.name, kdf.N, kdf.r, kdf.p, kdf.salt, cipher, iv]`. The
plaintext is JSON: `vault.records[]` (`secret`, `origin`, `current`, `recovery`), `vault.licences[]`,
`vault.obligations[]`, `vault.fieldSets[]` (`file` is a field-set file the kit's `sealFields` takes),
`vault.labKeys[]` (`secret` is the scalar in hex: `labKeyOf(BigInt('0x' + secret))`), `handover[]`
(assisted exits), `procedure`, `audit[]`. Or run `npm run managed -- open-bundle --file <bundle> --out <json>`.

A record secret goes to `vc.useRecordSecret(fromHex(secret))` in the kit; see docs/PARTNERS.md.

### Recovery secrets from the master

```
recovery secret i = HMAC-SHA256(master, "veilcore-run/v1/recovery/" + i)
licence secret j  = HMAC-SHA256(master, "veilcore-run/v1/licence/" + j)
```

Each record's `recovery.pool.index` says which `i`. `npm run managed -- partner-derive --index <i>`
prints one on the partner's own computer. Then:
`vc.recoverRecordSecret({ originalRecord, recoverySecret, newRecordSecret, newRecoveryCommitment })`.

---

## Why exit works the way it does (what the contract allows)

- `rotateRecordSecret` needs the current record secret **and** the new one: the circuit checks that the
  caller holds the secret behind the new commitment. So VeilCore cannot rotate a record to a secret
  only the partner has seen. Whoever sends a rotation sees the new secret.
- `replaceRecoveryCommitment` needs only the current recovery secret and the new **commitment**. So
  where VeilCore holds a recovery secret, it can install one the partner made without seeing it.
- `recoverRecordSecret` takes an identity from whoever holds its record secret, and installs a new
  recovery commitment in the same transaction.
- `proposeTransfer` moves a licence to a commitment the partner made; the issuer approves.

So the assisted exit replaces VeilCore's recovery secret with the partner's (custody records), then
rotates to a hand-over secret written only into the partner's bundle; and the partner's own recovery
secret, never seen by VeilCore, is the final word.

## Limits, and what is not built

- One command per run (each starts the operator wallet): fine for a few partners, slow for many. A
  long-running service with a queue is later work.
- Instructions from partners arrive outside the tool (email, form). There is no partner login.
- No hardware security module: secrets are bytes in a file, encrypted.
- The website self-custody option is after launch.
- No independent security audit of VeilCore-run yet.
