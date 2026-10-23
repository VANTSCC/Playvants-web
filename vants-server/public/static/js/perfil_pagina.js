/* VANTS GAMES — página de perfil: foto (avatar), equipo, banner, cuentas
   CONECTADAS DE VERDAD (con verificación de FACEIT contra su API pública),
   nombre de la cuenta editable (Auth0), datos, rango con las 9 insignias y
   cuenta. La sesión viene de Auth0 (vants-auth.js). Sin datos inventados. */
(function () {
  "use strict";

  var api = window.VantsPerfil;
  if (!api) return;

  var estado = api.leer();

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
          api.toast("ESE NICK NO EXISTE EN FACEIT · REVISÁ LAS MAYÚSCULAS", true);
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
    api.guardar(estado);

    var haySesion = estado.sesion && window.VantAuth0;
    if (nick && !haySesion) {
      api.toast("PAÍS Y REGIÓN GUARDADOS · ENTRÁ CON TU CUENTA PARA CAMBIAR EL NOMBRE", true);
      return;
    }
    if (!haySesion) { api.toast("MIS DATOS GUARDADOS"); return; }
    window.VantAuth0.getToken().then(function (tok) {
      if (!tok) { api.toast("NO SE PUDO VALIDAR LA SESIÓN · PROBÁ DE NUEVO", true); return; }
      var cuerpo = { redes: estado.cuentas };
      if (nick) cuerpo.nickname = nick;
      fetch("/api/account/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify(cuerpo)
      })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: "servidor" }; }); })
        .then(function (j) {
          if (j && j.ok) {
            estado.nick = nick || estado.nick;
            api.guardar(estado);
            if (nick) pintarNick(nick);
            if (j.redes) { estado.cuentas = Object.assign({}, estado.cuentas, j.redes); api.guardar(estado); }
            api.toast(nick ? "GUARDADO · TU NOMBRE DE CUENTA AHORA ES " + nick.toUpperCase() : "MIS DATOS GUARDADOS");
          } else if (j && j.error === "nick_invalido") {
            api.toast("ESE NOMBRE NO ES VÁLIDO · " + (j.detalle || "3-20 caracteres"), true);
          } else {
            api.toast("EL SERVIDOR NO DEJÓ GUARDAR EL NOMBRE · PROBÁ EN UN RATO", true);
          }
        })
        .catch(function () { api.toast("SIN CONEXIÓN CON EL SERVIDOR · PROBÁ DE NUEVO", true); });
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
