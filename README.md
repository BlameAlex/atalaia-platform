# AtalaIA Platform

## Qué es
Plataforma de respuesta a inundaciones: una app móvil de SOS (Expo), un servidor con PostgreSQL que combina el modelo de riesgo por condado (`atalaia/`) con el planificador de rutas (`rescue-map/`), un panel web para el despachador y herramientas para reproducirlo todo en local. La zona de demostración es Katy–Brookshire, TX.

> **SIMULACIÓN:** HQ, refugios y vehículos son datos ficticios de demostración. No usar para emergencias reales.

## Requisitos
- Docker o Podman con `compose`
- Node ≥ 22.6
- Python ≥ 3.11
- Un teléfono con Expo Go en la misma red Wi-Fi (solo para la app móvil)

## Windows
Funciona de forma nativa en PowerShell o cmd: los scripts son Node (`tools/setup.mjs`, `tools/dev.mjs`); `tools/setup.sh` y `tools/dev.sh` solo los envuelven. Donde este documento diga `tools/X.sh`, en Windows escribe `node tools/X.mjs` con los mismos argumentos.
- Docker Desktop (o Podman Desktop) con `compose`.
- Node ≥ 22.6 y Python ≥ 3.11 de python.org (vale `python` o el lanzador `py`). El venv queda en `atalaia\.venv\Scripts\python.exe`.
- **Firewall de Windows:** permite entrada TCP 3100 y 8081 en la red privada (Windows lo pregunta la primera vez que arranca Node).
- `tools/dev.mjs` detecta la IP de la Wi-Fi; con varios adaptadores (Hyper-V, VPN) fuérzala con `$env:LAN_IP="<IP Wi-Fi>"`.

**Alternativa WSL2 (Ubuntu):** clona dentro de WSL (`~/...`, no `/mnt/c`) e instala Node y Python (con `python3-venv`) dentro de WSL. Para el teléfono, WSL2 usa NAT y detectaría una IP interna (172.x): en Windows 11 22H2+ añade a `%UserProfile%\.wslconfig`
```ini
[wsl2]
networkingMode=mirrored
```
y ejecuta `wsl --shutdown`. Sin ese modo: `export LAN_IP=<IP Wi-Fi de Windows>` y, en PowerShell como administrador, `netsh interface portproxy add v4tov4 listenport=3100 connectport=3100 connectaddress=<IP de WSL>` (igual con 8081).

## Inicio rápido
```bash
tools/setup.sh      # una vez: .env, base de datos, dependencias, venv, migraciones
tools/dev.sh        # base de datos + servidor + Expo (QR)
```
En Windows: `node tools/setup.mjs` y `node tools/dev.mjs`.
En una segunda terminal:
```bash
node tools/simulate-sos.mjs --count 10 --seed 1 --mode mixed
```
Salida esperada (las últimas líneas):
```
ok=10 fallidos=0
```
Diez incidentes aparecen como **Pendiente** en el panel y enseguida llegan propuestas de ruta; las llamadas agrupadas comparten viaje.

`tools/dev.sh --no-mobile` arranca solo el servidor; `--port N` cambia el puerto. Ctrl+C detiene servidor y Expo; la base de datos sigue corriendo.

## Puertos
| Puerto | Uso |
|---|---|
| 3100 | API y panel |
| 8081 | Metro (Expo) |
| 5432 | PostgreSQL (solo localhost) |

## Clave de despacho
Es el valor de `DISPATCH_KEY` en `.env`. Se introduce una vez en el panel (`http://localhost:3100/dashboard/`). Es compartida y solo para uso local.

