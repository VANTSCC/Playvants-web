/* VANTS GAMES — sesión Auth0 para la web nueva (S4).
   Misma identidad que la web antigua: vants.eu.auth0.com + app "VANTS movil".
   Expone window.VantAuth0:
     · listo()  → Promise que resuelve cuando la sesión está evaluada
     · usuario()→ { sub, nick, correo, verificado, picture } | null
     · getToken() → JWT (audience api.vants.app) o null
     · entrar() / salir()
   COMPORTAMIENTO DEL LOGIN (igual que la web antigua):
     · El botón ENTRAR de la cabecera y del menú móvil abre el login Auth0
       en TODAS las páginas, no solo en clips.
     · Auth0 "VANTS movil" solo acepta https://vants.vants.workers.dev/ como
       callback, así que el login siempre vuelve a la portada con ?code=...&state=...
     · Antes de ir al login guardamos en sessionStorage la página donde estabas
       y, tras cerrar el callback, volvemos ahí (clips, perfil, torneos...).
   Requiere: <script src="https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js">
   cargado ANTES de este archivo. */
(function (window) {
  "use strict";

  var DOMINIO = "vants.eu.auth0.com";
  var CLIENTE = "oaOmNizh7HrASWfmfM29bN284IMJvqPG";
  var AUDIENCIA = "https://api.vants.app";
  var CLAVE_VOLVER = "vants_volver";

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

  /* ¿volvió del login? el callback llega con ?code=...&state=... (o ?error=...) */
  function esCallback() {
    var s = window.location.search;
    return s.indexOf("code=") !== -1 || s.indexOf("error=") !== -1;
  }

  function guardarVolver() {
    try {
      var destino = window.location.pathname + window.location.search;
      sessionStorage.setItem(CLAVE_VOLVER, destino);
    } catch (_e) { /* sessionStorage bloqueado: el login igual funciona */ }
  }

  function volverTrasLogin() {
    var destino = null;
    try {
      destino = sessionStorage.getItem(CLAVE_VOLVER);
      sessionStorage.removeItem(CLAVE_VOLVER);
    } catch (_e) { /* noop */ }
    if (
      destino && destino.charAt(0) === "/" && destino.indexOf("//") !== 0 &&
      destino !== window.location.pathname
    ) {
      window.location.replace(window.location.origin + destino);
      return true;
    }
    return false;
  }

  async function arrancar() {
    if (!window.auth0) return null; // CDN caído: la web sigue sin sesión

    cliente = await window.auth0.createAuth0Client({
      domain: DOMINIO,
      clientId: CLIENTE,
      authorizationParams: {
        /* Auth0 "VANTS movil" solo tiene esta URL en Allowed Callback URLs */
        redirect_uri: window.location.origin + "/",
        audience: AUDIENCIA,
        scope: "openid profile email",
      },
      cacheLocation: "localstorage",
      useRefreshTokens: true,
    });

    /* ¿vuelve del login? cierra el flujo una sola vez y regresa a su página */
    if (esCallback()) {
      var procesado = false;
      try {
        await cliente.handleRedirectCallback();
        procesado = true;
      } catch (_e) { /* code usado o de otra app: seguir */ }
      window.history.replaceState({}, "", window.location.origin + window.location.pathname);
      if (procesado && volverTrasLogin()) {
        return new Promise(function () {}); /* redirigiendo: corta aquí */
      }
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
    guardarVolver(); /* tras el login volvemos a esta misma página */
    if (!cliente) {
      /* cliente aún no listo (CDN lento) o caído: ir al /authorize a mano */
      window.location.href = "https://" + DOMINIO + "/authorize?response_type=code" +
        "&client_id=" + encodeURIComponent(CLIENTE) +
        "&redirect_uri=" + encodeURIComponent(window.location.origin + "/") +
        "&scope=" + encodeURIComponent("openid profile email") +
        "&audience=" + encodeURIComponent(AUDIENCIA);
      return;
    }
    cliente.loginWithRedirect({
      authorizationParams: { redirect_uri: window.location.origin + "/", audience: AUDIENCIA, scope: "openid profile email" },
    });
  }

  /* ENTRAR DIRECTO con una conexión concreta (p. ej. google-oauth2 o discord):
     salta la pantalla de elección de Auth0 y va derecho al proveedor. La
     conexión FACEIT de Auth0 está rota del lado del tenant (FACEIT solo da
     credenciales OAuth a partners), por eso la web NO la usa: el perfil
     conecta FACEIT verificando el NICK real contra su API pública. */
  function entrarCon(conexion) {
    var conValida = conexion === "google-oauth2" || conexion === "discord";
    if (!conValida) { entrar(); return; }
    guardarVolver();
    if (!cliente) {
      window.location.href = "https://" + DOMINIO + "/authorize?response_type=code" +
        "&client_id=" + encodeURIComponent(CLIENTE) +
        "&redirect_uri=" + encodeURIComponent(window.location.origin + "/") +
        "&scope=" + encodeURIComponent("openid profile email") +
        "&audience=" + encodeURIComponent(AUDIENCIA) +
        "&connection=" + encodeURIComponent(conexion);
      return;
    }
    cliente.loginWithRedirect({
      authorizationParams: {
        redirect_uri: window.location.origin + "/", audience: AUDIENCIA,
        scope: "openid profile email", connection: conexion,
      },
    });
  }

  /* ENTRAR CON CORREO Y CONTRASEÑA (S4.5): usa la conexión de base de datos del
     tenant (Username-Password-Authentication), que está activa para esta app.
     opcion = "registrar" → pantalla CREAR CUENTA de Auth0 (email + contraseña).
     opcion = "entrar"    → pantalla ENTRAR de Auth0 (tiene su propio enlace
     "¿Olvidaste tu contraseña?" con el restablecimiento completo hospedado). */
  var CONEXION_CORREO = "Username-Password-Authentication";
  function entrarCorreo(opcion) {
    guardarVolver();
    var extra = opcion === "registrar" ? "&screen_hint=signup" : "";
    if (!cliente) {
      window.location.href = "https://" + DOMINIO + "/authorize?response_type=code" +
        "&client_id=" + encodeURIComponent(CLIENTE) +
        "&redirect_uri=" + encodeURIComponent(window.location.origin + "/") +
        "&scope=" + encodeURIComponent("openid profile email") +
        "&audience=" + encodeURIComponent(AUDIENCIA) +
        "&connection=" + encodeURIComponent(CONEXION_CORREO) + extra;
      return;
    }
    var params = {
      redirect_uri: window.location.origin + "/", audience: AUDIENCIA,
      scope: "openid profile email", connection: CONEXION_CORREO,
    };
    if (opcion === "registrar") params.screen_hint = "signup";
    cliente.loginWithRedirect({ authorizationParams: params });
  }

  function salir() {
    try {
      window.location.href = "https://" + DOMINIO + "/v2/logout?client_id=" + CLIENTE +
        "&returnTo=" + encodeURIComponent(window.location.origin + "/");
    } catch (_e) { window.location.href = "/"; }
  }

  /* FIX S4.2: el NOMBRE DE LA CUENTA propio (perfil → Mis datos) manda sobre
     el del correo de Auth0 en toda la navegación. Vive en localStorage. */
  function nickPropio() {
    try {
      var p = JSON.parse(localStorage.getItem("vants_perfil_v1") || "null");
      return (p && p.nick) ? String(p.nick) : "";
    } catch (_e) { return ""; }
  }

  /* Con sesión el ENTRAR de la cabecera muestra el nick y lleva al perfil;
     sin sesión los botones ya dicen ENTRAR y el clic abre el login. */
  function pintarNav() {
    if (!usuario) return;
    var txt = (nickPropio() || usuario.nick).toUpperCase().slice(0, 14);
    document.querySelectorAll(".nav-entrar, .mega__entrar").forEach(function (a) {
      a.textContent = txt;
      a.setAttribute("href", "/perfil");
    });
  }

  /* CABLEADO: clic en ENTRAR (cabecera y menú móvil) = login en cualquier página */
  function cablearEntrar() {
    document.querySelectorAll(".nav-entrar, .mega__entrar").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (usuario) return; /* con sesión el enlace normal lleva a /perfil */
        e.preventDefault();
        entrar();
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", cablearEntrar);
  } else {
    cablearEntrar();
  }

  /* AUTO-ARRANQUE en todas las páginas: evalúa la sesión, procesa el callback
     (?code=...&state=... tras el login) y pinta el nick en la nav. */
  listo();

  window.VantAuth0 = {
    listo: listo,
    usuario: function () { return usuario; },
    getToken: getToken,
    entrar: entrar,
    entrarCon: entrarCon,
    entrarCorreo: entrarCorreo,
    salir: salir,
  };
})(window);
