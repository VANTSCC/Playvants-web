/* VANTS GAMES — sesión Auth0 para la web nueva (S4).
   Misma identidad que la web antigua: vants.eu.auth0.com + app "VANTS movil".
   Expone window.VantAuth0:
     · listo()  → Promise que resuelve cuando la sesión está evaluada
     · usuario()→ { sub, nick, correo, verificado, picture } | null
     · getToken() → JWT (audience api.vants.app) o null
     · entrar() / salir()
   Requiere: <script src="https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js">
   cargado ANTES de este archivo. */
(function (window) {
  "use strict";

  var DOMINIO = "vants.eu.auth0.com";
  var CLIENTE = "oaOmNizh7HrASWfmfM29bN284IMJvqPG";
  var AUDIENCIA = "https://api.vants.app";

  var cliente = null;
  var usuario = null;
  var resuelto = null;

  function listo() {
    if (!resuelto) {
      resuelto = arrancar().catch(function (e) {
        usuario = null;
        return null;
      });
    }
    return resuelto;
  }

  async function arrancar() {
    if (!window.auth0) return null; // CDN caído: la web sigue sin sesión
    cliente = await window.auth0.createAuth0Client({
      domain: DOMINIO,
      clientId: CLIENTE,
      authorizationParams: {
        redirect_uri: window.location.origin + "/",
        audience: AUDIENCIA,
        scope: "openid profile email",
      },
      cacheLocation: "localstorage",
      useRefreshTokens: true,
    });

    /* ¿vuelve del login (?code=...&state=...)? cierra el flujo una sola vez */
    if (window.location.search.indexOf("code=") !== -1 && window.location.search.indexOf("state=") !== -1) {
      try {
        await cliente.handleRedirectCallback();
        window.history.replaceState({}, "", window.location.origin + window.location.pathname);
      } catch (_e) { /* ya manejado u origen distinto: seguir */ }
    }

    if (await cliente.isAuthenticated()) {
      var u = await cliente.getUser();
      usuario = {
        sub: u.sub,
        nick: u.nickname || u.name || u.preferred_username || "JUGADOR",
        correo: u.email || "",
        verificado: !!u.email_verified,
        picture: u.picture || null,
      };
    } else {
      usuario = null;
    }
    pintarNav();
    return usuario;
  }

  async function getToken() {
    if (!cliente || !usuario) return null;
    try {
      return await cliente.getTokenSilently({ authorizationParams: { audience: AUDIENCIA } });
    } catch (_e) {
      return null;
    }
  }

  function entrar() {
    if (!cliente) return;
    cliente.loginWithRedirect({
      authorizationParams: { redirect_uri: window.location.origin + "/", audience: AUDIENCIA, scope: "openid profile email" },
    });
  }

  function salir() {
    try {
      window.location.href = "https://" + DOMINIO + "/v2/logout?client_id=" + CLIENTE +
        "&returnTo=" + encodeURIComponent(window.location.origin + "/");
    } catch (_e) { window.location.href = "/"; }
  }

  /* El botón ENTRAR de la cabecera y del menú móvil muestran el nick con sesión */
  function pintarNav() {
    var txt = usuario ? usuario.nick.toUpperCase().slice(0, 14) : "ENTRAR";
    document.querySelectorAll(".nav-entrar, .mega__entrar").forEach(function (a) {
      a.textContent = txt;
    });
  }

  window.VantAuth0 = {
    listo: listo,
    usuario: function () { return usuario; },
    getToken: getToken,
    entrar: entrar,
    salir: salir,
  };
})(window);
