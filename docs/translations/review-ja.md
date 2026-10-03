# Japanese translation of the public pages: for checking

Status: DRAFT. Not live. Please read each pair and correct the Japanese so it says exactly what the English says, in natural Japanese.
Keep every limitation and "does not" exactly; the English is careful not to overclaim. Mark anything you change, or write a note under it.

Preview: open veilcore.org/?lang=ja once the preview build is deployed.

Changed on 3 October (site accuracy pass), please re-check: `footer.about`, `m.hero.lede`, `m.hero.note`, `m.step3.text`, `m.is.5b`, `m.demo.lede`, `m.demo.verify.text`, `m.updates.all`, `m.contact.lede`, `m.foot.about`, `m.mako.bio1`, `m.hunter.bio1`. New keys are at the end of this file.

## nav.newCultivar

**EN:** New cultivar

**JA:** 新しい品種

## nav.licenses

**EN:** Licenses

**JA:** ライセンス

## nav.language

**EN:** Language

**JA:** 言語

## footer.about

**EN:** An open record format for plant genetics. Checking a record you hold needs only SHA-256 and the open specification: it is free and needs no account. Looking a record up by its identifier on this site uses our server.

**JA:** 植物遺伝資源のためのオープンな記録フォーマットです。お手元の記録の確認に必要なのはSHA-256と公開仕様だけで、無料、アカウントも不要です。このサイトで識別子から記録を検索する場合は、私たちのサーバーを使用します。

## footer.documents

**EN:** Documents

**JA:** 文書

## footer.spec

**EN:** Specification

**JA:** 仕様書

## footer.evidence

**EN:** Records in evidence

**JA:** 証拠としての記録

## footer.integrate

**EN:** Integration guide

**JA:** 統合ガイド

## footer.source

**EN:** Source

**JA:** ソースコード

## footer.allImplementations

**EN:** All three implementations

**JA:** 3つの実装すべて

## footer.referenceImplementation

**EN:** Reference implementation

**JA:** リファレンス実装

## footer.rustImplementation

**EN:** Rust implementation

**JA:** Rust実装

## footer.thisSite

**EN:** This site

**JA:** このサイト

## footer.whatThisIs

**EN:** What this is

**JA:** このサイトについて

## footer.yourRecords

**EN:** Your records

**JA:** あなたの記録

## footer.agreements

**EN:** Agreements

**JA:** 契約

## draft.banner

**EN:** Draft translation, not yet checked by a fluent speaker. The English page is the authoritative version.

**JA:** この翻訳は草稿であり、まだ母語話者による確認を受けていません。英語版のページが正式な版です。

## draft.showEnglish

**EN:** Show English

**JA:** 英語で表示

## hero.overline

**EN:** Proof of what you hold

**JA:** 保有していることの証明

## hero.title1

**EN:** Prove you had it first.

**JA:** 先に持っていたことを証明する。

## hero.title2

**EN:** Without showing anyone what it is.

**JA:** それが何であるかを、誰にも見せずに。

## hero.lead

**EN:** A record format for genetic material. Change anything below — it stays on this page. Only the value underneath is ever published.

**JA:** 遺伝資源のための記録フォーマットです。下の項目は自由に変更できます。内容はこのページから外に出ません。公開されるのは、その下に表示される値だけです。

## hero.cultivar

**EN:** Cultivar

**JA:** 品種

## hero.bredBy

**EN:** Bred by

**JA:** 育成者

## hero.bredByDefault

**EN:** Your name here

**JA:** お名前

## hero.caption

**EN:** Thirty-two bytes. It cannot be reversed, and it could not have come from a different record. This is the only part anyone else ever sees.

**JA:** 32バイト。元に戻すことはできず、別の記録から生じることもあり得ません。他の誰かが目にするのは、この部分だけです。

## hero.readSpec

**EN:** Read the specification

**JA:** 仕様書を読む

## hero.tryReference

**EN:** Try the reference implementation

**JA:** リファレンス実装を試す

## why.eyebrow

**EN:** Why this exists

**JA:** なぜこれが必要なのか

## why.title

**EN:** Genetics replicate. Paper does not keep up.

**JA:** 遺伝資源は増殖する。紙の記録は追いつかない。

## why.p1

**EN:** A cutting becomes a thousand cuttings. Whoever bred it is paid once, at the door, and only if someone chose to pay. When material turns up where it should not be, the breeder's evidence is their own dated notes — produced by the party relying on them, and creatable after the fact.

**JA:** 1本の挿し木は、やがて千本の挿し木になります。育成者が対価を受け取るのは最初の一度きりで、それも誰かが支払うことを選んだ場合に限られます。本来あるはずのない場所でその素材が見つかったとき、育成者の証拠は自分自身の日付入りのメモです。それは依拠する当事者自身が作成したものであり、後から作ることもできてしまいます。

## why.p2

**EN:** The usual remedies do not fit. Depositing a specimen needs storage that is impractical for anything grown from a cutting. Having a description notarised means handing it to a stranger — the one thing you cannot do with material that is valuable and unprotected.

**JA:** 従来の対処法は適していません。標本の寄託には保管設備が必要ですが、挿し木で増やすものには現実的ではありません。説明書きを公証してもらうことは、それを第三者に渡すことを意味します。価値があり、かつ保護されていない素材について、それこそが決してできないことです。

## stages.eyebrow

**EN:** What a record accumulates

