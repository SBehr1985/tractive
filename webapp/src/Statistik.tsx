import type { ChartConfiguration } from 'chart.js'
import { useMemo, useState } from 'react'
import type { Runde } from './api'
import Diagramm from './Diagramm'
import { WT, css, dauer, km, kw, letzteTage, tagSchluessel, tagVon, uhrzeit, wochenStart } from './format'

// Segmentfarben, in hellem und dunklem Design gut unterscheidbar
const FARBEN = ['#e0682b', '#2f7fbf', '#3a9d5d', '#9b59b6', '#d4a017', '#c0392b', '#16a2a2', '#7f8c8d']
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
        legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, boxHeight: 12 } },
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
    const gruppen = Array.from({ length: n }, (_, i) => ({ name: `${i + 1}. Runde`, proBalken: proTag.map(l => (l[i] ? [l[i]] : [])) }))
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
    const gruppen = ['Morgens', 'Mittags', 'Abends'].map((name, i) => ({ name, proBalken: proWoche.map(l => l.filter(r => zeitraum(r) === i)) }))
    return balken(wochen.map(d => 'KW ' + kw(d)), gruppen, modusWoche, (g, l) => `${g} (${l.length} Runden)`)
  }, [runden, modusWoche])

  const kachel = (wert: string, label: string) => <div className="card"><div className="w">{wert}</div><div className="l">{label}</div></div>
  return (
    <section>
      <div className="stat-kopf">
        {kachel(dauer(h.s), `Heute · ${h.n} Runden · ${km(h.m)} km`)}
        {kachel(dauer(w.s), `Diese Woche · ${w.n} Runden · ${km(w.m)} km`)}
        {kachel(dauer(s7.s / 7), `Ø pro Tag (7 Tage) · ${km(s7.m / 7)} km`)}
        {kachel(s7.n ? dauer(s7.s / s7.n) : '–', `Ø pro Runde (7 Tage) · ${s7.n ? km(s7.m / s7.n) : '0,0'} km`)}
      </div>
      <div className="card diagramm">
        <div className="diagramm-kopf"><h3>Pro Tag (letzte 14 Tage)</h3><Umschalter wert={modusTag} setzen={setModusTag} /></div>
        <Diagramm config={tagConfig} />
      </div>
      <div className="card diagramm">
        <div className="diagramm-kopf"><h3>Pro Woche (letzte 8 Wochen)</h3><Umschalter wert={modusWoche} setzen={setModusWoche} /></div>
        <Diagramm config={wocheConfig} />
      </div>
    </section>
  )
}
