/**
 * The visitors the "Can be found" tests pretend to be, from each vendor's OWN documentation
 * (read 2026-09-28; the page is `docUrl` on each entry).
 *
 * What a visit with one of these names can and cannot prove (it is the limit every bot test
 * states): we send the bot's NAME from our own server, not from the bot's network. A firewall
 * that checks the real bot's addresses (Cloudflare, Vercel and most bot managers do) may treat
 * the real bot differently from us, in either direction: it can block our look-alike and let
 * the real one in, or let us in and block the real one.
 *
 * Two kinds of entry:
 *   fetches: true   a crawler that really visits with this User-Agent. We visit as it.
 *   fetches: false  a robots.txt TOKEN only. No request ever carries it (Google-Extended,
 *                   Applebot-Extended), so it is judged from robots.txt, and the visit is the
 *                   crawler named in `visitsAs` (Google's docs: "Crawling is done with existing
 *                   Google user agent strings"; Apple's: "Applebot-Extended does not crawl").
 *
 * `Chrome/W.X.Y.Z` in Google's, Bing's and Amazon's strings is their placeholder for "the
 * current browser version"; a concrete version is filled in below (a firewall matching the bot
 * keys on the bot's name, not on this number).
 */
import type { SeoBot } from './types'

/** Filled into the vendors' `Chrome/W.X.Y.Z` placeholder. */
const CHROME = '140.0.7339.207'

/** The "plain visit": what a person's browser is sent. A current desktop Chrome, reduced the
 *  way Chrome itself reduces its version ("140.0.0.0"). */
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const GOOGLE_DOC = 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers'
const OPENAI_DOC = 'https://developers.openai.com/api/docs/bots'
const ANTHROPIC_DOC = 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler'
const PERPLEXITY_DOC = 'https://docs.perplexity.ai/guides/bots'
const APPLE_DOC = 'https://support.apple.com/en-us/119829'
const META_DOC = 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/'
const AMAZON_DOC = 'https://developer.amazon.com/amazonbot'
const DUCKDUCKGO_DOC = 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot'