**JA:** 記録に積み重なるもの

## stages.title

**EN:** From your notebook to a licence, without showing anyone the genetics.

**JA:** ノートからライセンスまで。遺伝情報を誰にも見せずに。

## stage1.head

**EN:** Log what you bred

**JA:** 育成したものを記録する

## stage1.body

**EN:** Write down the cultivar, its parents, when you selected it. It is sealed on your own device and only a hash of it is published — so from that moment you can prove to anyone that this description existed on this date, without showing them a word of it. You can even prove you hold the material without producing the description at all.

**JA:** 品種名、その親、選抜した時期を書き留めます。内容はご自身の端末上で封印され、公開されるのはそのハッシュだけです。その時点から、この説明がこの日付に存在していたことを、一言も見せることなく誰に対しても証明できます。説明そのものを提示することなく、素材を保有していることを証明することさえ可能です。

## stage1.limit

**EN:** It fixes what you wrote and when. It does not prove what you wrote is true — that is what the next stages are for.

**JA:** 確定するのは、何を書いたか、そしていつ書いたかです。書いた内容が真実であることは証明しません。それを担うのが次の段階です。

## stage2.head

**EN:** Send a sample for testing

**JA:** 検査のためにサンプルを送る

## stage2.body

**EN:** Give a lab a transfer code with the sample. When they confirm it arrived, that confirmation is signed with their key and lands on your record. The material they hold is now traceable back to yours, and any royalty you attached travels with it — including into cuttings that do not exist yet.

**JA:** サンプルとともに移転コードを検査機関に渡します。検査機関が受領を確認すると、その確認は検査機関の鍵で署名され、あなたの記録に追加されます。検査機関が保有する素材は、あなたの素材まで遡って追跡できるようになり、あなたが設定したロイヤルティもそれに伴って引き継がれます。まだ存在しない挿し木にも及びます。

## stage2.limit

**EN:** It cannot see material nobody declares. It bites when that material surfaces commercially.

**JA:** 誰も申告しない素材を把握することはできません。効力を発揮するのは、その素材が商業的に表に出たときです。

## stage3.head

**EN:** Their report becomes your evidence

**JA:** 検査機関の報告書が、あなたの証拠になる

## stage3.body

**EN:** The lab attaches the DNA report they produced, signed by them. Your record is now tied to actual genetics rather than a name anyone could reuse — and it carries a statement from someone other than you. Only that lab can withdraw it. Nobody, including us, can forge one.

**JA:** 検査機関は、自ら作成したDNA報告書を、自らの署名を付けて添付します。これにより、あなたの記録は誰でも流用できる名前ではなく、実際の遺伝情報に結び付けられます。そして、あなた以外の誰かによる表明を伴うことになります。それを撤回できるのは、その検査機関だけです。私たちを含め、誰も偽造することはできません。

## stage3.limit

**EN:** We record which accreditation a lab claims, and who accredited them. We never vouch for it — you check that with the accreditor.

**JA:** 私たちが記録するのは、検査機関がどの認定を受けていると主張しているか、そして誰が認定したかです。私たちがそれを保証することは決してありません。確認は認定機関に対して行ってください。

## stage4.head

**EN:** License it, and get paid on what grows from it

**JA:** ライセンスを供与し、そこから育つものについて対価を得る

## stage4.body

**EN:** Set terms, including a royalty on offspring, and both parties sign. The terms bind to the record and to the DNA report rather than to a memory of a conversation. If a licensee stops holding up their end, you revoke — which does not stop their grow, but does stop them showing clean title to the next buyer, the next lab, or any programme that asks for a record.

**JA:** 子孫に対するロイヤルティを含む条件を設定し、双方が署名します。条件は会話の記憶ではなく、記録とDNA報告書に結び付けられます。ライセンシーが義務を果たさなくなった場合は、ライセンスを取り消すことができます。それによって相手の栽培が止まるわけではありませんが、次の買い手、次の検査機関、あるいは記録を求めるあらゆるプログラムに対して、瑕疵のない権原を示すことはできなくなります。

## stage4.limit

**EN:** We record what is owed. We never take payments and never hold your money.

**JA:** 私たちが記録するのは、支払われるべき内容です。私たちが支払いを受け取ることも、お客様の資金を預かることも決してありません。

## disclose.eyebrow

**EN:** Who decides what is seen

**JA:** 何を見せるかは誰が決めるのか

## disclose.title

**EN:** You do, recipient by recipient.

**JA:** あなたが、相手ごとに決めます。

## disclose.p1

**EN:** A buyer might see only that a record exists, that it is clean, and that a lab confirmed it. A licensee sees the terms. A customs officer sees a date. Facts you do not grant are absent from what you send, not hidden inside it.

**JA:** 買い手には、記録が存在すること、それに問題がないこと、そして検査機関が確認したことだけを見せることができます。ライセンシーには条件を、税関職員には日付を見せます。開示を許可していない事実は、送信する内容の中に隠されているのではなく、そもそも含まれていません。

## disclose.p2

**EN:** The genetics themselves are never disclosable. There is no setting that reveals them.

**JA:** 遺伝情報そのものは、決して開示できません。それを明かす設定は存在しません。

## status.eyebrow

**EN:** Where this is

**JA:** 現在の状況

## status.p1

