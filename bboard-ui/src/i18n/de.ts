// German. DRAFT: machine-assisted, to be checked by a fluent speaker before publishing.
// SPDX-License-Identifier: Apache-2.0
import type { Strings } from './en';
export const de: Strings = {
  // Header and footer
  'nav.newCultivar': 'Neue Sorte',
  'nav.licenses': 'Lizenzen',
  'nav.language': 'Sprache',
  'footer.about':
    'Ein offenes Datensatzformat für genetisches Material. Die Prüfung ist kostenlos, erfordert kein Konto und hängt nicht davon ab, dass es uns weiterhin gibt.',
  'footer.documents': 'Dokumente',
  'footer.spec': 'Spezifikation',
  'footer.evidence': 'Datensätze als Beweismittel',
  'footer.integrate': 'Integrationsleitfaden',
  'footer.source': 'Quellcode',
  'footer.allImplementations': 'Alle drei Implementierungen',
  'footer.referenceImplementation': 'Referenzimplementierung',
  'footer.rustImplementation': 'Rust-Implementierung',
  'footer.thisSite': 'Diese Website',
  'footer.whatThisIs': 'Worum es geht',
  'footer.yourRecords': 'Ihre Datensätze',
  'footer.agreements': 'Vereinbarungen',
  'draft.banner':
    'Übersetzungsentwurf, noch nicht von einer muttersprachlichen Person geprüft. Maßgeblich ist die englische Seite.',
  'draft.showEnglish': 'Englisch anzeigen',

  // Landing: hero
  'hero.overline': 'Nachweis dessen, was Sie besitzen',
  'hero.title1': 'Weisen Sie nach, dass Sie es zuerst hatten.',
  'hero.title2': 'Ohne irgendjemandem zu zeigen, was es ist.',
  'hero.lead':
    'Ein Datensatzformat für genetisches Material. Ändern Sie unten, was Sie möchten – es bleibt auf dieser Seite. Veröffentlicht wird immer nur der darunterliegende Wert.',
  'hero.cultivar': 'Sorte',
  'hero.bredBy': 'Gezüchtet von',
  'hero.bredByDefault': 'Ihr Name',
  'hero.caption':
    'Zweiunddreißig Bytes. Sie lassen sich nicht zurückrechnen und können nicht aus einem anderen Datensatz stammen. Nur diesen Teil sieht jemals ein anderer.',
  'hero.readSpec': 'Spezifikation lesen',
  'hero.tryReference': 'Referenzimplementierung ausprobieren',

  // Landing: why
  'why.eyebrow': 'Warum es das gibt',
  'why.title': 'Genetik vermehrt sich. Papier kommt nicht hinterher.',
  'why.p1':
    'Aus einem Steckling werden tausend Stecklinge. Wer die Sorte gezüchtet hat, wird einmal bezahlt, beim ersten Verkauf – und nur, wenn sich jemand entschieden hat zu zahlen. Taucht das Material dort auf, wo es nicht sein sollte, bestehen die Nachweise der Züchterin oder des Züchters aus eigenen datierten Notizen – erstellt von der Partei, die sich darauf beruft, und auch nachträglich anfertigbar.',
  'why.p2':
    'Die üblichen Mittel passen nicht. Die Hinterlegung eines Exemplars erfordert eine Lagerung, die für alles, was aus einem Steckling gezogen wird, kaum praktikabel ist. Eine Beschreibung notariell beglaubigen zu lassen heißt, sie einem Fremden zu übergeben – genau das, was man mit wertvollem, ungeschütztem Material nicht tun kann.',

  // Landing: stages
  'stages.eyebrow': 'Was ein Datensatz nach und nach enthält',
  'stages.title': 'Vom Notizbuch bis zur Lizenz, ohne irgendjemandem die Genetik zu zeigen.',
  'stage1.head': 'Erfassen, was Sie gezüchtet haben',
  'stage1.body':
    'Notieren Sie die Sorte, ihre Elternlinien und wann Sie sie selektiert haben. Der Eintrag wird auf Ihrem eigenen Gerät versiegelt, und veröffentlicht wird nur ein Hash davon – so können Sie ab diesem Moment jedem nachweisen, dass diese Beschreibung zu diesem Datum existierte, ohne ein Wort davon zu zeigen. Sie können sogar nachweisen, dass Sie das Material besitzen, ohne die Beschreibung überhaupt vorzulegen.',
  'stage1.limit':
    'Festgehalten wird, was Sie geschrieben haben und wann. Es beweist nicht, dass das Geschriebene zutrifft – dafür sind die nächsten Schritte da.',
  'stage2.head': 'Eine Probe zur Analyse senden',
  'stage2.body':
    'Geben Sie einem Labor zusammen mit der Probe einen Übergabecode. Bestätigt das Labor den Eingang, wird diese Bestätigung mit seinem Schlüssel signiert und Ihrem Datensatz hinzugefügt. Das Material im Labor ist nun auf Ihres rückverfolgbar, und eine von Ihnen festgelegte Lizenzgebühr geht mit – auch auf Stecklinge, die es noch gar nicht gibt.',
  'stage2.limit':
    'Material, das niemand angibt, kann es nicht erfassen. Es greift, wenn dieses Material kommerziell auftaucht.',
  'stage3.head': 'Der Laborbericht wird zu Ihrem Nachweis',
  'stage3.body':
    'Das Labor hängt den von ihm erstellten DNA-Bericht an, von ihm signiert. Ihr Datensatz ist nun mit tatsächlicher Genetik verknüpft statt mit einem Namen, den jeder wiederverwenden könnte – und er enthält eine Erklärung von jemand anderem als Ihnen. Nur dieses Labor kann sie zurückziehen. Niemand, auch wir nicht, kann eine solche fälschen.',
  'stage3.limit':
    'Wir erfassen, welche Akkreditierung ein Labor angibt und wer es akkreditiert hat. Wir bürgen nie dafür – das prüfen Sie bei der Akkreditierungsstelle.',
  'stage4.head': 'Lizenzieren und an dem verdienen, was daraus wächst',
  'stage4.body':
    'Legen Sie Bedingungen fest, einschließlich einer Lizenzgebühr auf Nachkommen, und beide Parteien unterzeichnen. Die Bedingungen sind an den Datensatz und an den DNA-Bericht gebunden statt an die Erinnerung an ein Gespräch. Hält sich ein Lizenznehmer nicht an seine Seite der Vereinbarung, widerrufen Sie – das stoppt seinen Anbau nicht, verhindert aber, dass er dem nächsten Käufer, dem nächsten Labor oder einem Programm, das einen Datensatz verlangt, einwandfreie Rechte nachweisen kann.',
  'stage4.limit': 'Wir erfassen, was geschuldet ist. Wir nehmen nie Zahlungen entgegen und verwahren nie Ihr Geld.',

  // Landing: disclosure
  'disclose.eyebrow': 'Wer entscheidet, was sichtbar ist',
  'disclose.title': 'Sie – für jeden Empfänger einzeln.',
  'disclose.p1':
    'Ein Käufer sieht vielleicht nur, dass ein Datensatz existiert, dass er einwandfrei ist und dass ein Labor ihn bestätigt hat. Ein Lizenznehmer sieht die Bedingungen. Ein Zollbeamter sieht ein Datum. Fakten, die Sie nicht freigeben, fehlen in dem, was Sie senden – sie sind nicht darin versteckt.',
  'disclose.p2': 'Die Genetik selbst kann nie offengelegt werden. Es gibt keine Einstellung, die sie preisgibt.',

  // Landing: status
  'status.eyebrow': 'Wo das Projekt steht',
  'status.p1':
    'Das Format ist zusammen mit einer Konformitätstestsuite veröffentlicht, und drei unabhängige Implementierungen in drei Sprachen bestehen dieselben Tests. Datensätze werden gebündelt auf Midnight verankert, derzeit in einem Testnetz. Ein unabhängiges Sicherheitsaudit wurde noch nicht abgeschlossen, und das Format wurde bisher nur von seinen Autoren genutzt und von niemandem sonst.',
  'status.p2': 'Wir sagen Ihnen das lieber hier, als dass Sie es selbst herausfinden.',

  // Landing: audiences
  'aud.eyebrow': 'Je nachdem, wer Sie sind',
  'aud.title': 'Verschiedene Menschen brauchen Verschiedenes davon.',
  'aud.labs.who': 'Labore',
  'aud.labs.line':
    'Behalten Sie Ihr eigenes System und Ihre eigenen Probennummern. Ergänzen Sie Datensätze, die Sie ohnehin anlegen, um ein Commitment, und signieren Sie die Berichte, die Sie ohnehin ausstellen. Die Probeneingänge eines Tages werden in einer einzigen Transaktion verankert.',
  'aud.labs.label': 'Integrationsleitfaden',
  'aud.try.who': 'Alle, die es in Aktion sehen möchten',
  'aud.try.line':
    'Eine Referenzimplementierung, kostenlos und offen. Erfassen Sie eine Sorte, senden Sie eine Probe und sehen Sie, wie der signierte Bericht eines Labors in Ihrem Datensatz ankommt. Sie soll zeigen, dass das Format funktioniert, und Ihnen etwas geben, woran Sie Ihre eigene Implementierung prüfen können. Sie ist nicht das Produkt. Das Format ist es.',
  'aud.try.label': 'Ausprobieren',
  'aud.reg.who': 'Register und Rechteinhaberorganisationen',
  'aud.reg.line':
    'Betreiben Sie ein Register unter Ihrer eigenen Domain und definieren Sie ein Profil für Ihre eigene Art von Material. Niemand muss eine Erlaubnis erteilen, und nichts läuft über uns.',
  'aud.reg.label': 'Spezifikation lesen',
  'aud.counsel.who': 'Rechtsberatung',
  'aud.counsel.line':
    'Wie ein Datensatz authentifiziert wird, welche Rechtsordnungen woran eine Vermutung knüpfen und – ausführlich dargelegt – was er nicht beweist.',
  'aud.counsel.label': 'Hinweis zur Beweiskraft',
  'aud.check.who': 'Alle, die einen Datensatz prüfen',
  'aud.check.line':
    'Die Prüfung ist kostenlos, erfordert kein Konto und wird es immer bleiben. Sollte es uns nicht mehr geben, lassen sich bereits ausgestellte Datensätze weiterhin mit Open-Source-Software gegen das Ledger prüfen.',
  'aud.check.label': 'So funktioniert die Prüfung',

  // Landing: team
  'team.eyebrow': 'Wer es entwickelt',
  'team.portraitOf': 'Porträt von {name}',
  'team.mako.role': 'Mitgründer & CEO',
  'team.mako.bio':
    'Makoto (Mako) Steiner ist Mitgründer und CEO von VeilCore und verantwortet die kommerzielle Strategie, die Finanzierung sowie die Beziehungen von VeilCore zu Partnern, Institutionen und Investoren weltweit. Er hat Environmental Studies an der Denison University studiert und lebt in Tokio.',
  'team.mako.extra': 'Sprachen: Englisch, Japanisch',
  'team.hunter.role': 'Mitgründer & COO',
  'team.hunter.bio':
    'Hunter Roberts ist Mitgründer und COO von VeilCore und verantwortet das Produkt und das VeilCore-Protokoll, vom Datensatzformat bis zu den Verträgen auf Midnight. Er kommt aus der praktischen Arbeit mit Pflanzen, darunter Züchtung und Gewebekultur, und baut derzeit eine Anbauanlage in New Jersey auf. Er ist Nightforce Leader (US) der Midnight Foundation.',
};
