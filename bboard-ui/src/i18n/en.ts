// English: the source text. Every other language translates this file key by key; a
// key a translation leaves out shows in English.
// SPDX-License-Identifier: Apache-2.0

export const en = {
  // Header and footer
  'nav.newCultivar': 'New cultivar',
  'nav.licenses': 'Licenses',
  'nav.language': 'Language',
  'footer.about':
    'An open record format for plant and animal genetics. Checking a record you hold needs only SHA-256 and the open specification: it is free and needs no account. Looking a record up by its identifier on this site uses our server.',
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
  //
  // MAINNET DAY: the strings that must change the day the contracts are live on Midnight's
  // main network are grouped here, together. Also index.html (meta description) and the
  // vendored INTEGRATING.md, which come from the SDK.
  'm.hero.status':
    "Launching on Midnight's main network. Today records are dated on its test network, which carries no legal weight.",
  'm.claims.status':
    "A second Midnight contract, tested end to end on Midnight's test network on 4 October 2026 with made-up marker data. It isn't in this web demo or on the main network yet.",
  'm.faq.3a':
    "It's built to be evidence, and our note for lawyers says what it proves and what it doesn't. Today it runs on Midnight's test network, and a test-network date carries no legal weight. The main network launch is close.",
  'm.stat2.b': 'Test network',
  'm.stat2.s': "Both contracts tested end to end. Not on Midnight's main network yet.",
  'm.foot.about':
    "An evidentiary record format for plant and animal genetics. Designed to anchor on Midnight; testing on Midnight's test network.",
  'm.for.2p':
    "Examiners and certifiers want marker evidence, and your markers are trade secrets. A VeilCore claim proves one fact about them without showing the rest. No examining office or certifier accepts it yet; we're asking them what they would need.",
  // End of MAINNET DAY strings.

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
    'For breeders, seed companies and labs working with plant and animal genetics. Your genetic data stays on your computer. Only a fingerprint is published, on Midnight, and anyone can check its date. Free to check. No account, no wallet.',
  'm.hero.how': 'How it works',
  'm.hero.cultivar': 'Cultivar',
  'm.hero.bredBy': 'Bred by',
  'm.hero.bredByDefault': 'Your name here',
  'm.hero.demoLabel': 'Live fingerprint demo',
  'm.hero.note':
    'Type in either box; nothing is sent. The mint line is the fingerprint, the only part that would be published. Nobody can work back from it to what you typed.',

  'm.for.label': "What it's for",
  'm.for.title1': 'Every dispute asks one thing:',
  'm.for.title2': 'what did you have, and when?',
  'm.for.lede':
    "Notebooks and lab reports are dated by whoever holds them, so they're easy to doubt. A shared registry means handing over what you're protecting. VeilCore gives your record a date nobody can backfill, and the genetics stay with you.",
  'm.for.1t': 'A cutting walks out the door.',
  'm.for.1p':
    "Seal a record and pair its DNA report. If the plant turns up under another name, a lab can compare it with your report, and your record shows you had that report by its date. VeilCore doesn't test DNA; it makes your test count later.",
  'm.for.2t': 'Variety protection and certification.',
  'm.for.2link': 'How a claim works →',
  'm.for.3t': "Material in a lab's hands.",
  'm.for.3p':
    "Put terms on material before it ships: what it's for, no propagation, return or destroy it after. The lab confirms receipt with its own key, so the record shows a second party, which protects the lab as much as the client.",
  'm.for.4t': 'Signing test results.',
  'm.for.4p':
    "The signature covers the exact report file and the record it's about, so it can't be moved or kept on an edited copy. Only the lab can withdraw it. VeilCore records who signed; it never vouches.",
  'm.for.5t': 'Animal lines.',
  'm.for.5p':
    "Herd books keep the pedigree. A record can give each entry a date nobody can backfill, without publishing the genotype. The format covers animals; this demo is set up for plants, and the animal record fields aren't published yet.",
  'm.for.5ask': 'If you breed animals, tell us what your records need.',

  'm.how.label': 'How it works',
  'm.how.title1': 'Four steps.',
  'm.how.title2': 'The genetics stay with you.',
  'm.step1.n': '01 · Record',
  'm.step1.title': 'Write it down',
  'm.step1.text': 'What it is, where it came from, test results.',
  'm.step2.n': '02 · Fingerprint',
  'm.step2.title': 'Fingerprint it',
  'm.step2.text': 'Done on your computer. Genetic data and lab files never leave it.',
  'm.step3.n': '03 · Anchor',
  'm.step3.title': 'Get a date',
  'm.step3.text': 'Only the fingerprint goes on Midnight. The network sets the date, not us.',
  'm.step4.n': '04 · Verify',
  'm.step4.title': 'Show it later',
  'm.step4.text': 'Give it to a buyer, examiner or court. They can check it, free, with no account.',

  'm.claims.label': 'Prove one fact',
  'm.claims.title1': 'Show the answer.',
  'm.claims.title2': 'Keep the data.',
  'm.claims.lede':
    'A record can seal up to sixteen values, like marker results or a germination rate. Later you prove one fact about them. Nothing else is shown.',
  'm.claims.1t': 'A value is what you say it is.',
  'm.claims.1p': 'That one value is shown. The rest stay sealed.',
  'm.claims.2t': 'A number clears a bar.',
  'm.claims.2p': 'For example, germination of at least 95%. The number itself stays hidden.',
  'm.claims.3t': 'Two varieties differ.',
  'm.claims.3p':
    "In at least a set number of marker values. Which ones differ stays private. Whether that makes a variety distinct is the examiner's call, not ours.",
  'm.claims.4t': 'A correction left the rest alone.',
  'm.claims.4p': "After you correct a record, prove the values you didn't touch are unchanged.",
  'm.claims.5t': 'A lab signed the values.',
  'm.claims.5p': 'So the claim is about values a lab sealed, not numbers you typed.',
  'm.claims.limitsTitle': 'Limits.',
  'm.claims.limits':
    "Sixteen values per record. Comparing two varieties needs one party who holds both sets, such as the breeder or a lab that tested both. Anyone you give a sealed value to can make claims about it too. It doesn't fit comparisons across thousands of values.",
  'm.claims.statusTitle': 'Status.',
  'm.claims.link': 'How claims work, in the spec →',

  'm.get.label': 'What it does',
  'm.get.title1': 'What you get,',
  'm.get.title2': 'and where it stops.',
  'm.get.title': 'What you get',
  'm.get.1a': 'A date nobody can backfill',
  'm.get.1b': 'for what you hold, without showing what it is.',
  'm.get.2a': 'Terms that travel.',
  'm.get.2b':
    "Licences and lab transfers attach to the record. A licensee can prove a licence is valid without showing which one. Royalties follow declared offspring; VeilCore records what's owed and doesn't collect it.",
  'm.get.3a': 'Lineage both sides agreed to.',
  'm.get.3b': 'A parent link counts only when both holders confirm it.',
  'm.stops.title': 'Where it stops, and what covers the rest',
  'm.stops.1a': "It's evidence, not a title.",
  'm.stops.1b': 'It creates no new legal right. It backs up the rights and contracts you already have.',
  'm.stops.2a': 'It fixes when, not whether.',
  'm.stops.2b':
    "A record proves what was written and when. A paired lab report or a lab's signature gives the content weight.",
  'm.stops.3a': 'It works with DNA testing, not instead of it.',
  'm.stops.3b':
    'It keeps a test you already have meaningful years later. A parent link means both holders agreed; DNA is what proves descent.',
  'm.stops.4a': "It can't see what nobody declares.",
  'm.stops.4b':
    "Quiet propagation isn't detected. But a licensee you revoke can't show a live licence to the next buyer or lab.",

  'm.open.label': 'Open format',
  'm.open.title1': 'Built to',
  'm.open.title2': 'outlast us.',
  'm.open.1t': 'An open specification, three implementations.',
  'm.open.1p':
    'Free to implement, permanently. TypeScript, Python and Rust agree on all 100 shared test vectors, and anyone can run them. We wrote all three; one written by someone else is the test we most want.',
  'm.open.1link': 'All three implementations →',
  'm.open.2t': "Your record doesn't need us.",
  'm.open.2p':
    'Anyone holding the record can check it with SHA-256, the open spec and the public network, even if VeilCore is gone.',
  'm.open.3t': 'We never vouch.',
  'm.open.3p':
    "A record shows which lab signed it and which accreditor the lab names. Whoever checks it decides what that's worth.",
  'm.open.4t': 'Anyone can run a registry.',
  'm.open.4p':
    'A lab, certifier or rights body can run its own, under its own web domain, with its own field definitions. Nothing has to go through us.',
  'm.open.5t': 'Checking is free, always.',
  'm.open.5p': 'No account, no payment, for anyone.',

  'm.faq.label': 'Questions',
  'm.faq.title1': 'Questions',
  'm.faq.title2': 'people ask.',
  'm.faq.1q': 'What stops someone logging my cultivar?',
  'm.faq.1a':
    "Once records are anchored, anyone can check which was anchored first. Pair your lab report, so a later test can be compared with the one you sealed. When you send material out, the receiver confirms it with their own key. A record is evidence, not a registration: it doesn't settle anything against someone who never logged anything.",
  'm.faq.2q': 'Do I need crypto or a wallet?',
  'm.faq.2a':
    'No. Making a record in the demo and checking any record need no wallet, no account and nothing to buy. The fingerprint goes on Midnight, a blockchain built for privacy. You never deal with it directly.',
  'm.faq.3q': 'Will it stand up in a dispute?',
  'm.faq.3link': 'Records in evidence →',
  'm.faq.4q': 'What do you see of my data?',
  'm.faq.4a':
    "Your genetics and lab files: nothing. They're fingerprinted on your computer. This website keeps the names, dates and notes you type, so you can come back to them. Labs and developers can seal records inside their own systems, so only the fingerprint goes out.",
  'm.faq.4link1': 'What the demo keeps →',
  'm.faq.4link2': 'Integration guide →',
  'm.faq.5q': 'What if VeilCore disappears?',
  'm.faq.5a':
    'Your records still check. The spec is open, checking needs only SHA-256 and the public network, and the TypeScript, Python and Rust code is published.',
  'm.faq.6q': 'What does it cost?',
  'm.faq.6a': 'Checking a record is free, always.',

  'm.demo.label': 'Demo',
  'm.demo.title1': 'Pick how you',
  'm.demo.title2': 'want to see it.',
  'm.demo.lede':
    "No account, no wallet. It's a test version, so use made-up details. Records are dated in batches, and licences in the demo are simulated.",
  'm.demo.privacy': 'What the demo keeps →',
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
  'm.post0.date': '4 Oct 2026',
  'm.post0.tag': 'Contract',
  'm.post0.title': 'Proving one fact, keeping the rest',
  'm.post0.text':
    "Both contracts passed all 37 end-to-end checks on Midnight's test network, including the new claims: a value, a range, a difference, an unchanged correction and a lab's signature. Made-up marker data; not on the main network yet.",
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

  'm.status.label': 'Where this is',
  'm.status.title1': 'Straight about',
  'm.status.title2': 'where we are.',
  'm.status.lede': "We'd rather say this now than have it come out later.",
  'm.stat1.b': '100 / 100',
  'm.stat1.s': 'shared test vectors passed in TypeScript, Python and Rust (one author wrote all three)',
  'm.stat3.b': 'No audit',
  'm.stat3.s': 'No independent security audit yet. Our own reviews are public.',
  'm.stat4.b': 'First users wanted',
  'm.stat4.s': "Nobody uses it for real records yet. We're looking for the first breeders and labs.",
  'm.status.keyTitle': 'Who can change the contract.',
  'm.status.keyText':
    "The founders hold a maintenance key for VeilCore's contract on Midnight. It can change how the contract works from then on. It cannot rewrite records already anchored in the network's history. A policy for using it is proposed, not decided.",
  'm.status.keyLink': 'Read the proposed policy →',

  'm.contact.label': 'Get in touch',
  'm.contact.title1': 'Tell us',
  'm.contact.title2': 'where it fails.',
  'm.contact.1t': 'Breeders and labs',
  'm.contact.1p': 'Try it on made-up records, then tell us what it would need for your real ones.',
  'm.contact.2t': 'Seed certifiers, examiners and rights bodies',
  'm.contact.2p': 'Tell us what evidence you would need to see, and in what form.',
  'm.contact.3t': 'Developers',
  'm.contact.3p': 'Add it to software you already run. No account and no API key.',
  'm.contact.4t': 'Investors',
  'm.contact.4p': 'Write to Mako, our CEO.',
  'm.contact.email': 'Email the founders',
  'm.contact.integrate': 'Integration guide',
  'm.contact.spec': 'Read the spec',

  'm.foot.explore': 'Explore',
  'm.foot.demo': 'Demo',
  'm.foot.build': 'Build',
  'm.foot.contact': 'Contact',
  'm.foot.verify': 'Verify a record',
  'm.foot.fine': 'Proof of prior possession, not ownership.',
  'm.foot.privacy': 'Demo privacy',

  'm.verify.label': 'Verify',
  'm.verify.title': 'Check a record',
  'm.verify.lede':
    'Enter the record identifier printed on a certificate or shared with you. You will see what its holder chose to disclose, and whether it is intact.',
  'm.verify.what':
    'A VeilCore record is a dated fingerprint of genetic material, published without the genetics. Checking one is free and needs no account.',
  'm.verify.home': 'What is VeilCore? →',
  'm.verify.field': 'Record identifier',
  'm.verify.go': 'Check it',

  'm.founders.label': 'Founders',
  'm.founders.lede':
    'VeilCore is an evidentiary record format for plant and animal genetics. It gives proof of prior possession without anyone handing over their genetic data.',
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
