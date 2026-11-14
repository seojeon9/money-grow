/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Next 14의 webpack은 node:sqlite를 내장 모듈로 인식하지 못하므로 번들에서 제외합니다.
    if (isServer) config.externals.push({ "node:sqlite": "commonjs node:sqlite" });
    return config;
  },
};

export default nextConfig;
