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
            usuario: j.usuario.nickname,
            url: "https://www.faceit.com/en/players/" + encodeURIComponent(j.usuario.nickname),
            nivel: j.usuario.nivel,
            pais: j.usuario.pais,
            region: j.usuario.region,
            avatar: j.usuario.avatar,
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
  function pintarEscalera() {
    var cont = document.getElementById("rango-escalera");
    if (!cont) return;
    cont.innerHTML = "";
    RANGOS.forEach(function (r, i) {
      var paso = document.createElement("div");
      paso.className = "rango-escalera__paso" + (i === RANGOS.length - 1 ? " rango-escalera__paso--fin" : "");
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

  /* acciones: COMPARTIR PERFIL (nuevo) + EDITAR FICHA (el botón que ya existía) */
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
  var btnEditar = identidad.querySelector(".perfil__nombre h2 button");
  if (!btnEditar) {
    btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn btn--fino";
    btnEditar.addEventListener("click", function () {
      var d = document.getElementById("mis-datos");
      if (d) d.scrollIntoView({ behavior: "smooth" });
    });
  }
  btnEditar.textContent = "EDITAR FICHA ↓";
  acc.appendChild(comp);
  acc.appendChild(btnEditar);

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
