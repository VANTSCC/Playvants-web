/* VANTS GAMES — ADMINISTRATION → ACHIEVEMENTS (admin_logros.js)
   -------------------------------------------------------------
   Panel del VANTS ACHIEVEMENTS & BADGE ENGINE. Reglas de seguridad:
   · El servidor verifica sesión Auth0 + rol owner en CADA llamada:
     este panel solo es la interfaz; sin permisos la API responde 403.
   · Toda operación (conceder, revocar, reglas, reconciliar) exige
     justificación y queda en ach_audit_log.
   · El browser nunca envía userId propio: el sub sale de la sesión.
     Para CONCEDER a un jugador sí se escribe su sub (es una operación
     administrativa dirigida, auditable). */
(function () {
  "use strict";

  var TOKEN = null;
  var CATALOGO = [];
  var MANIFIESTO = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function msj(texto, mal) {
    var m = $("msj");
    m.className = "adm-msj " + (mal ? "adm-msj--err" : "adm-msj--ok");
    m.textContent = texto;
    clearTimeout(msj._t);
    msj._t = setTimeout(function () { m.className = "adm-msj"; }, 6000);
  }
  function api(ruta, metodo, cuerpo) {
    return fetch(ruta, {
      method: metodo || "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + TOKEN,
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, cuerpo: j }; });
    });
  }

  /* ------------------------- PROCESAMIENTO ------------------------- */
  function pintarProcesamiento(st) {
    var map = {};
    (st.outbox || []).forEach(function (f) { map[f.status] = f.n; });
    var imap = {};
    (st.inbox || []).forEach(function (f) { imap[f.processing_status] = f.n; });
    var kpis = [
      ["PENDIENTES OUTBOX", map.pending || 0, ""],
      ["PROCESADOS OUTBOX", map.done || 0, "ok"],
      ["EN ERROR (DLQ)", map.error || 0, "rojo"],
      ["EVENTOS INBOX", (imap.processed || 0) + (imap.pending || 0) + (imap.failed || 0), ""],
    ];
    $("kpis").innerHTML = kpis.map(function (k) {
      return '<div class="adm-kpi ' + (k[2] ? "adm-kpi--" + k[2] : "") + '"><b>' + k[1] + "</b><small>" + k[0] + "</small></div>";
    }).join("");
    $("tb-dlq").innerHTML = (st.dlq || []).length
      ? st.dlq.map(function (d) {
          return "<tr><td>" + esc(d.id.slice(0, 18)) + "…</td><td>" + esc(d.event_type) + "</td><td>" + d.attempts + "</td><td>" + esc(d.created_at) + "</td></tr>";
        }).join("")
      : "<tr><td colspan=\"4\">SIN EVENTOS EN ERROR — la cola está sana</td></tr>";
    $("tb-auditoria").innerHTML = (st.auditoria || []).map(function (a) {
      return "<tr><td>" + esc(a.actor) + "</td><td>" + esc(a.action) + "</td><td>" + esc(String(a.target_id || "").slice(0, 22)) + "</td><td>" + esc(a.created_at) + "</td></tr>";
    }).join("") || "<tr><td colspan=\"4\">Sin operaciones registradas todavía</td></tr>";
  }

  function cargarProcesamiento() {
    return api("/api/admin/achievements").then(function (r) {
      if (r.cuerpo && r.cuerpo.procesamiento) pintarProcesamiento(r.cuerpo.procesamiento);
    });
  }

  /* ---------------------------- CATÁLOGO ---------------------------- */
  function pintarCatalogo(cat) {
    $("catalogo").innerHTML = cat.map(function (b) {
      var img = "/assets/badges/" + String(b.code).toLowerCase().replace(/\s+/g, "-") + "/256.png";
      return '<div class="adm-badge' + (b.is_active ? "" : " adm-badge--off") + '">' +
        '<img src="' + img + '" alt="' + esc(b.code) + '">' +
        '<div style="flex:1;min-width:0"><b>' + esc(b.code) + '</b>' +
        '<small>' + esc(b.category).toUpperCase() + " · " + esc(b.rarity).toUpperCase() + " · " + esc(b.grant_type) + "</small>" +
        '<small>v' + b.image_version + " · orden " + b.display_order + "</small>" +
        '<input type="text" data-desc="' + esc(b.code) + '" value="' + esc(b.description) + '" maxlength="300"></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px">' +
        '<button class="btn btn--fino" data-toggle="' + esc(b.code) + '" type="button">' + (b.is_active ? "PAUSAR" : "ACTIVAR") + "</button>" +
        '<button class="btn btn--fino" data-guardar="' + esc(b.code) + '" type="button">GUARDAR</button>' +
        "</div></div>";
    }).join("");
  }

  function cargarCatalogo() {
    return api("/api/admin/achievements").then(function (r) {
      if (!r.cuerpo || !r.cuerpo.ok) return;
      CATALOGO = r.cuerpo.catalogo || [];
      pintarCatalogo(CATALOGO);
      var opciones = CATALOGO.map(function (b) { return '<option value="' + esc(b.code) + '">' + esc(b.code) + "</option>"; }).join("");
      $("regla-badge").innerHTML = opciones;
      $("jug-badge").innerHTML = opciones;
      pintarReglas(r.cuerpo.reglas || []);
    });
  }

  /* ----------------------------- REGLAS ----------------------------- */
  function pintarReglas(reglas) {
    $("tb-reglas").innerHTML = reglas.map(function (r) {
      return "<tr><td><b>" + esc(r.code) + "</b></td><td>" + esc(r.rule_type) + "</td><td>v" + r.version + "</td>" +
        '<td style="max-width:280px">' + esc(r.conditions_json) + "</td><td>" + esc(r.source_event || "—") + "</td>" +
        "<td>" + (r.is_active ? "ACTIVA" : "PAUSADA") + "</td>" +
        '<td><button class="btn btn--fino" data-regla-toggle="' + r.id + '" data-activo="' + (r.is_active ? 1 : 0) + '" type="button">' + (r.is_active ? "PAUSAR" : "ACTIVAR") + "</button></td></tr>";
    }).join("");
  }

  /* --------------------------- RECURSOS ----------------------------- */
  function cargarRecursos() {
    return fetch("/assets/badges/badge-manifest.json").then(function (r) { return r.json(); }).then(function (m) {
      MANIFIESTO = m;
      var filas = [];
      (m.insignias || []).forEach(function (b) {
        var orden = ["1024", "512", "256", "128", "64", "32"];
        orden.forEach(function (t) {
          var f = b.archivos.png[t];
          if (!f) return;
          filas.push({ code: b.code, ruta: f.ruta, tam: t + "×" + t, sha: f.sha256, webp: !!b.archivos.webp[t] });
        });
      });
      /* Detección de imágenes ausentes: se comprueba cada PNG con un HEAD */
      $("tb-recursos").innerHTML = filas.map(function (f, i) {
        return '<tr class="recursos-fila" data-ruta="' + f.ruta + '" data-i="' + i + '">' +
          '<td class="recursos-vista"><img loading="lazy" src="/' + f.ruta + '" alt=""></td>' +
          "<td>" + esc(f.ruta) + (f.webp ? ' <small style="color:#43d17c">+webp</small>' : "") + "</td>" +
          "<td>" + f.tam + "</td><td>" + esc(f.sha.slice(0, 24)) + "…</td><td class=\"recursos-estado\">COMPROBANDO…</td></tr>";
      }).join("");
      Array.prototype.forEach.call(document.querySelectorAll(".recursos-fila"), function (tr) {
        var img = tr.querySelector(".recursos-vista img");
        var estado = tr.querySelector(".recursos-estado");
        var marcar = function (ok) { estado.textContent = ok ? "OK" : "AUSENTE"; if (!ok) tr.classList.add("recursos-fila--falta"); };
        if (img.complete) marcar(img.naturalWidth > 0);
        else { img.onload = function () { marcar(true); }; img.onerror = function () { marcar(false); }; }
      });
    });
  }

  /* --------------------------- ACCIONES ----------------------------- */
  function cablear() {
    /* catálogo: pausar/activar + guardar descripción */
    $("catalogo").addEventListener("click", function (ev) {
      var t = ev.target.closest("button");
      if (!t) return;
      if (t.dataset.toggle) {
        var b = CATALOGO.find(function (x) { return x.code === t.dataset.toggle; });
        api("/api/admin/achievements/badges/" + encodeURIComponent(b.code), "PATCH", { is_active: b.is_active ? 0 : 1 })
          .then(function (r) { if (r.cuerpo.ok) { msj("INSIGNIA " + b.code + (b.is_active ? " PAUSADA" : " ACTIVADA")); cargarCatalogo(); } else msj("ERROR: " + (r.cuerpo.error || "?"), true); });
      }
      if (t.dataset.guardar) {
        var input = document.querySelector('[data-desc="' + t.dataset.guardar + '"]');
        api("/api/admin/achievements/badges/" + encodeURIComponent(t.dataset.guardar), "PATCH", { description: input.value })
          .then(function (r) { if (r.cuerpo.ok) msj("DESCRIPCIÓN ACTUALIZADA"); else msj("ERROR: " + (r.cuerpo.error || "?"), true); });
      }
    });
    /* reglas */
    $("tb-reglas").addEventListener("click", function (ev) {
      var t = ev.target.closest("button[data-regla-toggle]");
      if (!t) return;
      api("/api/admin/achievements/rules/" + t.dataset.reglaToggle, "PATCH", { is_active: t.dataset.activo === "1" ? 0 : 1 })
        .then(function (r) { if (r.cuerpo.ok) { msj("REGLA ACTUALIZADA"); cargarCatalogo(); } else msj("ERROR: " + (r.cuerpo.error || "?"), true); });
    });
    $("btn-crear-regla").addEventListener("click", function () {
      var condiciones = $("regla-condiciones").value.trim() || "{}";
      try { JSON.parse(condiciones); } catch (e) { msj("CONDICIONES NO SON JSON VÁLIDO", true); return; }
      api("/api/admin/achievements/rules", "POST", {
        badge_code: $("regla-badge").value,
        rule_type: $("regla-tipo").value,
        conditions_json: condiciones,
        source_event: $("regla-fuente").value.trim(),
      }).then(function (r) {
        if (r.cuerpo.ok) { msj("REGLA CREADA (nueva versión)"); cargarCatalogo(); }
        else msj("ERROR: " + (r.cuerpo.error || "?"), true);
      });
    });
    /* jugadores */
    $("btn-grant").addEventListener("click", function () {
      api("/api/admin/achievements/grant", "POST", {
        user_id: $("jug-sub").value.trim(),
        code: $("jug-badge").value,
        justification: $("jug-justificacion").value.trim(),
      }).then(function (r) {
        if (r.cuerpo.ok) msj(r.cuerpo.concedida ? "INSIGNIA CONCEDIDA" : "SIN CAMBIO (" + r.cuerpo.motivo + " — idempotencia)");
        else msj("ERROR: " + (r.cuerpo.error || "?") + (r.cuerpo.detalle ? " · " + r.cuerpo.detalle : ""), true);
      });
    });
    $("btn-revoke").addEventListener("click", function () {
      api("/api/admin/achievements/revoke", "POST", {
        user_id: $("jug-sub").value.trim(),
        code: $("jug-badge").value,
        reason: $("jug-justificacion").value.trim(),
      }).then(function (r) {
        if (r.cuerpo.ok) msj("INSIGNIA REVOCADA (historial conservado)");
        else msj("ERROR: " + (r.cuerpo.error || "?") + (r.cuerpo.detalle ? " · " + r.cuerpo.detalle : ""), true);
      });
    });
    $("btn-ver").addEventListener("click", function () {
      var sub = $("jug-sub").value.trim();
      if (!sub) { msj("ESCRIBÍ EL SUB DEL JUGADOR", true); return; }
      fetch("/api/players/" + encodeURIComponent(sub) + "/badges")
        .then(function (r) { return r.json(); })
        .then(function (j) {
          $("tb-jugador").innerHTML = (j.badges || []).map(function (a) {
            var ev = a.evidence || {};
            return "<tr><td><b>" + esc(a.badge.code) + "</b></td><td>" + esc(a.status) + "</td><td>" + esc(a.awarded_at || "—") + "</td><td>" + esc(ev.torneo ? ev.torneo : (ev.tipo || "—")) + "</td></tr>";
          }).join("") || "<tr><td colspan=\"4\">El jugador no tiene insignias registradas</td></tr>";
        });
    });
    /* procesamiento */
    $("btn-reconciliar").addEventListener("click", function () {
      api("/api/admin/achievements/reconcile", "POST", {}).then(function (r) {
        if (r.cuerpo.ok) msj("RECONCILIACIÓN: " + r.cuerpo.redescubiertos + " redescubiertos · " + (r.cuerpo.resumen ? r.cuerpo.resumen.procesados : 0) + " procesados");
        else msj("ERROR: " + (r.cuerpo.error || "?"), true);
        cargarProcesamiento();
      });
    });
    $("btn-pump").addEventListener("click", function () {
      api("/api/achievements/pump", "POST", {}).then(function (r) {
        if (r.cuerpo.ok) msj("PUMP: " + r.cuerpo.resumen.procesados + " procesados · " + r.cuerpo.resumen.concedidos + " concedidos · " + r.cuerpo.resumen.errores + " errores");
        else msj("ERROR: " + (r.cuerpo.error || "?"), true);
        cargarProcesamiento();
      });
    });
  }

  /* --------------------------- ARRANQUE ----------------------------- */
  window.VantAuth0.listo().then(function (usuario) {
    if (!usuario) {
      $("aviso-sin-acceso").style.display = "block";
      return null;
    }
    return window.VantAuth0.getToken().then(function (t) {
      TOKEN = t;
      return api("/api/admin/achievements").then(function (r) {
        if (r.status === 403 || r.status === 401) {
          $("aviso-sin-acceso").style.display = "block";
          return null;
        }
        $("panel").hidden = false;
        cablear();
        return Promise.all([cargarCatalogo(), cargarProcesamiento(), cargarRecursos()]);
      });
    });
  }).catch(function () {
    $("aviso-sin-acceso").style.display = "block";
  });
})();
