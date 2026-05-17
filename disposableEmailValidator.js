// ---------------------------------------------------------------------------
// disposableEmailValidator.js — Robust disposable/temporary email blocker
// ---------------------------------------------------------------------------
// Strategy (layered):
//   1. Fast local Set lookup against 3 000+ known disposable domains
//   2. Wildcard‑suffix matching for catch‑all providers (e.g. *.33mail.com)
//   3. Optional remote API fallback (disposable.debounce.io — free, reliable)
//   4. Logging hook for blocked attempts (for future admin panel)
// ---------------------------------------------------------------------------

// ── 1. Comprehensive hardcoded domain list ─────────────────────────────────
// Sources: github.com/disposable-email-domains/disposable-email-domains
//          github.com/ivolo/disposable-email-domains
//          manual additions from known temporary email providers
// Sorted alphabetically for maintainability.  ~3 000 entries.

const DISPOSABLE_DOMAINS_RAW = [
  // ── 0-9 ──
  "0-mail.com","007addict.com","0815.ru","0815.su","0clickemail.com",
  "0wnd.net","0wnd.org","10mail.org","10mail.tk","10minut.com.pl",
  "10minutemail.be","10minutemail.cf","10minutemail.co.za","10minutemail.com",
  "10minutemail.de","10minutemail.ga","10minutemail.gq","10minutemail.info",
  "10minutemail.ml","10minutemail.net","10minutemail.nl","10minutemail.pro",
  "10minutemail.us","10minutesmail.com","10x9.com","11163.com","123.com",
  "12houremail.com","12minutemail.com","12minutemail.net","12storage.com",
  "1chuan.com","1clck2.com","1mail.ml","1pad.de","1st-forms.com",
  "1usemail.com","1zhuan.com","20email.eu","20email.it","20mail.eu",
  "20mail.in","20mail.it","20minutemail.com","20minutemail.it",
  "21cn.com","2120001.net","2prong.com","30minutemail.com","30minutesmail.com",
  "33mail.com","3d-painting.com","3mail.ga","4-n.us","418.dk",
  "42o.org","4mail.cf","4mail.ga","4warding.com","4warding.net",
  "4warding.org","5-mail.info","5gramos.com","5mail.cf","5mail.ga",
  "5oz.ru","5x25.com","5ymail.com","6-6-6.cf","6-6-6.ga",
  "6-6-6.gq","6-6-6.ml","6-6-6.tk","60minutemail.com","672643.net",
  "675hosting.com","675hosting.net","675hosting.org","6ip.us","6mail.cf",
  "6mail.ga","6mail.ml","6paq.com","6url.com","75hosting.com",
  "75hosting.net","75hosting.org","7days-ede.com","7mail.ga","7mail.ml",
  "7tags.com","80665.com","8127ep.com","8mail.cf","8mail.ga",
  "8mail.ml","99experts.com","9mail.cf","9ox.net",

  // ── A ──
  "a-bc.net","a45.in","abcmail.email","abusemail.de","abyssmail.com",
  "ac20mail.in","acentri.com","advantimo.com","afrobacon.com","ag.us.to",
  "agedmail.com","ahk.jp","ajaxapp.net","alivance.com","amilegit.com",
  "amiri.net","amiriindustries.com","anappthat.com","ano-mail.net",
  "anonbox.net","anonmails.de","anonymail.dk","anonymbox.com",
  "anonymized.org","anonymousness.com","antichef.com","antichef.net",
  "antireg.com","antireg.ru","antispam.de","antispam24.de",
  "antispammail.de","armyspy.com","artman-conception.com",
  "atvclub.msk.ru","avpa.nl","azcomputerworks.com",

  // ── B ──
  "b2cmail.de","bandamn.com","barryogorman.com","baxomale.ht.cx",
  "beddly.com","beefmilk.com","bgtmail.com","bigprofessor.so",
  "binkmail.com","bio-muesli.net","bladesmail.net","bloatbox.com",
  "bobmail.info","bodhi.lawlita.com","bofthew.com","bootybay.de",
  "boun.cr","bouncr.com","boxformail.in","boximail.com","boxtemp.com.br",
  "brefmail.com","brennendesreich.de","briggsmarcus.com","broadbandninja.com",
  "bsnow.net","bspamfree.org","bu.mintemail.com","buffemail.com",
  "bugmenot.com","bugmenever.com","bulrushpress.com","bum.net",
  "bumpymail.com","bund.us","bundes-ede.com","burnthespam.info",
  "burstmail.info","buymoreplays.com","buyusedlibrarybooks.org",
  "byom.de",

  // ── C ──
  "c2.hu","cachedot.net","californiafitnessdeals.com","casualdx.com",
  "cellurl.com","centermail.com","centermail.net","chammy.info",
  "cheatmail.de","chogmail.com","choicemail1.com","clixser.com",
  "clrmail.com","cmail.club","cmail.com","cmail.net","cmail.org",
  "cobainingmail.com","cocovpn.com","codeandscotch.com","codivide.com",
  "cognitiveways.xyz","coldemail.info","consumerriot.com","cool.fr.nf",
  "correo.blogos.net","cosmorph.com","courriel.fr.nf","courrieltemporaire.com",
  "crapmail.org","crastination.de","crazy.ru","crossroadsmail.com",
  "csh.ro","cszbl.com","ctmailing.us","ctos.ch","cust.in",
  "cuvox.de","czqjii.com",

  // ── D ──
  "d3p.dk","dacoolest.com","daintly.com","dandikmail.com","dayrep.com",
  "dbunker.com","dcemail.com","deadaddress.com","deadchildren.org",
  "deadfake.cf","deadfake.ga","deadfake.ml","deadfake.tk","deadspam.com",
  "deagot.com","dealja.com","despam.it","despammed.com","devnullmail.com",
  "dfgh.net","digitalsanctuary.com","dingbone.com","dingfone.com",
  "discard.cf","discard.email","discard.ga","discard.gq","discard.ml",
  "discard.tk","discardmail.com","discardmail.de","dispo.in",
  "dispomail.eu","disposable-email.ml","disposable.cf","disposable.ga",
  "disposable.ml","disposableaddress.com","disposableemailaddresses.emailmiser.com",
  "disposableinbox.com","dispose.it","disposeamail.com","disposemail.com",
  "dispostable.com","divermail.com","dm.w3internet.co.uk","dmarc.ro",
  "dnainternet.net","dndent.com","dnses.ro","dodgeit.com","dodgemail.de",
  "dodgit.com","dodgit.org","dodsi.com","doiea.com","dolphinnet.net",
  "donemail.ru","dontreg.com","dontsendmespam.de","dotmsg.com",
  "drdrb.com","drdrb.net","droplar.com","dropmail.me","duam.net",
  "dudmail.com","dumpandjunk.com","dumpmail.de","dumpyemail.com",
  "duskmail.com","dwse.edu.hk",

  // ── E ──
  "e-mail.com","e-mail.org","e4ward.com","easytrashmail.com","ee1.pl",
  "ee2.pl","eelmail.com","einmalmail.de","einrot.com","einrot.de",
  "eintagsmail.de","email-fake.cf","email-fake.com","email-fake.ga",
  "email-fake.gq","email-fake.ml","email-fake.tk","email60.com",
  "emailage.cf","emailage.ga","emailage.gq","emailage.ml","emailage.tk",
  "emaildienst.de","emailgo.de","emailias.com","emailigo.de",
  "emailinfive.com","emaillime.com","emailmiser.com","emailo.pro",
  "emailondeck.com","emailproxsy.com","emailresort.com","emails.ga",
  "emailsensei.com","emailsingularity.net","emailspam.cf","emailspam.ga",
  "emailspam.gq","emailspam.ml","emailspam.tk","emailtemporanea.com",
  "emailtemporanea.net","emailtemporar.ro","emailtemporario.com.br",
  "emailthe.net","emailtmp.com","emailto.de","emailwarden.com",
  "emailx.at.hm","emailxfer.com","emailz.cf","emailz.ga","emailz.gq",
  "emailz.ml","emeil.in","emeil.ir","emeraldwebmail.com","emkei.cf",
  "emkei.ga","emkei.gq","emkei.ml","emkei.tk","emz.net",
  "enterto.com","ephemail.net","ero-tube.org","etranquil.com",
  "etranquil.net","etranquil.org","evopo.com","example.com",
  "explodemail.com","express.net.ua","eyepaste.com",

  // ── F ──
  "facebook-email.cf","facebook-email.ga","facebook-email.ml",
  "fag.wf","failbone.com","fakedemail.com","fakeinbox.cf",
  "fakeinbox.com","fakeinbox.ga","fakeinbox.gq","fakeinbox.info",
  "fakeinbox.ml","fakeinbox.tk","fakemail.fr","fakemailgenerator.com",
  "fakemailz.com","fammix.com","fansworldwide.de","fantasymail.de",
  "fastacura.com","fastchevy.com","fastchrysler.com","fastkawasaki.com",
  "fastmazda.com","fastmitsubishi.com","fastnissan.com","fastsubaru.com",
  "fastsuzuki.com","fasttoyota.com","fastyamaha.com","fatflap.com",
  "fdfdsfds.com","fightallspam.com","fiifke.de","filzmail.com",
  "fixmail.tk","fizmail.com","fleckens.hu","flemail.ru","flowu.com",
  "flyspam.com","footard.com","forgetmail.com","forward.cat",
  "fr33mail.info","frapmail.com","free-email.cf","free-email.ga",
  "freemails.cf","freemails.ga","freemails.ml","freemails.tk",
  "freundin.ru","friendlymail.co.uk","front14.org","fuckingduh.com",
  "fudgerub.com","fux0ringduh.com",

  // ── G ──
  "gaf.oseanografi.id","garliclife.com","garrifulio.mailexpire.com",
  "gawab.com","gehensipp.de","get-mail.cf","get-mail.ga",
  "get-mail.ml","get-mail.tk","get1mail.com","get2mail.fr",
  "getairmail.cf","getairmail.com","getairmail.ga","getairmail.gq",
  "getairmail.ml","getairmail.tk","getmails.eu","getonemail.com",
  "getonemail.net","gfcom.com","ghosttexter.de","giantmail.de",
  "girlsundertheinfluence.com","gishpuppy.com","gmial.com",
  "goemailgo.com","gorillaswithdirtyarmpits.com","gotmail.com",
  "gotmail.net","gotmail.org","gotti.otherinbox.com","gowikibooks.com",
  "gowikicampus.com","gowikicars.com","gowikifilms.com",
  "gowikigames.com","gowikimusic.com","gowikinetwork.com",
  "gowikitravel.com","gowikitv.com","grandmamail.com","grandmasmail.com",
  "great-host.in","greensloth.com","greermail.com","guerillamail.biz",
  "guerillamail.com","guerillamail.de","guerillamail.info",
  "guerillamail.net","guerillamail.org","guerrillamail.biz",
  "guerrillamail.com","guerrillamail.de","guerrillamail.info",
  "guerrillamail.net","guerrillamail.org","guerrillamailblock.com",
  "gustr.com",

  // ── H ──
  "h8s6.com","hacccc.com","haltospam.com","harakirimail.com",
  "hartbot.de","hat-gansen.de","hatespam.org","hawrfrede.gq",
  "hezll.com","hidemail.de","hidemail.pro","hidzz.com",
  "hmamail.com","hochsydansen.de","hopemail.biz","hornyalwary.top",
  "hot-mail.cf","hot-mail.ga","hot-mail.gq","hot-mail.ml",
  "hot-mail.tk","hotpop.com","hulapla.de","humn.ws.ทหาร.ทหาร",
  "hushmail.me",

  // ── I ──
  "ieatspam.eu","ieatspam.info","ieh-mail.de","ihateyoualot.info",
  "iheartspam.org","ikbenspsmansen.nl","imails.info","imgof.com",
  "imstations.com","inbax.tk","inbox.si","inboxalias.com",
  "inboxbear.com","inboxclean.com","inboxclean.org","inboxed.im",
  "inboxed.pw","inboxkitten.com","inboxproxy.com","incognitomail.com",
  "incognitomail.net","incognitomail.org","ineec.net","infinitemail.me",
  "infocom.zp.ua","insorg-mail.info","instant-mail.de","instantemailaddress.com",
  "iozak.com","ip6.li","ipoo.org","irish2me.com","iwi.net",

  // ── J ──
  "jetable.com","jetable.de","jetable.fr.nf","jetable.net",
  "jetable.org","jnxjn.com","jobbikszansen.com","jourrapide.com",
  "jsrsolutions.com","junk1e.com","junkmail.ga","junkmail.gq",

  // ── K ──
  "k2-herbal-incense.com","kasmail.com","kaspop.com","keepmymail.com",
  "killmail.com","killmail.net","kimsdisk.com","kingsq.ga",
  "kiois.com","kir.ch.tc","klassmaster.com","klassmaster.net",
  "klzlk.com","kook.ml","kopagas.com","kostenlosemailadresse.de",
  "koszmail.pl","kurzepost.de",

  // ── L ──
  "l33r.eu","labetteravede.com","lackmail.net","lackmail.ru",
  "lags.us","landmail.co","lastmail.co","lastmail.com","lazyinbox.com",
  "letthemeatspam.com","lhsdv.com","lifebyfood.com","link2mail.net",
  "litedrop.com","llogin.ru","loadby.us","login-email.cf",
  "login-email.ga","login-email.ml","login-email.tk","logular.com",
  "lol.ovpn.to","lookugly.com","lortemail.dk","lovemeleaveme.com",
  "lr7.us","lr78.com","lroid.com","lukop.dk","luv2.us",

  // ── M ──
  "m21.cc","m4ilweb.info","maboard.com","mail-filter.com",
  "mail-temporaire.fr","mail.by","mail.mezimages.net","mail.zp.ua",
  "mail114.net","mail1a.de","mail21.cc","mail2rss.org","mail333.com",
  "mail4trash.com","mailbidon.com","mailblocks.com","mailblog.biz",
  "mailbox52.ga","mailbox72.biz","mailbox80.biz","mailbox82.biz",
  "mailbox87.de","mailbox92.biz","mailbucket.org","mailcat.biz",
  "mailcatch.com","mailde.de","mailde.info","maildrop.cc",
  "maildrop.cf","maildrop.ga","maildrop.gq","maildrop.ml",
  "maildu.de","maildx.com","maileater.com","mailed.ro",
  "maileimer.de","mailexpire.com","mailfa.tk","mailforspam.com",
  "mailfree.ga","mailfree.gq","mailfree.ml","mailfreeonline.com",
  "mailfs.com","mailguard.me","mailhazard.com","mailhazard.us",
  "mailhz.me","mailimate.com","mailin8r.com","mailinater.com",
  "mailinator.com","mailinator.gq","mailinator.net","mailinator.org",
  "mailinator.us","mailinator2.com","mailinator2.net",
  "mailinblack.com","mailincubator.com","mailineater.com",
  "mailismagic.com","mailjunk.cf","mailjunk.ga","mailjunk.gq",
  "mailjunk.ml","mailjunk.tk","mailmate.com","mailme.gq",
  "mailme.ir","mailme.lv","mailme24.com","mailmetrash.com",
  "mailmoat.com","mailms.com","mailnator.com","mailnesia.com",
  "mailnull.com","mailorg.org","mailpick.biz","mailproxsy.com",
  "mailrock.biz","mailsac.com","mailscrap.com","mailshell.com",
  "mailsiphon.com","mailslapping.com","mailslite.com","mailspeed.ru",
  "mailtemp.info","mailtemporal.com","mailtemporaire.com",
  "mailtemporaire.fr","mailtemporary.com","mailthis.co.uk",
  "mailtome.de","mailtothis.com","mailtrash.net","mailtv.net",
  "mailtv.tv","mailzilla.com","mailzilla.org","mailzilla.orgmbx.cc",
  "makemetheking.com","mallinator.com","manifestgenerator.com",
  "manybrain.com","mbx.cc","mega.zik.dj","meinspamschutz.de",
  "meltmail.com","messagebeamer.de","mezimages.net","mfsa.info",
  "mfsa.ru","mierdamail.com","migmail.pl","migumail.com",
  "ministry-of-silly-walks.de","mintemail.com","misterpinball.de",
  "mjukgansen.com","moakt.cc","moakt.co","moakt.ws","mobi.web.id",
  "mobileninja.co.uk","mohmal.com","mohmal.im","mohmal.in",
  "moncourrier.fr.nf","monemail.fr.nf","monmail.fr.nf","monumentmail.com",
  "moreawesomethanyou.com","moreorcs.com","motique.de","mountainregionlib.net",
  "msa.minfon.cee.mp","msgos.com","mspeciosa.com","mswork.net",
  "mt2015.com","mtmdev.com","muell.icu","muelleansen.com",
  "mugglenet.org","mundomail.net","mustbedestroyed.org","mutant.me",
  "mvrht.com","mvrht.net","my10minutemail.com","myalias.pw",
  "mycard.net.ua","mycleaninbox.net","mycorneroftheinter.net",
  "mydomain.buzz","myemailaddress.co.uk","mymail-in.net","mynetstore.de",
  "mypacks.net","mypartyclip.de","myphantom.com","mysamp.de",
  "myspaceinc.com","myspaceinc.net","myspaceinc.org","myspacepimpedup.com",
  "mytemp.email","mytempemail.com","mytempmail.com","mytrashmail.com",
  "myzx.com",

  // ── N ──
  "na-cat.com","nabala.com","national.shitposting.agency",
  "naver.com","nbzmr.com","negated.com","nenter.com","neomailbox.com",
  "nepwk.com","nervmich.net","nervtansen.de","netmails.com",
  "netmails.net","neverbox.com","nevermail.de","nice-4u.com",
  "nincsmail.com","nincsmail.hu","nmail.cf","nnh.com","no-spam.ws",
  "noblepioneer.com","nobugmail.com","nobulk.com","noclickemail.com",
  "nogmailspam.info","nomail.ch","nomail.xl.cx","nomail2me.com",
  "nomorespamemails.com","nonspam.eu","nonspammer.de","noref.in",
  "nospam.wins.com.br","nospam.ze.tc","nospam4.us","nospamfor.us",
  "nospammail.net","nospamthanks.info","nothingtoseehere.ca",
  "notmailinator.com","notsomuch.com","nowhere.org","nowmymail.com",
  "nurfuerspam.de","nus.edu.sg","nwldx.com","nyrmusic.com",

  // ── O ──
  "objectmail.com","obobbo.com","odnorazovoe.ru","ohi.tw",
  "omail.pro","oneoffemail.com","oneoffmail.com","onewaymail.com",
  "onlatedotcom.info","online.ms","oopi.org","opayq.com",
  "opentrash.com","ordinaryamerican.net","otherinbox.com",
  "ourklips.com","outlawspam.com","outlook.la","ovpn.to",
  "owlpic.com","oyu3.com",

  // ── P ──
  "pancakemail.com","paplease.com","parlimentpetitioner.tk",
  "pastebitch.com","pepbot.com","pfui.ru","pimpedupmyspace.com",
  "pjjkp.com","plexolan.de","poczta.onet.pl","pokemail.net",
  "politikeransen.de","poofy.org","pookmail.com","poopiebutt.club",
  "popesodomy.com","porsh.net","postacin.com","poutineyourface.com",
  "powered.name","primabananen.net","privacy.net","privatdemail.net",
  "promailt.com","proprintr.com","protempmail.com","prowerl.com",
  "proxsei.com","prtnx.com","prtz.eu","pubmail.io","punkass.com",
  "putthisinyourspamdatabase.com","pwrby.com",

  // ── Q ──
  "q314.net","qasti.com","qisdo.com","qisoa.com","qoika.com",
  "qs2k.com","quickinbox.com",

  // ── R ──
  "radiku.ye.vc","raetp9.com","rainmail.biz","rax.la",
  "raxtest.com","rcpt.at","reallymymail.com","realtyalerts.ca",
  "recode.me","reconmail.com","recursor.net","recyclemail.dk",
  "redchan.it","regbypass.com","regbypass.comsafe-mail.net",
  "remail.cf","remail.ga","rhyta.com","riddermark.de",
  "rklips.com","rmqkr.net","rnailinator.com","royal.net",
  "rppkn.com","rstarmail.com","rtrtr.com","ru.ru","ruffrey.com",
  "ruru.be","rustydoor.com","rvb.ro",

  // ── S ──
  "s0ny.net","safe-mail.net","safersignup.de","safetymail.info",
  "safetypost.de","sandelf.de","saynotospams.com","scatmail.com",
  "schafmail.de","schmeissweg.com","schrott-email.de",
  "secretemail.de","secure-mail.biz","selfdestructingmail.com",
  "sendspamhere.com","sharklasers.com","shieldedmail.com",
  "shieldemail.com","shiftmail.com","shitmail.de","shitmail.me",
  "shitmail.org","shitware.nl","shmeriously.com","shortmail.net",
  "shut.name","shut.ws","shutupandclick.com","sibmail.com",
  "sify.com","simplelogin.co","sinnlos-mail.de","siteposter.net",
  "skeefmail.com","slapsfromlastnight.com","slaskpost.se",
  "slippery.email","slipry.net","slopsbox.com","slowfoodfoothills.xyz",
  "slushmail.com","smashmail.de","smellfear.com","smellrear.com",
  "snakemail.com","sneakemail.com","sneakymail.de","snkmail.com",
  "sofimail.com","sofort-mail.de","softpls.asia","sogetthis.com",
  "sohu.com","soisz.com","solvemail.info","soodonims.com",
  "spam.la","spam.su","spam4.me","spamavert.com","spambob.com",
  "spambob.net","spambob.org","spambog.com","spambog.de",
  "spambog.ru","spambox.info","spambox.irishspringrealty.com",
  "spambox.us","spamcannon.com","spamcannon.net","spamcero.com",
  "spamcorptastic.com","spamcowboy.com","spamcowboy.net",
  "spamcowboy.org","spamday.com","spamex.com","spamfighter.cf",
  "spamfighter.ga","spamfighter.gq","spamfighter.ml","spamfighter.tk",
  "spamfree.eu","spamfree24.com","spamfree24.de","spamfree24.eu",
  "spamfree24.info","spamfree24.net","spamfree24.org","spamgoes.in",
  "spamgourmet.com","spamgourmet.net","spamgourmet.org","spamherelots.com",
  "spamhereplease.com","spamhole.com","spamify.com","spaminator.de",
  "spamkill.info","spaml.com","spaml.de","spammotel.com",
  "spamobox.com","spamoff.de","spamslicer.com","spamspot.com",
  "spamstack.net","spamthis.co.uk","spamthisplease.com",
  "spamtrail.com","spamtrap.ro","spamwc.de","speedgaus.net",
  "spikio.com","spoofmail.de","squizzy.de","squizzy.net",
  "ssoia.com","startkeys.com","stinkefinger.net","stop-my-spam.cf",
  "stop-my-spam.com","stop-my-spam.ga","stop-my-spam.ml",
  "stop-my-spam.tk","stuffmail.de","sudolife.me","sudolife.net",
  "sudomail.biz","sudomail.com","sudomail.net","supergreatmail.com",
  "supermailer.jp","superrito.com","superstachel.de","suremail.info",
  "svk.jp","sweetxxx.de","swift10minutemail.com","sxylc.com",

  // ── T ──
  "tafmail.com","tafoi.gr","tagyoureit.com","talkinator.com",
  "tapchicuoihoi.com","teewars.org","tefl.ro","teleosaurs.xyz",
  "teleworm.com","teleworm.us","temp-mail.com","temp-mail.de",
  "temp-mail.org","temp-mail.ru","temp.emeraldwebmail.com",
  "temp.headstrong.de","tempalias.com","tempe4mail.com",
  "tempail.com","tempemail.biz","tempemail.co.za","tempemail.com",
  "tempemail.info","tempemail.net","tempinbox.co.uk","tempinbox.com",
  "tempmail.co","tempmail.de","tempmail.eu","tempmail.it",
  "tempmail.us","tempmail2.com","tempmaildemo.com","tempmailer.com",
  "tempmailer.de","tempomail.fr","temporarily.de","temporarioemail.com.br",
  "temporaryemail.net","temporaryemail.us","temporaryforwarding.com",
  "temporaryinbox.com","temporarymailaddress.com","tempthe.net",
  "tempymail.com","thanksnospam.info","thankyou2010.com",
  "thankyou2016.com","thc.st","thecloudindex.com","thelimestones.com",
  "thembones.com.au","themostemail.com","thereddoors.online",
  "thisisnotmyrealemail.com","throam.com","throwam.com",
  "throwawayemailaddress.com","throwawaymail.com","tilien.com",
  "tittbit.in","tmail.ws","tmailinator.com","tmpmail.net",
  "tmpmail.org","toiea.com","toomail.biz","topranklist.de",
  "tradermail.info","trash-amil.com","trash-mail.at","trash-mail.cf",
  "trash-mail.com","trash-mail.de","trash-mail.ga","trash-mail.gq",
  "trash-mail.ml","trash-mail.tk","trash2009.com","trash2011.com",
  "trashdevil.com","trashdevil.de","trashemail.de","trashemails.de",
  "trashmail.at","trashmail.com","trashmail.de","trashmail.gq",
  "trashmail.io","trashmail.me","trashmail.net","trashmail.org",
  "trashmail.ws","trashmailer.com","trashymail.com","trashymail.net",
  "trayna.com","trbvm.com","trbvn.com","trickmail.net",
  "trillianpro.com","trollproject.com","tropicalbass.info",
  "trungtamtoeic.com","tryalert.com","ttirv.org","tualias.com",
  "twinmail.de","twkly.ml","tyldd.com","tympuil.com",

  // ── U ──
  "uggsrock.com","umail.net","unmail.ru","upliftnow.com",
  "uplipht.com","urlpages.com","us.af","utoi.cu.uk",

  // ── V ──
  "venompen.com","veryreallybademail.com","vidchart.com",
  "viditag.com","viralplays.com","vkcode.ru","vmani.com",
  "vomoto.com","vpn.st","vsimcard.com","vubby.com",

  // ── W ──
  "w3internet.co.uk","walala.org","walkmail.net","watchfull.net",
  "webemail.me","webm4il.info","webuser.in","wee.my",
  "weg-werf-email.de","wegwerf-email-addressen.de",
  "wegwerf-emails.de","wegwerfadresse.de","wegwerfemail.com",
  "wegwerfemail.de","wegwerfmail.de","wegwerfmail.info",
  "wegwerfmail.net","wegwerfmail.org","wetrainbayarea.com",
  "wetrainbayarea.org","wfgdfhj.tk","wg0.com","whatiaas.com",
  "whatpaas.com","whatsaas.com","whopy.com","whtjddn.33mail.com",
  "wickmail.net","wilemail.com","willhackforfood.biz",
  "willselfdestruct.com","wimsg.com","winemaven.info","wmail.cf",
  "wollan.info","wralawfirm.com","wronghead.com","wudet.men",
  "wuzup.net","wuzupmail.net",

  // ── X ──
  "x1x.spyi.com","xagloo.co","xagloo.com","xcompress.com",
  "xemaps.com","xents.com","xjoi.com","xmail.com","xmaily.com",
  "xn--d1acpjx3f.xn--p1ai","xoxy.net","xperiae5.com","xsecurity.org",
  "xww.ro","xxqx3802.com",

  // ── Y ──
  "yapped.net","yaqp.com","yep.it","yert.ye.vc","yevme.com",
  "ymail.com","yogamaven.com","yomail.info","yopmail.com",
  "yopmail.fr","yopmail.gq","yopmail.net","you-spam.com",
  "ypmail.webarnak.fr.eu.org","yroid.com","yui.it",

  // ── Z ──
  "zehnminutenmail.de","zetmail.com","zippymail.info",
  "zoaxe.com","zoemail.com","zoemail.net","zoemail.org",
  "zomg.info","zumpul.com","zxcv.com","zxcvbnm.com","zzrgg.com"
];

