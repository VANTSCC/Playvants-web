/* VANTS GAMES — clips: marcar destacados (máximo 3, se ven en el perfil) */
(function () {
  "use strict";

  var api = window.VantsPerfil;
  if (!api) return;

  var estado = api.leer();
  var MAX = 3;

  function refrescar() {
    document.querySelectorAll(".clip[data-clip]").forEach(function (art) {
      var id = art.getAttribute("data-clip");
      var destacado = estado.clips.indexOf(id) !== -1;
      var cinta = art.querySelector(".cinta-destacado");
      var btn = art.querySelector(".clip__destacar");
      art.classList.toggle("clip--destacado", destacado);
      if (cinta) cinta.hidden = !destacado;
      if (btn) {
        btn.classList.toggle("clip__destacar--activo", destacado);
        btn.textContent = destacado ? "★ DESTACADO" : "★ DESTACAR";
      }
    });
  }

  document.querySelectorAll(".clip__destacar").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-id");
      var pos = estado.clips.indexOf(id);
      if (pos !== -1) {
        estado.clips.splice(pos, 1);
        api.guardar(estado);
        api.toast("QUITADO DE DESTACADOS");
      } else {
        if (estado.clips.length >= MAX) {
          api.toast("MÁXIMO " + MAX + " CLIPS DESTACADOS · QUITA UNO PRIMERO", true);
          return;
        }
        estado.clips.push(id);
        api.guardar(estado);
        api.toast("DESTACADO · APARECE EN TU PERFIL");
      }
      refrescar();
    });
  });

  refrescar();
})();
