import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { ERROR_TEXT } from './styles'

/** A refusal, in the validator's own words, under (or beside) the thing it refuses: red Space
 *  Mono with a snug leading, and `role="alert"` so it is read out. Every inline error in the
 *  manager tools is this one (Batch 2, 2026-10-02). */
export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={cx(ERROR_TEXT, 'leading-snug')}>
      {children}
    </p>
  )
}
