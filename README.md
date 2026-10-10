# μgem agent

Asistente minimalista de terminal para conversar con modelos locales mediante una API compatible con OpenAI. La versión **v0.1** implementa exclusivamente `/Q&A`: no contiene herramientas, edición de proyectos, planificación ni ejecución de comandos generados por el modelo.

## Requisitos

- Node.js 20 o posterior.
- Un endpoint compatible con `POST /v1/chat/completions` y streaming SSE.
- Linux o Windows Terminal. La integración automática incluida para `llama.cpp` y GPU NVIDIA está preparada para el layout Linux descrito abajo.

μgem no tiene dependencias npm de producción ni requiere Python.

## Inicio rápido

```bash
git clone <repositorio> ugem-agent
cd ugem-agent
npm install
node src/index.js
```

También puedes registrar el comando localmente:

```bash
npm link
ugem
```

Al escribir texto libre se entra directamente en Q&A. Usa `/exit` para cerrar; μgem detiene solamente el proceso `llama-server` que haya iniciado por sí mismo.

## llama.cpp local administrado

En Linux, μgem detecta por defecto este layout adyacente:

```text
AI_MODELS/
├── agents/ugem-agent/
├── apps/llama-server.bash
├── apps/presets.ini
└── models/
```

Si `http://127.0.0.1:8081` no está disponible, inicia `apps/llama-server.bash`, carga el preset `gemma4-e4b` y espera `/health`. Puedes elegir otro preset con `/models`.

Variables principales:

| Variable | Uso |
|---|---|
| `UGEM_LLAMA_PRESET` | Preset local inicial |
| `UGEM_LLAMA_LAUNCHER` | Ruta alternativa a `llama-server.bash` |
| `UGEM_LLAMA_PRESETS` | Ruta alternativa a `presets.ini` |
| `UGEM_AUTO_START=0` | Desactiva el inicio automático |
| `UGEM_REASONING_LEVEL` | `low`, `medium` o `high` |
| `UGEM_REASONING_BUDGET_TOKENS` | Presupuesto personalizado del servidor administrado |

## Endpoint externo

Linux:

```bash
UGEM_BASE_URL=http://127.0.0.1:8080 \
UGEM_MODEL=my-model \
node src/index.js
```

PowerShell:

```powershell
$env:UGEM_BASE_URL = "http://127.0.0.1:8080"
$env:UGEM_MODEL = "my-model"
node src/index.js
```

Opcionalmente, `UGEM_API_KEY` añade autenticación Bearer y `UGEM_REQUEST_TIMEOUT_MS` cambia el timeout. La credencial no se imprime ni se guarda en preferencias.

## Comandos v0.1

| Comando | Función |
|---|---|
| `/Q&A [pregunta]` | Activa Q&A o hace una pregunta |
| `/clear` | Borra historial, contexto retenido y últimas métricas |
| `/settings` | Muestra preferencias efectivas y ubicación del archivo |
| `/models [id] [opciones]` | Lista o selecciona el modelo |
| `/reasoning low\|medium\|high` | Reserva 1K, 2K o 4K para razonamiento local |
| `/reasoning auto\|on\|off` | Selecciona el modo de razonamiento |
| `/context [tokens\|auto]` | Consulta o limita el presupuesto de sesión |
| `/theme [modo] [paleta]` | Selecciona fondo y combinación de colores |
| `/code-color [color]` | Cambia el color del código cercado |
| `/stats [on\|off]` | Consulta métricas o activa/desactiva el pie |
| `/help` | Muestra la ayuda local |
| `/exit` | Cierra μgem |

Ejemplos:

```text
/models qwen3.5-4b medium clear
/theme light forest
/context 32768
/stats off
```

## Contexto y razonamiento

El límite de contexto proviene del servidor. `/context` no cambia `llama-server --ctx-size`; configura un presupuesto preventivo dentro del máximo confirmado.

En el servidor local administrado, μgem separa:

- hasta 4.096 tokens para la respuesta final;
- 1.024, 2.048 o 4.096 tokens para razonamiento;
- el contexto retenido, que vuelve a enviarse en el siguiente turno;
- el pico de generación reportado, que incluye razonamiento oculto.

El razonamiento interno nunca se muestra ni se incorpora al historial. Los endpoints externos reciben controles de razonamiento solo cuando μgem puede verificar esa capacidad; de lo contrario informa `unsupported` o `unknown`.

## Preferencias

Las selecciones explícitas se guardan en:

- Linux: `$XDG_CONFIG_HOME/ugem/config.json` o `~/.config/ugem/config.json`.
- Windows: `%APPDATA%\ugem\config.json`.
- Personalizado: `UGEM_CONFIG_FILE`.

Las variables de entorno tienen prioridad. El archivo es versionado, acepta únicamente claves permitidas y nunca almacena secretos ni conversaciones. Una configuración corrupta usa valores seguros y muestra una advertencia sin impedir Q&A.

## Verificación

```bash
npm run check
```

La estrategia y la evidencia de v0.1 están en [docs/verification.md](docs/verification.md) y [docs/release-verification-v0.1.md](docs/release-verification-v0.1.md). Las notas de versión están en [RELEASE_NOTES.md](RELEASE_NOTES.md).

## Límites de v0.1

- Q&A no puede llamar herramientas, ejecutar comandos ni modificar archivos.
- `/plan`, `/debug` y `/build` pertenecen a versiones futuras y no están implementados.
- La selección dinámica real de modelos depende del backend; μgem no la presume.
- El inicio automático del launcher Bash se verificó solo en Linux.
- Windows Terminal tiene cobertura automatizada de rutas, ANSI y fallbacks, pero no una prueba física en Windows para esta versión.
