import type { ChartConfiguration } from 'chart.js'
import { useMemo, useState } from 'react'
import type { Runde } from './api'
import Diagramm from './Diagramm'
import { RUNDEN_FARBEN as FARBEN, WT, css, dauer, dauerKurz, km, kw, letzteTage, tagSchluessel, tagVon, uhrzeit, wochenStart } from './format'
import Icon, { Badge } from './Icon'

type Modus = 'zeit' | 'km'
type Gruppe = { name: string; proBalken: Runde[][] }

function balken(labels: string[], gruppen: Gruppe[], modus: Modus, text: (g: string, l: Runde[]) => string): ChartConfiguration {
  const zeit = modus === 'zeit'
  const wert = (l: Runde[]) => {
    if (!l.length) return null
    const s = l.reduce((a, r) => a + (zeit ? r.dauer_s : r.strecke_m), 0)
    return zeit ? Math.round(s / 60) : +(s / 1000).toFixed(2)
  }
  const fmt = (v: number) => (zeit ? dauer(v * 60) : v.toLocaleString('de-DE') + ' km')
  const muted = css('--muted')
  return {
    type: 'bar',
    data: {
      labels,
      datasets: gruppen.map((g, i) => ({
        label: g.name, data: g.proBalken.map(wert), backgroundColor: FARBEN[i % FARBEN.length],
        borderColor: css('--card'), borderWidth: { top: 1.5 }, borderSkipped: false, maxBarThickness: 36, stack: 's',
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: muted, boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
        tooltip: {
          mode: 'index', filter: c => c.raw != null,
          callbacks: {
            label: c => text(gruppen[c.datasetIndex].name, gruppen[c.datasetIndex].proBalken[c.dataIndex]) + ' · ' + fmt(c.raw as number),
            footer: items => 'Gesamt: ' + fmt(items.reduce((a, c) => a + (c.raw as number), 0)),
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: muted, maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { color: muted, callback: v => (zeit ? v + ' min' : v + ' km') }, grid: { color: css('--line') } },
      },
    },
  }
}

function Umschalter({ wert, setzen }: { wert: Modus; setzen: (m: Modus) => void }) {
  return (
    <div className="umschalter">
      <button className={wert === 'zeit' ? 'aktiv' : ''} onClick={() => setzen('zeit')}>Zeit</button>
      <button className={wert === 'km' ? 'aktiv' : ''} onClick={() => setzen('km')}>km</button>
    </div>
  )
}

export default function Statistik({ runden }: { runden: Runde[] }) {
  const [modusTag, setModusTag] = useState<Modus>('zeit')
  const [modusWoche, setModusWoche] = useState<Modus>('zeit')

  const summe = (f: (r: Runde) => boolean) => {
    const l = runden.filter(f)
    return { n: l.length, s: l.reduce((a, r) => a + r.dauer_s, 0), m: l.reduce((a, r) => a + r.strecke_m, 0) }
  }
  const heute0 = new Date(); heute0.setHours(0, 0, 0, 0)
  const vor7 = new Date(heute0); vor7.setDate(vor7.getDate() - 6)
  const h = summe(r => r.start * 1000 >= heute0.getTime())
  const w = summe(r => r.start * 1000 >= wochenStart(new Date()).getTime())
  const s7 = summe(r => r.start * 1000 >= vor7.getTime())

  const tagConfig = useMemo(() => {
    const tage = letzteTage(14)
    const proTag = tage.map(d => runden.filter(r => tagVon(r.start) === tagSchluessel(d)).sort((a, b) => a.start - b.start))
    const n = Math.max(1, ...proTag.map(l => l.length))
    const gruppen = Array.from({ length: n }, (_, i) => ({ name: `${i + 1}.`, proBalken: proTag.map(l => (l[i] ? [l[i]] : [])) }))
    return balken(tage.map(d => WT[d.getDay()] + ' ' + d.getDate() + '.'), gruppen, modusTag,
                  (g, l) => `${g}: ${uhrzeit(l[0].start)}–${uhrzeit(l[0].ende)}`)
  }, [runden, modusTag])

  const wocheConfig = useMemo(() => {
    const start = wochenStart(new Date())
    const wochen = Array.from({ length: 8 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() - 7 * (7 - i)); return d })
    const proWoche = wochen.map(d => {
      const ende = new Date(d); ende.setDate(ende.getDate() + 7)
      return runden.filter(r => r.start * 1000 >= d.getTime() && r.start * 1000 < ende.getTime())
    })
    const zeitraum = (r: Runde) => { const s = new Date(r.start * 1000).getHours(); return s >= 4 && s < 11 ? 0 : s >= 11 && s < 17 ? 1 : 2 }
    const gruppen = ['Morgen', 'Mittag', 'Abend'].map((name, i) => ({ name, proBalken: proWoche.map(l => l.filter(r => zeitraum(r) === i)) }))
    return balken(wochen.map(d => 'KW ' + kw(d)), gruppen, modusWoche, (g, l) => `${g} (${l.length}×)`)
  }, [runden, modusWoche])

  const kachel = (titel: string, sek: number, n: number | null, m: number) => (
    <div className="card kpi">
      <div className="l">{titel}</div>
      <div className="w">{dauerKurz(sek)}</div>
      <div className="badges">
        {n != null && <Badge icon="pfote" title="Runden">{n}</Badge>}
        <Badge icon="strecke" title="Strecke">{km(m)} km</Badge>
      </div>
    </div>
  )
  return (
    <section>
      <div className="stat-kopf">
        {kachel('Heute', h.s, h.n, h.m)}
        {kachel('Woche', w.s, w.n, w.m)}
        {kachel('Ø Tag · 7 T.', s7.s / 7, null, s7.m / 7)}
        {kachel('Ø Runde · 7 T.', s7.n ? s7.s / s7.n : 0, null, s7.n ? s7.m / s7.n : 0)}
      </div>
      <div className="card diagramm">
        <div className="diagramm-kopf"><h3><Icon name="kalender" /> 14 Tage</h3><Umschalter wert={modusTag} setzen={setModusTag} /></div>
        <Diagramm config={tagConfig} hoehe={220} />
      </div>
      <div className="card diagramm">
        <div className="diagramm-kopf"><h3><Icon name="balken" /> 8 Wochen</h3><Umschalter wert={modusWoche} setzen={setModusWoche} /></div>
        <Diagramm config={wocheConfig} hoehe={220} />
      </div>
    </section>
  )
}
