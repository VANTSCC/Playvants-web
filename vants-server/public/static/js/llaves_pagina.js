/* VANTS GAMES — página de LLAVES: bracket EN VIVO de verdad.
   S4.8 — "bracket vía proxy": el worker ya exponía /api/torneos/bracket
   (lectura pública, vía proxy vantsdata → Neon) y /api/en-vivo, pero
   ninguna página los consumía: el bracket era un placeholder estático.

   Qué hace este script (sin datos inventados):
   · Pide /api/torneos/bracket?torneo=ascension-s4 (mismo origen, lectura).
   · Si hay equipos inscritos, pinta la sección EQUIPOS INSCRITOS.
   · Si hay llaves, REEMPLAZA el bracket estático por el real:
     rondas q/s (cuadro superior), l1/l2/lf (inferiores) y f (gran final),
     con marcador, ganador (clase .ganador) y chip EN VIVO cuando un
     partido está en_curso. El servidor avanza los cruces solo (trigger
     bracket_avanza), así que la página solo lee.
   · Sondea cada 60 s (el endpoint cachea 15 s y el límite es 15/min):
     si el JSON no cambió, no re-pinta (cero parpadeo).
   · Si algo falla o no hay datos: NO toca el placeholder estático y no
     ensucia la consola. La página funciona igual sin JavaScript. */
