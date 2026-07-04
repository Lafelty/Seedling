export default function HealthCheck() {
  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h1>✅ Vercel Deployment Working</h1>
      <p>If you can see this, your deployment is running.</p>
      <p>Environment variables loaded: {typeof process !== 'undefined' ? 'Yes' : 'No'}</p>
      <p>Supabase URL configured: {process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Yes' : 'No'}</p>
      <a href="/">Go to Homepage</a>
    </div>
  )
}