**EN:** The format is published with a conformance suite, and three independent implementations in three languages pass the same tests. Records anchor in batches on Midnight, currently on a test network. No independent security audit has been completed yet, and the format has been used by its authors and by nobody else.

**JA:** このフォーマットは適合性テストスイートとともに公開されており、3つの言語による3つの独立した実装が同じテストに合格しています。記録はMidnight上にバッチ単位でアンカーされますが、現在はテストネットワーク上で運用しています。独立したセキュリティ監査はまだ完了しておらず、このフォーマットを使用しているのは開発者自身のみで、それ以外の利用者はいません。

## status.p2

**EN:** We would rather say that here than have you find it out.

**JA:** 後から知られるよりも、ここで正直にお伝えしておきたいと考えています。

## aud.eyebrow

**EN:** Depending on who you are

**JA:** 立場に応じて

## aud.title

**EN:** Different people need different things from it.

**JA:** 求めるものは、人によって異なります。

## aud.labs.who

**EN:** Laboratories

**JA:** 検査機関

## aud.labs.line

**EN:** Keep your own system and your own sample numbers. Add a commitment to records you already create, and sign the reports you already issue. A day of intakes anchors in one transaction.

**JA:** 既存のシステムとサンプル番号はそのままお使いいただけます。すでに作成している記録にコミットメントを追加し、すでに発行している報告書に署名するだけです。1日分の受付は、1件のトランザクションでアンカーされます。

## aud.labs.label

**EN:** Integration guide

**JA:** 統合ガイド

## aud.try.who

**EN:** Anyone who wants to see it work

**JA:** 実際に動くところを見たい方

## aud.try.line

**EN:** A reference implementation, free and open. Log a variety, send a sample, watch a laboratory's signed report land on your record. It exists to show the format works and to give you something to check your own implementation against. It is not the product. The format is.

**JA:** 無料かつオープンなリファレンス実装です。品種を記録し、サンプルを送り、検査機関の署名付き報告書があなたの記録に追加される様子をご覧いただけます。これは、フォーマットが機能することを示し、ご自身の実装を照合する基準を提供するためのものです。製品ではありません。製品はフォーマットそのものです。

## aud.try.label

**EN:** Try it

**JA:** 試してみる

## aud.reg.who

**EN:** Registries and rights bodies

**JA:** 登録機関・権利団体

## aud.reg.line

**EN:** Run a registry under your own domain and define a profile for your own kind of material. Nobody grants permission and nothing routes through us.

**JA:** 独自のドメインで登録簿を運営し、扱う素材の種類に合わせたプロファイルを定義できます。誰かの許可は不要で、私たちを経由するものは何もありません。

## aud.reg.label

**EN:** Read the specification

**JA:** 仕様書を読む

## aud.counsel.who

**EN:** Counsel

**JA:** 弁護士・法務担当者

## aud.counsel.line

**EN:** How a record is authenticated, which jurisdictions attach a presumption to what, and — set out at length — what it does not prove.

**JA:** 記録がどのように真正性を確認されるか、どの法域が何に対して推定を付与するか、そして、記録が何を証明しないかを詳しく説明しています。

## aud.counsel.label

**EN:** Evidence note

**JA:** 証拠に関する解説

## aud.check.who

**EN:** Anyone checking a record

**JA:** 記録を確認する方

## aud.check.line

**EN:** Verification is free, needs no account, and always will be. If we disappear, records already issued keep verifying against the ledger with open-source software.

**JA:** 検証は無料で、アカウントは不要です。これは今後も変わりません。私たちがいなくなっても、すでに発行された記録は、オープンソースのソフトウェアを用いて台帳に照らして引き続き検証できます。

## aud.check.label

**EN:** How verification works

**JA:** 検証の仕組み

## team.eyebrow

**EN:** Who is building it

**JA:** 開発チーム

## team.portraitOf

**EN:** Portrait of {name}

**JA:** {name}の肖像

## team.mako.role

**EN:** Co-founder & CEO

**JA:** 共同創業者・CEO

## team.mako.bio

**EN:** Makoto (Mako) Steiner is VeilCore's co-founder and CEO, leading commercial strategy, fundraising, and VeilCore's relationships with partners, institutions, and investors worldwide. He studied Environmental Studies at Denison University and is based in Tokyo.

**JA:** シュタイナー真琴（Mako Steiner）は、VeilCoreの共同創業者兼CEOです。事業戦略と資金調達を統括し、世界各地のパートナー、機関、投資家との関係を担っています。デニソン大学（Denison University）で環境学を専攻し、東京を拠点としています。

## team.mako.extra

**EN:** Languages: English, Japanese

**JA:** 使用言語：英語、日本語

## team.hunter.role

**EN:** Co-founder & COO

**JA:** 共同創業者・COO

## team.hunter.bio

**EN:** Hunter Roberts is VeilCore's co-founder and COO, leading product and the VeilCore protocol, from the record format to the contracts on Midnight. He comes from hands-on plant work, including breeding and tissue culture, and is building a cultivation facility in New Jersey. He is Midnight Foundation's Nightforce Leader (US).

**JA:** ハンター・ロバーツ（Hunter Roberts）は、VeilCoreの共同創業者兼COOです。記録フォーマットからMidnight上のコントラクトに至るまで、プロダクトとVeilCoreプロトコルを統括しています。育種や組織培養を含む植物の実務経験を持ち、ニュージャージー州で栽培施設を建設中です。Midnight FoundationのNightforce Leader (US)を務めています。


