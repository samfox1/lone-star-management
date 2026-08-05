import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAnalyticsSummary, resolveArtistId } from "#lib/lonestar.js";

export default defineTool({
  description:
    "Event/analytics counts for one artist over a recent window, grouped by event " +
    "type (e.g. page views). Accepts an artist id, slug, or name and a number of " +
    "days to look back.",
  inputSchema: z.object({
    artist: z.string().min(1).describe("Artist id (uuid), slug, or exact name."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("How many days back to summarize."),
  }),
  async execute({ artist, days }) {
    const resolved = await resolveArtistId(artist);
    if (!resolved) return { found: false as const, artist };
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await getAnalyticsSummary(resolved.id, sinceIso);
    const total = rows.reduce((sum, r) => sum + Number(r.count ?? 0), 0);
    return {
      found: true as const,
      artist: resolved.name,
      windowDays: days,
      since: sinceIso,
      total,
      byType: rows,
    };
  },
});
