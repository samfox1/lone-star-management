/**
 * Small malformed pages and sitemaps, with the answers the OLD regex readers gave, so the
 * faster readers can be held to reading them exactly the same.
 *
 * Code:     support file (not a test): feeds tests/unit/safe-fetching/slow-parsers.test.ts,
 *           which reads these with src/lib/seo-tests/html.ts (`parsePage`) and fresh.ts
 *           (`sitemapLastmods`)
 * Feature:  the page and sitemap readers every SEO test stands on
 * Tier:     STRICT (AGENTS.md "Test depth"): the readers are parsers of untrusted html; this is
 *           the "keep behaviour" half of their rewrite for speed.
 * What it provides:
 *           • PAGES: 30 small broken pages (unclosed tags and quotes, tags in scripts and
 *             comments, odd spacing and capitals, entities)
 *           • SITEMAPS: 10 small broken sitemaps (spaces, unclosed tags, CDATA, capitals)
 *           • RECORDED: what the old regex readers returned for each, recorded 2026-09-29
 *             before the linear rewrite
 * Not here: the timed worst-case inputs (tests/unit/safe-fetching/slow-parsers.test.ts builds
 *           them at full size); normal page reading (page-reading/html.test.ts).
 * Fixtures: recorded output, not a hand-copy of the implementation: regenerate only on
 *           purpose. The one deliberate difference is marked where it sits.
 */
export const PAGES: string[] = [
  '<p>one <a href="x two <b>three</b></p>',
  '<p>a <a href=\'x >b</a> c</p><a href="/ok">ok</a>',
  '<a href="x">1</a><a href="y>2</a><a href="z">3</a>',
  '<img alt="a"b" src="c"><p>t</p>',
  '<div class="a>b" id=\'c>d\'>text</div>',
  '<br/><br /><img src="x"/><p>after</p>',
  '<a href=x>unquoted</a><a href = "sp aced" >s</a>',
  '<title>T</title><title>U</title><p>x</p>',
  '<p>1 < 2 and 3 > 2</p><a href="#">h</a>',
  '<p>a <3 b</p><<p>>c</p>',
  '<script>var s = "<a href=\\"x\\">";</script><p>vis</p>',
  '<script type="application/ld+json">{"@type":"MusicGroup","name":"X"}</script><p>y</p>',
  '<a href="1"<a href="2">two</a>',
  "<a href='1' title=\"q'q\">m</a><a href=\"2\" title='d\"d'>n</a>",
  '<p>text</p><a href="never closed',
  '<meta name="description" content="a > b"><meta property="og:title" content=\'T\'>',
  '<link rel="canonical" href="https://x.test/"><link rel=canonical href=/y>',
  '<svg><title>no</title></svg><title>yes</title>',
  '<template><a href="/hidden">h</a></template><a href="/shown">s</a>',
  '<noscript><img src="n.png"></noscript><img src="y.png">',
  '<a\thref="tab">t</a><a\nhref="nl">n</a>',
  '<A HREF="/UP">u</A><IMG SRC="I.PNG">',
  '</p><p/>x<p/ >y',
  '<a href="x" "y" z>q</a>',
  '<!-- <a href="c">c</a> --><a href="d">d</a>',
  '<!doctype html><?xml x?><a href="e">e</a>',
  '<a href="&amp;&lt;">ent</a><p>&amp; &#x27;q&#39; &nbsp;</p>',
  '< a href="notatag">x</a>',
  '<1a>num</1a><a1 href="w">w</a1>',
  '<p title="unclosed>then</p><a href="after">a</a>',
]

export const SITEMAPS: string[] = [
  '<urlset><url><lastmod> 2026-09-01 </lastmod></url><url><lastmod>2026-09-02T10:00:00Z</lastmod></url></urlset>',
  '<lastmod>a<lastmod>2026-01-01</lastmod>',
  '<lastmod>   </lastmod><lastmod>x</lastmod>',
  '<lastmod>\n2026-03-03\t</lastmod>',
  '<lastmod>no close',
  '<lastmod><![CDATA[2026]]></lastmod><lastmod>2026-04-04</lastmod>',
  '<LASTMOD>2026</LASTMOD><lastmod>2026-05-05</lastmod >',
  '<sitemapindex><lastmod>2026</lastmod></sitemapindex>',
  '<SITEMAPINDEX>x</SITEMAPINDEX><lastmod>2026</lastmod>',
  '',
]

export const RECORDED = {
 "pages": [
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "one < a href=\"x two three"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "/ok"
   ],
   "images": [],
   "ld": [],
   "text": "a < a href='x >b c ok"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "x",
    "z"
   ],
   "images": [],
   "ld": [],
   "text": "1 < a href=\"y>2 3"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "< img alt=\"a\"b\" src=\"c\"> t"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "text"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [
    {
     "src": "x"
    }
   ],
   "ld": [],
   "text": "after"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "x",
    "sp aced"
   ],
   "images": [],
   "ld": [],
   "text": "unquoted s"
  },
  {
   "title": "T",
   "titleCount": 2,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "x"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "#"
   ],
   "images": [],
   "ld": [],
   "text": "1 < 2 and 3 > 2 h"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "a < 3 b < >c"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "vis"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [
    {
     "raw": "{\"@type\":\"MusicGroup\",\"name\":\"X\"}",
     "parsed": {
      "@type": "MusicGroup",
      "name": "X"
     },
     "error": null
    }
   ],
   "text": "y"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "1"
   ],
   "images": [],
   "ld": [],
   "text": "two"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "1",
    "2"
   ],
   "images": [],
   "ld": [],
   "text": "m n"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "text < a href=\"never closed"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {
    "description": [
     "a > b"
    ],
    "og:title": [
     "T"
    ]
   },
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": ""
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": "https://x.test/",
   "links": [],
   "images": [],
   "ld": [],
   "text": ""
  },
  {
   "title": "yes",
   "titleCount": 1,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": ""
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "/shown"
   ],
   "images": [],
   "ld": [],
   "text": "s"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [
    {
     "src": "y.png"
    }
   ],
   "ld": [],
   "text": ""
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "tab",
    "nl"
   ],
   "images": [],
   "ld": [],
   "text": "t n"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "/UP"
   ],
   "images": [
    {
     "src": "I.PNG"
    }
   ],
   "ld": [],
   "text": "u"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "x y"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "x"
   ],
   "images": [],
   "ld": [],
   "text": "q"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "d"
   ],
   "images": [],
   "ld": [],
   "text": "d"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "e"
   ],
   "images": [],
   "ld": [],
   "text": "e"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "&<"
   ],
   "images": [],
   "ld": [],
   "text": "ent & 'q'"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "< a href=\"notatag\">x"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [],
   "images": [],
   "ld": [],
   "text": "< 1a>num < /1a> w"
  },
  {
   "title": null,
   "titleCount": 0,
   "meta": {},
   "canonical": null,
   "links": [
    "after"
   ],
   "images": [],
   "ld": [],
   "text": "< p title=\"unclosed>then a"
  }
 ],
 "sitemaps": [
  [
   "2026-09-01",
   "2026-09-02T10:00:00Z"
  ],
  [
   "2026-01-01"
  ],
  [
   // DELIBERATE CHANGE: the old regex returned " " for a whitespace-only <lastmod>. A blank is
   // no value (it was never a date either), so the linear reader drops it.
   "x"
  ],
  [
   "2026-03-03"
  ],
  [],
  [
   "2026-04-04"
  ],
  [],
  [],
  [],
  []
 ]
} as const
