const { chromium, expect } = require('@playwright/test');
const { makeContext, baseURL } = require('./fixtures.cjs');

async function checkSignedOutNavigation(browser) {
  for (const path of ['/', '/progress']) {
    const guest = await makeContext(browser);
    try {
      await guest.context.clearCookies();
      await guest.page.goto(baseURL + path);
      await expect(guest.page).toHaveURL(baseURL + '/login');
      await expect(guest.page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      expect(guest.state.errors).toEqual([]);
    } finally {
      await guest.context.close();
    }

    // A server outage with an existing session must retain Retry instead of
    // treating every absent getUser() result as a signed-out visitor.
    const outage = await makeContext(browser);
    let authFailure = true;
    try {
      await outage.context.route('**/auth/v1/user', route => authFailure
        ? route.fulfill({ status: 503, json: { message: 'Fixture auth unavailable' } })
        : route.fallback());
      await outage.page.goto(baseURL + path);
      await expect(outage.page.locator('p[role="alert"]')).toContainText('Your latest progress could not be loaded', { timeout: 20000 });
      await expect(outage.page).toHaveURL(baseURL + path);
      authFailure = false;
      await outage.page.getByRole('button', { name: 'Retry loading' }).click();
      await expect(outage.page.getByRole('heading', { level: 1, name: path === '/' ? 'Fixture Patient' : 'Progress', exact: true })).toBeVisible();
      await expect(outage.page.locator('p[role="alert"]')).toHaveCount(0);
      expect(outage.state.writes).toEqual([]);
    } finally {
      await outage.context.close();
    }
  }
  console.log('PASS Garden and Progress: signed-out redirect and auth outage recovery');
}

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch({ headless: true });
    try { await checkSignedOutNavigation(browser); }
    finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { checkSignedOutNavigation };
