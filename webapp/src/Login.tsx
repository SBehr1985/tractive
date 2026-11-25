import { useState } from 'react'
import { api, type Me } from './api'

export default function Login({ angemeldet, hinweis }: { angemeldet: (m: Me) => void; hinweis?: string }) {
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  async function senden(e: React.FormEvent) {
    e.preventDefault()
    setFehler(''); setLaeuft(true)
    try { angemeldet(await api.login(email, passwort)) }
    catch (err) { setFehler((err as Error).message) }
    finally { setLaeuft(false) }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={senden}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>Gassi-Runden</h1>
        <p className="sub">Mit deinem Tractive-Konto anmelden. Das Passwort geht nur an Tractive und wird nicht gespeichert.</p>
        {hinweis && <p className="fehler">{hinweis}</p>}
        <label>E-Mail<input type="email" autoComplete="username" value={email} onChange={x => setEmail(x.target.value)} required /></label>
        <label>Passwort<input type="password" autoComplete="current-password" value={passwort} onChange={x => setPasswort(x.target.value)} required /></label>
        {fehler && <p className="fehler">{fehler}</p>}
        <button className="primaer" disabled={laeuft}>{laeuft ? 'Anmelden …' : 'Anmelden'}</button>
      </form>
    </div>
  )
}
