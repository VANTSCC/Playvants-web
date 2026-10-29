/* VANTS GAMES — página de perfil: foto (avatar), equipo, banner, cuentas
   CONECTADAS DE VERDAD (con verificación de FACEIT contra su API pública),
   nombre de la cuenta editable, datos, rango con las 9 insignias y cuenta.
   La sesión viene de Auth0 (vants-auth.js). Sin datos inventados.

   FIX S4.2 (nombre de la cuenta):
   · El nombre se aplica SIEMPRE en el momento, con o sin sesión: vive en tu
     navegador y se pinta en toda la ficha al instante. El servidor ya no
     puede bloquearlo (antes, si la sincronización con Auth0 fallaba, el
     nombre se perdía y salía "EL SERVIDOR NO DEJÓ GUARDAR EL NOMBRE").
   · La sincronización con la cuenta pasa en SEGUNDO PLANO: si el servidor la
     acepta, el nombre te sigue en otros dispositivos; si no, queda guardado
     en este navegador y nada se rompe.
   · Al volver a /perfil el campo NOMBRE DE LA CUENTA muestra el guardado. */
(function () {
  "use strict";

  var api = window.VantsPerfil;
  if (!api) return;

  var estado = api.leer();
  window.__VANTS_ESTADO__ = estado;   /* S4.4: una sola fuente de verdad para toda la página */

  /* ── RANGOS VANTS (9 insignias oficiales) ── */
  var RANGOS = [
    { id: "ceniza",   nombre: "CENIZA",   xp: 0,    color: "#b8bfc7" },
    { id: "hierro",   nombre: "HIERRO",   xp: 1000, color: "#8b93a1" },
    { id: "bronce",   nombre: "BRONCE",   xp: 2000, color: "#b0793f" },
    { id: "plata",    nombre: "PLATA",    xp: 3000, color: "#c3ccd9" },
    { id: "oro",      nombre: "ORO",      xp: 4000, color: "#e3b341" },
    { id: "platino",  nombre: "PLATINO",  xp: 5000, color: "#35c8d8" },
    { id: "diamante", nombre: "DIAMANTE", xp: 6000, color: "#a45de8" },
    { id: "inmortal", nombre: "INMORTAL", xp: 7000, color: "#2fbf8f" },
    { id: "supremo",  nombre: "SUPREMO",  xp: 8000, color: "#3f8cff" }
  ];

  /* ── FOTO DE PERFIL: clic en el avatar → archivo del escritorio ── */
  var inputPerfil = document.getElementById("input-foto-perfil");
  document.getElementById("avatar-jugador").addEventListener("click", function () { inputPerfil.click(); });
  inputPerfil.addEventListener("change", function () {
    var f = inputPerfil.files && inputPerfil.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type || "")) { api.toast("ESE ARCHIVO NO ES UNA IMAGEN", true); return; }
    api.imagenCuadradaADataURL(f, 320, function (data) {
      estado.foto = data;
      api.guardar(estado);
      api.pintarAvatar(estado);
      api.toast("FOTO DE PERFIL ACTUALIZADA");
    });
    inputPerfil.value = "";
  });

  /* ── MI EQUIPO ── */
  var inputFoto = document.getElementById("input-foto-equipo");
  var imgFoto = document.getElementById("foto-equipo");
  document.getElementById("btn-foto-equipo").addEventListener("click", function () { inputFoto.click(); });
  inputFoto.addEventListener("change", function () {
    var f = inputFoto.files && inputFoto.files[0];
    if (!f) return;
    api.imagenADataURL(f, 360, function (data) {
      estado.equipo.foto = data;
      imgFoto.src = data;
      api.guardar(estado);
      api.toast("FOTO LISTA · GUARDA EL EQUIPO");
    });
  });
  document.getElementById("btn-quitar-foto").addEventListener("click", function () {
    estado.equipo.foto = null;
    imgFoto.src = "/static/img/vants-mark-512.png";
    api.guardar(estado);
    api.toast("FOTO DEL EQUIPO QUITADA");
  });

  document.getElementById("guardar-equipo").addEventListener("click", function () {
    var nombre = document.getElementById("equipo-nombre").value.trim();
    var tag = document.getElementById("equipo-tag").value.trim().toUpperCase();
    if (!nombre || !tag) { api.toast("PON NOMBRE Y TAG DEL EQUIPO", true); return; }
    estado.equipo.nombre = nombre;
    estado.equipo.tag = tag;
    if (api.guardar(estado)) api.toast("MI EQUIPO GUARDADO · " + nombre + " [" + tag + "]");
  });

  /* ── BANNER DEL PERFIL ── */
  var banner = document.getElementById("banner");
  var chipsBanner = document.querySelectorAll("#banner-chips .chip-sel[data-banner]");
  var inputBanner = document.getElementById("input-banner-foto");
  document.getElementById("btn-banner-foto").addEventListener("click", function () { inputBanner.click(); });

  function pintarBanner() {
    banner.className = "perfil__banner";
    if (estado.banner.tipo === "foto" && estado.banner.foto) {
      banner.classList.add("perfil__banner--foto");
      banner.style.backgroundImage = "url(" + estado.banner.foto + ")";
      return;
    }
    banner.style.backgroundImage = "";
    banner.classList.add("perfil__banner--" + estado.banner.tipo);
  }

  chipsBanner.forEach(function (chip) {
    chip.addEventListener("click", function () {
      chipsBanner.forEach(function (c) { c.classList.remove("chip-sel--activo"); });
      chip.classList.add("chip-sel--activo");
      estado.banner.tipo = chip.getAttribute("data-banner");
      api.guardar(estado);
      pintarBanner();
    });
  });
  inputBanner.addEventListener("change", function () {
    var f = inputBanner.files && inputBanner.files[0];
    if (!f) return;
    api.imagenADataURL(f, 900, function (data) {
      estado.banner.tipo = "foto";
      estado.banner.foto = data;
      chipsBanner.forEach(function (c) { c.classList.remove("chip-sel--activo"); });
      document.getElementById("btn-banner-foto").classList.add("chip-sel--activo");
      if (api.guardar(estado)) { pintarBanner(); api.toast("BANNER ACTUALIZADO"); }
    });
  });

  /* ══ CUENTAS CONECTADAS: flujos REALES ═══════════════════════════════
     · FACEIT: el nick se VERIFICA contra la API pública de FACEIT (vía el
       Worker) y se guardan nick real, país, nivel y avatar.
     · Twitch/YouTube: el canal se valida y queda con enlace directo.
     · Riot: Riot ID completo Nombre#TAG.
     · Discord: tu usuario, para que el equipo te encuentre.
     Con sesión, las conexiones se guardan en la CUENTA (user_metadata de
     Auth0 vía /api/account/perfil): te siguen en cualquier dispositivo. */
  var DEF_CUENTAS = {
    discord: {
      etiqueta: "USUARIO DE DISCORD", placeholder: "tunombre o tunombre#1234",
      nota: "Tu usuario de Discord, para que el equipo te encuentre.",
      validar: function (v) { return v.length >= 2 && v.length <= 40; },
    },
    twitch: {
      etiqueta: "CANAL DE TWITCH", placeholder: "tucanal",
      nota: "Sin @. Queda enlazado a twitch.tv/tucanal.",
      validar: function (v) { return /^[a-zA-Z0-9_]{3,25}$/.test(v); },
      error: "CANAL INVÁLIDO · 3-25 LETRAS, NÚMEROS O _",
      url: function (v) { return "https://www.twitch.tv/" + v.toLowerCase(); },
    },
    youtube: {
      etiqueta: "CANAL DE YOUTUBE", placeholder: "@tucanal",
      nota: "Tu @usuario o la URL del canal.",
      validar: function (v) { return /^@?[a-zA-Z0-9_.\-]{3,30}$/.test(v); },
      error: "CANAL INVÁLIDO · USÁ TU @USUARIO",
      url: function (v) { return "https://www.youtube.com/@" + v.replace(/^@/, "").toLowerCase(); },
      normalizar: function (v) { return v.charAt(0) === "@" ? v : "@" + v; },
    },
    riot: {
      etiqueta: "RIOT ID", placeholder: "Nombre#TAG",
      nota: "Como aparece en el cliente de Riot (VALORANT): Nombre#TAG.",
      validar: function (v) { return /^.{2,16}#[a-zA-Z0-9]{3,5}$/.test(v); },
      error: "RIOT ID INVÁLIDO · FORMATO Nombre#TAG",
    },
    faceit: {
      etiqueta: "NICK DE FACEIT", placeholder: "tunick",
      nota: "Se verifica contra FACEIT en el momento: si existe, conecta con tu nivel real.",
      validar: function (v) { return /^[a-zA-Z0-9_.\-]{2,24}$/.test(v); },
      error: "NICK INVÁLIDO · 2-24 CARACTERES",
    }
  };

  function redSincronizar() {
    /* con sesión, guarda las redes en la cuenta (silencioso: el estado local
       ya está; si Auth0 rechaza, avisamos una sola vez) */
    if (!window.VantAuth0 || !estado.sesion) return;
    window.VantAuth0.getToken().then(function (tok) {
      if (!tok) return;
      fetch("/api/account/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ redes: estado.cuentas })
      }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (j) {
        if (j && j.ok === false && j.error === "sin_permiso_mgmt" && !redSincronizar._aviso) {
          redSincronizar._aviso = true;
          api.toast("LAS REDES QUEDARON EN ESTE NAVEGADOR · EL SERVIDOR AÚN NO LAS ACEPTA", true);
        }
      }).catch(function () { /* sin red: queda local */ });
    });
  }

  function pintarFaceitBloque() {
    var caja = document.getElementById("faceit-real");
    var vacio = document.getElementById("faceit-vacio");
    if (!caja || !vacio) return;
    var f = estado.cuentas.faceit;
    if (f && f.conectada && f.usuario) {
      caja.hidden = false;
      vacio.hidden = true;
      document.getElementById("faceit-nick").textContent = f.usuario;
      var det = [];
      if (f.pais) det.push("PAÍS " + String(f.pais).toUpperCase());
      if (f.region) det.push("REGIÓN " + String(f.region).toUpperCase());
      document.getElementById("faceit-detalle").textContent = det.length ? det.join(" · ") : "CUENTA VERIFICADA EN FACEIT";
      document.getElementById("faceit-nivel").textContent = f.nivel ? String(f.nivel) : "—";
      var av = document.getElementById("faceit-avatar");
      if (f.avatar) {
        av.innerHTML = '<img src="' + f.avatar + '" alt="">';
      } else if (!av.textContent) {
        av.textContent = "F";
      }
    } else {
      caja.hidden = true;
      vacio.hidden = false;
    }
  }

  function pintarCuentas() {
    document.querySelectorAll(".cuenta-fila").forEach(function (fila) {
      var clave = fila.getAttribute("data-cuenta");
      var def = DEF_CUENTAS[clave] || {};
      var cta = estado.cuentas[clave] || (estado.cuentas[clave] = { conectada: false, usuario: "" });
      var zona = fila.querySelector(".cuenta-fila__accion");
      var estadoTxt = fila.querySelector(".cuenta-estado");
      var usuarioTxt = fila.querySelector(".cuenta-usuario");
      zona.innerHTML = "";
      fila.classList.remove("cargando");
      if (cta.conectada) {
        if (usuarioTxt) usuarioTxt.textContent = cta.usuario || "";
        if (estadoTxt) estadoTxt.textContent = "";
        if (clave === "faceit" && cta.nivel) {
          var nv = document.createElement("span");
          nv.className = "cuenta-nivel";
          nv.textContent = "NIVEL " + cta.nivel;
          zona.appendChild(nv);
        }
        if (cta.url) {
          var en = document.createElement("a");
          en.className = "cuenta-enlace";
          en.href = cta.url;
          en.target = "_blank";
          en.rel = "noopener";
          en.textContent = "ABRIR ↗";
          zona.appendChild(en);
        }
        var ok = document.createElement("span");
        ok.className = "conectado-ok";
        ok.textContent = "✓ CONECTADO";
        zona.appendChild(ok);
        var x = document.createElement("button");
        x.type = "button";
        x.className = "desconectar-x";
        x.setAttribute("aria-label", "Desconectar");
        x.textContent = "✕";
        x.addEventListener("click", function () {
          estado.cuentas[clave] = { conectada: false, usuario: "" };
          api.guardar(estado);
          pintarCuentas();
          pintarFaceitBloque();
          redSincronizar();
          api.toast("CUENTA DESCONECTADA");
        });
        zona.appendChild(x);
      } else {
        if (usuarioTxt) usuarioTxt.textContent = "";
        if (estadoTxt) estadoTxt.textContent = "NO CONECTADA";
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn--fino" + (clave === "youtube" ? " btn--rojo" : "");
        b.textContent = "CONECTAR";
        b.addEventListener("click", function () { abrirFormulario(fila, clave); });
        zona.appendChild(b);
      }
    });
  }

  function abrirFormulario(fila, clave) {
    var def = DEF_CUENTAS[clave];
    var zona = fila.querySelector(".cuenta-fila__accion");
    var existente = estado.cuentas[clave] && estado.cuentas[clave].usuario;
    zona.innerHTML = "";
    var form = document.createElement("div");
    form.className = "cuenta-form";

    var input = document.createElement("input");
    input.className = "campo-cuenta";
    input.type = "text";
    input.placeholder = def.placeholder || "";
    input.maxLength = 40;
    input.value = existente || "";
    input.setAttribute("aria-label", def.etiqueta);

    var guardar = document.createElement("button");
    guardar.type = "button";
    guardar.className = "btn btn--rojo btn--fino";
    guardar.textContent = clave === "faceit" ? "VERIFICAR" : "GUARDAR";

    var cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.className = "btn btn--fino";
    cancelar.textContent = "✕";

    var nota = document.createElement("div");
    nota.className = "campo-nota";
    nota.innerHTML = "<small>" + (def.nota || "") + "</small>";

    cancelar.addEventListener("click", function () { pintarCuentas(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); guardar.click(); }
      if (e.key === "Escape") pintarCuentas();
    });
    guardar.addEventListener("click", function () {
      var v = input.value.trim();
      if (!v) { api.toast("ESCRIBÍ TU " + def.etiqueta, true); input.focus(); return; }
      if (def.validar && !def.validar(v)) { api.toast(def.error || "VALOR INVÁLIDO", true); input.focus(); return; }
      if (clave === "faceit") { verificarFaceit(fila, input, v); return; }
      estado.cuentas[clave] = {
        conectada: true,
        usuario: def.normalizar ? def.normalizar(v) : v,
        url: def.url ? def.url(v) : null,
      };
      api.guardar(estado);
      pintarCuentas();
      redSincronizar();
      api.toast(def.etiqueta + " CONECTADO · " + String(estado.cuentas[clave].usuario).toUpperCase());
    });

    form.appendChild(input);
    form.appendChild(guardar);
    form.appendChild(cancelar);
    form.appendChild(nota);
    zona.appendChild(form);
    input.focus();
  }

  function verificarFaceit(fila, input, nick) {
    fila.classList.add("cargando");
    api.toast("VERIFICANDO EN FACEIT…");
    fetch("/api/faceit/usuario?nick=" + encodeURIComponent(nick), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "faceit_no_responde" }; }); })
      .then(function (j) {
        fila.classList.remove("cargando");
        if (j && j.ok && j.usuario) {
          estado.cuentas.faceit = {
            conectada: true,
            id: j.usuario.id,        /* S4.7.1: ID del jugador — la historia va por ID, sin ambigüedad de caja */
            usuario: j.usuario.nickname,
            url: "https://www.faceit.com/en/players/" + encodeURIComponent(j.usuario.nickname),
            nivel: j.usuario.nivel,
            pais: j.usuario.pais,
            region: j.usuario.region,
            avatar: j.usuario.avatar,
            elo: j.usuario.elo,      /* S4.7: elo de FACEIT para el panel */
            desde: j.usuario.desde,  /* S4.7: miembro desde (fecha FACEIT) */
          };
          api.guardar(estado);
          pintarCuentas();
          pintarFaceitBloque();
          redSincronizar();
          api.toast("FACEIT CONECTADO · " + String(j.usuario.nickname).toUpperCase() + (j.usuario.nivel ? " · NIVEL " + j.usuario.nivel : ""));
        } else if (j && j.error === "no_encontrado") {
          api.toast("ESE NICK NO EXISTE EN FACEIT · COPIA EL NICK EXACTO DE TU PERFIL (MAYÚSCULAS INCLUIDAS)", true);
          input.focus();
        } else {
          api.toast("FACEIT NO RESPONDIÓ · PROBÁ DE NUEVO", true);
          input.focus();
        }
      })
      .catch(function () {
        fila.classList.remove("cargando");
        api.toast("FACEIT NO RESPONDIÓ · PROBÁ DE NUEVO", true);
      });
  }

  /* ── MIS DATOS (con NOMBRE DE LA CUENTA) ── */
  function pintarNick(nick) {
    var limpio = String(nick || "jugador");
    var el = document.getElementById("nick-jugador");
    if (el) el.textContent = limpio.toUpperCase();
    var sh = document.getElementById("sub-handle");
    if (sh) sh.textContent = "@" + limpio.toLowerCase().replace(/[^a-z0-9_\-.]/g, "");
    document.querySelectorAll(".nav-entrar, .mega__entrar").forEach(function (a) {
      a.textContent = limpio.toUpperCase().slice(0, 14);
      a.setAttribute("href", "/perfil");
    });
  }

  document.getElementById("guardar-datos").addEventListener("click", function () {
    var pais = document.getElementById("dato-pais").value.trim();
    var region = document.getElementById("dato-region").value.trim();
    var discord = document.getElementById("dato-discord").value.trim();
    var nick = document.getElementById("dato-nick").value.trim();
    if (!pais || !region) { api.toast("PAÍS Y REGIÓN SON OBLIGATORIOS", true); return; }
    if (nick && !/^[a-zA-Z0-9_.\-]{3,20}$/.test(nick)) {
      api.toast("NOMBRE DE CUENTA INVÁLIDO · 3-20 LETRAS, NÚMEROS, . - _", true);
      return;
    }
    estado.pais = pais;
    estado.region = region;
    estado.discord = discord;
    if (discord && estado.cuentas.discord.conectada) estado.cuentas.discord.usuario = discord;
    document.getElementById("sub-pais").textContent = pais;
    document.getElementById("sub-region").textContent = region;

    /* EL NOMBRE SE APLICA YA: se guarda en tu navegador y se pinta en toda la
       ficha al instante, con o sin sesión. El servidor nunca más lo bloquea. */
    if (nick) {
      estado.nick = nick;
      api.guardar(estado);
      pintarNick(nick);
      api.pintarAvatar(estado);
    }
    api.guardar(estado);
    api.toast(nick ? "NOMBRE DE CUENTA ACTUALIZADO · " + nick.toUpperCase() : "MIS DATOS GUARDADOS");

    /* Sincronización con la cuenta (Auth0) EN SEGUNDO PLANO: si el servidor
       la acepta, el nombre y las redes te siguen en otros dispositivos; si
       todavía no la acepta, queda guardado en este navegador y NADA se rompe. */
    if (!window.VantAuth0 || !estado.sesion) return;
    window.VantAuth0.getToken().then(function (tok) {
      if (!tok) return;
      var cuerpo = { redes: estado.cuentas };
      if (nick) cuerpo.nickname = nick;
      fetch("/api/account/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify(cuerpo)
      })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (j) {
          if (j && j.ok) {
            if (j.redes) { estado.cuentas = Object.assign({}, estado.cuentas, j.redes); api.guardar(estado); }
            api.toast("SINCRONIZADO CON TU CUENTA · " + (nick ? nick.toUpperCase() : "DATOS AL DÍA"));
          }
          /* si el servidor no pudo sincronizar: silencio, el nombre ya está
             guardado en este navegador (no volvemos a asustar con errores). */
        })
        .catch(function () { /* sin red: queda local */ });
    });
  });

  /* ── ESTADO EN VIVO ── */
  var chipsEstado = document.querySelectorAll("#estado-chips .chip-sel");
  function pintarEstado() {
    chipsEstado.forEach(function (c) {
      c.classList.toggle("chip-sel--activo", c.getAttribute("data-estado") === estado.estado);
    });
  }
  chipsEstado.forEach(function (c) {
    c.addEventListener("click", function () {
      estado.estado = c.getAttribute("data-estado");
      api.guardar(estado);
      pintarEstado();
    });
  });

  /* ── RANGO: escalera con las 9 insignias oficiales ── */
  function pintarEscalera(idActual) {
    var cont = document.getElementById("rango-escalera");
    if (!cont) return;
    cont.innerHTML = "";
    RANGOS.forEach(function (r, i) {
      var paso = document.createElement("div");
      paso.className = "rango-escalera__paso" + (i === RANGOS.length - 1 ? " rango-escalera__paso--fin" : "") + (idActual && idActual === r.id ? " rango-escalera__paso--actual" : "");
      var img = document.createElement("img");
      img.src = "/static/img/rangos/rango-" + r.id + ".png";
      img.alt = "Rango " + r.nombre;
      img.loading = "lazy";
      var b = document.createElement("b");
      b.textContent = r.nombre;
      b.style.color = r.color;
      var s = document.createElement("small");
      s.textContent = r.xp ? (r.xp / 1000) + "K XP" : "INICIO";
      paso.appendChild(img);
      paso.appendChild(b);
      paso.appendChild(s);
      cont.appendChild(paso);
    });
  }

  /* ── RANGO REAL del agente (D1 · mismo motor de XP que el bot) ──
     /api/account/progreso devuelve el XP de la cuenta, el rango VANTS
     (misma escala CENIZA→SUPREMO que RANGOS_VANTS del bot), el % de la
     barra y el rango competitivo de Valorant. Pinta la caja de rango
     (IDs intactos para el rediseño v46) y resalta el peldaño actual. */
  function pintarProgreso(j) {
    if (!j || !j.ok) return;
    var r = j.rango || {};
    var img = document.getElementById("rango-insignia");
    var nom = document.getElementById("rango-nombre");
    var sub = document.getElementById("rango-sub");
    var barra = document.getElementById("barra-rango");
    var xpCaja = document.getElementById("rango-xp");
    if (img && r.id) {
      img.src = "/static/img/rangos/rango-" + r.id + ".png";
      img.alt = "Insignia " + (r.nombre || "");
    }
    if (nom) {
      nom.textContent = r.nombre || "SIN RANGO";
      nom.style.color = r.color || "var(--gris-2)";
    }
    if (sub) {
      var tSub = (j.siguiente && j.siguiente.nombre)
        ? "FALTAN " + Number(j.siguiente.falta || 0).toLocaleString("es") + " XP PARA " + j.siguiente.nombre
        : "RANGO MÁXIMO ALCANZADO";
      if (j.valorant && j.valorant.tier) {
        tSub = "VALORANT: " + String(j.valorant.tier).toUpperCase()
          + (j.valorant.rr !== null && j.valorant.rr !== undefined ? " · " + j.valorant.rr + " RR" : "")
          + " · " + tSub;
      }
      sub.textContent = tSub;
      sub.style.color = r.color || "";
    }
    if (barra) barra.style.width = Math.max(0, Math.min(100, r.progreso || 0)) + "%";
    if (xpCaja) xpCaja.textContent = Number(j.xp || 0).toLocaleString("es");
    pintarEscalera(r.id);
  }
  function cargarProgreso() {
    if (!window.VantAuth0 || !window.VantAuth0.getToken) return;
    window.VantAuth0.getToken().then(function (tok) {
      if (!tok) return;
      return fetch("/api/account/progreso", { headers: { Accept: "application/json", Authorization: "Bearer " + tok } })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (j) { if (j && j.ok) pintarProgreso(j); })
        .catch(function () { /* silencioso: la caja queda en SIN RANGO */ });
    }).catch(function () { /* sin token: nada */ });
  }

  /* ── CUENTA: sesión real (Auth0) ── */
  function pintarSesion() {
    var lineas = document.getElementById("cuenta-lineas");
    var btnSalir = document.getElementById("btn-salir");
    var btnGoogle = document.getElementById("btn-entrar-google");
    var btnDiscord = document.getElementById("btn-entrar-discord");
    var btnDirecto = document.getElementById("btn-perfil-entrar-directo");
    var badges = document.getElementById("perfil-badges");
    var s = estado.sesion;
    if (badges) {
      badges.innerHTML = "";
      if (s && s.verificado) {
        var b = document.createElement("span");
        b.className = "badge badge--verificado";
        b.textContent = "✓ VERIFICADO";
        badges.appendChild(b);
      }
    }
    var sinSesion = !s;
    if (btnGoogle) btnGoogle.hidden = !sinSesion;
    if (btnDiscord) btnDiscord.hidden = !sinSesion;
    if (btnDirecto) btnDirecto.hidden = !sinSesion;
    if (btnSalir) btnSalir.hidden = sinSesion;
    if (!lineas) return;
    if (!s) {
      lineas.innerHTML = "<p>Sin sesión: entrá con tu cuenta para editar tu ficha, conectar tus redes y publicar clips.</p>";
      return;
    }
    lineas.innerHTML =
      "<p>Correo: <b>" + (s.correo || "—") + "</b></p>" +
      "<p>Verificado: <b class=\"si\">" + (s.verificado ? "SÍ" : "NO") + "</b></p>" +
      "<p>Cuenta VANTS: <b>" + String(estado.nick || s.nick || "jugador") + "</b></p>";
  }

  document.getElementById("btn-salir").addEventListener("click", function () {
    try { localStorage.removeItem("vants_perfil_v1"); } catch (_e) { /* noop */ }
    if (window.VantAuth0) { window.VantAuth0.salir(); return; }
    api.toast("FICHA REINICIADA");
    setTimeout(function () { location.reload(); }, 900);
  });

  /* ENTRAR directo (email/lo que tenga la cuenta) y accesos sociales */
  function wire(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }
  wire("btn-perfil-entrar-directo", function () {
    if (window.VantAuth0) window.VantAuth0.entrar();
    else api.toast("NO SE PUDO ABRIR EL LOGIN · RECARGA LA PÁGINA", true);
  });
  wire("btn-entrar-google", function () {
    if (window.VantAuth0 && window.VantAuth0.entrarCon) window.VantAuth0.entrarCon("google-oauth2");
    else if (window.VantAuth0) window.VantAuth0.entrar();
  });
  wire("btn-entrar-discord", function () {
    if (window.VantAuth0 && window.VantAuth0.entrarCon) window.VantAuth0.entrarCon("discord");
    else if (window.VantAuth0) window.VantAuth0.entrar();
  });

  /* ── arranque ── */
  document.getElementById("equipo-nombre").value = estado.equipo.nombre || "";
  document.getElementById("equipo-tag").value = estado.equipo.tag || "";
  document.getElementById("dato-nick").value = estado.nick || "";   /* tu nombre guardado, a la vista */
  document.getElementById("dato-pais").value = estado.pais || "";
  document.getElementById("dato-region").value = estado.region || "";
  document.getElementById("dato-discord").value = estado.discord || "";
  if (estado.equipo.foto) imgFoto.src = estado.equipo.foto;
  if (estado.banner.tipo === "foto") {
    document.getElementById("btn-banner-foto").classList.add("chip-sel--activo");
    chipsBanner.forEach(function (c) { c.classList.remove("chip-sel--activo"); });
  }
  pintarBanner();
  pintarCuentas();
  pintarFaceitBloque();
  var btnVincularFaceit = document.getElementById("btn-vincular-faceit");
  if (btnVincularFaceit) {
    btnVincularFaceit.addEventListener("click", function () {
      var grilla = document.querySelector(".v46-grilla");
      var fila = document.querySelector('.cuenta-fila[data-cuenta="faceit"]');
      if (grilla) grilla.classList.add("v47-ges--abierta");
      if (fila) {
        fila.scrollIntoView({ behavior: "smooth", block: "center" });
        var input = fila.querySelector("input");
        if (input) input.focus();
      }
    });
  }
  pintarEstado();
  pintarEscalera();
  pintarSesion();
  api.aplicarIdentidad(estado);
  api.pintarAvatar(estado);
  api.renderClipsPerfil(estado);

  /* sesión Auth0: rellena nick, correo, redes guardadas en la cuenta y clips reales */
  if (window.VantAuth0) {
    window.VantAuth0.listo().then(function (u) {
      if (u) {
        estado.sesion = { sub: u.sub, nick: u.nick, correo: u.correo, verificado: u.verificado };
        api.guardar(estado);
        pintarNick(estado.nick || u.nick);
        api.pintarAvatar(estado);
        /* panel del agente: XP + rango VANTS + insignia + barra (D1 real) */
        cargarProgreso();
        /* redes + nickname guardados EN LA CUENTA (sirve tras cambiar de
           dispositivo y confirma el nombre si cambió hace poco) */
        window.VantAuth0.getToken().then(function (tok) {
          if (!tok) return;
          fetch("/api/account/perfil", { headers: { Accept: "application/json", Authorization: "Bearer " + tok } })
            .then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) {
              if (!j || !j.ok) return;
              var hayRedes = j.redes && Object.keys(j.redes).some(function (k) {
                return j.redes[k] && j.redes[k].conectada;
              });
              if (hayRedes) {
                estado.cuentas = Object.assign(api.defecto().cuentas, j.redes);
                api.guardar(estado);
                pintarCuentas();
                pintarFaceitBloque();
              }
              if (j.nickname && document.getElementById("dato-nick").value === "") {
                document.getElementById("dato-nick").value = j.nickname;
                if (j.nickname !== u.nick) pintarNick(j.nickname);
              }
            })
            .catch(function () { /* silencioso: el perfil local sigue */ });
        });
      } else {
        estado.sesion = null;
        api.guardar(estado);
      }
      pintarSesion();
      api.renderClipsPerfil(estado);
    });
  }
})();

