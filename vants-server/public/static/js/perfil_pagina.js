/* VANTS GAMES — página de perfil: equipo, banner, cuentas, datos, estado */
(function () {
  "use strict";

  var api = window.VantsPerfil;
  if (!api) return;

  var estado = api.leer();

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

  /* ── CUENTA ── */
  document.getElementById("btn-ajustes").addEventListener("click", function () {
    api.toast("AJUSTES DE CUENTA PRONTO · MIENTRAS, EDITA TUS DATOS ARRIBA", true);
  });
  document.getElementById("btn-salir").addEventListener("click", function () {
    try { localStorage.removeItem("vants_perfil_v1"); } catch (_e) { /* noop */ }
    api.toast("SESIÓN LOCAL CERRADA · TU FICHA VUELVE AL ESTADO INICIAL");
    setTimeout(function () { location.reload(); }, 900);
  });

  /* ── arranque ── */
  document.getElementById("equipo-nombre").value = estado.equipo.nombre;
  document.getElementById("equipo-tag").value = estado.equipo.tag;
  document.getElementById("dato-pais").value = estado.pais;
  document.getElementById("dato-region").value = estado.region;
  document.getElementById("dato-discord").value = estado.discord;
  if (estado.equipo.foto) imgFoto.src = estado.equipo.foto;
  if (estado.banner.tipo === "foto") {
    document.getElementById("btn-banner-foto").classList.add("chip-sel--activo");
    chipsBanner.forEach(function (c) { c.classList.remove("chip-sel--activo"); });
  }
  pintarBanner();
  pintarCuentas();
  pintarEstado();
  api.aplicarIdentidad(estado);
  api.renderClipsPerfil(estado);
})();
