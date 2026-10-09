# VeilCore-run: VeilCore operates for you

**Managed service v1, for mainnet launch. Code: `veilcore-run/`. Last updated 6 October 2026
(after a fresh-session AI review, not an audit, `review-managed.md`).**

For partners with no developers, such as a tissue-culture lab. VeilCore runs the on-chain side for
you, with the same partner kit (`@veilcore/contracts`) a partner's own developer would use, and
holds your secrets for you in a store of your own, with a way out whenever you want it.

The first part is for the lab owner. The rest is for VeilCore's operator, and for anyone checking
how it works.

---

## Part 1, in plain English (for a lab owner)

### What VeilCore does for you

You tell VeilCore what to do, and VeilCore does it on Midnight for you and pays the network fees:

- put a record on chain for a sample, plant or lot, and date your records;
- pair a lab report's fingerprint with a record;
- prove to a customer that you hold a record (they send a one-time challenge, VeilCore answers it);
- issue, accept, prove and revoke licences;
- confirm parentage (both sides) and place or release obligations such as royalties;
- prove one fact about a record ("germination at least 95%") without showing the rest, and sign
  records as a laboratory.

**Instructions that matter most are confirmed a second way.** Publishing a value, releasing an
obligation, moving a licence, leaving, or changing who may instruct VeilCore: VeilCore confirms these
with you by phone or in person, not only by email, because an email can be forged.

Every action is written in your own audit log: what was done, when, and the transaction id, which
anyone can look up on the chain. The log holds no secrets. What it can and cannot prove is in Part 3;
in short, VeilCore regularly timestamps the log on the chain and sends you a short receipt each time,
and with those receipts you can tell if the log was changed afterwards: `partner-check-receipt` checks
one against the log your bundle carries (no wallet needed).

### What VeilCore holds for you

Each of these is a long random number (a "secret"). Whoever holds one can do what it controls.

| Secret | What it lets VeilCore do |
| --- | --- |
| A record secret, one per record | act as that record: prove you hold it, issue licences from it, confirm parentage, release obligations owed to it, move it to a new secret |
| A licence secret, for each licence you hold from someone else | show that licence to whoever asks |
| The hidden values behind a sealed record, and its field secret | prove facts about that record. A "value" claim publishes the value; VeilCore asks you first |
| Your laboratory's claims key, if you want VeilCore to sign as your lab | sign records as your laboratory |
| The terms and the salt of each obligation | show later what an obligation means |

They are kept in a store that is yours alone: one encrypted file with its own password, in its own
folder on VeilCore's operations computer. No other partner's secrets are in it, and VeilCore's own keys
are not in it.

### What you hold: your master secret

You make one **master secret** on your own computer. It is printed on one sheet of paper, which you
keep in two safe places. It is never given to VeilCore, and VeilCore's software never shows it on
VeilCore's screen. From it come:

- **your recovery secrets** (recommended: see below);
- **the key that opens your bundles**: everything VeilCore ever hands you is locked to this key. Nothing
  on VeilCore's side can open it, and you never type a passphrase on VeilCore's computer.

What VeilCore receives from you is public: a "bundle key" (the lock, not the key) and "recovery
commitments" (fingerprints that cannot be worked back into the secrets). When you send them, you read
out a short **fingerprint** from your own screen, by phone or in person; VeilCore types it in. If
someone changed the file on the way, it does not match and VeilCore does not use it.

If a VeilCore person helps you run the program on your laptop, the sheet is printed on your side and they
must not read or photograph it.