## Public pages (new layout, 3 October)

Some headings are split in two or three parts; the later part is shown in colour. Check that the parts read naturally in order and that the coloured part is the right idea.

### m.nav.about

**EN:** About

**JA:** 概要

### m.nav.team

**EN:** Team

**JA:** チーム

### m.nav.updates

**EN:** Updates

**JA:** お知らせ

### m.nav.spec

**EN:** Spec

**JA:** 仕様

### m.nav.demo

**EN:** Try the demo

**JA:** デモを試す

### m.nav.menu

**EN:** Menu

**JA:** メニュー

### m.hero.label

**EN:** Proof of what you hold

**JA:** 保有していることの証明

### m.hero.title1

**EN:** Prove you had it first.

**JA:** 先に持っていたことを証明する。

### m.hero.title2

**EN:** Without showing anyone what it is.

**JA:** それが何かは誰にも見せずに。

### m.hero.lede

**EN:** For plant breeders, seed companies and labs: an open record format for plant genetics. Your genetic data stays with you. Only a fingerprint is recorded on a public blockchain (Midnight), and once it is anchored, anyone can check its date.

**JA:** 植物の育種家、種苗会社、検査機関のための、植物遺伝資源のオープンな記録フォーマットです。遺伝データはお手元に残ります。公開ブロックチェーン（Midnight）に記録されるのはフィンガープリントだけで、アンカーされた後は、その日付を誰でも確認できます。

### m.hero.chooseDemo

**EN:** Choose a demo

**JA:** デモを選ぶ

### m.hero.how

**EN:** How it works

**JA:** 仕組み

### m.hero.cultivar

**EN:** Cultivar

**JA:** 品種

### m.hero.bredBy

**EN:** Bred by

**JA:** 育成者

### m.hero.bredByDefault

**EN:** Your name here

**JA:** お名前

### m.hero.demoLabel

**EN:** Live fingerprint demo

**JA:** フィンガープリントのライブデモ

### m.hero.note

**EN:** Change anything above; it stays on this page. The line in mint is the fingerprint: thirty-two bytes that can't be reversed, because a random value is mixed in. It's the only part this demo would publish.

**JA:** 上の項目は自由に変更できます。入力内容はこのページから出ません。ミント色の行がフィンガープリントです。ランダムな値を混ぜているため、元に戻すことのできない32バイトの値です。このデモが公開するとしたら、この部分だけです。

### m.choose.label

**EN:** Start here

**JA:** はじめに

### m.choose.title

**EN:** Where do you want to go?

**JA:** どこに進みますか？

### m.choose.about.title

**EN:** About

**JA:** 概要

### m.choose.about.text

**EN:** What the format is, how it works, and what it doesn't do.

**JA:** このフォーマットとは何か、どう機能するか、そして何をしないか。

### m.choose.about.go

**EN:** Read →

**JA:** 読む →

### m.choose.demo.title

**EN:** Demo

**JA:** デモ

### m.choose.demo.text

**EN:** Make a record or verify one.

**JA:** 記録を作成する、または検証する。

### m.choose.demo.go

**EN:** Choose a demo →

**JA:** デモを選ぶ →

### m.choose.team.title

**EN:** Team

**JA:** チーム

### m.choose.team.text

**EN:** Two founders, in Tokyo and New Jersey.

**JA:** 東京とニュージャージーの2人の創業者。

### m.choose.team.go

**EN:** Meet them →

**JA:** 紹介を見る →

### m.choose.updates.title

**EN:** Updates

**JA:** お知らせ

### m.choose.updates.text

**EN:** What changed, what shipped, and what we learned.

**JA:** 何が変わり、何をリリースし、何を学んだか。

### m.choose.updates.go

**EN:** Latest →

**JA:** 最新情報 →

### m.about.label

**EN:** About

**JA:** 概要

### m.about.title1

**EN:** An evidentiary record format

**JA:** 植物遺伝資源のための

### m.about.title2

**EN:** for plant genetics.

**JA:** 証拠記録フォーマット。

### m.about.lede

**EN:** When genetics turn up somewhere they shouldn't, every dispute comes down to one question: what did you have, and when? Notebooks and lab reports are dated by whoever holds them. The usual fix, a shared registry, asks everyone to hand over the very thing they're protecting. VeilCore does neither.

**JA:** 遺伝資源があるべきでない場所で見つかったとき、あらゆる紛争は一つの問いに行き着きます。「何を、いつ持っていたのか」。ノートや検査報告書の日付は、それを保管している本人が付けるものです。よくある解決策である共有レジストリは、守ろうとしているものそのものを全員に差し出すよう求めます。VeilCoreはそのどちらでもありません。

### m.step1.n

**EN:** 01 · Record

**JA:** 01 · 記録

### m.step1.title

**EN:** Describe the lot

**JA:** ロットを記述する

### m.step1.text

**EN:** A breeder or lab writes a record of the material: what it is, where it came from, test results.

**JA:** 育種家またはラボが、その材料の記録を作成します。何であるか、どこから来たか、検査結果などです。

### m.step2.n

**EN:** 02 · Fingerprint

**JA:** 02 · フィンガープリント

### m.step2.title

**EN:** Hash it locally

**JA:** 手元でハッシュ化する

### m.step2.text

**EN:** A 32-byte fingerprint is computed on your own computer. Genetic data and lab files never leave it.

