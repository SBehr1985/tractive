export const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const zwei = (n: number) => String(n).padStart(2, '0')

export const uhrzeit = (ts: number) => { const d = new Date(ts * 1000); return zwei(d.getHours()) + ':' + zwei(d.getMinutes()) }
export const tagSchluessel = (d: Date) => d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate())
export const tagVon = (ts: number) => tagSchluessel(new Date(ts * 1000))
export const datumLang = (d: Date) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
export const km = (m: number) => (m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const zahl = (x: number, stellen = 1) => x.toLocaleString('de-DE', { maximumFractionDigits: stellen })

export function dauer(s: number) {
  const min = Math.round(s / 60)
  if (min < 60) return min + ' min'
  return Math.floor(min / 60) + ' h ' + zwei(min % 60) + ' min'
}
export const entfernung = (m: number) => (m < 1000 ? Math.round(m) + ' m' : km(m) + ' km')

export function tagName(k: string) {
  const heute = tagSchluessel(new Date())
  const gestern = tagSchluessel(new Date(Date.now() - 86400000))
  return k === heute ? 'Heute' : k === gestern ? 'Gestern' : datumLang(new Date(k + 'T12:00:00'))
}

export function wochenStart(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x
}
export function kw(d: Date) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const t = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - t)
  const j = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x.getTime() - j.getTime()) / 86400000 + 1) / 7)
}
export function letzteTage(n: number) {
  const h = new Date(); h.setHours(0, 0, 0, 0)
  const out: Date[] = []
  for (let i = n - 1; i >= 0; i--) { const d = new Date(h); d.setDate(d.getDate() - i); out.push(d) }
  return out
}

export function abstandM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180
  const dp = p2 - p1, dl = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Runde läuft vermutlich noch: endet unterwegs, der letzte Punkt ist jung und
 *  der Hund wurde seitdem nicht wieder zu Hause geortet (zuhauseSeit = Zeit der Position zu Hause). */
export const laeuftNoch = (r: { ende: number; ende_zuhause: boolean }, zuhauseSeit?: number | null) =>
  !r.ende_zuhause && Date.now() / 1000 - r.ende < 15 * 60 && !(zuhauseSeit && zuhauseSeit > r.ende)