**Recovery secrets.** Every record has one, and it outranks the record secret: whoever holds it can take
the record back from anyone, VeilCore included, at once. We recommend that **you** hold them, worked out
from your master. Then you can always take every record back, even if VeilCore disappears, refuses, or is
hacked. If you cannot keep a sheet of paper safe, VeilCore can hold the recovery secrets too ("custody
mode"). Then VeilCore holds everything, and if VeilCore's computer were broken into, your records could be
taken over for good (Part 3). We advise against it.

### What VeilCore can and cannot do with your secrets

**Can:** everything in the table above, for your records, when you ask. Technically it could also do those
things when you did not ask. The agreement forbids it, the audit log records everything VeilCore's
software does, and the chain is public, so an action you did not ask for can be seen. But a log is not a
lock: you are trusting VeilCore here, and the agreement is what that trust rests on.

**Cannot (if you hold your recovery secrets):** keep your records against your will. Your recovery secret
takes any record back in one transaction, and VeilCore cannot change it.

**Cannot, ever:** see what your records describe (only fingerprints go on chain), change a record after
it is sealed, or make a fact true that is not (a claim proves what was sealed, not that it is true).

**Cannot undo, once done:** a value it published in a claim, a parentage it confirmed, an obligation it
released.

### How to leave

You can leave at any time. Leaving has a part VeilCore does and a part only you can do.

**VeilCore's part (pick one):**

1. **Assisted.** VeilCore gives you a small file (no secrets). On your own computer you turn it into an
   "answer" (no secrets) and read its fingerprint out to VeilCore. VeilCore then, for each record:
   - puts your new recovery commitment in place of the one VeilCore held (custody mode only), without ever
     seeing the secret behind it;
   - moves the record to a new record secret. The contract only lets whoever moves a record hold the new
     secret, so VeilCore's software makes it for that one step, locks it straight into your bundle, never
     writes it down, and forgets it when the step ends. VeilCore's stored copies then control nothing.

   VeilCore pays the fees, and proposes moving each licence you hold to a secret only you hold.
2. **Self.** VeilCore hands you everything and stops acting for you. VeilCore's copies keep working on
   chain until you do your part.

**Your part (required either way).** On your own computer, with your master sheet and a Midnight wallet
holding DUST (a developer or IT person can do this for you in under an hour; docs/PARTNERS.md says what
is needed), run `partner-recover`. It takes every record back with **your own** recovery secret and moves
it to a record secret and a recovery secret that no VeilCore software has ever seen. Then `partner-check`
confirms on the chain, record by record, that both are yours, and VeilCore's `exit-check` shows the same.

Until you have done it, your exit is not finished: after an assisted exit, the new record secrets VeilCore's
software made for the hand-over still control your records; after a self exit, VeilCore's copies do. That
matters most if VeilCore's computer were ever compromised (Part 3).

You receive:

- **your bundle** (one per run of an assisted exit; keep them all), locked to your master's key;
- **written steps** for what is left, inside the bundle;
- **your audit log**, and the receipts of its timestamps.

Print a sheet of your secrets from the bundle on **your** computer if you want one (`open-bundle --sheet`).

When you confirm you can open your bundles, VeilCore deletes every secret it still holds for you and the
bundle files on its computer ("purge"), and keeps only the audit log. Deleting a file cannot be guaranteed
to erase it from a solid-state disk or from backups that have not yet expired (Part 2, Backups): that is
exactly why your own recovery step matters.

Some things cannot be changed on chain, by anyone:

- **Licences you hold** move to a secret only you hold when the issuer approves the move. Until then,
  VeilCore's copy of the old licence secret still works.
- **A sealed record's hidden values** can always be used by whoever holds them to prove facts about that
  record. For those you rely on VeilCore deleting its copies.
- **A laboratory claims key** cannot be replaced on chain: you make a new one and tell your customers to
  stop trusting the old one.

### If VeilCore disappears

Your records stay on Midnight and keep verifying. If you hold your recovery secrets, you (or anyone you
hire) can take every record back with your master sheet and the partner kit (free, Apache-2.0), without
VeilCore. **In custody mode you cannot**: VeilCore holds the recovery secrets. Custody-mode partners
should ask for an export bundle regularly (monthly is our suggestion), so that they always hold a recent
copy of every secret; the agreement's continuity clause covers what VeilCore owes them if it stops
operating.

### The three ways to use VeilCore at launch

| | VeilCore-run (this) | Partner kit (self-run) | Website self-custody |
| --- | --- | --- | --- |
| Who sends transactions | VeilCore | you | you, in your browser |
| Who pays fees | VeilCore (fees per the agreement) | you (DUST) | you |
| Who holds record secrets | VeilCore, in a store of yours | you | you |
| Who holds recovery secrets | you (recommended) or VeilCore | you | you |
| You need | a safe for one sheet of paper; to leave, one recovery run with a DUST wallet | a developer, a server, a DUST wallet | a browser and a wallet |
| Available | at launch | at launch (docs/PARTNERS.md) | after launch |

---

## Part 2, the operator procedure (VeilCore staff)

### The machine

- One operations computer, used for nothing else. Disk encryption on (FileVault). Automatic login off.
  Screen lock on. Not shared.
- Node 24, Docker, this repository at a tagged commit. The proof server runs **on this machine**
  (`docker run -d -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:8.0.3 midnight-proof-server -v`);
  VeilCore-run refuses any other, because every proof sends it partners' secrets.
- Keep `~/.veilcore/managed/` out of Time Machine and cloud sync; back it up only as in Backups.
- The operator wallet (it pays fees) is VeilCore's: not the maintenance key, and not any partner's.
  Type its seed at the hidden prompt (preferred: `npm run managed` builds the kit first, and a seed in
  the environment would reach those build steps too), or have the password manager set
  `VEILCORE_WALLET_SEED` and `VEILCORE_WALLET_PASSWORD`.

### Every command

From the repository folder: `npm run managed -- <command> --partner <id> [options]`.
`npm run managed -- help` lists them all. The network is `--network` or `VEILCORE_NETWORK` (default
preprod). Each command asks for that partner's store password (hidden), does one thing, and closes the
store. Commands that send a transaction also start the operator wallet. Nothing private is ever taken
from the command line (it would stay in shell history and be visible to other programs).

### Confirming instructions

Confirm by phone or in person, with a person named in the agreement's Schedule A, before: a value claim
(`--publish-value`), an obligation release, a licence transfer or approval, an exit, and any change to
Schedule A. Pools and exit answers are confirmed by their fingerprint (below) as well.

### Onboarding a partner

1. `add-partner --partner <id> --name "<Name>"` (default: the partner keeps recovery secrets). Press Enter
   at the password question to have one made; it is shown once. Save it in the password manager as its own
   entry, "VeilCore-run: <id>". One password per partner, never reused.
2. The partner, **on their own computer**:
   `npm run managed -- partner-keys --partner <id> --out-dir <folder> --count 200 --network <network>`
   (custody mode: `--count 0`; they still need the bundle key). It writes `master-sheet.txt` (print two
   copies, then delete the file) and `recovery-pool-….json` (public), and shows a FINGERPRINT.
3. They send you the pool file. `import-pool --partner <id> --file <pool.json>`. It asks for the
   fingerprint: **the partner reads it out to you from their screen**, by phone or in person; you type it.
   It is never shown on your side, so it cannot be copied instead of heard. A mismatch is refused.
4. Sign the agreement (docs/legal/managed-service-agreement-DRAFT.md, once a lawyer has reviewed it).

### Day to day

- `anchor --label <L>`: a new record. Its secret is stored before anything is sent; running it again finishes
  one that was interrupted. When fewer than 10 recovery commitments are left it says so: ask the partner for
  a new pool (`partner-keys` with their existing master and `--start` at the next index), fingerprint again.
- `abandon --record <L>` / `abandon --licence <X>`: drop a record that was never anchored, or a licence
  requested and never countersigned.
- `date`, `seal-fields`, `pair-dna`, `prove-ownership`, `rotate`; `licence-*`; `lineage-*`; `obligation-*`
  (terms typed at the prompt, or `--terms-file`); `lab-key`, `claim`. Only on the partner's instruction,
  confirmed as above where it says so; keep the instruction with the audit log.
- `pair-dna --record <L> --report-file <file> --evidence <out.json>`: pairs a DNA report the safe way
  (design.md, rule 9). The report's hash never goes on chain, only a binding made with a random salt, which
  is stored in the vault before sending. It writes an evidence file: give it to the partner privately, to
  keep with the report. With both, anyone can check the pairing; without the salt, nobody can.
  `pair-evidence` writes the file again. Every bundle carries the salts too.
- `seal-fields --file` reads a field-set file holding hidden values. Keep such files on an encrypted
  external disk or in a temporary RAM disk, not on the operations computer's own disk, and delete them once
  in custody.
- `list --partner <id> [--chain]`: with `--chain`, for each record, whether VeilCore can still act as it
  (its stored secret is the head, or it holds the current recovery secret), and whether the exit is
  complete.
- `audit-anchor --partner <id>`: **every working day a partner had activity, and before any exit or
  purge**. It timestamps the log's head on chain; send the partner the receipt it prints.
  `audit --partner <id> --verify` checks every anchor against the chain.
- `export --out <file>`: a copy for the partner, locked to their key.

### A partner leaves

1. Agree which way (assisted or self) in writing, confirmed by phone.
2. Settle what is half-done: an exit refuses while a record was never anchored or a licence never
   countersigned (`anchor` again, or `abandon`).
3. Assisted: `exit-request --partner <id> --out request.json` (no secrets) and send it. The partner runs
   `partner-keys --partner <id> --out-dir <folder> --request request.json` on their computer (with their
   existing master and `--start`, or a new master), and sends back `exit-answer.json` (no secrets). Then
   `exit --partner <id> --mode assisted --answer exit-answer.json --out <bundle>`; the partner reads out the
   answer's fingerprint. It records the exit in the store, writes the bundle, then sends the transactions.
   If it stops part-way, fix the cause and run **the same command again with a new `--out`**: it resumes,
   finds on chain what already landed, and makes a new hand-over secret only for a record VeilCore's own
   secret still controls. A different answer is refused while an exit is under way. If it cannot finish,
   fall back to `exit --mode self`. A record whose 16 rotations are all used is not rotated: its recovery
   becomes the partner's, and the partner's recovery takes it back. Each run first reads the chain for
   anything an earlier run sent that landed unrecorded, including a hand-over that landed late: it is
   recorded as done, and the new bundle names the earlier bundle that holds its secret. Give the partner
   **every** bundle. An assisted exit that has sent nothing yet (the answer turned out unusable, the
   partner lost the new master, or they changed their mind) can be cancelled: `exit-cancel`, which checks
   the chain first and refuses once anything landed.
4. Self: `exit --partner <id> --mode self --out <bundle>`. It reads the chain first, so a recovery
   replacement or hand-over an assisted run sent is reflected, and no recovery secret the chain has made
   dead is handed over as if it worked.
5. Either way the store is retired: every command for that partner is refused.
6. The partner runs `partner-recover` and `partner-check` (required). `exit-check --partner <id>` shows when
   every record is theirs.
7. `audit-anchor`, and send the receipt.
8. When the partner confirms they opened every bundle: `purge --partner <id>` (type `PURGE <id>`). It
   deletes the secrets in the store and the bundle files VeilCore wrote, then anchors the log so the purge
   line itself is covered (it starts the operator wallet for that), and prints the receipt: send it to the
   partner. Delete the partner's password manager entry. Handle backups as below.

### Backups

A partner's store is one file (`custody.vcbox`) encrypted under that partner's password. Back up
`~/.veilcore/managed/<network>/` to an encrypted, offline disk kept at the office, never to a cloud
service, and keep a written list of backup disks and their dates. Backups are kept for [30] days at
most and then destroyed or overwritten. After a purge, a backup made earlier still holds that partner's
store (under their password) until its date comes: the agreement says so, and the partner's own recovery
step means those copies control nothing on chain by then (except licence secrets not yet moved, hidden
values and lab keys).

Deleting a file on a solid-state disk does not guarantee its contents are gone: the disk may keep old
blocks until it reuses them. FileVault protects a disk taken away while the computer is off; it does not
help against someone in control of the running computer.

### Passwords

- Store passwords: one per partner, made by `add-partner`, kept only in the password manager.
  `change-password` if one may have been seen; it says when it is done, and logs it.
- Never type a partner's store password anywhere but the `npm run managed` prompt. Never paste one into a
  chat (including Claude), an email or a document. The same rule as `docs/runbook.md`.

---

## Part 3, the security model

### What protects each partner's secrets

- **One store per partner.** Folder `~/.veilcore/managed/<network>/<id>/` (0700), file `custody.vcbox`
  (0600). Encrypted with a key made from that partner's password by **scrypt (N = 2^17, r = 8, p = 1)**,
  about half a second and 128 MiB per guess, then **AES-256-GCM**. The partner id, network and file kind
  are authenticated with the data, so one partner's file cannot be swapped in for another's. A file
  others can read, or a link, is refused. One command at a time per partner: the lock is taken before the
  store is read.
- **Bundles are sealed to the partner's key** (X25519, HKDF-SHA256, AES-256-GCM, a fresh key pair per
  bundle). The private key is derived from the partner's master on their computer. Nothing on VeilCore's
  side opens a bundle, and no bundle passphrase is ever typed there. VeilCore does not print sheets of
  secrets; the partner prints their own.
