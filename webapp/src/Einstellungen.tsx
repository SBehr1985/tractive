import { useState } from 'react'
import { api, type Position, type Uebersicht } from './api'

const FELDER: [string, string, string][] = [
  ['zuhause_radius_m', 'Radius um Zuhause (m)', 'Ab dieser Entfernung gilt der Hund als unterwegs.'],
  ['pause_min', 'Pause beendet Runde nach (min)', 'So lange an einem Ort = Runde endet dort (Café, Besuch).'],
  ['pause_radius_m', 'Pause-Radius (m)', '„An einem Ort“ heißt innerhalb dieses Radius.'],
  ['min_dauer_min', 'Mindestdauer (min)', 'Kürzere Ausflüge werden ignoriert.'],
  ['min_strecke_m', 'Mindeststrecke (m)', 'Kürzere Ausflüge werden ignoriert.'],
]

type Props = { hund: Uebersicht; position: Position | null; gespeichert: (u: Uebersicht) => void }

export default function Einstellungen({ hund, position, gespeichert }: Props) {
  const e = hund.einstellungen
  const [werte, setWerte] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v == null ? '' : String(v)])))
  const [status, setStatus] = useState('')
  const setze = (k: string, v: string) => setWerte(w => ({ ...w, [k]: v }))

  async function speichern() {
    setStatus('Speichere und berechne Runden neu …')
    try {
      const body = Object.fromEntries(Object.entries(werte).map(([k, v]) => [k, v.trim() === '' ? null : Number(v.replace(',', '.'))]))
      gespeichert(await api.einstellungen(hund.id, body))
      setStatus('Gespeichert, Runden neu berechnet.')
    } catch (err) {
      setStatus((err as Error).message)
    }
  }

  return (
    <section className="card einstellungen">
      <h3>Zuhause</h3>
      <p className="sub">
        {hund.zuhause
          ? hund.zuhause.auto ? `Automatisch erkannt (wo ${hund.name} nachts ist): ${hund.zuhause.lat.toFixed(5)}, ${hund.zuhause.lon.toFixed(5)}`
                              : `Fest eingestellt: ${hund.zuhause.lat.toFixed(5)}, ${hund.zuhause.lon.toFixed(5)}`
          : 'Noch nicht bekannt.'}
      </p>
      <div className="formzeile">
        <label>Breite<input value={werte.zuhause_lat ?? ''} onChange={x => setze('zuhause_lat', x.target.value)} placeholder="automatisch" /></label>
        <label>Länge<input value={werte.zuhause_lon ?? ''} onChange={x => setze('zuhause_lon', x.target.value)} placeholder="automatisch" /></label>
      </div>
      <div className="knoepfe">
        {position && <button onClick={() => { setze('zuhause_lat', position.lat.toFixed(6)); setze('zuhause_lon', position.lon.toFixed(6)) }}>
          Aktuelle Position übernehmen</button>}
        <button onClick={() => { setze('zuhause_lat', ''); setze('zuhause_lon', '') }}>Automatisch</button>
      </div>

      <h3>Rundenerkennung</h3>
      {FELDER.map(([k, label, hilfe]) => (
        <label key={k} className="feld">
          <span>{label}<small>{hilfe}</small></span>
          <input inputMode="decimal" value={werte[k] ?? ''} onChange={x => setze(k, x.target.value)} />
        </label>
      ))}
      <div className="knoepfe">
        <button className="primaer" onClick={speichern}>Speichern</button>
        <span className="sub">{status}</span>
      </div>

      <h3>Datenabgleich</h3>
      <p className="sub">
        Letzter Abgleich mit Tractive: {hund.letzter_sync ? new Date(hund.letzter_sync).toLocaleString('de-DE') : '–'}.
        Der Server holt alle 15 Minuten neue Positionen und speichert den Aktivitätsverlauf jeden Abend um 23:55.
      </p>
      {hund.sync_fehler && <p className="fehler">Letzter Fehler: {hund.sync_fehler}</p>}
    </section>
  )
}
