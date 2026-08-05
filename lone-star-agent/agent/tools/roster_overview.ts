import { defineTool } from "eve/tools";
import { z } from "zod";
import { listArtists, getArtistSnapshot } from "#lib/lonestar.js";

export default defineTool({
  description:
    "Summarize the whole roster at once: totals across every artist for " +
    "releases, tracks (released vs unreleased), media, links, merch, and " +
    "connected integrations, plus a per-artist breakdown. No input needed.",
  inputSchema: z.object({}),
  async execute() {
    const roster = await listArtists();
    const snaps = (
      await Promise.all(roster.map((a) => getArtistSnapshot(a.slug)))
    ).filter((s) => s !== null);
    const totals = snaps.reduce(
      (t, s) => ({
        releases: t.releases + s.counts.releases,
        tracksReleased: t.tracksReleased + s.counts.tracks.released,
        tracksUnreleased: t.tracksUnreleased + s.counts.tracks.unreleased,
        media: t.media + s.counts.media,
        links: t.links + s.counts.links,
        merch: t.merch + s.counts.merch,
        connected: t.connected + s.connectedCount,
      }),
      { releases: 0, tracksReleased: 0, tracksUnreleased: 0, media: 0, links: 0, merch: 0, connected: 0 },
    );
    return {
      artistCount: snaps.length,
      totals,
      artists: snaps.map((s) => ({
        name: s.name,
        slug: s.slug,
        connected: s.connectedCount,
        counts: s.counts,
      })),
    };
  },
});
