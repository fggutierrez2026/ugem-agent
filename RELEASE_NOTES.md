# Release Notes

## v0.1.0 — 2026-10-10

Primera versión ejecutable de μgem agent, limitada deliberadamente al modo `/Q&A`.

### Incluido

- Cliente OpenAI-compatible con streaming SSE, errores tipados, cancelación y redacción de credenciales.
- Conversación con historial, `/clear` y aislamiento total de documentos/herramientas del proyecto.
- Renderizado terminal de Markdown, tablas, listas, código y matemáticas con fallback fiel.
- Temas claro/oscuro/automático, cinco paletas, colores separados para usuario/modelo y fallback sin ANSI.
- Métricas de tokens, TTFT, velocidad, tiempo total, contexto retenido y pico de generación.
- Gestión preventiva del contexto con reservas separadas para razonamiento y respuesta final.
- Inicio controlado de llama.cpp, selección de presets/modelos y cierre exclusivo del proceso propio.
- Razonamiento `auto|on|off` y niveles locales `low|medium|high` de 1K/2K/4K.
- `/settings` y persistencia versionada de preferencias para Linux y Windows, sin secretos.

### Verificación de la versión

- Suite completa: 122 pruebas, 118 casos de nivel superior, sin fallos.
- Integración completa contra un endpoint SSE OpenAI-compatible simulado.
- Prueba real en Linux con RTX 3060 Laptop 6 GiB, llama.cpp `v0.6.0` (`d812350`).
- Arranque con Gemma 4 E4B y cambio administrado a Qwen 3.5 4B.
- Qwen verificado con razonamiento medio de 2.048 tokens y con razonamiento desactivado.
- La comprobación física en Windows no estuvo disponible; rutas, capacidad ANSI y fallbacks sí tienen pruebas automatizadas.

Consulta [docs/release-verification-v0.1.md](docs/release-verification-v0.1.md) para evidencia y limitaciones detalladas.

### Fuera de alcance

- Herramientas, lectura/escritura del proyecto y ejecución de comandos desde Q&A.
- `/plan`, `/debug` y `/build`.
- Persistencia de conversaciones.
- Garantizar controles no anunciados por proveedores externos.
