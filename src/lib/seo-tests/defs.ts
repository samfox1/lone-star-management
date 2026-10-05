/**
 * The tests (SEO_TEST_IDS), in page order, with the plain words Sam approved in the round 2 mock
 * (prototypes/seo_variants_20260928_r2.html). Words only: what each test DOES lives beside its
 * group (found.ts, who.ts, shared.ts, facts.ts).
 *
 * A name is a CLAIM. If a test's code cannot support its name, change the name here to what it
 * can support (and say what changed in the review notes) rather than keep a claim we can't check.
 */
import type { SeoTestDef, SeoTestGroup, SeoTestId } from './types'

/** The tests whose answer does not come from reading the artist's site: `mb` asks MusicBrainz
 *  about the artist, `youtube` reads their YouTube channel. Every other test reads the site's
 *  pages, robots.txt, sitemap or files. */
export const SITE_FREE_TESTS: ReadonlySet<SeoTestId> = new Set<SeoTestId>(['mb', 'youtube'])

export const SEO_TEST_GROUPS: readonly { id: SeoTestGroup; label: string }[] = [
  { id: 'found', label: 'Can be found' },
  { id: 'who', label: 'Says who you are' },
  { id: 'shared', label: 'Looks right when shared' },
  { id: 'facts', label: 'Facts are true' },
]

export const SEO_TEST_DEFS: readonly SeoTestDef[] = [
  { id: 'google', group: 'found', name: 'Your site is open to Google', tested: 'We opened each of your pages using Google\'s name, and read your site\'s settings for Google.', why: 'If Google can\'t open a page, fans who search for you won\'t find it.' },
  { id: 'bing', group: 'found', name: 'Your site is open to Bing and Copilot', tested: 'We opened each of your pages using Bing\'s name, and read your site\'s settings for Bing and Copilot.', why: 'Bing also feeds Copilot and ChatGPT search, so it reaches more fans than it seems.' },
  { id: 'chatgpt', group: 'found', name: 'Your site is open to ChatGPT', tested: 'We opened each of your pages using ChatGPT\'s names and checked each one got the same page a person gets.', why: 'When a fan asks ChatGPT about you, it can only answer with what it was able to read.' },
  { id: 'claude', group: 'found', name: 'Your site is open to Claude', tested: 'We opened each of your pages using Claude\'s names, and read your site\'s settings for Claude.', why: 'When a fan asks Claude about you, it answers with what it read here.' },
  { id: 'perplexity', group: 'found', name: 'Your site is open to Perplexity', tested: 'We opened each of your pages using Perplexity\'s names, and read your site\'s settings for Perplexity.', why: 'Perplexity answers with links, and your site can be one of them.' },
  { id: 'others', group: 'found', name: 'Your site is open to Gemini, Apple and other AI', tested: 'We read your site\'s settings for Gemini, Apple, Meta AI, Alexa and DuckDuckGo, and opened each page using their names and the name of Common Crawl, a copy of the web many AI tools learn from.', why: 'Gemini, Siri, Meta AI and Alexa answer questions for millions of people, and many AI tools learn from Common Crawl.' },
  { id: 'allowed', group: 'found', name: 'Search engines are allowed to list you', tested: 'We looked for any setting that tells search engines to skip your pages.', why: 'One wrong setting can hide a whole site, so we check it every time.' },
  { id: 'list', group: 'found', name: 'Your site offers Google a list of your pages', tested: 'We opened the list of pages your site gives to search engines and checked the pages on it open.', why: 'The list helps Google find new pages fast, like a new release.' },
  { id: 'words', group: 'found', name: 'Your words are in the page itself', tested: 'We read your pages with apps switched off, the way most AI tools read.', why: 'AI tools skip anything that needs an app to load.' },
  { id: 'bingwm', group: 'found', name: 'Your site is linked to Bing Webmaster Tools', tested: 'We looked on your site for the code Bing gives you when you link it to Bing Webmaster Tools, which is free.', why: 'It\'s the only free way to see when Copilot sends fans your way.', outside: 'Bing' },
  { id: 'title', group: 'who', name: 'Your page title says who you are', tested: 'We read the title your site gives Google for the blue link, and looked for your name and your city or sound.', why: 'Your city and sound tell you apart from others with the same name.' },
  { id: 'desc', group: 'who', name: 'Your description is about you and a good length', tested: 'We read the short description your site gives Google and checked it mentions you, your city or your sound.', why: 'A clear description helps people pick your link, not someone else\'s.' },
  { id: 'bio', group: 'who', name: 'Your bio names your genre, city and a highlight', tested: 'We read your bio on your site and looked for your genre, your city and a release or show, in at least 100 words.', why: 'AI tools quote your bio when someone asks about you. These facts tell them what kind of artist you are and where.' },
  { id: 'genre', group: 'who', name: 'Your genre is named', tested: 'We read the genre your site gives search engines and compared it with the one in Digital Tapir.', why: 'When someone asks AI for artists with your sound, this is how it knows you fit.' },
  { id: 'place', group: 'who', name: 'Where you\'re based is clear', tested: 'We read the city, state and country your site gives search engines and compared them with Digital Tapir\'s.', why: 'A city, state and country helps AI pick the right place, not a town with the same name.' },
  { id: 'mb', group: 'who', name: 'MusicBrainz knows you', tested: 'We asked MusicBrainz, a free music database, which artist links to your site and your main profiles, and checked it has your name.', why: 'Many AI tools and music apps learn who an artist is from MusicBrainz. A page there tells you apart from other artists with your name.', outside: 'MusicBrainz' },
  { id: 'youtube', group: 'who', name: 'Your YouTube channel says who you are', tested: 'We read your YouTube channel\'s description and looked for your site\'s address and your city or genre.', why: 'AI tools read YouTube to learn who an artist is. A description that links your site and names your city or sound ties the channel to you.', outside: 'YouTube' },
  { id: 'share', group: 'shared', name: 'Your preview picture looks right', tested: 'We opened the picture that shows when someone shares your link.', why: 'It\'s the first thing people see when a fan texts or posts your link.' },
  { id: 'preview', group: 'shared', name: 'Your link preview says who you are', tested: 'We read the title and summary that show up in a shared link.', why: 'A clear preview gets more taps than a bare link.' },
  { id: 'alt', group: 'shared', name: 'Every photo has a description', tested: 'We checked each photo on the pages we read for a short description.', why: 'Google Images and screen readers use it, and it adds words about you.' },
  { id: 'profiles', group: 'facts', name: 'Your fact card lists all your profiles', tested: 'We checked your site lists every profile you published in Digital Tapir, and nothing else.', why: 'Linked profiles tell AI these accounts are all the same you.' },
  { id: 'apple', group: 'facts', name: 'Your Apple Music link opens your home country\'s store', tested: 'We read which country\'s store each of your Apple Music links opens and compared it to where you\'re based.', why: 'A web browser opens the store named in the link, so a link tied to another country can show fans the wrong store.' },
  { id: 'shows', group: 'facts', name: 'Your show dates are up to date', tested: 'We compared the shows your site lists for search engines to today and to Tour.', why: 'Old shows listed as coming up make AI give fans the wrong dates.', source: 'Tour' },
  { id: 'releases', group: 'facts', name: 'Your latest releases are listed', tested: 'We checked every release you published in Music is on your site for search engines, and that your pages show each one it lists.', why: 'Fans ask AI what\'s new from you. This is its answer.', source: 'Music' },
  { id: 'card', group: 'facts', name: 'Search engines can read your fact card', tested: 'We read the facts your site hands to search engines behind the scenes.', why: 'If it breaks, search engines guess about you instead of knowing.' },
]