/* ════════════════════════════════════════════════════════════════════
   S4.4 · REGISTRO + PERFIL NUEVO (diseñado y aprobado en el laboratorio)
   · PUERTA DE REGISTRO en /perfil sin sesión: Google y Discord DIRECTOS
     (saltan la pantalla de elección de Auth0). FACEIT tiene su propio
     aviso honesto: FACEIT solo da inicio de sesión a partners, por eso
     ese botón se traba tras el chequeo anti-bot — acá se ofrece el mismo
     resultado: entrar con Google/Discord y conectar FACEIT por nick.
   · ELIGE TU NOMBRE: al entrar por primera vez (y solo entonces) se pide
     el nombre de jugador UNA vez. Nunca vuelve a salir el del correo.
   · CHIPS de estado en la ficha: proveedor conectado + FACEIT nivel real.
   Todo vive en TU navegador (mismo patrón S4.2): nada depende del
   servidor y no rompe ningún flujo existente.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var api = window.VantsPerfil;
  if (!api) return;
  if (document.getElementById("vants-44-listo")) return;
  var marca = document.createElement("meta");
  marca.id = "vants-44-listo";
  document.head.appendChild(marca);

  var estado = window.__VANTS_ESTADO__ || api.leer();   /* S4.4: mismo objeto que el resto de la página */

  /* ── estilos propios del S4.4 (autocontenidos, prefijo v44) ── */
  var st = document.createElement("style");
  st.id = "vants-44-css";
  st.textContent =
    ".v44-capa{position:fixed;inset:0;z-index:9500;background:rgba(4,4,6,.84);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:18px;animation:v44in .18s ease}" +
    ".v44-caja{width:100%;max-width:432px;background:#0d0d10;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:26px 24px 20px;box-shadow:0 30px 80px rgba(0,0,0,.6);position:relative}" +
    ".v44-marca{display:flex;align-items:center;gap:10px;margin-bottom:16px}" +
    ".v44-v{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#ff0d2e,#ff5a1f);display:grid;place-items:center;font-weight:900;font-size:17px;color:#fff;box-shadow:0 0 16px rgba(255,13,46,.45)}" +
    ".v44-marca b{font-size:15px;letter-spacing:.02em;color:#fff}" +
    ".v44-paso{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#ff5a6e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 6px}" +
    ".v44-titulo{font-size:24px;line-height:1.08;font-weight:900;text-transform:uppercase;margin:0 0 8px;color:#fff}" +
    ".v44-titulo em{color:#ff0d2e;font-style:normal}" +
    ".v44-sub{color:#a1a1aa;font-size:13.5px;line-height:1.55;margin:0 0 18px}" +
    ".v44-btn{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border-radius:9px;border:0;cursor:pointer;font-weight:800;text-transform:uppercase;font-size:13.5px;letter-spacing:.03em;color:#fff;margin-bottom:10px;transition:filter .15s;font-family:inherit}" +
    ".v44-btn:hover{filter:brightness(1.09)}" +
    ".v44-m{width:24px;height:24px;border-radius:6px;background:rgba(0,0,0,.28);display:grid;place-items:center;font-size:13px;font-weight:900;flex:none}" +
    ".v44-btn--faceit{background:#ff5500}.v44-btn--discord{background:#5865F2}" +
    ".v44-btn--google{background:#fff;color:#141414}.v44-btn--google .v44-m{background:#e8f0fe;color:#4285F4}" +
    ".v44-btn--fino{background:transparent;border:1px solid rgba(255,255,255,.16);color:#d4d4d8;font-weight:600;font-size:11px;letter-spacing:.14em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
    ".v44-pie{margin-top:12px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#52525b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;margin-bottom:0}" +
    ".v44-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#a1a1aa;font-size:15px;cursor:pointer}" +
    ".v44-x:hover{color:#fff;border-color:rgba(255,255,255,.3)}" +
    ".v44-aviso{border:1px solid rgba(255,85,0,.35);background:rgba(255,85,0,.08);border-radius:10px;padding:14px;margin-bottom:14px}" +
    ".v44-aviso b{display:block;text-transform:uppercase;font-size:12.5px;letter-spacing:.04em;color:#ff9b6b;margin-bottom:6px}" +
    ".v44-aviso p{margin:0;color:#c9c9cf;font-size:12.5px;line-height:1.55}" +
    ".v44-campo{display:block;margin-bottom:12px}" +
    ".v44-campo span{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#71717a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-bottom:6px}" +
    ".v44-campo input{width:100%;background:#070708;border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#fff;padding:11px 12px;font-size:14px;outline:none;font-family:inherit}" +
    ".v44-campo input:focus{border-color:#ff0d2e}" +
    ".v44-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
    ".v44-ir{width:100%;padding:13px;border:0;border-radius:9px;background:linear-gradient(180deg,#ff2846,#e00b28);color:#fff;font-weight:900;text-transform:uppercase;letter-spacing:.04em;font-size:13.5px;cursor:pointer;box-shadow:0 6px 20px rgba(255,13,46,.3);font-family:inherit}" +
    ".v44-ir:disabled{opacity:.4;cursor:not-allowed}" +
    ".v44-omiti{display:block;text-align:center;margin:12px auto 0;color:#71717a;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;background:none;border:0}" +
    ".v44-omiti:hover{color:#d4d4d8}" +
    ".v44-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}" +
    ".v44-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:7px;font-size:10px;letter-spacing:.13em;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;border:1px solid rgba(255,255,255,.14);background:#141417;color:#d4d4d8}" +
    ".v44-chip b{font-weight:900}" +
    "@keyframes v44in{from{opacity:0}to{opacity:1}}" +
    ".v44-btn--correo{background:#151518;color:#f4f4f5;border:1px solid rgba(255,13,46,.55)}.v44-btn--correo:hover{background:rgba(255,13,46,.14)}.v44-btn--correo .v44-m{background:#ff0d2e;color:#fff}" +
    ".v44-pies{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:14px 0 0}" +
    ".v44-link{background:none;border:none;padding:4px 0;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#a1a1aa;cursor:pointer;text-decoration:underline dotted}.v44-link:hover{color:#ff0d2e}" +
    ".v44-sep{color:#3f3f46;font-size:9px}" +
    ".v44-avisook{border:1px solid rgba(1,201,27,.45);background:rgba(1,201,27,.07);border-radius:10px;padding:12px 14px;margin:4px 0 10px}.v44-avisook b{color:#01C91B;font-size:12px;letter-spacing:.12em;text-transform:uppercase}.v44-avisook p{margin:6px 0 0;font-size:12.5px;color:#d4d4d8;line-height:1.5}" +
    "@media (max-width:520px){.v44-grid2{grid-template-columns:1fr}.v44-titulo{font-size:21px}.v44-caja{padding:22px 18px 16px}}";
  document.head.appendChild(st);

  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function proveedorDe(sesion) {
    var sub = sesion && sesion.sub ? String(sesion.sub) : "";
    if (sub.indexOf("google-oauth2|") === 0) return { id: "google", nombre: "GOOGLE" };
    if (sub.indexOf("discord|") === 0) return { id: "discord", nombre: "DISCORD" };
    if (sub.indexOf("facebook|") === 0) return { id: "facebook", nombre: "FACEBOOK" };
    if (sub.indexOf("apple|") === 0) return { id: "apple", nombre: "APPLE" };
    return { id: "correo", nombre: "CORREO" };
  }

  /* ── capa base reutilizable ── */
  function abrirCapa(html, alCerrar) {
    cerrarCapa();
    var capa = document.createElement("div");
    capa.className = "v44-capa";
    capa.id = "v44-capa";
    capa.innerHTML = '<div class="v44-caja">' + html + "</div>";
    var x = document.createElement("button");
    x.type = "button";
    x.className = "v44-x";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Cerrar");
    x.addEventListener("click", function () { cerrarCapa(); if (alCerrar) alCerrar(); });
    capa.querySelector(".v44-caja").appendChild(x);
    document.body.appendChild(capa);
    return capa;
  }
  function cerrarCapa() {
    var vieja = document.getElementById("v44-capa");
    if (vieja) vieja.remove();
  }

  function irCon(conexion) {
    if (window.VantAuth0 && window.VantAuth0.entrarCon) { window.VantAuth0.entrarCon(conexion); return; }
    if (window.VantAuth0) { window.VantAuth0.entrar(); return; }
    api.toast("NO SE PUDO ABRIR EL REGISTRO · RECARGA LA PÁGINA", true);
  }

  /* ══ 1 · PUERTA DE REGISTRO (sin sesión en /perfil) ══ */
  var CLAVE_GATE = "vants_gate_ignorado";
  function gateIgnorado() {
    try { return !!sessionStorage.getItem(CLAVE_GATE); } catch (_e) { return false; }
  }

  function mostrarGate() {
    if (gateIgnorado()) return;
    var html =
      '<div class="v44-marca"><span class="v44-v">V</span><b>VANTS GAMES</b></div>' +
      '<p class="v44-paso">paso 1 de 2 · registro</p>' +
      '<h2 class="v44-titulo">Crea tu cuenta <em>para entrar</em></h2>' +
      '<p class="v44-sub">Para entrar a la arena te registrás con Google, Discord o tu correo con contraseña. Sirve para tu ficha, subir clips y entrar a torneos.</p>' +
      '<button type="button" class="v44-btn v44-btn--faceit" id="v44-g-faceit"><span class="v44-m">F</span>Registrarme con FACEIT</button>' +
      '<button type="button" class="v44-btn v44-btn--discord" id="v44-g-discord"><span class="v44-m">D</span>Registrarme con Discord</button>' +
      '<button type="button" class="v44-btn v44-btn--google" id="v44-g-google"><span class="v44-m">G</span>Registrarme con Google</button>' +
      '<button type="button" class="v44-btn v44-btn--correo" id="v44-g-correo"><span class="v44-m">@</span>Registrarme con correo</button>' +
      '<div class="v44-pies"><button type="button" class="v44-link" id="v44-g-ya">¿ya tenés cuenta? entrar con correo</button><span class="v44-sep">·</span><button type="button" class="v44-link" id="v44-g-olvide">olvidé mi contraseña</button></div>' +
      '<p class="v44-pie">tus datos solo se usan para tu perfil · podés desconectar cuando quieras</p>';
    abrirCapa(html, gateIgnoradoYa);
    var g = document.getElementById("v44-g-google");
    var d = document.getElementById("v44-g-discord");
    var f = document.getElementById("v44-g-faceit");
    if (g) g.addEventListener("click", function () { irCon("google-oauth2"); });
    if (d) d.addEventListener("click", function () { irCon("discord"); });
    if (f) f.addEventListener("click", explicarFaceit);
    var co = document.getElementById("v44-g-correo");
    var ya = document.getElementById("v44-g-ya");
    var ol = document.getElementById("v44-g-olvide");
    if (co) co.addEventListener("click", function () { irCorreo("registrar"); });
    if (ya) ya.addEventListener("click", function () { irCorreo("entrar"); });
    if (ol) ol.addEventListener("click", panelOlvide);
  }
  function gateIgnoradoYa() {
    try { sessionStorage.setItem(CLAVE_GATE, "1"); } catch (_e) { /* noop */ }
  }

  function explicarFaceit() {
    var caja = document.querySelector("#v44-capa .v44-caja");
    if (!caja) return;
    caja.querySelectorAll(".v44-btn, .v44-pie, .v44-titulo, .v44-sub").forEach(function (n) { n.remove(); });
    caja.insertAdjacentHTML("beforeend",
      '<p class="v44-paso">sobre faceit</p>' +
      '<div class="v44-aviso"><b>El inicio con FACEIT está caído — del lado de FACEIT</b>' +
      "<p>FACEIT solo deja iniciar sesión con su cuenta a sus socios (partners). La web no puede completar ese acceso: por eso se queda trabado después del chequeo de seguridad. No es tu cuenta ni tu navegador.</p></div>" +
      '<p class="v44-sub" style="margin-bottom:12px">Mismo resultado en 10 segundos: entrá con Google o Discord y conectá tu FACEIT con tu nick — tu nivel real queda en la ficha, verificado contra FACEIT.</p>' +
      '<button type="button" class="v44-btn v44-btn--google" id="v44-f-google"><span class="v44-m">G</span>Entrar con Google y conectar FACEIT</button>' +
      '<button type="button" class="v44-btn v44-btn--discord" id="v44-f-discord"><span class="v44-m">D</span>Entrar con Discord y conectar FACEIT</button>' +
      '<button type="button" class="v44-btn v44-btn--fino" id="v44-f-volver">← volver</button>');
    var a = document.getElementById("v44-f-google");
    var b = document.getElementById("v44-f-discord");
    var v = document.getElementById("v44-f-volver");
    if (a) a.addEventListener("click", function () { marcarFaceit(); irCon("google-oauth2"); });
    if (b) b.addEventListener("click", function () { marcarFaceit(); irCon("discord"); });
    if (v) v.addEventListener("click", mostrarGate);
  }
  function marcarFaceit() {
    try { sessionStorage.setItem("vants_vincular_faceit", "1"); } catch (_e) { /* noop */ }
  }

  /* ══ 1b · CORREO Y CONTRASEÑA + RESETEO (S4.5) ══ */
  var CLIENTE_AUTH0 = "oaOmNizh7HrASWfmfM29bN284IMJvqPG";
  var CONEXION_CORREO = "Username-Password-Authentication";
  function irCorreo(opcion) {
    if (window.VantAuth0 && window.VantAuth0.entrarCorreo) { window.VantAuth0.entrarCorreo(opcion); return; }
    if (window.VantAuth0) { window.VantAuth0.entrar(); return; }
    api.toast("NO SE PUDO ABRIR EL REGISTRO · RECARGA LA PÁGINA", true);
  }

  function panelOlvide() {
    var caja = document.querySelector("#v44-capa .v44-caja");
    if (!caja) return;
    caja.querySelectorAll(".v44-btn, .v44-pie, .v44-titulo, .v44-sub, .v44-pies, .v44-paso").forEach(function (n) { n.remove(); });
    caja.insertAdjacentHTML("beforeend",
      '<p class="v44-paso">restablecer contraseña</p>' +
      '<h2 class="v44-titulo">Te mandamos <em>el enlace</em></h2>' +
      '<p class="v44-sub">Escribí el correo con el que creaste tu cuenta y te enviamos un enlace para poner una contraseña nueva.</p>' +
      '<label class="v44-campo"><span>Correo</span><input id="v44-r-email" type="email" placeholder="tu@correo.com" autocomplete="email"></label>' +
      '<button type="button" class="v44-ir" id="v44-r-enviar" disabled>Enviar enlace →</button>' +
      '<div class="v44-pies"><button type="button" class="v44-link" id="v44-r-volver">← volver al registro</button></div>');
    var em = document.getElementById("v44-r-email");
    var en = document.getElementById("v44-r-enviar");
    var vo = document.getElementById("v44-r-volver");
    function valida() { en.disabled = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value.trim()); }
    if (em && en) {
      em.addEventListener("input", valida);
      em.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (!en.disabled) en.click(); } });
      en.addEventListener("click", function () { mandarReset(em.value.trim(), en); });
    }
    if (vo) vo.addEventListener("click", mostrarGate);
    if (em) em.focus();
  }

  function mandarReset(correo, boton) {
    boton.disabled = true;
    boton.textContent = "ENVIANDO…";
    fetch("https://vants.eu.auth0.com/dbconnections/change_password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENTE_AUTH0, email: correo, connection: CONEXION_CORREO }),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function () {
      var caja = document.querySelector("#v44-capa .v44-caja");
      if (!caja) return;
      caja.querySelectorAll(".v44-campo, .v44-ir, .v44-aviso, .v44-pies").forEach(function (n) { n.remove(); });
      caja.insertAdjacentHTML("beforeend",
        '<div class="v44-avisook"><b>Revisá tu correo</b><p>Te mandamos el enlace para cambiar la contraseña. Si no lo ves en unos minutos, revisá también spam o promociones.</p></div>' +
        '<div class="v44-pies"><button type="button" class="v44-link" id="v44-r-volver2">← volver al registro</button></div>');
      var v2 = document.getElementById("v44-r-volver2");
      if (v2) v2.addEventListener("click", mostrarGate);
    }).catch(function () {
      /* Auth0 pidió verificación extra (anti-bot): la pantalla hospedada lo resuelve */
      api.toast("TU NAVEGADOR PIDE VERIFICACIÓN EXTRA · TOCA ¿OLVIDASTE TU CONTRASEÑA? EN LA SIGUIENTE PANTALLA");
      irCorreo("entrar");
    });
  }

  /* ══ 2 · ELIGE TU NOMBRE (solo primer inicio) ══ */
  function mostrarNombre(prov) {
    try { if (sessionStorage.getItem("vants_nombre_ignorado")) return; } catch (_e) { /* noop */ }
    var notas = {
      google: "Entraste con Google: Google te habría puesto tu nombre real como nick. Acá eliges TU nombre de jugador — nunca el del correo.",
      discord: "Entraste con Discord: Discord te habría puesto tu apodo como nick. Acá eliges TU nombre de jugador.",
      facebook: "Entraste con Facebook: acá eliges TU nombre de jugador.",
      apple: "Entraste con Apple: acá eliges TU nombre de jugador.",
      correo: "Entraste con tu correo: acá eliges TU nombre de jugador — nunca el del correo."
    };
    var html =
      '<div class="v44-marca"><span class="v44-v">V</span><b>VANTS GAMES</b></div>' +
      '<p class="v44-paso">paso 2 de 2 · solo la primera vez</p>' +
      '<h2 class="v44-titulo">Elige tu nombre <em>de jugador</em></h2>' +
      '<p class="v44-sub">' + (notas[prov.id] || "Acá eliges TU nombre de jugador — nunca el del correo.") + "</p>" +
      '<label class="v44-campo"><span>Nombre de la cuenta</span><input id="v44-n-nick" maxlength="20" placeholder="TU NOMBRE DE JUGADOR" autocomplete="off"></label>' +
      '<div class="v44-grid2">' +
      '<label class="v44-campo"><span>País</span><input id="v44-n-pais" maxlength="30" value="VE"></label>' +
      '<label class="v44-campo"><span>Región</span><input id="v44-n-region" maxlength="30" value="LATAM"></label>' +
      "</div>" +
      '<button type="button" class="v44-ir" id="v44-n-crear" disabled>Crear mi perfil →</button>' +
      '<button type="button" class="v44-omiti" id="v44-n-ahora">ahora no, después lo pongo</button>';
    abrirCapa(html, nombreIgnoradoYa);
    var nick = document.getElementById("v44-n-nick");
    var pais = document.getElementById("v44-n-pais");
    var region = document.getElementById("v44-n-region");
    var crear = document.getElementById("v44-n-crear");
    if (!nick) return;
    nick.focus();
    function valido() { return /^[a-zA-Z0-9_.\-]{3,20}$/.test(nick.value.trim()); }
    function refrescar() { crear.disabled = !(valido() && pais.value.trim() && region.value.trim()); }
    nick.addEventListener("input", refrescar);
    pais.addEventListener("input", refrescar);
    region.addEventListener("input", refrescar);
    nick.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); crear.click(); } });
    crear.addEventListener("click", function () {
      var n = nick.value.trim();
      if (!valido()) { api.toast("NOMBRE INVÁLIDO · 3-20 LETRAS, NÚMEROS, . - _", true); nick.focus(); return; }
      estado.nick = n;
      estado.pais = pais.value.trim() || estado.pais || "VE";
      estado.region = region.value.trim() || estado.region || "LATAM";
      api.guardar(estado);
      var el = document.getElementById("nick-jugador"); if (el) el.textContent = n.toUpperCase();
      var sh = document.getElementById("sub-handle"); if (sh) sh.textContent = "@" + n.toLowerCase().replace(/[^a-z0-9_\-.]/g, "");
      document.querySelectorAll(".nav-entrar, .mega__entrar").forEach(function (a) {
        a.textContent = n.toUpperCase().slice(0, 14);
        a.setAttribute("href", "/perfil");
      });
      var dn = document.getElementById("dato-nick"); if (dn) dn.value = n;
      var sp = document.getElementById("sub-pais"); if (sp) sp.textContent = estado.pais;
      var sr = document.getElementById("sub-region"); if (sr) sr.textContent = estado.region;
      api.pintarAvatar(estado);
      pintarChips();
      cerrarCapa();
      api.toast("PERFIL CREADO · BIENVENIDO " + n.toUpperCase());
      sincronizarNombre(n);
    });
    var ahora = document.getElementById("v44-n-ahora");
    if (ahora) ahora.addEventListener("click", function () {
      nombreIgnoradoYa();
      cerrarCapa();
      api.toast("TU NOMBRE SE PONE EN MIS DATOS CUANDO QUIERAS");
    });
  }
  function nombreIgnoradoYa() {
    try { sessionStorage.setItem("vants_nombre_ignorado", "1"); } catch (_e) { /* noop */ }
  }

  function sincronizarNombre(n) {
    if (!window.VantAuth0 || !estado.sesion) return;
    window.VantAuth0.getToken().then(function (tok) {
      if (!tok) return;
      fetch("/api/account/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ nickname: n })
      }).catch(function () { /* silencioso: queda local */ });
    });
  }

  /* ══ 3 · CHIPS DE ESTADO en la ficha ══ */
  var NIVEL_COLOR = { 1: "#f1f5f9", 2: "#01C91B", 3: "#01C91B", 4: "#94D406", 5: "#FFC800", 6: "#FF9000", 7: "#FF6B00", 8: "#FF3C3C", 9: "#FF0000", 10: "#E4AE39" };
  function pintarChips() {
    var zona = document.getElementById("perfil-badges");
    if (!zona) return;
    zona.querySelectorAll(".v44-chip").forEach(function (n) { n.remove(); });
    zona.classList.add("v44-chips");
    var s = estado.sesion;
    if (s) {
      var prov = proveedorDe(s);
      var c1 = document.createElement("span");
      c1.className = "v44-chip";
      c1.innerHTML = "<b>" + prov.nombre + "</b> conectada ✓";
      if (prov.id === "discord") c1.style.borderColor = "rgba(88,101,242,.55)";
      if (prov.id === "google") c1.style.borderColor = "rgba(255,255,255,.32)";
      zona.appendChild(c1);
    }
    var f = estado.cuentas && estado.cuentas.faceit;
    var c2 = document.createElement("span");
    c2.className = "v44-chip";
    if (f && f.conectada && f.usuario) {
      c2.innerHTML = "<b>FACEIT " + (f.nivel ? escapeHtml(String(f.nivel)) : "✓") + "</b> · " + escapeHtml(String(f.usuario));
      if (f.nivel) {
        c2.style.background = NIVEL_COLOR[f.nivel] || "#f1f5f9";
        c2.style.color = "#000";
        c2.style.borderColor = "transparent";
      } else {
        c2.style.borderColor = "rgba(255,85,0,.5)";
      }
    } else {
      c2.textContent = "SIN FACEIT";
    }
    zona.appendChild(c2);
  }
  /* si FACEIT conecta o desconecta, refresca los chips solos */
  var faceitReal = document.getElementById("faceit-real");
  if (faceitReal && window.MutationObserver) {
    new MutationObserver(function () { pintarChips(); }).observe(faceitReal, { attributes: true });
  }

  /* ══ arranque: decide qué pantalla toca ══ */
  function vincularFaceitSiToca() {
    var toca = false;
    try {
      toca = sessionStorage.getItem("vants_vincular_faceit") === "1";
      sessionStorage.removeItem("vants_vincular_faceit");
    } catch (_e) { /* noop */ }
    if (!toca) return;
    setTimeout(function () {
      var fila = document.querySelector('.cuenta-fila[data-cuenta="faceit"]');
      if (!fila) return;
      if (estado.cuentas.faceit && estado.cuentas.faceit.conectada) {
        api.toast("TU FACEIT YA ESTÁ CONECTADA ✓");
        return;
      }
      var b = fila.querySelector("button.btn");
      if (b) {
        b.click();
        api.toast("PONÉ TU NICK DE FACEIT Y QUEDA VERIFICADO", true);
        try { fila.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_e) { /* noop */ }
      }
    }, 700);
  }

  function decidir(u) {
    if (u) {
      estado.sesion = { sub: u.sub, nick: u.nick, correo: u.correo, verificado: u.verificado };
      api.guardar(estado);
      pintarChips();
      vincularFaceitSiToca();
      if (!estado.nick) mostrarNombre(proveedorDe(estado.sesion));
    } else {
      estado.sesion = null;
      api.guardar(estado);
      pintarChips();
      mostrarGate();
    }
  }

  if (window.VantAuth0 && window.VantAuth0.listo) {
    window.VantAuth0.listo().then(decidir).catch(function () { decidir(null); });
  } else {
    decidir(null);
  }
})();

