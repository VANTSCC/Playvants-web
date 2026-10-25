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

  /* ── Un partido ── */
  function pintaPartido(f) {
    var m = el("div", "match");
    var vivo = f.estado === "en_curso";
    if (vivo) m.classList.add("match--vivo");

    if (vivo) {
      var cinta = el("div", "match__cinta");
      cinta.appendChild(el("span", "chip-vivo", "EN VIVO"));
      m.appendChild(cinta);
    }

    var ganador = (f.estado === "final" && f.ganador) ? String(f.ganador).trim() : null;
    [["a", f.team_a, f.score_a], ["b", f.team_b, f.score_b]].forEach(function (lado) {
      var div = el("div", "match__lado");
      if (ganador && nombreOClando(lado[1]) === ganador) div.classList.add("ganador");
      div.appendChild(el("span", null, nombreOClando(lado[1])));
      div.appendChild(el("span", "m",
        (lado[2] === null || lado[2] === undefined) ? "—" : String(lado[2])));
      m.appendChild(div);
    });
    return m;
  }

  function vacio(texto) {
    var m = el("div", "match");
    m.appendChild(el("div", "match__vacio", texto));
    return m;
  }

  /* ── Bracket completo (mismo layout de 3 columnas del placeholder) ── */
  function pintaBracket(filas) {
    var porRonda = {};
    (filas || []).forEach(function (f) {
      (porRonda[f.ronda] = porRonda[f.ronda] || []).push(f);
    });
    Object.keys(porRonda).forEach(function (r) {
      porRonda[r].sort(function (a, b) { return (a.slot || 0) - (b.slot || 0); });
    });

    function col(titulo) {
      var c = el("div", "bracket__col");
      c.appendChild(el("h4", null, titulo));
      return c;
    }
    function lados(ronda, esperando) {
      var lista = porRonda[ronda] || [];
      if (!lista.length) return [vacio(esperando)];
      return lista.map(pintaPartido);
    }

    var grid = el("div", "bracket");

    /* Columna 1: cuadro superior R1 */
    var c1 = col("CUADRO SUPERIOR · R1");
    lados("q", "ESPERANDO 8 CONFIRMADOS").forEach(function (m) { c1.appendChild(m); });
    grid.appendChild(c1);

    /* Columna 2: semifinales + cuadro inferior completo */
    var c2 = col("SEMIFINALES");
    lados("s", "ESPERANDO R1").forEach(function (m) { c2.appendChild(m); });
    c2.appendChild(el("h4", "bracket__sub", "CUADRO INFERIOR"));
    lados("l1", "SE ALIMENTA DE R1").forEach(function (m) { c2.appendChild(m); });
    lados("l2", "ESPERANDO INF. R1").forEach(function (m) { c2.appendChild(m); });
    lados("lf", "ESPERANDO INF. R2").forEach(function (m) { c2.appendChild(m); });
    grid.appendChild(c2);

    /* Columna 3: gran final + campeón (se conserva el salón de la fama) */
    var c3 = col("GRAN FINAL");
    lados("f", "BO5 · POR DEFINIR").forEach(function (m) { c3.appendChild(m); });
    var campeon = el("div", "campeon-box");
    campeon.style.marginTop = "16px";
    campeon.appendChild(el("b", null, "🏆 CAMPEÓN S4"));
    campeon.appendChild(el("small", null, "ENTRA AL SALÓN DE LA FAMA"));
    c3.appendChild(campeon);
    var actual = el("p", null, "CAMPEÓN ACTUAL: LOUD · CHAMPIONS 2026 (CIRCUITO PRO)");
    actual.style.cssText = "color:var(--gris-2);font-size:12px;margin-top:14px;font-family:var(--mono);letter-spacing:.08em";
    c3.appendChild(actual);
    grid.appendChild(c3);

    zona.innerHTML = "";
    zona.appendChild(grid);
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