**JA:** 32バイトのフィンガープリントがご自身のコンピューター上で計算されます。遺伝データやラボのファイルが外に出ることはありません。

### m.step3.n

**EN:** 03 · Anchor

**JA:** 03 · アンカー

### m.step3.title

**EN:** Publish the date

**JA:** 日付を公開する

### m.step3.text

**EN:** Only the fingerprint is timestamped on a public network (Midnight). The date is set by the network, not by us, and stays in its public history. In the demo, our operator anchors records in batches, not instantly.

**JA:** 公開ネットワーク（Midnight）上でタイムスタンプが付くのはフィンガープリントだけです。日付は私たちではなくネットワークが付与し、その公開履歴に残ります。デモでは、記録は即時ではなく、私たちのオペレーターがまとめてアンカーします。

### m.step4.n

**EN:** 04 · Verify

**JA:** 04 · 検証

### m.step4.title

**EN:** Show it later

**JA:** 後から提示する

### m.step4.text

**EN:** Show the record to a buyer, inspector or court. Anyone can check it matches, for free and with no account.

**JA:** 記録を購入者、検査官、または裁判所に提示します。一致するかどうかは誰でも、無料で、アカウントなしで確認できます。

### m.is.title

**EN:** What it is

**JA:** これは何か

### m.is.1a

**EN:** Proof of prior possession:

**JA:** 先行保有の証明：

### m.is.1b

**EN:** what you held, and when.

**JA:** 何を、いつ持っていたか。

### m.is.2a

**EN:** No custody of genetics:

**JA:** 遺伝資源の預かりなし：

### m.is.2b

**EN:** genetic data and lab files never reach us.

**JA:** 遺伝データやラボのファイルが私たちに届くことはありません。

### m.is.3a

**EN:** An open format:

**JA:** オープンなフォーマット：

### m.is.3b

**EN:** free to implement, free to verify, with a published spec.

**JA:** 実装も検証も無料で、仕様は公開されています。

### m.isnt.title

**EN:** What it isn't

**JA:** これは何ではないか

### m.isnt.1a

**EN:** Not ownership.

**JA:** 所有権ではありません。

### m.isnt.1b

**EN:** It creates no legal right you don't already have.

**JA:** すでにお持ちでない法的権利を生み出すことはありません。

### m.isnt.2a

**EN:** Not a truth machine.

**JA:** 真実を判定する機械ではありません。

### m.isnt.2b

**EN:** It proves when you wrote something, not that it's true.

**JA:** 証明するのは、いつ書いたかであって、それが正しいかではありません。

### m.isnt.3a

**EN:** Not a DNA test.

**JA:** DNA検査ではありません。

### m.isnt.3b

**EN:** It complements one, so a result still means something years later.

**JA:** DNA検査を補完し、何年経っても結果が意味を持つようにします。

### m.demo.label

**EN:** Demo

**JA:** デモ

### m.demo.title1

**EN:** Pick how you

**JA:** 見たい方法を

### m.demo.title2

**EN:** want to see it.

**JA:** お選びください。

### m.demo.lede

**EN:** No account, no wallet. Genetic data and lab files stay in your browser. The demo keeps the rest of a record (names, dates, fingerprint) on our test server so you can come back to it, so please use made-up details. Licensing in the demo is simulated: nothing is sent to the network.

**JA:** アカウントもウォレットも不要です。遺伝データやラボのファイルはブラウザ内に留まります。デモでは、後で戻って確認できるよう、記録の残りの部分（名前、日付、フィンガープリント）を私たちのテストサーバーに保存します。そのため、架空の情報をお使いください。デモでのライセンス手続きはシミュレーションで、ネットワークには何も送信されません。

### m.demo.create.title

**EN:** Create a record

**JA:** 記録を作成する

### m.demo.create.text

**EN:** Fill in a sample record, generate its fingerprint and download the certificate.

**JA:** サンプルの記録を入力し、フィンガープリントを生成して、証明書をダウンロードします。

### m.demo.verify.title

**EN:** Verify a record

**JA:** 記録を検証する

### m.demo.verify.text

**EN:** Enter a record's identifier and see what its holder disclosed and whether it is anchored.

**JA:** 記録の識別子を入力すると、保有者が開示した内容と、アンカー済みかどうかを確認できます。



### m.chip.interactive

**EN:** Interactive

**JA:** インタラクティブ

### m.chip.3min

**EN:** ~3 min

**JA:** 約3分

### m.chip.1min

**EN:** ~1 min

**JA:** 約1分




### m.team.label

**EN:** Team

**JA:** チーム

### m.team.title1

**EN:** Two founders.

**JA:** 2人の創業者。

### m.team.title2

**EN:** Tokyo and New Jersey.

**JA:** 東京とニュージャージー。

### m.team.more

**EN:** Full profiles →

**JA:** 詳しいプロフィール →

### m.mako.role

**EN:** Co-Founder & CEO · Tokyo

**JA:** 共同創業者兼CEO · 東京

### m.mako.short

**EN:** Commercial lead: standards and plant-rights bodies in Japan and the EU.

**JA:** 事業責任者：日本とEUの標準化団体・育成者権関係機関を担当。

### m.hunter.role

**EN:** Co-Founder & COO · New Jersey

**JA:** 共同創業者兼COO · ニュージャージー

### m.hunter.short

**EN:** Builds the contract, app and API. Leads US outreach.

