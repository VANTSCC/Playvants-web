/* VANTS GAMES — tienda de identidad: equipar marcos, tarjetas y sellos */
(function () {
  "use strict";

  var api = window.VantsPerfil;
  if (!api) return;

  var estado = api.leer();

  var items = document.querySelectorAll(".item-tienda[data-tipo]");
  items.forEach(function (item) {
    var btn = item.querySelector(".btn__equipar");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var tipo = item.getAttribute("data-tipo");
      var id = item.getAttribute("data-id");
      var nombre = item.getAttribute("data-nombre");
      var tier = item.getAttribute("data-tier");

      /* El dueño de la ficha es OWNER + PRO + CREATOR + SOCIO: todo desbloqueado.
         Si algún día cambian las insignias, este check lo controla. */
      var insignias = (window.__PERFIL_SEMILLA__ && window.__PERFIL_SEMILLA__.badges) || [];
      var necesita = { gratis: null, pro: "pro", owner: "owner", creator: "creator", socio: "socio" }[tier];
      if (necesita && insignias.indexOf(necesita) === -1) {
        api.toast("NECESITAS LA MEMBRESÍA " + tier.toUpperCase(), true);
        return;
      }

      var ya = estado.identidad[tipo] === id;
      estado.identidad[tipo] = ya ? (tipo === "sello" ? "v" : (tipo === "tarjeta" ? "carbon" : "clasico")) : id;
      if (!api.guardar(estado)) return;
      api.aplicarIdentidad(estado);
      api.toast(ya ? "QUITADO · " + nombre : "EQUIPADO · " + nombre + " SE APLICÓ A TU PERFIL");
    });
  });

  api.aplicarIdentidad(estado);
})();
