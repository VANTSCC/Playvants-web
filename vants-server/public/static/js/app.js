/* VANTS GAMES — interacción base: splash, submenús, menú móvil */
(function () {
  "use strict";

  /* ── Splash ── */
  var splash = document.getElementById("splash");
  if (splash) {
    if (sessionStorage.getItem("vants_splash")) {
      splash.classList.add("splash--oculto");
    } else {
      document.body.style.overflow = "hidden";
      var entrar = function () {
        splash.classList.add("splash--oculto");
        document.body.style.overflow = "";
        sessionStorage.setItem("vants_splash", "1");
      };
      splash.addEventListener("click", entrar);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") entrar(); });
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
