import type { ChartConfiguration } from 'chart.js'
import { useMemo } from 'react'
import type { AktivTag, Runde } from './api'
import Diagramm from './Diagramm'
import { WT, css, dauer, letzteTage, tagName, tagSchluessel, tagVon, uhrzeit } from './format'

const ZUSTAND: Record<string, [string, string]> = {
  ACTIVE: ['Aktiv', '--z-aktiv'], VERY_ACTIVE: ['Sehr aktiv', '--z-aktiv'],
  REST: ['Ruhe', '--z-ruhe'], SLEEP: ['Schlaf', '--z-schlaf'],
}

export default function Aktivitaet({ tage, runden }: { tage: AktivTag[]; runden: Runde[] }) {
  const proTag = useMemo(() => Object.fromEntries(tage.map(t => [t.tag, t])), [tage])
  const heute = tagSchluessel(new Date())
  const fertig = tage.filter(t => t.vollstaendig).slice(0, 7)
  const schnitt = fertig.length ? fertig.reduce((a, t) => a + (t.minuten_aktiv || 0), 0) / fertig.length : null

  const config = useMemo<ChartConfiguration>(() => {
    const d14 = letzteTage(14)
    return {
      type: 'bar',
      data: {
        labels: d14.map(d => WT[d.getDay()] + ' ' + d.getDate() + '.'),
        datasets: [{ data: d14.map(d => proTag[tagSchluessel(d)]?.minuten_aktiv ?? null), backgroundColor: css('--z-aktiv'),
                     borderRadius: 4, maxBarThickness: 36 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => 'aktiv ' + dauer((c.raw as number) * 60) } } },
        scales: {
          x: { ticks: { color: css('--muted'), maxRotation: 0, autoSkip: true }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: css('--muted'), callback: v => v + ' min' }, grid: { color: css('--line') } },
        },
      },
    }
  }, [proTag])

  if (!tage.length) {
    return <section><div className="card leer">Noch keine Aktivitätsdaten gespeichert. Sie werden tagsüber und jeden Abend um 23:55 abgerufen.</div></section>
  }
  const kachel = (wert: string, label: string) => <div className="card"><div className="w">{wert}</div><div className="l">{label}</div></div>

  return (
    <section>
      <div className="stat-kopf">
        {kachel(proTag[heute]?.minuten_aktiv != null ? dauer(proTag[heute].minuten_aktiv! * 60) : '–', 'Heute aktiv (bisher)')}
        {kachel(schnitt != null ? dauer(schnitt * 60) : '–', `Ø aktiv pro Tag (${fertig.length} vollständige Tage)`)}
        {kachel(String(tage.length), 'Tage mit Aktivitätsdaten')}
      </div>
      <div className="card diagramm">
        <div className="diagramm-kopf"><h3>Aktive Minuten pro Tag (letzte 14 Tage)</h3></div>
        <Diagramm config={config} />
      </div>
      <div className="card diagramm">
        <div className="diagramm-kopf">
          <h3>Tagesverlauf</h3>
          <div className="legende">
            <span><i style={{ background: 'var(--z-aktiv)' }} />Aktiv</span>
            <span><i style={{ background: 'var(--z-ruhe)' }} />Ruhe</span>
            <span><i style={{ background: 'var(--z-schlaf)' }} />Schlaf</span>
            <span><i style={{ background: 'var(--ok)' }} />Gassirunde (GPS)</span>
          </div>
        </div>
        {tage.map(t => {
          const t0 = new Date(t.tag + 'T00:00:00').getTime() / 1000
          const pct = (ts: number) => Math.max(0, Math.min(100, (ts - t0) / 864))
          const gassi = runden.filter(r => tagVon(r.start) === t.tag)
          const lange = t.segmente.filter(s => s[2].includes('ACTIVE') && s[1] - s[0] >= 600)
          return (
            <div className="atag" key={t.tag}>
              <div className="atag-kopf">
                <span><b>{tagName(t.tag)}</b> · aktiv {dauer((t.minuten_aktiv || 0) * 60)}
                  {!t.vollstaendig && <span className="klein"> · Stand {uhrzeit(t.abgerufen_at)}{t.tag !== heute ? ' (unvollständig)' : ''}</span>}
                </span>
                {lange.length > 0 && <span className="klein">längere Aktivphasen: {lange.map(s => `${uhrzeit(s[0])}–${uhrzeit(s[1])}`).join(', ')}</span>}
              </div>
              <div className="streifen">
                {t.segmente.map(([s, e, z], i) => {
                  const [label, farbe] = ZUSTAND[z] ?? [z, '--z-ruhe']
                  return <div key={i} style={{ left: pct(s) + '%', width: pct(e) - pct(s) + '%', background: `var(${farbe})` }}
                              title={`${uhrzeit(s)}–${uhrzeit(e)} ${label} (${dauer(e - s)})`} />
                })}
              </div>
              <div className="gassi">
                {gassi.map(r => <div key={r.start} style={{ left: pct(r.start) + '%', width: Math.max(0.4, pct(r.ende) - pct(r.start)) + '%' }}
                                     title={`Gassirunde ${uhrzeit(r.start)}–${uhrzeit(r.ende)} (${dauer(r.dauer_s)})`} />)}
              </div>
              <div className="achse"><span style={{ left: 0 }}>0</span><span style={{ left: '25%' }}>6</span><span style={{ left: '50%' }}>12</span>
                <span style={{ left: '75%' }}>18</span><span style={{ left: '100%' }}>24 Uhr</span></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