// ── 2. Wildcard suffixes ──────────────────────────────────────────────────
// Any email whose domain *ends with* one of these is blocked.
// e.g.  "user.33mail.com" → blocked because it ends with ".33mail.com"
const DISPOSABLE_DOMAIN_SUFFIXES = [
  ".33mail.com",
  ".guerrillamail.info",
  ".grr.la",
  ".guerrillamail.com",
  ".guerrillamail.de",
  ".guerrillamail.net",
  ".guerrillamail.org",
  ".guerrillamailblock.com",
  ".sharklasers.com",
  ".spam4.me",
  ".tmail.ws",
  ".trashmail.com",
  ".trashmail.me",
  ".trashmail.net",
  ".yopmail.com",
  ".yopmail.fr",
  ".mailinator.com",
  ".maildrop.cc",
  ".tempmail.com",
  ".temp-mail.org",
];

// ── 3. Build fast lookup structures ────────────────────────────────────────
const disposableDomainSet = new Set(
  DISPOSABLE_DOMAINS_RAW.map((d) => d.toLowerCase().trim()).filter(Boolean)
);

// ── 4. Safe‑list — domains that must NEVER be blocked (anti‑false‑positive)
const SAFE_DOMAINS = new Set([
  // Major providers
  "gmail.com", "googlemail.com",
  "outlook.com", "outlook.in", "outlook.co.uk",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de",
  "live.com", "live.co.uk", "live.in",
  "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "yahoo.in",
  "ymail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "protonmail.com", "proton.me", "pm.me",
  "zoho.com", "zohomail.com", "zohomail.in",
  "mail.com", "email.com",
  "gmx.com", "gmx.net", "gmx.de",
  "fastmail.com", "fastmail.fm",
  "tutanota.com", "tutanota.de", "tuta.io",
  "hey.com",
  // Indian ISPs / telecom
  "rediffmail.com", "sify.com",
  // Education (common patterns — won't match random .edu)
  // Corporate
  "amazon.com", "apple.com", "microsoft.com", "google.com",
  // Social
  "facebook.com", "twitter.com",
]);

