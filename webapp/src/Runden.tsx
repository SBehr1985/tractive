import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Config, type Position, type Runde, type Zuhause } from './api'
import { RUNDEN_FARBEN, dauerKurz, entfernung, km, laeuftNoch, tagKurz, tagSchluessel, tagVon, uhrzeit, zahl } from './format'
import Icon, { Badge } from './Icon'
import Karte from './Karte'

type Props = {
  hundId: string; config: Config; runden: Runde[]; zuhause: Zuhause | null
  position: Position | null; fokusPosition: number; zuhauseSeit: number | null
}

const mitternacht = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const plusTage = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return mitternacht(x) }

export default function Runden({ hundId, config, runden, zuhause, position, fokusPosition, zuhauseSeit }: Props) {
  const heute = mitternacht(new Date())
  // Start: Tag der neuesten Runde (meist heute)
  const [tag, setTag] = useState<Date>(() => (runden[0] ? mitternacht(new Date(runden[0].start * 1000)) : heute))
  const [auswahl, setAuswahl] = useState<number | null>(null)
  const [strecken, setStrecken] = useState<Record<string, Runde[]>>({})
  const panel = useRef<HTMLDivElement>(null)
  const [panelHoehe, setPanelHoehe] = useState(160)

  const k = tagSchluessel(tag)
  const tagRunden = useMemo(() => runden.filter(r => tagVon(r.start) === k).sort((a, b) => a.start - b.start), [runden, k])
  const farben = useMemo(() => Object.fromEntries(tagRunden.map((r, i) => [r.start, RUNDEN_FARBEN[i % RUNDEN_FARBEN.length]])), [tagRunden])
  const signatur = tagRunden.map(r => r.start + ':' + r.ende).join(',')

  // Strecken des Tages laden (neu, wenn sich die Runden des Tages ändern)
  useEffect(() => {
    if (!tagRunden.length) return
    const von = tag.getTime() / 1000, bis = plusTage(tag, 1).getTime() / 1000
    let aktiv = true
    api.rundenMitStrecke(hundId, von, bis).then(l => aktiv && setStrecken(s => ({ ...s, [k + '|' + signatur]: l }))).catch(() => {})
    return () => { aktiv = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hundId, k, signatur])

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const ro = new ResizeObserver(() => setPanelHoehe(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const mitStrecke = strecken[k + '|' + signatur] ?? []
  const r = auswahl != null ? tagRunden.find(x => x.start === auswahl) ?? null : null
  const summeS = tagRunden.reduce((a, x) => a + x.dauer_s, 0)
  const summeM = tagRunden.reduce((a, x) => a + x.strecke_m, 0)

  function wechseln(n: number) { setTag(t => plusTage(t, n)); setAuswahl(null) }
  const name = k === tagSchluessel(heute) ? 'Heute' : k === tagSchluessel(plusTage(heute, -1)) ? 'Gestern' : ''

  return (
    <div className="karten-seite">
      <Karte config={config} zuhause={zuhause} runden={mitStrecke} farben={farben} auswahl={auswahl}
             position={position} fokusPosition={fokusPosition} abstandUnten={panelHoehe} />

      <div className="panel" ref={panel}>
        <div className="tageszeile">
          <button className="rund" onClick={() => wechseln(-1)} title="Tag zurück"><Icon name="links" size={18} /></button>
          <div className="tag-titel">
            <b>{name ? name + ' · ' : ''}{tagKurz(tag)}</b>
            <span className="badges">
              <Badge icon="pfote" title="Runden">{tagRunden.length}</Badge>
              <Badge icon="uhr" title="Gesamtdauer">{dauerKurz(summeS)}</Badge>
              <Badge icon="strecke" title="Gesamtstrecke">{km(summeM)} km</Badge>
            </span>
          </div>
          <button className="rund" onClick={() => wechseln(1)} disabled={tag >= heute} title="Tag vor"><Icon name="rechts" size={18} /></button>
        </div>

        {tagRunden.length ? (
          <div className="chips">
            {tagRunden.length > 1 && (
              <button className={'chip' + (auswahl == null ? ' aktiv' : '')} onClick={() => setAuswahl(null)}>
                <Icon name="alle" size={13} />Alle
              </button>
            )}
            {tagRunden.map(x => (
              <button key={x.start} className={'chip' + (auswahl === x.start ? ' aktiv' : '')}
                      onClick={() => setAuswahl(auswahl === x.start ? null : x.start)}>
                <i style={{ background: farben[x.start] }} />
                {uhrzeit(x.start)}<span className="leise">{dauerKurz(x.dauer_s)}</span>
                {laeuftNoch(x, zuhauseSeit) && <span className="live-punkt" title="läuft gerade" />}
              </button>
            ))}
          </div>
        ) : <div className="leise klein-text">Keine Runden an diesem Tag</div>}

        {r && (
          <div className="badges detail">
            <Badge icon="uhr" title="Zeit">{uhrzeit(r.start)}–{laeuftNoch(r, zuhauseSeit) ? 'jetzt' : uhrzeit(r.ende)}</Badge>
            <Badge icon="strecke" title="Strecke">{km(r.strecke_m)} km</Badge>
            <Badge icon="tempo" title="Ø Tempo">{zahl(r.strecke_m / 1000 / (r.dauer_s / 3600))} km/h</Badge>
            <Badge icon="weg" title="max. Entfernung von zu Hause">{entfernung(r.max_entfernung_m)}</Badge>
            {laeuftNoch(r, zuhauseSeit) ? <Badge icon="aktiv" ton="live">läuft</Badge>
              : !r.ende_zuhause ? <Badge icon="pin" ton="warn" title="Runde endet unterwegs (Pause)">Pause</Badge>
              : !r.start_zuhause ? <Badge icon="pin" ton="warn" title="Runde beginnt unterwegs">unterwegs</Badge> : null}
          </div>
        )}
      </div>
    </div>
  )
}
