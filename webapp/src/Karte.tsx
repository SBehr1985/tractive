import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import type { Config, Position, Runde, Zuhause } from './api'
import { css, uhrzeit } from './format'

type Props = {
  config: Config
  zuhause: Zuhause | null
  runde: Runde | null
  position: Position | null
  fokus: 'runde' | 'position'
}

const OSM: StyleSpecification = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
                    attribution: '© OpenStreetMap-Mitwirkende' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}
// eigene Ebenen; die Reihenfolge ist die Zeichenreihenfolge (letzte liegt oben)
const EIGENE = ['zuhause-flaeche', 'zuhause-rand', 'strecke-rand', 'strecke']

type GeoDaten = Parameters<maplibregl.GeoJSONSource['setData']>[0]

function kreis(lat: number, lon: number, radius: number): GeoDaten {
  const coords: [number, number][] = []
  for (let i = 0; i <= 64; i++) {
    const w = 2 * Math.PI * i / 64
    coords.push([lon + Math.sin(w) * radius / (111320 * Math.cos(lat * Math.PI / 180)), lat + Math.cos(w) * radius / 110540])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}

function pin(farbe: string) {
  const el = document.createElement('div')
  el.className = 'pin'
  el.style.background = farbe
  return new maplibregl.Marker({ element: el })
}

export default function Karte({ config, zuhause, runde, position, fokus }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const karte = useRef<maplibregl.Map | null>(null)
  const daten = useRef({ zuhause, runde })
  daten.current = { zuhause, runde }
  const pins = useRef<{ start?: maplibregl.Marker; ende?: maplibregl.Marker; pos?: maplibregl.Marker }>({})

  const stile: [string, string][] = []
  if (config.maptiler_key) {
    for (const s of [['Karte', config.maptiler_stil || 'streets-v2'], ['Outdoor', 'outdoor-v2'], ['Satellit', 'hybrid']] as [string, string][])
      if (!stile.some(x => x[1] === s[1])) stile.push(s)
  }
  const stilUrl = (id: string) => `https://api.maptiler.com/maps/${id}/style.json?key=${encodeURIComponent(config.maptiler_key)}`
  const [stil, setStil] = useState(0)

  function quellen(): Record<string, maplibregl.GeoJSONSourceSpecification> {
    const { zuhause, runde } = daten.current
    const q: Record<string, maplibregl.GeoJSONSourceSpecification> = {}
    q.strecke = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: {
      type: 'LineString', coordinates: (runde?.punkte ?? []).map(p => [p[1], p[0]]) } } }
    q.zuhause = { type: 'geojson', data: zuhause ? kreis(zuhause.lat, zuhause.lon, zuhause.radius_m)
                                                 : { type: 'FeatureCollection', features: [] } }
    return q
  }
  function ebenen(): maplibregl.LayerSpecification[] {
    return [
      { id: 'zuhause-flaeche', type: 'fill', source: 'zuhause', paint: { 'fill-color': '#555', 'fill-opacity': 0.1 } },
      { id: 'zuhause-rand', type: 'line', source: 'zuhause', paint: { 'line-color': '#555', 'line-width': 1, 'line-dasharray': [2, 2] } },
      { id: 'strecke-rand', type: 'line', source: 'strecke', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } },
      { id: 'strecke', type: 'line', source: 'strecke', layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': css('--accent'), 'line-width': 4 } },
    ]
  }
  function ebenenSetzen() {
    const m = karte.current
    if (!m || !m.isStyleLoaded()) return
    for (const [id, spec] of Object.entries(quellen())) {
      const q = m.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (q) q.setData(spec.data as GeoDaten)
      else m.addSource(id, spec)
    }
    for (const e of ebenen()) {
      if (!m.getLayer(e.id)) m.addLayer(e)   // ohne beforeId = ganz oben
      else m.moveLayer(e.id)
    }
  }

  // Karte einmalig anlegen
  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: stile.length ? stilUrl(stile[0][1]) : OSM,
      attributionControl: { compact: true },
      center: zuhause ? [zuhause.lon, zuhause.lat] : [10, 51], zoom: zuhause ? 14 : 5,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.on('style.load', ebenenSetzen)
    karte.current = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current!)
    return () => { ro.disconnect(); m.remove(); karte.current = null; pins.current = {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Runde anzeigen
  useEffect(() => {
    const m = karte.current
    if (!m) return
    if (m.isStyleLoaded()) ebenenSetzen(); else m.once('idle', ebenenSetzen)
    pins.current.start?.remove(); pins.current.ende?.remove()
    const p = runde?.punkte
    if (p && p.length) {
      const coords = p.map(x => [x[1], x[0]] as [number, number])
      pins.current.start = pin(css('--ok')).setLngLat(coords[0])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText('Start ' + uhrzeit(runde!.start))).addTo(m)
      pins.current.ende = pin('#c0392b').setLngLat(coords[coords.length - 1])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText('Ende ' + uhrzeit(runde!.ende))).addTo(m)
      if (fokus === 'runde') {
        const b = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
        m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 17 })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runde, zuhause])

  // aktuelle Position
  useEffect(() => {
    const m = karte.current
    if (!m) return
    pins.current.pos?.remove()
    if (!position || position.lat == null) return
    pins.current.pos = pin('#2f7fbf').setLngLat([position.lon, position.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText('Letzte Position ' + uhrzeit(position.zeit) + ' Uhr')).addTo(m)
    if (fokus === 'position') m.flyTo({ center: [position.lon, position.lat], zoom: 16, duration: 600 })
  }, [position, fokus])

  function stilWechseln(i: number) {
    const m = karte.current
    if (!m) return
    setStil(i)
    // MapLibre gleicht beim Stilwechsel nur Unterschiede ab und würde eigene Ebenen löschen:
    // deshalb hängen wir sie an den neuen Stil an (ganz am Ende = über allem).
    m.setStyle(stilUrl(stile[i][1]), {
      transformStyle: (_alt, neu) => ({
        ...neu,
        sources: { ...neu.sources, ...quellen() },
        layers: [...neu.layers.filter(l => !EIGENE.includes(l.id)), ...ebenen()],
      }),
    })
    m.once('idle', ebenenSetzen)
  }

  return (
    <div className="karte-wrap">
      <div ref={box} className="karte" />
      {stile.length > 1 && (
        <div className="stilwahl">
          {stile.map(([name], i) => (
            <button key={name} className={i === stil ? 'aktiv' : ''} onClick={() => stilWechseln(i)}>{name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
