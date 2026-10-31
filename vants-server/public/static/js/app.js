/* VANTS GAMES — interacción base: splash, submenús, menú móvil */
(function () {
  "use strict";

  /* ── Splash — intro tipo brand film ── */
  var splash = document.getElementById("splash");
  if (splash) {
    if (sessionStorage.getItem("vants_splash")) {
      splash.classList.add("splash--oculto");
    } else {
      document.body.style.overflow = "hidden";
      var lienzo = splash.querySelector(".splash__estrellas");
      var raf = 0, estrellas = [];
      var reduceMov = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      function pararEstrellas() { if (raf) cancelAnimationFrame(raf); raf = 0; }

      var entrar = function () {
        if (splash.classList.contains("splash--oculto")) return;
        splash.classList.add("splash--oculto");
        document.body.style.overflow = "";
        sessionStorage.setItem("vants_splash", "1");
        pararEstrellas();
      };

      var btnEntrar = splash.querySelector("[data-splash-entrar]");
      var btnSaltar = splash.querySelector(".splash__saltar");
      if (btnEntrar) btnEntrar.addEventListener("click", entrar);
      if (btnSaltar) btnSaltar.addEventListener("click", entrar);
      splash.addEventListener("click", function (e) {
        // un clic en cualquier parte entra, salvo sobre el enlace a NUESTRA HISTORIA
        if (!e.target.closest("a")) entrar();
      });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") entrar(); });

      /* campo de estrellas ligero (se detiene al entrar a la arena) */
      function preparar() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        lienzo.width = splash.clientWidth * dpr;
        lienzo.height = splash.clientHeight * dpr;
        lienzo.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
        estrellas = [];
        var n = Math.round(splash.clientWidth * splash.clientHeight / 9000);
        for (var i = 0; i < n; i++) {
          estrellas.push({
            x: Math.random() * splash.clientWidth,
            y: Math.random() * splash.clientHeight,
            r: Math.random() * 1.3 + .3,
            a: Math.random() * .5 + .15,
            v: Math.random() * .06 + .015,
            f: Math.random() * 6.2832
          });
        }
      }
      function pintar(t) {
        if (splash.classList.contains("splash--oculto")) { raf = 0; return; }
        var c = lienzo.getContext("2d");
        c.clearRect(0, 0, splash.clientWidth, splash.clientHeight);
        for (var i = 0; i < estrellas.length; i++) {
          var s = estrellas[i];
          if (!reduceMov) { s.y += s.v; if (s.y > splash.clientHeight) { s.y = -2; s.x = Math.random() * splash.clientWidth; } }
          c.globalAlpha = Math.max(.04, reduceMov ? s.a : s.a * (.6 + .4 * Math.sin(t / 900 + s.f)));
          c.fillStyle = "#fff";
          c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.2832); c.fill();
        }
        c.globalAlpha = 1;
        raf = requestAnimationFrame(pintar);
      }
      if (lienzo) {
        preparar();
        window.addEventListener("resize", function () {
          if (!splash.classList.contains("splash--oculto")) preparar();
        });
        raf = requestAnimationFrame(pintar);
      }
    }
  }

  /* ── Submenús de escritorio ── */
  var grupos = Array.prototype.slice.call(document.querySelectorAll(".nav-grupo"));
  var esDesktop = window.matchMedia("(min-width: 1081px)");

  function cerrarGrupos(excepto) {
    grupos.forEach(function (g) {
      if (g !== excepto) {
        g.classList.remove("nav-grupo--abierto");
        var b = g.querySelector(".nav-link--btn");
        if (b) b.setAttribute("aria-expanded", "false");
      }
    });
  }

  grupos.forEach(function (g) {
    var btn = g.querySelector(".nav-link--btn");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var abierto = g.classList.contains("nav-grupo--abierto");
      cerrarGrupos(g);
      g.classList.toggle("nav-grupo--abierto", !abierto);
      btn.setAttribute("aria-expanded", String(!abierto));
    });
    g.addEventListener("mouseenter", function () {
      if (esDesktop.matches) { cerrarGrupos(g); g.classList.add("nav-grupo--abierto"); }
    });
    g.addEventListener("mouseleave", function () {
      if (esDesktop.matches) { g.classList.remove("nav-grupo--abierto"); btn.setAttribute("aria-expanded", "false"); }
    });
  });

  document.addEventListener("click", function () { cerrarGrupos(null); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarGrupos(null); });

  /* ── Menú móvil ── */
  var burger = document.getElementById("burger");
  var mega = document.getElementById("mega");
  if (burger && mega) {
    burger.addEventListener("click", function () {
      var abierto = mega.hasAttribute("hidden");
      if (abierto) mega.removeAttribute("hidden");
      else mega.setAttribute("hidden", "");
      burger.setAttribute("aria-expanded", String(abierto));
      document.body.style.overflow = abierto ? "hidden" : "";
    });
    mega.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        mega.setAttribute("hidden", "");
        document.body.style.overflow = "";
      }
    });
  }

  /* ── Año del pie ── */
  var anio = document.getElementById("anio");
  if (anio) anio.textContent = String(new Date().getFullYear());
})();