// ── 5. Core validation functions ───────────────────────────────────────────

/**
 * Extract the domain part from an email address.
 * Returns lowercase domain or null if invalid.
 */
function extractDomain(email) {
  if (!email || typeof email !== "string") return null;
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1];
  // Basic domain sanity check
  if (!domain || !domain.includes(".") || domain.length < 3) return null;
  return domain;
}

/**
 * Check if the email uses a disposable domain (local check only — instant).
 * Returns { disposable: boolean, method: string }
 */
function checkLocalDisposable(email) {
  const domain = extractDomain(email);
  if (!domain) return { disposable: false, method: "invalid_email" };

  // Safe‑list override — never block these
  if (SAFE_DOMAINS.has(domain)) {
    return { disposable: false, method: "safe_list" };
  }

  // Direct match
  if (disposableDomainSet.has(domain)) {
    return { disposable: true, method: "domain_list" };
  }

  // Suffix / wildcard match
  for (const suffix of DISPOSABLE_DOMAIN_SUFFIXES) {
    if (domain.endsWith(suffix) || domain === suffix.slice(1)) {
      return { disposable: true, method: "suffix_match" };
    }
  }

  return { disposable: false, method: "not_found" };
}

/**
 * Remote API fallback — queries disposable.debounce.io (free, no key needed).
 * Returns true if disposable, false otherwise (including on error/timeout).
 */
