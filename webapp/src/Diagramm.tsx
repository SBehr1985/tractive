import Chart, { type ChartConfiguration } from 'chart.js/auto'
import { useEffect, useRef } from 'react'

/** Dünner Wrapper um Chart.js; zeichnet neu, wenn sich config ändert (Aufrufer nutzt useMemo). */
export default function Diagramm({ config, hoehe = 260 }: { config: ChartConfiguration; hoehe?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = new Chart(ref.current!, config)
    return () => c.destroy()
  }, [config])
  return <div className="chart-box" style={{ height: hoehe }}><canvas ref={ref} /></div>
}
