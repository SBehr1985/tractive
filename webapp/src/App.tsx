import { useCallback, useEffect, useState } from 'react'
import { api, NichtAngemeldet, type AktivTag, type Config, type Me, type Position, type Runde, type Uebersicht } from './api'
import Aktivitaet from './Aktivitaet'
import Einstellungen from './Einstellungen'
import { abstandM, entfernung, uhrzeit } from './format'
import Icon, { Badge } from './Icon'
import Login from './Login'
import Runden from './Runden'
import Statistik from './Statistik'

type Ansicht = 'runden' | 'statistik' | 'aktivitaet' | 'einstellungen'
const ANSICHTEN: [Ansicht, string, string][] = [
  ['runden', 'karte', 'Karte'], ['statistik', 'balken', 'Statistik'], ['aktivitaet', 'aktiv', 'Aktivität'], ['einstellungen', 'regler', 'Einstellungen'],
]

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
        <h1><Icon name="pfote" size={22} /> Kein Hund verbunden</h1>
        <p className="sub">Mit {me.email} ist in Tractive kein Tracker verbunden.</p>
        <button onClick={abmelden}><Icon name="abmelden" /> Abmelden</button>
      </div></div>
    )
  }

  const z = hund?.zuhause
  const weg = position && z ? abstandM(z.lat, z.lon, position.lat, position.lon) : null
  const zuHause = weg != null && weg <= z!.radius_m
  const stand = hund?.letzter_sync ? new Date(hund.letzter_sync) : null

  return (
    <div className="app">
      <header className="topbar">
        <div className="titel">
          <Icon name="pfote" size={18} />
          {me.hunde.length > 1 ? (
            <select value={aktuellerHund?.id} onChange={e => { setHundId(e.target.value); merken('hund', e.target.value) }}>
              {me.hunde.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          ) : <b>{aktuellerHund?.name}</b>}
        </div>
        <div className="badges">
          {position && position.lat != null && (
            <button className="badge-knopf" title={`Letzte Position ${uhrzeit(position.zeit)} – auf Karte zeigen`}
                    onClick={() => { setAnsicht('runden'); setFokusPosition(n => n + 1) }}>
              <Badge icon={zuHause ? 'haus' : 'pin'} ton={zuHause ? undefined : 'live'}>
                {zuHause ? uhrzeit(position.zeit) : entfernung(weg ?? 0)}
              </Badge>
            </button>
          )}
          {position?.akku != null && <Badge icon="akku" ton={position.akku < 20 ? 'warn' : undefined} title="Akku">{position.akku}%</Badge>}
          <button className="icon-knopf" onClick={aktualisieren} disabled={laedt}
                  title={'Jetzt aktualisieren' + (stand ? ' · Stand ' + stand.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '')}>
            <span className={laedt ? 'dreht' : ''}><Icon name="sync" size={17} /></span>
          </button>
          <button className="icon-knopf" onClick={abmelden} title="Abmelden"><Icon name="abmelden" size={17} /></button>
        </div>
      </header>
      {(!me.tractive_ok || hund?.laedt || fehler) && (
        <div className="hinweis">
          {!me.tractive_ok ? 'Tractive-Zugang abgelaufen – bitte ab- und wieder anmelden.'
            : hund?.laedt ? 'Lade die letzten 30 Tage von Tractive …' : fehler}
        </div>
      )}

      <main className={ansicht === 'runden' ? 'voll' : 'scroll'}>
        {!hund || !config ? <div className="leer">Lade …</div>
          : ansicht === 'runden' ? <Runden key={hund.id} hundId={hund.id} config={config} runden={runden} zuhause={hund.zuhause}
                                           position={position} fokusPosition={fokusPosition}
                                           zuhauseSeit={zuHause ? position!.zeit : null} />
          : ansicht === 'statistik' ? <Statistik runden={runden} />
          : ansicht === 'aktivitaet' ? <Aktivitaet tage={aktiv} runden={runden} />
          : <Einstellungen key={hund.id} hund={hund} position={position}
                           gespeichert={u => { setHund(u); api.runden(u.id).then(setRunden) }} />}
      </main>

      <nav className="tabbar">
        {ANSICHTEN.map(([k, icon, name]) => (
          <button key={k} className={ansicht === k ? 'aktiv' : ''} onClick={() => setAnsicht(k)}>
            <Icon name={icon} size={20} /><span>{name}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
