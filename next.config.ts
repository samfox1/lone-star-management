import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
