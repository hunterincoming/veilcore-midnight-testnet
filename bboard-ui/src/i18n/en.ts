// English: the source text. Every other language translates this file key by key; a
// key a translation leaves out shows in English.
// SPDX-License-Identifier: Apache-2.0

export const en = {
  // Header and footer
  'nav.newCultivar': 'New cultivar',
  'nav.licenses': 'Licenses',
  'nav.language': 'Language',
  'footer.about':
    'An open record format for plant genetics. Checking a record you hold needs only SHA-256 and the open specification: it is free and needs no account. Looking a record up by its identifier on this site uses our server.',
  'footer.documents': 'Documents',
  'footer.spec': 'Specification',
  'footer.evidence': 'Records in evidence',
  'footer.integrate': 'Integration guide',
  'footer.source': 'Source',
  'footer.allImplementations': 'All three implementations',
  'footer.referenceImplementation': 'Reference implementation',
  'footer.rustImplementation': 'Rust implementation',
  'footer.thisSite': 'This site',
  'footer.whatThisIs': 'What this is',
  'footer.yourRecords': 'Your records',
  'footer.agreements': 'Agreements',
  'footer.privacy': 'Demo privacy',
  'draft.banner':
    'Draft translation, not yet checked by a fluent speaker. The English page is the authoritative version.',
  'draft.showEnglish': 'Show English',

  // Public pages (home and founders), laid out from Mako's 25 September templates.
  'm.nav.about': 'About',
  'm.nav.team': 'Team',
  'm.nav.updates': 'Updates',
  'm.nav.spec': 'Spec',
  'm.nav.demo': 'Try the demo',
  'm.nav.menu': 'Menu',

  'm.hero.label': 'Proof of what you hold',
  'm.hero.title1': 'Prove you had it first.',
  'm.hero.title2': 'Without showing anyone what it is.',
  'm.hero.lede':
    'For plant breeders, seed companies and labs: an open record format for plant genetics. Your genetic data stays with you. Only a fingerprint is recorded on a public blockchain (Midnight), and once it is anchored, anyone can check its date.',
  'm.hero.chooseDemo': 'Choose a demo',
  'm.hero.how': 'How it works',
  'm.hero.cultivar': 'Cultivar',
  'm.hero.bredBy': 'Bred by',
  'm.hero.bredByDefault': 'Your name here',
  'm.hero.demoLabel': 'Live fingerprint demo',
  'm.hero.note':
    "Change anything above; it stays on this page. The line in mint is the fingerprint: thirty-two bytes that can't be reversed, because a random value is mixed in. It's the only part this demo would publish.",

  'm.choose.label': 'Start here',
  'm.choose.title': 'Where do you want to go?',
  'm.choose.about.title': 'About',
  'm.choose.about.text': "What the format is, how it works, and what it doesn't do.",
  'm.choose.about.go': 'Read →',
  'm.choose.demo.title': 'Demo',
  'm.choose.demo.text': 'Make a record or verify one.',
  'm.choose.demo.go': 'Choose a demo →',
  'm.choose.team.title': 'Team',
  'm.choose.team.text': 'Two founders, in Tokyo and New Jersey.',
  'm.choose.team.go': 'Meet them →',
  'm.choose.updates.title': 'Updates',
  'm.choose.updates.text': 'What changed, what shipped, and what we learned.',
  'm.choose.updates.go': 'Latest →',

  'm.about.label': 'About',
  'm.about.title1': 'An evidentiary record format',
  'm.about.title2': 'for plant genetics.',
  'm.about.lede':
    "When genetics turn up somewhere they shouldn't, every dispute comes down to one question: what did you have, and when? Notebooks and lab reports are dated by whoever holds them. The usual fix, a shared registry, asks everyone to hand over the very thing they're protecting. VeilCore does neither.",
  'm.step1.n': '01 · Record',
  'm.step1.title': 'Describe the lot',
  'm.step1.text': 'A breeder or lab writes a record of the material: what it is, where it came from, test results.',
  'm.step2.n': '02 · Fingerprint',
  'm.step2.title': 'Hash it locally',
  'm.step2.text': 'A 32-byte fingerprint is computed on your own computer. Genetic data and lab files never leave it.',
  'm.step3.n': '03 · Anchor',
  'm.step3.title': 'Publish the date',
  'm.step3.text':
    'Only the fingerprint is timestamped on a public network (Midnight). The date is set by the network, not by us, and stays in its public history. In the demo, our operator anchors records in batches, not instantly.',
  'm.step4.n': '04 · Verify',
  'm.step4.title': 'Show it later',
  'm.step4.text':
    'Show the record to a buyer, inspector or court. Anyone can check it matches, for free and with no account.',
  'm.is.title': 'What it is',
  'm.is.1a': 'Proof of prior possession:',
  'm.is.1b': 'what you held, and when.',
  'm.is.2a': 'No custody of genetics:',
  'm.is.2b': 'genetic data and lab files never reach us.',
  'm.is.3a': 'An open format:',
  'm.is.3b': 'free to implement, free to verify, with a published spec.',
  'm.is.4a': 'Licences:',
  'm.is.4b':
    'grant rights to a record. A licensee can prove a licence is valid without revealing which licence it is or who holds it.',
  'm.is.5a': 'Agreed lineage:',
  'm.is.5b':
    'a parent link counts only when both holders confirm it. Obligations such as royalties carry only to descendants declared this way, until the beneficiary releases them. VeilCore records what is owed; it does not collect it.',
  'm.isnt.title': "What it isn't",
  'm.isnt.1a': 'Not ownership.',
  'm.isnt.1b': "It creates no legal right you don't already have.",
  'm.isnt.2a': 'Not a truth machine.',
  'm.isnt.2b': "It proves when you wrote something, not that it's true.",
  'm.isnt.3a': 'Not a DNA test.',
  'm.isnt.3b': 'It complements one, so a result still means something years later.',
  'm.isnt.4a': 'Not a pedigree test.',
  'm.isnt.4b': 'A parent link means both holders agreed, not that DNA proves it.',

  'm.demo.label': 'Demo',
  'm.demo.title1': 'Pick how you',
  'm.demo.title2': 'want to see it.',
  'm.demo.lede':
    'No account, no wallet. Genetic data and lab files stay in your browser. The demo keeps the rest of a record (names, dates, fingerprint) on our test server so you can come back to it, so please use made-up details. Licensing in the demo is simulated: nothing is sent to the network.',
  'm.demo.create.title': 'Create a record',
  'm.demo.create.text': 'Fill in a sample record, generate its fingerprint and download the certificate.',
  'm.demo.verify.title': 'Verify a record',
  'm.demo.verify.text': "Enter a record's identifier and see what its holder disclosed and whether it is anchored.",
  'm.demo.video.title': 'Watch the walkthrough',
  'm.demo.video.text':
    'The whole flow in 75 seconds: sealing a record, pairing a lab report, checking it, and licence terms.',
  'm.chip.video': 'Video',
  'm.chip.75s': '75 s',
  'm.chip.interactive': 'Interactive',
  'm.chip.3min': '~3 min',
  'm.chip.1min': '~1 min',

  'm.team.label': 'Team',
  'm.team.title1': 'Two founders.',
  'm.team.title2': 'Tokyo and New Jersey.',
  'm.team.more': 'Full profiles →',
  'm.mako.role': 'Co-Founder & CEO · Tokyo',
  'm.mako.short': 'Commercial lead: standards and plant-rights bodies in Japan and the EU.',
  'm.hunter.role': 'Co-Founder & COO · New Jersey',
  'm.hunter.short': 'Builds the contract, app and API. Leads US outreach.',

  'm.updates.label': 'Updates',
  'm.updates.title1': 'Latest from',
  'm.updates.title2': 'the build.',
  'm.updates.read': 'Read →',
  'm.updates.all': 'Record-format changes on GitHub →',
  'm.updates.follow': 'Follow',
  'm.post1.date': '3 Oct 2026',
  'm.post1.tag': 'Format',
  'm.post1.title': 'Three implementations, one answer',
  'm.post1.text':
    'A differential test found our TypeScript, Python and Rust implementations disagreeing on some numbers. Fixed: they now agree on every one of 81,000 inputs, and 55 conformance vectors pin it.',
  'm.post2.date': '2 Oct 2026',
  'm.post2.tag': 'Contract',
  'm.post2.title': "A full run on Midnight's test network",
  'm.post2.text':
    "The contract deployed to Midnight's test network and passed all 26 end-to-end checks, using 16 of its 24 operations with real proofs.",
  'm.post3.date': '25 Aug 2026',
  'm.post3.tag': 'Contract',
  'm.post3.title': 'Why a licence transfer is an assignment',
  'm.post3.text': 'We redesigned transfer after finding that the old version let the outgoing party keep its powers.',

  'm.status.label': 'Where this is',
  'm.status.title1': 'Straight about',
  'm.status.title2': 'where we are.',
  'm.status.lede': "We'd rather say this now than have it come out later.",
  'm.stat1.b': '55 / 55',
  'm.stat1.s': 'conformance vectors passed by implementations in three languages (written by the same team)',
  'm.stat2.b': 'Test net',
  'm.stat2.s': "Tested on Midnight's test network. Not on the live network yet.",
  'm.stat3.b': 'No audit',
  'm.stat3.s': 'No independent security audit yet. Our own reviews are published in the repository.',
  'm.stat4.b': 'No users yet',
  'm.stat4.s': "Nobody is using it for real records yet. We're looking for the first.",
  'm.status.keyTitle': 'Who can change the contract.',
  'm.status.keyText':
    "The founders hold a maintenance key for VeilCore's contract on Midnight. It can change how the contract works from then on. It cannot rewrite records already anchored in the network's history. A policy for using it is proposed, not decided.",
  'm.status.keyLink': 'Read the proposed policy →',

  'm.contact.label': 'Get in touch',
  'm.contact.title1': 'Tell us',
  'm.contact.title2': 'where it fails.',
  'm.contact.lede':
    "If you run a breeding programme, a lab, a seed certification agency or a plant-rights body, we'd like to talk. Checking and implementing are free. Nothing is priced yet.",
  'm.contact.email': 'Email the founders',
  'm.contact.spec': 'Read the spec',

  'm.foot.about':
    "An evidentiary record format for plant genetics. Designed to anchor on Midnight; testing on Midnight's test network.",
  'm.foot.explore': 'Explore',
  'm.foot.build': 'Build',
  'm.foot.contact': 'Contact',
  'm.foot.verify': 'Verify a record',
  'm.foot.fine': 'Proof of prior possession, not ownership.',
  'm.foot.privacy': 'Demo privacy',

  'm.verify.label': 'Verify',
  'm.verify.title': 'Check a record',
  'm.verify.lede':
    'Enter the record identifier printed on a certificate or shared with you. You will see what its holder chose to disclose, and whether it is intact.',
  'm.verify.field': 'Record identifier',
  'm.verify.go': 'Check it',

  'm.founders.label': 'Founders',
  'm.founders.lede':
    'VeilCore is an evidentiary record format for plant genetics. It gives proof of prior possession without anyone handing over their genetic data.',
  'm.founders.leads': 'Leads',
  'm.founders.also': 'Also',
  'm.founders.languages': 'Languages',
  'm.mako.bio1':
    "Makoto (Mako) Steiner is VeilCore's co-founder and CEO, leading commercial strategy, fundraising, and outreach to institutions and investors worldwide.",
  'm.mako.bio2': 'He studied Environmental Studies at Denison University and is based in Tokyo.',
  'm.mako.leads': 'Japan|EU|Standards bodies|Business development',
  'm.mako.also': 'Midnight Nightforce Leader (Japan) · Build Club, Cohort 1',
  'm.mako.languages': 'English · Japanese',
  'm.hunter.bio1':
    "Hunter Roberts is VeilCore's co-founder and COO, leading product and the VeilCore protocol, from the record format to the contract on Midnight. He leads VeilCore's outreach to US institutions, including seed certification, standards and plant-variety bodies.",
  'm.hunter.bio2':
    "He comes from hands-on plant work, including breeding and tissue culture, and is building Chunk's Trees, a cultivation facility in New Jersey.",
  'm.hunter.leads': 'United States|Protocol & spec|Engineering',
  'm.hunter.also': 'Midnight Nightforce Leader (US) · Build Club, Cohort 1',
  'm.founders.band1': "Talk to us. We'd",
  'm.founders.band2': 'rather hear where it fails',
  'm.founders.band3': 'than be told it works.',
  'm.founders.bandText':
    "If you run a breeding programme, a lab, a seed certification agency or a plant-rights body, we'd like to talk. The format is free to implement and free to verify.",
  'm.founders.emailBoth': 'Email both founders',
  'm.portraitOf': 'Portrait of {name}',

  // Demo privacy note (/privacy). Only facts that are true of the demo today.
  'm.privacy.label': 'Demo privacy',
  'm.privacy.title': 'What the demo keeps.',
  'm.privacy.lede':
    "This note covers the demo on this site. It is a test, on Midnight's test network. Please use made-up data.",
  'm.privacy.stored.title': 'Stored on our test server',
  'm.privacy.stored.text':
    "What you type and what the app computes from it: cultivar and breeder names, species if you enter one, dates, notes, reference numbers, parents, fingerprints of records, photos and lab reports, lab report file names, agreement terms and counterparties, material you send to a lab (who it is addressed to, and the quantity), and, for labs, the public signing key and the attestations they publish. Also your holder key, which the app sends with every save so the server can find your records. The server is VeilCore's test registry, hosted on Railway.",
  'm.privacy.local.title': 'Never leaves your browser',
  'm.privacy.local.text':
    'Genetic data, lab and DNA report files, and photos. The app reads them in your browser to compute their fingerprints. The files themselves are never uploaded.',
  'm.privacy.test.title': 'A test network',
  'm.privacy.test.text':
    "The demo uses Midnight's test network, not the live one. Demo data may be deleted when the test network is reset.",
  'm.privacy.madeup.title': 'Use made-up data',
  'm.privacy.madeup.text':
    "Please don't enter real names, real varieties or anything confidential. The demo is for trying the format.",
  'm.privacy.export.title': 'Export',
  'm.privacy.export.text':
    'Your records page has an Export button that downloads the records this browser holds. A single download of everything our server holds for you is coming; it is not available yet.',
  'm.privacy.delete.title': 'Deletion',
  'm.privacy.delete.text':
    'To have your demo data deleted from our server, email hunter@veilcore.org with the identifiers of your records.',
  'm.privacy.contact': 'Questions: hunter@veilcore.org',
} as const;

export type StringKey = keyof typeof en;
export type Strings = Partial<Record<StringKey, string>>;
