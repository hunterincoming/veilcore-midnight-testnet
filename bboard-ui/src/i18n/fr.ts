// French. DRAFT: machine-assisted, to be checked by a fluent speaker before publishing.
// SPDX-License-Identifier: Apache-2.0
import type { Strings } from './en';
export const fr: Strings = {
  // Header and footer
  'nav.newCultivar': 'Nouvelle variété',
  'nav.licenses': 'Licences',
  'nav.language': 'Langue',
  'footer.about':
    "Un format d'enregistrement ouvert pour le matériel génétique. La vérification est gratuite, ne nécessite aucun compte et ne dépend pas de notre existence future.",
  'footer.documents': 'Documents',
  'footer.spec': 'Spécification',
  'footer.evidence': 'Les enregistrements comme preuve',
  'footer.integrate': "Guide d'intégration",
  'footer.source': 'Code source',
  'footer.allImplementations': 'Les trois implémentations',
  'footer.referenceImplementation': 'Implémentation de référence',
  'footer.rustImplementation': 'Implémentation en Rust',
  'footer.thisSite': 'Ce site',
  'footer.whatThisIs': "De quoi il s'agit",
  'footer.yourRecords': 'Vos enregistrements',
  'footer.agreements': 'Contrats',
  'draft.banner': 'Traduction provisoire, pas encore relue par un locuteur natif. La page en anglais fait foi.',
  'draft.showEnglish': 'Afficher en anglais',

  // Landing: hero
  'hero.overline': 'La preuve de ce que vous détenez',
  'hero.title1': "Prouvez que vous l'aviez en premier.",
  'hero.title2': "Sans montrer à quiconque de quoi il s'agit.",
  'hero.lead':
    "Un format d'enregistrement pour le matériel génétique. Modifiez ce que vous voulez ci-dessous — cela reste sur cette page. Rien d'autre que la valeur affichée en dessous n'est jamais publié.",
  'hero.cultivar': 'Variété',
  'hero.bredBy': 'Obtenteur',
  'hero.bredByDefault': 'Votre nom ici',
  'hero.caption':
    "Trente-deux octets. Impossible de remonter à l'original, et ils ne peuvent pas provenir d'un autre enregistrement. C'est la seule partie que quiconque d'autre voit jamais.",
  'hero.readSpec': 'Lire la spécification',
  'hero.tryReference': "Essayer l'implémentation de référence",

  // Landing: why
  'why.eyebrow': 'Pourquoi cela existe',
  'why.title': 'La génétique se multiplie. Le papier ne suit pas.',
  'why.p1':
    "Une bouture devient mille boutures. L'obtenteur est payé une seule fois, au départ, et seulement si quelqu'un a choisi de payer. Lorsque du matériel apparaît là où il ne devrait pas être, la preuve dont dispose l'obtenteur se résume à ses propres notes datées — produites par la partie qui s'en prévaut, et qui peuvent avoir été créées après coup.",
  'why.p2':
    "Les solutions habituelles ne conviennent pas. Le dépôt d'un spécimen exige une conservation peu praticable pour tout ce qui est multiplié par bouture. Faire authentifier une description par un notaire revient à la confier à un tiers — précisément ce que l'on ne peut pas faire avec du matériel précieux et non protégé.",

  // Landing: stages
  'stages.eyebrow': "Ce qu'un enregistrement accumule",
  'stages.title': 'De votre carnet à une licence, sans montrer la génétique à quiconque.',
  'stage1.head': 'Consignez ce que vous avez sélectionné',
  'stage1.body':
    'Notez la variété, ses parents, la date de sélection. Le tout est scellé sur votre propre appareil et seule une empreinte (hash) en est publiée — dès lors, vous pouvez prouver à quiconque que cette description existait à cette date, sans en montrer un seul mot. Vous pouvez même prouver que vous détenez le matériel sans produire la description du tout.',
  'stage1.limit':
    "Cela fixe ce que vous avez écrit et à quelle date. Cela ne prouve pas que ce que vous avez écrit est vrai — c'est le rôle des étapes suivantes.",
  'stage2.head': 'Envoyez un échantillon pour analyse',
  'stage2.body':
    "Remettez à un laboratoire un code de transfert avec l'échantillon. Lorsqu'il confirme la réception, cette confirmation est signée avec sa clé et ajoutée à votre enregistrement. Le matériel qu'il détient est désormais traçable jusqu'au vôtre, et toute redevance que vous y avez associée le suit — y compris dans des boutures qui n'existent pas encore.",
  'stage2.limit':
    'Cela ne peut pas voir le matériel que personne ne déclare. Cela prend effet lorsque ce matériel apparaît dans le commerce.',
  'stage3.head': 'Son rapport devient votre preuve',
  'stage3.body':
    "Le laboratoire joint le rapport ADN qu'il a produit, signé par lui. Votre enregistrement est désormais lié à une génétique réelle plutôt qu'à un nom que n'importe qui pourrait réutiliser — et il comporte une déclaration émanant d'une autre personne que vous. Seul ce laboratoire peut la retirer. Personne, pas même nous, ne peut en falsifier une.",
  'stage3.limit':
    "Nous enregistrons l'accréditation dont un laboratoire se réclame, et l'organisme qui l'a accrédité. Nous ne nous en portons jamais garants — c'est auprès de l'organisme d'accréditation que vous le vérifiez.",
  'stage4.head': 'Concédez une licence et soyez payé sur ce qui en est issu',
  'stage4.body':
    "Fixez les conditions, y compris une redevance sur la descendance, et les deux parties signent. Les conditions sont liées à l'enregistrement et au rapport ADN plutôt qu'au souvenir d'une conversation. Si un licencié ne respecte plus ses engagements, vous révoquez — ce qui n'arrête pas sa culture, mais l'empêche de justifier d'un titre valable auprès du prochain acheteur, du prochain laboratoire ou de tout programme qui exige un enregistrement.",
  'stage4.limit':
    "Nous enregistrons ce qui est dû. Nous n'encaissons jamais de paiements et ne détenons jamais votre argent.",

  // Landing: disclosure
  'disclose.eyebrow': 'Qui décide de ce qui est vu',
  'disclose.title': 'Vous, destinataire par destinataire.',
  'disclose.p1':
    "Un acheteur peut ne voir que l'existence d'un enregistrement, le fait qu'il est en règle et qu'un laboratoire l'a confirmé. Un licencié voit les conditions. Un agent des douanes voit une date. Les faits que vous ne communiquez pas sont absents de ce que vous envoyez, pas cachés à l'intérieur.",
  'disclose.p2': 'La génétique elle-même ne peut jamais être divulguée. Aucun réglage ne permet de la révéler.',

  // Landing: status
  'status.eyebrow': 'Où en est le projet',
  'status.p1':
    "Le format est publié avec une suite de tests de conformité, et trois implémentations indépendantes dans trois langages réussissent les mêmes tests. Les enregistrements sont ancrés par lots sur Midnight, actuellement sur un réseau de test. Aucun audit de sécurité indépendant n'a encore été réalisé, et le format n'a été utilisé que par ses auteurs, et par personne d'autre.",
  'status.p2': 'Nous préférons le dire ici plutôt que vous le laisser découvrir.',

  // Landing: audiences
  'aud.eyebrow': 'Selon qui vous êtes',
  'aud.title': "Chacun n'en attend pas la même chose.",
  'aud.labs.who': 'Laboratoires',
  'aud.labs.line':
    "Conservez votre propre système et vos propres numéros d'échantillon. Ajoutez un engagement aux enregistrements que vous créez déjà, et signez les rapports que vous émettez déjà. Une journée de réceptions d'échantillons est ancrée en une seule transaction.",
  'aud.labs.label': "Guide d'intégration",
  'aud.try.who': 'Quiconque veut le voir fonctionner',
  'aud.try.line':
    "Une implémentation de référence, gratuite et ouverte. Enregistrez une variété, envoyez un échantillon, voyez le rapport signé d'un laboratoire s'ajouter à votre enregistrement. Elle existe pour montrer que le format fonctionne et pour vous donner de quoi tester votre propre implémentation. Ce n'est pas le produit. Le produit, c'est le format.",
  'aud.try.label': 'Essayer',
  'aud.reg.who': 'Registres et organismes de gestion des droits',
  'aud.reg.line':
    "Exploitez un registre sous votre propre domaine et définissez un profil pour votre propre type de matériel. Personne n'accorde d'autorisation et rien ne passe par nous.",
  'aud.reg.label': 'Lire la spécification',
  'aud.counsel.who': 'Avocats et juristes',
  'aud.counsel.line':
    "Comment un enregistrement est authentifié, quelles juridictions y attachent une présomption et sur quoi, et — exposé en détail — ce qu'il ne prouve pas.",
  'aud.counsel.label': 'Note sur la valeur probante',
  'aud.check.who': 'Quiconque vérifie un enregistrement',
  'aud.check.line':
    "La vérification est gratuite, ne nécessite aucun compte, et le restera toujours. Si nous disparaissons, les enregistrements déjà émis continuent d'être vérifiables par rapport au registre au moyen de logiciels open source.",
  'aud.check.label': 'Comment fonctionne la vérification',

  // Landing: team
  'team.eyebrow': 'Qui le construit',
  'team.portraitOf': 'Portrait de {name}',
  'team.mako.role': 'Cofondateur et CEO',
  'team.mako.bio':
    "Makoto (Mako) Steiner est cofondateur et CEO de VeilCore. Il dirige la stratégie commerciale, la levée de fonds et les relations de VeilCore avec ses partenaires, les institutions et les investisseurs du monde entier. Il a étudié les sciences de l'environnement (Environmental Studies) à Denison University et vit à Tokyo.",
  'team.mako.extra': 'Langues : anglais, japonais',
  'team.hunter.role': 'Cofondateur et COO',
  'team.hunter.bio':
    "Hunter Roberts est cofondateur et COO de VeilCore. Il dirige le produit et le protocole VeilCore, du format d'enregistrement aux contrats sur Midnight. Il vient du travail pratique sur les plantes, notamment la sélection et la culture de tissus, et construit une installation de culture dans le New Jersey. Il est Nightforce Leader (US) de la Midnight Foundation.",
};