**JA:** コントラクト、アプリ、APIを開発。米国でのアウトリーチを主導。

### m.updates.label

**EN:** Updates

**JA:** お知らせ

### m.updates.title1

**EN:** Latest from

**JA:** 開発の

### m.updates.title2

**EN:** the build.

**JA:** 最新情報。

### m.updates.read

**EN:** Read →

**JA:** 読む →

### m.updates.all

**EN:** Record-format changes on GitHub →

**JA:** 記録フォーマットの変更はGitHubで →

### m.updates.follow

**EN:** Follow

**JA:** フォロー

### m.post1.date

**EN:** 3 Oct 2026

**JA:** 2026年10月3日

### m.post1.tag

**EN:** Format

**JA:** フォーマット

### m.post1.title

**EN:** Three implementations, one answer

**JA:** 3つの実装、1つの答え

### m.post1.text

**EN:** A differential test found our TypeScript, Python and Rust implementations disagreeing on some numbers. Fixed: they now agree on every one of 81,000 inputs, and 55 conformance vectors pin it.

**JA:** 差分テストにより、TypeScript、Python、Rustの各実装が一部の数値で一致しないことが判明しました。修正済みです。現在は81,000件の入力すべてで一致し、55件の適合性ベクターでそれを固定しています。

### m.post2.date

**EN:** 2 Oct 2026

**JA:** 2026年10月2日

### m.post2.tag

**EN:** Contract

**JA:** コントラクト

### m.post2.title

**EN:** A full run on Midnight's test network

**JA:** Midnightのテストネットでの全工程の実行

### m.post2.text

**EN:** The contract deployed to Midnight's test network and passed all 26 end-to-end checks, using 16 of its 24 operations with real proofs.

**JA:** コントラクトをMidnightのテストネットにデプロイし、26項目のエンドツーエンドチェックをすべて通過しました。24の操作のうち16を実際の証明で使用しています。

### m.post3.date

**EN:** 25 Aug 2026

**JA:** 2026年8月25日

### m.post3.tag

**EN:** Contract

**JA:** コントラクト

### m.post3.title

**EN:** Why a licence transfer is an assignment

**JA:** ライセンスの移転がなぜ譲渡なのか

### m.post3.text

**EN:** We redesigned transfer after finding that the old version let the outgoing party keep its powers.

**JA:** 旧バージョンでは移転元の当事者が権限を保持できてしまうことが判明したため、移転の仕組みを再設計しました。

### m.status.label

**EN:** Where this is

**JA:** 現在の状況

### m.status.title1

**EN:** Straight about

**JA:** 現状を

### m.status.title2

**EN:** where we are.

**JA:** 率直にお伝えします。

### m.status.lede

**EN:** We'd rather say this now than have it come out later.

**JA:** 後から明らかになるより、今お伝えしておきたいと考えています。

### m.stat1.b

**EN:** 55 / 55

**JA:** 55 / 55

### m.stat1.s

**EN:** conformance vectors passed by implementations in three languages (written by the same team)

**JA:** 3つの言語による実装が通過した適合性ベクター（同じチームが作成）

### m.stat2.b

**EN:** Test net

**JA:** テストネット

### m.stat2.s

**EN:** Tested on Midnight's test network. Not on the live network yet.

**JA:** Midnightのテストネットでテスト済みです。本番ネットワークではまだ稼働していません。

### m.stat3.b

**EN:** No audit

**JA:** 監査なし

### m.stat3.s

**EN:** No independent security audit yet. Our own reviews are published in the repository.

**JA:** 独立したセキュリティ監査はまだ受けていません。社内レビューはリポジトリで公開しています。

### m.stat4.b

**EN:** No users yet

**JA:** ユーザーはまだいません

### m.stat4.s

**EN:** Nobody is using it for real records yet. We're looking for the first.

**JA:** 実際の記録に使用している人はまだいません。最初のユーザーを探しています。

### m.contact.label

**EN:** Get in touch

**JA:** お問い合わせ

### m.contact.title1

**EN:** Tell us

**JA:** どこで失敗するか

### m.contact.title2

**EN:** where it fails.

**JA:** 教えてください。

### m.contact.lede

**EN:** If you run a breeding programme, a lab, a seed certification agency or a plant-rights body, we'd like to talk. Checking and implementing are free. Nothing is priced yet.

**JA:** 育種プログラム、ラボ、種子認証機関、育成者権関係機関を運営されている方は、ぜひお話しさせてください。確認と実装は無料です。価格はまだ何も決めていません。

### m.contact.email

**EN:** Email the founders

**JA:** 創業者にメールする

### m.contact.spec

**EN:** Read the spec

**JA:** 仕様を読む

### m.foot.about

**EN:** An evidentiary record format for plant genetics. Designed to anchor on Midnight; testing on Midnight's test network.

**JA:** 植物遺伝資源のための証拠記録フォーマット。Midnightへのアンカーを前提に設計し、Midnightのテストネットワークで試験中。

### m.foot.explore

**EN:** Explore

**JA:** 見る

### m.foot.build

**EN:** Build

**JA:** 開発

### m.foot.contact

**EN:** Contact

**JA:** お問い合わせ

### m.foot.verify

**EN:** Verify a record

**JA:** 記録を検証する

### m.foot.fine

**EN:** Proof of prior possession, not ownership.

**JA:** 先行保有の証明であり、所有権の証明ではありません。

