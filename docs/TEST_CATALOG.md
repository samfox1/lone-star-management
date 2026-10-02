# Test catalog

Every test in the tidied areas, in plain words: what each file proves, which code it tests, how
strictly (Tier), what it leaves to other files, and then one line per test (the comment above it).

**Generated. Do not edit by hand.** Change the test file, then run `npm run test:catalog`.
How the tests are organized, and the header every file opens with: [tests/README.md](../tests/README.md).
A table test (`it.each`) counts once here and runs once per row.

**81 test files · 1375 tests**

- [SEO / GEO checks: the engine](#seo--geo-checks-the-engine) · 31 files · 597 tests
- [SEO / GEO page](#seo--geo-page) · 20 files · 294 tests
- [SEO / GEO saved runs (database)](#seo--geo-saved-runs-database) · 1 file · 21 tests
- [SEO / GEO page (database)](#seo--geo-page-database) · 2 files · 16 tests
- [Safe fetching](#safe-fetching) · 6 files · 93 tests
- [Search engines (Google and Bing)](#search-engines-google-and-bing) · 5 files · 99 tests
- [Stored logins](#stored-logins) · 2 files · 27 tests
- [Eventbrite and YouTube sign-in](#eventbrite-and-youtube-sign-in) · 8 files · 144 tests
- [Identity databases (MusicBrainz, Discogs, Wikidata)](#identity-databases-musicbrainz-discogs-wikidata) · 2 files · 23 tests
- [Shows from Eventbrite](#shows-from-eventbrite) · 3 files · 45 tests
- [The test standard](#the-test-standard) · 1 file · 16 tests

## SEO / GEO checks: the engine

The checks the SEO/GEO page runs against an artist’s live site, and the page readers they stand on.

### tests/unit/seo-tests/can-be-found/allowed.test.ts · 6 tests

"Search engines are allowed to list you" passes only when nothing on the pages we opened tells Google or Bing to skip a page or to list another address instead.

- **Code:** src/lib/seo-tests/found.ts (allowed)
- **Tier:** STRICT (AGENTS.md "Test depth"): one wrong setting can hide a whole site, and this result is what the manager is told about it.
- **Not here:** the plain-words and never-throws rules shared by all ten tests (contract.test.ts); each bot's own "don't list me" and settings rules (bots.test.ts).

**Tests**

- The exact words a manager reads when nothing hides the site, with what was read in the details.
- A settings file refused to us may hold rules we didn't see: couldn't check.
- A home page that sends everyone on to a language or regional page is judged where it landed: naming itself (/en), or naming the "/" we asked for (theguardian.com's "/us"), is the usual pattern, not "list another page". (verify-found F11) _(one per row of a table)_
- Two main addresses that disagree (Google may ignore both), or an http:// one on an https page, are noted in the details. (verify-found F19)
- A menu link missing for everyone (404) is a broken link, not a page hiding itself: a note, and it leaves the count.
- Without Google's copy of a page, or without any Google and Bing visits, we can't say what they are told.

### tests/unit/seo-tests/can-be-found/bingwm.test.ts · 3 tests

"Your site is linked to Bing Webmaster Tools" passes only on a real Bing code on the site, and never fails: without one it says it saw no sign, since a site can be linked in ways we can't see.

- **Code:** src/lib/seo-tests/found.ts (bingwm)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads codes off the live site and tells the manager whether to go and set something up.
- **Not here:** whether /BingSiteAuth.xml holds a real code (evidence.test.ts reads the file); the rules shared by all ten tests (contract.test.ts).

**Tests**

- An empty tag, or one still holding a placeholder, is not Bing's code. (verify-found F29) _(one per row of a table)_
- With no sign it is "couldn't check", never a fail (a site can be linked in ways we can't see), in these exact words, with a button to Bing and the way to do it.
- A home page we couldn't read is where the tag would be: we say so, not "no sign".

### tests/unit/seo-tests/can-be-found/bots.test.ts · 42 tests

The six "Your site is open to …" tests say a bot is let in only when every page we opened really opened for it, as the same page a person gets, and nothing asks it to stay away.

- **Code:** src/lib/seo-tests/found.ts (botTest), src/lib/seo-tests/bots.ts (who we visit as)
- **Tier:** STRICT (AGENTS.md "Test depth"): these results are what a manager is told about the live site; `fail` only for what we saw, `unknown` for what we could not look at.
- **Not here:** what all ten tests share (contract.test.ts); how robots.txt is read line by line (robots-txt.test.ts); how the visits are fetched (evidence.test.ts).

**Tests**

- The "training only" marks decide when a block is "Almost" (only AI training blocked): they must be the vendors' own list, not a guess.
- Every rule below runs once for each of the six tests, turning away that test's own visitor. _(one per row of a table)_
- The pass, with every name we visited as in the details and the look-alike limit: we visit from our own server using the bot's name, so a firewall may treat the real bot differently.
- A refusal the bot got and a person didn't is a fail: the status in plain words in the sentence (the number stays in the details, UI review 2026-09-29), with the server we saw. _(one per row of a table)_
- The same refusal for a person too means the site turned US away, not the bot: we can't say what the real bot gets.
- What we saw outranks what we couldn't see: one page refused and another silent is a fail.
- A test reads every visitor it names (ChatGPT has three): any one of them turned away fails it.
- A menu link that 404s for everyone is a broken link, not the bot being turned away: it is noted and leaves the count (the list test judges broken pages).
- The home page is never left out: missing for everyone is a fail.
- No answer is never a pass: "couldn't check", saying why in plain words (we stop after 3 redirects; the real bot may follow more). _(one per row of a table)_
- A visitor missing from the evidence was never sent: we can't say what it gets.
- With no person's visits there is nothing to compare the bot's page with.
- A person's visit refused while the bot got the page: the comparison was not made, and the details say so. (verify-found F12)
- A challenge for people too is our server being stopped, not the bot: couldn't check.
- A password page keeps every reader out, even when people get it too.
- A "not found" page served with a 200 is still a missing page. (verify-found F10) _(one per row of a table)_
- The same file for everyone (a PDF on the list) is not a bot problem: noted, not judged.
- A web page answer with no page in it, for everyone, can't be read: couldn't check, never a pass.
- Each of the artist's published words a person's copy shows must be in the bot's copy too, however alike the rest of the page is: fail, naming what is missing. (verify-found F4, F5) _(one per row of a table)_
- A copy with every artist word but a third more words besides is a different page: under 80% the same words fails, with the share in the details. (verify-found F5)
- A page with almost no words and no scripts has nothing for anyone to read. (verify-found F3)
- A rule for this bot by name is a fail, with the rule itself in the details.
- A rule for everyone keeps every page out.
- A server error on the settings file makes Google (and the standard) stay away from the whole site: a fail we saw.
- No settings file at all means "no rules": fine.
- Rules that don't hide the page, or hide it only from another bot, or only later, pass. _(one per row of a table)_
- A page over 1 MB is read only in part, and a comment cut open can hide the rest: it is never judged on its words (it would look blank). (verify-found F17)
- …but a "don't list me" in the part we did read is still seen. (verify-found F17)
- The exact words a manager reads when Google is turned away from one page.
- A noindex for Googlebot only hides the page from Google, and from Gemini (it uses what Googlebot fetched), but not from Bing or ChatGPT.
- The exact words a manager reads when Bing is let in.
- Turning away only ChatGPT's training visitor is the site's choice, and search still works: an "Almost", worded exactly, with the name kept capitalised. (verify-found F6)
- Asking the SEARCH visitor to stay away is a plain fail: it hides the artist from ChatGPT search.
- A failure every Claude visitor shares is a plain fail, not "only the training visitor", in these exact words. (verify-found F8)
- The exact words a manager reads when Perplexity can't read a page built by its scripts.
- medium.com, as seen: Apple Intelligence asked to stay away by a rule and Common Crawl refused by the server. Both only train AI: "Almost", in these exact words ("turns away", since one was a refusal, not a request).
- Gemini's name (Google-Extended) is a settings-only name: asking it to stay away fails "others", naming Gemini, and does not touch Google's own test.
- Gemini reads what Googlebot fetched, so a Googlebot rule always reaches it. Apple follows Googlebot's rules only when it has none of its own (Apple's doc): the details show whether the rule was read for Applebot.
- A noindex seen only on Googlebot's copy is blamed on Gemini, the one that reads that copy, never on Apple or Common Crawl. (verify-found F18)
- Alexa. Amazon: when robots.txt doesn't name Amzn-SearchBot but lets other search bots in, it follows "the robots.txt directives given to other search bots", without saying which. A file that lets every other crawler in by name and keeps `*` out can't be read for Alexa: couldn't tell, never a fail. The groups come from the bot list, so a crawler added there is named too.
- Common Crawl asked to stay away by a rule: "Almost", with no made-up "Common Crawl search" and a value that doesn't read as "nothing opened". (verify-found F6)
- A page empty until its scripts run fails on Common Crawl's account only (Apple and Google run scripts). It is "Almost", but NOT the site's choice, so never called one. (verify-found F6)

### tests/unit/seo-tests/can-be-found/contract.test.ts · 11 tests

Every one of the ten "Can be found" tests keeps the honesty rules, whatever site we point it at.

- **Code:** src/lib/seo-tests/found.ts (FOUND_TESTS, and the page readings all ten share)
- **Tier:** STRICT (AGENTS.md "Test depth"): these results are what a manager is told about the live site.
- **Not here:** each test's own rules: bots.test.ts, allowed.test.ts, list.test.ts, words.test.ts and bingwm.test.ts in this folder. How the site is fetched: evidence.test.ts. The "in Tapir:" label rule across all 24 tests: ../honesty.test.ts.

**Tests**

- The code covers exactly the Test tab's list: a test on the page with no code would never run.
- Each of the ten tests, read from the code, meets every site below. _(one per row of a table)_
- The honesty rules (types.ts): a known status, a short value, one plain sentence with the right capital, a limit, and no code words or html outside the details. A test that breaks one of these shows the manager something wrong or unreadable. _(one per row of a table)_
- A bug inside a test must never read as a pass: the code wraps every test so a throw becomes "couldn't check" with its own sentence.
- Evidence with its lists missing is handled by each test itself (its own "couldn't check" sentence), not by the safety net above: the net hides which test is broken.
- Every test reads the same "is the site up" fact first, so a dead site is one clear message on every row, not ten different guesses (and never a blame on the settings file).
- Same for a site whose every answer is a server error: "it may be down", not a settings problem.
- An "Access denied" page with no vendor's mark, served to everyone with a 200: we were shown a wall, not the site, so nothing can be said about it. (verify-found F2)
- A parked or "coming soon" page without the artist's name is not the artist's site: every test that reads pages says so and names the artist. The list and Bing tests don't read the name.
- medium.com, as seen: a short home page loading reCAPTCHA, and a 403 for the AI bots' names. The person's page is not a wall, so the 403 is the bots being turned away: a fail, not "couldn't check". Google still gets in. (verify-found F9, a real site)
- A song called "Not Found" or a tour called "Area 404" is a real page, not a missing one: only a title or heading that IS a not-found message counts. (verify-found F10) _(one per row of a table)_

### tests/unit/seo-tests/can-be-found/evidence.test.ts · 34 tests

The one visit to the artist's site that every "Can be found" test reads: which pages it opens, how it finds and reads the list of pages, and that it never leaves the site or outstays its welcome.

- **Code:** src/lib/seo-tests/evidence.ts (gatherSiteEvidence, sameSite, parseSitemap)
- **Tier:** STRICT (AGENTS.md "Test depth"): it fetches addresses that a manager and a site's own files hand the server, and parses what comes back.
- **Not here:** what the tests conclude from this evidence (the other files in this folder); how robots.txt rules are read (robots-txt.test.ts); the fetch guard itself, byte caps and slow parsers of other readers (tests/unit/safe-fetching/).

**Tests**

- www and the bare domain, over http or https, any letter case or a trailing dot, are one site: otherwise a site's own links would count as "another site".
- Everything else is another site we never fetch: a sub-domain (anyone can run one), a look- alike name, a login trick, another scheme or port, or junk. _(one per row of a table)_
- Every page on the list is visited once as a person and once as each bot, under the bot's exact name from bots.ts, and nothing outside the site is asked for.
- Only the headers a test reads are kept: never a cookie, never anything else.
- A page's html is kept only for a 2xx web page: not for an error, not for JSON.
- The run starts from where the home page really lives (bare domain → www), so every other request goes straight there instead of through the redirect.
- The artist's key pages (about, music, …) come first, ahead of news posts earlier on the list: they are where the bio, releases and shows live. (verify-found F26)
- With no list, the pages home links to are opened: this site only, no files, no mail links. (verify-found F26)
- A list of 10,000 pages: 5 pages are visited, the kept list is capped, and all are counted; the number of requests is exactly the pages times the visitors, plus three files.
- With no list named in robots.txt, /sitemap.xml is read, and the evidence says it wasn't named.
- robots.txt names two lists and the first is gone: the second is read, and both tries are recorded. (verify-found F21)
- A list robots.txt names on another site is recorded but never opened. (verify-found F25)
- A gzip bomb (64 MB of spaces packed small) stops at the unpacking cap instead of filling memory, and is marked as cut. (verify-found F20, security)
- An index is followed one level deep, on this site only: an index inside it, and a list on another host, are never opened.
- An index naming more lists than we open (3) records how many it names. (verify-found F23)
- Pages the list names on other hosts or private addresses are counted, never visited.
- Entries that aren't full addresses are counted as that (not "other sites"), and this site spelled another way (http://, the bare domain) is counted too. (verify-found F25)
- An address with an entity (&amp;) is read as the address it stands for.
- …and a normal list still reads exactly: name prefixes, CDATA, entities and spaces.
- An address past 8 KB is junk (sitemaps.org: under 2,048 characters): not decoded whole.
- A character reference past the last Unicode character is replaced, not thrown.
- A 5 MB robots.txt is read only as far as the 500 KiB anyone obeys.
- robots.txt is always read as UTF-8 (RFC 9309): a UTF-16 file is junk to Google, so it holds no rules for us either.
- A robots.txt that redirects to another site is not followed, and where it pointed is kept as the reason. (verify-found F14)
- A redirect to a private address or to another site is never followed: the visit has no answer, and where it pointed is named. _(one per row of a table)_
- A redirect loop ends as "too many redirects", not a hang.
- A page that never ends is cut at 1 MiB and marked as cut.
- A site that is not a public address (a private network, this machine, junk) is never visited at all, and every part of the evidence says why. _(one per row of a table)_
- A page is read in the character set it names, by header or by <meta charset>, so accented words match what Tapir holds. (verify-found F28) _(one per row of a table)_
- An answer, even an error, is never asked for again.
- Only once: a page that keeps failing costs two tries, then "no answer".
- At most 4 requests are open at once (and more than one, or the run would be slow).
- The whole run stops at its time budget: what it didn't reach is "out-of-time" (a no answer the tests read as couldn't check), never a pass, and never mistaken for the site timing out. The bound is the hang's only other way out, its own 10 s limit, not a guess at how fast this machine is: a budget that doesn't cut the hang lands past it, however busy the machine.
- Each request gives up at its own time limit, and the rest of the run carries on. "timeout", not "out-of-time", says the request's own limit ended it before the run's budget did.

### tests/unit/seo-tests/can-be-found/list.test.ts · 9 tests

"Your site offers Google a list of your pages" passes only when the site's list of pages (its sitemap) is a real list, of full addresses on this site, with honest dates, and the pages we opened from it open.

- **Code:** src/lib/seo-tests/found.ts (list, isW3cDate)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads a file the site hands us (a parser's verdict) and tells the manager whether Google can find new pages.
- **Not here:** how the list is found, downloaded and parsed (evidence.test.ts); the rules shared by all ten tests (contract.test.ts).

**Tests**

- The exact words a manager reads, with where the list was and how many pages we opened.
- A date in the future, or one that isn't a real date, makes search engines stop trusting the list's dates: a fail quoting it. The day must exist in its month. (verify-found F24) _(one per row of a table)_
- No dates at all is a near miss: search engines can't tell what's new.
- Every page on one date is often the build time, but can be honest: noted, never judged.
- The settings file naming a list on another site while /sitemap.xml works is a note, not a miss. (verify-found F25)
- With no pages opened at all, the list test can't speak for the site.
- A long list is counted whole (not the part we kept), only the pages we opened are judged, and the sentence says how few that is. (verify-found F23)
- An index whose lists we read only some of says so. (verify-found F23)
- A listed page that asks not to be listed, and addresses spelled another way than the site answers on, are noted (the allowed test judges the first). (verify-found F25)

### tests/unit/seo-tests/can-be-found/robots-txt.test.ts · 27 tests

The site's settings file (robots.txt) is read exactly the way the standard (RFC 9309) and Google read it, so "this bot may visit this page" means what it means to the real bot.

- **Code:** src/lib/seo-tests/robots-txt.ts (parseRobots, checkRobots, matchesPath, robotsVerdict)
- **Tier:** STRICT (AGENTS.md "Test depth"): a parser of a file the site hands us.
- **Not here:** what each test concludes from a verdict (bots.test.ts, allowed.test.ts, list.test.ts); how the file is fetched, capped and decoded (evidence.test.ts).

**Tests**

- A bot with no group of its own follows "*": its .gif and /example/ rules, its /publications/ allow.
- A bot with its own group follows only that group, never "*" as well.
- Two user-agent lines in a row share the rules below them.
- A group with no rules allows everything.
- When rules disagree, the longest matching one decides.
- A bot missing from the file falls back to "*", and another bot's group is not its own.
- No group for the bot and no "*" group: nothing is blocked (an empty file too).
- "ツ", "%E3%83%84" and "%e3%83%84" are one path, and "%62" is "b": a rule can't be dodged by spelling.
- An encoded * or $ in a rule is the plain character, not a wildcard.
- A tie between an allow and a disallow of the same length is an allow, even when the disallow comes first in the file (Google's precedence table only shows the allow first).
- The settings file itself can always be read, and nothing that merely starts like it.
- Rules above the first user-agent line belong to nobody.
- Names and field names ignore letter case; paths do not.
- A Sitemap line inside a group doesn't end it, and is still collected.
- The bot's own exact name beats "*", wherever it sits in the file; a longer name is not a match.
- Every group for one name is merged, and never combined with "*". (Also RFC figure 2.)
- A version or a star after the name is ignored ("googlebot/1.2" is googlebot), but a longer name is another bot.
- "Disallow:" with nothing after it is ignored, not "block everything".
- Google's URL matching table, one row per pattern: the paths it matches and the ones it doesn't. _(one per row of a table)_
- Google's order-of-precedence table, one row per case: the longest rule wins, an allow on a tie (RFC 2.2.2), and "$" ends a pattern. _(one per row of a table)_
- A byte order mark, comments and old Mac or Windows line ends don't change the rules.
- Google's own parser accepts "user-agent *" and "dissallow": so do we, but not a sentence.
- A web page served where the settings file should be holds no rules.
- Google reads only the first 500 KiB, so a rule after that is not a rule.
- A hostile file of star-filled patterns is checked in under 2 s: a backtracking matcher HANGS here instead (seen 2026-09-28 when the matcher was swapped for one by hand).
- Apple uses its own group if it has one, else Googlebot's, else "*" (Apple's doc).
- The rule and group that decided are handed back, so the details can quote the site's own line.

### tests/unit/seo-tests/can-be-found/words.test.ts · 13 tests

"Your words are in the page itself" passes only when the artist's published bio, releases and upcoming shows are written on the pages as text a reader with scripts off can see.

- **Code:** src/lib/seo-tests/found.ts (words, and the word matching it shares with the bot tests)
- **Tier:** STRICT (AGENTS.md "Test depth"): it compares the live site to what the artist published and tells the manager what AI tools can't read.
- **Not here:** the rules shared by all ten tests (contract.test.ts); a bot's copy missing the artist's words (bots.test.ts).

**Tests**

- The exact words a manager reads when everything is on the page, with the counts in the details.
- Part of the bio is counted by sentence.
- A bio of short fragments ("DJ. NYC. Yes.") is still looked for, whole. (verify-found F28)
- A web address in the bio matches the page showing it without "https://". (verify-found F28)
- A missing release is named. The count is what the pages showed; the names are Tapir's, and are labelled so (types.ts rule 3).
- An upcoming show missing is named; a past show is never looked for.
- A show counts only when its venue is near its city or date (a venue name alone can be anywhere). A venue on the page without either is said as exactly that; a show with no venue is not looked for, and the details say so. (verify-found F27)
- One release is "is", not "are". (verify-found F28)
- Words only in the <title>, an attribute or a script are not on the page for a reader.
- A title under 3 letters or digits ("Up", "X", "22", "!!!") could match anything: it is left out, the details say so, and with nothing left the test does not apply. (verify-found F27) _(one per row of a table)_
- With nothing published we can't look (couldn't check); with nothing to look for, the test doesn't apply (types.ts rule 4), which is not the same.
- …but with every page of the site opened and read, missing is missing: a fail. (verify-found F26)
- No page read, or none opened at all: couldn't check.

### tests/unit/seo-tests/facts-are-true/apple-music.test.ts · 30 tests

Proves the "Your Apple Music link opens your home country's store" test compares the store in each of the artist's Apple Music links with the country they are based in (Tapir's Facts first), and that the store reader and the one-click fix behind it are exact.

- **Code:** src/lib/seo-tests/facts.ts (`apple`), src/lib/seo-tests/apple-storefront.ts (`appleStorefrontFix`, `appleStorefrontOf`, `countryCode`, `countryName`)
- **Tier:** STRICT (AGENTS.md "Test depth"): the links come from the live page (untrusted), and the fix writes a link that goes onto the live site.
- **Not here:** a home page cut at the read cap, or unreachable (../honesty.test.ts); applying the fix as a draft (tests/unit/manager-tools/seo/test-actions.test.ts).

**Tests**

- The one exact-wording check: the pass sentence names the store and says it is where you're based.
- A Norway-store link is right for a Norway-based artist, whether the card says NO, Norway, or a Country object.
- A link with no store in it (or a geo link) lets Apple pick each fan's store: nothing to get wrong.
- Another artist's Apple link on the page (a support act) is listed, not called "your" link. (verify-found AP4)
- A Norway-store link for a US artist fails softly, with the one-click fix to the US store shown as Tapir's link after the fix.
- A link that isn't in Tapir (the site hard-codes it) gets no one-click fix: Tapir can't change it.
- A US-store link for a Canadian artist fails without the fix (it only writes /us/), and the advice names the Canada store.
- Apple Music links shown as buttons are read too, not only the card's.
- Among several links, the wrong one is the one named.
- A pinned album or song link opens its store too: it is judged, not passed as "each fan's own store". (verify-found AP1)
- A right artist link does not hide a wrong release link beside it. (verify-found AP2)
- "/uk/" is not an Apple store (Apple sends it to /us/): it fails, and is never called "the United Kingdom store". (verify-found AP7)
- Country names that take "the" never read "the the", in a pass or a fail. (verify-found AP5)
- Neither Tapir nor the card says a country: "couldn't check", pointing to the Facts tab.
- CRITICAL: the country comes from the Facts published in Tapir first; a card from an older bridge states none, and the test still judges (with the fix).
- CRITICAL: Tapir's country wins over a card that says otherwise, and both are shown, each labelled with where it came from.
- With no country in Tapir, the card's is used and labelled as the site's, never as Tapir's.
- A country Tapir holds without a code is read by its English name; one no table knows ("Atlantis") is not used.
- CRITICAL: no Apple Music link on the site: no store to get wrong, so the test does not apply (`na`, not a pass), says why, and offers nothing to do.
- No Apple link found while a page could not be read is "couldn't check", not "doesn't apply": the unread page may have one. (verify-found AP3)
- A Norway-store artist link moves to the US store, the rest of the address kept.
- Links as people paste them (no name, a trailing slash, capitals, http) are fixed, and always come out https.
- The old store's language (?l=nb) is dropped; other settings are kept.
- A US link, a link with no store, and a geo link need no fix.
- Only ARTIST links on Apple's own host are fixed: never an album, a look-alike host, a path that mentions Apple, or a non-number id.
- Junk (empty, not a link, a script, no scheme, a store that isn't a country) is refused, never thrown on.
- The store of an artist link is read, and there is none for a link with no store, a geo link, or another site.
- A code or an English name, in any case, with common spellings ("USA", "UK", "Czech Republic", "México", "The Netherlands"), reads as the right code. (verify-found AP9)
- Anything else (a made-up place, an unused code, nothing) is no country.
- A country is named as a sentence needs it: "the United States", "Norway", and never "the Czechia". (verify-found AP8)

### tests/unit/seo-tests/facts-are-true/fact-card.test.ts · 13 tests

Proves the "Search engines can read your fact card" test passes only when every fact-card block on every page read parses, says it uses schema.org, is not empty, and each node has the fields its type needs, of the right kind.

- **Code:** src/lib/seo-tests/facts.ts (`card`), reading blocks with src/lib/seo-tests/html.ts (`parsePage`, `ldNodes`, `typesOf`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it validates untrusted JSON-LD from the live site; a broken card means search engines guess about the artist.
- **Not here:** whether the facts in the card are TRUE (profiles, shows, releases, genre, place each have their own file); an unreachable home page (../honesty.test.ts).

**Tests**

- The one exact-wording check: no errors, and the details list the types found on the home page.
- A card written as a top-level list of nodes (each with a context), or @graph as one object with an @vocab context, reads.
- A type we don't know ("MusicAlbun", a typo) is named in the details, since nobody reads it. (verify-found C2)
- A block that doesn't parse fails, and the details say which page and which block.
- An empty card (the bridge writes one for an artist with no name) or a blank block fails.
- A home page with no card, or a card with no artist in it, fails.
- A block with no schema.org context, or one whose context only MENTIONS schema.org, is not read as schema.org. (verify-found C3)
- Every page read is checked, not only the home page: a broken block on /about fails, naming /about.
- An album without byArtist, or an artist without url, is missing a required field, and the details name it.
- A show whose place has no address fails, and a song inside an album with no name is named by its position.
- Values of the wrong kind (a number for a name, "not a url" for a url, a US-style date) fail. (verify-found C1)
- A plain Event with nothing in it is missing what every event needs. (verify-found C2)
- The home page was cut at the read cap and its last block breaks at the cut: that is our limit, not the site's error, so "couldn't check".

### tests/unit/seo-tests/facts-are-true/profiles.test.ts · 13 tests

Proves the "Your fact card lists all your profiles" test passes only when the artist's own node lists exactly the identity profiles Tapir published: none missing, none extra, none twice, and no link that isn't a profile page.

- **Code:** src/lib/seo-tests/facts.ts (`profiles`), comparing links with src/lib/seo-tests/html.ts (`linkKey`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and compares it with what Tapir published.
- **Not here:** nothing published, a home page cut at the read cap, or unreachable (../honesty.test.ts); how two spellings of a link are matched (../page-reading/html.test.ts).

**Tests**

- The one exact-wording check: all 4 profiles listed (tracking and slashes ignored); the limits say we don't open each profile.
- CRITICAL: the bridge writes the Spotify profile from the artist id alone; it is Tapir's, never "not in Tapir".
- One profile written as a single string is read.
- Profiles written as {"@id": url} are read. (verify-found PR4)
- A profile Tapir has that the card is missing fails, and the details name it as Tapir's.
- A Spotify profile Tapir has only from the id, missing from the card, is named too.
- A profile on the card that Tapir doesn't have fails, and is named.
- A playlist is not a profile page: it doesn't say which account is the artist's.
- The same profile twice, however it is spelled (no www, a tracking query), fails.
- No profiles anywhere: a fail pointing to Connections.
- Links in Tapir, but none of them a profile (a playlist): the sentence says so, not "you haven't connected any". (verify-found PR3)
- A card with no artist in it, while Tapir has profiles, fails.
- Another band's profiles are not yours. (verify-found PR2)

### tests/unit/seo-tests/facts-are-true/releases.test.ts · 25 tests

Proves the "Your latest releases are listed" test passes only when every release published in Music is on the fact card, the card lists nothing Music lacks, and every release the card lists is shown on a page.

- **Code:** src/lib/seo-tests/facts.ts (`releases`), finding titles on pages with src/lib/seo-tests/match.ts (`titleShown`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD and page words from the live site and compares them with Music.
- **Not here:** nothing published, a home page cut at the read cap, or unreachable (../honesty.test.ts).

**Tests**

- The one exact-wording check: the pass sentence counts the releases and names the newest.
- Titles match whatever their case and spacing ("heatwaves  &  horizons").
- A curly apostrophe on the card matches a straight one in Music. (verify-found R4)
- A page that shows a release only as a cover picture's description (a cover grid) shows it.
- The title is quoted trimmed, with its spaces collapsed. (verify-found R6)
- With no dates, nothing is called "newest"; a release dated next year is never "your newest". (verify-found R3)
- The newest release missing from the card fails, naming it, pointing to Music.
- An older release missing fails too, and the details name it as Tapir's.
- A release on the card that Music doesn't have fails, and is named.
- Two releases in Music with the same title need two on the card.
- CRITICAL: a release the card lists that no page shows fails, naming it (skeen, 2026-09-29: "Home Again" on the card, not on the page).
- A short title ("Up") is found only as a whole word: not inside "Upcoming", but yes in "New single: Up.".
- A title is never found across word boundaries: "Summer Sun" is not in "Summers unlimited", "Summer" is not in "Dim sum merch". (verify-found R1b)
- "Release Number 1" is not shown by "Release Number 12". (verify-found R1c)
- A one-word title seen only as a menu word ("Home") can't be told from the menu: "couldn't check". (verify-found R1a)
- A title with no letters ("🔥🔥") can't be looked for: "couldn't check". (verify-found R1d)
- A listed release not on the pages read, while a page could not be read: it may be there, so "couldn't check".
- No releases in Music or on the card: a fail pointing to Music.
- CRITICAL: a visual artist with no releases anywhere: the test does not apply (`na`), and says why.
- A visual artist whose card lists a release Music doesn't have still fails: the look found something wrong.
- Sam, 2026-09-29 ("list what it sees"): each release the card lists is named, newest first whatever the card's order, one with no date last.
- A release the card lists twice (in another case, with spaces) is named once; "not in Music" still names the extra one.
- A card with no releases says "none", not "0 releases".
- Past 8 names the rest fold into "and N more", and it is the OLDEST that fold, so the latest stay in view.
- Long titles are shortened, so 8 names and "and N more" still fit once the run is stored (store.ts cuts each row at 600 bytes).

### tests/unit/seo-tests/facts-are-true/shows.test.ts · 14 tests

Proves the "Your show dates are up to date" test fails a past show listed as coming up or a date search engines can't read, and checks the upcoming shows on the fact card match Tour.

- **Code:** src/lib/seo-tests/facts.ts (`shows`), reading dates with src/lib/seo-tests/html.ts (`dayOf`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and compares it with Tour; a wrong date sends fans to the wrong night.
- **Not here:** nothing published, a home page cut at the read cap, or unreachable (../honesty.test.ts).

**Tests**

- The one exact-wording check: the upcoming show matches Tour and nothing old is listed.
- No shows on the card and none in Tour: nothing to get wrong, said as "none booked".
- A start with a time and zone matches Tour's date.
- A show with no city in Tour is not expected on the card (search engines need a place), but the details say it was left out.
- With no shows on the card and only a city-less show in Tour, the pass sentence still says Tour has one with no city. (verify-found SH4)
- A past show still listed as coming up fails, and the details name its date.
- A show today is upcoming, and one that started earlier but is still running (an end date) is not old.
- Tonight's 10pm show in Chicago is already "tomorrow" in UTC: it is not past. (verify-found SH1)
- A show two days ago is past: the one day of grace does not stretch. (verify-found SH1)
- A cancelled past show is not "listed as coming up".
- A date written another way, an impossible date, or none is never skipped silently: search engines can't read it. (verify-found SH2) _(one per row of a table)_
- An upcoming Tour show missing from the site fails, named as Tapir's.
- A show on the site that Tour no longer has as upcoming (marked past or cancelled) fails, and is named.
- A fact card that doesn't parse may hide shows, and a run that doesn't know today can't say past: both "couldn't check".

### tests/unit/seo-tests/honesty.test.ts · 9 tests

Proves the honesty rules hold across every test at once: a test that could not look says "couldn't check" (never a pass, a fail or "doesn't apply"), says why, and a detail that states what Tapir holds is labelled "in Tapir".

- **Code:** src/lib/seo-tests/who.ts, shared.ts, facts.ts (and found.ts for the "in Tapir" sweep)
- **Tier:** STRICT (AGENTS.md "Test depth"): these rules are what makes a result trustworthy (Sam, 2026-09-28: "These tests should be verified to accurately detect what they say").
- **Not here:** each test's own `na` case and its "couldn't check" twin, in the test's file: genre and musicbrainz (says-who-you-are/), photo-descriptions (looks-right-when-shared/), apple-music and releases (facts-are-true/).

**Tests**

- Each group's registry holds exactly its tests from defs.ts, so a sweep over the registries misses none, and a new test joins every sweep. _(one per row of a table)_
- Rule 1: with no home page (never visited, no answer, timed out, a 404 or a 503) every test is unknown, carries its own id, and all but MusicBrainz say why in their sentence. _(one per row of a table)_
- Rule 1: what wasn't found may be past the cut, so every test that reads the card or links is unknown and says the page was too big, never a pass or "doesn't apply". (verify-found H1) _(one per row of a table)_
- Even with Tour empty (nothing expected), a cut page is no proof that no old show is listed. (verify-found H1)
- The control: a card read whole before the cut is still judged, so the rule above isn't "unknown whenever truncated". (verify-found H1)
- The tests that compare the site with what Tapir published say "you haven't published", not that we failed to read the site. (verify-found H2) _(one per row of a table)_
- The scenario really puts Tapir-only values in front of the tests, in at least 8 tests: otherwise the two checks below would pass on nothing.
- CRITICAL, rule 3: every row quoting a value only Tapir holds is labelled "in Tapir: …", in all 24 tests, so Tapir's data is never passed off as the site's.
- CRITICAL, rule 3: no row labelled "in Tapir" quotes a value only the site holds.

### tests/unit/seo-tests/how-crawlers-see-your-site/crawl.test.ts · 23 tests

What the AI test's "How crawlers see your site" section is built from: robots.txt, the sitemap, each page's tags, and every crawler's visit, read by the engine's own rules.

- **Code:** src/lib/seo-tests/crawl.ts (buildCrawl)
- **Tier:** STRICT (AGENTS.md "Test depth"): this is stored with the run and shown to the manager as what their site told each crawler, so it must say what the engine saw, read by the engine's own rules (a second reading could disagree with the 24 tests).
- **Not here:** how the evidence is gathered (can-be-found/evidence.test.ts); what the 24 tests conclude (the other folders); asking Google / Bing and the other spelling (runs/ running.test.ts); storing and rendering the section (store / page tests).

**Tests**

- Every crawler the tests know, in SEO_BOTS order, named as a person and as robots.txt knows it; token-only names (Google-Extended, Applebot-Extended) marked as never visiting.
- The sitemap as read: its address, answer, that robots.txt names it, and each page with the status a person got; three pages on one date are "the same date".
- One row per page the run opened: each visitor was told the page is its own main address, nothing says noindex, and every VISITING crawler got a 200. Token-only names have no visits.
- The other spelling and the listing are the run's to find out; the builder keeps them as given.
- A file that names one crawler: that crawler is blocked by its OWN group, spelled the way robots.txt knows it; everyone else falls to "*".
- Apple's rule: with no Applebot group, Applebot follows Googlebot's. The group shown is Googlebot's, so the manager sees WHY Apple is blocked.
- A group with no rule for "/" (only /private is closed): allowed, the group named, no rule.
- No file (404): every crawler may go anywhere (RFC 9309). No text, no group, no rule.
- A server error (5xx): crawlers must assume they are shut out of the whole site (RFC 9309).
- No answer at all: we can't say, for anyone.
- The file is quoted up to 2,000 characters; longer is cut and says so. A character made of two UTF-16 units is never split in half at the cut.
- "Same dates" only when there is more than one page and every one carries the same date.
- The total is every page the list names, not the pages we kept; the list is shown only as its first 50, in the list's order.
- Each listed page carries the status a person got WHEN the run opened it, matched the `list` test's way (a trailing slash is the same page); a page we didn't open has none.
- An address on another site is never "one of your pages".
- No sitemap read at all: nothing listed, nothing claimed.
- Each visitor's own copy is read: a relative canonical is made absolute against where the page answered, Google can be handed a different one, and a copy with none says none.
- A `<base href>` moves where a relative canonical points; a Link header canonical counts too.
- A page we couldn't read (an error, no answer) has no canonical to show, never a guess.
- Every VISITING crawler's answer on each page, by its key; a crawler we have no visit for is null (no answer), never left out and never a guess.
- Everything here came from the artist's site: it is kept as the exact text, never parsed, escaped or dropped here (the page renders it as text).
- Missing or junk evidence is empty answers, never a throw (the run must still be stored).
- A page row per opened path, even when a visit is missing: the fact is "no answer".

### tests/unit/seo-tests/looks-right-when-shared/link-preview.test.ts · 10 tests

Proves the "Your link preview says who you are" test passes only when a shared link of the home page carries a title with the artist's name, a real summary, the site's own address and a card size X knows.

- **Code:** src/lib/seo-tests/shared.ts (`preview`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and tells the artist a claim about it.
- **Not here:** the preview picture (preview-picture.test.ts); the page title (../says-who-you-are/title.test.ts); an unreachable home page (../honesty.test.ts).

**Tests**

- The one exact-wording check: the pass sentence claims only what was checked (no "one line" promise). (verify-found PV3)
- The site's own home address, however it is spelled (www or not, a trailing slash, relative), is the right address.
- "&amp;" in the summary is shown as "&".
- No shared title, one without the name, or only the name (as the title test judges it) fails. (verify-found PV4)
- No shared summary, or one that is only the name, fails.
- X's own title and summary are what X shows, so they are judged too. (verify-found PV1)
- The address must be the home page on this site: missing, another site (named in the sentence) or another page fails.
- Two problems are both named in one sentence, and it is a hard fail.
- No X card: X shows the preview small. A soft fail.
- An X card kind that doesn't exist is ignored by X, so it fails like none. (verify-found PV2)

### tests/unit/seo-tests/looks-right-when-shared/photo-descriptions.test.ts · 18 tests

Proves the "Every photo has a description" test counts each real photo on the pages read once, passes only when every one has a real description, and says "doesn't apply" or "couldn't check" instead of passing when it saw no photos.

- **Code:** src/lib/seo-tests/shared.ts (`alt`), with src/lib/seo-tests/match.ts (`describes`: is this text a real description)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and tells the artist which photos to fix.
- **Not here:** an unreachable home page (../honesty.test.ts).

**Tests**

- The one exact-wording check: the pass sentence counts the photos and the pages read, and the limits say it only looked at those pages. (verify-found A5)
- Short real descriptions count, in any script. (verify-found A2)
- "&amp;" in a description is still a description.
- The same picture on two pages is one photo.
- A page that isn't there (404) is another test's problem, not a missing description.
- One undescribed photo fails, and the details name it, pointing to where photos are described.
- An empty or blank description on a photo not marked as decoration is missing.
- File names, numbered placeholders, "image", "logo" and leftovers like "undefined" fill the field without describing anything. (verify-found A2) _(one per row of a table)_
- The same picture twice: if one copy has no description, the picture is not described. (verify-found A3)
- Pictures with no src (srcset only, lazy loaders, none at all) are each their own photo, never merged into one. (verify-found A1)
- One undescribed photo is enough to fail, even when another page couldn't be read.
- Pictures marked as decoration (aria-hidden, role presentation or none, hidden) and 1 × 1 pixels need no description.
- Pictures inside noscript, template or svg are copies or not shown.
- Small icons (both sides 48 px or less) are not photos. (verify-found A4)
- CRITICAL: no photos on the pages and none published in Tapir: nothing to describe, so the test does not apply (`na`, not a pass), and says why.
- CRITICAL: no photos on the pages while Tapir has published some: a script may add them where we can't see, so "couldn't check".
- A page that couldn't be read, while every photo we saw is described: "couldn't check", not a pass.
- A page cut at the read cap may hide an undescribed photo past the cut: "couldn't check".

### tests/unit/seo-tests/looks-right-when-shared/preview-picture.test.ts · 37 tests

Proves the "Your preview picture looks right" test opens the picture a shared link shows and judges the real file: it loads, it is a picture, it is wide and big enough, and not too heavy. Also proves how that picture is found, fetched safely and measured.

- **Code:** src/lib/seo-tests/shared.ts (`share`), src/lib/seo-tests/share-image.ts (`fetchShareImage`, `readImageHeader`)
- **Tier:** STRICT (AGENTS.md "Test depth"): the address comes from the live page (untrusted), so fetching it is a security edge, and the size readers are parsers of raw bytes.
- **Not here:** the safe fetch's own redirect, address and size rules (tests/unit/safe-fetching/); an unreachable home page (../honesty.test.ts).

**Tests**

- The one exact-wording check: the pass sentence gives the size and claims nothing it can't see (no "sharp"), and the details say size, format and weight.
- X's 2:1 shape is fine too.
- Sam, 2026-09-29: it is the "preview picture" in every word a manager reads, never the "share picture".
- A different picture named just for X is listed in the details, and the limits say we don't open it. (verify-found S2)
- No picture named: a fail, pointing to where it is set.
- The page names a picture the run didn't open: "couldn't check", not a fail.
- A timeout or no connection is about our visit, not the picture: "couldn't check".
- An http address, a redirect to http, a private address or a broken address: no sharing app can load it, so it fails. _(one per row of a table)_
- Gone (404, 410) is a broken link and says the error; turned away (401, 403) or busy (429, 5xx) is about our visit, so "couldn't check". (verify-found S1)
- The bytes decide: an html page fails, a "PNG" whose bytes aren't one fails, and a real picture labelled as something else fails softly as a wrong label. (verify-found S5)
- Sharing apps don't show svg pictures.
- A format we can't measure yet (avif) is "couldn't check", not a fail.
- A file that stops short of its stated length, or a JPEG whose size can't be read, is damaged.
- X won't show a picture over 5 MB; just under passes.
- "over 40 MB" is said only when the real size is unknown: a stated size is given as it is. (verify-found S3)
- A 1 × 1 tracking pixel is not a preview picture: a hard fail.
- Smaller than 1200 × 630 looks blurry: a soft fail that says the size to aim for.
- A square picture gets cropped to a wide shape: a soft fail.
- Each format keeps its size in a different place: every one we measure is read right.
- A file cut off before its size keeps its format but no size, so the test can call it damaged, not guess.
- Once the picture data starts, no size is read from it: those bytes can look like a size by chance.
- A JPEG table segment (C4) sits in the size markers' range but is not one: it is skipped.
- svg, avif and heic are named (so the test can say why), and an html page or empty file is no format.
- No page, or no picture named: nothing is fetched.
- The picture is fetched with Tapir's own User-Agent, redirects handled by hand, and its real size, type and weight reported.
- A relative or //host address is resolved against the site, and "&amp;" in it is decoded.
- A page that names its picture only as og:image:secure_url is still read.
- An http, private (cloud metadata, 10.x) or script address is refused before any fetch: the page is untrusted.
- A redirect to a private address or to http is refused before that hop is fetched.
- A safe redirect is followed, and the address that answered is the one reported.
- An html page served at the picture's address is reported with no format, so the test can say "not a picture".
- The bytes decide the format: a JPEG labelled image/png is a JPEG, with its real size.
- A broken link keeps its status (404), so the test can say it.
- A file shorter than its stated length is marked broken, and its stated size is kept.
- A huge file is read only up to the 5 MB cap and marked too big; its size is still read from the start.
- A thrown fetch or a timeout becomes "no answer" with a reason, never a crash of the run.
- A run that has already given up (aborted) fetches nothing.

### tests/unit/seo-tests/page-reading/html.test.ts · 19 tests

Proves the page readers every "Says who you are", "Looks right when shared" and "Facts are true" test stands on read a live page the way a browser and a search engine do, and never throw or hang on broken html.

- **Code:** src/lib/seo-tests/html.ts (`parsePage`, `parseAttrs`, `decodeEntities`, `metaOf`, `ldNodes`, `typesOf`, `artistNodeOf`, `namesArtist`, `isBareName`, `linkKey`, `dayOf`, `pageState`)
- **Tier:** STRICT (AGENTS.md "Test depth"): a parser of untrusted html. Each rule here was broken by hand once to see its test go red (report, 2026-09-29).
- **Not here:** the match.ts readers are tested through the tests that use them: `wordCount`, `sentencesOf`, `namesPhrase` (../says-who-you-are/bio.test.ts), `titleShown`, `distinctiveTitle` (../facts-are-true/releases.test.ts), `describes` (../looks-right-when-shared/photo-descriptions.test.ts), `ownArtistNode` (../says-who-you-are/genre.test.ts); worst-case speed and the recorded broken pages (tests/unit/safe-fetching/slow-parsers.test.ts).

**Tests**

- Named, decimal and hex entities decode; unknown, out-of-range and zero ones are left as written, never guessed.
- Attributes in double, single or no quotes are read, a ">" inside quotes doesn't end the tag, and the FIRST of a repeated one wins, as in a browser.
- Attribute names are read in any case, and values are decoded.
- One page gives its title (not an svg's, whitespace collapsed), meta tags by name or property in any case, the canonical link, links and pictures.
- Tags inside comments, scripts, styles, templates and noscript are never read: a browser doesn't show them.
- Fact-card blocks are found by their type in any case, with a charset too; each is parsed, or carries why it can't be; other scripts are skipped.
- The visible words are the body's text only, entities decoded, spaces collapsed, svg text left out.
- An unclosed svg hides the rest of the page, as in a browser, and nested svgs close in order.
- Junk never throws, and a page of 200,000 quotes, 50,000 scripts and 50,000 open comments is read in under 3 seconds.
- Every shape a card can take is read: @graph as a list or one node, a list, one node, a node beside a graph; anything else is no nodes.
- A type is read without its schema.org prefix, from a list too, skipping non-text.
- The artist's node is the one with the #artist id, else the one with the artist's name, else the first; never a node nested in a show.
- Pieces of the artist's node split across blocks (same id) are merged into one.
- The name is found as a whole word in any case and with accents or dots, never inside a longer word, and an empty name matches nothing.
- The name alone or with filler ("Official Website", "Home") is bare; one more real word ("Chicago", "DJ") is not.
- www, http or https, a trailing slash and share-tracking settings (igsh, utm_, si) don't make a different link.
- A real setting (?id=1) and the path's case do make a different link; gclid is kept, since the bridge keeps it (the same list on both sides); mailto and junk are no link. (verify-found PR5)
- A date or a date with a time gives its day; an impossible date (Feb 30), words or a number give none.
- A page that can't be read says why in plain words (not visited, timed out, an error, not a web page), and one cut at the cap is read but marked.

### tests/unit/seo-tests/runs/after-publish.test.ts · 31 tests

After a publish, Tapir waits until the live site shows it, then tests the site once in the background; a burst of publishes collapses to one run, and nothing here can fail the publish.

- **Code:** src/lib/seo-tests/after-publish.ts (testAfterPublish, scheduleSeoTestRun), src/lib/seo-tests/fresh.ts (siteFreshness, sitemapLastmods, sameSite, waitForFreshSite)
- **Tier:** STRICT (AGENTS.md "Test depth"): it runs on Publish, and a wrong "fresh" would store an old site's verdict as today's truth.
- **Not here:** which publishes schedule a run (runs/publish-hook.test.ts); the run itself (runs/running.test.ts); the stale-site verdict of a manual run (runs/running.test.ts).

**Tests**

- Fresh: the sitemap's stamp is this publish, even though Postgres keeps µs and a site writes ms or whole seconds.
- Stale: the stamp is an older publish we made, so the site hasn't updated yet.
- Not ours: a request-time stamp or a show's midnight names no publish, so "couldn't tell", never fresh.
- Nothing to judge by (no sitemap, dates without times, nothing published): null.
- One stamp naming the publish is enough: a stray old page date doesn't make the site look stale.
- A restyle moves no sitemap date on a 0.45 site, so its homepage still names CONTENT: that is fresh.
- A 0.44 site stamps published_at: any publish at or after the content change has all the content.
- One reading: the sitemap a 0.45 site builds and the marker come from the same bridge function.
- On tour: a show that passed after the last content change dates the HOMEPAGE, but /about (the bio, no shows) still names that change. Any stamp naming it proves fresh; the homepage's midnight, which a stale site shows too, proves nothing either way.
- Reading lastmods: from a page list, never from a sitemap index (those dates aren't pages).
- Staying on the site: a redirect may go to the www twin, never elsewhere and never down to http.
- Stop when told: a newer publish supersedes this hook mid-wait, so it must stop polling.
- Stop on abort: before the first poll, and during a pause between polls.
- After a Brand-only publish a 0.45 site keeps naming the last content change: fresh at once, no 90 s wait.
- Early return: test as soon as the site shows the publish, poking "/" each time to wake a cached site.
- The cap: give up in time and report stale, so the run can say the site hadn't updated.
- No marker: wait a fixed time, then say we couldn't confirm (null), never "fresh".
- Nothing published: nothing to wait for, and no request is made.
- A broken site never throws out of the wait (it runs in the background after Publish).
- No site: nothing to wait for or test, and no run of 24 unknowns is stored.
- The order: pause, wait for the site, then claim a publish run in this manager's name, as the service role.
- A burst: a newer publish after the pause means this hook stops; the newer one will test.
- A newer publish during the wait also stops this hook before it claims.
- Coalesced: this publish is already covered, so stop at once, no retry.
- Retries: busy, cool-down and the limit are retried on the database's own seconds (capped at 15 s).
- Giving up: after the retry window, quietly (the publish already succeeded).
- A stale site is recorded on the run (site_fresh false + a plain note), never dropped.
- No marker: recorded as "couldn't confirm" (null), never as fresh.
- A failed read is an outcome, never a throw out of the background job.
- `after` refusing (outside a request) must not throw into the publish.
- The background job resolves even when everything under it fails.

### tests/unit/seo-tests/runs/overview-data.test.ts · 13 tests

The SEO / GEO Overview's data: failing tests most important first, a timeline of real publishes and runs only, and visit counts that are null (never 0) when they can't be read.

- **Code:** src/lib/seo-tests/overview.ts (SEO_TEST_PRIORITY, failingInPriority, runChanges, buildTimeline, searchAndAiVisits, readSeoOverview)
- **Tier:** STRICT (AGENTS.md "Test depth"): it decides what the manager is told needs them, and a 0 shown for a number we couldn't read would be untrue.
- **Not here:** a page that draws this: the Overview tab that did was removed 2026-09-29; the module is kept for the stashed "AI visibility" page (TODO.md).

**Tests**

- One rank per test (derived), so a new test can't be missing from the to-do order.
- The order: what needs the manager first, most important first; passes are not to-dos.
- `na` is not failing: a test that doesn't apply is never a to-do.
- Changes: each run is compared with the one before it, most important first.
- The timeline: real publishes and runs only, inside the window, newest first; the first run has nothing to compare (null).
- Site down: no to-dos that blame the site's settings; only a test that never reads the site stays.
- Site down in the timeline: said once, not as 20 tests "now unknown"; the next run compares with the last one that reached it.
- Visits: the same buckets as the Analytics page, so the two pages agree.
- Unreadable analytics: null (shown as "—"), never 0; readable and empty is a real 0.
- Unreadable publish history: no timeline at all, since half of one would hide publishes.
- Unreadable runs: not "never tested"; nothing is listed as failing.
- The window: the last 30 UTC days, today included, as the Analytics page counts them.
- The main path: the latest run's failing tests in priority order, with its trigger and the last publish.

### tests/unit/seo-tests/runs/publish-hook.test.ts · 4 tests

Every publish that changes a page's words schedules ONE SEO / GEO test run in the background, and ONE sitemap resend to Google; neither can fail or slow the publish.

- **Code:** src/app/artists/[id]/(dashboard)/actions.ts (publishGated's hooks, beside the IndexNow ping)
- **Tier:** STRICT (AGENTS.md "Test depth"): it sits on Publish, the one path whose failure loses a manager's work.
- **Not here:** what the scheduled run then does (runs/after-publish.test.ts); what the resend does (tests/unit/search-engines/resubmit.test.ts); the publish itself (tests/unit/publish/).

**Tests**

- Each publish path: exactly one run, for this artist, in the checked manager's name (the per-person limits count it). _(one per row of a table)_
- Brand: colours, fonts and logos change no page's words, so there is nothing new to test.
- Nothing went live: a wrong password or a failed publish starts no run.
- The publish is already live: a scheduler crash must not turn it into a reported failure.

### tests/unit/seo-tests/runs/running.test.ts · 43 tests

Running the SEO / GEO tests: all 24 run in order, one broken test never sinks the run, the run keeps to its time budget, and the database decides whether a run may start at all.

- **Code:** src/lib/seo-tests/run.ts (runSeoTests, runAllTests)
- **Tier:** STRICT (AGENTS.md "Test depth"): this decides what is STORED as the verdict on the artist's site, so what the manager is later told is true.
- **Not here:** what each test decides (tests/unit/seo-tests/<test>.test.ts); how a run is stored and read back (runs/storage.test.ts); the wait after a publish (runs/after-publish.test.ts); the database rules themselves (tests/integration/seo-tests/seo-test-runs.test.ts); how the crawl is built from evidence (how-crawlers-see-your-site/crawl.test.ts); the Google and Bing calls themselves (tests/unit/search-engines/).

**Tests**

- Order: the page and the history dots read results by position, so a shuffled engine must not shuffle them.
- A missing test: a run must always hold 24 results, or the page would count a gap as nothing.
- A crashing test: one bug in one test must not throw away the other 23 verdicts.
- Junk answers: a malformed, async or mislabelled answer is "couldn't check", never stored as a verdict.
- The budget: a hung site must not hold the run (and the manager's "Testing…") open forever.
- A slow share picture: only the share test is unknown, and "no answer" is never read as "no picture named".
- A MusicBrainz outage: only the MusicBrainz test is unknown; the evidence says it didn't look.
- A refusal (cool-down, or a run already going): nothing is read or fetched, nothing is finished, and the seconds come back. _(one per row of a table)_
- Who writes: only the service role may write runs, so the manager's own session must write nothing.
- No site: say "no site" 24 times in storage (the page says it once) and fetch nothing.
- Fresh: the sitemap names the latest publish, so the run is stored as a test of the new site.
- Stale: the site still shows an older publish, so the run must say its verdict is about the old site.
- A Brand-only publish moves no date on a 0.45 site: naming the last CONTENT change is fresh, not stale.
- Couldn't tell: no timed sitemap date is null, never "fresh"; the publish hook's own look can fill it in.
- Reach: whether the site answered at all is stored, so the page can say "we couldn't reach your site" once.
- No site, no reach: "not connected" must not be stored as "your site didn't answer".
- Timeout vs our bug: a hung site is "no-answer"; our own gatherer breaking says nothing about the site.
- A failed read after the claim: the run is marked failed (not left "running") and the raw error stays hidden.
- A finish that saved nothing: never tell the manager the results were saved.
- A refused finish: the run is marked failed so the artist isn't stuck as "busy" for 5 minutes.
- `na` kept: "doesn't apply" is a real answer, not a broken test.
- `na` needs no look: a MusicBrainz outage must not turn "doesn't apply" into "couldn't check".
- The section is built from the SAME evidence the 24 tests read, plus what only the run can find out (the other spelling, the listing), and handed to finishRun with the results.
- No site: nothing was seen, so there is no crawl, and nobody is asked anything.
- A gather that broke or timed out saw nothing: no crawl, and Google / Bing are not asked.
- Only a REGISTERED provider can be asked (the robot owns only those properties), and at the address it was registered with, never the connected site's spelling.
- Nothing registered: no provider is asked, and the clients (which read the server's keys) are never even built.
- At most 5 pages, in the order the run opened them.
- Tests load .env.local, so the real clients must refuse under vitest: a test that forgot to inject its own could otherwise call the real Google and Bing with the real keys.
- A provider that fails leaves THOSE pages as nulls ("couldn't ask"), never a made-up answer, and never sinks the run: a refusal, a throw, a missing key, clients that can't be built.
- Google hanging must not hold the run open: the listing lives inside the run's budget.
- Pages are asked about where the site ANSWERED. Registered as the bare spelling while the site lives on www, Google would call every page "Page with redirect" ("0 of 5 on Google"): such a registration is not asked at all, and its rows say "couldn't ask", never "not listed".
- The deadline ENDS the work, not just the wait: a hung Google / Bing request is aborted (its socket freed) when the run's time is up, and a registration read that never answers can't hold the run open either.
- The registrations live in a table closed to managers: they are read through the WRITER (service role), never the manager's session, and only a VERIFIED row counts.
- A row that isn't a registration we can use (another provider, an address that isn't a registered https property) is never asked about.
- Checked ONCE per run, for the origin the gather actually landed on.
- A check that breaks or hangs is "not checked" (null), and nothing else about the run changes.
- www → asks the bare spelling ONCE, as a person's browser, follows it home, and records where it landed.
- A bare site: its www spelling. One that answers itself (no redirect) says so: `to` is itself.
- Only www.<name> ↔ <name>: a sub-domain, a name we can't tell is the bare domain, an address or a port has no clear "other spelling", and nothing is fetched. _(one per row of a table)_
- www.<name> is always clear, whatever <name> is.
- A spelling that sends visitors to ANOTHER site is not followed; where it pointed is kept.
- No answer: no status, nowhere; asked once, never retried. Sent home, and home didn't answer: where it was sent is still a fact.

### tests/unit/seo-tests/runs/storage.test.ts · 32 tests

Storing and reading SEO / GEO test runs: the database's refusals come back in plain words, results are capped before they are stored, and reading back never passes junk to the page.

- **Code:** src/lib/seo-tests/store.ts (claimRun, finishRun, failRun, capResult(s), capCrawl, crawlOf, latestRun, historyFor, recentRuns, currentRun, seoScore)
- **Tier:** STRICT (AGENTS.md "Test depth"): stored data the live page reads back, and a stored `outside` link the page renders (a javascript: link would be stored XSS).
- **Not here:** the database's own rules (cool-down, busy, limits, retention, immutability, the crawl's 64 KB check): the migrations, pinned in tests/integration/seo-tests/seo-test-runs.test.ts; running the tests (runs/running.test.ts); building the crawl (run.ts).

**Tests**

- The claim: one call to the service-role function, carrying who and which publish; never a table write.
- Refusals: each is its own reason and seconds, so the page never has to read the sentence to know which.
- The unexpected: a surprise answer, an error or a throw is a plain error, and never leaks an internal address.
- The finish: one call; `false` (no running run matched) must not be reported as saved.
- Reach: stored only in its known shape; junk becomes null rather than a guess the page would believe.
- failRun: marks the run failed through the same function and never throws (it runs inside error handling).
- A NUL anywhere in a result would make Postgres refuse the whole finish (22P05): it becomes U+FFFD.
- Outside links: only https survives storage, since the page renders it as a link.
- Caps: every string and the evidence list are capped, and the verdict itself is never touched.
- The table's size check: 24 worst-case results must fit, or the database refuses the whole run.
- Bytes, not characters: CJK, emoji and escaped characters take more room than they look.
- Half an emoji: a lone surrogate makes the database refuse the run, so a cut must never leave one.
- History: oldest first per test, every test present, and a status the page doesn't know is dropped.
- A failed read throws, so the page says "couldn't read" rather than "never tested".
- Before the crawl column exists (the migration not pushed yet), the page must keep working: the read tries again without it. Any other failure still throws.
- Shape: a stored result the page can't draw (a missing field, an unknown test, not an object) is dropped, never shown; `na` is kept.
- Reach read back: as stored, or null for older runs, no site, or junk.
- Abandoned runs: a run "running" for over 5 minutes is dead, so the page must not wait on it.
- The score: passes over every status but `na`, the same rule the migration uses.
- Every status is kept (derived from SEO_TEST_STATUSES), so a new status can't silently vanish from the history.
- The witness every "null" below is measured against: the fixture IS a whole crawl, and a crawl that fits is stored exactly as the run made it.
- The crawl reaches the database: one finish call carrying it as `p_crawl`, capped, with a field the page does not know dropped rather than stored.
- No crawl, no argument: a database from before the crawl migration has no `p_crawl`, and a finish that named it would be refused there (PGRST202).
- The crawl is extra, never the run: when the finish WITH one fails, the run is finished again without it, so its 24 results are kept. Without a crawl there is nothing to drop: no retry.
- Sent again ONLY when the database REFUSED the call (nothing was written). A lost answer (a dropped connection, a timeout) may have finished the run with its crawl: a second call would find it no longer running, and the artist would be told the results weren't saved.
- Not a crawl at all: never stored, never shown.
- Step 1 of the size cap: the robots.txt text goes first (marked truncated: read, not kept), and when that is enough nothing else is cut.
- Step 2: then sitemap pages, from the END, keeping as many as fit (one more would not: short pages, so a cut of even ~70 bytes too many shows); the opened pages are untouched and `total` still says how many the list named. (run.ts keeps 50; the cap does not count on it.)
- Step 3: then opened pages, from the end ("/" is first, so it goes last); every crawler's robots verdict is kept whatever else goes.
- Too big even then (the verdicts alone): null, never an oversized crawl the table would refuse.
- Postgres refuses a NUL or half an emoji inside jsonb, which would sink the whole finish (the results with it): each is replaced before it is sent; a whole emoji is kept.
- The page reads the crawl back only whole: as stored, or null for a run from before crawls and for junk. The full-run read asks for it; the history read (many rows) never does.

### tests/unit/seo-tests/runs/what-tapir-knows.test.ts · 15 tests

What Tapir knows about the artist, for the SEO / GEO tests: read from the PUBLISHED site (never the draft), and a site address the server is allowed to fetch.

- **Code:** src/lib/seo-tests/known.ts (readKnown, seoSiteOrigin, publishedFromPayload)
- **Tier:** STRICT (AGENTS.md "Test depth"): comparing the live site to the DRAFT would fail a site that is exactly right, and `siteUrl` is an address the server FETCHES (SSRF).
- **Not here:** fetching the site safely (tests/unit/safe-fetching/); what each SEO test does with these facts (tests/unit/seo-tests/).

**Tests**

- Published only: the draft is never read, so a site that matches what was published passes.
- Never published: there is nothing to compare, and that is said as null, not as empty facts.
- A failed read throws: the run must not compare the site against nothing.
- Unsafe or missing addresses are "no site": the server must never fetch a private or made-up address.
- Development too: the redirect guard lets localhost through there, so this guard must not.
- A public site: just its origin, so every test starts from the home page.
- A template site: no address to test, but the published facts are still read.
- Links: the site's buttons first (on site), then identity links not already shown (off site).
- Photos: only the profile and gallery images count, with the manager's own alt text.
- Tour, title, releases: the manager's past-show flag, the title override, and the published date.
- The stale-site check's line: the last CONTENT change, as the bridge reads it (a restyle is not one).
- Region and country: the same spelling and code the fact card states, or the place test would disagree with the site.
- An unknown country is kept as typed with no code; nothing set is null.
- Artist type: only a published Person is a visual artist, the bridge's own rule.
- Spotify id: kept exactly when the fact card would carry it, so the profiles test checks the same link.

### tests/unit/seo-tests/says-who-you-are/bio.test.ts · 22 tests

Proves the "Your bio names your genre, city and a highlight" test finds the bio as words on the pages read, and passes only when it has 100 words or more and names the genre, the city and a release or show that Tapir published.

- **Code:** src/lib/seo-tests/who.ts (`bio`), with src/lib/seo-tests/match.ts (word counts, sentences, whole-word matching)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and tells the artist what their bio is missing.
- **Not here:** nothing published, or no page answered (../honesty.test.ts).

**Tests**

- The healthy bio: shown on /about, names House, Chicago and a release; the 100-word floor is said to be Tapir's own.
- Sam, 2026-09-29: the test checks key facts, not length ("a bio of 2500 seems huge"): the old 2,500 goal must never come back.
- Facts match as whole words in any case and typography: "warehouse" is not "house", "Chicagoland" is not "Chicago", CAPITALS and curly quotes still match.
- Curly quotes, an em dash, a soft hyphen and a zero-width space on the page still match the plain bio in Tapir. (verify-found B1)
- A fact Tapir doesn't have (no genre, no city) is skipped and said, never held against the bio.
- The one exact-wording check (the Skeen bio as it was): short AND missing two facts, all said in one sentence.
- Under 100 words fails even with every fact, pointing to the bio editor.
- A long bio with no genre fails, and suggests the genre Tapir has.
- A long bio with no city fails, and suggests the city Tapir has.
- A long bio with no release or show fails, and suggests one of the artist's own.
- A show's venue, or a show's city other than home, is a highlight; the home city is already the city fact.
- A release called "Home" or "XO" would match ordinary words: not counted, and with only such titles the highlight is "not checked".
- Facts count only in the part of the bio the page shows: the full bio in Tapir names Chicago, the page leaves that sentence out.
- A bio only in the fact card, on no page, fails: people and AI tools read the page.
- A short common sentence that happens to be on the page is not proof the bio is shown.
- A bio not found says it looked only at the pages it read, and the limits say how many: never "your site has no bio". (verify-found B3)
- One sentence pasted 45 times counts once: a padded bio can't reach 100 words by repeating itself. (verify-found B5)
- A page with the bio that could not be read, and no other page showing it: "couldn't check", never a fail.
- No bio anywhere: said about Tapir ("you haven't written a bio in Tapir"), not about the site. (verify-found B6)
- With no bio, the fact card falls back to the description: that is not a bio.
- Chinese has no spaces between words: they are still counted, not read as one word.
- Half a Chinese bio shown on the page counts that half: sentences split on "。". (verify-found B4)

### tests/unit/seo-tests/says-who-you-are/description.test.ts · 9 tests

Proves the "Your description is about you and a good length" test passes a 50 to 160 character description that mentions the artist, and fails a missing, filler, off-topic, too-short or too-long one.

- **Code:** src/lib/seo-tests/who.ts (`desc`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and tells the artist a claim about it.
- **Not here:** an unreachable or cut-short home page (../honesty.test.ts); the shared summary (../looks-right-when-shared/link-preview.test.ts).

**Tests**

- The one exact-wording check: the pass sentence gives the length and says it mentions you.
- 50 and 160 are inside the range, 49 and 161 are not: the edges are where a rule slips.
- Naming your city and sound is about you even without your name. (verify-found D1)
- "&amp;" counts as one character: the length is what a reader sees.
- No description: Google picks words from the page instead. Points to the Listing tab.
- "Skeen — official site" is the bridge's fallback when nothing was written: only the name, a hard fail (not "Almost" for being short).
- Placeholder text, one word repeated, or someone else's description: none of them is about you. (verify-found D1) _(one per row of a table)_
- Under 50 characters says little: "Almost".
- Over 160 characters gets cut off by Google: "Almost".

### tests/unit/seo-tests/says-who-you-are/genre.test.ts · 16 tests

Proves the "Your genre is named" test reads the genre from the artist's OWN node in the fact card, passes only when it is a real style matching Tapir's, and doesn't apply to a visual artist.

- **Code:** src/lib/seo-tests/who.ts (`genre`), finding the artist's node with src/lib/seo-tests/match.ts (`ownArtistNode`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and compares it with what Tapir published.
- **Not here:** an unreachable home page, or a card cut at the read cap (../honesty.test.ts).

**Tests**

- The one exact-wording check: the pass sentence names the styles found.
- One genre written as a single string is still a genre.
- A card can be written three ways (a list of nodes, one node, or @graph): each is read.
- The artist can be in the second of several blocks.
- A card under another name that carries the artist's own site address is the artist's. (verify-found G1)
- No genre while Tapir has one: the advice is "publish", pointing to the Facts tab.
- No genre and none in Tapir: the advice is "add it".
- The details name the sound Tapir has, labelled as Tapir's, when the card has none.
- No fact card, or one that doesn't parse, names no genre.
- The card's sound must be Tapir's: "Country" on the card when Tapir says House fails, quoting Tapir's. (verify-found G2)
- Placeholders and links fill the field without naming a sound. Tapir has no genre here, so nothing but this rule can fail them. (verify-found G3) _(one per row of a table)_
- A support act nested in a show is not the artist: its "Rock" must not stand in for the artist's missing genre.
- A card about another band is not yours, and the sentence names whose it is. (verify-found G1)
- CRITICAL: a visual artist has no music style, so the test does not apply (`na`), whatever the card says, and even when no page could be read.
- A card that calls a musician a person has no place for a style: the card is wrong, and the details show both sides.
- A Person card with nothing published: we can't tell which kind of artist this is, so "couldn't check", with limits saying why.

### tests/unit/seo-tests/says-who-you-are/musicbrainz.test.ts · 28 tests

Proves the "MusicBrainz knows you" test passes only for a MusicBrainz page under the artist's own name, and that the lookup behind it asks MusicBrainz politely, reads its answers carefully, and says "couldn't check" (never "doesn't know you") when it couldn't ask.

- **Code:** src/lib/seo-tests/who.ts (`mb`), src/lib/seo-tests/musicbrainz.ts (`lookupMusicBrainz`, `musicBrainzForms`)
- **Tier:** STRICT (AGENTS.md "Test depth"): it calls an outside service with addresses taken from the artist's data and parses the answer; a wrong answer is advice to create a page on another site.
- **Not here:** the create-page link builder (tests/unit/manager-tools/connections/musicbrainz-seed.test.ts); a hostile profile link timed (tests/unit/safe-fetching/slow-parsers.test.ts).

**Tests**

- The one exact-wording check: a page under your name passes, and the details show the page and which address found it.
- An answer that came from the manager's own Connections link is labelled as Tapir's, not as a lookup.
- MusicBrainz answered and knows no artist: a fail with a create link on musicbrainz.org, pre-filled with the name.
- A page linked to your addresses under ANOTHER name is not "a page for you", and the sentence names it. (verify-found M1)
- A Connections link MusicBrainz has no artist for fails, and points back to Connections to fix the link. (verify-found M2)
- Could not ask (MusicBrainz busy): "couldn't check" with the reason, never a fail.
- CRITICAL: MusicBrainz lists people who make music, so for a visual artist the test does not apply, and never offers "Create the page".
- MusicBrainz looks a link up by its exact spelling: each platform is cleaned the way its own editor stores it, or the lookup misses a real page.
- A homepage is stored as the editor typed it, so every common spelling of the site is asked about.
- Junk and script links give nothing to ask about, never a request.
- A connected artist link is opened once, at MusicBrainz's artist address, and the name there is reported for the test to compare: it used to pass unopened, a made-up id too. (verify-found M2)
- A connected link MusicBrainz has no artist for (404) is "no page", marked as coming from Connections. (verify-found M2)
- Could not open the connected link (thrown, busy twice, an odd answer) is "could not ask", never a pass. (verify-found M2)
- A MusicBrainz link to a release is not an artist page: it is not opened, and the normal lookup runs instead.
- ONE request covers the site and the three strongest profiles (Instagram and TikTok rank lower, a mailto is not a link), with the User-Agent MusicBrainz asks for.
- The artist a profile links to is found, with the link that found it.
- When several artists come back, the site beats a profile and the artist with your name beats another.
- One link asked gets a different answer shape: it is read too.
- A release, a label, or an id that is not a MusicBrainz id is not an artist found.
- A 404 and an empty list both mean MusicBrainz looked and knows no artist: `looked` stays true.
- Busy (503): wait at least a second, ask once more, then give up as "could not ask" with the reason.
- A second try that answers is used.
- Retry-After on a 429 is honoured, but capped at 5 seconds so one answer can't stall a run for an hour.
- Two lookups in a row wait a second between them: MusicBrainz's limit for everyone on this server.
- An answer we can't read, a 500, or a thrown fetch: "could not ask" with a reason, so the test says "couldn't check".
- Nothing to ask about, or a site on a private address: no request at all.
- A run that has already given up (aborted) asks nothing.
- CRITICAL: an artist published as a visual artist asks MusicBrainz nothing; the `mb` test does not apply to them.

### tests/unit/seo-tests/says-who-you-are/place.test.ts · 10 tests

Proves the "Where you're based is clear" test passes only when the artist's node in the fact card gives a city, a state or region and a country as separate facts, matching Tapir's.

- **Code:** src/lib/seo-tests/who.ts (`place`), with src/lib/seo-tests/apple-storefront.ts (`countryCode`: is it a real country)
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and compares it with what Tapir published.
- **Not here:** an unreachable home page, or a card cut at the read cap (../honesty.test.ts).

**Tests**

- The one exact-wording check: the pass sentence names all three parts.
- A person's homeLocation is read like a band's foundingLocation, and a Country object counts as a country.
- CRITICAL: a city only (the shape skeen ships today) is a soft fail; Tapir HAS the region and country, so the advice is publish, not "add", and the details show Tapir's place.
- When Tapir has no region or country either, the advice is to add them on the Facts tab.
- "Chicago, IL" in one line is not a region: search engines want separate facts, and the result says "one line", never "has Chicago, IL but not the state". (verify-found P1)
- City + country with no region fails, and the details say the region is missing.
- City + region with no country fails, and the details say the country is missing.
- A bare string is not a place with parts; no place at all is a hard fail.
- A region of spaces is missing, not a region.
- Austin when Tapir says Chicago is stale or wrong; "Earth" and "n/a" are not a real country or region. (verify-found P2)

### tests/unit/seo-tests/says-who-you-are/title.test.ts · 18 tests

Proves the "Your page title says who you are" test passes a title that names the artist and their city or sound, and fails every title that doesn't.

- **Code:** src/lib/seo-tests/who.ts (`title`), reading the page with src/lib/seo-tests/html.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and tells the artist a claim about it; a wrong verdict is advice they act on.
- **Not here:** an unreachable or cut-short home page (../honesty.test.ts); how pages are read (../page-reading/html.test.ts); the share title (../looks-right-when-shared/link-preview.test.ts).

**Tests**

- The one exact-wording check: the pass sentence quotes the live title, and the details say it matches Tapir's.
- Exactly 70 characters passes: 70 is the limit, not over it.
- A name in a script written without spaces is still found: Japanese titles run words together. (verify-found T4)
- A live title that differs from the published one is flagged, and Tapir's is labelled as Tapir's, not the site's.
- With nothing written, Tapir's title is the one BUILT from the facts: it must never be called "written" by the manager. (verify-found T2)
- The bare name, in any case: a hard fail (not "Almost"), pointing to the Listing tab.
- The name plus filler, or an error page's or a builder's placeholder title: each is a hard fail, never the soft "Almost" a missing city gets. (verify-found T1) _(one per row of a table)_
- Your name plus a word that is neither your city nor your sound: a soft fail, since Tapir has both to suggest. (verify-found T1)
- No title at all: Google then makes one up.
- The name must be there as a whole word: "Skeens" is not "Skeen".
- Over 70 characters gets cut off in results: a soft fail that says the length.
- Only the page's own title counts: an icon's svg <title> before it is not the page title, and alone it means "no title".
- React can stream the title into the body: it is still the page's title.
- "&amp;" is judged and shown as "&": the manager reads the title as a visitor does.
- A second title is noted in the details: browsers and Google may pick either.
- Length is counted in characters, and no emoji is cut in half in what the manager sees. (verify-found T3)
- A 5 MB page is read in well under 3 seconds: a slow reader would stall the whole run.
- Thousands of unclosed scripts and an unclosed quote: still answers, never hangs.

### tests/helpers/seo/crawl-fixture.ts · support file

A stored crawl (types.ts SeoCrawl) for the "How crawlers see your site" tests: a healthy site that lets every crawler in, three pages, registered with Google and Bing. Shaped like Skeen's real answers of 2026-09-29 (prototypes/seo_variants_20260930_r11.html), on the test origin.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/crawl-section.tsx, src/lib/manager-tools/seo/crawl-model.ts
- **What it provides:** • healthyCrawl(): every crawler allowed by `User-agent: *` / `Allow: /`, a Host line, a sitemap of the three pages (all one date), each page's canonical itself for all three visitors, no noindex, every visit 200, the other spelling 308 → the site, and Google PASS + Bing visits for each page • withBot(crawl, key, over): the same crawl with one crawler's robots.txt answer changed • PAGES, OTHER_HOST

### tests/helpers/seo/fake-site.ts · support file

A fake web for the SEO / GEO tests: every address answers from a table, with no network.

- **Code:** src/lib/seo-tests/evidence.ts (gatherSiteEvidence) and src/lib/guarded-fetch.ts (guardedFetch): what it is fed to
- **What it provides:** • `fakeSite(routes)`: a `fetch` where each exact address answers with a real `Response` (status, headers, body), so bodies, headers and streams are read exactly as from the real `fetch`; anything unlisted is a 404 • answers that misbehave: a body that never ends, a delay, a request that hangs until it is aborted, a dropped connection • `calls` (every request, with its User-Agent) and `maxInFlight()` (the most requests open at once), to check what was asked for and how politely

### tests/helpers/seo/page-fixture.ts · support file

A healthy artist site (its html) and the evidence a run would gather from it. Each SEO test starts from this and breaks ONE thing, so a red test names the rule that broke.

- **Code:** support file (not a test): feeds src/lib/seo-tests/who.ts, shared.ts, facts.ts, found.ts and the SEO page's component tests
- **What it provides:** • homeHtml / aboutHtml: a healthy home page and About page (title, description, share tags, two photos, an Apple Music button, the music section, the fact card) • healthyGraph / artistNode / graphBlock / ldScript: the fact card, piece by piece • known: what Tapir published for the artist; evidence: one run's whole evidence • page: one fetched page (a status, an error, a page cut at the read cap) • rowOf / expectPlainWords: read one "Show the details" row; check a result keeps the plain-words contract (types.ts)

### tests/helpers/seo/run-fixture.ts · support file

Stored SEO / GEO runs for the page's tests, made by the REAL engine over made-up sites, so the page is tested against results the engine really gives.

- **Code:** src/lib/seo-tests/engine.ts (SEO_ENGINE), run.ts (runAllTests), store.ts (capResults)
- **What it provides:** • engineResults(scenario): the 24 real results for a made-up site, capped as stored • fixtureResults(over, scenario): the same with some tests forced (only to a status the engine can really give that test) • fixtureRun: a stored run around those results (a publish run, or a manual one); fixtureHistory: each test's last statuses, oldest first • the scenarios: healthy, needsWork (Skeen-like), siteDown (timed out), site500, trainingBlocked, visualArtist (some tests `na`), hostile (html in the title)

### tests/unit/seo-tests/_found-fixtures.ts · support file

The pretend site every "Can be found" test file reads: a healthy two-page artist site, and the real-world pages to break it with.

- **Code:** src/lib/seo-tests/found.ts (what these fixtures are fed to)
- **What it provides:** • `evidence(f)`: one run's evidence for the site at www.example.com (home + /about), with any visit, the robots.txt answer, the sitemap, Tapir's data or Bing's file swapped • the artist Tapir knows (Skeen: bio, two releases, one upcoming and one past show) • pages copied from what real sites and firewalls serve: a Cloudflare challenge, block page and "Access denied" page, a Next.js 404 served as 200, a page empty until its scripts run, a password page • `run(id, f)` and `details(r)`: run one test on a fixture; its "Show the details" rows as text

## SEO / GEO page

The dashboard page: its tabs, what they show, and the routes and data behind them.

### tests/components/manager-tools/seo/answers-tab.test.tsx · 6 tests

The SEO / GEO Answers tab: five fixed questions, two of them read-only (from Tour and Music), the rest edited in place into their FAQ keys; the manager's own questions fill the next free slot.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/answers/answers-tab.tsx
- **Tier:** STRICT (AGENTS.md "Test depth") for what gets saved (each answer to ITS key, derived from FAQ_KEYS / FAQ_EXTRA, never hand-listed) and for the automatic-only rows (never editable, never showing a stored answer the site ignores); LIGHT for the rest.
- **Not here:** the FAQ keys' caps and prose rule (tests/unit/manager-tools/seo/save-rules.test.ts).

**Tests**

- Read-only rows: next show and latest releases come from Tour and Music; a stored answer there is ignored, as the site ignores it.
- Editing an answer: opens from the automatic one, writes nothing on opening, saves to its FAQ key.
- Going back to automatic asks first; No keeps the manager's words.
- Yes clears the written answer; with none written there is nothing to clear.
- Own questions: Add fills the next free slot (question and answer); Remove asks, then clears both halves.
- No more questions than slots: Add goes when they are full.

### tests/components/manager-tools/seo/bio-rows.test.tsx · 2 tests

The Profiles tab's Outside bios: a bio whose facts changed after its tick says so, with the date, and its card's tick re-confirms it.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/bio-rows.tsx
- **Tier:** LIGHT (AGENTS.md "Test depth"): new UI, one main path. Which state a bio is in is pinned STRICTLY in tests/unit/manager-tools/seo/bio-state.test.ts.
- **Not here:** the states themselves (bio-state.test.ts); the action (profile-marks.test.ts).

**Tests**

- Instagram ticked Aug 15, facts changed Sep 29: the row says so; the card's tick re-confirms bio_instagram.
- The server's render carries the state but no date: the date is written in the viewer's zone after mount.

### tests/components/manager-tools/seo/crawl-section.test.tsx · 11 tests

"How crawlers see your site" on the AI test tab: the five rows above the four test groups, and the white card each one opens.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/crawl-section.tsx, wired in test/test-tab.tsx (words and marks from src/lib/manager-tools/seo/crawl-model.ts)
- **Tier:** LIGHT (AGENTS.md "Test depth": a UI still being designed): one test per main path, no class strings, no copy (marks are read from `data-mark` / `data-state`). STRICT for one honesty rule: Bing is never said to have "listed" a page (Bing has no such answer, types.ts SeoCrawl.listing).
- **Not here:** the rules behind each mark and value (tests/unit/manager-tools/seo/crawl-model.test.ts); the rest of the tab (test-tab.test.tsx); how it looks (checked by screenshot).

**Tests**

- A run from before crawls, one that couldn't look, or a shape this page doesn't know: nothing is drawn, and the test groups are all there is. _(one per row of a table)_
- Five rows, first on the page (above every test group), each marked fine, and the count says so.
- robots.txt: the file as sent, and every crawler bots.ts knows, allowed.
- Sitemap: each page it lists, opened.
- Page address and tags: every page's canonical is itself, and nothing says "don't list".
- Crawler visits: a cell per visiting crawler per page, and robots.txt-only names spanning the row.
- Listed: Google's answer per page, Bing's visit per page, and no "go look yourself" links.
- A crawler turned away by its own group: the row turns red, and that crawler shows the rule.
- Not registered with either: no answers to show, the row is a ring, and each side links to the provider's own tool (https, a new tab).
- A page Google answered and doesn't list: a link to Search Console's inspect page for it (where "Request indexing" is), in a new tab. A listed page has none.
- STRICT (honesty): Bing only says when it last visited a page, so nothing about Bing may say it "listed" one: not its card part, and not the row's value when Bing is all there is. _(one per row of a table)_

### tests/components/manager-tools/seo/details-tab.test.tsx · 9 tests

The SEO / GEO Details tab: the page title and description save through the SEO gate (never over their caps), the preview follows, and the share and photo rows open their editors.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/details/details-tab.tsx, og-image-picker.tsx
- **Tier:** STRICT (AGENTS.md "Test depth") for what gets saved (the gate, the key, never a value over its cap) and for the ids a test's pencil lands on (`share`, `alt`); LIGHT for the rest.
- **Not here:** the save rules (tests/unit/manager-tools/seo/save-rules.test.ts); the preview picture's geometry (tests/unit/manager-tools/seo/og-card.test.ts).

**Tests**

- The title saves to its key through the SEO gate; blank shows the default, and the preview follows.
- A title over the cap is kept (not cut), refused in the gate's words, and never sent.
- The description has ONE limit (Google's): over it, never sent; under it, saved.
- The share and alt tests' pencils land on these rows' ids.
- Arriving on #share opens the preview picture editor.
- A Brand colour can be the background; trying colours writes nothing (one explicit action, no Save pill).
- Photo descriptions: one at a time, each saved to THAT photo, with a readable suggestion (no file-name code).
- Arrow keys move between photos, except while typing.
- Calm rows: a count only while typing in its field, and no descriptor lines (Sam's notes).

### tests/components/manager-tools/seo/facts-tab.test.tsx · 19 tests

The SEO / GEO Facts tab: each fact saves through its own gate, a value the gate would refuse shows the gate's own words and is never sent, and the bio keeps its rules.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/facts/facts-tab.tsx
- **Tier:** STRICT (AGENTS.md "Test depth") for what gets saved: the city to artists.location, region / country / other names / the year to their fact keys, the bio to artists.bio through the editor's gate and never over its cap. LIGHT for the rest (the visual-artist note, the profile rows).
- **Not here:** the save rules themselves (tests/unit/manager-tools/seo/save-rules.test.ts); how the page reads the stored facts (tests/unit/manager-tools/seo/seo-facts.test.ts).

**Tests**

- Where each place saves: the city to the artist row, the region to its fact key.
- A refused value: the validator's own words show, and nothing is sent.
- The country list is exactly the table the gate accepts, so a pick is never refused.
- A country with regions turns Region into its list, and the region is saved after the country.
- A quick region waits for the country's save, since the gate reads the country back to judge the region.
- A new country drops a region not on its list, and saves the clear.
- A country stored as "USA" shows as the table's "United States", with the US region list.
- The year: four digits only; anything else shows the validator's words and is not sent.
- A visual artist: the year is kept but not on the fact card, and the page says so.
- Other names: the artist's own name is refused in the validator's words, unsent.
- A genre chip is added and saved to the artist row as one list.
- A stored value the gate would now refuse is flagged on arrival.
- The type saves as the artist's schema type.
- The bio row is calm: its first words only; the counts live in the editor, and no 2,500 anywhere (Sam's call).
- The bio test's pencil lands here: the row carries its id, and arriving opens the editor.
- The bio saves to artists.bio; over the cap it is kept, refused and never sent (never cut).
- "Where it shows" offers only what can take effect here (no site declaration on this page).
- Profiles: how many reach the fact card, and MusicBrainz's own editor filled in with the name.
- A linked fact database shows what is linked instead of the create link.

### tests/components/manager-tools/seo/outside-rows.test.tsx · 3 tests

The Profiles tab's Discogs and Wikidata rows show what the check found, and open a card with the link and the one thing to do.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/outside-rows.tsx
- **Tier:** LIGHT (AGENTS.md "Test depth"): the rows are new and still moving; one main path per row. What each check decides is pinned STRICTLY in tests/unit/manager-tools/seo/outside-profiles.test.ts.
- **Not here:** how the checks are made (outside-profiles.test.ts); the exact words and layout.

**Tests**

- A linked Discogs page without the site: the closed row says so beside Discogs' attribution link (the status is Discogs data too), and its card links the page and says what to add.
- No site to look for: "no site", not "couldn't check", and nothing to open.
- An item that lists the site but not the MusicBrainz id: the row names what's missing, and the card links the item and shows each statement.

### tests/components/manager-tools/seo/profiles-tab.test.tsx · 3 tests

The SEO / GEO Profiles tab: the Apple Music & Amazon bio card shows the email the builder makes, Open in Mail opens exactly that email, and Mark as sent records it.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/profiles-tab.tsx
- **Tier:** LIGHT (AGENTS.md "Test depth"): the card is new and still moving. The email itself is pinned STRICTLY in tests/unit/manager-tools/seo/bio-pack.test.ts.
- **Not here:** the email's wording, encoding and CC rules (bio-pack.test.ts); who may mark (profile-marks tests).

**Tests**

- The card shows the email the builder makes, and Open in Mail opens exactly that one.
- Some mail apps cut a long mailto short without a word: past MAILTO_SAFE_LENGTH the card says to use Copy. A 150-word bio and the most releases the email lists is past it.
- Mark as sent: the artist, the item, and done = true; the row then says it was sent.

### tests/components/manager-tools/seo/publish-bar.test.tsx · 5 tests

The SEO / GEO Publish bar: it publishes what the SEO tabs changed with one password, each part only when it is waiting, and it is gone when nothing waits.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/seo-riser.tsx, src/lib/manager-tools/seo/pending.ts (pendingMessage)
- **Tier:** STRICT (AGENTS.md "Test depth"): publishing is what the live site receives.
- **Not here:** the publish actions themselves (tests/unit/publish/); the run a publish starts (tests/unit/seo-tests/runs/publish-hook.test.ts).

**Tests**

- Hidden means gone: invisible and inert while nothing waits, so no dot or button shows under the fold.
- Both waiting: the site first, then the links, with the one password.
- Only links waiting (a test's fix): the site publish is not run.
- A refused site publish (wrong password) stops before the links.
- The message says what is waiting, in a few words.

### tests/components/manager-tools/seo/test-tab.test.tsx · 20 tests

The SEO / GEO AI test tab: start, running and done, the card under an open row, its actions, evidence shown as plain text, and the quiet states (busy, cool-down, failed, no site...).

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/test-tab.tsx, test/test-row.tsx, test/scan-art.tsx (drawn from src/lib/manager-tools/seo/test-model.ts)
- **Tier:** LIGHT (AGENTS.md "Test depth": a UI still being designed) for the steps, the card and the states: one test per main path, no class strings, no copy. STRICT where it guards something that can't be allowed to slip: evidence rendered as TEXT (a hostile site's `<img onerror>` / `</script>` must never become an element), https-only outside links, and one run per double click.
- **Not here:** the counts, headline, evidence rows and refusal rules themselves (tests/unit/manager-tools/seo/test-tab-model.test.ts); the actions on the server (tests/unit/manager-tools/seo/test-actions.test.ts); how the drawings move (decoration, checked by eye).

**Tests**

- Never tested: the start shows (no rows), and "Test my site" runs the first test; its result then shows.
- Two fast clicks (in one act batch) start ONE run (AGENTS.md rule 5: the latch is a ref).
- No site connected: nothing to run, so there is no "Test my site" at all.
- While a test runs: no heading, no list and no ticks (the drawing never fakes progress); the rows come back when it lands.
- A run that lands here makes its rows rise in one after another; the run already there on load stays still.
- A stored run: its headline (runHeadline's own words) and the four groups, every test once.
- Site didn't answer (the engine's own timed-out run): said ONCE in the header, no rows to open; Test again stays on.
- The outside bios (Profiles tab): one quiet line to them, outside the score; none when all are fine.
- A failing row opens a card with its lead and sentence, its evidence, and its pencil linking to the setting; a pass has no "what to do".
- Keyboard: Esc closes the open row and returns focus to it; the arrows move between rows.
- A deep link (?open=) opens that test's row on arrival.
- Outside links: a new tab, noopener, https only; a stored javascript: link renders nothing.
- The fix: the wrench calls applySeoFixAction, the card confirms it, and a refresh raises the Publish bar.
- A refused fix says why (the server's words, in a toast) and leaves the wrench to try again.
- A hostile site's html shows as characters, never as elements (the engine really carried it).
- Tests not switched on: nothing to press, no rows. Couldn't read: a way to try again that refreshes.
- Another run going (a publish's): the running view with its one "already running" line, no rows, and we look again every few seconds.
- A cool-down refusal (read from its reason) counts down, with Test again off.
- A failed run: the server's sentence shows, and Test again stays on.
- The lines under the header: a failed attempt after the latest run (after a reload), a run over 30 days old, a run of an old address.

### tests/unit/manager-tools/seo/bio-pack.test.ts · 8 tests

The Apple Music & Amazon bio email: what we ask AllMusic / Xperi to write from, and the `mailto:` link that opens it in the manager's mail app.

- **Code:** src/lib/manager-tools/seo/profiles/bio-pack.ts (buildBioPack, mailtoHref, ccAddress, emailText)
- **Tier:** STRICT (AGENTS.md "Test depth"): it builds a URL from user-supplied text and an outbound message to a company we don't control. A header smuggled into the mailto (a second recipient, a Bcc) or a link to someone else's page would go out under the manager's name.
- **Not here:** the card on the page (tests/components/manager-tools/seo/profiles-tab.test.tsx).

**Tests**

- A subject or body that tries to add a header or a recipient stays inside its own value.
- Only the two Xperi addresses: a `to` that was tampered with never adds a recipient.
- CC to the artist: one valid address, once, as cc=, encoded like the rest.
- Apple links move to the US store; the rest are only https links on the platform's own host.
- The body names the artist every time, for any mix of what is and isn't known.
- Subject: name, city, genre; the parts that are missing are left out.
- Releases: newest first, unreleased left out, ten at most.
- The checks: each fires on its own gap and is quiet once the gap is filled.

### tests/unit/manager-tools/seo/bio-state.test.ts · 27 tests

The change nudge decides what the artist is told about each outside bio: not confirmed, may be out of date since a date, check it's still current, or updated.

- **Code:** src/lib/manager-tools/seo/profiles/bio-state.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): it decides what the artist is told to go and redo.
- **Not here:** the rows on screen (tests/components/manager-tools/seo/bio-rows.test.tsx); the tick itself (profile-marks.test.ts).

**Tests**

- Skeen's real history: four bio rewrites on Jul 16. Genre and city joining the snapshot on Aug 28 is not a change: the snapshots before it never said what they were.
- The point of the nudge: a Publish that repeats the facts (an editor restyle, a press-kit edit, a template switch, a new hero banner) must never count as a change.
- A history of restyles and press-kit edits after the first Publish: a tick after it stays current.
- Every fact, on its own, is a change (derived from BIO_FACTS, so a fact added later is covered the day it is). _(one per row of a table)_
- Two facts in one Publish are both named, in words.
- The first Publish is when the facts first went out: it counts, naming what it set.
- CRITICAL: a fact that JOINS the snapshot (a new BIO_FACTS column) is ABSENT from every older revision. Its first Publish arrives with a value, and reading "absent" as "empty" would date a change there and mark every ticked bio out of date. Compared only once both sides carry it; null, '' and spaces are all "nothing", and text compares trimmed.
- Rows in any order give the same answer.
- The loader reads a capped window. Its oldest row has an unknown Publish before it, so it is NOT the first Publish and must not be dated as a change; changes inside it are still found.
- No Publish yet: no change. A row with no snapshot or a bad date is skipped, not trusted.
- No tick yet: not confirmed, even when the facts changed.
- The nudge itself: a change after the tick is out of date; a tick after the change is current.
- "Changes + 6 months" (decided 2026-10-01): the edge is inclusive of exactly RECHECK_AFTER_DAYS.
- Both apply: the change wins, because it has a date to say.
- Ticking again after a change clears the nudge.
- The words for what changed: "bio", "city and genre", "name, bio and genre".
- No two facts share a word (derived from BIO_FACTS).
- A label that drifts (in OUTSIDE_BIOS or in Connections) would drop a bio without a word.
- Skeen's real links: seven bios, in OUTSIDE_BIOS order; the booking rows and the USB button are not profiles.
- Derived: one link (or source id) per outside bio connects them all.
- Nothing connected, nothing shown; a source id alone connects Apple Music and Bandsintown.
- A platform label on a role-bound button or a mailto: is not that platform's profile.
- Each row reads ITS bio_<key> tick, never another item's.
- Ticked Aug 15, bio changed Sep 1, city Sep 20: out of date since Sep 1 (the OLDEST change after the tick), naming both. A tick between the two sees only the city; no tick, neither.
- The AI test's count: everything not current; 0 when all are ticked and nothing changed.
- Fail soft: a read that failed is "couldn't check", never a state and never counted.
- "Sep 29" this year; "Sep 29, 2025" when it is not this year; nothing for a bad date.

### tests/unit/manager-tools/seo/crawl-model.test.ts · 28 tests

"How crawlers see your site": the rules behind each row's mark and value, and the few words that must stay true (a date that doesn't slip a day, Bing never "listed").

- **Code:** src/lib/manager-tools/seo/crawl-model.ts
- **Tier:** LIGHT for the values' wording (the design is still moving: values are matched on their numbers, not their sentences). STRICT for what the manager is told is true: a mark is a check only when nothing blocks, "N of 5 fine" counts checks only, Bing is never said to list a page, and a sitemap's date is never shifted a day.
- **Not here:** drawing any of it (tests/components/manager-tools/seo/crawl-section.test.tsx).

**Tests**

- Version 1 with every part: shown. Anything else: nothing (a half-read crawl would say a wrong "fine").
- Every crawler bots.ts knows gets a company, and a robots.txt name only (Google-Extended, Applebot-Extended) sits with the crawler that does its visiting.
- Grouping keeps every crawler once, and a company's crawlers together.
- Everyone allowed by the rules: a check.
- One crawler blocked: red, and the value counts it.
- The file couldn't be read: a ring, never a check.
- No file: everyone may visit, so it is fine.
- The shared rule is said once, with the group and the rule as they are in the file.
- One crawler decided differently: the line still covers the rest, and not that one.
- All listed pages opened: fine.
- No sitemap at the address: red. Couldn't ask: a ring.
- A listed page that doesn't open: red, counted.
- A canonical is "itself" only for the same origin, path and query.
- Every page itself for every visitor: fine.
- Google alone told another address: red (a person's tag being right is not enough).
- A "don't list" header: red, whatever the tags say.
- No page opened: nothing to read, a ring.
- Every visit 200: fine. One refused: red. One unanswered (and none refused): a ring.
- Google's verdicts: PASS is listed; FAIL ("Error") is red; NEUTRAL ("Excluded") is a ring, since it covers harmless states; asked-but-no-answer is "no answer", never "not listed".
- "Ask Google" goes to Search Console and nowhere else: the host is fixed, and a page's address (text from the site) is one encoded value that can't add a parameter or leave the host.
- "Ask Google" only where asking can help: not for a page that points elsewhere on purpose.
- Every page listed on Google: fine. One not: red. Neither registered: a ring.
- Asked but nothing answered (failed, timed out, no key): said as such, never "0 on Google".
- STRICT: Bing alone never makes the row fine, and its words never say "listed".
- "N of 5 fine" counts checks only: a ring is not fine.
- A sitemap date with no time is that calendar day in every zone (parsed as UTC it would read a day early anywhere west of London).
- Nothing, or not a date: nothing.
- Every page of the fixture has a date to show.

### tests/unit/manager-tools/seo/og-card.test.ts · 10 tests

The preview picture made on the Listing tab is 1200 × 630 with the logo centred, never cropped, on a SOLID background that is never transparent.

- **Code:** src/lib/manager-tools/seo/og-card.ts (OG_CARD_WIDTH / HEIGHT, ogCardDrawBox, OG_BACKGROUNDS, ogBackgroundHex)
- **Tier:** STRICT (AGENTS.md "Test depth"): the broken render happens on someone else's server, invisible from inside the app. TRANSPARENCY: a logo PNG has alpha, and platforms lay it on THEIR background, so a black logo turns into a blank square in dark mode. ASPECT: previews are ~1.91:1, and a logo of another shape is cropped or letterboxed as the platform likes. Baking a solid background into the right shape settles both here.
- **Not here:** the picture editor on the page (tests/components/manager-tools/seo/details-tab.test.tsx).

**Tests**

- The shape: 1200 × 630, the 1.91:1 the platforms publish (a range, since the need is "nobody crops it").
- Contained, never cropped, whatever the logo's shape (a cropped wordmark loses its last letter).
- Never stretched: the logo keeps its shape.
- Centred on both axes.
- A margin all round: platforms round corners and lay badges over the edges.
- A failed image gives an empty box, not NaN (which paints nothing and reports nothing).
- Every offered background is a hex the canvas can fill.
- A bad stored value falls back to white, never to transparent (that is the black-on-black bug).
- A picked colour fills as itself, opaque; anything with alpha is not a colour here, so white.
- Both light and dark are offered: a white logo needs a dark card, a black logo a light one.

### tests/unit/manager-tools/seo/outside-profiles.test.ts · 11 tests

The Profiles tab's Discogs and Wikidata checks ask the right thing, politely, and tell the manager only what the answer says.

- **Code:** src/lib/manager-tools/seo/profiles/outside.ts (what is asked, how an answer is read), src/lib/manager-tools/seo/profiles/outside-check.ts (the fetching)
- **Tier:** STRICT (AGENTS.md "Test depth"): it builds addresses from the artist's data and decides what the artist is told to do on another service.
- **Not here:** the Discogs and Wikidata link parsers (tests/unit/manager-tools/connections/identity-only.test.ts); guardedFetch's address and redirect rules (tests/unit/safe-fetching/); the rows' words (tests/components/manager-tools/seo/outside-rows.test.tsx); the day-long cache (outside-load.ts, Next's unstable_cache).

**Tests**

- Wikidata matches P856 exactly, so every common spelling of the homepage is asked: missing one (the bare, slash-less https form is how The Beatles' is stored) misses the item.
- The site asked about is the custom site, by the AI test's own rule (seoSiteOrigin), with its path. A template artist's page is `<this app>/<slug>`: asking for that host would find any artist's, so it is no site. A local or private address is none either.
- A site on a path is spelled on that path, never as the bare host: P856=https://www.facebook.com/ would match every artist whose website is Facebook's home page. A `|` in the path would add a clause of its own to the OR, so such a path is not asked about.
- The same site: host (give or take www. and the scheme) and, for a site on a path, that path or a page under it. A root site owns its whole host.
- ONE search, every clause OR'd: the MusicBrainz id (lower-cased, and only a real one) and each spelling of the site. Nothing to ask by = no search at all.
- The ids come from the manager's own Connections links first; the AI test's MusicBrainz page only when that test PASSED (a failed one names someone else's page, or none).
- The Beatles' real answers: the search finds Q1299 by a site spelling, and the item carries both the site and the MusicBrainz id. Asked as a bot with a contact address, no email.
- No MusicBrainz id: the website alone finds the item (the real answer to exactly this search). No site but a MusicBrainz id: the item is found and the site is not asked about (null), so the row never says "site missing" to an artist who has none.
- No item lists the site: "no item yet". A 429 is given up at once (one request, no retry). A linked item Wikidata no longer has falls back to the search. Nothing to ask by: no request.
- Only the page the manager linked is read. Any spelling of the site counts (Discogs has `https://www.thebeatles.com/`); a page with no Sites (the other Skeen) is "site missing"; 404 is "no page there"; no link asks nothing; a 429 is "couldn't check".
- The Beatles' real page lists https://www.facebook.com/thebeatles. A site at ANOTHER path on Facebook is not on it: the host alone would have said "lists your site".

### tests/unit/manager-tools/seo/profile-marks.test.ts · 21 tests

Profile marks without a database: which items exist, reading the marks before and after the migration is pushed, and the server action refusing bad input before it opens a session.

- **Code:** src/lib/manager-tools/seo/profiles/marks.ts (PROFILE_ITEMS, isProfileItem, readProfileMarks, setProfileMark), src/lib/manager-tools/seo/profiles/bios.ts (OUTSIDE_BIOS, BIO_ITEMS), tools/seo/profiles/actions.ts (markProfileItemAction), and the newest `profile_marks_item_check` in supabase/migrations
- **Tier:** STRICT (AGENTS.md "Test depth"): `item` arrives from the client and picks the row written; "not marked" must not be shown when the read actually failed; `edit` ends up in an href.
- **Not here:** RLS, grants, the CHECK and the stamping trigger in a real database (tests/integration/manager-tools/seo/profile-marks.test.ts).

**Tests**

- The table's CHECK and the code's list are two copies of one rule. If the code gains an item the CHECK lacks, every tick on it fails with 23514; if the CHECK gains one the code lacks, its marks are silently dropped on read.
- Derived from the bios registry: a bio added there is a tick here with no second list.
- Two bios on one key would share one tick (and one row): ticking one ticks both.
- `edit` is rendered as a link the manager follows: only an absolute https URL, never a relative path or another scheme.
- The one gate on the item name: the CHECK in the migration says the same.
- Spelled out from the registry, so dropping the bios from PROFILE_ITEMS fails here too.
- Only items the code knows reach the page; an unknown row is ignored, never shown.
- Before the push the tab must still render, with nothing marked.
- A failed read must not look like "not sent yet", or the manager sends the email twice.
- Ticking "updated" again must move the date: one update of THIS artist's row for THIS item, sending done_at alone (the only column managers may update), and no insert after it.
- Nothing to re-confirm: insert artist_id + item only (the database stamps the rest), and ON CONFLICT DO NOTHING, so a double click racing the first insert is not an error.
- 20261001160000 is live: a re-confirm refused for lack of the UPDATE grant (42501) is a failure, never a silent insert that reports "done" while the stamp stays put.
- Any other failure of the re-confirm is a failure: inserting after it could report "done" for a stamp that did not move.
- An undo that lost a filter would clear the item on every artist this manager runs.
- "Sent" shown for a mark that was never stored is how the email goes out twice, or never.
- setProfileMark checks the item itself, so no caller can write a row the CHECK would refuse.
- The witness for the refusals below: a good call DOES open the session and write, for every item the table accepts (the bios included): re-confirm first, then the first-mark insert of artist_id + item only.
- The action's first gate: a bad item never opens a session or reaches a table.
- A flag from the client is checked as a real boolean, never coerced ("false" is not false).
- Signed out: refused before any mark is read or written (RLS would also refuse, but then a cross-artist undo would report ok: the check is what keeps the answer honest).
- Not this manager's artist (the owned read comes back empty): refused, nothing written.

### tests/unit/manager-tools/seo/save-rules.test.ts · 52 tests

What each SEO / GEO field may store: the one save gate for the page-head words, the answers and the artist facts, what each rule refuses, and the paths that must NOT be able to write a fact.

- **Code:** src/lib/site-editor/save.ts (seoValueError, saveSeoField, SEO_LIMITS, saveEditorField), src/lib/seo-facts.ts (FACT_KEYS, isFactKey, factTextError, cleanFactValue, joinAliases, thisYearAt), src/lib/seo-regions.ts (REGIONS), src/lib/artist-facts.ts (artistFactUpdate)
- **Tier:** STRICT (AGENTS.md "Test depth"): every value here reaches the live site's <head> or its fact card, and they are validators (markup, control characters, links).
- **Not here:** how the Facts tab reads the stored facts back (seo-facts.test.ts); the tabs that call these (tests/components/manager-tools/seo/*-tab.test.tsx).

**Tests**

- A key with no rule is refused: a field added to the schema can never be stored unchecked.
- The share picture's address: https only, so a javascript: or data: link never reaches og:image.
- Where the bio shows: only a placement the bridge knows.
- Every capped string: refused one over its cap, kept at it (the country is a pick, so tested apart).
- The five answers: gated and capped at 1200, in order.
- The manager's own questions: five slots, a question capped at 200, an answer at 1200.
- The fact keys are exactly the bridge's, so the site and the gate agree on what a fact is.
- Every fact key is an SEO key: reserved from other paths, and published with the site text.
- Region and country share the page counter's cap (60).
- Each fact's rule applies through seoValueError too (region, country, other names, year).
- An answer keeps its paragraph break: the fact sheet renders answers as paragraphs (review 2026-09-03, M8).
- An answer is still tidied: line endings, runs of spaces, piles of blank lines.
- A page-head field collapses to one line: <head> takes no breaks.
- Blank clears the row (back to automatic), for answers and page-head fields alike.
- The cap is measured on what is stored, so kept paragraph breaks count.
- Real names pass: quotes, accents, emoji and right-to-left scripts are fine.
- No markup in a fact: < and > are refused (the fact card is inside a <script> tag).
- No hidden characters: control characters and half-emoji are refused; tab and newline are just spaces.
- Region and country: one line, trimmed; blank clears.
- Invisible direction marks are stripped, not stored.
- The place cap counts characters (an emoji is one); 10,000 characters are refused, never cut.
- Hostile region or country: markup and control characters are refused.
- A known country in any spelling is stored in the table's spelling ("USA" → United States).
- The country dropdown and the gate agree: every listed country is accepted as itself, and nothing else.
- No country, or one without a region list: the region is typed text, kept as written.
- A country with a region list: the region must be one of its names, stored in the list's spelling.
- Other names: stored one per line, trimmed, blank lines dropped (a lone CR separates too).
- At most five other names.
- Each other name has its own cap; 10,000 characters are refused.
- No repeats, ignoring case and hidden marks; an accented spelling is a different name.
- Never the artist's own name, ignoring case and hidden marks.
- Hostile other names: markup or control characters in any line are refused.
- Real names are kept as written; bidi overrides are stripped.
- joinAliases writes the stored shape, and it reads back unchanged.
- Active since: a four-digit year from 1900 to this year.
- Anything else is refused, with the reason (short, long, dated, full-width digits, hex).
- "This year" is the year at UTC+14, so a manager already in the new year is not refused it.
- The region is stored cleaned: one line, hidden marks gone.
- The country is stored in the table's spelling; one off the list is refused and nothing is written.
- The region is judged against the country the gate reads itself (a caller's could be stale).
- A failed country read refuses the region: an unchecked region is never stored (clearing needs no read).
- Other names keep one per line through the gate (the page-head rule would merge them into one).
- Other names are checked against the name the gate reads itself.
- A failed name read refuses: an unchecked list is never stored.
- Clearing other names deletes the row without needing the name.
- "This year" comes from the clock the gate is given.
- Hostile input through the gate: every one refused, and nothing is written or deleted.
- A custom site field named like a fact is reserved, so the editor can't write a fact.
- No built-in template declares a fact key.
- Only the fact columns: never slug, template, or any column a caller names.
- The type is the registry only; genre and city are trimmed, capped at 120, blank clears.
- The city follows the fact text rule: no markup, no control characters, no hidden marks.

### tests/unit/manager-tools/seo/seo-facts.test.ts · 12 tests

How the Facts tab reads the stored facts back: the page says exactly what the live site's fact card states, and flags any stored value the save gate would refuse today.

- **Code:** src/lib/seo-facts.ts (readFacts, factErrors)
- **Tier:** STRICT (AGENTS.md "Test depth"): the page must never say a fact is on the card when the site would drop it.
- **Not here:** the save rules themselves (save-rules.test.ts); drawing the tab (tests/components/manager-tools/seo/facts-tab.test.tsx).

**Tests**

- A full set of facts reads back as stored, with the place joined and the country's code.
- Nothing set reads as empty, never as made-up values.
- The city alone is the place.
- A visual artist keeps the year on the page, but it is not stated on the card.
- Null values from the table read as unset.
- The page says what the site states: for every combination, the same place, names and year as the bridge's fact card.
- Clean facts flag nothing (strictly: no field present at all).
- Each bad stored value is named by its field, in the gate's words.
- An artist with no name yet: other names are checked for everything but the name.
- A name taken by a rename is flagged (the card already drops it).
- A stored region is judged against the stored country; a country off the list is flagged.
- A city over its cap is flagged.

### tests/unit/manager-tools/seo/tabs-and-routes.test.ts · 8 tests

The SEO / GEO page has five tabs on the rail, each with its own page, the tool opens on Details, and every old section address still lands on the tab (and the row) that now holds it.

- **Code:** src/lib/manager-tools/seo/sections.ts, tools/seo/[section]/page.tsx (the redirect route), _shell/tools-registry.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): nothing that worked may lose its home, and a bad address must be a 404, not a crash.
- **Not here:** where each test's pencil lands (test-tab-model.test.ts, "every pencil target").

**Tests**

- Five tabs, unique, Details first as the tool's own route, so the tool opens on it.
- The rail shows exactly these tabs for the SEO / GEO tool.
- Every tab has its own page on disk, so no tab is a dead link.
- A page.tsx in a folder that is not a tab is a stray route; under an old name it would win over the redirect route (Next matches a static folder first), so the redirect would never run.
- Every old section still has a home: it is a tab, or it redirects to one.
- The redirect route sends each moved section to its tab and row; anything else is a 404.
- The old Listing tab's address (Sam's bookmarks, old links) lands on Details, the tool's own page.
- An old address and a test's pencil for the same setting land on the same tab and row.

### tests/unit/manager-tools/seo/test-actions.test.ts · 11 tests

The SEO / GEO page's server actions check that the caller is signed in and manages the artist FIRST, then run the tests, apply a fix, or read the results.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test-actions.ts (runSeoTestsAction, applySeoFixAction, readSeoTestsAction)
- **Tier:** STRICT (AGENTS.md "Test depth"): server actions (permissions), and the fix writes a link.
- **Not here:** the run itself (tests/unit/seo-tests/runs/running.test.ts); how the Test tab reads its data (tests/unit/manager-tools/seo/test-tab-model.test.ts); the Apple store rule itself (src/lib/seo-tests/apple-storefront.ts, with the SEO tests under tests/unit/seo-tests/).

**Tests**

- Who is asking: every action refuses a signed-out caller and a stranger before touching anything else. _(one per row of a table)_
- Test again: a manual run, written by the service role, read through the manager's own session.
- Refusals: each comes back with its reason and seconds beside the sentence, so the page never reads the words. _(one per row of a table)_
- Not switched on: the table missing (migration not pushed) is "off", not an error.
- Any other failed read is "error" with a plain sentence, never "off" or "never tested".
- Switched on: "ready" with the latest run, the history dots and any run in progress.
- The fix: only the Apple link, through the Connections door, left as a draft for the manager to publish.
- Only when offered: the US store is right only for a US-based artist, so the test must have flagged it.
- Now, not then: the new address is worked out from the link as it is now, never from the stored result.
- The link rules still apply: their refusal stops the fix, in their words.
- Nothing to fix, or an unknown fix: said plainly, nothing written.

### tests/unit/manager-tools/seo/test-tab-model.test.ts · 28 tests

The Test tab's rules: every count, headline, word and link the manager reads there, and how the tab tells "not switched on yet" from "couldn't read" from "never tested".

- **Code:** src/lib/manager-tools/seo/test-model.ts, test/load.ts (loadTestTab), lib/seo-tests/store.ts (isMissingTable)
- **Tier:** STRICT (AGENTS.md "Test depth"): the counts ("19 of 24", "5 need you"), the headline and the hrefs a stored result can reach are what the manager is told is true.
- **Not here:** drawing the tab (tests/components/manager-tools/seo/test-tab.test.tsx); the server action around the read (tests/unit/manager-tools/seo/test-actions.test.ts).

**Tests**

- Counts: `na` is out of both sides of "N of M"; unknown is neither a pass nor a fail.
- A malformed stored status counts nowhere, so it can never pass.
- Groups: four in page order, each counting ALL its rows whatever the filter.
- The filters: every scored row in exactly one, and the three add up to the score (every scenario).
- A missing result keeps its row, with no result, and is never a pass.
- Site didn't answer (timed out, or error 500): one sentence, never a score, no rows.
- The run's own `reach` comes first, and each way of not answering has its own words.
- "Answered" wins over the statuses rule; an older run with no `reach` falls back to it; no site outranks all.
- A site that answered is never called unreachable, whatever else is wrong with it.
- The rule reads statuses only: rewording every sentence changes nothing.
- MusicBrainz is asked about the artist, not the site (SITE_FREE_TESTS): its pass is no sign the site answered.
- The score: "N of M tests pass", never "All M", with need-you and couldn't-check beside it.
- No site, none apply (0 of 0) and nothing checked each have their own words, never a score.
- Leads: each status has its own; a pass reads plain with a capital.
- Times read in the manager's day: today, yesterday, or a date.
- Stale: a run that saw an old site, or a publish run that couldn't confirm the new one.
- "May not have updated" lasts an hour; a run over 30 days is called old; a moved site is noticed.
- The cool-down: 60 s after the last run started, and a clock an hour behind never reads "3660 s".
- A refusal is read from its reason, never its words (and a silly wait is capped).
- An older server with no reason: told apart by its words.
- Outside links: https or nothing (javascript:, http:, data:, protocol-relative all refused).
- "Check it yourself" links: beside the test they check, all https, on the tested address.
- Every pencil lands on a real SEO tab or dashboard route.
- "No such table": PostgREST's and Postgres's words for it, and nothing else (a denied read is not "off").
- The table missing (the migration isn't pushed) is "off"; a denied read is "error"; an empty table is "never tested".
- WHAT WE SAW: consecutive rows with the same label show it once (repeat), a label that comes back later is said again.
- Stored evidence is untrusted: anything that isn't a list reads as none, and each odd row becomes plain strings (never dropped silently mid-list, never an object).
- The running clock reads minutes:seconds from whole seconds, and never goes below 0:00 (a browser clock behind the server's).

## SEO / GEO saved runs (database)

Check runs saved in the hosted database. These talk to the live project.

### tests/integration/seo-tests/seo-test-runs.test.ts · 21 tests

In the real database, a manager's session can READ its artist's test runs and nothing else; the two service-role functions are the only way to write one, and they enforce cool-downs, coalescing, per-person limits, the size cap, retention and immutability.

- **Code:** supabase/migrations/20260929140000_seo_test_runs.sql (the seo_test_runs table, its RLS and grants, seo_test_claim, seo_test_finish) and 20261001120000_seo_test_crawl.sql (the `crawl` column, its check, seo_test_finish + p_crawl), through src/lib/seo-tests/store.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): RLS, grants and stored data. Every denial has a planted witness (rule 2), every refused write is checked by row STATE through the service client (rule 3), and every row lives on a throwaway artist (rule 6): never Skeen, never the seed artists' data.
- **Not here:** the 5-minute "abandoned run" sweep and the hourly per-person ceiling (30): ran_at is stamped by the database so a client can't backdate a row, and 30 real runs are too slow for this suite; both were checked on a throwaway local Postgres. Likewise "a new run never starts with a crawl" and "a running run cannot gain one": no API role can insert or update the table, so only the owner could try (checked locally, 2026-09-30). The TypeScript side of each rule: tests/unit/seo-tests/runs/storage.test.ts.

**Tests**

- Reading: the manager sees its runs, and the database (not the client) worked out the score.
- No forging: a manager can't insert a finished run or a "publish" claim that skips the cool-down.
- No rewriting: update and delete are refused and the row is unchanged.
- No write functions: a manager can call neither, so no forged results and no prune by 35 claims.
- Isolation: another manager reads none of this artist's runs (the witness proves there are some).
- Anon: no reads and no claims for someone who isn't signed in.
- Only through the functions: even the service role can't insert or delete rows directly.
- The person is checked: a claim in the name of someone who doesn't manage the artist is denied.
- Cool-down: a manual run within 60 s of the last is refused, with the seconds left.
- Publish runs: one per publish and one per 60 s, never a way around the cool-down.
- One at a time: three clicks at once make exactly one run; the others are "busy".
- Per person: at most 2 runs at once across all their artists.
- Immutable: finishing a finished run again changes nothing.
- Reach: stored as given; a malformed one is refused by the table's own check.
- The size guard: results over 256 KB (bytes) are refused, and the run can still be marked failed.
- Retention: the newest 30 runs per artist are kept, the oldest pruned.
- Stored and shown: finishRun stores the crawl with the run, and the manager's own session (RLS) reads it back whole. The ROW is checked too: finishRun retries without the crawl when the call with it fails, so `ok: true` alone would not prove the crawl was stored.
- A failed run keeps none: the finish is handed a crawl the table would take (no error: the call reached the row), and the row still has no crawl.
- Immutable: once finished, the crawl is fixed. Finishing again answers false, and neither a manager nor the service role can write the column directly (42501); the row is unchanged.
- The door: the new seo_test_finish (with p_crawl) is service-role only. The call names p_crawl, so before the push it would be PGRST202 and fail here, never pass as "denied".
- The table's own check: over 64 KB counted in BYTES, or not an object, is refused (23514) and the run is still running. Straight through the function: capCrawl would have cut it. Then finishRun with the same crawl stores the run, its robots text cut (capCrawl, step 1).

## SEO / GEO page (database)

What the SEO/GEO page keeps in the hosted database: the Profiles tab’s marks and the bios it reads. These talk to the live project.

### tests/integration/manager-tools/seo/bios-load.test.ts · 1 test

In the real database, the Outside bios loader tells a fact a snapshot doesn't CARRY from one it carries as empty, so a fact joining the profile snapshot never marks every ticked bio stale.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/profiles/bios-load.ts (`data->f::text`, factsOf), src/lib/manager-tools/seo/profiles/bio-state.ts (factChanges)
- **Tier:** STRICT (AGENTS.md "Test depth"): it decides what the artist is told to go and redo, and only the hosted PostgREST can say what `data->f` answers for a missing key (null, the same as a JSON null: the bug) and what `data->f::text` answers (null vs the text 'null').
- **Not here:** every other factChanges rule (tests/unit/manager-tools/seo/bio-state.test.ts).

**Tests**

- A fact the snapshot did not carry is not an edit; only the real PostgREST can say carried-null from missing.

### tests/integration/manager-tools/seo/profile-marks.test.ts · 15 tests

In the real database, an artist's profile marks ("Mark as sent" and the outside bios' "updated" ticks on the SEO tool's Profiles tab) are readable and writable by that artist's managers only, carry a stamp the database sets, and accept only the items the app knows.

- **Code:** supabase/migrations/20261001150000_profile_marks.sql (the table, its RLS policies, its grants, the CHECK, the cascade); 20261001160000_profile_marks_bios.sql (the widened CHECK, the UPDATE policy + done_at grant, the profile_marks_stamp trigger); src/lib/manager-tools/seo/profiles/marks.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): RLS, grants and isolation. Every denial has a planted witness (rule 2), every refused write is checked by row STATE through the service client (rule 3), and every row lives on a throwaway artist (rule 6).
- **Not here:** the same rules first checked, and each broken once, on a throwaway local Postgres (2026-09-30; the re-confirm rules 2026-10-01: dropping the trigger, the UPDATE policy or the column-only grant each turned a check red). Note from the first run: an insert with an explicit conflict target, which is what setProfileMark sends, ALSO applies the SELECT policy to the new row, so a denial through it does not prove the INSERT policy. The "cannot add" test below therefore sends a PLAIN insert, which reaches the INSERT policy alone.

**Tests**

- The positive control: manager A's own mark is stored, stamped with A, and read back.
- Unticking removes the row, so a mark can always be taken back.
- Isolation: a planted mark on artist A is invisible to manager B, through the table and the app's read.
- The positive control is the first test: manager A's own insert succeeds.
- A denied DELETE is row-filtered: no error, zero rows. Only the row state can tell.
- NO_GRANT, not just 42501: with the revoke cut down to `from public`, anon's insert is still 42501 (from RLS) and its select returns an empty list. Only the wording tells them apart.
- The column grant keeps the stamp honest: a manager cannot forge who marked it or when.
- The widened CHECK, through the app's own write (the positive control for the CHECK test).
- Re-confirming an old mark restamps it: the date says when it was last checked, by whom.
- The trigger, not the grant, keeps the date honest: done_at IS updatable, so a direct update with a chosen date reaches the row (done_by changing proves it did) and is restamped. Both directions: a "never earlier than now" trigger would pass the past and fail the future.
- UPDATE is granted on done_at alone: the name on a mark and the artist it belongs to stay put.
- A denied UPDATE is row-filtered (no error): only the row state, unchanged, proves it. LIMIT: a filtered update reads the row, so the SELECT policy filters it too, and this cannot tell a broken UPDATE policy (`using (true)`) from a good one. Only an UNFILTERED update reaches the UPDATE policy alone, and here that would also restamp manager B's real marks on the seed artist (rule 6), so that probe ran on the local Postgres only (2026-10-01: a `using (true)` policy let it rewrite the other artist's row).
- No grant for anon: a signed-out caller cannot re-confirm a planted mark, and the row stays as it was.
- Through the service role, which bypasses RLS and holds every grant: only the CHECK is left.
- deleteThrowawayArtist clears nothing here and relies on the cascade.

## Safe fetching

Every time the server fetches an address someone else chose: where it may go, how much it reads, how long it waits.

### tests/unit/safe-fetching/blocked-before-connecting.test.ts · 17 tests

A fetch to a private address is refused before any connection opens, whichever server code sends it, including a name that looked public a moment earlier (DNS rebinding).

- **Code:** src/lib/net-guard.ts (createSafeFetch, pickTransport), src/lib/guarded-fetch.ts (guardedFetch), src/lib/indexnow.ts (pingIndexNow), src/lib/seo-tests/evidence.ts (gatherSiteEvidence), src/lib/og.ts (fetchOpenGraph)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. The text check alone let `169.254.169.254.nip.io` reach the cloud metadata service (security review 2026-09-29), because callers handed the name to the global fetch, which resolves it again, unchecked.
- **Not here:** which addresses count as private (private-addresses.test.ts); redirects to a private address (redirects.test.ts); what a fetch that IS allowed sends and brings back (requests-and-answers.test.ts).

**Tests**

- The loopback server really is reachable, so "no connection" in the tests below means the guard stopped it, not that the server was never there.
- A name that resolves to a private address is refused after one lookup, with no socket opened.
- DNS rebinding: a name answers PUBLIC to an earlier check and PRIVATE when the socket asks. Only the check the socket itself uses sees the second answer, and it refuses.
- A private IP written as the host (in any spelling Node accepts) never reaches a lookup, so the transport judges it itself before connecting.
- A name that does not resolve sends nothing, and the caller gets the DNS error.
- An international name (bücher.test) is looked up in its ASCII form (xn--…), and judged like any other name.
- Only http(s) is fetched, and never an address carrying a user name or password.
- The tests-only loopback hatch opens loopback and nothing else: the metadata address and private ranges stay refused even with it on.
- A private first address (by its text: the metadata IP, localhost, an odd port, a file) is answered `not-public` and nothing is sent at all.
- The nip.io trick through the whole SEO fetcher: `not-public`, after exactly one lookup.
- Every private family a DNS record can name (IPv4, IPv6, IPv4 inside IPv6, carrier NAT, link-local), alone or next to a public address, comes back `not-public` through the real transport.
- A name that does not resolve is a plain `network` failure (the check then says "unknown"), and nothing is sent.
- A caller that passes the global `fetch` would resolve the name again, unchecked: it is treated as "no fetcher" and the safe transport is used instead.
- Hosts that are really 127.0.0.1 in disguise (decimal, hex, octal, full-width digits, mapped IPv6) are refused by their text, before any lookup.
- The IndexNow ping reads the site's key file and sitemap: both go through the safe transport.
- The SEO checks' site visit records the page as not fetched, with the `not-public` reason.
- The Add modal's link preview checks the name first (answer 1: public), then fetches; the fetch's own lookup (answer 2: private) is the one a socket would use, and it is refused.

### tests/unit/safe-fetching/private-addresses.test.ts · 30 tests

The server knows which addresses belong to its own network (loopback, private ranges, the cloud metadata address) and refuses them, whether it is handed a web address, an IP, or a name.

- **Code:** src/lib/custom-site.ts (isPublicSiteUrl, isCustom), src/lib/net-guard.ts (isPrivateAddress, resolvePublic, isBlockedAddressError, guardedLookup)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. A manager types the site address and the server fetches it, so a private address here is a request into our own network (SSRF).
- **Not here:** that fetches really use these rules before connecting (blocked-before-connecting.test.ts), and on every redirect hop (redirects.test.ts).

**Tests**

- Private targets are refused however they are spelled: this list is every trick that has reached a server fetch somewhere, and the server echoes what it fetches back to the manager.
- `http://www.example.com@169.254.169.254/` READS as the public host and GOES to the private one: the guard must judge the host the browser would really use.
- An odd port on a public host is refused: otherwise the check becomes a port scanner for anyone who can type an address. 80 and 443 are what a site runs on.
- The sites this app really connects to still pass: a guard that refuses everything would make every refusal above meaningless.
- Anything that is not an http(s) address with a host (a script link, a file, a bare path, no value at all) is refused rather than guessed at.
- The same rule on the way IN: a private custom site address is not a usable site, which closes both the server fetch and the public 308 redirect to it with one rule.
- Local sites (`npm run site:custom -- skeen http://localhost:3001`) need loopback. The hatch is an explicit argument, never "not production": vitest runs with NODE_ENV='test', so an env-sniffing hatch would open inside this very file and make every refusal above pass for the wrong reason.
- Asked for on purpose, loopback in each spelling passes.
- The hatch opens a developer's own machine and nothing else: the metadata address and private ranges never become safe because a caller is in development.
- Every IPv4 block that is not the open internet is refused, at both ends of each block.
- IPv6 has its own private ranges, and several ways to wrap a private IPv4 inside an IPv6 address (mapped, compatible, NAT64, 6to4, Teredo): each wrapping is unwrapped and judged.
- Something that is not an address at all (a name, a short or long dotted form, a bare number) is refused: the rule never guesses what an odd answer meant.
- Real public addresses pass, including the ones just outside each refused range and IPv6 that only LOOKS like a special form: the rule must be exact, not generous.
- A name that points only at the internet comes back with every address, each with its family.
- `169.254.169.254.nip.io` looks like any public name but resolves to the metadata address: the text rule passes it, so the resolved address must be judged.
- One private address among public ones is still refused, wherever it sits in the list: the socket may pick any of them.
- A name that does not resolve, or resolves to nothing, is an error (ENOTFOUND), never an empty "yes"; and it is not mistaken for a refusal.
- A resolver is not trusted to be sane: a name instead of an address, null, a number or an empty entry is refused, and never crashes the check.
- A resolver's own error keeps its code (EAI_AGAIN says "try again"); anything else it throws becomes ENOTFOUND, so callers can always tell "no answer" from "refused".
- The family (IPv4 or IPv6) is read from the address itself, not from what the resolver claims, so a lying resolver cannot steer the socket.
- An IP typed as the host is judged as it stands, and DNS is never asked about it.
- `2130706433` and `0x7f.1` are not IP literals to Node, but the system resolver reads both as 127.0.0.1: they go to the resolver, and what comes back is judged.
- `metadata.google.internal.` (with the final dot) is the same name as without it, and is judged the same way.
- A refusal is recognised however deep Node wraps it ("fetch failed" → cause → cause), and by its code after a copy; nothing else is mistaken for one.
- An error whose causes loop back on themselves ends the search instead of spinning forever.
- Node asks for every address at once (Happy Eyeballs): it gets exactly the checked ones.
- Asked for one address, it honours a requested family, spelled as a number or as text.
- In every shape, a name with a private address gives the socket an error, never an address to connect to.
- The tests-only hatch lets exactly the loopback answers through; every other private answer is still refused.
- Asking for IPv6 from a name that has only IPv4 is "not found", not an empty list the socket would choke on.

### tests/unit/safe-fetching/redirects.test.ts · 10 tests

Redirects are followed by hand, one hop at a time, so every hop is checked like the first address; a redirect loop ends, and each redirect's body is let go.

- **Code:** src/lib/net-guard.ts (createSafeFetch never follows), src/lib/guarded-fetch.ts (guardedFetch walks the hops)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. A public site can answer 302 to `http://169.254.169.254/`, so a fetcher that follows redirects on its own undoes every check on the first address.
- **Not here:** the refusal of a private FIRST address (blocked-before-connecting.test.ts); the time limit on a slow chain of hops (size-and-time-limits.test.ts).

**Tests**

- Even asked to follow, it hands the 3xx and its Location back, so the caller checks the next hop.
- A public page that redirects to the metadata address: refused, and the metadata address is never asked.
- A redirect to a NAME that resolves privately is refused when the transport connects: the first hop comes from the fake web, the second goes through the real safe transport.
- Every request is sent with `redirect: 'manual'`, and a normal chain (http → https → /home) still arrives, two hops later.
- Two pages redirecting to each other stop after 3 hops (4 requests), with a reason.
- The caller's own rule (here: example.com only) is applied to the first address and to every redirect target, before anything is sent to it.
- A 3xx with no Location to follow is reported as that answer (`bad-redirect`), not a crash.
- Each redirect's body is cancelled as the walk moves on, so no connection is left half-read, including a redirect with no Location.
- Cancelling one copy of a cloned response only settles once the other copy is cancelled too, so a walker that WAITS for the cancel hangs forever on a clone (a caching fetch clones).
- A redirect whose target is then refused still has its own body let go.

### tests/unit/safe-fetching/requests-and-answers.test.ts · 11 tests

A fetch the guard allows behaves like a normal fetch: it sends the right name, headers and body, hands back the answer (unzipped), and turns any failure into a value instead of a crash.

- **Code:** src/lib/net-guard.ts (createSafeFetch: the bridge from node:http to a web Response), src/lib/guarded-fetch.ts (guardedFetch: what it sends and returns)
- **Tier:** STRICT (AGENTS.md "Test depth"): security code, and the SEO/GEO checks read their evidence (a bot's 403 page, a share picture's bytes) from exactly what this returns.
- **Not here:** refusals (blocked-before-connecting.test.ts, redirects.test.ts); caps and timeouts (size-and-time-limits.test.ts).

**Tests**

- The request goes to the checked address but names the site in its Host header, so the right site answers; status, headers, body and url come back as fetch would give them.
- Compressed answers are unzipped as fetch does (the encoding header stays); an encoding it does not know is passed through untouched rather than garbled.
- By default it accepts anything, compressed; a caller's own Accept headers win.
- A HEAD answer and a 204 have no body at all (null), as fetch gives them.
- A Request object works as the input: its url, method and headers are what is sent.
- Text, form, byte and ArrayBuffer bodies are sent with their length (a form gets its type); a stream body is refused before any connection opens.
- Something that is not an address at all is a TypeError, as fetch gives it.
- The bot tests visit as GPTBot, ClaudeBot and the rest: the exact User-Agent given is sent, and Tapir's own check name when none is given.
- A 403 page is evidence (which firewall blocked the bot), so its body and headers are kept, with header names in lower case.
- Asked for bytes (a share picture), it returns the bytes and no text.
- A dropped connection, or a fetcher that throws something that is not even an Error, is reported as `network`: guardedFetch never throws, so a check says "unknown", never crashes.

### tests/unit/safe-fetching/size-and-time-limits.test.ts · 13 tests

Nothing the server fetches can fill its memory or hold a request open: every read stops at a byte cap, and every fetch ends at its time limit.

- **Code:** src/lib/guarded-fetch.ts (guardedFetch: maxBytes, timeoutMs, deadlineMs), src/lib/indexnow.ts (pingIndexNow's reads), src/lib/og.ts (fetchOpenGraph), src/lib/net-guard.ts (createSafeFetch: idle timeout, abort signal)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. The transport unzips, so a few hundred KB on the wire can be gigabytes in memory, and a body that drips a byte at a time can hold a request open forever (security review 2026-09-29, F3).
- **Not here:** parsers that are slow on hostile text (slow-parsers.test.ts); the SEO checks' own run budget across many pages (tests/unit/seo-tests).

**Tests**

- A 64 MiB answer is cut at the cap and only a chunk or two past it is ever pulled: a reader that took everything and cut afterwards would pass a length check, but not this one.
- An answer with no stream (only a whole buffer) is capped too.
- The IndexNow ping reads a manager's site on every Publish, with no cap of its own: the shared default (2 MiB) must still stop it. A 64 MiB key file is cut, so it is not the key.
- The link preview stops at its 512 KB cap and still reads the share tags at the top of the page.
- A server that never answers is given up on at the timeout, reported as `timeout`.
- A transport that does not tie its body to the request's signal (a fake, a wrapper that drops it) must not let a dripping body hold the read open: the reader races the signal itself.
- The link preview ends a dripping body at its timeout, with no preview.
- Three slow hops each fit their own timeout (the chain arrives), but a deadline ends the whole walk: without it, a four-hop chain could take four timeouts.
- The deadline also cuts one slow hop short, not only the gaps between hops.
- A deadline of zero or less means "no time left": nothing is sent.
- A connection that stops sending is dropped after the idle time, so reading its body fails.
- The caller's abort signal stops a body that never ends, promptly.
- A signal that is already aborted sends nothing, and the error is an AbortError that keeps the caller's own reason.

### tests/unit/safe-fetching/slow-parsers.test.ts · 12 tests

The readers that run on a site's fetched text finish quickly even on the worst text a hostile site can serve, and still read normal pages exactly as before.

- **Code:** src/lib/seo-tests/fresh.ts (sitemapLastmods), src/lib/seo-tests/html.ts (parsePage, linkKey), src/lib/url.ts (trimTrailingSlashes), src/lib/seo-tests/shared.ts (the preview check), src/lib/seo-tests/musicbrainz.ts (musicBrainzForms)
- **Tier:** STRICT (AGENTS.md "Test depth"): security, and parsers of outside text. A regex that backtracks runs on the one JavaScript thread, where no timeout can stop it: a 32 KiB sitemap took 27 s and a 1 MiB page ~153 s, and every other request waited meanwhile (security review 2026-09-29, F4).
- **Not here:** byte caps and time limits on the fetch itself (size-and-time-limits.test.ts); what each reader finds on a normal page (the SEO checks' own tests under tests/unit/seo-tests).

**Tests**

- The reviewer's input: `<lastmod>` and a long run of spaces, repeated to the cap (was 27 s at 32 KiB).
- The other shapes that make a lazy match rescan: a tag never closed, a `<` inside, tabs.
- The fix changed no reading: the recorded sitemaps give exactly the recorded dates.
- The reviewer's ~153 s input: `<a href="` never closed, repeated to the 1 MiB cap.
- Every other way a tag can fail to close (open quote, missing `>`, a lone `<`).
- Script, style and title elements that never close, and a 5,000-letter tag name.
- The fix changed no reading: the recorded pages (normal and merely broken html) parse exactly as recorded.
- Trimming the slashes off the end is linear on a megabyte of slashes, and trims only the end.
- The key a page's stated link is compared by, on a path of a megabyte of slashes.
- The preview check on a share link (og:url) whose path is a megabyte of slashes, on the site's OWN host (on another host the path is never looked at: "another site" wins first).
- A Tidal address with 100 labels (the old pattern nested two quantifiers), with and without a path.
- The fix still cleans a real Tidal link to the form MusicBrainz lists.

### tests/unit/safe-fetching/_loopback-server.ts · support file

A real web server on this machine, used as a witness by the safe-fetching tests.

- **Code:** none (a test helper); serves tests/unit/safe-fetching/*.test.ts
- **What it provides:** • one http server on 127.0.0.1, on a free port, per test file • a count of connections: "refused" in a test then means no socket reached the server, not merely that a promise rejected • the last request it got (method, Host header, headers, body) • a few fixed answers: /redirect (302 to evil.example), /gzip, /deflate, /br, /weird-encoding (an encoding nobody knows), /empty (204), /slow (sends a little, then never finishes); anything else is a small html page with an X-Thing header

### tests/unit/safe-fetching/_parser-corpus.ts · support file

Small malformed pages and sitemaps, with the answers the OLD regex readers gave, so the faster readers can be held to reading them exactly the same.

- **Code:** support file (not a test): feeds tests/unit/safe-fetching/slow-parsers.test.ts, which reads these with src/lib/seo-tests/html.ts (`parsePage`) and fresh.ts (`sitemapLastmods`)
- **What it provides:** • PAGES: 30 small broken pages (unclosed tags and quotes, tags in scripts and comments, odd spacing and capitals, entities) • SITEMAPS: 10 small broken sitemaps (spaces, unclosed tags, CDATA, capitals) • RECORDED: what the old regex readers returned for each, recorded 2026-09-29 before the linear rewrite

## Search engines (Google and Bing)

Registering an artist’s site with Google and Bing, and resending its sitemap to Google after a publish.

### tests/unit/search-engines/address.test.ts · 14 tests

The one address a site is registered under at Google and Bing, worked out once.

- **Code:** src/lib/search-engines/address.ts (registrationForm, resolveSiteAddress)
- **Tier:** STRICT (AGENTS.md "Test depth"): a parser of addresses that end up as a Search Console property and a Bing site, in the database's site_url CHECK, and in every URL Inspection call. Registering the apex of a site that redirects to www verifies fine and then quietly fails every sitemap and inspection call, so the FINAL address after redirects is the one kept.
- **Not here:** the guarded fetch itself (tests/unit/safe-fetching/).

**Tests**

- The one shape every provider call and the database agree on.
- The longest address the database takes is 300 characters; one more is refused.
- Not text at all: refused, never a crash.
- Anything Google or Bing shouldn't be told about, or the database would refuse.
- The code's shape IS the database's: read from the migration, so the two can't drift.
- Whatever comes in, what comes out is either nothing or an address the database accepts.
- Skeen: the apex 308s to www, and www is what gets registered.
- Already the final address: nothing moves.
- A site that forwards to someone else's (a link page, a store) is not this artist's site.
- Lookalikes and other subdomains are other sites: only the name itself, with or without www.
- www → apex is the same site too.
- A site that doesn't answer can't be registered yet; say so.
- A redirect with nowhere to go (no Location) is not a site answering.
- Nothing is fetched for an address that can't be registered.

### tests/unit/search-engines/bing.test.ts · 18 tests

Tapir's Bing account adds and verifies a site: the exact calls, and the key never leaks.

- **Code:** src/lib/search-engines/bing.ts (bingClient)
- **Tier:** STRICT (AGENTS.md "Test depth"): Bing's API key rides in every request URL (`?apikey=`) and belongs to Sam's Bing account, which will hold every client site. It must never reach a return value, a reason, or Bing's message passed on to the operator. The calls are Bing's JSON API (SOAP/POX were retired 2026-08-31).
- **Not here:** the order of the steps and what is stored (register.test.ts).

**Tests**

- AddSite: POST with the site in a JSON body; the key only in the query string.
- VerifySite answers { d: true } when Bing found the tag.
- { d: false } is Bing saying "not yet", not a success.
- SubmitFeed is how a sitemap reaches Bing (there is no SubmitSitemap).
- GetUserSites lists every site on the account; ours is matched however Bing spells it.
- Bing's spellings of the same site: a trailing dot on the host, extra slashes; junk entries skipped.
- A different path on the same host is a different Bing site.
- A site Bing doesn't list, or a code that isn't 32 hex, is refused: it would never render.
- A wrong or revoked key.
- Bing's message: the key replaced by <key>, cut to 200; an answer that isn't JSON has none.
- A 200 with an empty body is still Bing saying yes (AddSite and SubmitFeed answer { d: null }).
- Each step's own reason, and Bing's message passed on with the key blanked out.
- No answer at all is not Bing refusing; and a thrown error's text never leaks the URL.
- A GET with the site and the page in the query, the key beside them, no body.
- The .NET date form: the number is milliseconds since 1970 in UTC, and the "+hhmm" after it only says which zone the value was local to (Microsoft's DataContractJsonSerializer docs). So the same number is the same moment whatever the offset: applying the offset again would move the date by hours.
- "Never crawled" comes back as .NET's DateTime.MinValue (year 1) or no date; a status of 0 is "no answer recorded". Both are null, never a date or a status nobody saw.
- No url info at all is a failure, not "never crawled".
- Refusals: a page not on the site is bing_urlinfo, a refused key bing_auth; the key never rides along.

### tests/unit/search-engines/google.test.ts · 36 tests

Tapir's robot account signs in to Google and registers a site: the exact calls, and nothing leaked.

- **Code:** src/lib/search-engines/google.ts (googleCredsFromEnv, googleClient)
- **Tier:** STRICT (AGENTS.md "Test depth"): a service-account key that owns every client site in Search Console, and calls that make Tapir a site's verified owner. The request shapes are Google's own (Site Verification API v1, Search Console API v3); the key never appears in anything a caller can print or store.
- **Not here:** the order of the steps and what is stored (register.test.ts).

**Tests**

- The env holds the JSON key base64-encoded (put there by Sam's one-line command).
- A missing or broken key is "not set up", never a crash. The check is a boolean on purpose: a failing `toBeNull()` would PRINT whatever came back, and if that were ever a real key it would land in the test output (it did once, 2026-09-30).
- A JWT-bearer grant for exactly the two scopes, signed with the robot's key, stamped in SECONDS.
- Exactly at the edge (a minute before expiry) a fresh token is fetched.
- One sign-in serves every call until a minute before it expires, whatever Google said its life was.
- A token Google stops accepting (revoked, clock skew) is dropped and the call tried once more.
- Only ONE retry: a Google that keeps saying 401 gets two tries, then the step's own reason.
- A refused sign-in is its own reason, and the key never rides along in it.
- A sign-in answer with no token is a refusal too, and nothing more is sent.
- No answer from the sign-in: google_network, and the API is never called with no token.
- The sign-in is a form post.
- Google's message is passed on clean and short: no control characters, at most 200 characters.
- A key that can't sign fails as google_auth before anything is sent, and never throws.
- Every request has a time limit, so a hung Google can't hang a registration.
- Google's documented request for a site's meta-tag token.
- Google's docs don't say whether `token` is the whole tag or only its value: both work, as do single quotes, spaces around "=", and whitespace around a bare value.
- Google refusing to give a token is its own reason.
- Only a value the bridge would render is kept: anything else never reaches the database.
- Verifying with the owner in the same call makes Sam a (delegated) owner at once.
- If Google's answer doesn't list the owner, they're added with an update: Google's list plus them.
- Google may give the id already encoded: it is encoded once in the path, never twice.
- Already listed (any case): no update is sent.
- Only real email strings in Google's list count; junk entries are dropped from the update.
- No owner list at all in Google's answer: the owner is added.
- Verified but no resource id to add the owner to: said as google_owner, nothing more sent.
- The owner update refused: its own reason, so the run says the owner is missing.
- The property goes in the robot's Search Console: the site URL is a path segment, encoded.
- The sitemap URL is its own encoded segment.
- Each step fails with its own reason, and Google's short message for the operator.
- Signed in, then the API call itself times out: still google_network, not a refusal.
- No answer at all is not Google refusing.
- The documented call: POST index:inspect with the page and the property it belongs to, authorised like every other call.
- A page Google has never seen: its answer leaves the crawl time out. Missing or junk fields are null, never a made-up value, and a time that isn't a time is null too.
- Google's strings are shown as text, so a runaway one is cut rather than stored whole.
- An answer with no inspection result at all is not "Google knows nothing": it is a failure.
- Google refusing (a property the robot doesn't own, the daily quota) is its own reason.

### tests/unit/search-engines/register.test.ts · 26 tests

Registering a site runs its steps in order, stops safely, and never leaves a wrong artist holding a site.

- **Code:** src/lib/search-engines/register.ts (registerSite, metaTags, tagsLive)
- **Tier:** STRICT (AGENTS.md "Test depth"): this decides which artist a site is attached to and what Tapir claims at Google and Bing. The plan's rules, and the post-push audit's: connect LAST (after this artist's codes are seen live), upsert so a rerun is clean, remove what a failed run created, never register an address another artist holds.
- **Not here:** the Supabase store's queries (tests/integration/site/site-register-store.test.ts); the Google and Bing calls themselves (google.test.ts, bing.test.ts).

**Tests**

- Attribute order and quote style vary by framework; both must count.
- Google and Bing read <head>: a tag in the body doesn't count; tag and attribute case don't matter.
- Tags without a name or content (charset, viewport, property=…) don't confuse it.
- `data-name` / `data-content` are other attributes: they neither stand in for name and content nor hide the real ones written after them.
- The wrong code, a missing tag, or no page at all is not live.
- The whole run, in the plan's order; the owner email reaches Google; the sitemap is the site's own.
- It waits for ISR: keeps looking until the tags appear, then goes on.
- A typo or the wrong artist: the codes never show, so nothing this run made may stay behind.
- A rerun at a WRONG address (a typo) must not drag older rows onto it: they go back as they were.
- Ctrl-C mid-wait, or a call that throws before the tags are seen: the rows go back exactly as they were (no typo'd address held, an older row's verified time not lost), nothing connected.
- A row that existed before this run is kept (it may be live elsewhere) and marked not_live.
- A row that existed before this run is kept (it may be live elsewhere) and marked not_live.
- "Try again": the same codes keep their verified state; a new code resets it until re-verified.
- Same code at a NEW address (the site moved) also un-verifies until it is verified there.
- Another artist already holds this address: stop before any code is made or stored.
- A bad or unreachable address: nothing is asked of Google or Bing.
- Google refusing never stops Bing, and the refusal is stored as its code.
- Ownership proven but the sitemap refused: verified, with the reason kept for a retry.
- A site already on the Bing account: AddSite is refused (AlreadyExists), the code is still read.
- Both refused: AddSite's reason is the one shown (it came first and explains the rest).
- Bing's code refused (AddSite fine, no code): Bing is left out, never stored with no code.
- Google's code is made for this site alone; Bing's is the same on every site of the account, so another artist's page showing it proves nothing. No Google code (no key, or Google refused): nothing stored, Bing not asked, nothing connected.
- A provider with no credentials is skipped entirely, and the other runs on its own.
- Skeen is already connected at this address (the column has no trailing slash, or has one; any case): not rewritten.
- Connected elsewhere, or on the built-in template at this address: connected to THIS site.
- Six or seven looks in a minute: the wait for the tags never turns into a tight loop against the site.

### tests/unit/search-engines/resubmit.test.ts · 5 tests

After a publish that changed a page's words, the sitemap is resent to Google: only for a site Tapir registered, never failing the publish.

- **Code:** src/lib/search-engines/resubmit.ts (resubmitSitemap, scheduleSitemapResubmit, the two real loaders); wired in actions.ts publishGated (pinned in tests/unit/seo-tests/runs/publish-hook.test.ts)
- **Tier:** STRICT (AGENTS.md "Test depth"): it uses the robot key that owns every client site in Search Console, reads a service-only table, and runs on Publish.
- **Not here:** Google's request shape for sitemaps.submit (google.test.ts); which publishes schedule it (publish-hook.test.ts).

**Tests**

- Only a VERIFIED Google registration at an https root is a Search Console property the robot owns. Anything else: Google is never asked, and the key is never even loaded.
- A registered site: ONE submit, of the property exactly as registered and its sitemap, after reading this artist's row through the service client.
- It runs after a publish that is already live: a refusal or a throw anywhere is an outcome.
- Scheduled for after the response; `after` refusing (outside a request) never reaches the publish; and what is logged is codes, never Google's words or an error's message.
- Tests load .env.local: a test that forgot to inject its own clients must never read the hosted database or send the real key to Google. With no deps at all, the call ends as an outcome.

## Stored logins

The sign-in tokens kept in the database’s locked store (Vault): each artist’s can be reached only through that artist.

### tests/integration/shopify/shopify-secret-binding.test.ts · 16 tests

A Shopify connection can only read, renew or delete the stored store token (in Vault) that belongs to its own artist, even if its pointer is aimed at another artist's.

- **Code:** supabase/migrations/20260929150000_shopify_secret_binding.sql (integrations grants, shopify_secret_bindings, shopify_credentials, shopify_store_for_slug, connect_shopify, disconnect_shopify, bind_legacy_shopify_secrets)
- **Tier:** STRICT (AGENTS.md "Test depth"): security and money. A manager could aim their own row's pointer at another artist's secret; the doors then DECRYPTED, OVERWROTE or DELETED it (security review 2026-09-29).
- **Not here:** the Eventbrite sign-in's own storage (tests/integration/sync/eventbrite-vault.test.ts); Shopify connect in the dashboard (tests/integration/sync/integrations.test.ts).

**Tests**

- Witness: before anything is tampered with, each owner reads their own token and the live shop reads A's, so every "reads nothing" below means the guard, not a broken setup.
- The hole itself: a manager aiming their own row's pointer at another artist's secret is refused, and the row and its token are unchanged.
- Nor can they change the store domain directly, skipping connect_shopify's check.
- Nor add a second row of their own that names someone else's secret.
- Nor delete their own row directly: the encrypted token would be left behind in Vault.
- The bindings table (which artist owns which secret) is out of a manager's reach both ways.
- Only the push runs the backfill; a manager cannot.
- Reading their own row still works: the dashboard shows the store domain from it.
- A's row aimed at B's secret reads nothing, through the manager's door or the live shop's.
- Remove through a pointer at B's secret deletes A's row only; B's token still reads.
- Connect through a pointer at B's secret never overwrites B's token; A gets a new secret.
- A Shopify row aimed at an Eventbrite sign-in reads nothing: each door reads only its own kind.
- Witness: a secret with no binding row reads nothing, so the binding really is the gate.
- The normal legacy case: one Shopify row points at the secret, so it is bound to that artist and reads again; a second run binds nothing more.
- Two rows reaching one secret (the second spelling it differently) means the owner is unclear, so nobody is bound and neither row reads it (security review F1).
- An Eventbrite sign-in is never bound to a Shopify row, even when that row is its only pointer.

### tests/integration/sync/eventbrite-vault.test.ts · 11 tests

An artist's Eventbrite sign-in is stored encrypted in the database's locked store (Vault), bound to that artist: only its own manager can read, renew or remove it.

- **Code:** supabase/migrations/20260929120500_eventbrite_integration.sql (connect_eventbrite, eventbrite_credentials, disconnect_eventbrite)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. A stored login is someone's password to their Eventbrite account.
- **Not here:** the Shopify twin (tests/integration/sync/integrations.test.ts); a manager being refused when rewriting the pointer at all (tests/integration/shopify/shopify-secret-binding.test.ts); the sign-in trip itself (tests/unit/manager-tools/connections/eventbrite-oauth*.test.ts).

**Tests**

- The row a manager can see holds a pointer and the organizer ids; the token appears nowhere in it, not even to the service role.
- The owner reads the token back: this is what the server-side pull of shows uses.
- Another artist's manager is refused, and the token is not in the refusal.
- A signed-out visitor cannot run any of the three database functions at all.
- Another artist's manager cannot connect, or swap the token of, an artist they do not manage.
- Organizer ids must be digits (they end up in an Eventbrite URL) and the token present; a refused connect changes nothing and never echoes the stored token.
- A's row pointed at B's secret (planted by the service role) reads nothing, and Remove through it leaves B's secret alone: the binding is a second lock on its own.
- What the live site receives never contains the token or even the pointer.
- Signing in again replaces the token in place: still one row, the same pointer.
- Remove deletes the row and destroys the encrypted token: putting the old pointer back finds nothing.
- Another artist's manager cannot remove someone else's sign-in.

## Eventbrite and YouTube sign-in

The “Connect with …” buttons: the sign-in trip, what it finds, and how the Connections page shows it.

### tests/components/manager-tools/connections/eventbrite-connect.test.tsx · 6 tests

When the Eventbrite app is set up, the Eventbrite row and its connection window offer a "Connect with Eventbrite" sign-in button above the paste field; when it is not, only the paste field shows.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx, connection-modal.tsx, connection-list.tsx
- **Tier:** LIGHT (AGENTS.md "Test depth"): UI still being designed. The main path works and the rules that matter hold, not every label or layout detail.
- **Not here:** what the start route does with the link (tests/unit/manager-tools/connections/eventbrite-oauth-routes.test.ts); how the page decides "set up" (connections-page-eventbrite.test.ts in that folder).

**Tests**

- Set up: the button goes to our start route, sits above the paste field, and names the organizer once a link is pasted; there is no Sync switch and nothing is saved here.
- The paste field still connects an organizer link the old way.
- Not set up: no button and no switch, just the paste field.
- The list passes "set up" on to the Connect window it opens.
- Set up: the connection's own window offers the sign-in for the organizer already linked.
- Not set up: the connection's own window has no button.

### tests/components/manager-tools/connections/youtube-connect.test.tsx · 5 tests

When the Google app is set up, the YouTube row offers a "Connect with YouTube" sign-in button above the paste field; when it is not, the row is the paste field alone.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx, connection-list.tsx
- **Tier:** LIGHT (AGENTS.md "Test depth"): UI still being designed. The main path works and the rules that matter hold, not every label or layout detail.
- **Not here:** what the start route does (tests/unit/manager-tools/connections/youtube-oauth-routes.test.ts); how the page decides "set up" (connections-page-youtube.test.ts in that folder).

**Tests**

- Set up: the button goes to our start route above the paste field, carries Sync off when it is unticked, is a real link the browser follows, and saves nothing here.
- The paste field still connects a handle the old way.
- Not set up: no button, just the paste field.
- With other services picked too, Connect runs them first; the blank YouTube row waits (not refused), and only then does the button show, so leaving for Google strands nothing.
- The list passes "set up" on to the Connect window it opens.

### tests/unit/manager-tools/connections/connections-page-eventbrite.test.ts · 4 tests

The Connections page tells the browser only whether the Eventbrite app is set up and whether a sign-in is stored (never the credentials or the token), and turns the sign-in's return code into words.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/connections/page.tsx (with shopify-return.tsx's EventbriteReturnNotice)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. page.tsx is where the server-only credentials meet the browser.
- **Not here:** the buttons themselves (tests/components/manager-tools/connections/eventbrite-connect.test.tsx); the words for each code (eventbrite-oauth.test.ts).

**Tests**

- Both credentials set: the list is told "on", and neither credential appears in any prop sent to the browser.
- Either credential blank: the list is told "off", so the button is hidden.
- A stored sign-in makes the row synced; not stored, it offers Sync when the app is on and is a plain link when it is off (no Sync chip that cannot work).
- Back from Eventbrite, the code becomes the notice above the list; without a code there is none.

### tests/unit/manager-tools/connections/connections-page-youtube.test.ts · 3 tests

The Connections page tells the browser only whether the Google app is set up (never its credentials), and turns the YouTube sign-in's return code into words.

- **Code:** src/app/artists/[id]/(dashboard)/(manager-tools)/connections/page.tsx (with shopify-return.tsx's YouTubeReturnNotice)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. page.tsx is where the server-only credentials meet the browser.
- **Not here:** the buttons themselves (tests/components/manager-tools/connections/youtube-connect.test.tsx); the words for each code (youtube-oauth.test.ts).

**Tests**

- Both credentials set: the list is told "on", and neither credential appears in any prop sent to the browser.
- Either credential blank: the list is told "off", so the button is hidden.
- Back from Google, the code becomes the notice above the list; without a code there is none.

### tests/unit/manager-tools/connections/eventbrite-oauth-routes.test.ts · 34 tests

The two Connect with Eventbrite routes: start sends only this artist's manager to Eventbrite, and the callback stores the token in Vault and nowhere else, saves the organizer link the way a paste would, and pulls the shows; any refusal saves nothing.

- **Code:** src/app/api/eventbrite/start/route.ts, src/app/api/eventbrite/callback/route.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): security (a sign-in token, another artist's page) and data (a failed re-connect must never delete a working sign-in).
- **Not here:** the rules these routes call (eventbrite-oauth.test.ts); the Vault functions themselves (tests/integration/sync/eventbrite-vault.test.ts); the pull (tests/unit/tour).

**Tests**

- An owner is sent to Eventbrite with our app key and an S256 challenge (no secret), and gets a signed, HttpOnly, Secure, short-lived cookie that only the callback can see.
- A pasted link's organizer id travels inside the signed cookie; anything that is not digits is dropped.
- Development on http://localhost works, and its cookie is not marked Secure (it could not be set).
- Any other plain-http address is never sent to Eventbrite, and gets no cookie.
- Nobody signed in goes to the login page, not to Eventbrite.
- A manager of another artist gets "not found" and no cookie.
- An artist id that is not an id (or none) is "not found".
- Without the app's credentials it goes back to the Connections page with a "not set up" code.
- The happy path, in order: the token is stored in Vault, the organizer link is saved the way a paste would be, then the shows are pulled; the code is traded with this trip's verifier.
- The token is kept in Vault and nowhere else: not in a URL, cookie, save, pull, redirect or log line.
- The state cookie is spent: cleared on the way out, so the trip cannot be replayed.
- Among several organizer pages, the one the pasted link named is the one connected.
- The whole trip works on http://localhost for development.
- A return carrying another trip's nonce saves nothing.
- A return after the time limit saves nothing.
- A trip finished in another manager's session, or after signing out, saves nothing.
- A manager who lost the artist during the trip saves nothing.
- No cookie, or one edited to name another artist, goes back to the dashboard (not to any artist's page) and saves nothing.
- A return over plain http (not localhost) saves nothing.
- Pressing Cancel at Eventbrite comes back as "cancelled", and no code is exchanged.
- Any other error from Eventbrite, or no code at all, saves nothing.
- Without the app's credentials nothing can be checked, so it goes back to the dashboard.
- Eventbrite refusing the code: nothing is read, stored or saved; the refusal is logged without any secret.
- No organizer page on the account: the token is not stored.
- Several pages and none named like the artist: ask for the link; the token is not stored.
- A pasted link whose organizer is not on the account: nothing stored.
- The account cannot be read: nothing stored.
- Vault refusing the token (with a message that echoes it): no link saved, nothing pulled, and the token still appears nowhere.
- On a FIRST connect, a link save that is refused or throws after the token was stored forgets the token again, and nothing is pulled.
- On a RE-connect, a failed link save puts the previous sign-in back and never deletes it: the stored token is renewed in place, so forgetting would destroy a working sign-in (security review 2026-09-29, L6).
- The previous sign-in is read before the new token overwrites it, or there is nothing to restore.
- If putting the previous sign-in back fails too, nothing is deleted: the new token stays.
- If the previous sign-in cannot be read, a failed save deletes nothing either: "unknown" is not "none".
- A first pull that fails reports it, and the connection stays so "Pull now" can retry.

### tests/unit/manager-tools/connections/eventbrite-oauth.test.ts · 32 tests

The pure rules of "Connect with Eventbrite": the signed note that ties a sign-in trip to one manager and one artist, the links and code exchange with Eventbrite, choosing the artist's organizer page, and the words shown on the way back.

- **Code:** src/lib/eventbrite-oauth.ts, src/lib/manager-tools/connections/services/eventbrite (eventbriteStartPath)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. Everything that decides whether a sign-in return is TRUSTED lives here.
- **Not here:** the two routes that use these rules (eventbrite-oauth-routes.test.ts); the stored token (tests/integration/sync/eventbrite-vault.test.ts); reading events (tests/unit/tour/eventbrite-events.test.ts).

**Tests**

- The app counts as set up only when both credentials are present (spaces trimmed); otherwise the Connect button is hidden.
- What the pages are told: a stored sign-in is "signed in"; with the app set up and nothing stored, "not yet"; with the app off and nothing stored, nothing at all.
- A trip may start only over https, or plain http on localhost for development; any other http (including a look-alike localhost host) is refused.
- The cookie carries the artist, the manager, the organizer hint, the nonce and the verifier back intact, and the challenge sent to Eventbrite is S256 of that verifier.
- An organizer hint that is not digits is dropped rather than carried into the trip.
- Two trips never share a nonce or a verifier, so one trip's return cannot finish another.
- A cookie edited to name another artist or organizer fails its signature.
- A cookie signed with a different secret is refused.
- A YouTube (or Shopify) cookie signed with the same secret is not an Eventbrite one: the signature is tied to its purpose, not just to the payload's shape.
- A return after the time limit is refused, but still names its artist so the page can say so.
- A correctly signed cookie with a wrong shape (any field missing, mistyped, or a verifier outside the PKCE alphabet) is still refused.
- The signature is compared in constant time, so its bytes cannot be guessed by timing.
- No cookie, or garbage, is refused without throwing.
- The matching return passes: the witness that makes each refusal below meaningful.
- A return with another trip's nonce, or none, is refused, compared in constant time.
- A return finished by another signed-in manager, or by nobody, is refused.
- The link to Eventbrite carries exactly our app key, redirect, state and S256 challenge, and never the secret.
- The Connect button's address carries the artist, plus the organizer id from a pasted link only when it is digits; the id comes out of the pasted link the same way it always has.
- The code exchange posts the code, app key, secret, redirect and verifier form-encoded, and does not follow redirects (the secret is in the body).
- A refused exchange throws with Eventbrite's error code, but never the code, secret or verifier.
- A success answer with no token, or a blank one, is a refusal too; spaces around a token are trimmed.
- An error field that is not a short snake_case code is not echoed into the message.
- No organizer page on the account: say so.
- One organizer page: that one, whatever it is called.
- Several: the one named like the artist, ignoring case, spaces, dashes and accents.
- Several and no single name match (or two with the same name): ask for the organizer link, never a coin toss.
- A pasted link's organizer wins; one that is not on the account is refused, never swapped for another.
- It looks through every organization the account belongs to, not just the first.
- An account with no organization at all has no organizer page.
- Only short codes travel back in the URL, never a message.
- Every failure code has plain words, and the success reads "Eventbrite connected.".
- An unknown or repeated code reads as a generic failure, never as its own text (it arrives in the URL, so anyone can write it).

### tests/unit/manager-tools/connections/youtube-oauth-routes.test.ts · 29 tests

The two Connect with YouTube routes: start sends only this artist's manager to Google, and the callback saves the channel, the way a pasted link would, only when every check passes; the Google token is used for one read, revoked, and kept nowhere.

- **Code:** src/app/api/youtube/start/route.ts, src/app/api/youtube/callback/route.ts
- **Tier:** STRICT (AGENTS.md "Test depth"): security. A sign-in return decides whose channel lands on which artist's site.
- **Not here:** the rules these routes call (youtube-oauth.test.ts); what the save does with the channel (connections-actions.test.ts).

**Tests**

- An owner is sent to Google's sign-in with our client id and an S256 challenge (no secret), and gets a signed, HttpOnly, Secure, short-lived cookie only the callback can see.
- Turning Sync off travels inside the signed cookie.
- Development on http://localhost works, and its cookie is not marked Secure (it could not be set).
- Any other plain-http address is never sent to Google, and gets no cookie.
- Nobody signed in goes to the login page, not to Google.
- A manager of another artist gets "not found" and no cookie.
- An artist id that is not an id (or none) is "not found".
- Without the app's credentials it goes back to the Connections page with a "not set up" code.
- The happy path saves the channel Google named through the paste path and goes back saying so; the code is traded with this trip's verifier, at this address.
- The token reads the channel once, is revoked before the save, and is kept nowhere.
- A revoke Google refuses does not undo the connection.
- The state cookie is spent: cleared on the way out, so the trip cannot be replayed.
- A channel with no handle saves its channel link, and Sync off is passed on to the save.
- The whole trip works on http://localhost for development.
- A return carrying another trip's nonce saves nothing.
- A return after the time limit saves nothing.
- A trip finished in another manager's session, or after signing out, saves nothing.
- A manager who lost the artist during the trip saves nothing.
- No cookie, or one edited to name another artist, goes back to the dashboard (not to any artist's page) and saves nothing.
- A return over plain http (not localhost) saves nothing.
- Pressing Cancel at Google comes back as "cancelled", and no code is exchanged.
- Any other error from Google, or no code at all, saves nothing.
- Without the app's credentials nothing can be checked, so it goes back to the dashboard.
- Google refusing the code: no channel read, nothing saved; the refusal is logged without any secret.
- The manager did not grant YouTube access: nothing saved, and the token is still revoked.
- No channel on that Google account: nothing saved, token revoked.
- The channel read fails: nothing saved, token revoked.
- A refused save reports "connect"; a saved link whose first video import failed reports "sync".
- A save that throws is reported as a connect failure, not an error page.

### tests/unit/manager-tools/connections/youtube-oauth.test.ts · 31 tests

The pure rules of "Connect with YouTube": the signed note that ties a Google sign-in trip to one manager and one artist, the links and code exchange with Google, reading the channel, and the words shown on the way back.

- **Code:** src/lib/youtube-oauth.ts, src/lib/manager-tools/connections/services/youtube (youtubeStartPath)
- **Tier:** STRICT (AGENTS.md "Test depth"): security. Everything that decides whether a sign-in return is TRUSTED lives here, and the channel id ends up in a link.
- **Not here:** the two routes that use these rules (youtube-oauth-routes.test.ts); saving the channel and importing videos (connections-actions.test.ts).

**Tests**

- The Google app counts as set up only when both credentials are present (spaces trimmed).
- A trip may start only over https, or plain http on localhost; any other http (a look-alike localhost host, a local network address) is refused.
- The cookie carries the artist, the manager, the Sync choice, the nonce and the verifier back intact, and the challenge Google gets is S256 of that verifier.
- Two trips never share a nonce or a verifier, so one trip's return cannot finish another.
- A cookie edited to name another artist fails its signature.
- A cookie signed with a different secret is refused.
- A Shopify cookie signed with the same secret is not a YouTube one: the signature is tied to its purpose.
- A return after the time limit is refused, but still names its artist so the page can say so.
- The signature is compared in constant time, so its bytes cannot be guessed by timing.
- No cookie, an empty one, or garbage is refused without throwing.
- The matching return passes: the witness that makes each refusal below meaningful.
- A return with another trip's nonce, none, or a short one is refused, compared in constant time.
- A return finished by another signed-in manager, or by nobody, is refused.
- The link to Google asks for read-only YouTube access only, for this sign-in only, lets the manager pick the account, and carries our state and an S256 challenge.
- The Connect button's address carries the artist, and says so only when Sync is off.
- The code exchange posts the code, verifier, secret and exact redirect to Google, and does not follow redirects (the secret is in the body); it returns the token and the scopes granted.
- A refused exchange throws with Google's error code, but never the code, secret or verifier.
- A success answer with no token is a refusal too.
- The read scope must be among what Google granted; another YouTube scope does not count.
- The channel read asks for the signed-in account's own channel, with the token in the Authorization header, never in the URL.
- An old-style custom url (no @) is not mistaken for a handle.
- An account with no channel (or one that must sign up first) is "no channel", not an error.
- A channel id that is not a UC… id is refused: it goes into a link on the site.
- A refused channel read throws, without the token in the message.
- Revoking posts the token to Google's revoke address, in the body.
- A refused revoke or a network failure is reported as false, never thrown.
- A channel with a handle saves exactly the link typing that handle would, plus the real id.
- A channel with no handle, or one the handle rule refuses, saves its channel link, kept whole.
- Only short codes travel back in the URL, never a message.
- Every failure code has plain words; success reads "YouTube connected." and "no channel" says so plainly.
- An unknown code reads as a generic failure, never as its own text (anyone can write the URL).

## Identity databases (MusicBrainz, Discogs, Wikidata)

Connections that say who the artist is, for AI answers, and the pre-filled “create your MusicBrainz page” link.

### tests/unit/manager-tools/connections/identity-only.test.ts · 13 tests

MusicBrainz, Discogs and Wikidata are connections that say WHO the artist is (for AI answers): each accepts only its own kind of artist page or id, and none ever becomes a button on the site.

- **Code:** src/lib/connections.ts (CONNECTIONS, identityOnly, profileLink, connectInputError, idFromProfileUrl, buttonChoices), the bridge's platformFromUrl and socialIcon
- **Tier:** STRICT (AGENTS.md "Test depth"): a validator of links and ids that end up on the live site's fact card.
- **Not here:** the "create your MusicBrainz page" link (musicbrainz-seed.test.ts); the fact card itself (tests/unit/manager-tools/seo).

**Tests**

- Exactly these three are identity-only, and each is an ordinary social connection with an icon.
- The site reads each link as its platform, and a look-alike host as nobody's.
- The Connections page shows them like any other: in the Connect grid, and as a row once linked.
- A MusicBrainz artist link is saved as pasted, made https and without its query.
- Anything else on musicbrainz.org (a release, the create page, a search) is refused with a plain reason, and another site's link is named for what it is.
- The artist's MusicBrainz id comes out of its link, and nothing out of anyone else's.
- A Discogs artist link is saved as pasted, a language path included, without its query.
- A Discogs release, master, label, name-only or shop link is refused with a plain reason.
- The numeric Discogs artist id comes out of its link, with or without a language path.
- A bare Q-id or any link to the item becomes the one Wikidata item page.
- A property id, a search page or junk is refused, each with its own plain reason.
- The Q-id comes out of a Wikidata link, and nothing out of anyone else's.
- The editor's button picker never offers them: each IS a connection's link (the witness), so only the identity rule keeps it out.

### tests/unit/manager-tools/connections/musicbrainz-seed.test.ts · 10 tests

The "Create the MusicBrainz page" link opens MusicBrainz's own artist editor pre-filled from what we know, with every value safely encoded and only links MusicBrainz can label correctly.

- **Code:** src/lib/manager-tools/connections/services/musicbrainz/seed.ts (musicBrainzCreateUrl, MB_LINK_TYPE, MB_LINK_TYPE_OF, MB_ARTIST_TYPE)
- **Tier:** STRICT (AGENTS.md "Test depth"): everything here ends up in a URL.
- **Not here:** accepting a MusicBrainz artist link as a connection (identity-only.test.ts).

**Tests**

- The link opens MusicBrainz's own artist editor over https, with the artist's name filled in.
- Every value is encoded: an &, =, # or a fake parameter in a name or area stays text and cannot add or change a parameter.
- The artist type is sent only when known (a person is 1, a group 2); unknown is left to the artist.
- The area is sent trimmed when there is one; blank or missing sends nothing.
- A blank name sends no name, so the artist types it there.
- The site goes first as the official homepage, then every profile with its own MusicBrainz link type, in order.
- Only https links, only when the label and the link agree, only platforms with a confirmed type (not payment pages), each once, numbered without gaps.
- A homepage that is not an https web link is left out.
- The link type ids are the ones confirmed on musicbrainz.org, written here by hand.
- Every platform it maps is one the bridge knows, onto one of those confirmed ids.

## Shows from Eventbrite

Reading an organizer’s events from Eventbrite and pulling them into Tour as drafts.

### tests/unit/tour/eventbrite-events.test.ts · 22 tests

Eventbrite's events become tour dates only when they are public and upcoming, with the right local date, a safe ticket link and a truthful place; and the token never leaks.

- **Code:** src/lib/eventbrite.ts (showFromEvent, createEventbriteClient: listUpcomingShows, listOrganizations, listOrganizers)
- **Tier:** STRICT (AGENTS.md "Test depth"): a parser of outside data whose output reaches the live site and URLs, and it carries a sign-in token.
- **Not here:** what a pull WRITES to the tour table (tour-pull.test.ts, eventbrite-sync.test.ts); the sign-in trip (tests/unit/manager-tools/connections/eventbrite-oauth*.test.ts).

**Tests**

- The normal case, in full: a public upcoming event becomes a show with its venue, place, pin and its own Eventbrite page as the ticket link.
- Only events that are on sale or under way land; drafts, cancelled and finished events never do.
- A private event (unlisted, invite-only or behind a password) never reaches a public site.
- The date is the show's own local day, whether Eventbrite sends the local time or only UTC and a timezone: a 9pm show in Los Angeles is not listed on the next day.
- An event with no start, or an impossible date, is left out: a show without a date is nothing.
- The ticket link must be an https Eventbrite page (any country's); a look-alike host, plain http or a script link drops the event, because the link goes on the live site.
- An online event says "Online" and has no city or map pin.
- An event whose venue is not set yet has no place at all, rather than a guessed one.
- Outside the US the country is written out and the state is empty (Western Australia's "WA" is not Washington); a US region that is not a state code is left out too.
- The map pin comes from the venue, or from its address when the venue has none; no numbers, no pin.
- An event id must be digits (it becomes part of a path); anything else, or no event at all, is dropped.
- The request asks for exactly this organizer's upcoming, on-sale events, venue included, with the token in the Authorization header only and redirects not followed.
- It reads every page Eventbrite offers and still drops the events that should not land.
- A page with no events list, or a broken continuation, ends the list quietly instead of looping.
- A maintenance page instead of JSON is reported as a shape error, not a crash.
- It stops at 20 pages even if Eventbrite keeps saying there is more.
- An organization or organizer id that is not digits is refused before any request is sent.
- A refused token tells the manager to connect again, and the error never contains the token.
- Other refusals say the HTTP status and Eventbrite's own UPPER_CASE code and nothing else (never the token, never odd text from the answer); 401 and NO_AUTH mean "sign in again".
- It lists the account's organizations, keeping only those with digit ids.
- It lists an organization's organizer pages with their public link, dropping bad ids.
- An organizer link that is not an https Eventbrite page is replaced by the plain eventbrite.com/o/<id> page, so a hostile link never reaches the Connections page.

### tests/unit/tour/eventbrite-sync.test.ts · 7 tests

The Eventbrite pull writes new shows as drafts kept off the site, one row per event, keeps the manager's edits, and touches only the tour table.

- **Code:** src/lib/sync.ts (syncEventbriteTourDates), carrying out src/lib/tour-pull.ts's plan
- **Tier:** STRICT (AGENTS.md "Test depth"): data that can be lost, and what the live site receives (a pulled show must never publish itself).
- **Not here:** the merge rules themselves (tour-pull.test.ts); the same pull on the hosted database (tests/integration/sync/sync.eventbrite.test.ts, once the migration is pushed).

**Tests**

- New shows land as drafts off the site, owned by Eventbrite and remembering what was pulled; only the tour table is touched, so nothing is published.
- Pulling the same events again adds nothing: one row per event.
- A re-pull keeps the manager's venue fix and their tick onto the site, moves the city they never touched, and the update is limited to Eventbrite's own row.
- A hand-added show that carries the same event id is never written.
- In a hand-ordered list the new show is slotted by date; an undragged list gets no reorder.
- Another pull inserting the same event first is not a failure; any other insert error is counted with the event and the reason.
- Row-level security refusing a write stops the whole pull, never a partial success.

### tests/unit/tour/tour-pull.test.ts · 16 tests

A pulled show lands once, follows its source, and never overwrites what the manager changed; new shows slot into a hand-ordered list by date.

- **Code:** src/lib/tour-pull.ts (planTourPull, slotNewRows, PULLED_COLUMNS)
- **Tier:** STRICT (AGENTS.md "Test depth"): data that can be lost. A wrong plan overwrites a manager's fix or doubles a show on the live site.
- **Not here:** carrying the plan out against the table (eventbrite-sync.test.ts); reading events from Eventbrite (eventbrite-events.test.ts).

**Tests**

- A new event is one insert, and pulling it again changes nothing: no duplicate show.
- The same event twice in one pull is still one insert (the later copy wins).
- A hand-added show at the same venue has no Eventbrite id, so it is never mistaken for the event.
- A row another source owns is skipped, even if it carries the same id.
- A column the manager never touched follows Eventbrite (the venue moved: it moves), and only the changed columns are written.
- A column the manager changed keeps their value whatever Eventbrite now says; untouched columns of the same row still move.
- The edit survives every later pull, not only the next one.
- An edited row with nothing new from Eventbrite is left alone; when Eventbrite does change the edited column, only the memory of what it said is updated, and the row counts as skipped.
- A column the pull has no memory of writing counts as the manager's, and is not overwritten.
- A column the manager emptied is an edit too: Eventbrite does not refill it.
- A coordinate read back from the database is the same number, so it is not a change.
- It writes only the eight columns it pulls, never anything else on the row.
- A tour list the manager never dragged sorts itself by date, so there is no order to write.
- In a hand-ordered list each new show goes after the last show dated on or before it, as the tour page's own Add does.
- No new shows means no order to write.
- A new show with no date goes at the end, whatever order the new shows arrived in.

## The test standard

The check that keeps every file above to the header and the comment above each test.

### tests/unit/harness/test-specs.test.ts · 16 tests

Every test file in the tidied areas opens with its spec header, and every test has a one-line comment saying what it checks and why.

- **Code:** scripts/test-catalog.ts (STANDARD_AREAS, standardFiles, specProblems)
- **Tier:** STRICT (AGENTS.md "Test depth"): Sam reviews the tests by reading these headers and comments (docs/TEST_CATALOG.md is built from them), so a missing one is a gap in what he can see.
- **Not here:** whether a comment is TRUE (a person reads it); the catalog's layout (it is only written, never asserted: open docs/TEST_CATALOG.md).

**Tests**

- A file that follows the standard has no problems: otherwise every check below proves nothing.
- A file with no header at all is caught, and the problem names the file and line 1.
- Each of the six fields is required: dropping any one is caught, and named. _(one per row of a table)_
- The fields come in one fixed order, so a reader always finds each in the same place.
- Tier must be one of the two AGENTS.md tiers, so "how hard is this tested" is never vague.
- The header's first line is the plain sentence, not a field: that sentence is what the catalog shows.
- The header must OPEN the file (only a vitest environment line may sit above it).
- A test with no comment above it is caught, and the problem names its exact line.
- "Right above" means the line above: a blank line between breaks the link between comment and test.
- Every way to write a test counts: .each tables, skipIf, only, and a describe.each table. _(one per row of a table)_
- A lint or type directive is not a comment about the test: the real comment must sit above it.
- A plain describe groups tests; it needs no comment of its own.
- A support file (fixtures, fakes) needs the header with "What it provides", and has no tests to comment.
- A file named after how its bugs were found hides which feature it protects (standard §3).
- The area list really finds files: a glob that matched nothing would make the next test pass vacuously.
- Every file has the header and every test its comment; a failure lists each gap as file:line.
