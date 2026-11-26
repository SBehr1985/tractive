// Kleine Strich-Icons (24er Raster, im Stil von Lucide), Farbe über currentColor.
const PFADE: Record<string, string> = {
  uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  strecke: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19h8a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7h8"/>',
  tempo: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  haus: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  weg: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h4"/><path d="M14 17h7m-3-3 3 3-3 3"/>',
  akku: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  ziel: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  sync: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M8 16H3v5"/>',
  links: '<path d="m15 18-6-6 6-6"/>',
  rechts: '<path d="m9 18 6-6-6-6"/>',
  karte: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  balken: '<path d="M6 20v-5M12 20V9M18 20V4"/>',
  aktiv: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  regler: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
  abmelden: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  pfote: '<circle cx="7" cy="9" r="2"/><circle cx="17" cy="9" r="2"/><circle cx="10" cy="4.5" r="1.8"/><circle cx="14" cy="4.5" r="1.8"/><path d="M12 12c-3 0-5.5 3-5.5 5.5 0 2 1.5 3 3 3 1 0 1.5-.5 2.5-.5s1.5.5 2.5.5c1.5 0 3-1 3-3 0-2.5-2.5-5.5-5.5-5.5Z"/>',
  schlaf: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  kalender: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alle: '<path d="M3 6h18M3 12h18M3 18h18"/>',
}

export default function Icon({ name, size = 16, title }: { name: string; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true}
         role={title ? 'img' : undefined} dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + (PFADE[name] ?? '') }} />
  )
}

/** Kleines Abzeichen: Icon + Wert. */
export function Badge({ icon, children, title, ton }: { icon: string; children: React.ReactNode; title?: string; ton?: 'ok' | 'warn' | 'live' }) {
  return <span className={'badge-i' + (ton ? ' ' + ton : '')} title={title}><Icon name={icon} size={13} />{children}</span>
}
