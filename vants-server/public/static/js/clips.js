/* VANTS GAMES — clips: vitrina pública + gestión con subida desde el escritorio.
   Igual que la web antigua: GET /api/clips/featured (vitrina), POST con el JWT
   de tu sesión (video + miniatura capturada en el navegador + título), DELETE
   de tus propios clips. Los datos vienen SIEMPRE de la API: nada de semillas.

   FIX S4.3 (nombre de la cuenta en los clips):
   · TUS clips muestran tu NOMBRE DE LA CUENTA (perfil → Mis datos), no el del
     correo ni el de Google. Se reconocen por el sub de tu sesión.
   · Al subir, el clip viaja también con "nombre_vants" para que, cuando el
     servidor lo guarde, tu nombre se vea en TODOS los navegadores.
   · Si no hay nombre propio guardado, se muestra el de siempre. */
(function () {
  "use strict";

  var MAX_MB = 48;
  var MAX_BYTES = MAX_MB * 1048576;
  var EXTS = ["webm", "mp4", "mkv", "mov", "m4v"];

  var vitrina = document.getElementById("vitrina");
  var contador = document.getElementById("vitrina-contador");
  var cuerpoGestionar = document.getElementById("gestionar-cuerpo");
  var estadoGestionar = document.getElementById("gestionar-estado");
  var modal = document.getElementById("modal-clip");

  if (!vitrina || !cuerpoGestionar) return;
  var toast = (window.VantsPerfil && window.VantsPerfil.toast) || function () {};

  /* ── helpers ── */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDur(s) {
    s = parseInt(s, 10) || 0;
    if (!s) return "";
    var m = Math.floor(s / 60), x = s % 60;
    return m + ":" + (x < 10 ? "0" : "") + x;
  }
  function fmtMB(b) { return (b > 0) ? (b / 1048576).toFixed(1) + " MB" : ""; }
  function fmtFecha(iso) {
    try { return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }); }
    catch (_e) { return ""; }
  }

  var cacheClips = null, cacheAt = 0;

  /* ── FIX S4.3: nombre de la cuenta para los clips ── */
  function nickVants() {
    try {
      var p = JSON.parse(localStorage.getItem("vants_perfil_v1") || "null");
      return (p && p.nick) ? String(p.nick) : "";
    } catch (_e) { return ""; }
  }
  function nombreParaClip(c) {
    if (c && c.nombre_vants) return c.nombre_vants;              /* futuro campo del servidor */
    if (sesion && c && c.sub && c.sub === sesion.sub) {          /* tus clips → tu nombre VANTS */
      var propio = nickVants();
      if (propio) return propio;
    }
    return (c && (c.nick || c.username)) || "JUGADOR";           /* como hoy */
  }

  function clipsDestacados() {
    if (cacheClips && Date.now() - cacheAt < 60000) return Promise.resolve(cacheClips);
    return fetch("/api/clips/featured", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        cacheClips = (j && j.ok && Array.isArray(j.clips)) ? j.clips : [];
        cacheAt = Date.now();
        return cacheClips;
      })
      .catch(function () { return cacheClips || []; });
  }

  /* ── VITRINA ── */
  function tarjeta(c) {
    var art = document.createElement("article");
    art.className = "panel clipc";
    art.setAttribute("data-fid", c.id);
    art.innerHTML =
      '<div class="clipc__mini">' +
      (c.thumb ? '<img src="' + esc(c.thumb) + '" alt="" loading="lazy">' : "") +
      (c.dur ? '<span class="clipc__dur">' + esc(fmtDur(c.dur)) + "</span>" : "") +
      '<span class="clipc__play" aria-hidden="true">▶</span>' +
      "</div>" +
      '<div class="clipc__cuerpo">' +
      '<div class="clipc__titulo">' + esc(c.titulo || "Clip destacado") + "</div>" +
      '<div class="clipc__meta"><b>' + esc(nombreParaClip(c)) + "</b>" +
      '<span class="clipc__juego">' + esc(c.juego || "VALORANT") + "</span>" +
      (c.tam ? "<span>" + esc(fmtMB(c.tam)) + "</span>" : "") +
      "<span>" + esc(fmtFecha(c.fecha)) + "</span></div>" +
      "</div>";
    art.addEventListener("click", function () { abrirClip(c.id); });
    return art;
  }

  function renderVitrina(list) {
    contador.textContent = list.length + (list.length === 1 ? " CLIP" : " CLIPS");
    vitrina.innerHTML = "";
    if (!list.length) {
      vitrina.innerHTML =
        '<div class="vitrina__vacio panel"><h3>TODAVÍA NO HAY CLIPS PUBLICADOS</h3>' +
        "<p>Sé el primero: entrá con tu cuenta, pulsá «SUBIR CLIP DESDE EL ESCRITORIO» " +
        "y tu jugada sale aquí para toda la arena.</p></div>";
      return;
    }
    list.forEach(function (c) { vitrina.appendChild(tarjeta(c)); });
  }

  /* ── REPRODUCTOR ── */
  function abrirClip(id) {
    clipsDestacados().then(function (list) {
      var c = null;
      for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) c = list[i];
      if (!c) { toast("ESE CLIP YA NO ESTÁ DISPONIBLE", true); return; }
      document.getElementById("modal-titulo").textContent = (c.titulo || "Clip destacado").toUpperCase();
      document.getElementById("modal-meta").innerHTML =
        "SUBIDO POR <b>" + esc(nombreParaClip(c)) + "</b> · " + esc(c.juego || "VALORANT") +
        " · " + esc(fmtFecha(c.fecha)) + (c.tam ? " · " + esc(fmtMB(c.tam)) : "");
      var v = document.getElementById("modal-video");
      v.src = c.video || "";
      modal.removeAttribute("hidden");
      v.play().catch(function () {});
    });
  }
  function cerrarModal() {
    var v = document.getElementById("modal-video");
    v.pause(); v.src = "";
    modal.setAttribute("hidden", "");
  }
  modal.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-cerrar")) cerrarModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hasAttribute("hidden")) cerrarModal();
  });

  /* ── GESTIONAR ── */
  var sesion = null;

  function renderGestionar() {
    if (!sesion) {
      estadoGestionar.textContent = "SIN SESIÓN";
      cuerpoGestionar.innerHTML =
        '<p class="gestionar__nota">Para subir o quitar clips necesitás tu sesión VANTS: ' +
        "el clip queda publicado con tu cuenta y nadie puede subir ni borrar en tu nombre.</p>" +
        '<button class="btn btn--rojo" type="button" id="btn-clips-entrar">INICIAR SESIÓN PARA SUBIR</button>';
      document.getElementById("btn-clips-entrar").addEventListener("click", function () {
        if (window.VantAuth0) window.VantAuth0.entrar();
      });
      return;
    }
    estadoGestionar.textContent = "@" + (nickVants() || String(sesion.nick || "jugador")).toUpperCase();
    cuerpoGestionar.innerHTML =
      '<div class="gestionar__subir">' +
      '<input type="file" id="input-clip" accept="video/*,.mkv" hidden>' +
      '<button class="btn btn--rojo" type="button" id="btn-subir-clip">SUBIR CLIP DESDE EL ESCRITORIO</button>' +
      '<span class="gestionar__ayuda">MP4 · WEBM · MOV · MKV — MÁXIMO ' + MAX_MB + " MB</span>" +
      "</div>" +
      '<div id="clip-seleccion" hidden>' +
      '<div class="clip-seleccion__previa"><img id="clip-thumb-previa" alt="Miniatura generada">' +
      '<div><b id="clip-nombre"></b><small id="clip-info"></small></div></div>' +
      '<input class="campo" type="text" id="clip-titulo" maxlength="70" placeholder="TÍTULO DEL CLIP · EJ: ACE EN ASCENT · CLUTCH 1V4">' +
      '<div class="gestionar__acciones">' +
      '<button class="btn btn--rojo" type="button" id="btn-publicar">PUBLICAR EN LA VITRINA</button>' +
      '<button class="btn btn--fino" type="button" id="btn-cancelar-clip">CANCELAR</button>' +
      "</div>" +
      '<div class="pbar" id="clip-pbar" hidden><i></i></div>' +
      '<p class="gestionar__msg" id="clip-msg" hidden></p>' +
      "</div>" +
      '<div id="mis-publicaciones"></div>';

    var input = document.getElementById("input-clip");
    document.getElementById("btn-subir-clip").addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) preparar(input.files[0]);
    });
    document.getElementById("btn-cancelar-clip").addEventListener("click", limpiarSeleccion);
    document.getElementById("btn-publicar").addEventListener("click", publicar);
    pintarMias();
  }

  var sel = null; /* { file, thumbDataUrl, dur, ext } */

  function limpiarSeleccion() {
    sel = null;
    document.getElementById("clip-seleccion").setAttribute("hidden", "");
    document.getElementById("input-clip").value = "";
  }

  function preparar(file) {
    var extM = /\.([a-z0-9]+)$/i.exec(file.name || "");
    var ext = (extM && EXTS.indexOf(extM[1].toLowerCase()) >= 0) ? extM[1].toLowerCase() : "mp4";
    if (file.size > MAX_BYTES) { toast("EL CLIP SUPERA " + MAX_MB + " MB: RECÓRTALO ANTES DE SUBIRLO", true); return; }

    /* Miniatura + duración capturadas en el navegador (igual que la web antigua) */
    var url = URL.createObjectURL(file);
    var v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    var hecho = false;
    function fin() {
      if (hecho) return; hecho = true;
      var thumb = null, dur = 0;
      try {
        dur = isFinite(v.duration) ? Math.round(v.duration) : 0;
        var w = 480, r = (v.videoWidth && v.videoHeight) ? (v.videoHeight / v.videoWidth) : (9 / 16);
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = Math.max(200, Math.round(w * r));
        cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
        var d = cv.toDataURL("image/jpeg", 0.72);
        if (d && d.length > 2000) thumb = d;
      } catch (_e) { /* sin miniatura: se publica sin ella */ }
      URL.revokeObjectURL(url);
      sel = { file: file, thumb: thumb, dur: dur, ext: ext };
      document.getElementById("clip-nombre").textContent = file.name || "clip." + ext;
      document.getElementById("clip-info").textContent =
        fmtMB(file.size) + (dur ? " · " + fmtDur(dur) : "") + (thumb ? " · MINIATURA LISTA" : " · SE PUBLICARÁ SIN MINIATURA");
      var previa = document.getElementById("clip-thumb-previa");
      if (thumb) { previa.src = thumb; previa.style.display = ""; } else previa.style.display = "none";
      document.getElementById("clip-seleccion").removeAttribute("hidden");
      document.getElementById("clip-titulo").focus();
    }
    v.addEventListener("loadeddata", function () {
      try { v.currentTime = Math.min(0.8, (v.duration || 2) / 4); } catch (_e) { fin(); }
    });
    v.addEventListener("seeked", function () { setTimeout(fin, 80); });
    v.addEventListener("error", fin);
    setTimeout(function () { fin(); }, 5000);
  }

  function dataURLaBlob(d) {
    var bin = atob(d.split(",")[1]);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: "image/jpeg" });
  }

  function publicar() {
    if (!sel || !sesion) return;
    var btn = document.getElementById("btn-publicar");
    var bar = document.getElementById("clip-pbar");
    var msg = document.getElementById("clip-msg");
    var titulo = (document.getElementById("clip-titulo").value || "").trim().slice(0, 70) || "Clip destacado";
    btn.disabled = true; btn.style.opacity = ".55";
    bar.removeAttribute("hidden"); msg.setAttribute("hidden", "");

    var fd = new FormData();
    fd.append("video", sel.file, sel.file.name || ("clip." + sel.ext));
    if (sel.thumb) fd.append("thumb", dataURLaBlob(sel.thumb), "thumb.jpg");
    fd.append("titulo", titulo);
    fd.append("juego", "VALORANT");
    fd.append("nick", sesion.nick || "JUGADOR");
    fd.append("username", String(sesion.nick || "").replace(/[^a-z0-9_\-.]/gi, "").slice(0, 32));
    var nombrePropio = nickVants();
    if (nombrePropio) fd.append("nombre_vants", nombrePropio);   /* FIX S4.3: tu nombre viaja con el clip */
    fd.append("ext", sel.ext);
    fd.append("dur", String(sel.dur || 0));

    var x = new XMLHttpRequest();
    x.open("POST", "/api/clips/featured", true);
    x.setRequestHeader("Authorization", "Bearer " + (sesion.token || ""));
    x.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var p = e.loaded / e.total;
        bar.querySelector("i").style.width = (p * 100).toFixed(0) + "%";
        msg.removeAttribute("hidden");
        msg.textContent = "SUBIENDO EL VIDEO: " + (p * 100).toFixed(0) + "%";
      }
    };
    x.onload = function () {
      var j = null;
      try { j = JSON.parse(x.responseText); } catch (_e) { j = { ok: false, error: "respuesta_invalida" }; }
      btn.disabled = false; btn.style.opacity = "";
      bar.setAttribute("hidden", "");
      if (j && j.ok) {
        cacheClips = null; cacheAt = 0;
        limpiarSeleccion();
        toast("PUBLICADO · YA ESTÁ EN LA VITRINA");
        cargarTodo();
      } else {
        msg.removeAttribute("hidden");
        var er = (j && j.error) || "error";
        msg.innerHTML = "NO SE PUDO PUBLICAR: <b>" + esc(
          er === "clip_demasiado_grande" ? "el clip supera " + MAX_MB + " MB" :
          (er === "sin_sesion" || er === "token_invalido") ? "tu sesión expiró, entrá de nuevo" :
          (er === "gh_no_config") ? "la vitrina se está configurando, probá más tarde" : er) + "</b>";
      }
    };
    x.onerror = function () {
      btn.disabled = false; btn.style.opacity = "";
      bar.setAttribute("hidden", "");
      msg.removeAttribute("hidden");
      msg.textContent = "SIN CONEXIÓN PARA PUBLICAR";
    };
    x.send(fd);
  }

  function pintarMias() {
    var cont = document.getElementById("mis-publicaciones");
    if (!cont || !sesion) return;
    clipsDestacados().then(function (list) {
      var mias = (list || []).filter(function (c) { return c.sub === sesion.sub; });
      if (!mias.length) { cont.innerHTML = ""; return; }
      var html = '<span class="etiqueta" style="display:block;margin:18px 0 10px">MIS PUBLICACIONES · ' + mias.length + "</span>";
      mias.forEach(function (c) {
        html += '<div class="fila-mia"><span><b>' + esc(c.titulo || "Clip destacado") + "</b> · " +
          esc(fmtFecha(c.fecha)) + (c.tam ? " · " + esc(fmtMB(c.tam)) : "") + "</span>" +
          '<button class="btn btn--fino btn--borde-rojo" type="button" data-quitar="' + esc(c.id) + '">QUITAR</button></div>';
      });
      cont.innerHTML = html;
      cont.querySelectorAll("[data-quitar]").forEach(function (b) {
        b.addEventListener("click", function () { quitar(b.getAttribute("data-quitar"), b); });
      });
    });
  }

  function quitar(id, btn) {
    if (!confirm("¿Quitar este clip de la vitrina pública?")) return;
    btn.disabled = true; btn.style.opacity = ".55";
    fetch("/api/clips/featured?id=" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { Authorization: "Bearer " + (sesion.token || "") },
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          cacheClips = null; cacheAt = 0;
          toast("CLIP QUITADO DE LA VITRINA");
          cargarTodo();
        } else {
          btn.disabled = false; btn.style.opacity = "";
          toast((j && j.error === "no_es_tuyo") ? "ESE CLIP FUE PUBLICADO POR OTRA CUENTA" : "NO SE PUDO QUITAR AHORA", true);
        }
      })
      .catch(function () { btn.disabled = false; btn.style.opacity = ""; toast("SIN CONEXIÓN PARA QUITAR EL CLIP", true); });
  }

  /* ── arranque: sesión primero, luego vitrina ── */
  function cargarTodo() {
    clipsDestacados().then(renderVitrina);
    pintarMias();
  }

  if (window.VantAuth0) {
    window.VantAuth0.listo().then(function (u) {
      if (u) {
        return window.VantAuth0.getToken().then(function (tk) {
          sesion = { sub: u.sub, nick: u.nick, token: tk };
        });
      }
      sesion = null;
    }).finally(function () {
      renderGestionar();
      cargarTodo();
    });
  } else {
    renderGestionar();
    cargarTodo();
  }
})();
