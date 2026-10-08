// The English strings that differ in a mainnet build (`--mode mainnet`). en.ts holds the
// test-network wording; in a mainnet build every key here replaces it, in every language,
// because a draft translation of the test-network sentence would be wrong on mainnet.
//
// Written before the launch, to be true once it has happened: the main contract is on
// Midnight's main network, VeilCore anchors this site's records there in batches (by hand
// for now: the operator seals a batch and anchors its root, see the registry README, so a
// new record can wait a while), and the site still sends no transactions itself
// (licenses and lab agreements are simulated; a DNA report pairing is saved but not
// dated). Records sealed here are real records, so the mainnet site doesn't call itself
// a demo; only the simulated parts are named as simulated. The claims contract deploys right after the main one; until its address is
// pinned, the strings say it is not on the main network yet. A mainnet build cannot
// happen before the main contract's address is pinned (vite.config.ts), so none of this
// can be published early.
//
// The maintenance key: the site says the policy is decided only when
// docs/maintenance-policy.md's own status line says APPROVED (read at build time,
// scripts/maintenance-policy.mjs). The claims contract's lack of a maintenance key is
// mentioned only once its address is pinned: the operator tool deploys it on mainnet
// only with the authority retired (assertClaimsDeployAllowed, api/src/claims-api.ts).
//
// The dated update posts keep the network they ran on (Midnight's preprod test
// network): they are history, and the tests exempt them by key (DATED_POSTS).
//
// Every user-visible string here is listed for fact-checking in
// scratchpad/site-mainnet/new-copy.md.
// SPDX-License-Identifier: Apache-2.0

import type { StringKey } from './en';

type Overlay = Partial<Record<StringKey, string>>;

const common: Overlay = {
  'm.hero.status':
    "Now on Midnight's main network: we anchor records there in batches, by hand for now. Records sealed on this site are real records; licenses and lab agreements here are still simulated.",
  'm.faq.3a':
    "It's built to be evidence, and our note for lawyers says what a record proves and what it doesn't. Records are now anchored on Midnight's main network, in batches. Once a record's batch is anchored, the date shows the record existed by then; what that's worth in a dispute is for the court to weigh.",
  'm.stat2.b': 'Main network',
  'm.foot.about': "An open record format for plant and animal genetics, dated on Midnight's main network.",
  'm.get.2b':
    "Licenses and lab agreements attach to the record. A licensee can prove they hold a live license without showing which one. An obligation on a parent, such as a royalty, shows on every offspring both holders confirmed; VeilCore records it and doesn't collect it. Built into the contract on Midnight's main network; simulated on this website.",
  'm.demo.lede':
    "No sign-up, no wallet. Records you seal here are real records: each goes into a batch that we anchor on Midnight's main network, by hand for now, so a new record can wait a while; its check page shows when its batch is anchored. Checking is free. Licenses and lab agreements are simulated, and DNA report pairings aren't dated. Don't type anything you need to keep secret.",
  // Dated posts: history, so they name the network the run was on (see DATED_POSTS).
  'm.post0.text':
    "Both contracts passed all 37 end-to-end checks on Midnight's preprod test network, including the new claims: a value, a range, a difference, an unchanged correction and a signature from a test lab key. Made-up marker data.",
  'm.post2.title': "A full run on Midnight's preprod test network",
  'm.post2.text':
    "The contract deployed to Midnight's preprod test network and passed all 26 end-to-end checks, using 16 of its 24 operations with real proofs.",
  'm.contact.1p': 'Make a record, then tell us what is missing for your work.',

  // Records made here are real on mainnet: no "demo" labels.
  'm.nav.demo': 'Make a record',
  'm.foot.demo': 'Make a record',
  'm.hero.demoLabel': 'Live fingerprint',
  'm.demo.label': 'Use it',
  'm.demo.title1': 'Pick where',
  'm.demo.title2': 'to start.',
  'm.demo.create.text': 'Fill in a record, generate its fingerprint and download the certificate.',
  'm.demo.privacy': 'What this site keeps →',
  'm.faq.4link1': 'What this site keeps →',
  'm.faq.2a':
    'No. Making a record on this site and checking any record need no wallet, no sign-up and nothing to buy. Your browser keeps a random key that finds your records on our server. The fingerprint goes on Midnight, a blockchain built for privacy. You never deal with it directly.',
  'm.for.1p':
    "Seal a record and pair its DNA report. If the plant turns up under another name, a lab can compare a new test with your report. When you pair through VeilCore's contract on Midnight, the report's fingerprint is dated too, so your record shows you had that report by then. On this website the pairing is saved with your record but not yet dated. VeilCore doesn't test DNA.",
  'm.for.3p':
    "Put terms on material before it ships: what it's for, no propagation, return or destroy it after. Through VeilCore's contract on Midnight, the lab confirms receipt with its own key, so the record shows a second party, which protects the lab as much as the client. On this website it is simulated.",
  'm.for.5p':
    "Herd books keep the pedigree. A record can give each entry a date nobody can backdate, without publishing the genotype. The format covers animals; this website is set up for plants, and the animal record fields aren't published yet.",
  'footer.privacy': 'Site privacy',
  'm.foot.privacy': 'Site privacy',
  'm.privacy.label': 'Site privacy',
  'm.privacy.title': 'What this site keeps.',

  'm.privacy.lede':
    "This note covers this website. Records you seal here are real records: they go into batches that we anchor on Midnight's main network.",
  'm.privacy.stored.title': 'Stored on our server',
  'm.privacy.stored.text':
    "What you type and what the app computes from it: cultivar and breeder names, species if you enter one, dates, notes, reference numbers, parents, fingerprints of records, fingerprints of photos and lab reports (only the fingerprints, never the files), lab report file names, agreement terms and counterparties, material you send to a lab (who it is addressed to, and the quantity), and, for labs, the public signing key and the attestations they publish. Also your holder key, which the app sends with every save so the server can find your records. The server is VeilCore's registry, hosted on Railway.",
  'm.privacy.test.title': "Dated on Midnight's main network",
  'm.privacy.test.text':
    "Your record's fingerprint goes into a batch, and we anchor the batch on Midnight's main network, by hand for now, so it can take a while. Only the batch's fingerprint goes on the network, never what you typed. Once anchored, it is permanent: nobody, including us, can delete it.",
  'm.privacy.madeup.title': 'Type only what you are happy for us to keep',
  'm.privacy.madeup.text':
    "Everything you type is kept on our server, and a record's cultivar name is shown on its public check page. Don't type anything you need to keep secret. Genetic data and lab files stay on your computer.",
  'm.privacy.delete.text':
    "We can delete what our server holds for your records: email hunter@veilcore.org with the records' identifiers. A batch fingerprint already anchored on Midnight stays there.",
};