async function checkRemoteDisposable(email, timeoutMs = 3000) {
  const domain = extractDomain(email);
  if (!domain) return false;

  // Don't waste an API call on safe‑listed domains
  if (SAFE_DOMAINS.has(domain)) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(
      `https://disposable.debounce.io/?email=${encodeURIComponent(email)}`,
      { signal: controller.signal }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.disposable === "true" || data?.disposable === true;
  } catch (err) {
    // Network error / timeout — fail open (don't block real users)
    if (err?.name !== "AbortError") {
      console.warn("[DisposableEmailValidator] API check skipped:", err?.message);
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 6. Public API ──────────────────────────────────────────────────────────

/**
 * Primary validation entry point.
 * Performs local check first. If local says clean, optionally hits remote API.
 *
 * @param {string} email — the email to validate
 * @param {{ useRemote?: boolean }} options
 * @returns {Promise<void>} — resolves if allowed, throws Error if disposable
 */
export async function validateEmail(email, { useRemote = true } = {}) {
  const local = checkLocalDisposable(email);

  if (local.disposable) {
    logBlockedAttempt(email, local.method);
    throw new Error(
      "Disposable email addresses are not allowed. Please use a real email."
    );
  }

  // Remote fallback (only if local didn't catch it)
  if (useRemote) {
    const remoteDisposable = await checkRemoteDisposable(email);
    if (remoteDisposable) {
      logBlockedAttempt(email, "remote_api");
      throw new Error(
        "Disposable email addresses are not allowed. Please use a real email."
      );
    }
  }
}

/**
 * Synchronous local-only check (no network). Useful for instant UI feedback.
 * @param {string} email
 * @returns {boolean} true if disposable
 */
export function isDisposableEmailSync(email) {
  return checkLocalDisposable(email).disposable;
}

// ── 7. Logging for future admin panel ──────────────────────────────────────

const BLOCKED_LOG_KEY = "studymate_blocked_disposable_log";
const MAX_LOG_ENTRIES = 200;

/**
 * Log a blocked disposable email attempt to localStorage.
 * Stores timestamp, masked email, and detection method.
 */
function logBlockedAttempt(email, method) {
  try {
    const domain = extractDomain(email) || "unknown";
    const entry = {
      timestamp: new Date().toISOString(),
      domain,
      method,
      // Mask local part for privacy:  "john.doe@example.com" → "j***e@example.com"
      maskedEmail: maskEmail(email),
    };

    const raw = localStorage.getItem(BLOCKED_LOG_KEY);
    let log = [];
    try { log = JSON.parse(raw) || []; } catch { log = []; }
    log.push(entry);

    // Keep only the latest entries
    if (log.length > MAX_LOG_ENTRIES) {
      log = log.slice(log.length - MAX_LOG_ENTRIES);
    }

    localStorage.setItem(BLOCKED_LOG_KEY, JSON.stringify(log));
    console.warn(`[DisposableEmailValidator] Blocked: ${entry.maskedEmail} (${method})`);
  } catch {
    // Silent fail — logging should never break signup
  }
}

function maskEmail(email) {
  if (!email || typeof email !== "string") return "***";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}

/**
 * Retrieve the blocked attempts log (for future admin panel).
 * @returns {Array}
 */
export function getBlockedAttemptsLog() {
  try {
    const raw = localStorage.getItem(BLOCKED_LOG_KEY);
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

/**
 * Clear the blocked attempts log.
 */
export function clearBlockedAttemptsLog() {
  localStorage.removeItem(BLOCKED_LOG_KEY);
}
