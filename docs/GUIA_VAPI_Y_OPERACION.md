# Guía: Vapi + Villapel OS (CRM)

Idioma de esta guía: **español** (primario). Resumen en inglés al final.

Villapel OS está pensado para **cualquier tipo de negocio** (servicios, retail, SaaS, clínicas, agencias, etc.); no está limitado a un solo sector.

## 1. Qué usa el sistema para voz

- **Proveedor de voz:** [Vapi](https://vapi.ai).
- El CRM **no** integra el SDK de llamadas en el navegador: las llamadas las gestionas en **Vapi** y los resultados entran por **webhook** (p. ej. **Make.com**) al API de Villapel.

## 2. Requisitos previos

1. **Sitio desplegado** (Netlify u otro) con funciones `api` y variables de entorno de Firebase/Firestore configuradas.
2. **Usuario admin** en Villapel OS para entrar al panel.
3. En **Integraciones → Claves API**, una clave con permiso **`calls:write`** (y los que uses para leads/reservas/tareas).

## 3. Registrar llamadas desde Vapi (Make.com)

1. En Make.com, tras una llamada en Vapi (o su webhook de servidor), añade módulo **HTTP** → **POST**.
2. **URL:** `https://TU-DOMINIO.netlify.app/api/external/calls/log`  
   (mismo origen que la app; si usas otro backend, sustituye el host).
3. **Headers:**
   - `Content-Type`: `application/json`
   - `x-api-key`: tu clave API (la que creaste en el CRM).
4. **Body (JSON)** — campos habituales:

| Campo | Uso |
|--------|-----|
| `phone` | **Importante:** debe coincidir con el teléfono del lead en el CRM para vincular la llamada. |
| `vapi_call_id` | ID de llamada que devuelve Vapi (recomendado para trazabilidad). |
| `direction` | `inbound` o `outbound`. |
| `call_date` | Fecha/hora ISO 8601. |
| `duration_seconds` | Duración en segundos. |
| `transcript_summary` | Resumen o transcripción corta. |
| `recording_url` | URL de grabación si la tienes. |
| `qualified` | `true` / `false`. |
| `booked` | `true` / `false` (si hubo cita, actualiza lógica del lead). |
| `notes` | Texto libre. |

5. Respuesta esperada: `201` con `success`, `call_id` y `matched_lead_id` (si hubo match por teléfono).

## 4. Otros webhooks útiles (Make.com)

Misma cabecera `x-api-key`, rutas bajo `/api/external/`:

- `POST .../leads/intake` — alta o actualización de leads (deduplicación).
- `PATCH .../leads/update` — actualizar campos del lead.
- `POST .../tasks/create` — tareas.
- `POST .../bookings/create-or-update` — reservas.

Copia las URLs exactas desde **Integraciones → Webhooks** en el panel.

## 5. Idioma de la aplicación

- **Idioma por defecto:** **español (ES)**.
- **Secundario:** inglés (EN).
- El idioma se guarda en el navegador (`localStorage`: `villapel-lang`).
- Textos de interfaz: `frontend/src/lib/i18n/messages.js` (objetos `es` y `en`).

## 6. Datos en base de datos

- Los **estados de lead** en Firestore siguen siendo los valores en **inglés** (`New Lead`, `Booked`, etc.); en pantalla se muestran traducidos según ES/EN.
- En la colección **calls**, el campo **`vapi_call_id`** guarda el identificador de la llamada en Vapi.

## 7. Comprobar que todo funciona

1. Entra al CRM y abre **Llamadas**: deberían listarse las filas creadas por el webhook.
2. **Integraciones → Registros**: revisa código `201` y el resumen del request.
3. Con un `phone` que exista en un lead, verifica que el registro muestre datos coherentes y que el lead actualice fechas/estado según `qualified` / `booked`.

---

## English summary

- **Product scope:** Villapel OS is **industry-agnostic** (any business vertical).
- **Voice provider:** Vapi; configure assistants at [vapi.ai](https://vapi.ai).
- **Call logging:** `POST /api/external/calls/log` with header `x-api-key` and JSON body; use **`vapi_call_id`** and **`phone`** (must match a lead’s phone for linking).
- **Default UI language:** Spanish; switch to English in the sidebar or login screen.
- **Webhook URLs:** copy from **Integrations → Webhooks** in the app.
