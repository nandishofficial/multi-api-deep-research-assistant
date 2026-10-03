import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (set NEXT_OUTPUT=standalone there).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // These packages read files (fonts, wasm) at runtime; load them from node_modules instead of bundling.
  serverExternalPackages: ["pdfmake", "pdfkit", "fontkit", "postgres", "nodemailer", "@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfmake/fonts/**/*", "./drizzle/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
