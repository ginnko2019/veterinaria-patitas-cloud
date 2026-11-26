import { useEffect, useState } from 'react'
import { API_BASE_URL, patitasApi } from './services/api'
import { obtenerSesion, URL_CERRAR_SESION, URL_INICIAR_SESION } from './services/auth'

type HealthState = 'sin-configurar' | 'consultando' | 'conectada' | 'error'
type SesionState = 'consultando' | 'autenticada' | 'sin-sesion' | 'sin-servicio'

const servicios = [
  { numero: '01', nombre: 'Consulta general', detalle: 'Evaluación preventiva y orientación veterinaria.' },
  { numero: '02', nombre: 'Vacunación', detalle: 'Acompañamiento en el bienestar de tu mascota.' },
  { numero: '03', nombre: 'Control y seguimiento', detalle: 'Cuidado continuo para cada etapa de su vida.' },
]

function Paw({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'paw paw--small' : 'paw'} aria-hidden="true">
      <span className="paw__toe paw__toe--a" />
      <span className="paw__toe paw__toe--b" />
      <span className="paw__toe paw__toe--c" />
      <span className="paw__toe paw__toe--d" />
      <span className="paw__pad" />
    </span>
  )
}

export default function App() {
  const [health, setHealth] = useState<HealthState>(API_BASE_URL ? 'consultando' : 'sin-configurar')
  const [sesion, setSesion] = useState<SesionState>('consultando')

  useEffect(() => {
    const controller = new AbortController()
    obtenerSesion(controller.signal)
      .then((principal) => setSesion(principal ? 'autenticada' : 'sin-sesion'))
      .catch(() => {
        if (!controller.signal.aborted) setSesion('sin-servicio')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!API_BASE_URL) return

    const controller = new AbortController()
    patitasApi.health(controller.signal)
      .then((response) => setHealth(response.status === 'ok' ? 'conectada' : 'error'))
      .catch(() => {
        if (!controller.signal.aborted) setHealth('error')
      })
    return () => controller.abort()
  }, [])

  const estado = {
    'sin-configurar': 'API pendiente de configurar',
    consultando: 'Comprobando conexión',
    conectada: 'API conectada',
    error: 'API no disponible',
  }[health]

  return (
    <>
      <header className="site-header">
        <div className="shell header-inner">
          <a href="#inicio" className="brand" aria-label="Patitas, ir al inicio">
            <span className="brand-mark"><Paw small /></span>
            <span className="brand-name">patitas<span>.</span></span>
          </a>
          <nav className="nav-links" aria-label="Navegación principal">
            <a href="#inicio">Inicio</a>
            <a href="#servicios">Servicios</a>
            <a href="#agenda">Citas</a>
          </nav>
          <a className="header-action" href="#agenda">Agenda de citas <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <main>
        <section className="hero" id="inicio" aria-labelledby="hero-title">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <span className="eyebrow"><span className="eyebrow-line" /> CUIDAMOS A QUIENES TE ACOMPAÑAN</span>
              <h1 id="hero-title">Su bienestar <span>deja huella.</span></h1>
              <p>Un espacio pensado para acompañarte en el cuidado de tu mascota, con atención cercana y una agenda sencilla de usar.</p>
              <div className="hero-actions">
                <a href="#agenda" className="button button--primary">Conoce nuestra agenda <span aria-hidden="true">→</span></a>
                <a href="#servicios" className="button button--text">Explorar servicios <span aria-hidden="true">↗</span></a>
              </div>
              <div className="hero-note"><span className="note-dot" /> Plataforma en desarrollo · PEMU 2026</div>
            </div>
            <div className="hero-visual" aria-label="Ilustración gráfica de la marca Patitas">
              <div className="hero-circle hero-circle--outer" />
              <div className="hero-circle hero-circle--inner" />
              <span className="visual-spark visual-spark--a">✳</span>
              <span className="visual-spark visual-spark--b">✳</span>
              <div className="visual-paw"><Paw /></div>
              <div className="visual-caption"><span>♥</span> El cuidado comienza aquí</div>
              <div className="visual-label">PATITAS / VETERINARIA</div>
            </div>
          </div>
        </section>

        <section className="section services" id="servicios" aria-labelledby="services-title">
          <div className="shell">
            <div className="section-head">
              <div><span className="section-tag">QUÉ HACEMOS</span><h2 id="services-title">Cuidado en cada etapa.</h2></div>
              <p>Estas categorías ilustran la propuesta de servicio. El catálogo definitivo se conectará con la API de Nicolás.</p>
            </div>
            <div className="service-grid">
              {servicios.map((servicio) => (
                <article className="service-card" key={servicio.numero}>
                  <div className="service-top"><span>{servicio.numero}</span><span aria-hidden="true">↗</span></div>
                  <div className="service-symbol"><Paw small /></div>
                  <h3>{servicio.nombre}</h3>
                  <p>{servicio.detalle}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section booking" id="agenda" aria-labelledby="booking-title">
          <div className="shell booking-grid">
            <div>
              <span className="section-tag">AGENDA DIGITAL</span>
              <h2 id="booking-title">Una forma más fácil de organizar las citas.</h2>
              <p>La reserva y consulta de citas se habilitarán cuando integremos los endpoints y la autenticación del backend. No se muestran ni se registran datos clínicos simulados como si fueran reales.</p>
            </div>
            <div className="status-panel" role="status" aria-live="polite">
              <div className="status-panel__top"><span>ESTADO DE INTEGRACIÓN</span><span className={'status-indicator status-indicator--' + health} /></div>
              <div className="status-panel__icon">⌁</div>
              <h3>{estado}</h3>
              <p>{health === 'sin-configurar' ? 'Define VITE_API_BASE_URL en el archivo .env local para consultar la API de Azure Functions.' : health === 'conectada' ? 'El endpoint de salud respondió correctamente. La gestión de citas requiere autenticación.' : health === 'consultando' ? 'Consultando el endpoint /api/health…' : 'Verifica la dirección de la API, CORS y que Azure Functions esté ejecutándose.'}</p>
              <div className="session-area">
                {sesion === 'autenticada' ? (
                  <><span className="session-note">Sesión iniciada en Static Web Apps. La agenda estará disponible después de validar la seguridad del backend.</span>
                  <a className="session-link" href={URL_CERRAR_SESION}>Cerrar sesión</a></>
                ) : sesion === 'sin-sesion' ? (
                  <><span className="session-note">Inicia sesión para acceder a las citas cuando esté lista la integración.</span>
                  <a className="session-link" href={URL_INICIAR_SESION}>Iniciar sesión con Microsoft</a></>
                ) : (
                  <span className="session-note">{sesion === 'consultando' ? 'Comprobando sesión…' : 'La autenticación estará disponible en el sitio desplegado en Azure Static Web Apps.'}</span>
                )}
              </div>
              <div className="status-panel__foot"><span>API / HEALTH</span><span>{health === 'conectada' ? 'OPERATIVA' : 'EN PREPARACIÓN'}</span></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell footer-inner">
          <span className="brand brand--footer"><span className="brand-mark"><Paw small /></span><span className="brand-name">patitas<span>.</span></span></span>
          <span>Proyecto académico de arquitectura cloud · PEMU 2026</span>
        </div>
      </footer>
    </>
  )
}
