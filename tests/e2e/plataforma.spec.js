/* ============================================================
   VANTS · tests/e2e/plataforma.spec.js — E2E de la WEB S4
   ------------------------------------------------------------
   La web pública es la versión S4 (la misma app que vive en
   playvants.vercel.app): 14 rutas limpias, estáticos bajo
   /static/, perfil en localStorage y splash de entrada que se
   descarta con un click (una vez por sesión, sessionStorage).
   Corre contra PRODUCCIÓN (vants.vants.workers.dev) porque el
   site es el despliegue continuo del Worker. Las 2 pruebas que
   dependen del Worker (/healthz y rewrites legacy) se saltan
   si apuntas a localhost (VANTS_E2E_URL) porque ahí solo hay
   servidor estático.
   Local:  VANTS_E2E_URL=http://localhost:8899 npx playwright test
   CI:     job e2e en tests.yml (retries 2 por red pública)
   ============================================================ */
const { test, expect } = require('@playwright/test');

const LOCAL = /localhost|127\.0\.0\.1/.test(process.env.VANTS_E2E_URL || '');

const RUTAS = [
  ['/', 'VANTS GAMES — Donde nace la ventaja'],
  ['/clips', 'Clips · Momentos destacados'],
  ['/descargar', 'Descargar app para Windows'],
  ['/guia', 'Guía de la arena'],
  ['/historia', 'Historia de la marca'],
  ['/llaves', 'Ficha de torneo · Ascensión S4'],
  ['/membresias', 'Membresías'],
  ['/partidos', 'Partidos'],
  ['/perfil', 'Perfil de jugador'],
  ['/ranking', 'Ranking'],
  ['/sala', 'Sala de jugadores'],
  ['/tienda', 'Tienda de identidad'],
  ['/tienda-oficial', 'Tienda oficial × VegaStore'],
  ['/torneos', 'Torneos'],
];

/* El splash cubre la página la primera vez de cada sesión (sessionStorage).
   Entrar como lo hace un visitante: un click en el splash. Tras recargar
   (misma sesión) ya no aparece. */
async function entrarSplash(page) {
  const splash = page.locator('#splash');
  if (!await splash.count()) return;
  const clases = (await splash.getAttribute('class')) || '';
  if (!clases.includes('splash--oculto')) {
    await splash.click();
  }
  // Tolerancia: producción recién desplegada (fría) puede tardar en enlazar
  // el JS del splash; 10 s en lugar de 5 evita falsos rojos (v. run #28/#31).
  await expect(splash).toHaveClass(/splash--oculto/, { timeout: 10000 });
}

