/**
 * Proves the page readers every "Says who you are", "Looks right when shared" and "Facts are
 * true" test stands on read a live page the way a browser and a search engine do, and never
 * throw or hang on broken html.
 *
 * Code:     src/lib/seo-tests/html.ts (`parsePage`, `parseAttrs`, `decodeEntities`, `metaOf`,
 *           `ldNodes`, `typesOf`, `artistNodeOf`, `namesArtist`, `isBareName`, `linkKey`,
 *           `dayOf`, `pageState`)
 * Feature:  the page readers behind 14 SEO tests (Test tab groups "Says who you are",
 *           "Looks right when shared", "Facts are true")
 * Tier:     STRICT (AGENTS.md "Test depth"): a parser of untrusted html. Each rule here was
 *           broken by hand once to see its test go red (report, 2026-09-29).
 * Covers:   • entities and attributes are decoded; the first of a repeated attribute wins
 *           • the page title outside svg, meta tags by name or property, the canonical link,
 *             links, pictures and visible words; nothing inside comments, scripts, styles,
 *             templates or noscript
 *           • fact-card blocks by type, parsed or with the reason; every card shape; the
 *             artist's node (by #artist id, then name) merged across blocks, never a nested one
 *           • the artist's name as a whole word; the name plus filler is "bare"
 *           • one link however it is spelled (only the bridge's tracking list is dropped)
 *           • dates: real ones only; why a page can't be read
 * Not here: the match.ts readers are tested through the tests that use them: `wordCount`,
 *           `sentencesOf`, `namesPhrase` (../says-who-you-are/bio.test.ts), `titleShown`,
 *           `distinctiveTitle` (../facts-are-true/releases.test.ts), `describes`
 *           (../looks-right-when-shared/photo-descriptions.test.ts), `ownArtistNode`
 *           (../says-who-you-are/genre.test.ts); worst-case speed and the recorded broken
 *           pages (tests/unit/safe-fetching/slow-parsers.test.ts).
 * Fixtures: html written inline in each test. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import {
  artistNodeOf, dayOf, decodeEntities, isBareName, ldNodes, linkKey, metaOf, namesArtist, pageState, parseAttrs, parsePage, typesOf,
} from '@/lib/seo-tests/html'

describe('decoding entities and attributes', () => {
  // Named, decimal and hex entities decode; unknown, out-of-range and zero ones are left as written, never guessed.
  it('decodes named, decimal and hex entities, and leaves junk alone', () => {
    expect(decodeEntities('Skeen &amp; Friends &#x27;24 &#39;x&#39; &middot; &quot;a&quot; &nbsp;')).toBe('Skeen & Friends \'24 \'x\' · "a"  ')
    expect(decodeEntities('&bogus; &#xFFFFFFF; &#0; &')).toBe('&bogus; &#xFFFFFFF; &#0; &')
  })

  // Attributes in double, single or no quotes are read, a ">" inside quotes doesn't end the tag, and the FIRST of a repeated one wins, as in a browser.
  it('reads double, single and unquoted values, a quoted ">", and keeps the FIRST of a repeat', () => {
    expect(parseAttrs(' name="description" content=\'a > b\' data-x=plain alt="one" alt="two" hidden')).toEqual({
      name: 'description', content: 'a > b', 'data-x': 'plain', alt: 'one', hidden: '',
    })
  })

  // Attribute names are read in any case, and values are decoded.
  it('lower-cases names and decodes values', () => {
    expect(parseAttrs('CONTENT="Skeen &amp; co"')).toEqual({ content: 'Skeen & co' })
  })
})

describe('reading a page', () => {
  // One page gives its title (not an svg's, whitespace collapsed), meta tags by name or property in any case, the canonical link, links and pictures.
  it('reads the title outside svg, meta by name or property, the canonical link, links and images', () => {
    const p = parsePage(`<html><head><svg><title>icon</title></svg><title> Skeen
      &middot; DJ </title><meta name="Description" content="d"><meta property="og:title" content="t"><link rel="alternate canonical" href="https://x.com/"></head>
      <body><a href="/about">About</a><img src="/a.jpg" alt="A"></body></html>`)
    expect(p.title).toBe('Skeen · DJ')
    expect(metaOf(p, 'description')).toBe('d')
    expect(metaOf(p, 'OG:TITLE')).toBe('t')
    expect(p.canonical).toBe('https://x.com/')
    expect(p.links).toEqual(['/about'])
    expect(p.images).toEqual([{ src: '/a.jpg', alt: 'A' }])
  })

  // Tags inside comments, scripts, styles, templates and noscript are never read: a browser doesn't show them.
  it('never reads tags inside comments, scripts, styles, templates or noscript', () => {
    const p = parsePage(`<head><!-- <title>commented</title> <meta name="description" content="c"> --></head><body>
      <script>var s = "<title>in a script</title><img src=x>"</script><style>img{}</style>
      <template><img src="/t.jpg"></template><noscript><img src="/n.jpg"></noscript><p>hello</p></body>`)
    expect(p.title).toBeNull()
    expect(metaOf(p, 'description')).toBeNull()
    expect(p.images).toEqual([])
    expect(p.text).toBe('hello')
  })

  // Fact-card blocks are found by their type in any case, with a charset too; each is parsed, or carries why it can't be; other scripts are skipped.
  it('reads JSON-LD blocks by type (any case, with a charset), parsed or with the reason', () => {
    const p = parsePage(`<script type="APPLICATION/LD+JSON; charset=utf-8">{"@type":"WebSite"}</script>
      <script type='application/ld+json'>{broken</script><script type="text/javascript">{"@type":"No"}</script>`)
    expect(p.ld).toHaveLength(2)
    expect(p.ld[0]).toEqual(expect.objectContaining({ parsed: { '@type': 'WebSite' }, error: null }))
    expect(p.ld[1].error).toBeTruthy()
  })

  // The visible words are the body's text only, entities decoded, spaces collapsed, svg text left out.
  it('gives visible words: body text only, entities decoded, whitespace collapsed', () => {
    const p = parsePage('<html><head><title>T</title></head><body><h1>About</h1><p>I&#x27;m   <b>Skeen</b></p><svg><text>logo</text></svg></body></html>')
    expect(p.text).toBe("About I'm Skeen")
  })

  // An unclosed svg hides the rest of the page, as in a browser, and nested svgs close in order.
  it('lets an unclosed svg hide the rest (as a browser does), and closes nested svgs in order', () => {
    expect(parsePage('<body><svg><svg></svg><title>inner</title></svg><title>Real</title></body>').title).toBe('Real')
    expect(parsePage('<body><svg><p>x</p><title>hidden</title>').title).toBeNull()
  })

  // Junk never throws, and a page of 200,000 quotes, 50,000 scripts and 50,000 open comments is read in under 3 seconds.
  it('never throws on junk, and finishes a hostile page quickly', () => {
    for (const junk of ['', '<', '<<<>>>', '<!--', '<script>', '<a href="', '<img alt=\'x', '<!DOCTYPE', '</>', '<\u0000>']) {
      expect(() => parsePage(junk)).not.toThrow()
    }
    const t = Date.now()
    parsePage(`<p ${'"'.repeat(200_000)}>` + '<script>'.repeat(50_000) + '<!--'.repeat(50_000))
    expect(Date.now() - t).toBeLessThan(3000)
  })
})

describe('reading the fact card', () => {
  /** A page whose one block is `graph` in @graph. */
  const page = (graph: unknown[]) => parsePage(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`)

  // Every shape a card can take is read: @graph as a list or one node, a list, one node, a node beside a graph; anything else is no nodes.
  it('reads @graph (array or one object), a top-level array, one node, and a node beside a graph', () => {
    expect(ldNodes({ '@graph': [{ '@type': 'A' }, { '@type': 'B' }] })).toHaveLength(2)
    expect(ldNodes({ '@graph': { '@type': 'A' } })).toEqual([{ '@type': 'A' }])
    expect(ldNodes([{ '@type': 'A' }, [{ '@type': 'B' }]])).toHaveLength(2)
    expect(ldNodes({ '@type': 'A' })).toHaveLength(1)
    expect(ldNodes({ '@type': 'WebPage', '@graph': [{ '@type': 'B' }] })).toHaveLength(2)
    expect(ldNodes('x')).toEqual([])
    expect(ldNodes(null)).toEqual([])
  })

  // A type is read without its schema.org prefix, from a list too, skipping non-text.
  it('drops the schema.org prefix and reads type arrays', () => {
    expect(typesOf({ '@type': ['schema:MusicGroup', 'https://schema.org/Organization', 3] })).toEqual(['MusicGroup', 'Organization'])
  })

  // The artist's node is the one with the #artist id, else the one with the artist's name, else the first; never a node nested in a show.
  it('prefers the #artist id, then the name, then the first, and never a nested node', () => {
    expect(artistNodeOf(page([{ '@type': 'MusicGroup', name: 'A' }, { '@type': 'MusicGroup', '@id': 'x/#artist', name: 'B' }]), 'A')?.name).toBe('B')
    expect(artistNodeOf(page([{ '@type': 'MusicGroup', name: 'A' }, { '@type': 'Person', name: 'Skeen' }]), 'skeen')?.name).toBe('Skeen')
    expect(artistNodeOf(page([{ '@type': 'MusicEvent', performer: { '@type': 'MusicGroup', name: 'Support' } }]), 'Skeen')).toBeNull()
  })

  // Pieces of the artist's node split across blocks (same id) are merged into one.
  it('merges nodes that share the artist id across blocks', () => {
    const html = ['{"@type":"MusicGroup","@id":"x/#artist","name":"Skeen"}', '{"@type":"MusicGroup","@id":"x/#artist","genre":"House"}']
      .map((j) => `<script type="application/ld+json">${j}</script>`).join('')
    expect(artistNodeOf(parsePage(html), 'Skeen')).toEqual(expect.objectContaining({ name: 'Skeen', genre: 'House' }))
  })
})

describe('the artist’s name', () => {
  // The name is found as a whole word in any case and with accents or dots, never inside a longer word, and an empty name matches nothing.
  it('matches the name as a whole word, any case', () => {
    expect(namesArtist('SKEEN · Chicago', 'Skeen')).toBe(true)
    expect(namesArtist('Skeens · Chicago', 'Skeen')).toBe(false)
    expect(namesArtist('Beyoncé live', 'beyoncé')).toBe(true)
    expect(namesArtist('A.B. (live)', 'A.B.')).toBe(true)
    expect(namesArtist('anything', '')).toBe(false)
  })

  // The name alone or with filler ("Official Website", "Home") is bare; one more real word ("Chicago", "DJ") is not.
  it('calls the name plus filler bare, and anything more not', () => {
    expect(isBareName('SKEEN', 'Skeen')).toBe(true)
    expect(isBareName('Skeen — Official Website', 'Skeen')).toBe(true)
    expect(isBareName('Skeen | Home', 'Skeen')).toBe(true)
    expect(isBareName('Skeen · Chicago', 'Skeen')).toBe(false)
    expect(isBareName('Skeen DJ', 'Skeen')).toBe(false)
  })
})

describe('one link, however it is spelled', () => {
  // www, http or https, a trailing slash and share-tracking settings (igsh, utm_, si) don't make a different link.
  it('treats www, scheme, trailing slash and tracking params as the same link', () => {
    const k = linkKey('https://www.instagram.com/skeen/')
    expect(linkKey('http://instagram.com/skeen?igsh=abc&utm_source=x')).toBe(k)
    expect(linkKey('https://instagram.com/skeen?si=1')).toBe(k)
  })

  // A real setting (?id=1) and the path's case do make a different link; gclid is kept, since the bridge keeps it (the same list on both sides); mailto and junk are no link. (verify-found PR5)
  it('keeps a real query, the path’s case and any setting the bridge keeps; refuses non-web links', () => {
    expect(linkKey('https://facebook.com/profile.php?id=1')).not.toBe(linkKey('https://facebook.com/profile.php?id=2'))
    expect(linkKey('https://open.spotify.com/artist/AbC')).not.toBe(linkKey('https://open.spotify.com/artist/abc'))
    expect(linkKey('mailto:x@y.com')).toBeNull()
    expect(linkKey('nope')).toBeNull()
    expect(linkKey('https://instagram.com/x?gclid=1')).not.toBe(linkKey('https://instagram.com/x'))
  })
})

describe('dates and page states', () => {
  // A date or a date with a time gives its day; an impossible date (Feb 30), words or a number give none.
  it('reads a date or datetime, and refuses impossible dates', () => {
    expect(dayOf('2026-10-15')).toBe('2026-10-15')
    expect(dayOf('2026-10-15T21:00:00-05:00')).toBe('2026-10-15')
    expect(dayOf('2026-02-30')).toBeNull()
    expect(dayOf('soon')).toBeNull()
    expect(dayOf(20261015)).toBeNull()
  })

  // A page that can't be read says why in plain words (not visited, timed out, an error, not a web page), and one cut at the cap is read but marked.
  it('says why a page cannot be read, and marks a page with no answer', () => {
    expect(pageState(undefined, '/')).toEqual(expect.objectContaining({ ok: false, noAnswer: true }))
    expect(pageState({ path: '/', finalUrl: null, status: null, headers: {}, html: null, error: 'timeout' }, '/')).toEqual(expect.objectContaining({ ok: false, noAnswer: true, why: 'your home page didn’t answer (it timed out)' }))
    expect(pageState({ path: '/x', finalUrl: 'u', status: 404, headers: {}, html: null }, '/x')).toEqual(expect.objectContaining({ ok: false, noAnswer: false }))
    expect(pageState({ path: '/x', finalUrl: 'u', status: 200, headers: {}, html: null }, '/x')).toEqual(expect.objectContaining({ ok: false, why: 'your page /x isn’t a web page' }))
    expect(pageState({ path: '/', finalUrl: 'u', status: 200, headers: {}, html: '<p>x</p>', truncated: true }, '/')).toEqual(expect.objectContaining({ ok: true, truncated: true }))
  })
})
