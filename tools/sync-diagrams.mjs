#!/usr/bin/env node
/**
 * MDSA · Mermaid Diagram Sync Assistant
 * =====================================
 * Mantiene los diagramas Mermaid de los README sincronizados con la
 * configuración REAL del repo. La fuente de verdad son los `wrangler.toml`:
 * el script los lee, extrae lo que hay desplegado de verdad (nombre de cada
 * Worker, bindings de D1/KV/Workers AI, assets, crons, vars relevantes) y
 * regenera los diagramas entre los marcadores MDSA de cada README.
 *
 * Modos:
 *   node tools/sync-diagrams.mjs           escribe los README actualizados
 *   node tools/sync-diagrams.mjs --check   no escribe; exit 1 si hay desync (modo CI)
 *
 * Marcadores (el asistente es dueño de lo que queda entre ellos; lo que
 * se edite a mano dentro se pierde en la siguiente sincronización):
 *   <!-- MDSA:inicio id=arquitectura -->
 *   ...diagrama generado...
 *   <!-- MDSA:fin id=arquitectura -->
 *
 * Sin dependencias: Node 18+ puro. Guía completa de uso en la sección
 * «Mermaid Diagram Sync Assistant (MDSA)» del README raíz.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODO_CHECK = process.argv.includes('--check');

/* ────────────────────────────────────────────────────────────────────────
 * 1 · FUENTE DE VERDAD: los wrangler.toml de los Workers
 * ────────────────────────────────────────────────────────────────────────
 * Si añades un Worker nuevo al repo, añade su wrangler.toml aquí y el
 * diagrama de arquitectura/pipeline lo incluirá solo. Si borras uno, sus
 * nodos y aristas desaparecen solos: eso ES la sincronización.
 */
const WRANGLERS = [
  'vants-server/wrangler.toml',
  'vants-functions/wrangler.toml',
  'kick-bot/wrangler.toml',
];

/* URLs públicas workers.dev: no están en el toml (las asigna la cuenta de
 * Cloudflare). Si el subdominio de la cuenta cambia, editar SOLO esta tabla. */
const URL_WORKERS = {
  'vants': 'vants.vants.workers.dev',
  'vants-functions': 'vants-functions.vants.workers.dev',
  'vants-kick': 'vants-kick.vants.workers.dev',
};

/* Papel de cada Worker en el ecosistema (etiqueta del nodo). */
const PAPELES = {
  'vants': 'web + API + logros',
  'vants-functions': 'pagos + funciones /fn/*',
  'vants-kick': 'bot del chat de Kick',
};

/* ────────────────────────────────────────────────────────────────────────
 * 2 · Lectura y parseo mínimo de wrangler.toml (regex, sin dependencias)
 * ──────────────────────────────────────────────────────────────────────── */

