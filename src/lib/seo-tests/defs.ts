/**
 * The 24 tests, in page order, with the plain words Sam approved in the round 2 mock
 * (prototypes/seo_variants_20260928_r2.html). Words only: what each test DOES lives beside its
 * group (found.ts, who.ts, shared.ts, facts.ts).
 *
 * A name is a CLAIM. If a test's code cannot support its name, change the name here to what it
 * can support (and say what changed in the review notes) rather than keep a claim we can't check.
 */
import type { SeoTestDef, SeoTestGroup } from './types'

export const SEO_TEST_GROUPS: readonly { id: SeoTestGroup; label: string }[] = [
  { id: 'found', label: 'Can be found' },
  { id: 'who', label: 'Says who you are' },
  { id: 'shared', label: 'Looks right when shared' },
  { id: 'facts', label: 'Facts are true' },
]

export const SEO_TEST_DEFS: readonly SeoTestDef[] = [
  { id: 'google', group: 'found', name: 'Google can visit your site', tested: 'We visited each of your pages the way Google does.', why: 'If Google can\'t open a page, fans who search for you won\'t find it.' },
  { id: 'bing', group: 'found', name: 'Bing and Copilot can visit your site', tested: 'We visited each of your pages the way Bing does.', why: 'Bing also feeds Copilot and ChatGPT search, so it reaches more fans than it seems.' },
  { id: 'chatgpt', group: 'found', name: 'ChatGPT can read your site', tested: 'We visited your site the way ChatGPT does and checked each page opened with your words on it.', why: 'When a fan asks ChatGPT about you, it can only answer with what it was able to read.' },
  { id: 'claude', group: 'found', name: 'Claude can read your site', tested: 'We visited your site the way Claude does.', why: 'When a fan asks Claude about you, it answers with what it read here.' },
  { id: 'perplexity', group: 'found', name: 'Perplexity can read your site', tested: 'We visited your site the way Perplexity does.', why: 'Perplexity answers with links, and your site can be one of them.' },
  { id: 'others', group: 'found', name: 'Gemini and Apple can read your site', tested: 'We visited your site the way Gemini and Apple\'s AI do.', why: 'They answer questions on millions of phones.' },
  { id: 'allowed', group: 'found', name: 'Search engines are allowed to list you', tested: 'We looked for any setting that tells search engines to skip your pages.', why: 'One wrong setting can hide a whole site, so we check it every time.' },
  { id: 'list', group: 'found', name: 'Google has a list of your pages', tested: 'We opened the list of pages your site gives to search engines.', why: 'The list helps Google find new pages fast, like a new release.' },
  { id: 'words', group: 'found', name: 'Your words are in the page itself', tested: 'We read your pages with apps switched off, the way most AI tools read.', why: 'AI tools skip anything that needs an app to load.' },
  { id: 'bingwm', group: 'found', name: 'You can see when Copilot mentions you', tested: 'We checked if your site is linked to Bing Webmaster Tools, which is free.', why: 'It\'s the only free way to see when Copilot sends fans your way.', outside: 'Bing' },
  { id: 'title', group: 'who', name: 'Your page title says who you are', tested: 'We read the title Google shows as the blue link.', why: 'Your city and sound tell this Skeen apart from others with the same name.' },
  { id: 'desc', group: 'who', name: 'Your description sums you up', tested: 'We read the short summary Google shows under your title.', why: 'A clear summary makes people click your link, not someone else\'s.' },
  { id: 'bio', group: 'who', name: 'Your bio is long enough for AI to quote', tested: 'We counted the characters in the bio on your site.', why: 'AI tools quote your bio when someone asks about you. More of it gives them more to say.' },
  { id: 'genre', group: 'who', name: 'Your sound is named', tested: 'We read the music style your site gives search engines.', why: 'When someone asks for Chicago house DJs, this is how AI knows you fit.' },
  { id: 'place', group: 'who', name: 'Your hometown is clear', tested: 'We read where your site says you\'re based.', why: 'One article places you in Madison, WI. A full place helps AI pick the right one.' },
  { id: 'mb', group: 'who', name: 'MusicBrainz knows you', tested: 'We looked for you on MusicBrainz, a free music database.', why: 'Many AI tools and music apps learn who an artist is from MusicBrainz. A page there tells you apart from other Skeens.', outside: 'MusicBrainz' },
  { id: 'share', group: 'shared', name: 'Your share picture looks right', tested: 'We opened the picture that shows up when someone shares your link.', why: 'It\'s the first thing people see when a fan texts or posts your link.' },
  { id: 'preview', group: 'shared', name: 'Your link preview says who you are', tested: 'We read the title and summary that show up in a shared link.', why: 'A clear preview gets more taps than a bare link.' },
  { id: 'alt', group: 'shared', name: 'Every photo has a description', tested: 'We checked each photo on your site for a short description.', why: 'Google Images and screen readers use it, and it adds words about you.' },
  { id: 'profiles', group: 'facts', name: 'Your profiles all point to you', tested: 'We checked that each profile link on your site goes to your page.', why: 'Linked profiles tell AI these accounts are all the same you.' },
  { id: 'apple', group: 'facts', name: 'Your Apple Music link opens the right store', tested: 'We looked at where each of your music links sends fans.', why: 'A link tied to one country can show fans the wrong store.' },
  { id: 'shows', group: 'facts', name: 'Your show dates are up to date', tested: 'We compared your show dates to today.', why: 'Old shows listed as coming up make AI give fans the wrong dates.', source: 'Tour' },
  { id: 'releases', group: 'facts', name: 'Your latest releases are listed', tested: 'We checked your releases are on your site for search engines.', why: 'Fans ask AI “what’s new from Skeen?” This is its answer.', source: 'Music' },
  { id: 'card', group: 'facts', name: 'Search engines can read your fact card', tested: 'We read the facts your site hands to search engines behind the scenes.', why: 'If it breaks, search engines guess about you instead of knowing.' },
]