- **Never in the operator's own state.** The chain clients run with in-memory private state
  (`memoryPrivateState`); each command gives the one record secret it needs, for that command. Nothing a
  partner owns is written to the CLI's store, the wallet's progress file or any log.
- **Never printed or logged.** Output passes through a filter that removes every secret of the open store
  and every password typed; errors are shown the same way. The vault object prints as
  `PartnerVault { …, secrets: [redacted] }`. The audit log refuses any line that contains a secret. The
  tests check all of this (`veilcore-run/test/`).
- **Stored before used.** Every new secret (record, recovery, licence, rotation target, obligation salt)
  is written to the store before the transaction that uses it: written to a new file, flushed, then renamed
  into place. The folder itself is not flushed after the rename, and on macOS a flush is not a guaranteed
  write to the disk platter or flash; so after a sudden power cut the previous version of the store can
  come back. Running the command again finds on chain what landed.
- **The partner kit's public surface only.** VeilCore-run imports nothing but `@veilcore/contracts`
  (checked by a test), so it can do exactly what a partner's own developer could, and nothing of VeilCore's
  operator powers (deploy, circuit keys, the maintenance authority) is in reach.
- **A local proof server only.** Every proof sends the proof server its private inputs.
- **Instructions confirmed.** Pools and exit answers decide who controls records afterwards, so they are
  accepted only with the fingerprint the partner reads out.