## Inicio de sesión de demostración (sin OTP)
Con `DEMO_SKIP_OTP=1` en `.env` la app entra solo con el número de teléfono: `POST /api/v1/auth/demo/sign-in {phone}` devuelve la misma sesión que `otp/verify` y luego sigue el flujo normal (perfil nuevo → registro, perfil existente → inicio). `tools/dev.sh` pasa el mismo valor a Expo (`EXPO_PUBLIC_DEMO_SKIP_OTP`).
- Apagado si la variable no existe o no vale `1`, y siempre apagado con `NODE_ENV=production` (el endpoint responde 404).
- El OTP sigue intacto: con `DEMO_SKIP_OTP=0` vuelve la pantalla del código.
- `.env.example` lo trae en `1` para la demo local; un `.env` existente no cambia: añade la línea a mano y reinicia `tools/dev.sh`.
- **Domicilio de prueba (misma variable):** el clasificador de riesgo solo conoce condados de Texas, así que con la demo activa el servidor ignora el domicilio escrito en `POST /users` y `PATCH /users/me` y guarda una dirección real de Katy, TX tomada de `server/data/demo-addresses.json` (19 direcciones verificadas con el geocodificador del Census; coordenadas y condado incluidos, sin geocodificar en tiempo real). La elección sale de un hash del teléfono: cada usuario recibe siempre la misma. El riesgo lo sigue calculando el clasificador con el condado de esa dirección. La app avisa en el paso de domicilio y muestra la dirección asignada al terminar el registro. Con `NODE_ENV=production` no hay sustitución.
- **Botón SOS (misma variable, en la app):** cada toque es un SOS nuevo e independiente, como una llamada de `tools/simulate-sos.mjs`: la app llama `POST /api/v1/sos/demo` y el servidor elige al azar un usuario simulado del pool (de los 20) sin SOS abierto, un punto aleatorio dentro de `bounds` de `GET /api/v1/health`, y lo pasa por el flujo normal (condado, riesgo, guardado, despacho). La app nunca manda riesgo y no pide permiso de ubicación. `tools/dev.sh` registra el pool al arrancar. El botón sigue disponible tras cada envío; si los 20 ya tienen SOS abierto, avisa. La app no muestra el estado del SOS (ni en demo ni en producción): solo «SOS enviado ✓» o el error. Sin la variable, `/sos/demo` responde 404 y vale el límite de un SOS abierto por usuario.

## Simulador
`node tools/simulate-sos.mjs [opciones]`: llamadas SOS por la API real (`POST /sos`, el mismo contrato que la app), con semilla determinista.

**Requisitos:** `tools/setup.sh` hecho y el servidor corriendo con `NODE_ENV=development` (`tools/dev.sh`; el pool inicia sesión con los OTP de desarrollo).

**Usuarios simulados (pool):** antes de cada ejecución el simulador comprueba 50 usuarios fijos y registra los que falten con `POST /users` (validación y riesgo del domicilio del servidor). Es idempotente: la primera vez imprime `pool: 50 usuarios simulados (50 creados, 0 existentes)` y después `0 creados, 50 existentes`. Se distinguen de los reales por el bloque ficticio de teléfonos `+1 281 555-0101` … `555-0150` y la nota de accesibilidad `Usuario de demostración (simulación)`. Si uno de esos teléfonos tuviera un perfil sin esa nota, el simulador se detiene sin tocarlo.

**Llamadas:** cada llamada elige al azar (según `--seed`) un usuario del pool y coordenadas dentro de la zona; el SOS va con el token de ese usuario, así el incidente queda ligado a su id. El cuerpo es solo `{lat, lng, accuracyM}`: el simulador nunca envía riesgo; la columna `riesgo` muestra la clasificación que devolvió el servidor (modelo por condado + vulnerabilidad del perfil).

| Opción | Valor | Predeterminado |
|---|---|---|
| `--count` | entero 1–500 | 10 |
| `--seed` | entero 0–999 | 1 |
| `--mode` | `mixed` \| `spread` \| `cluster` | `mixed` |
| `--clusters` | entero 1..count | 3 |
| `--radius-m` | metros, > 0 | 300 |
| `--bounds` | `S,W,N,E` en grados | la zona de `/health` |
| `--interval-ms` | ≥ 0 | 500 |
| `--api` | origen de la API | `http://localhost:3100` |
| `--dry-run` | solo imprime el plan, sin red | — |

```
pool: 50 usuarios simulados (0 creados, 50 existentes)
#  teléfono      nombre          tipo     lat        lng         usuario   http  resultado  incidente  estado   riesgo  revisar
1  +12815550106  David Thompson  cluster  29.772592  -95.848861  28fce42a  201   creado     0c0a746e…  pending  3       sí
```
- Un usuario solo tiene un SOS abierto a la vez (regla del servidor): mientras siga abierto, nuevas llamadas suyas devuelven `existente`. Ciérralas en el panel con **Descartar** para volver a usar al usuario. Con 50 usuarios caben como máximo 50 SOS abiertos.
- Repetir una semilla devuelve `existente` en cada fila (mismas llaves de idempotencia).
- Sale con código 1 si alguna llamada falla, 2 si los argumentos son inválidos.
- Pruebas: `node --test tools/simulate-sos.test.mjs` (en Node 24 `node --test tools/` falla: indica el archivo).

