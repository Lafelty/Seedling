/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@tensorflow/tfjs', '@tensorflow-models/pose-detection'],
  serverExternalPackages: ['@mediapipe/pose'],
}

module.exports = nextConfig
