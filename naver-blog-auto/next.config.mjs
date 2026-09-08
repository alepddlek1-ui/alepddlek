/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 / playwright 는 네이티브 모듈이라 번들에 넣으면 안 된다.
  serverExternalPackages: ["better-sqlite3", "playwright"],
};
export default nextConfig;