### What the audit log proves, and what it does not

Each line carries the hash of the line before it, and a line is written before each transaction is sent
as well as after. On its own that shows accidental damage and a careless edit. It does **not** stop
VeilCore, the party being audited and the only one who can write the file, from rewriting the whole log
from some line onward, or cutting its end off: the hashes can simply be recomputed.

What does: **anchors**. `audit-anchor` timestamps the hash of the log's latest line on the chain, where
VeilCore cannot change it, and the partner gets a receipt (line number, hash, transaction). Afterwards,
any change to that line or any line before it shows (`audit --verify`, or the partner checking their
receipts, `partner-check-receipt`: the line's hash, every line before it following on, and the
timestamp on chain), and so does a log cut short before it, even if the anchor lines themselves were
removed. Bundles carry the log's lines exactly as written, so the partner can check without VeilCore. What
happened after the latest anchor is covered only by the next one. The log is not encrypted, so the
operator can read it without the partner's password; it links the partner to their records' public
fingerprints, which the chain alone does not, so it is kept 0600 like the store.

### What it does not protect against

- **JavaScript cannot reliably wipe memory.** While a command runs, the secrets it uses are in the
  process's memory (and could reach swap). Keys and buffers are overwritten where Node allows; text copies
  of secrets cannot be.
- **A copy of a file is a copy.** Deleting or purging does not reach backups until they expire, nor blocks
  an SSD has not yet reused.
