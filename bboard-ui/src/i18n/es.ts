// Spanish (Latin American neutral). DRAFT: machine-assisted, to be checked by a fluent speaker before publishing.
// SPDX-License-Identifier: Apache-2.0
import type { Strings } from './en';

export const es: Strings = {
  // Header and footer
  'nav.newCultivar': 'Nuevo cultivar',
  'nav.licenses': 'Licencias',
  'nav.language': 'Idioma',
  'footer.about':
    'Un formato de registro abierto para material genético. La verificación es gratuita, no requiere cuenta y no depende de que nosotros sigamos existiendo.',
  'footer.documents': 'Documentos',
  'footer.spec': 'Especificación',
  'footer.evidence': 'Registros como prueba',
  'footer.integrate': 'Guía de integración',
  'footer.source': 'Código fuente',
  'footer.allImplementations': 'Las tres implementaciones',
  'footer.referenceImplementation': 'Implementación de referencia',
  'footer.rustImplementation': 'Implementación en Rust',
  'footer.thisSite': 'Este sitio',
  'footer.whatThisIs': 'Qué es esto',
  'footer.yourRecords': 'Sus registros',
  'footer.agreements': 'Acuerdos',
  'draft.banner':
    'Traducción preliminar, aún no revisada por un hablante nativo. La página en inglés es la versión de referencia.',
  'draft.showEnglish': 'Ver en inglés',

  // Landing: hero
  'hero.overline': 'Prueba de lo que usted tiene',
  'hero.title1': 'Demuestre que lo tuvo primero.',
  'hero.title2': 'Sin mostrarle a nadie qué es.',
  'hero.lead':
    'Un formato de registro para material genético. Modifique lo que quiera abajo: se queda en esta página. Solo se publica el valor que aparece debajo.',
  'hero.cultivar': 'Cultivar',
  'hero.bredBy': 'Obtenido por',
  'hero.bredByDefault': 'Su nombre aquí',
  'hero.caption':
    'Treinta y dos bytes. No se puede revertir, y no podría haber salido de un registro distinto. Es la única parte que cualquier otra persona llega a ver.',
  'hero.readSpec': 'Leer la especificación',
  'hero.tryReference': 'Probar la implementación de referencia',

  // Landing: why
  'why.eyebrow': 'Por qué existe esto',
  'why.title': 'La genética se replica. El papel no le sigue el ritmo.',
  'why.p1':
    'Un esqueje se convierte en mil esquejes. Quien lo obtuvo cobra una sola vez, al inicio, y solo si alguien decidió pagar. Cuando el material aparece donde no debería, la prueba del obtentor son sus propias notas fechadas: producidas por la misma parte que se apoya en ellas, y que pueden crearse a posteriori.',
  'why.p2':
    'Las soluciones habituales no sirven. Depositar un espécimen exige un almacenamiento poco práctico para cualquier cosa que se propague por esqueje. Notarizar una descripción implica entregársela a un desconocido: justo lo que no se puede hacer con un material valioso y sin protección.',

  // Landing: stages
  'stages.eyebrow': 'Lo que va acumulando un registro',
  'stages.title': 'De su cuaderno a una licencia, sin mostrarle a nadie la genética.',
  'stage1.head': 'Registre lo que obtuvo',
  'stage1.body':
    'Anote el cultivar, sus parentales y cuándo lo seleccionó. Se sella en su propio dispositivo y solo se publica un hash: desde ese momento puede demostrarle a cualquiera que esa descripción existía en esa fecha, sin mostrarle ni una palabra. Incluso puede demostrar que tiene el material sin presentar la descripción.',
  'stage1.limit':
    'Fija lo que usted escribió y cuándo. No demuestra que lo que escribió sea cierto: para eso están las siguientes etapas.',
  'stage2.head': 'Envíe una muestra a análisis',
  'stage2.body':
    'Entréguele a un laboratorio un código de transferencia junto con la muestra. Cuando confirmen que llegó, esa confirmación se firma con su clave y queda en su registro. El material que ellos tienen ahora se puede rastrear hasta el suyo, y cualquier regalía que usted haya fijado viaja con él, incluso hacia esquejes que todavía no existen.',
  'stage2.limit': 'No puede ver material que nadie declara. Tiene efecto cuando ese material aparece comercialmente.',
  'stage3.head': 'Su informe se convierte en su prueba',
  'stage3.body':
    'El laboratorio adjunta el informe de ADN que elaboró, firmado por él. Su registro queda vinculado a una genética real y no a un nombre que cualquiera podría reutilizar, y lleva una declaración de alguien distinto de usted. Solo ese laboratorio puede retirarla. Nadie, ni siquiera nosotros, puede falsificar una.',
  'stage3.limit':
    'Registramos qué acreditación declara un laboratorio y quién lo acreditó. Nunca la avalamos: eso lo verifica usted con el organismo acreditador.',
  'stage4.head': 'Otórguelo en licencia y cobre por lo que crezca a partir de él',
  'stage4.body':
    'Fije condiciones, incluida una regalía sobre la descendencia, y ambas partes firman. Las condiciones quedan vinculadas al registro y al informe de ADN, no al recuerdo de una conversación. Si un licenciatario deja de cumplir su parte, usted revoca la licencia: eso no detiene su cultivo, pero sí le impide demostrar un título limpio ante el siguiente comprador, el siguiente laboratorio o cualquier programa que pida un registro.',
  'stage4.limit': 'Registramos lo que se adeuda. Nunca cobramos pagos ni guardamos su dinero.',

  // Landing: disclosure
  'disclose.eyebrow': 'Quién decide qué se ve',
  'disclose.title': 'Usted, destinatario por destinatario.',
  'disclose.p1':
    'Un comprador podría ver solo que existe un registro, que está limpio y que un laboratorio lo confirmó. Un licenciatario ve las condiciones. Un agente de aduanas ve una fecha. Los datos que usted no autoriza están ausentes de lo que envía, no ocultos dentro de ello.',
  'disclose.p2': 'La genética en sí nunca se puede divulgar. No existe ninguna opción que la revele.',

  // Landing: status
  'status.eyebrow': 'En qué punto está',
  'status.p1':
    'El formato está publicado con una batería de pruebas de conformidad, y tres implementaciones independientes en tres lenguajes pasan las mismas pruebas. Los registros se anclan por lotes en Midnight, actualmente en una red de pruebas. Todavía no se ha completado ninguna auditoría de seguridad independiente, y el formato lo han usado sus autores y nadie más.',
  'status.p2': 'Preferimos decirlo aquí antes que usted lo descubra por su cuenta.',

  // Landing: audiences
  'aud.eyebrow': 'Según quién sea usted',
  'aud.title': 'Cada persona necesita algo distinto de esto.',
  'aud.labs.who': 'Laboratorios',
  'aud.labs.line':
    'Conserve su propio sistema y sus propios números de muestra. Agregue un compromiso a los registros que ya genera y firme los informes que ya emite. Las recepciones de un día se anclan en una sola transacción.',
  'aud.labs.label': 'Guía de integración',
  'aud.try.who': 'Quien quiera verlo funcionar',
  'aud.try.line':
    'Una implementación de referencia, gratuita y abierta. Registre una variedad, envíe una muestra y vea cómo el informe firmado de un laboratorio llega a su registro. Existe para demostrar que el formato funciona y para darle algo con qué contrastar su propia implementación. No es el producto. El producto es el formato.',
  'aud.try.label': 'Probarlo',
  'aud.reg.who': 'Registros y entidades de derechos',
  'aud.reg.line':
    'Opere un registro bajo su propio dominio y defina un perfil para su propio tipo de material. Nadie otorga permiso y nada pasa por nosotros.',
  'aud.reg.label': 'Leer la especificación',
  'aud.counsel.who': 'Abogados',
  'aud.counsel.line':
    'Cómo se autentica un registro, qué jurisdicciones otorgan una presunción y a qué, y, expuesto en detalle, lo que no demuestra.',
  'aud.counsel.label': 'Nota sobre valor probatorio',
  'aud.check.who': 'Quien verifique un registro',
  'aud.check.line':
    'La verificación es gratuita, no requiere cuenta y siempre será así. Si desaparecemos, los registros ya emitidos se siguen verificando contra el registro contable con software de código abierto.',
  'aud.check.label': 'Cómo funciona la verificación',

  // Landing: team
  'team.eyebrow': 'Quién lo construye',
  'team.portraitOf': 'Retrato de {name}',
  'team.mako.role': 'Cofundador y CEO',
  'team.mako.bio':
    'Makoto (Mako) Steiner es cofundador y CEO de VeilCore; dirige la estrategia comercial, la recaudación de fondos y las relaciones de VeilCore con socios, instituciones e inversionistas en todo el mundo. Estudió Estudios Ambientales en Denison University y reside en Tokio.',
  'team.mako.extra': 'Idiomas: inglés, japonés',
  'team.hunter.role': 'Cofundador y COO',
  'team.hunter.bio':
    'Hunter Roberts es cofundador y COO de VeilCore; dirige el producto y el protocolo de VeilCore, desde el formato de registro hasta los contratos en Midnight. Viene del trabajo práctico con plantas, incluidos el mejoramiento genético y el cultivo de tejidos, y está construyendo una instalación de cultivo en Nueva Jersey. Es Nightforce Leader (US) de la Midnight Foundation.',
};