function parseWrangler(rel) {
  const ruta = join(RAIZ, rel);
  if (!existsSync(ruta)) return null;
  const txt = readFileSync(ruta, 'utf8');

  const campo = (k) => {
    const m = txt.match(new RegExp('^\\s*' + k + '\\s*=\\s*"([^"]+)"', 'm'));
    return m ? m[1] : null;
  };

  // bloques [[tipo]] … hasta la siguiente tabla [algo] o fin de archivo
  const bloques = (tipo) =>
    [...txt.matchAll(new RegExp('\\[\\[' + tipo + '\\]\\]([\\s\\S]*?)(?=\\n\\[)', 'g'))]
      .map((m) => m[1]);

  const kv = bloques('kv_namespaces')
    .map((b) => ({
      binding: (b.match(/^\s*binding\s*=\s*"([^"]+)"/m) || [])[1],
      id: (b.match(/^\s*id\s*=\s*"([^"]+)"/m) || [])[1],
    }))
    .filter((x) => x.binding);

  const d1 = bloques('d1_databases')
    .map((b) => ({
      binding: (b.match(/^\s*binding\s*=\s*"([^"]+)"/m) || [])[1],
      database_name: (b.match(/^\s*database_name\s*=\s*"([^"]+)"/m) || [])[1],
    }))
    .filter((x) => x.binding);

  const ai = (txt.match(/\[ai\][\s\S]*?binding\s*=\s*"([^"]+)"/) || [])[1] || null;
  const assets = (txt.match(/\[assets\][\s\S]*?directory\s*=\s*"([^"]+)"/) || [])[1] || null;
  const crons = (txt.match(/crons\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  const listaCrons = crons
    .split(',')
    .map((s) => s.trim().replace(/["']/g, ''))
    .filter(Boolean);

  // solo las claves de [vars] (los secretos viven aparte y no se parsean)
  const secVars = txt.split(/^\s*\[vars\]\s*$/m)[1] || '';
  const corte = secVars.search(/^\s*\[/m);
  const varsTxt = corte >= 0 ? secVars.slice(0, corte) : secVars;
  const vars = [...varsTxt.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);

  // código del Worker real (el archivo `main` del toml, p.ej. worker.js):
  // sirve para verificar contra el CÓDIGO, no solo contra la configuración
  let codigo = null;
  const archivoMain = campo('main');
  if (archivoMain) {
    try { codigo = readFileSync(join(dirname(ruta), archivoMain), 'utf8'); } catch { codigo = null; }
  }

  return { rel, nombre: campo('name'), main: archivoMain, kv, d1, ai, assets, crons: listaCrons, vars, txt, codigo };
}

const WORKERS = WRANGLERS.map(parseWrangler).filter(Boolean);
const w = (nombre) => WORKERS.find((x) => x.nombre === nombre) || null;

/* Ids de nodo estables a partir del nombre real del Worker. */
const idWorker = (nombre) => 'WF_' + String(nombre).replace(/[^A-Za-z0-9]/g, '_').toUpperCase();

/* ────────────────────────────────────────────────────────────────────────
 * 3 · TOPOLOGÍA (quién habla con quién)
 * ────────────────────────────────────────────────────────────────────────
 * Los NODOS salen de los wrangler.toml; las ARISTAS son semántica que no
 * vive en ningún toml, así que se declara aquí. Cada arista se emite solo
 * si la configuración que la justifica existe (binding, var, endpoint…):
 * si quitas por ejemplo el binding AI del bot, la arista desaparece.
 * Si una arista referencia un nodo que ya no existe, se omite con aviso
 * (nunca rompe la ejecución).
 */

function aristasArquitectura(aviso) {
  const e = [];
  const web = w('vants');
  const fn = w('vants-functions');
  const bot = w('vants-kick');

  if (web) {
    if (web.assets) e.push(`GENTE_VISIT -->|"sitio estático ${web.assets}/"| ${idWorker('vants')}`);
    for (const d of web.d1) e.push(`${idWorker('vants')} ---|"D1 ${d.binding}"| DB_${d.binding.replace(/[^A-Za-z0-9]/g, '_')}`);
    if (web.crons.length && web.d1.some((d) => d.binding === 'DB')) {
      e.push(`${idWorker('vants')} -.->|"cron ${web.crons[0]} · pump outbox"| DB_DB`);
    }
    if (web.vars.includes('AGENTID_CLIENT_ID')) e.push(`${idWorker('vants')} -->|"login de agentes AgentID"| EXT_AGENTID`);
    if (fn && fn.txt.includes('stripe-checkout')) e.push(`${idWorker('vants')} -->|"/fn/stripe-checkout"| ${idWorker('vants-functions')}`);
  }
  if (fn) {
    if (fn.d1.some((d) => d.binding === 'DB')) e.push(`${idWorker('vants-functions')} ---|"D1 DB"| DB_DB`);
    e.push(`${idWorker('vants-functions')} -->|"crea checkout"| EXT_STRIPE`);
    e.push(`EXT_STRIPE -->|"webhook pagos"| ${idWorker('vants-functions')}`);
  }
  if (bot) {
    e.push(`GENTE_CHAT -->|"webhook chat.message.sent"| ${idWorker('vants-kick')}`);
    if (bot.kv.length) e.push(`${idWorker('vants-kick')} ---|"KV ${bot.kv.map((k) => k.binding).join(', ')}"| KV_${bot.kv[0].binding.replace(/[^A-Za-z0-9]/g, '_')}`);
    if (bot.ai) e.push(`${idWorker('vants-kick')} -->|"!ia"| WF_AI`);
    if (bot.txt.includes('/public/v1/chat')) e.push(`${idWorker('vants-kick')} -->|"responde POST /public/v1/chat"| EXT_KICK`);
    if (bot.txt.includes('/clipper/queue')) e.push(`GENTE_CLIP -->|"GET /clipper/queue + CLIPPER_SECRET"| ${idWorker('vants-kick')}`);
  }

  // validación: toda arista debe referenciar nodos que existan. Los ids de
  // nodo están FUERA de las etiquetas, así que primero se quita lo citado
  // entre comillas ("D1 DB", "POST /public/…"…) y solo entonces se extraen
  // los tokens en MAYÚSCULAS.
  return e.filter((linea) => {
    const fuera = linea.replace(/"[^"]*"/g, ' ');
    const ids = [...fuera.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]);
    const faltan = ids.filter((id) => !nodosConocidos().has(id));
    if (faltan.length) { aviso(`arista omitida (nodo inexistente: ${faltan.join(', ')}): ${linea}`); return false; }
    return true;
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * 4 · Constructores de diagramas (cada uno devuelve Mermaid puro)
 * ──────────────────────────────────────────────────────────────────────── */

function nodosConocidos() {
  const s = new Set(['GENTE_VISIT', 'GENTE_CHAT', 'GENTE_CLIP', 'EXT_KICK', 'EXT_STRIPE', 'EXT_AGENTID', 'WF_AI']);
  for (const x of WORKERS) s.add(idWorker(x.nombre));
  for (const x of WORKERS) for (const d of x.d1) s.add('DB_' + d.binding.replace(/[^A-Za-z0-9]/g, '_'));
  for (const x of WORKERS) for (const k of x.kv) s.add('KV_' + k.binding.replace(/[^A-Za-z0-9]/g, '_'));
  return s;
}

function buildArquitectura(aviso) {
  const L = [];
  L.push('flowchart LR');
  L.push('  subgraph GENTE["Gente"]');
  L.push('    GENTE_VISIT["Visitantes de la web"]');
  L.push('    GENTE_CHAT["Chat del directo de Kick"]');
  L.push('    GENTE_CLIP["VANTS Clipper · PC local"]');
  L.push('  end');

  L.push('  subgraph CF["Cloudflare Workers"]');
  for (const x of WORKERS) {
    const url = URL_WORKERS[x.nombre] || x.nombre + '.workers.dev';
    const papel = PAPELES[x.nombre] || x.main || 'worker';
    L.push(`    ${idWorker(x.nombre)}["${x.nombre} · ${papel}<br/>${url}"]`);
  }
  // stores deduplicados: dos Workers pueden compartir el MISMO binding
  // (vants y vants-functions comparten D1 DB) → el nodo se dibuja una vez
  const emitidos = new Set();
  for (const x of WORKERS) for (const d of x.d1) {
    const id = 'DB_' + d.binding.replace(/[^A-Za-z0-9]/g, '_');
    if (!emitidos.has(id)) { emitidos.add(id); L.push(`    ${id}[("D1 · ${d.database_name || d.binding}")]`); }
  }
  for (const x of WORKERS) for (const k of x.kv) {
    const id = 'KV_' + k.binding.replace(/[^A-Za-z0-9]/g, '_');
    if (!emitidos.has(id)) { emitidos.add(id); L.push(`    ${id}[("KV · ${k.binding}")]`); }
  }
  if (WORKERS.some((x) => x.ai)) L.push('    WF_AI["Workers AI"]');
  L.push('  end');

  // Externos: solo se dibujan los que alguna arista realmente usa
  const usados = new Set(aristasArquitectura(() => {}).join(' ').match(/EXT_[A-Z]+/g) || []);
  L.push('  subgraph EXT["Externos"]');
  if (usados.has('EXT_KICK')) L.push('    EXT_KICK["Kick · id.kick.com + api.kick.com"]');
  if (usados.has('EXT_STRIPE')) L.push('    EXT_STRIPE["Stripe · live"]');
  if (usados.has('EXT_AGENTID')) L.push('    EXT_AGENTID["AgentID · AgentMail"]');
  L.push('  end');

  L.push('');
  L.push(...aristasArquitectura(aviso).map((l) => '  ' + l));
  L.push('');
  L.push('  classDef ext stroke:#9333ea,stroke-dasharray:4 2;');
  L.push('  class EXT_KICK,EXT_STRIPE,EXT_AGENTID ext;');
  return L.join('\n');
}

function buildPipeline() {
  const L = [];
  L.push('flowchart TD');
  L.push('  PUSH["push a main"] --> CI["GitHub Actions"]');
  if (existsSync(join(RAIZ, 'scripts/test_plataforma.js'))) {
    L.push('  CI --> TEST["tests.yml · test_plataforma + test_mm + test_vantsbot + audit_enlaces"]');
    L.push('  TEST --> VERDE["asserts verdes"]');
  }
  const rutas = {
    'vants': 'cloudflare-deploy.yml · vants-server/**',
    'vants-functions': 'cloudflare-deploy-functions.yml · vants-functions/**',
    'vants-kick': 'cloudflare-deploy-kickbot.yml · kick-bot/**',
  };
  let n = 0;
  for (const x of WORKERS) {
    n += 1;
    const job = 'JOB' + n;
    L.push(`  CI --> ${job}["deploy por carpeta · ${rutas[x.nombre] || x.rel}"]`);
    L.push(`  ${job} --> WR_${n}["npx wrangler deploy → ${x.nombre}"]`);
  }
  if (n) {
    L.push('  COLA["Cloudflare · cola deploy-prod (un deploy a la vez)"]');
    for (let i = 1; i <= n; i++) L.push(`  WR_${i} --> COLA`);
  }
  L.push('  COLA --> LIVE["3 Workers en producción"]');
  return L.join('\n');
}

/* Comandos del bot declarados aquí; MDSA verifica que existan en worker.js
 * (avisa si documentas un comando que el código no tiene). */
const COMANDOS_BOT = ['ia', 'pregunta', 'bot', 'puntos', 'diario', 'top', 'canje', 'canjear', 'clip', 'clipar', 'comandos', 'uptime', 'setcmd', 'delcmd'];

function buildBotFlujo(aviso) {
  const bot = w('vants-kick');
  if (!bot) { aviso('kick-bot/wrangler.toml no está: diagrama bot-flujo vacío'); return 'flowchart TD\n  SIN_BOT["kick-bot no está en el repo"]'; }
  const codigo = bot.codigo || '';
  for (const c of COMANDOS_BOT) {
    if (!codigo.includes("'" + c + "'")) aviso(`el comando !${c} está documentado en MDSA pero no aparece en ${bot.main} de ${bot.nombre}`);
  }
  const L = [];
  L.push('flowchart TD');
  L.push('  MSG["mensaje del chat que empieza por ! o ¡"] --> WH["POST /kick/webhook · firma verificada"]');
  L.push('  WH --> R{"router de comandos"}');
  L.push('  R -->|"ia · pregunta · bot + texto"| WF_AI["Workers AI · cerebro de !ia"]');
  L.push('  R -->|"puntos · diario · top · canje"| PK["puntos OFICIALES de Kick: moneda del chat, bonus del reproductor, tienda de recompensas"]');
  L.push('  R -->|"clip · clipar"| KVQ[("KV clipreq:* · cola de clips")]');
  L.push('  R -->|"comandos · uptime · setcmd · delcmd + comandos propios"| GEN["respuesta directa"]');
  L.push('  WF_AI --> OUT["POST /public/v1/chat · respuesta al canal"]');
  L.push('  PK --> OUT');
  L.push('  GEN --> OUT');
  L.push('  KVQ --> Q["GET /clipper/queue?secret=… · entrega una sola vez"]');
  L.push('  Q --> CLIP["VANTS Clipper en la PC del dueño"]');
  return L.join('\n');
}

/* Registro de diagramas: id → constructor. Para añadir uno nuevo, crea su
 * función build… y regístrala aquí + pon los marcadores en el README. */
const DIAGRAMAS = {
  'arquitectura': buildArquitectura,
  'pipeline': buildPipeline,
  'bot-flujo': buildBotFlujo,
};

/* Dónde vive cada diagrama (archivo → ids). Si el archivo no tiene los
 * marcadores de un id, se avisa y se ignora (nunca se crea contenido). */
const DESTINOS = [
  { archivo: 'README.md', ids: ['arquitectura', 'pipeline'] },
  { archivo: 'kick-bot/README.md', ids: ['bot-flujo'] },
];

/* ────────────────────────────────────────────────────────────────────────
 * 5 · Inyección entre marcadores + autocomprobación de sintaxis Mermaid
 * ──────────────────────────────────────────────────────────────────────── */

function injecta(contenido, id, mermaid, aviso) {
  const re = new RegExp('(<!--\\s*MDSA:inicio[^>]*id=' + id + '[^>]*-->)([\\s\\S]*?)(<!--\\s*MDSA:fin[^>]*id=' + id + '[^>]*-->)');
  if (!re.test(contenido)) { aviso(`${id}: el archivo no tiene los marcadores MDSA (no se crea nada)`); return contenido; }
  const bloque = '\n```mermaid\n' + mermaid + '\n```\n';
  return contenido.replace(re, (_m, abre, _viejo, cierra) => abre + bloque + '  ' + cierra);
}

function autocheck(mermaid, id, aviso) {
  const abre = (mermaid.match(/\[/g) || []).length;
  const cierra = (mermaid.match(/\]/g) || []).length;
  if (abre !== cierra) aviso(`${id}: corchetes desbalanceados (abre=${abre}, cierra=${cierra})`);
  if ((mermaid.match(/"/g) || []).length % 2 !== 0) aviso(`${id}: comillas dobles impares`);
  if (!/^flowchart (LR|TD|RL|BT)/.test(mermaid.trim())) aviso(`${id}: no empieza con «flowchart LR|TD»`);
}

/* ────────────────────────────────────────────────────────────────────────
 * 6 · Ejecución
 * ──────────────────────────────────────────────────────────────────────── */

const avisos = [];
const aviso = (msg) => avisos.push('  aviso: ' + msg);

console.log('MDSA · Mermaid Diagram Sync Assistant');
console.log('Workers detectados en los wrangler.toml:');
for (const x of WORKERS) {
  const piezas = [];
  if (x.d1.length) piezas.push('D1: ' + x.d1.map((d) => d.binding).join(','));
  if (x.kv.length) piezas.push('KV: ' + x.kv.map((k) => k.binding).join(','));
  if (x.ai) piezas.push('AI');
  if (x.assets) piezas.push('assets ' + x.assets);
  if (x.crons.length) piezas.push('cron ' + x.crons.join(' '));
  console.log(`  · ${x.nombre} (${x.rel}) ${piezas.length ? '→ ' + piezas.join(' · ') : ''}`);
}

const cambios = [];
for (const destino of DESTINOS) {
  const ruta = join(RAIZ, destino.archivo);
  if (!existsSync(ruta)) { aviso(`${destino.archivo}: no existe`); continue; }
  let contenido = readFileSync(ruta, 'utf8');
  const original = contenido;
  for (const id of destino.ids) {
    const build = DIAGRAMAS[id];
    if (!build) { aviso(`${id}: sin constructor registrado en DIAGRAMAS`); continue; }
    const mermaid = build((m) => avisos.push('  aviso: ' + m));
    autocheck(mermaid, id, (m) => avisos.push('  aviso: ' + m));
    contenido = injecta(contenido, id, mermaid, (m) => avisos.push('  aviso: ' + m));
  }
  if (contenido !== original) {
    cambios.push(destino.archivo);
    if (!MODO_CHECK) writeFileSync(ruta, contenido);
    console.log(`  actualizado: ${destino.archivo}`);
  } else {
    console.log(`  sin cambios: ${destino.archivo}`);
  }
}

if (avisos.length) { console.log('Avisos:'); for (const a of avisos) console.log(a); }

if (MODO_CHECK) {
  if (cambios.length) {
    console.error(`MDSA --check: DESINCRONIZADO (${cambios.join(', ')}). Ejecuta: node tools/sync-diagrams.mjs`);
    process.exit(1);
  }
  console.log('MDSA --check: todo sincronizado ✔');
}
