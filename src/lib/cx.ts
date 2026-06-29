/** Tiny conditional-className joiner. The repo has no clsx/cn; this is it. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
