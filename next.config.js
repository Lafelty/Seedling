/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@tensorflow/tfjs', '@tensorflow-models/pose-detection'],
}

module.exports = nextConfig
