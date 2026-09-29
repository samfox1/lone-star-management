/**
 * The shared readers every who / shared / facts test stands on. A parser of untrusted html:
 * strict. Each rule here was broken by hand once to see its test go red (report, 2026-09-29).
 */
import { describe, expect, it } from 'vitest'
import {
  artistNodeOf, dayOf, decodeEntities, isBareName, ldNodes, linkKey, metaOf, namesArtist, pageState, parseAttrs, parsePage, typesOf,
} from '@/lib/seo-tests/html'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities, and leaves junk alone', () => {
    expect(decodeEntities('Skeen &amp; Friends &#x27;24 &#39;x&#39; &middot; &quot;a&quot; &nbsp;')).toBe('Skeen & Friends \'24 \'x\' · "a"  ')
    expect(decodeEntities('&bogus; &#xFFFFFFF; &#0; &')).toBe('&bogus; &#xFFFFFFF; &#0; &')
  })
})

describe('parseAttrs', () => {
  it('reads double, single and unquoted values, a quoted ">", and keeps the FIRST of a repeat', () => {
    expect(parseAttrs(' name="description" content=\'a > b\' data-x=plain alt="one" alt="two" hidden')).toEqual({
      name: 'description', content: 'a > b', 'data-x': 'plain', alt: 'one', hidden: '',
    })
  })
  it('lower-cases names and decodes values', () => {
    expect(parseAttrs('CONTENT="Skeen &amp; co"')).toEqual({ content: 'Skeen & co' })
  })
})

describe('parsePage', () => {
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
  it('never reads tags inside comments, scripts, styles, templates or noscript', () => {
    const p = parsePage(`<head><!-- <title>commented</title> <meta name="description" content="c"> --></head><body>
      <script>var s = "<title>in a script</title><img src=x>"</script><style>img{}</style>
      <template><img src="/t.jpg"></template><noscript><img src="/n.jpg"></noscript><p>hello</p></body>`)
    expect(p.title).toBeNull()
    expect(metaOf(p, 'description')).toBeNull()
    expect(p.images).toEqual([])
    expect(p.text).toBe('hello')
  })
  it('reads JSON-LD blocks by type (any case, with a charset), parsed or with the reason', () => {
    const p = parsePage(`<script type="APPLICATION/LD+JSON; charset=utf-8">{"@type":"WebSite"}</script>
      <script type='application/ld+json'>{broken</script><script type="text/javascript">{"@type":"No"}</script>`)
    expect(p.ld).toHaveLength(2)
    expect(p.ld[0]).toEqual(expect.objectContaining({ parsed: { '@type': 'WebSite' }, error: null }))
    expect(p.ld[1].error).toBeTruthy()
  })
  it('gives visible words: body text only, entities decoded, whitespace collapsed', () => {
    const p = parsePage('<html><head><title>T</title></head><body><h1>About</h1><p>I&#x27;m   <b>Skeen</b></p><svg><text>logo</text></svg></body></html>')
    expect(p.text).toBe("About I'm Skeen")
  })
  it('lets an unclosed svg hide the rest (as a browser does), and closes nested svgs in order', () => {
    expect(parsePage('<body><svg><svg></svg><title>inner</title></svg><title>Real</title></body>').title).toBe('Real')
    expect(parsePage('<body><svg><p>x</p><title>hidden</title>').title).toBeNull()
  })
  it('never throws on junk, and finishes a hostile page quickly', () => {
    for (const junk of ['', '<', '<<<>>>', '<!--', '<script>', '<a href="', '<img alt=\'x', '<!DOCTYPE', '</>', '<\u0000>']) {
      expect(() => parsePage(junk)).not.toThrow()
    }
    const t = Date.now()
    parsePage(`<p ${'"'.repeat(200_000)}>` + '<script>'.repeat(50_000) + '<!--'.repeat(50_000))
    expect(Date.now() - t).toBeLessThan(3000)
  })
})

describe('ldNodes / typesOf', () => {
  it('reads @graph (array or one object), a top-level array, one node, and a node beside a graph', () => {
    expect(ldNodes({ '@graph': [{ '@type': 'A' }, { '@type': 'B' }] })).toHaveLength(2)
    expect(ldNodes({ '@graph': { '@type': 'A' } })).toEqual([{ '@type': 'A' }])
    expect(ldNodes([{ '@type': 'A' }, [{ '@type': 'B' }]])).toHaveLength(2)
    expect(ldNodes({ '@type': 'A' })).toHaveLength(1)
    expect(ldNodes({ '@type': 'WebPage', '@graph': [{ '@type': 'B' }] })).toHaveLength(2)
    expect(ldNodes('x')).toEqual([])
    expect(ldNodes(null)).toEqual([])
  })
  it('drops the schema.org prefix and reads type arrays', () => {
    expect(typesOf({ '@type': ['schema:MusicGroup', 'https://schema.org/Organization', 3] })).toEqual(['MusicGroup', 'Organization'])
  })
})

