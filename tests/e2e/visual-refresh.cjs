/* Visual coverage with fixture accounts only. Never sends real database writes. */
const { chromium, expect } = require('@playwright/test');
const { mkdir, writeFile } = require('node:fs/promises');
const { makeContext, baseURL, user, exercise, group } = require('./fixtures.cjs');
const AxeBuilder = require('@axe-core/playwright').default;

async function makeAdminContext(browser, width) {
  const fixture = await makeContext(browser, width);
  fixture.adminState = { writes: [], failure: false, gate: null };
  const profile = { ...user, name: 'Jamie Lee', is_admin: false, total_stars: 4, phone: '', height_cm: null, weight_kg: null, avatar_path: null, guardian_email: null, guardian_notify: false };
  await fixture.context.route('**/rest/v1/profiles*', route => route.fulfill({ json: route.request().headers().accept?.includes('object') ? { ...profile, is_admin: true } : [profile] }));
  await fixture.context.route('**/rest/v1/exercises*', async route => {
    const row = { ...exercise, is_active: true, difficulty: 'beginner', created_at: '2026-09-01T00:00:00Z' };
    if (route.request().method() !== 'GET') {
      fixture.adminState.writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
      if (fixture.adminState.gate) await fixture.adminState.gate;
      return route.fulfill({ status: fixture.adminState.failure ? 503 : 200, json: fixture.adminState.failure ? { message: 'Fixture write failed' } : null });
    }
    return route.fulfill({ json: route.request().headers().accept?.includes('object') ? row : [row] });
  });
  return fixture;
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const report = { routes: [], errors: [] };
  const directory = 'test-results/visual-refresh';
  await mkdir(directory, { recursive: true });
  try {
    for (const width of [390, 1440]) {
      for (const admin of [false, true]) {
        const fixture = await (admin ? makeAdminContext(browser, width) : makeContext(browser, width));
        try {
          const routes = admin
            ? ['/admin', '/admin/patients', '/admin/groups', '/admin/exercises/new', '/admin/exercises/' + exercise.id + '/edit', '/admin/users/' + user.id, '/admin/users/' + user.id + '/dashboard', '/starconfig']
            : ['/', '/levels', '/levels/' + group.id, '/progress', '/dashboard', '/profile', '/session?exercise=' + exercise.id, '/login', '/signup'];
          for (const route of routes) {
            await fixture.page.goto(baseURL + route, { waitUntil: 'domcontentloaded' });
            await expect(fixture.page.locator('h1').first()).toBeVisible({ timeout: 30000 });
            await fixture.page.evaluate(() => document.fonts.ready);
            await fixture.page.locator('body').screenshot({ path: `${directory}/${width}-${route.replace(/[^a-z0-9]/gi, '_') || 'garden'}.png` });
            const overflow = await fixture.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            const axe = await new AxeBuilder({ page: fixture.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            const checks = { width, route, finalUrl: fixture.page.url(), overflow, violations: axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) };
            report.routes.push(checks);
            console.log(JSON.stringify({ width, route, overflow, violations: checks.violations.map(v => v.id) }));
          }
          report.errors.push(...fixture.state.errors);
        } finally { await fixture.context.close(); }
      }
    }
  } finally {
    await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
  expect(report.errors, 'uncaught page errors').toEqual([]);
  expect(report.routes.filter(route => route.overflow || route.violations.length), 'layout and accessibility findings').toEqual([]);
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { makeAdminContext };