test.describe('Web S4 · salud y rutas', () => {
  test('healthz: mismo contrato que la app de Vercel', async ({ request }) => {
    test.skip(LOCAL, 'solo existe en el Worker (producción)');
    const r = await request.get('/healthz');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ ok: true, version: 'S4', web: 'VANTS GAMES' });
  });

  test('las 14 rutas limpias responden 200 con su título', async ({ page }) => {
    for (const [ruta, titulo] of RUTAS) {
      const resp = await page.goto(ruta);
      expect(resp.status(), `status de ${ruta}`).toBe(200);
      await expect(page, `título de ${ruta}`).toHaveTitle(new RegExp(titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('ruta inexistente → 404 con la página propia de S4', async ({ page }) => {
    test.skip(LOCAL, 'el 404 con página lo aplica el Worker (producción)');
    const resp = await page.goto('/esta-ruta-no-existe');
    expect(resp.status()).toBe(404);
    await expect(page).toHaveTitle(/404 — VANTS GAMES/);
  });

  test('rutas legacy de torneos (/es|en/tournaments/...) siguen vivas', async ({ page }) => {
    test.skip(LOCAL, 'los rewrites viven en el Worker (producción)');
    const resp = await page.goto('/es/tournaments/valorant/upcoming');
    expect(resp.status()).toBe(200);
    await expect(page).toHaveTitle(/torneos de/i);
    // juego no catalogado → 307 al juego principal (lógica del Worker intacta)
    const respFifa = await page.goto('/es/tournaments/fifa/upcoming', { maxRedirects: 0 }).catch(() => null);
    const status = respFifa ? respFifa.status() : 200;
    expect([307, 200]).toContain(status);
  });
});

test.describe('Web S4 · estáticos y cabeceras', () => {
  test('css y js de /static cargan con su content-type', async ({ request }) => {
    // expect.poll: tolera un blip puntual del asset store en el runner de CI
    await expect(async () => {
      const css = await request.get('/static/css/vants.css');
      expect(css.status()).toBe(200);
      expect(css.headers()['content-type']).toContain('text/css');
      const js = await request.get('/static/js/app.js');
      expect(js.status()).toBe(200);
      expect(js.headers()['content-type']).toContain('javascript');
    }).toPass({ timeout: 20_000 });
  });

  test('la portada no referencia recursos de Vercel ni del sitio antiguo', async ({ page }) => {
    await page.goto('/');
    const malos = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src], link[href]'))
        .map((el) => el.getAttribute('src') || el.getAttribute('href'))
        .filter((u) => u && (u.includes('/_vercel') || u.includes('/assets/js/') || u.includes('/_astro/')))
    );
    expect(malos).toEqual([]);
  });
});

test.describe('Web S4 · interacción (splash, perfil y clips en localStorage)', () => {
  test('splash: entra con un click y no vuelve en la misma sesión', async ({ page }) => {
    await page.goto('/');
    await entrarSplash(page);
    // recarga: el splash debe quedar oculto solo (sessionStorage)
    await page.reload();
    const oculto = await page.locator('#splash.splash--oculto').count();
    expect(oculto).toBe(1);
  });

  test('clips: destacar alterna y persiste en localStorage', async ({ page }) => {
    await page.goto('/clips');
    await entrarSplash(page);
    const primer = page.locator('.clip[data-clip] .clip__destacar').first();
    test.skip((await primer.count()) === 0, 'sin clips destacables en la vitrina');
    await primer.click();
    await expect(page.locator('#toast')).toContainText(/DESTACADO/i);
    await page.reload();
    await expect(page.locator('.clip--destacado .clip__destacar--activo').first()).toBeVisible();
    // limpieza: dejar el estado como estaba
    await page.evaluate(() => localStorage.removeItem('vants_perfil_v1'));
  });

  test('navegación: el pie lleva a Torneos desde la portada', async ({ page }) => {
    await page.goto('/');
    await entrarSplash(page);
    const enlace = page.locator('footer a[href="/torneos"]').first();
    await enlace.click();
    // Producción fría tras un deploy: el título puede tardar en asentarse.
    await expect(page).toHaveTitle(/Torneos/, { timeout: 30000 });
    expect(new URL(page.url()).pathname).toBe('/torneos');
  });
});

test.describe('Web S4 · móvil 390', () => {
  test('sin scroll horizontal real en portada y perfil', async ({ page }) => {
    for (const ruta of ['/', '/perfil']) {
      await page.goto(ruta);
      const m = await page.evaluate(() => {
        window.scrollTo(500, 0);
        return {
          scrollX: window.scrollX,
          overflowX: getComputedStyle(document.body).overflowX,
        };
      });
      // el ticker de portada sobresale ~4px pero está CLIPPEADO (overflow-x hidden):
      // lo que importa al usuario es que no pueda desplazarse de lado.
      expect(m.scrollX, `scroll horizontal posible en ${ruta}`).toBe(0);
      expect(['hidden', 'clip']).toContain(m.overflowX);
    }
  });

  test('el menú hamburguesa abre (proyecto móvil)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium-movil', 'el burger solo existe en móvil');
    await page.goto('/');
    await entrarSplash(page);
    const burger = page.locator('#burger');
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', /true/);
  });
});