describe('artistNodeOf', () => {
  const page = (graph: unknown[]) => parsePage(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`)
  it('prefers the #artist id, then the name, then the first, and never a nested node', () => {
    expect(artistNodeOf(page([{ '@type': 'MusicGroup', name: 'A' }, { '@type': 'MusicGroup', '@id': 'x/#artist', name: 'B' }]), 'A')?.name).toBe('B')
    expect(artistNodeOf(page([{ '@type': 'MusicGroup', name: 'A' }, { '@type': 'Person', name: 'Skeen' }]), 'skeen')?.name).toBe('Skeen')
    expect(artistNodeOf(page([{ '@type': 'MusicEvent', performer: { '@type': 'MusicGroup', name: 'Support' } }]), 'Skeen')).toBeNull()
  })
  it('merges nodes that share the artist id across blocks', () => {
    const html = ['{"@type":"MusicGroup","@id":"x/#artist","name":"Skeen"}', '{"@type":"MusicGroup","@id":"x/#artist","genre":"House"}']
      .map((j) => `<script type="application/ld+json">${j}</script>`).join('')
    expect(artistNodeOf(parsePage(html), 'Skeen')).toEqual(expect.objectContaining({ name: 'Skeen', genre: 'House' }))
  })
})

describe('namesArtist / isBareName', () => {
  it('matches the name as a whole word, any case', () => {
    expect(namesArtist('SKEEN · Chicago', 'Skeen')).toBe(true)
    expect(namesArtist('Skeens · Chicago', 'Skeen')).toBe(false)
    expect(namesArtist('Beyoncé live', 'beyoncé')).toBe(true)
    expect(namesArtist('A.B. (live)', 'A.B.')).toBe(true)
    expect(namesArtist('anything', '')).toBe(false)
  })
  it('calls the name plus filler bare, and anything more not', () => {
    expect(isBareName('SKEEN', 'Skeen')).toBe(true)
    expect(isBareName('Skeen — Official Website', 'Skeen')).toBe(true)
    expect(isBareName('Skeen | Home', 'Skeen')).toBe(true)
    expect(isBareName('Skeen · Chicago', 'Skeen')).toBe(false)
    expect(isBareName('Skeen DJ', 'Skeen')).toBe(false)
  })
})

describe('linkKey', () => {
  it('treats www, scheme, trailing slash and tracking params as the same link', () => {
    const k = linkKey('https://www.instagram.com/skeen/')
    expect(linkKey('http://instagram.com/skeen?igsh=abc&utm_source=x')).toBe(k)
    expect(linkKey('https://instagram.com/skeen?si=1')).toBe(k)
  })
  it('keeps a real query and the path’s case, and refuses non-web links', () => {
    expect(linkKey('https://facebook.com/profile.php?id=1')).not.toBe(linkKey('https://facebook.com/profile.php?id=2'))
    expect(linkKey('https://open.spotify.com/artist/AbC')).not.toBe(linkKey('https://open.spotify.com/artist/abc'))
    expect(linkKey('mailto:x@y.com')).toBeNull()
    expect(linkKey('nope')).toBeNull()
  })
})

describe('dayOf', () => {
  it('reads a date or datetime, and refuses impossible dates', () => {
    expect(dayOf('2026-10-15')).toBe('2026-10-15')
    expect(dayOf('2026-10-15T21:00:00-05:00')).toBe('2026-10-15')
    expect(dayOf('2026-02-30')).toBeNull()
    expect(dayOf('soon')).toBeNull()
    expect(dayOf(20261015)).toBeNull()
  })
})

describe('pageState', () => {
  it('says why a page cannot be read, and marks a page with no answer', () => {
    expect(pageState(undefined, '/')).toEqual(expect.objectContaining({ ok: false, noAnswer: true }))
    expect(pageState({ path: '/', finalUrl: null, status: null, headers: {}, html: null, error: 'timeout' }, '/')).toEqual(expect.objectContaining({ ok: false, noAnswer: true, why: 'your home page didn’t answer (it timed out)' }))
    expect(pageState({ path: '/x', finalUrl: 'u', status: 404, headers: {}, html: null }, '/x')).toEqual(expect.objectContaining({ ok: false, noAnswer: false }))
    expect(pageState({ path: '/x', finalUrl: 'u', status: 200, headers: {}, html: null }, '/x')).toEqual(expect.objectContaining({ ok: false, why: 'your page /x isn’t a web page' }))
    expect(pageState({ path: '/', finalUrl: 'u', status: 200, headers: {}, html: '<p>x</p>', truncated: true }, '/')).toEqual(expect.objectContaining({ ok: true, truncated: true }))
  })
})
