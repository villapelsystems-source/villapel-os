# Villapel OS

CRM y operación de leads con soporte de **cualquier tipo de negocio** (servicios, retail, SaaS, clínicas, agencias, etc.). Incluye panel web, API con autenticación, integraciones (Make.com, Vapi) y despliegue en Netlify.

- **Frontend:** `frontend/` (React)
- **API serverless:** `frontend/netlify/functions/`
- **Backend Python (alternativo):** `backend/`
- **Guía Vapi:** [docs/GUIA_VAPI_Y_OPERACION.md](docs/GUIA_VAPI_Y_OPERACION.md)

## Despliegue en Netlify

El archivo [`netlify.toml`](netlify.toml) declara **`base = "frontend"`**, comando **`npm ci && npm run build`** (sin `cd frontend`), **`publish = "build"`** y funciones en **`netlify/functions`** (rutas relativas a `frontend/`).

1. **Sube el código** a GitHub (o GitLab/Bitbucket) y conecta el repo en [Netlify](https://app.netlify.com) → *Add new site* → *Import an existing project*.
2. **Configuración del build:** deja que `netlify.toml` mande, o alinea el panel manualmente:
   - *Base directory:* `frontend` (o vacío si solo confías en el toml; no mezcles *base* en UI = `frontend` con un command que haga otra vez `cd frontend`).
   - *Build command:* `npm ci && npm run build`
   - *Publish directory:* `build` (relativo al base `frontend/`, no `frontend/build`)
3. **Variables de entorno** en el sitio → *Site configuration* → *Environment variables* (mínimo para la API serverless + Firestore):
   - `FIREBASE_SERVICE_ACCOUNT` — JSON completo de la cuenta de servicio de Firebase, en **una sola línea** (el contenido del archivo JSON, sin saltos de línea, o escapado como string).
   - `JWT_SECRET` — cadena larga y aleatoria (no uses el valor por defecto).
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — credenciales del admin del panel.
   - `COOKIE_SECURE` — pon `true` en producción (HTTPS).
   - `CORS_ORIGINS` — URL pública del sitio, p. ej. `https://tu-sitio.netlify.app` (varias separadas por coma si aplica).
   - Opcional: `VILLAPEL_API_KEY` si usas el endpoint JSON legacy; `REACT_APP_BACKEND_URL` solo si el front debe apuntar a otro host (en el despliegue típico todo va por el mismo dominio y las rutas `/api/*` van a las funciones).
4. **Despliegue:** cada *push* a la rama conectada dispara un build, o ejecuta desde tu PC (con [Netlify CLI](https://docs.netlify.com/cli/get-started/) instalado y autenticado):

```bash
cd "ruta/al/repo"
netlify deploy --build --prod
```

Si antes existía `memory/test_credentials.md` en el historial de Git con una contraseña de prueba, **cámbiala** en Netlify (`ADMIN_PASSWORD`) y en Firebase si aplica.