- **The operator is trusted.** The agreement, the second-channel confirmations and the anchored audit log
  are what stand between VeilCore and misuse. Nothing technical stops VeilCore, while it holds a record
  secret, from acting as that record.

### If VeilCore's operations computer is compromised

Honestly, this is what it means.

**Stolen files only** (a lost laptop, a stolen backup): each store is scrypt-encrypted under a long random
password. With the passwords VeilCore-run makes (32 random characters), guessing one is not practical.
Weak, reused or written-down passwords change that. Bundles on the disk are locked to partners' keys.

**Someone controlling the running computer** (malware, remote access): they can capture each partner's
password as it is typed, and so every store opened while they are in. For each such partner they can:

- act as every record, until the partner takes it back: prove control, issue licences, pair reports,
  propose and confirm parentage, release obligations owed to the partner, make claims (including
  publishing values), present licences the partner holds, sign as the partner's laboratory;
- move records to secrets of their own;
- **during an assisted exit**, read the new hand-over record secrets from the program's memory as they are
  made. That is why the partner's own recovery is a required step of every exit, not an option: after it,
  nothing VeilCore's software made or held controls the record.

What happens next depends on who holds the recovery secrets:

- **The partner holds them (recommended):** the attacker cannot touch them. The partner recovers each
  record with their master sheet and takes it straight back, whatever the attacker did with the record
  secrets. What the attacker already did stays done: a published value, a confirmed parentage, a released
  obligation, a licence presented or issued in the meantime. Licences the partner holds must be moved (the
  issuer approves); lab keys replaced.
- **VeilCore holds them (custody mode):** the attacker can use the recovery secret to move a record to
  secrets of their own **and** install a recovery commitment of their own in the same transaction. Then the
  record is theirs, for good; no one can take it back. Whoever acts first wins: on discovering a compromise,
  VeilCore would immediately, from a clean computer and the offline backup, recover each custody record to
  new secrets with recovery commitments the partners make. That is a race, not a guarantee.