/* ════════════════════════════════════════════════════════════════════
   S4.6 · PERFIL 2.0 (diseñado y aprobado en el laboratorio — pestaña 4)
   Re-layout completo de la ficha SIN tocar datos ni flujos:
   · HERO de verdad: banner con rejilla y línea de marca, avatar con
     brillo, nombre grande, chips de estado, acciones (COMPARTIR PERFIL
     que copia tu URL + EDITAR FICHA) y tu rango VANTS al costado con
     la barra de XP en degradado de marca.
   · 6 stats como TILES (los 4 reales que ya existían + 2 reservados
     con «próximamente»: nada de datos inventados).
   · LA ESCALERA (9 rangos) pasa a sección de ancho completo.
   · GRILLA de 2 columnas para las secciones (antes: una columna larga
     donde todo se perdía): datos/FACEIT/redes a la izquierda; clips,
     equipo, banner, membresía y cuenta a la derecha.
   · TODO se MUEVE, nada se re-crea: mismos nodos, mismos IDs, mismos
     listeners — la puerta S4.5, el nombre S4.4 y los clips S4.3 siguen
     funcionando exactamente igual.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var vent = document.getElementById("ventana-perfil");
  if (!vent || document.getElementById("vants-46-listo")) return;
  var marca = document.createElement("meta");
  marca.id = "vants-46-listo";
  document.head.appendChild(marca);

  /* ── estilos propios del S4.6 (scope .v46 sobre la ventana del perfil) ── */
  var st = document.createElement("style");
  st.id = "vants-46-css";
  st.textContent =
    ".v46 .v46-hero{background:linear-gradient(180deg,rgba(255,13,46,.055),transparent 34%),#070708;border-bottom:1px solid var(--borde-2)}" +
    ".v46 .v46-hero__banner{position:relative}" +
    ".v46 #banner::before{content:\"\";position:absolute;inset:0;background-image:linear-gradient(rgba(255,13,46,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,13,46,.5) 1px,transparent 1px);background-size:26px 26px;opacity:.14;pointer-events:none;z-index:1}" +
    ".v46 .v46-hero__linea{position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#ff0d2e,#ff5a1f 55%,transparent);z-index:1;pointer-events:none}" +
    ".v46 .v46-hero__cuerpo{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:0 20px 18px;margin-top:-34px;position:relative;z-index:2}" +
    ".v46 .perfil__identidad{margin-top:0;padding:0;flex:1 1 320px;min-width:0;align-items:flex-start}" +
    ".v46 .perfil__avatar{border-radius:16px;box-shadow:0 0 26px rgba(255,13,46,.4)}" +
    ".v46 .perfil__nombre h2{font-size:clamp(26px,4vw,36px)}" +
    ".v46 .perfil__sub{margin:6px 0 10px}" +
    ".v46 .v46-hero__lado{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;justify-content:flex-end}" +
    ".v46 .v46-hero__acciones{display:flex;flex-direction:column;gap:8px;min-width:172px}" +
    ".v46 .v46-hero__acciones .btn{width:100%;justify-content:center;text-align:center}" +
    ".v46 .v46-hero__rango .rango-caja{width:216px;flex-direction:column;text-align:center;gap:12px;padding:16px 14px;border-radius:12px;border-color:var(--borde-2);background:rgba(10,11,15,.75)}" +
    ".v46 .rango-caja__insignia{width:64px;height:64px;border-radius:12px}" +
    ".v46 .rango-caja__insignia img{width:52px;height:52px;filter:drop-shadow(0 0 12px rgba(255,13,46,.35))}" +
    ".v46 .rango-caja__info{flex:none;width:100%}" +
    ".v46 .rango-caja__info b{font-size:19px}" +
    ".v46 .rango-caja__info small{margin:4px 0 8px}" +
    ".v46 .rango-caja__xp{width:100%;text-align:center}" +
    ".v46 .rango-caja__xp b{font-size:17px}" +
    ".v46 .rango-caja .barra i{background:linear-gradient(90deg,#ff0d2e,#ff5a1f)}" +
    ".v46 .v46-chip{display:inline-flex;align-items:center;padding:6px 10px;border-radius:7px;font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;font-weight:700;border:1px solid rgba(255,255,255,.14);background:#141417;color:#d4d4d8}" +
    ".v46 .v46-stats{padding:18px 20px 0}" +
    ".v46 .stats-grid.v46-tiles{grid-template-columns:repeat(6,1fr);gap:10px;border:0;border-radius:0;overflow:visible;background:none}" +
    ".v46 .v46-tiles .stat-caja{text-align:left;padding:14px 14px 12px;border:1px solid var(--borde);border-right:1px solid var(--borde);border-radius:12px;background:rgba(10,11,15,.66);transition:border-color .15s ease,box-shadow .15s ease}" +
    ".v46 .v46-tiles .stat-caja:hover{border-color:rgba(255,13,46,.5);box-shadow:0 0 18px rgba(255,13,46,.14)}" +
    ".v46 .stat-caja b{font-size:26px}" +
    ".v46 .stat-caja small{color:var(--gris-2);white-space:nowrap;letter-spacing:.16em;font-size:8.5px}" +
    ".v46 .v46-pronto{display:block;margin-top:7px;font-family:var(--mono);font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:#454c58;white-space:nowrap}" +
    ".v46 .v46-escalera{padding:14px 20px 0}" +
    ".v46 .v46-grilla{display:grid;grid-template-columns:2fr 3fr;gap:14px;padding:16px 20px 26px;align-items:start}" +
    ".v46 .v46-col{display:grid;gap:14px;min-width:0}" +
    ".v46 .v46-fila2{display:grid;grid-template-columns:1fr 1fr;gap:14px}" +
    ".v46 .cuenta-fila{flex-wrap:wrap;row-gap:8px}" +
    ".v46 .perfil__bloque{background:rgba(10,11,15,.66);border:1px solid var(--borde);border-radius:12px;padding:18px}" +
    ".v46 .perfil__bloque .etiqueta{color:#ff5a6e;letter-spacing:.18em;font-size:10px}" +
    ".v46 .perfil__nota-nuevo{font-size:12.5px}" +
    "@media (max-width:1120px){.v46 .stats-grid.v46-tiles{grid-template-columns:repeat(3,1fr)}}" +
    "@media (max-width:980px){.v46 .v46-grilla{grid-template-columns:1fr}.v46 .v46-hero__lado{justify-content:flex-start;width:100%}}" +
    "@media (max-width:640px){.v46 .stats-grid.v46-tiles{grid-template-columns:repeat(2,1fr)}.v46 .v46-fila2{grid-template-columns:1fr}.v46 .v46-hero__rango .rango-caja,.v46 .v46-hero__acciones{width:100%}.v46 .v46-hero__rango{width:100%}}";
  document.head.appendChild(st);
  vent.classList.add("v46");

  function q(sel) { return vent.querySelector(sel); }

  /* ── piezas existentes (por ID / contenido — nunca se re-crean) ── */
  var barra = q(".perfil__barra");
  var banner = document.getElementById("banner");
  var identidad = q(".perfil__identidad");
  var bEquipo = null, bBanner = null, bCuentas = null, bInsignias = null, bStats = null,
      bRango = null, bFaceit = null, bMembresia = null, bEstado = null, bInscrip = null,
      bCuenta = null, bClips = null;
  var bDatos = document.getElementById("mis-datos");
  var badges = document.getElementById("perfil-badges");
  var badgesNota = null;
  vent.querySelectorAll(".perfil__bloque").forEach(function (b) {
    if (b === bDatos) return;
    var e = b.querySelector("span.etiqueta");
    var t = e ? e.textContent : "";
    if (badges && b.contains(badges)) { bInsignias = b; badgesNota = b.querySelector(".perfil__nota-nuevo"); return; }
    if (b.querySelector(".stats-grid")) { bStats = b; return; }
    if (b.querySelector(".rango-caja")) { bRango = b; return; }
    if (t.indexOf("MI EQUIPO") === 0) { bEquipo = b; return; }
    if (t.indexOf("BANNER") === 0) { bBanner = b; return; }
    if (t.indexOf("CUENTAS") === 0) { bCuentas = b; return; }
    if (t.indexOf("FACEIT") === 0) { bFaceit = b; return; }
    if (t.indexOf("MEMBRESÍA") === 0) { bMembresia = b; return; }
    if (t.indexOf("ESTADO") === 0) { bEstado = b; return; }
    if (t.indexOf("INSCRIPCIONES") !== -1) { bInscrip = b; return; }
    if (t === "CUENTA") { bCuenta = b; return; }
    if (t.indexOf("CLIPS") !== -1) { bClips = b; return; }
  });
  if (!bDatos || !identidad || !banner) return;

  /* ── HERO: banner + identidad + acciones + rango ── */
  var hero = document.createElement("div");
  hero.className = "v46-hero";
  var heroB = document.createElement("div");
  heroB.className = "v46-hero__banner";
  var linea = document.createElement("div");
  linea.className = "v46-hero__linea";
  heroB.appendChild(banner);
  heroB.appendChild(linea);

  var cuerpo = document.createElement("div");
  cuerpo.className = "v46-hero__cuerpo";
  cuerpo.appendChild(identidad);

  /* los chips de estado (S4.4) pasan a vivir bajo el nombre, como en el LAB */
  var sub = identidad.querySelector(".perfil__sub");
  if (badges && sub) sub.parentNode.insertBefore(badges, sub.nextSibling);
  var plan = document.getElementById("membresia-plan");
  var txtPlan = plan ? String(plan.textContent || "").trim() : "";
  var chipPlan = document.createElement("span");
  chipPlan.className = "v46-chip";
  chipPlan.textContent = /sin membres/i.test(txtPlan) ? "CUENTA GRATIS" : (txtPlan || "CUENTA GRATIS").toUpperCase();
  if (badges) badges.parentNode.insertBefore(chipPlan, badges.nextSibling);

  /* acciones: COMPARTIR PERFIL — única acción de la tarjeta (S4.7.4: fuera
     EDITAR FICHA; la gestión de la ficha ya no se abre desde el perfil) */
  var acc = document.createElement("div");
  acc.className = "v46-hero__acciones";
  var comp = document.createElement("button");
  comp.type = "button";
  comp.className = "btn btn--rojo";
  comp.textContent = "COMPARTIR PERFIL";
  function copiarAlPortapapeles(texto, hecho) {
    function alViejo() {
      try {
        var ta = document.createElement("textarea");
        ta.value = texto;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      } catch (_e) { /* noop */ }
      hecho();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(hecho, alViejo);
    } else alViejo();
  }
  comp.addEventListener("click", function () {
    copiarAlPortapapeles(location.origin + "/perfil", function () {
      comp.textContent = "¡COPIADO ✓!";
      setTimeout(function () { comp.textContent = "COMPARTIR PERFIL"; }, 1800);
    });
  });
  acc.appendChild(comp);

  /* rango: la MISMA caja de siempre (IDs intactos), al costado del hero */
  var lado = document.createElement("div");
  lado.className = "v46-hero__lado";
  var rangoWrap = document.createElement("div");
  rangoWrap.className = "v46-hero__rango";
  if (bRango) {
    var rangoCaja = bRango.querySelector(".rango-caja");
    if (rangoCaja) rangoWrap.appendChild(rangoCaja);
  }
  lado.appendChild(acc);
  lado.appendChild(rangoWrap);
  cuerpo.appendChild(lado);

  hero.appendChild(heroB);
  hero.appendChild(cuerpo);

  /* ── STATS TILES: los 4 reales + 2 reservados (sin datos inventados) ── */
  var statsSec = document.createElement("div");
  statsSec.className = "v46-stats";
  if (bStats) {
    var grid = bStats.querySelector(".stats-grid");
    if (grid) {
      grid.classList.add("v46-tiles");
      ["HEADSHOT %", "RACHA"].forEach(function (etq) {
        var d = document.createElement("div");
        d.className = "stat-caja v46-stat--pronto";
        var b = document.createElement("b");
        b.textContent = "—";
        var s = document.createElement("small");
        s.textContent = etq;
        var p = document.createElement("span");
        p.className = "v46-pronto";
        p.textContent = "pronto";
        d.appendChild(b); d.appendChild(s); d.appendChild(p);
        grid.appendChild(d);
      });
    }
    statsSec.appendChild(bStats);
  }

  /* ── ESCALERA (9 rangos) como sección de ancho completo ── */
  var esc = document.createElement("div");
  esc.className = "v46-escalera";
  if (bRango) {
    var eR = bRango.querySelector("span.etiqueta");
    if (eR) eR.textContent = "VANTS RANKED · LA ESCALERA";
    esc.appendChild(bRango);
  }

  /* ── GRILLA de secciones (2 columnas) ── */
  var grilla = document.createElement("div");
  grilla.className = "v46-grilla";
  var colA = document.createElement("div");
  colA.className = "v46-col";
  var colB = document.createElement("div");
  colB.className = "v46-col v46-col--ancha";
  if (bCuentas) { var eC = bCuentas.querySelector("span.etiqueta"); if (eC) eC.textContent = "REDES Y CUENTAS"; }
  if (bCuenta) { var eU = bCuenta.querySelector("span.etiqueta"); if (eU) eU.textContent = "CUENTA VINCULADA"; }
  if (bClips) {
    var eK = bClips.querySelector("span.etiqueta");
    if (eK && eK.firstChild && eK.firstChild.nodeType === 3) eK.firstChild.nodeValue = "MIS CLIPS · ";
    bClips.removeAttribute("style");
  }
  [bDatos, bFaceit, bCuentas, bEstado].forEach(function (b) { if (b) colA.appendChild(b); });
  var fila2 = document.createElement("div");
  fila2.className = "v46-fila2";
  if (bMembresia) fila2.appendChild(bMembresia);
  if (bCuenta) fila2.appendChild(bCuenta);
  [bClips, bEquipo, bBanner, fila2, bInscrip].forEach(function (b) { if (b) colB.appendChild(b); });
  grilla.appendChild(colA);
  grilla.appendChild(colB);

  /* ── montaje final de la ventana ── */
  if (bInsignias) bInsignias.remove();   /* los badges ya viven en el hero */
  while (vent.firstChild) vent.removeChild(vent.firstChild);
  vent.appendChild(barra);
  vent.appendChild(hero);
  vent.appendChild(statsSec);
  vent.appendChild(esc);
  vent.appendChild(grilla);

  /* ── el nombre VIVE en tu navegador: al recargar, el hero lo mantiene.
     (S4.2 promete "el nombre se aplica SIEMPRE, con o sin sesión": el
     campo MIS DATOS ya lo mostraba al volver; ahora también la ficha) ── */
  var est46 = window.__VANTS_ESTADO__;
  if (est46 && est46.nick) {
    var limpio = String(est46.nick);
    var elN = document.getElementById("nick-jugador");
    var elH = document.getElementById("sub-handle");
    if (elN && elN.textContent === "JUGADOR") elN.textContent = limpio.toUpperCase();
    if (elH && /^@jugador$/i.test(elH.textContent)) elH.textContent = "@" + limpio.toLowerCase().replace(/[^a-z0-9_\-.]/g, "");
    var iniciales = document.getElementById("avatar-iniciales");
    if (iniciales && iniciales.textContent === "·") iniciales.textContent = limpio.trim().charAt(0).toUpperCase();
    document.querySelectorAll(".nav-entrar, .mega__entrar").forEach(function (a) {
      a.textContent = limpio.toUpperCase().slice(0, 14);
      a.setAttribute("href", "/perfil");
    });
  }
  /* país y región también viven en tu navegador: el hero los mantiene al volver */
  if (est46 && est46.pais) { var sp46 = document.getElementById("sub-pais"); if (sp46 && sp46.textContent === "—") sp46.textContent = est46.pais; }
  if (est46 && est46.region) { var sr46 = document.getElementById("sub-region"); if (sr46 && sr46.textContent === "—") sr46.textContent = est46.region; }
  /* el chip del banner marca SIEMPRE el tipo real equipado (antes, al recargar,
     quedaba marcado CLÁSICO aunque tu banner fuera otro) */
  if (est46 && est46.banner && est46.banner.tipo) {
    document.querySelectorAll("#banner-chips .chip-sel[data-banner]").forEach(function (c) {
      c.classList.toggle("chip-sel--activo", c.getAttribute("data-banner") === est46.banner.tipo);
    });
  }
})();