/** The claims contract's address is pinned: it is on the main network. */
const claimsLive: Overlay = {
  'm.claims.status':
    "A second Midnight contract, on Midnight's main network. Before launch it passed every end-to-end check, with made-up marker data. It isn't on this website yet.",
  'm.stat2.s':
    "Both contracts are on Midnight's main network. We anchor this site's records there in batches, by hand for now.",
};

/** Not pinned yet: the main contract is live, the claims contract is still to follow. */
const claimsPending: Overlay = {
  'm.claims.status':
    "A second Midnight contract. It passed every end-to-end check in pre-launch testing, with made-up marker data. It isn't on Midnight's main network yet, and isn't on this website.",
  'm.stat2.s':
    "The main contract is on Midnight's main network, and we anchor this site's records there in batches, by hand for now. The claims contract follows.",
};

/**
 * The update posts that are dated history. They say "preprod test network" on the mainnet
 * site too, because that is where those runs happened.
 */
export const DATED_POSTS: readonly StringKey[] = ['m.post0.text', 'm.post2.title', 'm.post2.text'];

const KEY_HOLDERS =
  "One maintenance key, kept on paper, with a copy held by each founder, can change how VeilCore's main contract on Midnight works from then on. It cannot rewrite records already anchored in the network's history.";
const CLAIMS_NO_KEY = ' The claims contract has no maintenance key: nobody, including us, can change it.';

/** Who can change the contracts. "Decided" only when the policy's status line says APPROVED. */
const keyStrings = (claimsOnMainnet: boolean, policyApproved: boolean): Overlay => ({
  // Both contracts are shown once the claims address is pinned; otherwise the title stays singular.
  ...(claimsOnMainnet ? { 'm.status.keyTitle': 'Who can change the contracts.' } : {}),
  'm.status.keyText':
    KEY_HOLDERS +
    (policyApproved
      ? ' Every use is announced publicly, under a written maintenance policy.'
      : ' A policy for using it is proposed, not decided.') +
    (claimsOnMainnet ? CLAIMS_NO_KEY : ''),
  'm.status.keyLink': policyApproved ? 'Read the maintenance policy →' : 'Read the proposed policy →',
});

/** The overlay for a mainnet build. */
export const mainnetStrings = ({
  claimsOnMainnet,
  policyApproved,
}: {
  claimsOnMainnet: boolean;
  policyApproved: boolean;
}): Overlay => ({
  ...common,
  ...(claimsOnMainnet ? claimsLive : claimsPending),
  ...keyStrings(claimsOnMainnet, policyApproved),
});
