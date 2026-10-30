/* VANTS GAMES — requisitos de inscripción a torneos + registro obligatorio.
   · Pinta la tarjeta REQUISITOS DE INSCRIPCIÓN (Discord + WhatsApp, estilo
     rojo) dentro de #requisitos-inscripcion si la página la trae.
   · Intercepta los CTA con [data-requiere-cuenta]: sin sesión VANTS abre el
     registro (obligatorio para competir); con sesión deja pasar.
   Autocontenido (prefijo rt-), sin dependencias: usa window.VantAuth0 si está. */
(function () {
  "use strict";
  if (document.getElementById("vants-rt-listo")) return;
  var marca = document.createElement("meta");
  marca.id = "vants-rt-listo";
  document.head.appendChild(marca);

  /* ── ENLACES OFICIALES DEL EQUIPO ─────────────────────────────────
     Con enlace la fila abre en pestaña nueva; sin enlace, avisa. */
  var ENLACE_DISCORD = "https://discord.gg/HUe4YuVgct";
  var ENLACE_WHATSAPP = "https://whatsapp.com/channel/0029Vb8hgY0ADTOAF5tDXD0J";

  var ROJO = "#ff0d2e"; /* el rojo de la web */

  /* ── estilos (autocontenidos, prefijo rt-) ── */
  var st = document.createElement("style");
  st.id = "vants-rt-css";
  st.textContent =
    ".rt-zona{margin:16px 0 0}" +
    ".rt-titulo{display:flex;align-items:center;gap:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#fff}" +
    ".rt-titulo svg{flex:none}" +
    ".rt-tarjeta{margin-top:10px;border:2px solid #ff0d2e;border-radius:14px;padding:10px;background:rgba(255,13,46,.06);display:grid;gap:8px}" +
    ".rt-fila{display:flex;align-items:center;gap:12px;background:#0e0e11;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:11px 14px;color:#fff;text-decoration:none;cursor:pointer;transition:border-color .15s,transform .12s;font-family:inherit;text-align:left;width:100%}" +
    ".rt-fila:hover{border-color:rgba(255,13,46,.6);transform:translateY(-1px)}" +
    ".rt-ico{width:34px;height:34px;border-radius:9px;flex:none;display:grid;place-items:center;overflow:hidden}" +
    ".rt-ico img{width:26px;height:26px;display:block}" +
    ".rt-ico--wap{background:#25D366}" +
    ".rt-ico--wap svg{width:22px;height:22px}" +
    ".rt-texto{flex:1;font-weight:800;font-size:12.5px;letter-spacing:.02em;text-transform:uppercase;line-height:1.35}" +
    ".rt-flecha{color:#8a8a93;font-size:18px;font-weight:900;flex:none;line-height:1}" +
    /* modal de registro obligatorio (acento rojo) */
    ".rt-capa{position:fixed;inset:0;z-index:9600;background:rgba(4,4,6,.84);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:18px;animation:rtin .18s ease}" +
    ".rt-caja{width:100%;max-width:432px;background:#0d0d10;border:1px solid rgba(255,13,46,.35);border-radius:14px;padding:26px 24px 20px;box-shadow:0 30px 80px rgba(0,0,0,.6);position:relative}" +
    ".rt-marca{display:flex;align-items:center;gap:10px;margin-bottom:16px}" +
    ".rt-marca img{width:34px;height:34px;display:block;box-shadow:0 0 16px rgba(255,13,46,.35);border-radius:9px}" +
    ".rt-marca b{font-size:15px;letter-spacing:.02em;color:#fff}" +
    ".rt-paso{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#ff5d72;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 6px}" +
    ".rt-tit{font-size:24px;line-height:1.08;font-weight:900;text-transform:uppercase;margin:0 0 8px;color:#fff}" +
    ".rt-tit em{color:" + ROJO + ";font-style:normal}" +
    ".rt-sub{color:#a1a1aa;font-size:13.5px;line-height:1.55;margin:0 0 18px}" +
    ".rt-btn{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border-radius:9px;border:0;cursor:pointer;font-weight:800;text-transform:uppercase;font-size:13.5px;letter-spacing:.03em;color:#fff;margin-bottom:10px;transition:filter .15s;font-family:inherit}" +
    ".rt-btn:hover{filter:brightness(1.09)}" +
    ".rt-m{width:24px;height:24px;border-radius:6px;background:rgba(0,0,0,.28);display:grid;place-items:center;font-size:13px;font-weight:900;flex:none}" +
    ".rt-m img{width:20px;height:20px;display:block;object-fit:contain}" +
    ".rt-btn--google{background:#fff;color:#141414}.rt-btn--google .rt-m{background:#e8f0fe;color:#4285F4}" +
    ".rt-btn--discord{background:#5865F2}.rt-btn--discord .rt-m{background:rgba(0,0,0,.22)}" +
    ".rt-btn--correo{background:#151518;color:#f4f4f5;border:1px solid rgba(255,13,46,.6)}.rt-btn--correo:hover{background:rgba(255,13,46,.12)}.rt-btn--correo .rt-m{background:" + ROJO + ";color:#fff}" +
    ".rt-pies{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:14px 0 0}" +
    ".rt-link{background:none;border:none;padding:4px 0;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#a1a1aa;cursor:pointer;text-decoration:underline dotted}.rt-link:hover{color:" + ROJO + "}" +
    ".rt-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#a1a1aa;font-size:15px;cursor:pointer}" +
    ".rt-x:hover{color:#fff;border-color:rgba(255,13,46,.5)}" +
    ".rt-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:9700;background:#141417;border:1px solid rgba(255,13,46,.55);color:#ffc9d1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:12px 18px;border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.6);animation:rtin .18s ease;max-width:90vw;text-align:center}" +
    "@keyframes rtin{from{opacity:0}to{opacity:1}}" +
    "@media (max-width:520px){.rt-caja{padding:22px 18px 16px}.rt-tit{font-size:21px}}";
  document.head.appendChild(st);

  /* ── utilidades ── */
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "rt-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function auth() { return window.VantAuth0 || null; }
  function irCon(conexion) {
    var a = auth();
    if (a && a.entrarCon) { a.entrarCon(conexion); return; }
    if (a && a.entrar) { a.entrar(); return; }
    toast("NO SE PUDO ABRIR EL REGISTRO · RECARGA LA PÁGINA");
  }
  function irCorreo(opcion) {
    var a = auth();
    if (a && a.entrarCorreo) { a.entrarCorreo(opcion); return; }
    if (a && a.entrar) { a.entrar(); return; }
    toast("NO SE PUDO ABRIR EL REGISTRO · RECARGA LA PÁGINA");
  }

  /* ── tarjeta REQUISITOS DE INSCRIPCIÓN ── */
  var SVG_WA = '<svg viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';

  function filaRequisito(opts) {
    var f = document.createElement(opts.href ? "a" : "button");
    if (opts.href) { f.href = opts.href; f.target = "_blank"; f.rel = "noopener"; }
    else f.type = "button";
    f.className = "rt-fila";
    f.innerHTML =
      '<span class="rt-ico ' + (opts.icoExtra || "") + '">' + opts.ico + "</span>" +
      '<span class="rt-texto">' + opts.texto + "</span>" +
      '<span class="rt-flecha">›</span>';
    if (!opts.href) f.addEventListener("click", opts.alClic);
    return f;
  }

  function pintarTarjeta() {
    var zona = document.getElementById("requisitos-inscripcion");
    if (!zona || zona.dataset.lista) return;
    zona.dataset.lista = "1";
    zona.className += " rt-zona";

    var titulo = document.createElement("p");
    titulo.className = "rt-titulo";
    titulo.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + ROJO + '"><path d="M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .59 1.42l9 9a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.84zM7.5 8A1.5 1.5 0 1 1 9 6.5 1.5 1.5 0 0 1 7.5 8z"/></svg>' +
      "Requisitos de inscripción";
    zona.appendChild(titulo);

    var tarjeta = document.createElement("div");
    tarjeta.className = "rt-tarjeta";

    tarjeta.appendChild(filaRequisito({
      href: ENLACE_DISCORD || null,
      ico: '<img src="/static/img/logo-discord.png" alt="Discord">',
      texto: "Unete al Discord y pide rol para validar tu inscripción (obligatorio)",
      alClic: function () { toast("ENLACE DE DISCORD PENDIENTE · LO CONFIGURA EL EQUIPO VANTS"); }
    }));
    tarjeta.appendChild(filaRequisito({
      href: ENLACE_WHATSAPP || null,
      ico: '<span class="rt-ico rt-ico--wap">' + SVG_WA + "</span>",
      texto: "Unete al grupo de WhatsApp para validar la inscripción (obligatorio)",
      alClic: function () { toast("ENLACE DE WHATSAPP PENDIENTE · LO CONFIGURA EL EQUIPO VANTS"); }
    }));

    zona.appendChild(tarjeta);
  }

  /* ── registro obligatorio en los CTA de torneos ── */
  function abrirGate() {
    var vieja = document.getElementById("rt-capa");
    if (vieja) vieja.remove();
    var capa = document.createElement("div");
    capa.className = "rt-capa";
    capa.id = "rt-capa";
    capa.innerHTML =
      '<div class="rt-caja">' +
        '<div class="rt-marca"><img src="/static/img/vants-logo-circular.png" alt="V"><b>VANTS GAMES</b></div>' +
        '<p class="rt-paso">registro obligatorio · torneos</p>' +
        '<h2 class="rt-tit">Registrate <em>para competir</em></h2>' +
        '<p class="rt-sub">Para inscribir tu equipo necesitás cuenta VANTS verificada. Además debés unirte a Discord y WhatsApp para validar la inscripción.</p>' +
        '<button type="button" class="rt-btn rt-btn--google"><span class="rt-m"><img src="/static/img/logo-google.png" alt=""></span>Registrarme con Google</button>' +
        '<button type="button" class="rt-btn rt-btn--discord"><span class="rt-m"><img src="/static/img/logo-discord.png" alt=""></span>Registrarme con Discord</button>' +
        '<button type="button" class="rt-btn rt-btn--correo"><span class="rt-m">@</span>Registrarme con correo</button>' +
        '<div class="rt-pies"><button type="button" class="rt-link" id="rt-ya">¿ya tenés cuenta? entrar con correo</button></div>' +
      "</div>";
    var x = document.createElement("button");
    x.type = "button";
    x.className = "rt-x";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Cerrar");
    x.addEventListener("click", function () { capa.remove(); });
    capa.querySelector(".rt-caja").appendChild(x);
    capa.addEventListener("click", function (e) { if (e.target === capa) capa.remove(); });
    var bg = capa.querySelector(".rt-btn--google");
    var bd = capa.querySelector(".rt-btn--discord");
    var bc = capa.querySelector(".rt-btn--correo");
    if (bg) bg.addEventListener("click", function () { irCon("google-oauth2"); });
    if (bd) bd.addEventListener("click", function () { irCon("discord"); });
    if (bc) bc.addEventListener("click", function () { irCorreo("registrar"); });
    var ya = capa.querySelector("#rt-ya");
    if (ya) ya.addEventListener("click", function () { irCorreo(); });
    document.body.appendChild(capa);
  }

  document.addEventListener("click", function (e) {
    var cta = e.target.closest ? e.target.closest("[data-requiere-cuenta]") : null;
    if (!cta) return;
    var a = auth();
    if (!a || !a.listo) return; /* sin auth cableado, comportamiento normal */
    e.preventDefault();
    e.stopPropagation();
    a.listo().then(function (u) {
      if (u) { window.location.href = cta.getAttribute("href") || "/perfil"; return; }
      abrirGate();
    }).catch(function () { abrirGate(); });
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pintarTarjeta);
  } else {
    pintarTarjeta();
  }
})();
