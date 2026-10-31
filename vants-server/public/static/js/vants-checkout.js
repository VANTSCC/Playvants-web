/* ============================================================
   VANTS GAMES — PAGO REAL · Checkout hosted de Stripe
   ------------------------------------------------------------
   · Los botones con [data-checkout-plan] abren el Checkout real
     (suscripción mensual/anual o pago único del pase).
   · La sesión la pone VantAuth0; el JWT (audience api.vants.app)
     viaja como Bearer y el servidor lo valida contra Auth0.
   · El ALTA del plan la confirma el webhook de Stripe
     (stripe-webhook → membership_entitlements + insignia en la
     ficha). El retorno ?paid=… solo informa: nunca se finge alta.
   · Sin sesión humana: el clic abre el login y vuelve a esta
     página. Agentes IA (AgentID) no pueden pagar y se les avisa.
   ============================================================ */
(function () {
  "use strict";

  /* Función desplegada en Cloudflare (vants-functions). La clave
     sk_live_ vive SOLO como secret del Worker: nunca en el front. */
  var CHECKOUT_BASE = "https://vants-functions.vants.workers.dev/fn/stripe-checkout";

  function toast(mensaje, error) {
    var el = document.getElementById("toast");
    if (!el) { if (console && console.warn) console.warn(mensaje); return; }
    el.textContent = mensaje;
    el.classList.toggle("toast--error", !!error);
    el.classList.add("toast--visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("toast--visible"); }, 3400);
  }

  async function pagar(plan, period, btn) {
    var auth = window.VantAuth0;
    if (!auth || typeof auth.listo !== "function") {
      toast("El pago necesita la sesión cargada · recargá la página", true);
      return;
    }
    try { await auth.listo(); } catch (_e) { /* listo puede fallar sin red */ }

    var usuario = null;
    try { usuario = auth.usuario(); } catch (_e) { usuario = null; }

    if (!usuario) { auth.entrar(); return; } /* tras el login vuelve acá */
    if (usuario.agente) {
      toast("Los pagos son para cuentas humanas · entrá con tu cuenta de jugador", true);
      return;
    }

    var etiqueta = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.classList.add("btn--ocupado"); btn.textContent = "ABRIENDO STRIPE…"; }

    try {
      var token = await auth.getToken();
      if (!token) { throw new Error("sin_token"); }

      var r = await fetch(CHECKOUT_BASE + "/api/checkout/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          plan: plan,
          period: period || "mo",
          return_to: window.location.origin + window.location.pathname,
        }),
      });
      var d = await r.json().catch(function () { return {}; });

      if (d && d.url) {
        window.location.href = d.url; /* Checkout hosted de Stripe */
        return;
      }
      if (r.status === 401) { throw new Error("sesion_vencida"); }
      throw new Error((d && (d.detalle || d.error)) || "fallo_checkout");
    } catch (e) {
      if (e && e.message === "sin_token") {
        toast("No pudimos validar tu sesión · volvé a entrar e intentá de nuevo", true);
      } else if (e && e.message === "sesion_vencida") {
        toast("Tu sesión venció · entrá de nuevo", true);
      } else {
        toast("El pago no pudo iniciarse · " + String((e && e.message) || e), true);
      }
      if (btn) { btn.disabled = false; btn.classList.remove("btn--ocupado"); btn.textContent = etiqueta; }
    }
  }

  /* ── Botones: <button data-checkout-plan="pro" data-periodo="mo"> ── */
  function cablear() {
    var botones = document.querySelectorAll("[data-checkout-plan]");
    for (var i = 0; i < botones.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          pagar(btn.getAttribute("data-checkout-plan"), btn.getAttribute("data-periodo") || "mo", btn);
        });
      })(botones[i]);
    }

    /* ── Retorno de Stripe: ?paid=pro|creator|pase|cancel ──
       El alta real la confirma el webhook; acá solo informamos. */
    try {
      var q = new URLSearchParams(window.location.search);
      var pagado = q.get("paid");
      if (pagado) {
        history.replaceState(null, "", window.location.pathname);
        if (pagado === "cancel") toast("Pago cancelado · no se cobró nada");
        else toast("¡PAGO RECIBIDO! Tu plan se activa en segundos y la insignia llega a tu ficha.");
      }
    } catch (_e) { /* URLSearchParams no disponible: ignorar */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", cablear);
  } else {
    cablear();
  }
})();
