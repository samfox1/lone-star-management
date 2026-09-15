/**
 * How hot each city glows (Sam, 2026-09-15: "when he gets millions of views, will the whole map be
 * red? Should it be relative?"). Glows stack where they overlap, so a fixed strength per city turned
 * every busy region red, and a bigger audience (more cities) only spread the red further.
 *
 * The heat is RELATIVE to the busiest spot at the zoom it is seen at. A city's DENSITY is its
 * neighbours' visitors weighted by how far their glow reaches it (the glow falls off linearly to
 * `reach`, in the same units as the points); the busiest density is the top of the ramp. Each city's
 * opacity is chosen so stacked glows add up to that share: 1 − (1 − HEAT_PEAK)^(visitors ÷ busiest),
 * because SVG stacks opacities as 1 − Π(1 − a), and those multiply into (1 − HEAT_PEAK)^(density ÷
 * busiest). So the busiest spot reaches dark red and no further, a spot half as busy is clearly cooler,
 * and the same audience at any size glows the same. Pure.
 */

/** The combined opacity at the busiest spot: the top of the colour ramp, dark red. */
export const HEAT_PEAK = 0.95
/** The least a PLACE glows, so a small one beside a big audience still shows. It lifts a faint neighbourhood as a
 *  whole: a floor per city let a hundred one-visitor towns stack their floors into red. */
export const HEAT_MIN = 0.04
/** The share of the busiest spot at which a neighbourhood glows HEAT_MIN. */
const MIN_SHARE = Math.log(1 - HEAT_MIN) / Math.log(1 - HEAT_PEAK)

export type HeatPoint = { x: number; y: number; visitors: number }

/** Each point's glow opacity, in order. Neighbours are bucketed by `reach`, so thousands of cities stay cheap. */
export function heatAlphas(points: HeatPoint[], reach: number): number[] {
  if (points.length === 0) return []
  const cellOf = (v: number) => Math.floor(v / reach)
  const cells = new Map<string, number[]>()
  points.forEach((p, i) => {
    const key = `${cellOf(p.x)}|${cellOf(p.y)}`
    const list = cells.get(key)
    if (list) list.push(i)
    else cells.set(key, [i])
  })

  let busiest = 0
  const densities = points.map((p) => {
    const cx = cellOf(p.x), cy = cellOf(p.y)
    let density = 0
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx}|${cy + dy}`) ?? []) {
          const q = points[j]
          const falloff = 1 - Math.hypot(p.x - q.x, p.y - q.y) / reach
          if (falloff > 0) density += q.visitors * falloff
        }
      }
    }
    if (density > busiest) busiest = density
    return density
  })
  if (busiest <= 0) return points.map(() => 0)
  return points.map((p, i) => {
    if (densities[i] <= 0) return 0
    // Its share of the busiest spot; where its whole neighbourhood is fainter than HEAT_MIN, lifted so the neighbourhood shows at it.
    const share = Math.max(p.visitors / busiest, (MIN_SHARE * p.visitors) / densities[i])
    return 1 - (1 - HEAT_PEAK) ** share
  })
}
