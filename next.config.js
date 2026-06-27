/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@tensorflow/tfjs', '@tensorflow-models/pose-detection'],
  turbopack: {
    resolveAlias: {
      '@mediapipe/pose': './lib/mediapipe-stub.js',
      '@mediapipe/hands': './lib/mediapipe-stub.js',
    },
  },
}

module.exports = nextConfig
