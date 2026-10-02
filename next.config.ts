import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle for the Docker image.
  output: "standalone",
  // These packages read files (fonts) or native bits at runtime; keep them out of the bundle.
  serverExternalPackages: ["pdfmake", "pdfkit", "postgres", "nodemailer", "@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfmake/fonts/**/*", "./drizzle/**/*"],
  },
  poweredByHeader: false,
};

export default nextConfig;
