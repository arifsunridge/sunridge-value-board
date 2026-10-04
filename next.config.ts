import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // Task content must never reach logs (ADR 0002).
  logging: { fetches: { fullUrl: false } },
};

export default config;
