/* VANTS GAMES — página de perfil: foto (avatar), equipo, banner, cuentas,
   datos y cuenta. La sesión viene de Auth0 (vants-auth.js): sin sesión la
   ficha queda en "sin sesión", nunca con datos inventados. */
(function () {
  "use strict";

  var api = window.VantsPerfil;
  if (!api) return;

  var estado = api.leer();

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

  /* ── CUENTAS CONECTADAS ── */
  var coloresBtn = { twitch: "btn--borde-rojo", youtube: "btn--rojo", riot: "btn--borde-rojo" };

  function pintarCuentas() {
    document.querySelectorAll(".cuenta-fila").forEach(function (fila) {
      var clave = fila.getAttribute("data-cuenta");
      var cta = estado.cuentas[clave];
      var zona = fila.querySelector(".cuenta-fila__accion");
      var estadoTxt = fila.querySelector(".cuenta-estado");
      var usuarioTxt = fila.querySelector(".cuenta-usuario");
      zona.innerHTML = "";
      if (cta.conectada) {
        if (usuarioTxt) usuarioTxt.textContent = cta.usuario;
        if (estadoTxt) estadoTxt.textContent = "";
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
          cta.conectada = false;
          cta.usuario = "";
          api.guardar(estado);
          pintarCuentas();
          api.toast("CUENTA DESCONECTADA");
        });
        zona.appendChild(x);
      } else {
        if (usuarioTxt) usuarioTxt.textContent = "";
        if (estadoTxt) estadoTxt.textContent = "NO CONECTADA";
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn--fino " + (coloresBtn[clave] || "");
        b.textContent = "CONECTAR";
        b.addEventListener("click", function () {
          cta.conectada = true;
          cta.usuario = (estado.discord || estado.nick || "jugador").toLowerCase();
          api.guardar(estado);
          pintarCuentas();
          api.toast("CUENTA CONECTADA · " + cta.usuario.toUpperCase());
        });
        zona.appendChild(b);
      }
    });
  }

  /* ── MIS DATOS ── */
  document.getElementById("guardar-datos").addEventListener("click", function () {
    var pais = document.getElementById("dato-pais").value.trim();
    var region = document.getElementById("dato-region").value.trim();
    var discord = document.getElementById("dato-discord").value.trim();
    if (!pais || !region) { api.toast("PAÍS Y REGIÓN SON OBLIGATORIOS", true); return; }
    estado.pais = pais;
    estado.region = region;
    estado.discord = discord;
    if (estado.cuentas.discord.conectada) estado.cuentas.discord.usuario = discord;
    document.getElementById("sub-pais").textContent = pais;
    document.getElementById("sub-region").textContent = region;
    if (api.guardar(estado)) { pintarCuentas(); api.toast("MIS DATOS GUARDADOS"); }
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

  /* ── CUENTA: sesión real (Auth0) ── */
  function pintarSesion() {
    var lineas = document.getElementById("cuenta-lineas");
    var btnSalir = document.getElementById("btn-salir");
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
    if (!lineas) return;
    if (!s) {
      lineas.innerHTML = "<p>Sin sesión: entrá con tu cuenta para editar tu ficha y publicar clips.</p>" +
        '<button class="btn btn--rojo" type="button" id="btn-perfil-entrar">ENTRAR CON MI CUENTA</button>';
      var bpe = document.getElementById("btn-perfil-entrar");
      if (bpe) bpe.addEventListener("click", function () {
        if (window.VantAuth0) window.VantAuth0.entrar();
        else api.toast("NO SE PUDO ABRIR EL LOGIN · RECARGA LA PÁGINA", true);
      });
      if (btnSalir) btnSalir.hidden = true;
      return;
    }
    lineas.innerHTML =
      "<p>Correo: <b>" + (s.correo || "—") + "</b></p>" +
      "<p>Verificado: <b class=\"si\">" + (s.verificado ? "SÍ" : "NO") + "</b></p>" +
      "<p>Cuenta VANTS: <b>" + String(s.nick || "jugador") + "</b></p>";
    if (btnSalir) btnSalir.hidden = false;
  }

  document.getElementById("btn-salir").addEventListener("click", function () {
    try { localStorage.removeItem("vants_perfil_v1"); } catch (_e) { /* noop */ }
    if (window.VantAuth0) { window.VantAuth0.salir(); return; }
    api.toast("FICHA REINICIADA");
    setTimeout(function () { location.reload(); }, 900);
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
  pintarEstado();
  pintarSesion();
  api.aplicarIdentidad(estado);
  api.pintarAvatar(estado);
  api.renderClipsPerfil(estado);

  /* sesión Auth0: rellena nick, correo y clips reales */
  if (window.VantAuth0) {
    window.VantAuth0.listo().then(function (u) {
      if (u) {
        estado.sesion = { sub: u.sub, nick: u.nick, correo: u.correo, verificado: u.verificado };
        api.guardar(estado);
        document.getElementById("nick-jugador").textContent = String(u.nick || "JUGADOR").toUpperCase();
        document.getElementById("sub-handle").textContent = "@" + String(u.nick || "jugador").toLowerCase().replace(/[^a-z0-9_\-.]/g, "");
        api.pintarAvatar(estado);
      } else {
        estado.sesion = null;
        api.guardar(estado);
      }
      pintarSesion();
      api.renderClipsPerfil(estado);
    });
  }
})();
