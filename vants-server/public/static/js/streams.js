/* ═══ VANTS TWITCH DISCOVERY · lógica de /streams ═══
   Habla solo con la API propia del Worker (/api/twitch/*): las credenciales de
   Twitch viven en el servidor y aquí nunca aparecen. Solo se muestran los 5
   juegos de la comunidad VANTS y directos de cuentas registradas en VANTS.
   Ver directos NO toca el ranking — descubrimiento puro. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var HOST = encodeURIComponent(location.hostname);
  var juegoActivo = '';
  var ctrl = null; // AbortController de la petición en curso de directos

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    try { return new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0); }
    catch (e) { return String(n || 0); }
  }
  function pilas(v) { return num(v) + ' viendo'; }
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('toast--on');
    setTimeout(function () { t.classList.remove('toast--on'); }, 3200);
  }

  /* ── Modal de directo (reproductor oficial embebido de Twitch) ── */
  var modalTw = $('#modal-tw'), modalIframe = $('#modal-tw-iframe');
  function abrirDirecto(canal, titulo, meta) {
    if (!modalTw) return;
    $('#modal-tw-titulo').textContent = titulo || canal;
    $('#modal-tw-meta').textContent = meta || '';
    modalIframe.src = 'https://player.twitch.tv/?channel=' + encodeURIComponent(canal) + '&parent=' + HOST + '&autoplay=true';
    modalTw.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function cerrarDirecto() {
    if (!modalTw) return;
    modalTw.hidden = true;
    modalIframe.src = ''; // corta la reproducción
    document.body.style.overflow = '';
  }
  if (modalTw) {
    modalTw.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-cerrar') || e.target.closest('[data-cerrar]')) cerrarDirecto();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarDirecto(); });
  }

  /* ── EXPLORAR JUEGOS: los 5 juegos de la comunidad VANTS ── */
  function tarjetaJuego(g) {
    var el = document.createElement('article');
    el.className = 'tw-juego';
    el.innerHTML =
      '<img loading="lazy" src="' + esc(g.portada) + '" alt="Portada de ' + esc(g.nombre) + '">' +
      '<div class="tw-juego__pie">' +
        '<span class="tw-juego__nombre">' + esc(g.nombre) + '</span>' +
        '<span class="tw-juego__top"><b>VANTS</b> · VER DIRECTOS ↓</span>' +
      '</div>';
    el.addEventListener('click', function () { elegirJuego(g.nombre); });
    return el;
  }

  function cargarJuegos() {
    var caja = $('#tw-juegos');
    if (!caja) return;
    caja.innerHTML = '<div class="tw-cargando">CARGANDO LOS JUEGOS DE LA COMUNIDAD…</div>';
    fetch('/api/twitch/juegos', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok || !(j.juegos || []).length) throw new Error('vacio');
        $('#juegos-contador').textContent = j.juegos.length + ' JUEGOS · SECCIÓN VANTS';
        caja.innerHTML = '';
        j.juegos.forEach(function (g) { caja.appendChild(tarjetaJuego(g)); });
      })
      .catch(function () {
        caja.innerHTML = '<div class="tw-cargando">TWITCH NO DISPONIBLE AHORA MISMO · PROBÁ EN UN RATO</div>';
      });
  }

  /* ── EN DIRECTO: solo cuentas registradas en VANTS ── */
  function tarjetaDirecto(s) {
    var el = document.createElement('article');
    el.className = 'tw-directo';
    el.innerHTML =
      '<span class="tw-directo__mini">' +
        '<img loading="lazy" src="' + esc(s.mini) + '" alt="Directo de ' + esc(s.canalNombre || s.canal) + '">' +
        '<span class="tw-directo__live">● EN VIVO</span>' +
        '<span class="tw-directo__vistas">' + esc(num(s.vistas)) + '</span>' +
      '</span>' +
      '<div class="tw-directo__cuerpo">' +
        (s.perfil ? '<img class="tw-directo__avatar" loading="lazy" src="' + esc(s.perfil) + '" alt="">' : '<span class="tw-directo__avatar"></span>') +
        '<div class="tw-directo__txt">' +
          '<span class="tw-directo__canal">' + esc(s.canalNombre || s.canal) + '</span>' +
          '<span class="tw-directo__titulo">' + esc(s.titulo || 'Sin título') + '</span>' +
          '<span class="tw-directo__juego">' + esc(s.juego || 'TWITCH') + ' · ' + esc(pilas(s.vistas)) + '</span>' +
        '</div>' +
      '</div>';
    el.addEventListener('click', function () {
      abrirDirecto(s.canal, s.canalNombre || s.canal, (s.juego || '') + (s.vistas ? ' · ' + num(s.vistas) + ' viendo' : '') + ' · CREADOR VANTS · Verlo acá no altera tu ranking');
    });
    return el;
  }

  function cargarDirectos(juego) {
    var caja = $('#tw-directos');
    if (!caja) return;
    juegoActivo = juego || '';
    $('#directos-chip').textContent = juegoActivo ? 'FILTRO: ' + juegoActivo.toUpperCase() : 'TODOS LOS JUEGOS VANTS';
    caja.innerHTML = '<div class="tw-cargando">CARGANDO LOS DIRECTOS VANTS…</div>';
    if (ctrl) ctrl.abort();
    ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var opts = { headers: { Accept: 'application/json' } };
    if (ctrl) opts.signal = ctrl.signal;
    fetch('/api/twitch/directos?limite=18' + (juegoActivo ? '&juego=' + encodeURIComponent(juegoActivo) : ''), opts)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var streams = (j && j.streams) || [];
        if (!j.ok) throw new Error('no_ok');
        caja.innerHTML = '';
        if (!streams.length) {
          caja.innerHTML = '<div class="tw-cargando">' +
            'NINGÚN CREADOR REGISTRADO EN VANTS ESTÁ EN DIRECTO' +
            (juegoActivo ? ' DE ' + esc(juegoActivo.toUpperCase()) : '') +
            ' AHORA MISMO · CONECTÁ TU TWITCH EN TU PERFIL PARA APARECER ACÁ</div>';
          return;
        }
        streams.forEach(function (s) { caja.appendChild(tarjetaDirecto(s)); });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        caja.innerHTML = '<div class="tw-cargando">TWITCH NO DISPONIBLE AHORA MISMO · PROBÁ EN UN RATO</div>';
      });
  }

  function elegirJuego(nombre) {
    var dest = $('#directos');
    if (dest && dest.scrollIntoView) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cargarDirectos(nombre);
  }

  /* ── CREADORES VANTS (cuentas registradas) ── */
  function tarjetaCreador(c) {
    var el = document.createElement('article');
    el.className = 'tw-creador' + (c.enVivo ? ' tw-creador--vivo' : '');
    el.innerHTML =
      (c.perfil ? '<img class="tw-creador__avatar" loading="lazy" src="' + esc(c.perfil) + '" alt="">' : '<span class="tw-creador__avatar"></span>') +
      '<div class="tw-creador__txt">' +
        '<span class="tw-creador__nombre">' + esc(c.canalNombre || c.canal) +
          '<span class="tw-creador__estado">' + (c.enVivo ? '● EN VIVO' : 'OFFLINE') + '</span>' +
        '</span>' +
        (c.enVivo
          ? '<span class="tw-creador__titulo">' + esc(c.titulo || '') + (c.juego ? ' — ' + esc(c.juego) : '') + ' · ' + esc(num(c.vistas)) + ' viendo</span>'
          : '<span class="tw-creador__titulo">' + (c.deD1 ? 'Jugador de VANTS · canal vinculado' : 'Creador oficial de VANTS') + ' · seguilo en Twitch</span>') +
      '</div>' +
      '<a class="tw-creador__link" href="https://www.twitch.tv/' + encodeURIComponent(c.canal) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">CANAL ↗</a>';
    if (c.enVivo) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () {
        abrirDirecto(c.canal, c.canalNombre || c.canal, (c.juego || 'EN DIRECTO') + ' · CREADOR VANTS');
      });
    }
    return el;
  }

  function cargarCreadores() {
    var caja = $('#tw-creadores');
    if (!caja) return;
    fetch('/api/twitch/creadores', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var lista = (j && j.creadores) || [];
        if (!j.ok) throw new Error('no_ok');
        if (!lista.length) {
          $('#creadores-contador').textContent = '0 EN VIVO';
          caja.innerHTML = '<div class="tw-cargando">TODAVÍA NO HAY CUENTAS DE TWITCH REGISTRADAS EN VANTS · CONECTÁ LA TUYA DESDE TU PERFIL (REDES Y CUENTAS) Y APARECÉ ACÁ CUANDO ESTÉS EN DIRECTO</div>';
          return;
        }
        var vivos = lista.filter(function (c) { return c.enVivo; }).length;
        $('#creadores-contador').textContent = lista.length + ' REGISTRAD' + (lista.length === 1 ? 'O' : 'OS') + ' · ' + vivos + ' EN VIVO';
        caja.innerHTML = '';
        lista.sort(function (a, b) { return (b.enVivo ? 1 : 0) - (a.enVivo ? 1 : 0); });
        lista.forEach(function (c) { caja.appendChild(tarjetaCreador(c)); });
      })
      .catch(function () {
        caja.innerHTML = '<div class="tw-cargando">NO SE PUDO CARGAR LOS CREADORES · PROBÁ EN UN RATO</div>';
      });
  }

  /* ── arranque ── */
  cargarJuegos();
  cargarDirectos('');
  cargarCreadores();
})();