### m.verify.label

**EN:** Verify

**JA:** 検証

### m.verify.title

**EN:** Check a record

**JA:** 記録を確認する

### m.verify.lede

**EN:** Enter the record identifier printed on a certificate or shared with you. You will see what its holder chose to disclose, and whether it is intact.

**JA:** 証明書に印字された、または共有された記録識別子を入力してください。保有者が開示を選んだ内容と、記録が改ざんされていないかどうかが表示されます。

### m.verify.field

**EN:** Record identifier

**JA:** 記録識別子

### m.verify.go

**EN:** Check it

**JA:** 確認する

### m.founders.label

**EN:** Founders

**JA:** 創業者

### m.founders.lede

**EN:** VeilCore is an evidentiary record format for plant genetics. It gives proof of prior possession without anyone handing over their genetic data.

**JA:** VeilCoreは植物遺伝資源のための証拠記録フォーマットです。誰も遺伝データを差し出すことなく、先行保有の証明を可能にします。

### m.founders.leads

**EN:** Leads

**JA:** 担当

### m.founders.also

**EN:** Also

**JA:** その他

### m.founders.languages

**EN:** Languages

**JA:** 言語

### m.mako.bio1

**EN:** Makoto (Mako) Steiner is VeilCore's co-founder and CEO, leading commercial strategy, fundraising, and outreach to institutions and investors worldwide.

**JA:** Makoto（Mako）SteinerはVeilCoreの共同創業者兼CEOです。事業戦略、資金調達、そして世界各地の機関や投資家へのアウトリーチを統括しています。

### m.mako.bio2

**EN:** He studied Environmental Studies at Denison University and is based in Tokyo.

**JA:** デニソン大学で環境学を専攻し、東京を拠点としています。

### m.mako.leads

**EN:** Japan|EU|Standards bodies|Business development

**JA:** 日本|EU|標準化団体|事業開発

### m.mako.also

**EN:** Midnight Nightforce Leader (Japan) · Build Club, Cohort 1

**JA:** Midnight Nightforce Leader（日本） · Build Club 第1期

### m.mako.languages

**EN:** English · Japanese

**JA:** 英語 · 日本語

### m.hunter.bio1

**EN:** Hunter Roberts is VeilCore's co-founder and COO, leading product and the VeilCore protocol, from the record format to the contract on Midnight. He leads VeilCore's outreach to US institutions, including seed certification, standards and plant-variety bodies.

**JA:** Hunter RobertsはVeilCoreの共同創業者兼COOです。記録フォーマットからMidnight上のコントラクトまで、プロダクトとVeilCoreプロトコルを統括しています。種子認証、標準化、植物品種関係の機関を含む、米国の機関へのVeilCoreのアウトリーチを主導しています。

### m.hunter.bio2

**EN:** He comes from hands-on plant work, including breeding and tissue culture, and is building Chunk's Trees, a cultivation facility in New Jersey.

**JA:** 育種や組織培養を含む植物の実務経験を持ち、ニュージャージー州で栽培施設Chunk's Treesを立ち上げています。

### m.hunter.leads

**EN:** United States|Protocol & spec|Engineering

**JA:** 米国|プロトコルと仕様|エンジニアリング

### m.hunter.also

**EN:** Midnight Nightforce Leader (US) · Build Club, Cohort 1

**JA:** Midnight Nightforce Leader（米国） · Build Club 第1期

### m.founders.band1

**EN:** Talk to us. We'd

**JA:** お話しください。

### m.founders.band2

**EN:** rather hear where it fails

**JA:** うまくいくと言われるより、

### m.founders.band3

**EN:** than be told it works.

**JA:** どこで失敗するかを聞きたいのです。

### m.founders.bandText

**EN:** If you run a breeding programme, a lab, a seed certification agency or a plant-rights body, we'd like to talk. The format is free to implement and free to verify.

**JA:** 育種プログラム、ラボ、種子認証機関、育成者権関係機関を運営されている方は、ぜひお話しさせてください。このフォーマットは実装も検証も無料です。

### m.founders.emailBoth

**EN:** Email both founders

**JA:** 創業者2人にメールする

### m.portraitOf

**EN:** Portrait of {name}

**JA:** {name}の肖像

### m.demo.video.title

**EN:** Watch the walkthrough

**JA:** 紹介動画を見る

### m.demo.video.text

**EN:** The whole flow in 75 seconds: sealing a record, pairing a lab report, checking it, and licence terms.

**JA:** 75秒で全体の流れを紹介します。記録の封印、検査報告書のひも付け、確認、ライセンス条件まで。

### m.chip.video

**EN:** Video

**JA:** 動画

### m.is.4a

**EN:** Licences:

**JA:** ライセンス：

### m.is.4b

**EN:** grant rights to a record. A licensee can prove a licence is valid without revealing which licence it is or who holds it.

**JA:** 記録に対する権利を付与します。ライセンシーは、どのライセンスか、誰が保有しているかを明かさずに、ライセンスが有効であることを証明できます。

### m.is.5a

**EN:** Agreed lineage:

**JA:** 合意された系譜：

### m.is.5b

**EN:** a parent link counts only when both holders confirm it. Obligations such as royalties carry only to descendants declared this way, until the beneficiary releases them. VeilCore records what is owed; it does not collect it.

