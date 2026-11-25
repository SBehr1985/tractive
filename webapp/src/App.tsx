import { useCallback, useEffect, useState } from 'react'
import { api, NichtAngemeldet, type AktivTag, type Config, type Me, type Position, type Runde, type Uebersicht } from './api'
import Aktivitaet from './Aktivitaet'
import Einstellungen from './Einstellungen'
import { abstandM, entfernung, uhrzeit } from './format'
import Login from './Login'
import Runden from './Runden'
import Statistik from './Statistik'

type Ansicht = 'runden' | 'statistik' | 'aktivitaet' | 'einstellungen'
const ANSICHTEN: [Ansicht, string][] = [['runden', 'Runden'], ['statistik', 'Statistik'], ['aktivitaet', 'Aktivität'], ['einstellungen', 'Einstellungen']]

function merken(k: string, v?: string) {
  try { if (v === undefined) return localStorage.getItem(k) ?? undefined; localStorage.setItem(k, v) } catch { /* privat */ }
  return undefined
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [config, setConfig] = useState<Config | null>(null)
  const [hundId, setHundId] = useState<string | undefined>(merken('hund'))
  const [ansicht, setAnsicht] = useState<Ansicht>('runden')
  const [hund, setHund] = useState<Uebersicht | null>(null)
  const [runden, setRunden] = useState<Runde[]>([])
  const [aktiv, setAktiv] = useState<AktivTag[]>([])
  const [position, setPosition] = useState<Position | null>(null)
  const [fokusPosition, setFokusPosition] = useState(0)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')

  const abgemeldet = (e: unknown) => { if (e instanceof NichtAngemeldet) setMe(null); else setFehler((e as Error).message) }

  useEffect(() => {
    api.me().then(setMe).catch(e => (e instanceof NichtAngemeldet ? setMe(null) : setFehler(e.message)))
    api.config().then(setConfig).catch(() => setConfig({ maptiler_key: '', maptiler_stil: '' }))
  }, [])

  const aktuellerHund = me?.hunde.find(h => h.id === hundId) ?? me?.hunde[0]

  const laden = useCallback(async (id: string) => {
    try {
      const [u, r, a] = await Promise.all([api.uebersicht(id), api.runden(id), api.aktivitaet(id)])
      setHund(u); setRunden(r); setAktiv(a)
      if (u.letzte_position) setPosition(p => p ?? u.letzte_position)
      return u
    } catch (e) { abgemeldet(e); return null }
  }, [])

  useEffect(() => {
    if (!aktuellerHund) return
    const id = aktuellerHund.id
    setHund(null); setRunden([]); setAktiv([]); setPosition(null)
    let stop = false, timer: number | undefined
    const runde = async () => {
      const u = await laden(id)
      if (!stop && u?.laedt) timer = window.setTimeout(runde, 4000)   // erster Abgleich läuft noch
    }
    runde()
    api.position(id).then(p => !stop && setPosition(p)).catch(() => {})
    return () => { stop = true; clearTimeout(timer) }
  }, [aktuellerHund?.id, laden])

  async function aktualisieren() {
    if (!aktuellerHund) return
    const id = aktuellerHund.id, vorher = hund?.letzter_sync
    setLaedt(true)
    try {
      await api.abgleichen(id)
      api.position(id).then(setPosition).catch(() => {})
      for (let i = 0; i < 15; i++) {   // bis der Hintergrund-Abgleich fertig ist (max. ~45 s)
        await new Promise(r => setTimeout(r, 3000))
        const u = await laden(id)
        if (!u || u.letzter_sync !== vorher) break
      }
    } catch (e) { abgemeldet(e) } finally { setLaedt(false) }
  }

  async function abmelden() { await api.logout().catch(() => {}); setMe(null) }

  if (me === undefined) return <div className="leer">Lade …</div>
  if (me === null) return <Login angemeldet={m => { setMe(m); setFehler('') }} />
  if (!me.hunde.length) {
    return (
      <div className="login"><div className="card">
        <h1>Kein Hund verbunden</h1>
        <p className="sub">Mit dem Tractive-Konto {me.email} ist kein Tracker verbunden. Sobald ein Hund in deinem Tractive-Konto
          freigegeben ist, erscheint er hier nach erneuter Anmeldung.</p>
        <button onClick={abmelden}>Abmelden</button>
      </div></div>
    )
  }

  const z = hund?.zuhause
  const weg = position && z ? abstandM(z.lat, z.lon, position.lat, position.lon) : null
  const wo = weg == null ? '' : weg <= z!.radius_m ? 'zu Hause' : entfernung(weg) + ' von zu Hause'

  return (
    <>
      <header>
        <div className="kopfzeile">
          <h1>{aktuellerHund?.name ?? 'Gassi'} – Gassi-Runden</h1>
          <div className="kopf-rechts">
            {me.hunde.length > 1 && (
              <select value={aktuellerHund?.id} onChange={e => { setHundId(e.target.value); merken('hund', e.target.value) }}>
                {me.hunde.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            )}
            <button onClick={aktualisieren} disabled={laedt} title="Jetzt Daten von Tractive holen">{laedt ? 'Lädt …' : '↻'}</button>
            <button onClick={abmelden}>Abmelden</button>
          </div>
        </div>
        <div className="sub">
          {hund?.letzter_sync ? 'Stand: ' + new Date(hund.letzter_sync).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
          {runden.length ? ` · ${runden.length} Runden` : ''}
        </div>
        {!me.tractive_ok && <div className="hinweis">Der Tractive-Zugang ist abgelaufen. Bitte abmelden und neu anmelden, damit wieder Daten kommen.</div>}
        {hund?.laedt && <div className="hinweis">Die Daten der letzten 30 Tage werden gerade von Tractive geladen …</div>}
        {fehler && <div className="hinweis fehler">{fehler}</div>}
        {position && position.lat != null && (
          <div className="card position">
            <span>📍 Letzte Position: <b>{uhrzeit(position.zeit)} Uhr</b>{wo && ' · ' + wo}
              {position.akku != null && ` · Akku ${position.akku} %`}</span>
            <button onClick={() => { setAnsicht('runden'); setFokusPosition(n => n + 1) }}>Auf Karte zeigen</button>
          </div>
        )}
      </header>
      <nav>
        {ANSICHTEN.map(([k, name]) => <button key={k} className={ansicht === k ? 'aktiv' : ''} onClick={() => setAnsicht(k)}>{name}</button>)}
      </nav>
      <main>
        {!hund || !config ? <div className="leer">Lade …</div>
          : ansicht === 'runden' ? <Runden key={hund.id} hundId={hund.id} config={config} runden={runden} zuhause={hund.zuhause}
                                           position={position} fokusPosition={fokusPosition}
                                           zuhauseSeit={weg != null && weg <= z!.radius_m ? position!.zeit : null} />
          : ansicht === 'statistik' ? <Statistik runden={runden} />
          : ansicht === 'aktivitaet' ? <Aktivitaet tage={aktiv} runden={runden} />
          : <Einstellungen key={hund.id} hund={hund} position={position}
                           gespeichert={u => { setHund(u); api.runden(u.id).then(setRunden) }} />}
      </main>
    </>
  )
}
