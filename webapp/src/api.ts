export type Hund = { id: string; name: string }
export type Me = { email: string; tractive_ok: boolean; hunde: Hund[] }
export type Zuhause = { lat: number; lon: number; radius_m: number; auto: boolean }
export type Position = {
  lat: number; lon: number; zeit: number; akku: number | null
  genauigkeit_m?: number | null; quelle?: string | null; veraltet?: boolean
}
export type Einstellungen = Record<string, number | null>
export type Uebersicht = {
  id: string; name: string; zuhause: Zuhause | null; akku: number | null
  letzte_position: Position | null; einstellungen: Einstellungen
  letzter_sync: string | null; sync_fehler: string | null; laedt: boolean
}
export type Runde = {
  start: number; ende: number; dauer_s: number; strecke_m: number; max_entfernung_m: number
  start_zuhause: boolean; ende_zuhause: boolean; punkte?: [number, number, number][]
}
export type AktivTag = {
  tag: string; minuten_aktiv: number | null; segmente: [number, number, string][]
  abgerufen_at: number; vollstaendig: boolean
}
export type Config = { maptiler_key: string; maptiler_stil: string }

export class NichtAngemeldet extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init })
  if (res.status === 401 && !path.endsWith('/login')) throw new NichtAngemeldet()
  if (!res.ok) {
    let msg = ''
    try { msg = (await res.json()).detail } catch { /* keine JSON-Antwort */ }
    throw new Error(msg || `Fehler ${res.status}`)
  }
  return res.json()
}

const h = (id: string) => `/api/hunde/${encodeURIComponent(id)}`

export const api = {
  me: () => call<Me>('/api/auth/me'),
  login: (email: string, password: string) =>
    call<Me>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => call('/api/auth/logout', { method: 'POST' }),
  config: () => call<Config>('/api/config'),
  uebersicht: (id: string) => call<Uebersicht>(h(id)),
  runden: (id: string) => call<Runde[]>(h(id) + '/runden'),
  runde: (id: string, start: number) => call<Runde>(h(id) + '/runden/' + start),
  aktivitaet: (id: string) => call<AktivTag[]>(h(id) + '/aktivitaet'),
  position: (id: string) => call<Position>(h(id) + '/position'),
  einstellungen: (id: string, body: Einstellungen) =>
    call<Uebersicht>(h(id) + '/einstellungen', { method: 'PUT', body: JSON.stringify(body) }),
  abgleichen: (id: string) => call<{ gestartet: boolean; grund?: string }>(h(id) + '/abgleichen', { method: 'POST' }),
}
