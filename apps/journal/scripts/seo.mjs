// The two publications share routes/content, but never canonical origins.
process.env.SITE_ORIGIN ||= "https://itshades.dev";
await import("../../web/scripts/seo.mjs");
