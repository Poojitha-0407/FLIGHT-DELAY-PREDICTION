/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ["react-map-gl"],

  // In production Vercel serves /api/* from the Python function declared in
  // vercel.json, so nothing is rewritten here. In local development the two
  // run as separate processes (`make api` and `make web`), so point the
  // frontend at uvicorn. This keeps the dev loop working without a Vercel
  // account; `vercel dev` still runs both together if you prefer that.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.LOCAL_API_URL ?? "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};