export const SEO_BOTS: readonly SeoBot[] = [
  // Google. Smartphone Googlebot: Google indexes the mobile page first ("mobile-first
  // indexing"), so the phone crawler is the one whose answer decides what is listed.
  // Google renders pages with an evergreen Chromium, so scripts DO run for it.
  {
    key: 'googlebot', who: 'Google', robotsToken: 'Googlebot', fetches: true, test: 'google', runsScripts: true,
    userAgent: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
    docUrl: GOOGLE_DOC, uaDocumented: true,
  },
  // Bing (also feeds Copilot). The desktop string from Bing's own announcement; Bing's help
  // page (bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0) lists the same.
  // Bing runs scripts since its "evergreen bingbot" (blogs.bing.com/webmaster, Oct 2019).
  {
    key: 'bingbot', who: 'Bing', robotsToken: 'bingbot', fetches: true, test: 'bing', runsScripts: true,
    userAgent: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/${CHROME} Safari/537.36`,
    docUrl: 'https://blogs.bing.com/webmaster/2022/4/Announcing-user-agent-change-for-Bing-crawler-bingbot/', uaDocumented: true,
  },
  // OpenAI: search (what ChatGPT search shows), user fetches (a person asked ChatGPT to open
  // the page; "robots.txt rules may not apply"), and training.
  {
    key: 'oai-searchbot', who: 'ChatGPT search', robotsToken: 'OAI-SearchBot', fetches: true, test: 'chatgpt',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
    docUrl: OPENAI_DOC, uaDocumented: true,
  },
  {
    key: 'chatgpt-user', who: 'ChatGPT', robotsToken: 'ChatGPT-User', fetches: true, test: 'chatgpt',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    docUrl: OPENAI_DOC, uaDocumented: true,
  },
  {
    key: 'gptbot', who: 'ChatGPT training', robotsToken: 'GPTBot', fetches: true, test: 'chatgpt', trainingOnly: true,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    docUrl: OPENAI_DOC, uaDocumented: true,
  },
  // Anthropic documents the three TOKENS and what each is for, but not the full strings. The
  // strings below are the form these bots are widely logged with, built around the token.
  {
    key: 'claudebot', who: 'Claude training', robotsToken: 'ClaudeBot', fetches: true, test: 'claude', trainingOnly: true,
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    docUrl: ANTHROPIC_DOC, uaDocumented: false,
  },
  {
    key: 'claude-searchbot', who: 'Claude search', robotsToken: 'Claude-SearchBot', fetches: true, test: 'claude',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
    docUrl: ANTHROPIC_DOC, uaDocumented: false,
  },
  {
    key: 'claude-user', who: 'Claude', robotsToken: 'Claude-User', fetches: true, test: 'claude',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    docUrl: ANTHROPIC_DOC, uaDocumented: false,
  },
  // Perplexity: the index crawler, and the user fetcher ("generally ignores robots.txt").
  {
    key: 'perplexitybot', who: 'Perplexity search', robotsToken: 'PerplexityBot', fetches: true, test: 'perplexity',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    docUrl: PERPLEXITY_DOC, uaDocumented: true,
  },
  {
    key: 'perplexity-user', who: 'Perplexity', robotsToken: 'Perplexity-User', fetches: true, test: 'perplexity',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    docUrl: PERPLEXITY_DOC, uaDocumented: true,
  },
  // Gemini: Google-Extended is a robots.txt token only. It decides whether what GOOGLEBOT
  // crawled may be used for Gemini's training and grounding, so the visit is Googlebot's.
  {
    key: 'google-extended', who: 'Gemini', robotsToken: 'Google-Extended', fetches: false, test: 'others', userAgent: null,
    visitsAs: 'googlebot', docUrl: GOOGLE_DOC,
  },
  // Apple: Applebot visits (Siri, Spotlight); Applebot-Extended is a token that decides
  // whether that crawl may train Apple's AI. Apple: "If robots instructions don't mention
  // Applebot but mention Googlebot, the Apple robot will follow Googlebot instructions" and
  // "Applebot may render the content of your website within a browser".
  {
    key: 'applebot', who: 'Apple', robotsToken: 'Applebot', fetches: true, test: 'others', runsScripts: true,
    robotsFallback: ['Googlebot'],
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    docUrl: APPLE_DOC, uaDocumented: true,
  },
  {
    key: 'applebot-extended', who: 'Apple Intelligence', robotsToken: 'Applebot-Extended', fetches: false, test: 'others', userAgent: null, trainingOnly: true,
    visitsAs: 'applebot', docUrl: APPLE_DOC,
  },
  // The three below were read 2026-09-30 (VISIBILITY_TOOLKIT.md item 5). None of the three
  // vendors says whether its crawler runs a page's scripts, so `runsScripts` is unset (treated
  // as NOT running them). None is training-only: each says it gathers pages for answers.
  //
  // Meta AI. Meta: Meta-WebIndexer "navigates the web to improve Meta AI search result quality"
  // and allowing it "helps us cite and link to your content in Meta AI's responses". Meta's doc
  // prints the string as `meta-webindexer/1.1 (+/documentation/sharing/webmasters/web-crawlers)`
  // (a link with its host cut off) or `meta-webindexer/1.1`; we send the second, which is the
  // doc's own text character for character. The doc's robots.txt example writes Meta's tokens
  // lower-case; robots.txt tokens match in any case (RFC 9309).
  {
    key: 'meta-webindexer', who: 'Meta AI', company: 'Meta', robotsToken: 'Meta-WebIndexer', fetches: true, test: 'others',
    userAgent: 'meta-webindexer/1.1',
    docUrl: META_DOC, uaDocumented: true,
  },
  // Alexa. Amazon: "By permitting Amzn-SearchBot access to your website, your content is eligible
  // to appear in search experiences such as Alexa", and it "does not crawl content for generative
  // AI model training". "Each user agent setting is independent of the others" (so Amazonbot's
  // rules don't reach it). Amazon also says that when robots.txt doesn't mention it "but allow[s]
  // other search bots", it follows "the robots.txt directives given to other search bots",
  // without naming which. So no fallback can be set: it is judged by its own group or `*`, and a
  // `*` rule that keeps it out while another crawler's group lets that one in is "couldn't tell"
  // (`followsOtherSearchBots`), never a fail.
  {
    key: 'amzn-searchbot', who: 'Alexa', company: 'Amazon', robotsToken: 'Amzn-SearchBot', fetches: true, test: 'others', followsOtherSearchBots: true,
    userAgent: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/${CHROME} Safari/537.36`,
    docUrl: AMAZON_DOC, uaDocumented: true,
  },
  // DuckDuckGo's AI answers. DuckDuckGo: DuckAssistBot "crawls pages in real-time for our
  // AI-assisted answers", "This data is not used in any way to train AI models", and its "user
  // agent will appear as DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)".
  // Turning it away "does not impact organic search rankings".
  {
    key: 'duckassistbot', who: 'DuckDuckGo', robotsToken: 'DuckAssistBot', fetches: true, test: 'others',
    userAgent: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)',
    docUrl: DUCKDUCKGO_DOC, uaDocumented: true,
  },
  // Common Crawl: the shared copy of the web many AI models learn from.
  {
    key: 'ccbot', who: 'Common Crawl', robotsToken: 'CCBot', fetches: true, test: 'others', trainingOnly: true,
    userAgent: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
    docUrl: 'https://commoncrawl.org/ccbot', uaDocumented: true,
  },
]

/** The bots that really visit, in SEO_BOTS order. */
export const FETCHING_BOTS: readonly SeoBot[] = SEO_BOTS.filter((b) => b.fetches)

export function botsForTest(test: SeoBot['test']): SeoBot[] {
  return SEO_BOTS.filter((b) => b.test === test)
}

/** The robots.txt tokens a bot answers to, in the order it looks for them. */
export function robotsTokensOf(bot: SeoBot): string[] {
  return [bot.robotsToken, ...(bot.robotsFallback ?? [])]
}
