/* VANTS GAMES — estado del perfil + identidad (marco, tarjeta, sello) */
/* La ficha vive en el navegador (localStorage) y la sesión en Auth0.
   Sin datos falsos: si no hay sesión, la ficha muestra "sin sesión". */
(function (window) {
  "use strict";

  var CLAVE = "vants_perfil_v1";

  function defecto() {
    return {
      nick: "",
      pais: "",
      region: "",
      discord: "",
      foto: null,            /* avatar del jugador (dataURL cuadrado, editado en el logo) */
      equipo: { nombre: "", tag: "", foto: null },
      banner: { tipo: "clasico", foto: null },
      cuentas: {
        discord: { conectada: false, usuario: "" },
        twitch: { conectada: false, usuario: "" },
        youtube: { conectada: false, usuario: "" },
        riot: { conectada: false, usuario: "" },
        faceit: { conectada: false, usuario: "" }
      },
      estado: "en-linea",
      identidad: { marco: "clasico", tarjeta: "carbon", sello: "v" },
      sesion: null,          /* { sub, nick, correo, verificado } — la pone vants-auth */
      clips: []
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

  /* ── Avatar del jugador: iniciales o foto editada desde el escritorio ── */
  function pintarAvatar(estado) {
    var foto = document.getElementById("avatar-foto");
    var iniciales = document.getElementById("avatar-iniciales");
    if (!foto || !iniciales) return;
    if (estado.foto) {
      foto.src = estado.foto;
      foto.removeAttribute("hidden");
      iniciales.style.display = "none";
    } else {
      foto.removeAttribute("src");
      foto.setAttribute("hidden", "");
      iniciales.style.display = "";
      iniciales.textContent = (estado.nick || "J").trim().charAt(0).toUpperCase() || "·";
    }
  }

  /* ── Clips destacados del perfil: los REALES publicados por tu cuenta ── */
  function renderClipsPerfil(estado) {
    var cont = document.getElementById("clips-perfil");
    if (!cont) return;
    var contador = document.getElementById("cuenta-clips");
    var sub = estado.sesion && estado.sesion.sub;
    cont.innerHTML = '<p class="perfil__nota-nuevo">Cargando tus clips…</p>';
    fetch("/api/clips/featured", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var clips = (j && j.ok && Array.isArray(j.clips)) ? j.clips : [];
        var mias = sub ? clips.filter(function (c) { return c && c.sub === sub; }).slice(0, 3) : [];
        cont.innerHTML = "";
        if (!mias.length) {
          cont.innerHTML = '<p class="perfil__nota-nuevo">' + (sub
            ? "Todavía no publicaste clips: en CLIPS tenés «SUBIR CLIP DESDE EL ESCRITORIO»."
            : "Entrá con tu cuenta: los clips que publiques aparecen acá.") + "</p>";
        } else {
          mias.forEach(function (c) {
            var art = document.createElement("article");
            art.className = "mini-clip mini-clip--real";
            var mini = document.createElement("div");
            mini.className = "mini-clip__img mini-clip__img--foto";
            if (c.thumb) {
              var img = document.createElement("img");
              img.src = c.thumb; img.alt = ""; img.loading = "lazy";
              mini.appendChild(img);
            }
            var play = document.createElement("div");
            play.className = "mini-clip__play";
            mini.appendChild(play);
            if (c.dur) {
              var dur = document.createElement("span");
              dur.className = "mini-clip__dur";
              dur.textContent = Math.floor(c.dur / 60) + ":" + ((c.dur % 60) < 10 ? "0" : "") + (c.dur % 60);
              mini.appendChild(dur);
            }
            var cuerpo = document.createElement("div");
            cuerpo.className = "mini-clip__cuerpo";
            var t = document.createElement("b");
            t.textContent = c.titulo || "Clip destacado";
            var meta = document.createElement("div");
            meta.className = "mini-clip__meta";
            var juego = document.createElement("span");
            juego.className = "mini-clip__juego";
            juego.textContent = c.juego || "VALORANT";
            meta.appendChild(juego);
            if (c.tam) {
              var peso = document.createElement("span");
              peso.textContent = (c.tam / 1048576).toFixed(1) + " MB";
              meta.appendChild(peso);
            }
            var fecha = document.createElement("div");
            fecha.className = "mini-clip__fecha";
            try { fecha.textContent = new Date(c.fecha).toLocaleDateString("es"); } catch (_e) {}
            cuerpo.appendChild(t);
            cuerpo.appendChild(meta);
            cuerpo.appendChild(fecha);
            art.appendChild(mini);
            art.appendChild(cuerpo);
            art.style.cursor = "pointer";
            art.title = "Abrir el clip";
            art.addEventListener("click", function () {
              if (c.video) window.open(c.video, "_blank", "noopener");
            });
            cont.appendChild(art);
          });
        }
        if (contador) contador.textContent = String(mias.length);
      })
      .catch(function () {
        cont.innerHTML = '<p class="perfil__nota-nuevo">La vitrina no respondió: probá de nuevo en un rato.</p>';
      });
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

  /* Cuadrada centrada (avatar del jugador): recorta el centro y redimensiona */
  function imagenCuadradaADataURL(archivo, max, cb) {
    var lector = new FileReader();
    lector.onload = function () {
      var img = new Image();
      img.onload = function () {
        var lado = Math.min(img.width, img.height);
        var canvas = document.createElement("canvas");
        canvas.width = max; canvas.height = max;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, max, max);
        cb(canvas.toDataURL("image/jpeg", 0.85));
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
    pintarAvatar: pintarAvatar,
    renderClipsPerfil: renderClipsPerfil,
    imagenADataURL: imagenADataURL,
    imagenCuadradaADataURL: imagenCuadradaADataURL
  };
})(window);
