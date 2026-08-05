import { defineTool } from "eve/tools";
import { z } from "zod";
import { listArtists } from "#lib/lonestar.js";

export default defineTool({
  description:
    "List every artist on the manager's roster (name and slug). Use to see the " +
    "whole roster or to resolve which artist the manager means.",
  inputSchema: z.object({}),
  async execute() {
    const artists = await listArtists();
    return { count: artists.length, artists };
  },
});
