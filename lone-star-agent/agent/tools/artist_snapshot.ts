import { defineTool } from "eve/tools";
import { z } from "zod";
import { getArtistSnapshot } from "#lib/lonestar.js";

export default defineTool({
  description:
    "What's here for one artist: which integrations are connected (Spotify, " +
    "Bandsintown, etc.) and how many releases, tracks (released vs unreleased), " +
    "media, links, and merch exist. Accepts an artist id, slug, or name.",
  inputSchema: z.object({
    artist: z
      .string()
      .min(1)
      .describe("Artist id (uuid), slug, or exact name."),
  }),
  async execute({ artist }) {
    const snapshot = await getArtistSnapshot(artist);
    if (!snapshot) {
      return { found: false as const, artist };
    }
    return { found: true as const, ...snapshot };
  },
});
