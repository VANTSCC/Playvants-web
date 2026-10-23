/* VANTS GAMES — estado del perfil + identidad (marco, tarjeta, sello) */
/* El perfil vive en el navegador (localStorage). Nada de datos falsos
   en el servidor: lo que ves guardado es tuyo. */
(function (window) {
  "use strict";

  var CLAVE = "vants_perfil_v1";

  function defecto() {
    return {
      nick: "FEISPLA",
      pais: "Venezuela",
      region: "LATAM",
      discord: "feistv",
      equipo: { nombre: "VANTS", tag: "VTS", foto: null },
      banner: { tipo: "clasico", foto: null },
      cuentas: {
        discord: { conectada: true, usuario: "feistv" },
        twitch: { conectada: false, usuario: "" },
        youtube: { conectada: false, usuario: "" },
        riot: { conectada: false, usuario: "" },
        faceit: { conectada: true, usuario: "feiss" }
      },
      estado: "jugando",
      identidad: { marco: "clasico", tarjeta: "carbon", sello: "v" },
      clips: ["c1", "c2", "c3"]
    };
  }

  function leer() {
    var base = defecto();
    try {
      var guardado = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (!guardado || typeof guardado !== "object") return base;
      Object.keys(guardado).forEach(function (k) { base[k] = guardado[k]; });
      return base;
    } catch (_e) {
      return base;
    }
  }

  function guardar(estado) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
      return true;
    } catch (_e) {
      toast("EL NAVEGADOR NO PUDO GUARDAR · POCO ESPACIO", true);
      return false;
    }
  }

  var toastTimer = null;
  function toast(mensaje, error) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = mensaje;
    el.classList.toggle("toast--error", !!error);
    el.classList.add("toast--visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("toast--visible"); }, 2400);
  }

  /* ── Identidad: marco, tarjeta y sello ── */
  var CLASES_MARCO = ["marco--clasico", "marco--dorado", "marco--neon", "marco--fuego", "marco--octagon", "marco--socio"];
  var CLASES_TARJETA = ["tarjeta--carbon", "tarjeta--rojo", "tarjeta--oro", "tarjeta--owner"];
  var SELLOS = {
    v:        { color: "var(--rojo)",   borde: "var(--borde-2)" },
    vpro:     { color: "var(--rojo)",   borde: "rgba(255,13,46,.6)" },
    vcreator: { color: "var(--violeta)", borde: "rgba(168,85,247,.6)" },
    vowner:   { color: "var(--dorado)", borde: "rgba(212,175,55,.65)" }
  };

  function aplicarIdentidad(estado) {
    var avatar = document.getElementById("avatar-jugador");
    if (avatar) {
      CLASES_MARCO.forEach(function (c) { avatar.classList.remove(c); });
      avatar.classList.add("marco--" + estado.identidad.marco);
    }
    var ventana = document.getElementById("ventana-perfil");
    if (ventana) {
      CLASES_TARJETA.forEach(function (c) { ventana.classList.remove(c); });
      ventana.classList.add("tarjeta--" + estado.identidad.tarjeta);
    }
    var sello = document.getElementById("sello-jugador");
    if (sello) {
      var info = SELLOS[estado.identidad.sello] || SELLOS.v;
      sello.style.color = info.color;
      sello.style.borderColor = info.borde;
    }
    marcarEquipados(estado);
  }

  function marcarEquipados(estado) {
    var items = document.querySelectorAll(".item-tienda[data-tipo]");
    items.forEach(function (item) {
      var tipo = item.getAttribute("data-tipo");
      var id = item.getAttribute("data-id");
      var btn = item.querySelector(".btn__equipar");
      if (!btn) return;
      var equipado = estado.identidad[tipo] === id;
      btn.classList.toggle("btn--equipado", equipado);
      btn.textContent = equipado ? "✓ EQUIPADO" : "EQUIPAR";
    });
  }

  /* ── Clips destacados del perfil ── */
  function clipsSemilla() {
    return (window.__CLIPS_SEMILLA__ || []).slice();
  }

  function renderClipsPerfil(estado) {
    var cont = document.getElementById("clips-perfil");
    if (!cont) return;
    var galeria = clipsSemilla();
    cont.innerHTML = "";
    var contador = document.getElementById("cuenta-clips");
    var destacados = estado.clips.filter(function (id) {
      return galeria.some(function (c) { return c.id === id; });
    }).slice(0, 3);
    destacados.forEach(function (id) {
      var c = galeria.find(function (x) { return x.id === id; });
      if (!c) return;
      var art = document.createElement("article");
      art.className = "mini-clip";
      var img = document.createElement("div");
      img.className = "mini-clip__img tema-" + c.tema;
      var play = document.createElement("div");
      play.className = "mini-clip__play";
      var dur = document.createElement("span");
      dur.className = "mini-clip__dur";
      dur.textContent = c.duracion;
      img.appendChild(play);
      img.appendChild(dur);
      var cuerpo = document.createElement("div");
      cuerpo.className = "mini-clip__cuerpo";
      var t = document.createElement("b");
      t.textContent = c.titulo;
      var meta = document.createElement("div");
      meta.className = "mini-clip__meta";
      var autor = document.createElement("b");
      autor.textContent = c.autor;
      var juego = document.createElement("span");
      juego.className = "mini-clip__juego";
      juego.textContent = c.juego;
      var peso = document.createElement("span");
      peso.textContent = c.peso;
      meta.appendChild(autor);
      meta.appendChild(juego);
      meta.appendChild(peso);
      var fecha = document.createElement("div");
      fecha.className = "mini-clip__fecha";
      fecha.textContent = c.fecha;
      cuerpo.appendChild(t);
      cuerpo.appendChild(meta);
      cuerpo.appendChild(fecha);
      art.appendChild(img);
      art.appendChild(cuerpo);
      cont.appendChild(art);
    });
    if (contador) contador.textContent = String(destacados.length);
  }

  /* ── Imagen a dataURL con redimensionado (para no llenar localStorage) ── */
  function imagenADataURL(archivo, max, cb) {
    var lector = new FileReader();
    lector.onload = function () {
      var img = new Image();
      img.onload = function () {
        var escala = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        cb(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(archivo);
  }

  window.VantsPerfil = {
    leer: leer,
    guardar: guardar,
    toast: toast,
    defecto: defecto,
    aplicarIdentidad: aplicarIdentidad,
    renderClipsPerfil: renderClipsPerfil,
    imagenADataURL: imagenADataURL
  };
})(window);
