# ASSETS — Recursos gráficos de insignias

## Estructura servida (CDN de Cloudflare Assets)

```
public/assets/badges/
├── badge-manifest.json        ← manifiesto (code → archivos + sha256 + tamaños)
├── hoja-contacto.png          ← hoja de contacto 4×3 para inspección visual
├── member/      1024|512|256|128|64|32 .png + 256|128 .webp
├── plus/        idem
├── pro/         idem
├── elite/       idem
├── creator/     idem
├── partner/     idem
├── champion/    idem
├── top-10/      idem
├── rising-star/ idem
├── veteran/     idem
├── founder/     idem
└── verified/    idem
```

Generador reproducible: `/home/z/my-project/scripts/generar_insignias.py`
(SVG vectorial → cairosvg). Diseño v1 (`image_version = 1`).

## Cumplimiento del estándar del proyecto
- **Maestro 1024×1024 con transparencia alfa real** (verificado: esquina RGBA
  alfa 0 en las 12; sin fondo negro dentro del archivo).
- Exportes exactos 512 / 256 / 128 / 64 / 32 + **WebP** (256 y 128).
- **Sin textos dentro de los emblemas** (nombres/descripción los pinta HTML →
  accesibilidad y cero errores tipográficos).
- Mismo lienzo, centro visual consistente, márgenes de seguridad (contenido
  dentro del 88 % del lienzo), contorno completo, **lectura correcta a 32 px**
  (verificada visualmente con zoom 4×).
- Identidad visual VANTS: negro carbón, rojo `#ff0d2e`, plata, azul
  tecnológico `#2f7bff`, dorado `#f5c044`, violeta `#b44cff`, platino, bronce;
  geometría angular, escudos hexagonales (membresías), heráldicos
  (competitivos) y redondeados (identidad); relieve metálico con bisel y halo
  controlado.
- Cada insignia se diseñó individualmente (no recortes de un póster).

## R2 — almacenamiento versionado
Bucket **`vants-badge-assets-preview`** creado en la cuenta de PREVIEW con las
claves canónicas versionadas (**97 objetos**):

```
badges/v1/<code>/<tamaño>.png        (12 × 6)
badges/v1/<code>/<tamaño>.webp       (12 × 2)
badges/v1/badge-manifest.json
```

Reglas: **no se sobrescriben versiones históricas** — un rediseño futuro sube a
`badges/v2/…`, se registra en `badge_asset_variants` y se sube
`image_version` en `badge_definitions`; las referencias viejas siguen
resolviendo.

## Serving y fallback
- El sitio sirve por Assets CDN (`/assets/badges/...`) con `?v=<image_version>`
  en la URL para cacheo estable.
- El binding `BADGE_ASSETS` (R2) queda documentado en `wrangler.preview.toml`
  pendiente de permiso del token API (subir objetos funciona; el *binding*
  devuelve 10085) — el serving no depende de R2.
- En la UI toda imagen usa `object-fit: contain` + dimensiones reservadas y
  **fallback gráfico** (inicial sobre placa) si el recurso no carga: un PNG
  roto jamás desplaza el diseño del perfil.

## Manifiesto
`badge-manifest.json` = registro visual de la colección sincronizable con la
base (`badge_asset_variants`): code, carpeta, versión y para cada archivo su
ruta, sha256 y dimensiones. El panel admin (RECURSOS GRÁFICOS) lo lista con
vista previa, checksum y **detección de imágenes ausentes** en vivo.
