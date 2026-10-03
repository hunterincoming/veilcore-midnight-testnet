// English: the source text. Every other language translates this file key by key; a
// key a translation leaves out shows in English.
// SPDX-License-Identifier: Apache-2.0

export const en = {
  // Header and footer
  'nav.newCultivar': 'New cultivar',
  'nav.licenses': 'Licenses',
  'nav.language': 'Language',
  'footer.about':
    'An open record format for genetic material. Verification is free, needs no account, and does not depend on us continuing to exist.',
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
  'draft.banner':
    'Draft translation, not yet checked by a fluent speaker. The English page is the authoritative version.',
  'draft.showEnglish': 'Show English',

  // Landing: hero
  'hero.overline': 'Proof of what you hold',
  'hero.title1': 'Prove you had it first.',
  'hero.title2': 'Without showing anyone what it is.',
  'hero.lead':
    'A record format for genetic material. Change anything below — it stays on this page. Only the value underneath is ever published.',
  'hero.cultivar': 'Cultivar',
  'hero.bredBy': 'Bred by',
  'hero.bredByDefault': 'Your name here',
  'hero.caption':
    'Thirty-two bytes. It cannot be reversed, and it could not have come from a different record. This is the only part anyone else ever sees.',
  'hero.readSpec': 'Read the specification',
  'hero.tryReference': 'Try the reference implementation',

  // Landing: why
  'why.eyebrow': 'Why this exists',
  'why.title': 'Genetics replicate. Paper does not keep up.',
  'why.p1':
    "A cutting becomes a thousand cuttings. Whoever bred it is paid once, at the door, and only if someone chose to pay. When material turns up where it should not be, the breeder's evidence is their own dated notes — produced by the party relying on them, and creatable after the fact.",
  'why.p2':
    'The usual remedies do not fit. Depositing a specimen needs storage that is impractical for anything grown from a cutting. Having a description notarised means handing it to a stranger — the one thing you cannot do with material that is valuable and unprotected.',

  // Landing: stages
  'stages.eyebrow': 'What a record accumulates',
  'stages.title': 'From your notebook to a licence, without showing anyone the genetics.',
  'stage1.head': 'Log what you bred',
  'stage1.body':
    'Write down the cultivar, its parents, when you selected it. It is sealed on your own device and only a hash of it is published — so from that moment you can prove to anyone that this description existed on this date, without showing them a word of it. You can even prove you hold the material without producing the description at all.',
  'stage1.limit':
    'It fixes what you wrote and when. It does not prove what you wrote is true — that is what the next stages are for.',
  'stage2.head': 'Send a sample for testing',
  'stage2.body':
    'Give a lab a transfer code with the sample. When they confirm it arrived, that confirmation is signed with their key and lands on your record. The material they hold is now traceable back to yours, and any royalty you attached travels with it — including into cuttings that do not exist yet.',
  'stage2.limit': 'It cannot see material nobody declares. It bites when that material surfaces commercially.',
  'stage3.head': 'Their report becomes your evidence',
  'stage3.body':
    'The lab attaches the DNA report they produced, signed by them. Your record is now tied to actual genetics rather than a name anyone could reuse — and it carries a statement from someone other than you. Only that lab can withdraw it. Nobody, including us, can forge one.',
  'stage3.limit':
    'We record which accreditation a lab claims, and who accredited them. We never vouch for it — you check that with the accreditor.',
  'stage4.head': 'License it, and get paid on what grows from it',
  'stage4.body':
    'Set terms, including a royalty on offspring, and both parties sign. The terms bind to the record and to the DNA report rather than to a memory of a conversation. If a licensee stops holding up their end, you revoke — which does not stop their grow, but does stop them showing clean title to the next buyer, the next lab, or any programme that asks for a record.',
  'stage4.limit': 'We record what is owed. We never take payments and never hold your money.',

  // Landing: disclosure
  'disclose.eyebrow': 'Who decides what is seen',
  'disclose.title': 'You do, recipient by recipient.',
  'disclose.p1':
    'A buyer might see only that a record exists, that it is clean, and that a lab confirmed it. A licensee sees the terms. A customs officer sees a date. Facts you do not grant are absent from what you send, not hidden inside it.',
  'disclose.p2': 'The genetics themselves are never disclosable. There is no setting that reveals them.',

  // Landing: status
  'status.eyebrow': 'Where this is',
  'status.p1':
    'The format is published with a conformance suite, and three independent implementations in three languages pass the same tests. Records anchor in batches on Midnight, currently on a test network. No independent security audit has been completed yet, and the format has been used by its authors and by nobody else.',
  'status.p2': 'We would rather say that here than have you find it out.',

  // Landing: audiences
  'aud.eyebrow': 'Depending on who you are',
  'aud.title': 'Different people need different things from it.',
  'aud.labs.who': 'Laboratories',
  'aud.labs.line':
    'Keep your own system and your own sample numbers. Add a commitment to records you already create, and sign the reports you already issue. A day of intakes anchors in one transaction.',
  'aud.labs.label': 'Integration guide',
  'aud.try.who': 'Anyone who wants to see it work',
  'aud.try.line':
    "A reference implementation, free and open. Log a variety, send a sample, watch a laboratory's signed report land on your record. It exists to show the format works and to give you something to check your own implementation against. It is not the product. The format is.",
  'aud.try.label': 'Try it',
  'aud.reg.who': 'Registries and rights bodies',
  'aud.reg.line':
    'Run a registry under your own domain and define a profile for your own kind of material. Nobody grants permission and nothing routes through us.',
  'aud.reg.label': 'Read the specification',
  'aud.counsel.who': 'Counsel',
  'aud.counsel.line':
    'How a record is authenticated, which jurisdictions attach a presumption to what, and — set out at length — what it does not prove.',
  'aud.counsel.label': 'Evidence note',
  'aud.check.who': 'Anyone checking a record',
  'aud.check.line':
    'Verification is free, needs no account, and always will be. If we disappear, records already issued keep verifying against the ledger with open-source software.',
  'aud.check.label': 'How verification works',

  // Landing: team
  'team.eyebrow': 'Who is building it',
  'team.portraitOf': 'Portrait of {name}',
  'team.mako.role': 'Co-founder & CEO',
  'team.mako.bio':
    "Makoto (Mako) Steiner is VeilCore's co-founder and CEO, leading commercial strategy, fundraising, and VeilCore's relationships with partners, institutions, and investors worldwide. He studied Environmental Studies at Denison University and is based in Tokyo.",
  'team.mako.extra': 'Languages: English, Japanese',
  'team.hunter.role': 'Co-founder & COO',
  'team.hunter.bio':
    "Hunter Roberts is VeilCore's co-founder and COO, leading product and the VeilCore protocol, from the record format to the contracts on Midnight. He comes from hands-on plant work, including breeding and tissue culture, and is building a cultivation facility in New Jersey. He is Midnight Foundation's Nightforce Leader (US).",
} as const;

export type StringKey = keyof typeof en;
export type Strings = Partial<Record<StringKey, string>>;