## Simulación de vehículos (demo)
Con `DEMO_SIM=1` en `.env` el servidor conduce cada ruta desplegada: el coche aparece en el mapa sobre la geometría de su ruta, gira según el rumbo y, al llegar a cada parada, la resuelve solo (99 % `Recogido`, 1 % `No encontrado`, que devuelve la llamada a pendientes); al llegar al refugio cierra el viaje y el vehículo vuelve a estar disponible.
- Velocidad 1×–5× en la barra superior (`POST /api/v1/sim/speed {speed}`). Cambiarla no reinicia ni hace saltar ningún viaje: el reloj de simulación (`sim_clock`) se reancla en ese instante.
- Solo el servidor resuelve paradas (bucle cada `SIM_TICK_MS`, 250 ms); los paneles solo animan, así que varios paneles abiertos no duplican cambios. Los botones manuales siguen funcionando; si el despachador se adelanta, la simulación lo respeta.
- Las posiciones se calculan desde el reloj del servidor, no fotograma a fotograma: recargar o reconectar deja cada coche donde estaba.
- Apagado si la variable no existe o no vale `1`, y siempre con `NODE_ENV=production` (el endpoint responde 404 y no hay coches).

## Registro de viajes
La línea **AHORA** queda fija (20 % del ancho, ventana de 2 h); los viajes se desplazan respecto a ella con el tiempo real. Las posiciones salen de las marcas de tiempo del servidor, así que no cambian al recargar o reconectar.
- **Propuesta / Pronóstico:** a su hora prevista mientras esté en el futuro; si se queda atrás, se mantiene en AHORA (no avanza como si ya hubiera salido).
- **Activa:** anclada a su despliegue (`deployedAt`); cruza la línea AHORA según pasa el tiempo. El servidor solo despliega una vez cada ruta.

## Reinicio
**DESTRUCTIVO: borra todos los usuarios e incidentes.**
```bash
docker compose down -v      # o: podman compose down -v
tools/setup.sh
```

Para borrar solo los SOS (incidentes, historial de estados, rutas y paradas) y conservar usuarios, vehículos y lugares:
```bash
cd server && npm run clear-sos   # en una transacción; recarga el panel después
```

## Solución de problemas
- **El teléfono no llega a la API:** comprueba que está en la misma Wi-Fi y que la red no aísla clientes. En Fedora, firewalld bloquea los puertos de la red local; ábrelos para la sesión con `sudo firewall-cmd --add-port=3100/tcp --add-port=8081/tcp`.
- **`el puerto N está en uso`:** otro proceso usa ese puerto; ciérralo o usa `tools/dev.sh --port M`.
- **Salud atascada en `risk: down`:** vuelve a ejecutar `tools/setup.sh`, que repite la prueba del entorno Python.
- **Límite del OSRM público:** baja `--count` o sube `--interval-ms`.
- **Podman:** las imágenes usan nombre completo (`docker.io/library/postgres:17`) para evitar el aviso de short-name. Con SELinux, si falla un volumen, revisa los contextos del directorio.
- **Geocodificador del Censo caído:** un SOS sigue funcionando; el registro con `addressLine` devuelve `503 geocoder_unavailable`.
- **Demasiadas llamadas simuladas:** ciérralas en el panel con **Descartar** (estado **Descartado**) en lugar del reinicio destructivo. Más de 96 llamadas pendientes se planifican por tandas (`deferred`).

## Límites conocidos
- Un SOS ocupa exactamente un asiento; el tamaño del hogar no se modela.
- El enrutamiento usa el servidor público de OSRM (`router.project-osrm.org`): con límites de uso, sin SLA y con unos 96 puntos como máximo por llamada de tabla.
- Las direcciones se envían al geocodificador del Censo de EE. UU. (`onelineaddress`), un servicio externo. La búsqueda de condado por coordenadas es local (punto en polígono con los límites TIGER de `server/data/`), sin red: p95 0,035 ms y 0/200 fallos, frente al geocodificador de coordenadas del Censo con p95 3001 ms y 35/200 fallos.
- La clave de despacho es compartida y el montaje es solo local; no es seguro fuera de localhost.
- El servidor corre como una sola instancia: el bloqueo de planificación vive en memoria.
- Los usuarios no pueden cancelar un SOS; el despachador cierra las falsas alarmas con **Descartar**.
