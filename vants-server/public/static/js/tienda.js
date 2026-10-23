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

      /* Insignias REALES de la sesión: solo "verificado" existe hoy. Las
         membresías (pro/owner/creator/socio) llegarán con los planes pagos. */
      var insignias = [];
      if (estado.sesion && estado.sesion.verificado) insignias.push("verificado");
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