**JA:** 親子のつながりは双方の保有者が確認した場合にのみ有効です。ロイヤルティなどの義務が引き継がれるのは、このように申告された子孫だけで、受益者が解除するまで続きます。VeilCoreは支払うべきものを記録しますが、徴収はしません。

### m.isnt.4a

**EN:** Not a pedigree test.

**JA:** 血統検査ではありません。

### m.isnt.4b

**EN:** A parent link means both holders agreed, not that DNA proves it.

**JA:** 親子のつながりは双方の保有者が合意したことを意味し、DNAで証明されたことを意味するものではありません。

## Site accuracy pass, 3 October

These strings are new. They make the site say only what is true today (test network, simulated licensing, what the demo stores). Keep every "not", "no" and "only" exactly as in the English, and never make a translation stronger than the English.

### footer.privacy

**EN:** Demo privacy

**JA:** デモのプライバシー

### m.status.keyTitle

**EN:** Who can change the contract.

**JA:** コントラクトを変更できるのは誰か。

### m.status.keyText

**EN:** The founders hold a maintenance key for VeilCore's contract on Midnight. It can change how the contract works from then on. It cannot rewrite records already anchored in the network's history. A policy for using it is proposed, not decided.

**JA:** 創業者は、Midnight上のVeilCoreコントラクトのメンテナンス鍵を保有しています。この鍵では、それ以降のコントラクトの動作を変更できます。ネットワークの履歴にすでにアンカーされた記録を書き換えることはできません。鍵の使用に関するポリシーは提案段階で、まだ決定していません。

### m.status.keyLink

**EN:** Read the proposed policy →

**JA:** 提案中のポリシーを読む →

### m.foot.privacy

**EN:** Demo privacy

**JA:** デモのプライバシー

### m.privacy.label

**EN:** Demo privacy

**JA:** デモのプライバシー

### m.privacy.title

**EN:** What the demo keeps.

**JA:** デモが保存するもの。

### m.privacy.lede

**EN:** This note covers the demo on this site. It is a test, on Midnight's test network. Please use made-up data.

**JA:** このページは、本サイトのデモについての説明です。デモはMidnightのテストネットワーク上での試験です。架空のデータをお使いください。

### m.privacy.stored.title

**EN:** Stored on our test server

**JA:** テストサーバーに保存されるもの

### m.privacy.stored.text

**EN:** What you type and what the app computes from it: cultivar and breeder names, species if you enter one, dates, notes, reference numbers, parents, fingerprints of records, photos and lab reports, lab report file names, agreement terms and counterparties, material you send to a lab (who it is addressed to, and the quantity), and, for labs, the public signing key and the attestations they publish. Also your holder key, which the app sends with every save so the server can find your records. The server is VeilCore's test registry, hosted on Railway.

**JA:** 入力した内容と、そこからアプリが計算したもの：品種名と育成者名、入力した場合は種名、日付、メモ、参照番号、親、記録・写真・検査報告書のフィンガープリント、検査報告書のファイル名、契約の条件と相手方、ラボに送る素材（宛先と数量）、そしてラボの場合は公開する署名用の公開鍵と証明。さらに、サーバーが記録を見つけられるよう、保存のたびにアプリが送信する保有者キー。サーバーはRailway上でホストされているVeilCoreのテスト用レジストリです。

### m.privacy.local.title

**EN:** Never leaves your browser

**JA:** ブラウザから出ないもの

### m.privacy.local.text

**EN:** Genetic data, lab and DNA report files, and photos. The app reads them in your browser to compute their fingerprints. The files themselves are never uploaded.

**JA:** 遺伝データ、検査報告書やDNA報告書のファイル、写真。アプリはフィンガープリントを計算するためにブラウザ内でこれらを読み込みます。ファイル自体がアップロードされることはありません。

### m.privacy.test.title

**EN:** A test network

**JA:** テストネットワーク

### m.privacy.test.text

**EN:** The demo uses Midnight's test network, not the live one. Demo data may be deleted when the test network is reset.

**JA:** デモは本番ネットワークではなく、Midnightのテストネットワークを使用しています。テストネットワークがリセットされた際に、デモのデータが削除されることがあります。

### m.privacy.madeup.title

**EN:** Use made-up data

**JA:** 架空のデータをお使いください

### m.privacy.madeup.text

**EN:** Please don't enter real names, real varieties or anything confidential. The demo is for trying the format.

**JA:** 実在の名前、実在の品種、機密情報は入力しないでください。デモは記録フォーマットを試すためのものです。

### m.privacy.export.title

**EN:** Export

**JA:** エクスポート

### m.privacy.export.text

**EN:** Your records page has an Export button that downloads the records this browser holds. A single download of everything our server holds for you is coming; it is not available yet.

**JA:** 記録ページの「Export」ボタンで、このブラウザが保持している記録をダウンロードできます。私たちのサーバーが保存しているすべてのデータを一括でダウンロードする機能は準備中で、まだ利用できません。

### m.privacy.delete.title

**EN:** Deletion

**JA:** 削除

### m.privacy.delete.text

**EN:** To have your demo data deleted from our server, email hunter@veilcore.org with the identifiers of your records.

**JA:** サーバーからデモのデータを削除してほしい場合は、記録の識別子を添えて hunter@veilcore.org までメールでご連絡ください。

### m.privacy.contact

**EN:** Questions: hunter@veilcore.org

**JA:** お問い合わせ：hunter@veilcore.org