**What VeilCore does on discovering a compromise:** stop the computer; tell every partner the same day
with what is known; for custody partners, start the recovery race above from a clean machine; for
partner-held recovery, help each partner run `partner-recover`; move the operator wallet; publish what
happened. `docs/incident-response.md` applies.

---

## Part 4, for a partner's developer

### The bundle file

A `.vcb` file is JSON:

```
{ "format": "veilcore-run/sealed/1", "kind": "exit-bundle", "partner": "<id>", "network": "<network>",
  "recipient": "<the partner's X25519 public key, hex>", "ephemeral": "<X25519 public key, hex>",
  "cipher": "aes-256-gcm", "iv": "<hex, 12 bytes>", "tag": "<hex, 16 bytes>", "ciphertext": "<base64>" }
```

Shared secret: X25519(partner private key, ephemeral). Key: HKDF-SHA256(shared, salt = ephemeral ||
recipient (raw bytes), info = "veilcore-run/v1/sealed", 32 bytes). Additional authenticated data: the UTF-8
JSON of `[format, kind, partner, network, recipient, ephemeral, cipher, iv]`. The plaintext is JSON:
`vault.records[]` (`secret`, `pendingSecret` = the hand-over secret of an assisted exit, `origin`,
`current`, `recovery`), `vault.licences[]`, `vault.obligations[]`, `vault.fieldSets[]` (`file` is a
field-set file the kit's `sealFields` takes), `vault.labKeys[]` (`secret` is the scalar in hex:
`labKeyOf(BigInt('0x' + secret))`), `handover[]`, `earlierBundles[]`, `procedure`, `audit[]`. Or run
`npm run managed -- open-bundle --file <bundle> --out <json>`.

### What derives from the master

```
bundle key (X25519 private)  = HMAC-SHA256(master, "veilcore-run/v1/bundle-key")
recovery secret i            = HMAC-SHA256(master, "veilcore-run/v1/recovery/" + i)
licence secret j             = HMAC-SHA256(master, "veilcore-run/v1/licence/" + j)
own record secret (origin,n) = HMAC-SHA256(master, "veilcore-run/v1/own-record/" + origin + "/" + n)
own recovery secret          = HMAC-SHA256(master, "veilcore-run/v1/own-recovery/" + origin + "/" + n)
```

`origin` is the record's anchored commitment in lower-case hex; `n` is 0 unless a generation is taken.
Each record's `recovery.pool.index` says which `i` its current recovery secret is. `partner-recover`
does `vc.recoverRecordSecret({ originalRecord: origin, recoverySecret, newRecordSecret: own record secret,
newRecoveryCommitment: commit.recovery(own recovery secret) })`; `partner-check` re-derives both and
compares them with the chain.

---

## Why exit works the way it does (what the contract allows)

- `rotateRecordSecret` needs the current record secret **and** the new one: the circuit checks that the
  caller holds the secret behind the new commitment. So VeilCore cannot rotate a record to a secret only
  the partner has seen. Whoever sends a rotation holds the new secret, at least for that moment.
- `replaceRecoveryCommitment` needs only the current recovery secret and the new **commitment**. So where
  VeilCore holds a recovery secret, it can install one the partner made without seeing it.
- `recoverRecordSecret` takes an identity from whoever holds its record secret, and installs a new
  recovery commitment in the same transaction. It is the one step that leaves nothing VeilCore's software
  made or held in control, and only the partner can send it with their own recovery secret: so it is the
  required last step of every exit.
- `proposeTransfer` moves a licence to a commitment the partner made; the issuer approves.

## Limits, and what is not built

- One command per run (each starts the operator wallet): fine for a few partners, slow for many. A
  long-running service with a queue is later work.
- Instructions from partners arrive outside the tool (email, phone). There is no partner login.
- No hardware security module: secrets are bytes in a file, encrypted.
- The partner's last step of an exit needs a DUST wallet and someone able to run one command; VeilCore
  cannot pay for it without seeing the partner's recovery secret (fee sponsorship is not in service).
- The website self-custody option is after launch.
- No independent security audit of VeilCore-run yet; one AI review (`review-managed.md`), whose findings
  this version addresses.
