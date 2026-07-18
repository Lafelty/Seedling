/** @type {import('next').NextConfig} */

// Derive the Supabase origin so the CSP can name it explicitly (REST, Realtime
// websocket, and storage image host) instead of falling back to a wildcard.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
let supabaseOrigin = ''
try {
  supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : ''
} catch {
  supabaseOrigin = ''
}
const supabaseWs = supabaseOrigin.replace(/^https/, 'wss')

// CSP shipped in Report-Only first: the pose engine compiles WebAssembly
// (MediaPipe tasks-vision) and runs TF.js, so an over-tight policy would break
// the core feature. Watch the browser's CSP violation reports, then switch the
// header key below to 'Content-Security-Policy' to enforce.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 'wasm-unsafe-eval' for MediaPipe/TF.js WebAssembly; Next injects small
  // inline bootstrap scripts, hence 'unsafe-inline'.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim(),
  // The detection worker is bundled from a blob URL; models/bitmaps load as blob:.
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // getUserMedia needs camera explicitly allowed for same-origin; everything
  // else the app never uses is denied.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig = {
  transpilePackages: ['@tensorflow/tfjs', '@tensorflow-models/pose-detection'],
  turbopack: {
    resolveAlias: {
      '@mediapipe/pose': './lib/mediapipe-stub.js',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
