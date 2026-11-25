import { useEffect, useMemo, useState } from 'react'
import { api, type Config, type Position, type Runde, type Zuhause } from './api'
import { datumLang, dauer, entfernung, km, laeuftNoch, tagName, tagVon, uhrzeit, zahl } from './format'
import Karte from './Karte'

type Props = {
  hundId: string; config: Config; runden: Runde[]; zuhause: Zuhause | null
  position: Position | null; fokusPosition: number   // Zähler: erhöht = Position auf Karte zeigen
  zuhauseSeit: number | null   // Zeit der letzten Position, wenn sie zu Hause war
}

export default function Runden({ hundId, config, runden, zuhause, position, fokusPosition, zuhauseSeit }: Props) {
  const [auswahl, setAuswahl] = useState<number | null>(runden[0]?.start ?? null)
  const [details, setDetails] = useState<Record<number, Runde>>({})
  const [detailOffen, setDetailOffen] = useState(false)
  const [fokus, setFokus] = useState<'runde' | 'position'>('runde')

  useEffect(() => { if (auswahl == null && runden.length) setAuswahl(runden[0].start) }, [runden, auswahl])
  useEffect(() => { if (fokusPosition) { setFokus('position'); setDetailOffen(true) } }, [fokusPosition])

  useEffect(() => {
    if (auswahl == null || details[auswahl]) return
    api.runde(hundId, auswahl).then(r => setDetails(d => ({ ...d, [auswahl]: r }))).catch(() => {})
  }, [hundId, auswahl, details])

  const tage = useMemo(() => {
    const m = new Map<string, Runde[]>()
    for (const r of runden) {   // runden kommen neueste zuerst -> durchgehende Zeitleiste
      const k = tagVon(r.start)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m]
  }, [runden])

  const r = auswahl != null ? details[auswahl] ?? runden.find(x => x.start === auswahl) ?? null : null

  function waehlen(start: number) {
    setAuswahl(start); setFokus('runde'); setDetailOffen(true); window.scrollTo({ top: 0 })
  }

  return (
    <section className={'runden-ansicht' + (detailOffen ? ' detail-offen' : '')}>
      <div className="card liste-box">
        {!runden.length && <div className="leer">Noch keine Runden erkannt.</div>}
        {tage.map(([k, liste]) => (
          <div key={k}>
            <div className="tag">
              <span>{tagName(k)}</span>
              <span>{dauer(liste.reduce((s, x) => s + x.dauer_s, 0))} · {km(liste.reduce((s, x) => s + x.strecke_m, 0))} km</span>
            </div>
            {liste.map(x => (
              <div key={x.start} className={'runde' + (x.start === auswahl ? ' aktiv' : '')} onClick={() => waehlen(x.start)}>
                <div className="zeit">
                  {uhrzeit(x.start)} – {laeuftNoch(x, zuhauseSeit) ? 'jetzt' : uhrzeit(x.ende)}
                  {laeuftNoch(x, zuhauseSeit) ? <span className="badge live">läuft</span>
                    : !x.ende_zuhause ? <span className="badge">endet unterwegs</span>
                    : !x.start_zuhause ? <span className="badge">startet unterwegs</span> : null}
                </div>
                <div className="werte">{dauer(x.dauer_s)}</div>
                <div className="klein">Ø {zahl(x.strecke_m / 1000 / (x.dauer_s / 3600))} km/h</div>
                <div className="werte klein">{km(x.strecke_m)} km</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="card detail-box">
        <button className="zurueck" onClick={() => setDetailOffen(false)}>‹ Alle Runden</button>
        {r && fokus === 'runde' ? (
          <>
            <h2>{datumLang(new Date(r.start * 1000))}</h2>
            <div className="sub">
              {uhrzeit(r.start)} – {uhrzeit(r.ende)} Uhr · {r.start_zuhause ? 'Start zu Hause' : 'Start unterwegs'} ·{' '}
              {laeuftNoch(r, zuhauseSeit) ? 'läuft gerade' : r.ende_zuhause ? 'Ende zu Hause' : 'Ende unterwegs (Pause)'}
            </div>
          </>
        ) : fokus === 'position' && position ? (
          <><h2>Letzte Position</h2><div className="sub">{uhrzeit(position.zeit)} Uhr</div></>
        ) : <h2>Keine Runde ausgewählt</h2>}
        <Karte config={config} zuhause={zuhause} runde={fokus === 'runde' ? r : null}
               position={position} fokus={fokus} />
        {r && fokus === 'runde' && (
          <div className="kacheln">
            <div className="kachel"><div className="w">{dauer(r.dauer_s)}</div><div className="l">Dauer</div></div>
            <div className="kachel"><div className="w">{km(r.strecke_m)} km</div><div className="l">Strecke</div></div>
            <div className="kachel"><div className="w">{zahl(r.strecke_m / 1000 / (r.dauer_s / 3600))} km/h</div><div className="l">Ø Tempo</div></div>
            <div className="kachel"><div className="w">{entfernung(r.max_entfernung_m)}</div><div className="l">max. von zu Hause</div></div>
          </div>
        )}
      </div>
    </section>
  )
}
