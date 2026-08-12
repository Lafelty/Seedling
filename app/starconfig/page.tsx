import { permanentRedirect } from 'next/navigation';

export default function StarConfigRedirectPage() {
  permanentRedirect('/admin/patients');
}