(function () {
  "use strict";

  var TORNEO = "ascension-s4";            /* slug canónico de la Ascensión Series S4 */
  var INTERVALO = 60000;                  /* sondeo "en vivo": 1 petición/min (límite 15/min) */
  var API = "/api/torneos/bracket?torneo=" + encodeURIComponent(TORNEO);

  var zona = document.getElementById("bracket-zona");
  var aviso = document.getElementById("llaves-aviso");
  var secEquipos = document.getElementById("llaves-equipos");
  var chips = document.getElementById("llaves-chips");
  if (!zona) return;

  var firmaAnterior = null;

  /* ── Utilidades ── */
  function el(tag, cls, texto) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }
  function nombreOClando(nombre) {
    return (nombre && String(nombre).trim()) ? String(nombre).trim() : "POR DEFINIR";
  }
  function horaAhora() {
    var d = new Date();
    function dos(x) { return (x < 10 ? "0" : "") + x; }
    return dos(d.getHours()) + ":" + dos(d.getMinutes()) + ":" + dos(d.getSeconds());
  }

  /* ── Un partido (estilo referencia: filas centradas, separador punteado,
     badge BO en la fila baja) ── */
  function boDe(ronda) { return ronda === "f" ? "BO5" : "BO3"; }

  function pintaPartido(f) {
    var m = el("div", "matchb");
    var vivo = f.estado === "en_curso";
    if (vivo) {
      m.classList.add("match--vivo");
      var cinta = el("div", "match__cinta");
      cinta.appendChild(el("span", "chip-vivo", "EN VIVO"));
      m.appendChild(cinta);
    }

    var ganador = (f.estado === "final" && f.ganador) ? String(f.ganador).trim() : null;
    [["a", f.team_a, f.score_a], ["b", f.team_b, f.score_b]].forEach(function (lado) {
      var div = el("div", "matchb__lado");
      if (ganador && nombreOClando(lado[1]) === ganador) div.classList.add("ganador");
      div.appendChild(document.createTextNode(nombreOClando(lado[1])));
      if (lado[2] !== null && lado[2] !== undefined) div.appendChild(el("span", "sc", String(lado[2])));
      if (lado[0] === "b") div.appendChild(el("span", "bo", "· " + boDe(f.ronda)));
      m.appendChild(div);
    });
    return m;
  }

  function vacio(texto) {
    var m = el("div", "matchb");
    m.appendChild(el("div", "matchb__lado", texto || "POR DEFINIR"));
    m.appendChild(el("div", "matchb__lado", "POR DEFINIR"));
    return m;
  }

  /* ── Bracket completo (árbol de doble eliminación, mismo layout de la
     referencia: 3 columnas arriba + divisor + 3 columnas abajo). Los
     partidos se reparten con space-around para que las columnas formen
     el árbol; los huecos quedan en POR DEFINIR. ── */
  function pintaBracket(filas) {
    var porRonda = {};
    (filas || []).forEach(function (f) {
      (porRonda[f.ronda] = porRonda[f.ronda] || []).push(f);
    });
    Object.keys(porRonda).forEach(function (r) {
      porRonda[r].sort(function (a, b) { return (a.slot || 0) - (b.slot || 0); });
    });

    /* n = cuántas tarjetas fija el formato (16 equipos: o8 · q4 · s2 · f1 ·
       l1·4 · l2·4 · l3·2 · lf1 — misma estructura del placeholder estático) */
    function colBracket(titulo, rondas) {
      var c = el("div", "bracketv2__col");
      c.appendChild(el("h4", null, titulo));
      var wrap = el("div", "bracketv2__matches");
      rondas.forEach(function (rd) {
        var lista = porRonda[rd.r] || [];
        lista.slice(0, rd.n).forEach(function (f) { wrap.appendChild(pintaPartido(f)); });
        for (var i = lista.length; i < rd.n; i++) wrap.appendChild(vacio());
      });
      c.appendChild(wrap);
      return c;
    }

    var root = el("div", "bracketv2");

    /* Fila superior: octavos -> cuartos -> semis -> gran final (+ campeón) */
    var fila1 = el("div", "bracketv2__fila");
    fila1.appendChild(colBracket("OCTAVOS DE FINAL", [{ r: "o", n: 8 }]));
    fila1.appendChild(colBracket("CUARTOS DE FINAL", [{ r: "q", n: 4 }]));
    fila1.appendChild(colBracket("SEMIFINALES", [{ r: "s", n: 2 }]));
    var colGF = colBracket("GRAN FINAL", [{ r: "f", n: 1 }]);
    var campeon = el("div", "campeon-box");
    campeon.style.marginTop = "18px";
    campeon.appendChild(el("b", null, "🏆 CAMPEÓN S4"));
    campeon.appendChild(el("small", null, "ENTRA AL SALÓN DE LA FAMA"));
    colGF.appendChild(campeon);
    colGF.appendChild(el("p", "campeon-actual", "CAMPEÓN ACTUAL: POR DEFINIR"));
    fila1.appendChild(colGF);
    root.appendChild(fila1);

    /* Divisor: cuadro inferior */
    var divi = el("div", "bracketv2__divisor");
    divi.appendChild(el("span", null, "LLAVES INFERIORES · EL PERDEDOR CRUZA AQUÍ Y PELEA LA REVANCHA"));
    root.appendChild(divi);

    /* Fila inferior: ronda 1 -> ronda 2 -> semis inferiores -> final inferior */
    var fila2 = el("div", "bracketv2__fila");
    fila2.appendChild(colBracket("INFERIORES · RONDA 1", [{ r: "l1", n: 4 }]));
    fila2.appendChild(colBracket("INFERIORES · RONDA 2", [{ r: "l2", n: 4 }]));
    fila2.appendChild(colBracket("SEMIS INFERIORES", [{ r: "l3", n: 2 }]));
    fila2.appendChild(colBracket("FINAL INFERIOR", [{ r: "lf", n: 1 }]));
    root.appendChild(fila2);

    zona.innerHTML = "";
    zona.appendChild(root);
  }

  /* ── Equipos inscritos ── */
  function pintaEquipos(equipos) {
    if (!secEquipos || !chips) return;
    if (!equipos || !equipos.length) { secEquipos.hidden = true; return; }
    chips.innerHTML = "";
    equipos.forEach(function (eq) {
      var chip = el("div", "llaves-chip");
      chip.appendChild(el("b", null, (eq.tag || "·").toUpperCase()));
      chip.appendChild(document.createTextNode(" " + (eq.name || "")));
      var det = [eq.captain ? "CAP " + eq.captain : null, eq.region ? eq.region.toUpperCase() : null]
        .filter(Boolean).join(" · ");
      if (det) chip.appendChild(el("small", null, det));
      chip.appendChild(el("span", "st " + (eq.status === "confirmado" ? "st--ok" : "st--rev"),
        eq.status === "confirmado" ? "CONFIRMADO" : "EN REVISIÓN"));
      chips.appendChild(chip);
    });
    var em = secEquipos.querySelector("em");
    if (em) em.textContent = "INSCRITOS (" + equipos.length + ")";
    secEquipos.hidden = false;
  }

  /* ── Ciclo en vivo ── */
  function cargar() {
    fetch(API, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || d.ok !== true) {               /* sin_datos → placeholder estático */
        if (aviso) aviso.hidden = true;
        return;
      }
      var firma = JSON.stringify([d.equipos, d.bracket]);
      if (firma === firmaAnterior) return;      /* nada cambió → sin parpadeo */
      firmaAnterior = firma;
      pintaEquipos(d.equipos || []);
      if (d.bracket && d.bracket.length) pintaBracket(d.bracket);
      if (aviso) {
        aviso.textContent = "";
        aviso.appendChild(el("b", null, "DATOS EN VIVO"));
        aviso.appendChild(document.createTextNode(" · ACTUALIZADO " + horaAhora()));
        aviso.hidden = false;
      }
    }).catch(function () {                      /* red/caída → se respeta lo pintado */
      if (aviso) aviso.hidden = true;
    });
  }

  cargar();
  setInterval(cargar, INTERVALO);
})();
