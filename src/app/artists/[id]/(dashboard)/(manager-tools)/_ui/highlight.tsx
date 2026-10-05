import { Fragment } from 'react'
import { highlightSegments } from '@/lib/manager-tools/format'

/**
 * A text with the search's matches marked (Subscribers' emails, Enquiries' senders). The runs
 * are React text and <mark> children, so neither the text nor the query is ever HTML.
 */
export function Highlight({ text, needle }: { text: string; needle: string }) {
  return (
    <>
      {highlightSegments(text, needle).map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="rounded-[2px] bg-[#fff3a3] text-inherit">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  )
}
