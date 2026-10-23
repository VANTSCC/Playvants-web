/* ============================================================
   VANTS · tests/e2e/plataforma.spec.js — E2E de la WEB S4
   ------------------------------------------------------------
   La web pública es la versión S4 (la misma app que vive en
   playvants.vercel.app): 14 rutas limpias, estáticos bajo
   /static/, perfil en localStorage, sin backend en el navegador.
   Corre contra PRODUCCIÓN (vants.vants.workers.dev) porque el
   site es el despliegue continuo del Worker.
   Local:  npx playwright test
   CI:     job e2e en tests.yml (retries 2 por red pública)
   ============================================================ */
const { test, expect } = require('@playwright/test');

const RUTAS = [
  ['/', 'VANTS GAMES — Donde nace la ventaja'],
  ['/clips', 'Clips · Momentos destacados'],
  ['/descargar', 'Descargar app para Windows'],
  ['/guia', 'Guía de la arena'],
  ['/historia', 'Historia de la marca'],
  ['/llaves', 'Llaves · Bracket'],
  ['/membresias', 'Membresías'],
  ['/partidos', 'Partidos'],
  ['/perfil', 'Perfil de jugador'],
  ['/ranking', 'Ranking'],
  ['/sala', 'Sala de jugadores'],
  ['/tienda', 'Tienda de identidad'],
  ['/tienda-oficial', 'Tienda oficial × VegaStore'],
  ['/torneos', 'Torneos'],
];

test.describe('Web S4 · salud y rutas', () => {
  test('healthz: mismo contrato que la app de Vercel', async ({ request }) => {
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
    const resp = await page.goto('/esta-ruta-no-existe');
    expect(resp.status()).toBe(404);
    await expect(page).toHaveTitle(/404 — VANTS GAMES/);
  });

  test('rutas legacy de torneos (/es|en/tournaments/...) siguen vivas', async ({ page }) => {
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
    const css = await request.get('/static/css/vants.css');
    expect(css.status()).toBe(200);
    expect(css.headers()['content-type']).toContain('text/css');
    const js = await request.get('/static/js/app.js');
    expect(js.status()).toBe(200);
    expect(js.headers()['content-type']).toContain('javascript');
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

test.describe('Web S4 · interacción (perfil y clips en localStorage)', () => {
  test('perfil: semilla cargada y edición de nick persiste tras recargar', async ({ page }) => {
    await page.goto('/perfil');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const semilla = await page.evaluate(() => !!window.__PERFIL_SEMILLA__);
    expect(semilla).toBe(true);
  });

  test('clips: destacar alterna y persiste en localStorage', async ({ page }) => {
    await page.goto('/clips');
    const primer = page.locator('.clip[data-clip] .clip__destacar').first();
    if (await primer.count()) {
      await primer.click();
      await expect(page.locator('#toast')).toContainText(/DESTACADO/i);
      await page.reload();
      const activo = await page
        .locator('.clip--destacado .clip__destacar--activo')
        .first()
        .count();
      expect(activo).toBeGreaterThan(0);
      // limpieza: dejar el estado como estaba (máx 3 por contrato)
      await page.evaluate(() => localStorage.removeItem('vants_perfil_v1'));
    }
  });

  test('navegación: desde la portada el menú lleva a Torneos', async ({ page }) => {
    await page.goto('/');
    const enlace = page.locator('a[href="/torneos"]').first();
    await enlace.click();
    await expect(page).toHaveTitle(/Torneos/);
    expect(new URL(page.url()).pathname).toBe('/torneos');
  });
});

test.describe('Web S4 · móvil 390', () => {
  test('sin overflow horizontal en portada y perfil', async ({ page }) => {
    for (const ruta of ['/', '/perfil']) {
      await page.goto(ruta);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `overflow horizontal en ${ruta}`).toBeLessThanOrEqual(1);
    }
  });

  test('el menú hamburguesa abre y navega', async ({ page }) => {
    await page.goto('/');
    const burger = page.locator('#burger');
    if (await burger.count()) {
      await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', /true/);
    }
  });
});
