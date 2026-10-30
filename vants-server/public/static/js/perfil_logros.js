/* VANTS GAMES — VANTS BADGE COLLECTION (perfil_logros.js)
   --------------------------------------------------------
   Módulo del perfil que consume el VANTS ACHIEVEMENTS & BADGE ENGINE:
   · GET  /api/me/badges          → concesiones + progreso + bloqueadas
   · POST /api/me/badges/featured → hasta 3 insignias destacadas
   Reglas de oro del motor (válidas también acá):
   · La sesión Auth0 resuelve al jugador: el navegador NUNCA manda userId.
   · Sin inventar datos: lo que no está concedido se muestra bloqueado.
   · Un recurso roto no rompe el diseño: tamaño reservado + fallback.
   Animación de desbloqueo solo para insignias nuevas desde la última visita. */
(function () {
  "use strict";

  var CLAVE_VISTO = "vants_badges_visto_v1";
  var MAX_DESTACADAS = 3;
  var estadoDestacadas = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fechaCorta(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    } catch (e) { return "—"; }
  }

  /* ---------- fallback de imagen rota (no desplaza el diseño) ---------- */
  function imgFallback(img, code) {
    img.addEventListener("error", function () {
      var caja = document.createElement("span");
      caja.className = "badge-fallback";
      caja.style.borderColor = img.getAttribute("data-color") || "#444";
      caja.textContent = (code || "?").charAt(0);
      img.replaceWith(caja);
    });
  }

  /* ---------- render de la franja de destacadas (junto al nick) -------- */
  function pintarDestacadas(lista) {
    var fila = $("destacadas-fila");
    if (!fila) return;
    fila.innerHTML = "";
    var hay = false;
    for (var i = 0; i < MAX_DESTACADAS; i++) {
      var d = lista && lista[i];
      var slot = document.createElement("span");
      slot.className = "destacada-slot" + (d ? " destacada-slot--lleno" : "");
      if (d) {
        hay = true;
        var img = document.createElement("img");
        img.src = d.badge.image.webp;
        img.alt = d.badge.name;
        img.width = 44; img.height = 44;
        img.loading = "lazy";
        img.setAttribute("data-color", d.badge.color);
        imgFallback(img, d.badge.code);
        slot.title = d.badge.name + " · " + fechaCorta(d.awarded_at);
        slot.appendChild(img);
      }
      fila.appendChild(slot);
    }
    fila.hidden = !hay;
  }

  /* ------------------------- tarjeta de insignia ----------------------- */
  function tarjeta(b) {
    var conseguida = b.status === "active";
    var idx = estadoDestacadas.indexOf(b.badge.code);
    var card = document.createElement("button");
    card.type = "button";
    card.className = "badge-card" + (conseguida ? "" : " badge-card--locked") + (idx >= 0 ? " badge-card--destacada" : "");
    card.style.setProperty("--badge-color", b.badge.color);
    card.setAttribute("aria-label", b.badge.name + (conseguida ? " conseguida" : " bloqueada"));

    var img = document.createElement("img");
    img.className = "badge-card__img";
    img.src = b.badge.image.webp;
    img.alt = b.badge.name;
    img.width = 84; img.height = 84;
    img.loading = "lazy";
    img.setAttribute("data-color", b.badge.color);
    imgFallback(img, b.badge.code);
    card.appendChild(img);

    var nombre = document.createElement("small");
    nombre.className = "badge-card__nombre";
    nombre.textContent = b.badge.name;
    card.appendChild(nombre);

    if (idx >= 0) {
      var star = document.createElement("span");
      star.className = "badge-card__estrella";
      star.textContent = "★ " + (idx + 1);
      card.appendChild(star);
    }

    /* Tooltip informativo: nombre, requisito, fecha y evidencia */
    var tip = document.createElement("span");
    tip.className = "badge-card__tip";
    var ev = b.evidence || {};
    var evTxt = ev.torneo ? (" · " + ev.torneo + (ev.marcador ? " " + ev.marcador[0] + "-" + ev.marcador[1] : "")) : "";
    tip.innerHTML = "<b>" + esc(b.badge.name) + "</b>" +
      (conseguida
        ? "<i>" + esc(b.badge.description) + evTxt + "</i><i>OBTENIDA · " + esc(fechaCorta(b.awarded_at)) + "</i>"
        : "<i>" + esc(b.badge.requirement || b.badge.description) + "</i><i>BLOQUEADA</i>");
    card.appendChild(tip);
    return card;
  }

  /* --------------------------- progreso ------------------------------- */
  function pintarProgreso(filas) {
    var zona = $("badges-progreso");
    if (!zona) return;
    zona.innerHTML = "";
    var activas = (filas || []).filter(function (p) { return p.status === "in_progress" && p.target > 1; });
    if (!activas.length) { zona.hidden = true; return; }
    activas.forEach(function (p) {
      var fila = document.createElement("div");
      fila.className = "progreso-fila";
      fila.innerHTML = "<span><b>" + esc(p.code) + "</b> " + Math.floor(p.current) + "/" + Math.floor(p.target) + "</span>" +
        '<span class="barra"><i style="width:' + Math.min(100, Math.max(0, p.percent)) + '%"></i></span>' +
        "<small>" + Math.round(p.percent) + "%</small>";
      zona.appendChild(fila);
    });
    zona.hidden = false;
  }

  /* ------------------------ guardado destacadas ------------------------ */
  function guardarDestacadas(token) {
    return fetch("/api/me/badges/featured", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ featured: estadoDestacadas }),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /* -------------------- animación de desbloqueo ------------------------ */
  function nuevasParaAnimar(badges) {
    var previo = 0;
    try { previo = Number(localStorage.getItem(CLAVE_VISTO) || 0); } catch (e) { previo = 0; }
    var ahora = Date.now();
    var nuevas = (badges || []).filter(function (b) {
      if (b.status !== "active") return false;
      var t = Date.parse(b.awarded_at || "");
      return Number.isFinite(t) && t > previo && t <= ahora;
    }).sort(function (a, c) { return Date.parse(a.awarded_at) - Date.parse(c.awarded_at); });
    try { localStorage.setItem(CLAVE_VISTO, String(ahora)); } catch (e) { /* noop */ }
    return nuevas;
  }

  function animarCola(cola) {
    if (!cola.length) return;
    var overlay = $("badge-unlock");
    if (!overlay) return;
    var d = cola[0];
    $("unlock-img").src = d.badge.image.master;
    $("unlock-img").alt = d.badge.name;
    $("unlock-nombre").textContent = d.badge.name;
    $("unlock-req").textContent = d.badge.description || d.badge.requirement || "";
    $("unlock-fecha").textContent = "OBTENIDA · " + fechaCorta(d.awarded_at);
    overlay.hidden = false;
    var cerrar = $("unlock-cerrar");
    var alCerrar = function () {
      overlay.hidden = true;
      cerrar.removeEventListener("click", alCerrar);
      animarCola(cola.slice(1));
    };
    cerrar.addEventListener("click", alCerrar);
  }

  /* ------------------------------ arranque ----------------------------- */
  function cargar() {
    var estadoZona = $("badges-estado");
    var grid = $("badges-grid");
    if (!window.VantAuth0) { if (estadoZona) estadoZona.textContent = "SESIÓN NO DISPONIBLE"; return; }
    window.VantAuth0.listo().then(function (usuario) {
      if (!usuario || !$("badges-grid")) {
        if (estadoZona) estadoZona.hidden = true;
        var sin = $("badges-sinsesion");
        if (sin) sin.hidden = false;
        return;
      }
      return window.VantAuth0.getToken().then(function (token) {
        if (!token) throw new Error("sin_token");
        return fetch("/api/me/badges", { headers: { "Authorization": "Bearer " + token } })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, cuerpo: j }; }); })
          .then(function (res) {
            if (!res.ok || !res.cuerpo || !res.cuerpo.ok) {
              var e = (res.cuerpo && res.cuerpo.error) || "motor_error";
              estadoZona.textContent = e === "logros_no_config"
                ? "MOTOR DE LOGROS NO CONFIGURADO EN ESTE ENTORNO"
                : "NO SE PUDO CARGAR LA COLECCIÓN · " + esc(String(e).toUpperCase());
              return;
            }
            estadoZona.hidden = true;
            var obtenidas = res.cuerpo.badges.filter(function (b) { return b.status === "active"; });
            var bloqueadas = res.cuerpo.bloqueadas || [];
            estadoDestacadas = (res.cuerpo.destacadas || []).map(function (d) { return d.badge.code; });
            pintarDestacadas(res.cuerpo.destacadas || []);
            pintarProgreso(res.cuerpo.progreso || []);
            grid.innerHTML = "";
            obtenidas.forEach(function (b) { grid.appendChild(tarjeta(b)); });
            bloqueadas.forEach(function (b) { grid.appendChild(tarjeta({ badge: b, status: "locked" })); });
            grid.hidden = false;
            var nota = $("badges-nota");
            if (nota) nota.hidden = !obtenidas.length;
            /* desbloqueo animado de las nuevas */
            var nuevas = nuevasParaAnimar(obtenidas);
            if (nuevas.length) setTimeout(function () { animarCola(nuevas); }, 350);
            /* selección de destacadas */
            grid.addEventListener("click", function (ev) {
              var t = ev.target.closest(".badge-card");
              if (!t || t.classList.contains("badge-card--locked")) return;
              var nombre = t.querySelector(".badge-card__nombre").textContent;
              var i = estadoDestacadas.indexOf(nombre);
              if (i >= 0) estadoDestacadas.splice(i, 1);
              else {
                if (estadoDestacadas.length >= MAX_DESTACADAS) {
                  if (window.VantsPerfil && window.VantsPerfil.toast) window.VantsPerfil.toast("MÁXIMO " + MAX_DESTACADAS + " INSIGNIAS DESTACADAS", true);
                  return;
                }
                estadoDestacadas.push(nombre);
              }
              grid.querySelectorAll(".badge-card").forEach(function (c) { c.classList.remove("badge-card--destacada"); c.querySelector(".badge-card__estrella") && c.querySelector(".badge-card__estrella").remove(); });
              estadoDestacadas.forEach(function (code, orden) {
                var tarjetaDom = Array.prototype.find.call(grid.querySelectorAll(".badge-card"), function (c) {
                  return c.querySelector(".badge-card__nombre").textContent === code;
                });
                if (tarjetaDom) {
                  tarjetaDom.classList.add("badge-card--destacada");
                  var st = document.createElement("span");
                  st.className = "badge-card__estrella";
                  st.textContent = "★ " + (orden + 1);
                  tarjetaDom.appendChild(st);
                }
              });
              window.VantAuth0.getToken().then(function (tk) { return guardarDestacadas(tk); }).then(function () {
                pintarDestacadas(estadoDestacadas.map(function (code, orden) {
                  var fuente = obtenidas.find(function (b) { return b.badge.code === code; });
                  return fuente || { badge: { code: code, name: code, image: { webp: "/assets/badges/" + code.toLowerCase().replace(/\s+/g, "-") + "/256.webp" }, color: "#444" }, awarded_at: null, badge_order: orden };
                }));
              }).catch(function () { /* silencioso: la selección es cosmética */ });
            });
          });
      });
    }).catch(function () {
      if (estadoZona) estadoZona.textContent = "NO SE PUDO CARGAR LA COLECCIÓN";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cargar);
  else cargar();
})();