/* ════════════════════════════════════════════════════════════════════
   S4.7 · PERFIL CON LA CARA DE FACEIT (diseñado y aprobado en el LAB)
   La estructura del perfil de FACEIT — sidebar de identidad a la
   izquierda y panel de juego a la derecha (temporada, season, rendimiento
   reciente, partidos recientes, destacados) — con la marca VANTS y los
   mismos tokens del launcher (Archivo, mono, rojo #FF0D2E, paneles oscuros).
   · TODO se MUEVE, nada se re-crea: mismos nodos, mismos IDs, mismos
     listeners (el hero del S4.6 se redistribuye).
   · HISTORIAL REAL: /api/faceit/historia (Data API v4 con la clave del
     worker). Si FACEIT no responde o no hay cuenta conectada, estados
     honestos — nunca datos inventados.
   · S4.7.2 · CIERRE DEL PERFIL (lo que quedó del diseño viejo, fuera):
     LA ESCALERA deja de montarse y la gestión de siempre (mis datos,
     equipo, banner, redes, membresía, cuenta, inscripciones, estado)
     queda COLAPSADA tras una barra fina: el perfil termina limpio, como
     el mockup aprobado — un clic la despliega (también el botón EDITAR
     FICHA) y nada se pierde.
   · S4.7.3 · UN SOLO RANGO: la tarjeta «RANGO · VANTS RANKED» de la
     sidebar se QUITA — con la season card de FACEIT en el panel había
     DOS tarjetas de rango en la misma pantalla (y la de VANTS en 0 XP
     solo repetía «SIN RANGO»). El circuito y sus 9 rangos viven
     completos en /ranking#rangos.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var vent = document.getElementById("ventana-perfil");
  if (!vent || document.getElementById("vants-47-listo")) return;
  var marca = document.createElement("meta");
  marca.id = "vants-47-listo";
  document.head.appendChild(marca);

  /* ── estilos propios del S4.7 (scope .v47) ── */
  var st = document.createElement("style");
  st.id = "vants-47-css";
  st.textContent =
    ".v47 .v47-cabecera{position:relative;overflow:hidden}" +
    ".v47 .v47-cabecera .v47-linea{position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#ff0d2e,#ff5a1f 55%,transparent);z-index:1;pointer-events:none}" +
    ".v47 .v47-marco{display:grid;grid-template-columns:296px minmax(0,1fr);gap:14px;padding:14px 20px 0;align-items:start}" +
    ".v47 .v47-side{display:grid;gap:14px;min-width:0}" +
    ".v47 .v47-main{display:grid;gap:14px;min-width:0}" +
    ".v47 .v47-caja{background:rgba(10,11,15,.66);border:1px solid var(--borde);border-radius:12px;padding:16px}" +
    ".v47 .v47-etq{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#ff5a6e;margin-bottom:10px}" +
    ".v47 .v47-etq--gris{color:#93939d}" +
    ".v47 .v47-perfil-card{background:linear-gradient(180deg,rgba(255,13,46,.06),transparent 40%),rgba(10,11,15,.66);border:1px solid var(--borde);border-radius:12px;padding:18px 14px 16px}" +
    ".v47 .v47-perfil-card .perfil__identidad{display:flex;flex-direction:column;align-items:center;padding:0;margin:0;flex:none}" +
    ".v47 .v47-perfil-card .perfil__avatar-wrap{margin:0 auto}" +
    ".v47 .v47-perfil-card .perfil__avatar{width:84px;height:84px;border-radius:16px}" +
    ".v47 .v47-perfil-card .perfil__nombre{width:100%;text-align:center;margin-top:10px}" +
    ".v47 .v47-perfil-card .perfil__nombre h2{font-size:23px;justify-content:center;display:flex;flex-wrap:wrap;gap:6px}" +
    ".v47 .v47-perfil-card .perfil__sub{margin:6px 0 0;text-align:center}" +
    ".v47 .v47-perfil-card .v44-chips{justify-content:center}" +
    ".v47 .v47-perfil-card .v46-chip{margin-top:8px}" +
    ".v47 .v47-perfil-card .v47-desde{display:none;margin:8px 0 0;font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#52525b}" +
    ".v47 .v47-perfil-card .v46-hero__acciones{flex-direction:row;gap:8px;min-width:0;width:100%;justify-content:center;margin-top:12px}" +
    ".v47 .v47-perfil-card .v46-hero__acciones .btn{width:auto;flex:1;justify-content:center;text-align:center;font-size:10.5px;padding:9px 8px;min-width:0}" +
    ".v47 .v47-hist-fila{display:flex;align-items:center;gap:10px;border:1px solid var(--borde);border-radius:8px;background:#0d0d10;padding:9px 11px}" +
    ".v47 .v47-hist-juego{width:30px;height:30px;border-radius:6px;display:grid;place-items:center;font-family:var(--mono);font-weight:800;font-size:9px;background:#1d1d22;color:#f1f5f9;flex:none}" +
    ".v47 .v47-hist-fila b{display:block;font-size:12.5px}" +
    ".v47 .v47-hist-fila small{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#7e7e88;margin-top:2px}" +
    ".v47 .v47-tabs{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
    ".v47 .v47-juego{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:8px;background:#1d1d22;border:1px solid var(--borde-2);font-family:var(--mono);font-size:10px;letter-spacing:.12em;font-weight:800;color:#f1f5f9}" +
    ".v47 .v47-juego i{width:14px;height:14px;border-radius:3px;background:#ff0d2e;display:grid;place-items:center;font-style:normal;font-size:8px;color:#fff}" +
    ".v47 .v47-tab{display:inline-flex;padding:7px 13px;border-radius:8px;background:rgba(19,19,23,.9);border:1px solid var(--borde);border-top-color:#ff0d2e;font-family:var(--mono);font-size:11px;font-weight:800;letter-spacing:.1em;color:#edede7}" +
    ".v47 .v47-tablink{margin-left:auto;font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#93939d;text-decoration:none;border-bottom:1px dotted #52525b;padding-bottom:2px}" +
    ".v47 .v47-tablink:hover{color:#ff5a6e}" +
    ".v47 .v47-temporada{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:rgba(19,19,23,.9);border:1px solid var(--borde);border-radius:12px;padding:12px 16px}" +
    ".v47 .v47-temporada small{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#7e7e88}" +
    ".v47 .v47-temporada .v47-cifra{font-size:15px;font-weight:900}" +
    ".v47 .v47-things{margin-left:auto;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}" +
    ".v47 .v47-things small{color:#93939d}" +
    ".v47 .v47-verde{color:#3ee6a0}" +
    ".v47 .v47-season{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:rgba(19,19,23,.9);border:1px solid var(--borde);border-radius:12px;padding:14px 16px}" +
    ".v47 .v47-season__nivel{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#1d1d22;border:1px solid var(--borde-2);font-weight:900;font-size:17px;color:#f1f5f9;flex:none}" +
    ".v47 .v47-season__nivel--off{font-size:16px;color:#93939d}" +
    ".v47 .v47-season__info small{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#7e7e88;margin-bottom:2px}" +
    ".v47 .v47-season__info b{font-size:17px;font-weight:900;text-transform:uppercase}" +
    ".v47 .v47-season__stats{margin-left:auto;display:flex;gap:18px;align-items:center;flex-wrap:wrap}" +
    ".v47 .v47-season__stats p{text-align:right;margin:0}" +
    ".v47 .v47-season__stats b{display:block;font-size:14px;font-weight:900}" +
    ".v47 .v47-season__stats small{font-family:var(--mono);font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#7e7e88}" +
    ".v47 .v47-season__link{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#ff5a6e;text-decoration:none;border-bottom:1px dotted rgba(255,90,110,.5);padding-bottom:2px}" +
    ".v47 .v47-heat{display:grid;grid-template-rows:repeat(7,8px);grid-auto-flow:column;grid-auto-columns:8px;gap:3px}" +
    ".v47 .v47-heat span{border-radius:2px;background:#1a1a1f}" +
    ".v47 .v47-heat span.h1{background:rgba(255,13,46,.35)}" +
    ".v47 .v47-heat span.h2{background:rgba(255,13,46,.6)}" +
    ".v47 .v47-heat span.h3{background:#ff0d2e}" +
    ".v47 .v47-heat-ley{display:flex;align-items:center;gap:5px;margin-top:8px;font-family:var(--mono);font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#52525b}" +
    ".v47 .v47-heat-ley i{width:8px;height:8px;border-radius:2px;display:inline-block;font-style:normal}" +
    ".v47 .v47-rend-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px}" +
    ".v47 .v47-rend-head b{font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:.02em}" +
    ".v47 .v47-rend-head small{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#7e7e88}" +
    ".v47 .v47-tabla{width:100%;border-collapse:collapse}" +
    ".v47 .v47-tabla th{font-family:var(--mono);font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#7e7e88;text-align:left;padding:6px 10px 6px 0;font-weight:500}" +
    ".v47 .v47-tabla td{padding:8px 10px 8px 0;border-top:1px solid #1c1c21;font-size:12.5px;vertical-align:middle}" +
    ".v47 .v47-tabla td.fecha{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#93939d;white-space:nowrap}" +
    ".v47 .v47-tabla td.mono{font-family:var(--mono);font-size:12px}" +
    ".v47 .v47-tabla .wl{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-weight:800;font-size:12px}" +
    ".v47 .v47-tabla .chipw,.v47 .v47-tabla .chipl{font-family:var(--mono);font-size:9px;font-weight:900;padding:2px 6px;border-radius:4px}" +
    ".v47 .v47-tabla .chipw{background:rgba(62,230,160,.14);color:#3ee6a0}" +
    ".v47 .v47-tabla .chipl{background:rgba(255,13,46,.13);color:#ff5a6e}" +
    ".v47 .v47-nota{margin-top:8px;font-family:var(--mono);font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#52525b}" +
    ".v47 .v47-vacio{font-size:12.5px;color:#a1a1aa;line-height:1.55;margin:0}" +
    ".v47 .v47-ges-bar{display:flex;align-items:center;gap:14px;width:calc(100% - 40px);margin:10px 20px 26px;padding:14px 18px;background:#101014;border:1px solid #222228;border-radius:12px;cursor:pointer;text-align:left;color:#edede7;font-family:inherit}" +
    ".v47 .v47-ges-bar b{font-family:Archivo,sans-serif;font-size:13px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}" +
    ".v47 .v47-ges-bar small{flex:1;min-width:0;font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#7e7e88;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".v47 .v47-ges-bar i{color:#ff0d2e;font-style:normal;font-size:12px;transition:transform .18s ease;flex:none}" +
    ".v47 .v47-ges-bar:hover{border-color:rgba(255,13,46,.45)}" +
    ".v47 .v47-ges-bar--abierta i{transform:rotate(90deg)}" +
    ".v47 .v46-grilla{display:none;padding:6px 20px 26px}" +
    ".v47 .v46-grilla.v47-ges--abierta{display:grid}" +
    "@media (max-width:1020px){.v47 .v47-marco{grid-template-columns:1fr}.v47 .v47-things{margin-left:0}}" +
    "@media (max-width:640px){.v47 .v47-perfil-card .v46-hero__acciones{flex-direction:column}.v47 .v47-perfil-card .v46-hero__acciones .btn{width:100%}.v47 .v47-season__stats{margin-left:0}}";
  document.head.appendChild(st);
  vent.classList.add("v47");

  /* ── piezas del S4.6 que se redistribuyen (mismos nodos) ── */
  var barra = vent.querySelector(".perfil__barra");
  var hero = vent.querySelector(".v46-hero");
  var statsSec = vent.querySelector(".v46-stats");
  var esc = vent.querySelector(".v46-escalera");
  var grilla = vent.querySelector(".v46-grilla");
  var identidad = vent.querySelector(".perfil__identidad");
  var banner = document.getElementById("banner");
  if (!barra || !hero || !identidad || !banner || !grilla) return;
  var acc = hero.querySelector(".v46-hero__acciones");
  var linea = hero.querySelector(".v46-hero__linea");
  var bStats = statsSec ? statsSec.querySelector(".perfil__bloque") : null;
  var bFaceit = vent.querySelector("#faceit-real") ? vent.querySelector("#faceit-real").closest(".perfil__bloque") : null;
  var bClips = document.getElementById("clips-perfil") ? document.getElementById("clips-perfil").closest(".perfil__bloque") : null;

  function cajaNueva(etq, gris) {
    var d = document.createElement("div");
    d.className = "v47-caja";
    var s = document.createElement("span");
    s.className = "v47-etq" + (gris ? " v47-etq--gris" : "");
    s.textContent = etq;
    d.appendChild(s);
    return d;
  }

  /* ── cabecera: banner de marca con su línea ── */
  var cab = document.createElement("div");
  cab.className = "v47-cabecera";
  if (linea) cab.appendChild(linea);
  cab.appendChild(banner);

  /* ── SIDEBAR ── */
  var marco = document.createElement("div");
  marco.className = "v47-marco";
  var side = document.createElement("div");
  side.className = "v47-side";
  var main = document.createElement("div");
  main.className = "v47-main";

  /* 1 · tarjeta de perfil: identidad + acciones */
  var pc = document.createElement("div");
  pc.className = "v47-perfil-card";
  pc.appendChild(identidad);
  if (acc) pc.appendChild(acc);
  var subEl = identidad.querySelector(".perfil__sub");
  var desdeEl = document.createElement("p");
  desdeEl.className = "v47-desde";
  if (subEl && subEl.parentNode) subEl.parentNode.insertBefore(desdeEl, subEl.nextSibling);
  side.appendChild(pc);

  /* 2 · historial de partidas */
  var cHist = cajaNueva("HISTORIAL DE PARTIDAS", true);
  var hist = document.createElement("div");
  hist.id = "v47-hist";
  cHist.appendChild(hist);
  side.appendChild(cHist);

  /* 3 · actividad reciente (heatmap) */
  var cAct = cajaNueva("ACTIVIDAD RECIENTE · ÚLTIMOS 90 DÍAS", true);
  var heat = document.createElement("div");
  heat.className = "v47-heat";
  cAct.appendChild(heat);
  var ley = document.createElement("p");
  ley.className = "v47-heat-ley";
  ley.innerHTML = 'menos <i style="background:#1a1a1f"></i><i style="background:rgba(255,13,46,.35)"></i><i style="background:rgba(255,13,46,.6)"></i><i style="background:#ff0d2e"></i> m\u00e1s';
  cAct.appendChild(ley);
  side.appendChild(cAct);

  /* 4 · FACEIT (el bloque de siempre, ahora en la sidebar) */
  if (bFaceit) {
    var eF = bFaceit.querySelector("span.etiqueta");
    if (eF) eF.textContent = "FACEIT · CUENTA DE JUEGO";
    side.appendChild(bFaceit);
  }

  /* 5 · rango VANTS — QUITADO en S4.7.3: la season card de FACEIT ya
       muestra el rango; dos tarjetas de rango era una de más. La caja
       original (.rango-caja) se descarta con el hero del S4.6 y el
       circuito completo (9 rangos) vive en /ranking#rangos. */

  /* ── MAIN ── */
  /* 1 · tabs de juego */
  var tabs = document.createElement("div");
  tabs.className = "v47-tabs";
  tabs.innerHTML = '<span class="v47-juego"><i>\u25b8</i>CS2</span><span class="v47-tab">RESUMEN</span>';
  main.appendChild(tabs);

  /* 2 · barra de temporada (resumen; se llena con el historial real) */
  var temp = document.createElement("div");
  temp.className = "v47-temporada";
  temp.id = "v47-temporada";
  temp.innerHTML = '<small>SIN DATOS TODAV\u00cdA \u00b7 CONECT\u00c1 TU FACEIT Y JUG\u00c1 PARA LLENAR ESTE PANEL</small>';
  main.appendChild(temp);

  /* 3 · tarjeta de season (nivel / sin rango + elo) */
  var season = document.createElement("div");
  season.className = "v47-season";
  season.id = "v47-season";
  main.appendChild(season);

  /* 4 · rendimiento reciente = el MISMO bloque de stats (IDs intactos) */
  if (statsSec) {
    var rhead = document.createElement("div");
    rhead.className = "v47-rend-head";
    rhead.innerHTML = "<b>Rendimiento reciente</b><small id=\"v47-rend-sub\">se llena con tus partidas de FACEIT</small>";
    if (bStats) bStats.insertBefore(rhead, bStats.firstChild);
    main.appendChild(statsSec);
  }

  /* 5 · partidos recientes (tabla real o vacío honesto) */
  var cPar = cajaNueva("PARTIDOS RECIENTES", true);
  var par = document.createElement("div");
  par.id = "v47-partidos";
  par.innerHTML = '<p class="v47-vacio">Tu historial de FACEIT aparece ac\u00e1: \u00faltimas partidas con resultado, K/D/A, HS% y mapa.</p>';
  cPar.appendChild(par);
  main.appendChild(cPar);

  /* 6 · destacados (los clips de siempre, ahora en el panel) */
  if (bClips) {
    var eK = bClips.querySelector("span.etiqueta");
    if (eK && eK.firstChild && eK.firstChild.nodeType === 3) eK.firstChild.nodeValue = "DESTACADOS · ";
    main.appendChild(bClips);
  }

  marco.appendChild(side);
  marco.appendChild(main);

  /* ── montaje final (S4.7.2): sin escalera y con la gestión colapsada ── */
  while (vent.firstChild) vent.removeChild(vent.firstChild);
  vent.appendChild(barra);
  vent.appendChild(cab);
  vent.appendChild(marco);
  /* S4.7.4: la barra GESTIÓN DE TU FICHA y su despliegue quedan fuera —
     el perfil termina limpio tras el panel de juego. La grilla de gestión
     sigue montada pero display:none (inaccesible): los nodos y sus IDs
     permanecen en el DOM para auth/estado, sin puerta de entrada. */
  vent.appendChild(grilla);

  /* ── pintado de las piezas nuevas ── */
  function fDeEstado() {
    var e = window.__VANTS_ESTADO__;
    return e && e.cuentas && e.cuentas.faceit ? e.cuentas.faceit : null;
  }

  function pintarDesde() {
    var f = fDeEstado();
    if (f && f.desde) {
      var d = new Date(f.desde);
      if (!isNaN(d.getTime())) {
        desdeEl.textContent = "miembro de FACEIT desde " + d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
        desdeEl.style.display = "block";
        return;
      }
    }
    desdeEl.style.display = "none";
  }

  function pintarSeason(nivel, elo, usuarioFaceit) {
    var s = document.getElementById("v47-season");
    if (!s) return;
    s.innerHTML = "";
    var circ = document.createElement("span");
    circ.className = "v47-season__nivel" + (nivel ? "" : " v47-season__nivel--off");
    circ.textContent = nivel ? String(nivel) : "?";
    var info = document.createElement("div");
    info.className = "v47-season__info";
    var sub = document.createElement("small");
    sub.textContent = "FACEIT · CS2" + (usuarioFaceit ? " · " + usuarioFaceit : "");
    var nom = document.createElement("b");
    nom.textContent = nivel ? "NIVEL " + nivel : "Sin rango";
    info.appendChild(sub);
    info.appendChild(nom);
    s.appendChild(circ);
    s.appendChild(info);
    var st2 = document.createElement("div");
    st2.className = "v47-season__stats";
    if (elo !== null && elo !== undefined) {
      var p1 = document.createElement("p");
      var b1 = document.createElement("b");
      b1.textContent = String(elo);
      var s1 = document.createElement("small");
      s1.textContent = "ELO FACEIT";
      p1.appendChild(b1); p1.appendChild(s1);
      st2.appendChild(p1);
    }
    if (usuarioFaceit) {
      var a = document.createElement("a");
      a.className = "v47-season__link";
      a.href = "https://www.faceit.com/en/players/" + encodeURIComponent(usuarioFaceit);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "estad\u00edsticas \u203a";
      st2.appendChild(a);
    }
    s.appendChild(st2);
  }

  function pintarTemporada(res) {
    var t = document.getElementById("v47-temporada");
    if (!t) return;
    t.innerHTML = "";
    var izq = document.createElement("small");
    izq.textContent = "\u00daLTIMAS PARTIDAS \u00b7 FACEIT CS2";
    t.appendChild(izq);
    var der = document.createElement("div");
    der.className = "v47-things";
    function cifra(v, etq, verde) {
      var b = document.createElement("b");
      b.className = "v47-cifra" + (verde ? " v47-verde" : "");
      b.textContent = v;
      var sm = document.createElement("small");
      sm.textContent = etq;
      der.appendChild(b);
      der.appendChild(sm);
    }
    cifra(String(res.jugadas), "PARTIDAS", false);
    if (res.winrate !== null && res.winrate !== undefined) cifra(res.winrate + "%", "GANADO", true);
    if (res.kd !== null && res.kd !== undefined) cifra(String(res.kd), "K/D MEDIO", false);
    if (res.hs !== null && res.hs !== undefined) cifra(Math.round(res.hs) + "%", "HS MEDIO", false);
    t.appendChild(der);
  }

  function pintarHistorial(jugadas) {
    var h = document.getElementById("v47-hist");
    if (!h) return;
    h.innerHTML = "";
    var fila = document.createElement("div");
    fila.className = "v47-hist-fila";
    var j = document.createElement("span");
    j.className = "v47-hist-juego";
    j.textContent = "CS2";
    var d = document.createElement("div");
    var b = document.createElement("b");
    b.textContent = "Counter-Strike 2";
    var sm = document.createElement("small");
    sm.textContent = jugadas + " partidas · \u00faltimas registradas";
    d.appendChild(b); d.appendChild(sm);
    fila.appendChild(j); fila.appendChild(d);
    h.appendChild(fila);
  }

  function pintarHeatmap(partidas) {
    if (!heat) return;
    var porDia = {};
    (partidas || []).forEach(function (p) {
      if (!p.fecha) return;
      porDia[p.fecha] = (porDia[p.fecha] || 0) + (p.gano ? 2 : 1);
    });
    heat.innerHTML = "";
    var hoy = new Date();
    for (var i = 83; i >= 0; i--) {
      var d = new Date(hoy.getTime() - i * 86400000);
      var iso = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
      var v = porDia[iso] || 0;
      var celda = document.createElement("span");
      if (v === 1) celda.className = "h1";
      else if (v === 2) celda.className = "h2";
      else if (v >= 3) celda.className = "h3";
      heat.appendChild(celda);
    }
  }

  function pintarTabla(partidas) {
    var cont = document.getElementById("v47-partidos");
    if (!cont) return;
    cont.innerHTML = "";
    var t = document.createElement("table");
    t.className = "v47-tabla";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>fecha</th><th>resultado</th><th>k/d/a</th><th>hs %</th><th>mapa</th></tr>";
    var tb = document.createElement("tbody");
    (partidas || []).slice(0, 8).forEach(function (p) {
      var tr = document.createElement("tr");
      var tdF = document.createElement("td");
      tdF.className = "fecha";
      tdF.textContent = p.fecha || "\u2014";
      var tdR = document.createElement("td");
      var wl = document.createElement("span");
      wl.className = "wl";
      var chip = document.createElement("span");
      chip.className = p.gano ? "chipw" : "chipl";
      chip.textContent = p.gano ? "W" : "L";
      var sc = document.createElement("span");
      sc.textContent = p.score || "\u2014";
      wl.appendChild(chip); wl.appendChild(sc);
      tdR.appendChild(wl);
      var tdK = document.createElement("td");
      tdK.className = "mono";
      tdK.textContent = p.kills + " / " + p.muertes + " / " + p.asis;
      var tdH = document.createElement("td");
      tdH.className = "mono";
      tdH.style.color = "#93939d";
      tdH.textContent = (p.hs === null || p.hs === undefined) ? "\u2014" : Math.round(p.hs) + "%";
      var tdM = document.createElement("td");
      tdM.textContent = p.mapa || "\u2014";
      tr.appendChild(tdF); tr.appendChild(tdR); tr.appendChild(tdK); tr.appendChild(tdH); tr.appendChild(tdM);
      tb.appendChild(tr);
    });
    t.appendChild(thead);
    t.appendChild(tb);
    cont.appendChild(t);
    var nota = document.createElement("p");
    nota.className = "v47-nota";
    nota.textContent = "se actualiza solo desde tu cuenta de FACEIT";
    cont.appendChild(nota);
  }

  function llenarRendimiento(res) {
    var sub = document.getElementById("v47-rend-sub");
    if (sub) sub.textContent = "\u00faltimas " + res.jugadas + " partidas de FACEIT";
    function set(id, val) {
      var b = document.getElementById(id);
      if (b) b.textContent = val;
    }
    set("stat-partidos", String(res.jugadas));
    set("stat-winrate", (res.winrate !== null && res.winrate !== undefined) ? res.winrate + "%" : "\u2014");
    set("stat-kd", (res.kd !== null && res.kd !== undefined) ? String(res.kd) : "\u2014");
    var bR = document.getElementById("stat-rating");
    if (bR) {
      bR.textContent = (res.kr !== null && res.kr !== undefined) ? String(res.kr) : "\u2014";
      var sm = bR.parentNode.querySelector("small");
      if (sm) sm.textContent = "K/R MEDIO";
    }
    if (bStats) {
      var grid = bStats.querySelector(".stats-grid");
      if (grid) {
        grid.querySelectorAll(".stat-caja").forEach(function (cajaEl) {
          var sm2 = cajaEl.querySelector("small");
          if (sm2 && /HEADSHOT/i.test(sm2.textContent) && res.hs !== null && res.hs !== undefined) {
            var b2 = cajaEl.querySelector("b");
            if (b2) b2.textContent = Math.round(res.hs) + "%";
            var pr = cajaEl.querySelector(".v46-pronto");
            if (pr) pr.remove();
          }
        });
      }
    }
  }

  function vacioHistoria(msg) {
    var h = document.getElementById("v47-hist");
    if (h) h.innerHTML = '<p class="v47-vacio">' + msg + "</p>";
  }

  function vacioTabla(msg) {
    var cont = document.getElementById("v47-partidos");
    if (cont) cont.innerHTML = '<p class="v47-vacio">' + msg + "</p>";
  }

  function vacioTemporada(msg) {
    var t = document.getElementById("v47-temporada");
    if (t) t.innerHTML = "<small>" + msg + "</small>";
  }

  /* ── carga del historial real ── */
  var cargadoNick = null;
  function cargarHistoria() {
    var f = fDeEstado();
    pintarDesde();
    if (!(f && f.conectada && f.usuario)) {
      pintarSeason(f && f.nivel ? f.nivel : null, null, null);
      vacioHistoria("Conect\u00e1 tu cuenta de FACEIT abajo, en REDES Y CUENTAS: tu nivel, tu historial y tu actividad aparecen ac\u00e1 al instante.");
      vacioTabla("Tu historial de FACEIT aparece ac\u00e1: \u00faltimas partidas con resultado, K/D/A, HS% y mapa.");
      vacioTemporada("SIN DATOS TODAV\u00cdA \u00b7 CONECT\u00c1 TU FACEIT Y JUG\u00c1 PARA LLENAR ESTE PANEL");
      if (heat) heat.innerHTML = "";
      return;
    }
    pintarSeason(f.nivel || null, (f.elo !== null && f.elo !== undefined) ? f.elo : null, f.usuario);
    if (cargadoNick === f.usuario) return;   /* ya cargado (o en curso) para este nick */
    cargadoNick = f.usuario;
    vacioHistoria("Cargando tu historial de FACEIT\u2026");
    /* S4.7.1: con ID de jugador la historia es SIEMPRE de la cuenta correcta */
    var pid47 = f.id && /^[a-f0-9\-]{8,40}$/i.test(String(f.id)) ? String(f.id) : "";
    var urlH = "/api/faceit/historia?" + (pid47 ? "id=" + encodeURIComponent(pid47) + "&" : "") + "nick=" + encodeURIComponent(f.usuario);
    fetch(urlH, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (j) {
        if (j && j.ok && j.resumen && j.partidas) {
          var f2 = fDeEstado() || f;
          pintarSeason(j.resumen.nivel || (f2.nivel || null), (j.resumen.elo !== null && j.resumen.elo !== undefined) ? j.resumen.elo : ((f2.elo !== null && f2.elo !== undefined) ? f2.elo : null), f2.usuario || f.usuario);
          pintarTemporada(j.resumen);
          pintarHistorial(j.resumen.jugadas);
          llenarRendimiento(j.resumen);
          pintarTabla(j.partidas);
          pintarHeatmap(j.partidas);
        } else {
          var motivo = j && j.motivo;
          var msg = motivo === "no_encontrado" ? "FACEIT no encontr\u00f3 ese nick en su API. Desconect\u00e1 y reconect\u00e1 tu cuenta con el nick exacto."
            : motivo === "faceit_key" ? "FACEIT rechaz\u00f3 la clave del servidor. Avis\u00e1 en el Discord de VANTS para revisarla."
            : motivo === "sin_api_key" ? "El servidor todav\u00eda no tiene clave de FACEIT configurada: el historial se activa en cuanto se configure."
            : motivo === "sin_partidas" ? "No hay partidas registradas en tu historial de FACEIT (CS2)."
            : "FACEIT no respondi\u00f3. Recarg\u00e1 la p\u00e1gina en un rato.";
          pintarSeason((f.nivel || null), (f.elo !== null && f.elo !== undefined) ? f.elo : null, f.usuario);
          vacioHistoria(msg);
          vacioTabla(msg);
          vacioTemporada("SIN DATOS DE FACEIT POR AHORA");
          if (heat) heat.innerHTML = "";
        }
      })
      .catch(function () {
        vacioHistoria("FACEIT no respondi\u00f3. Recarg\u00e1 la p\u00e1gina en un rato.");
        vacioTabla("FACEIT no respondi\u00f3. Recarg\u00e1 la p\u00e1gina en un rato.");
      });
  }

  /* si la cuenta FACEIT conecta o cambia mientras la página está abierta,
     el panel se refresca solo (mismo observador del S4.4) */
  var faceitReal47 = document.getElementById("faceit-real");
  if (faceitReal47 && window.MutationObserver) {
    new MutationObserver(function () {
      var f = fDeEstado();
      var nick = f && f.conectada && f.usuario;
      if (nick && nick !== cargadoNick) cargarHistoria();
      else pintarDesde();
    }).observe(faceitReal47, { attributes: true });
  }

  pintarDesde();
  pintarSeason(fDeEstado() && fDeEstado().nivel ? fDeEstado().nivel : null, null, null);
  cargarHistoria();
})();
