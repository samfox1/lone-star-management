import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@lone-star/music-rules` is a workspace package that ships RAW TypeScript (no build
  // step), so both this app and the standalone agent consume one source file instead of a
  // compiled artifact that could go stale. Next only runs its compiler over node_modules
  // when told to, and the package resolves through a node_modules symlink — without this
  // the import fails to parse at build time.
  transpilePackages: ["@lone-star/music-rules"],
  experimental: {
    // Client-side revisit cache. Re-serve a dashboard page from the browser's Router
    // Cache for 30s before refetching, so navigating away and back is instant instead
    // of re-running the server render + DB queries every time. (This was Next's own
    // default before v15, which changed it to 0 = always refetch.) Shared layouts are
    // already preserved across soft navigation; this covers the page segment. Writes
    // call revalidatePath, which busts the cache so a save still shows fresh data.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
