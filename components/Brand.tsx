import Sprig from '@/components/Sprig'

export default function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand">
    <span className="brand-mark"><Sprig size={25} /></span>
    {!compact && <span>NeuGrow<span className="brand-period">.</span></span>}
  </span>
}
