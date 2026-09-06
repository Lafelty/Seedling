const { chromium, expect } = require('@playwright/test');
const { makeAdminContext } = require('./visual-refresh.cjs');
const { baseURL, exercise } = require('./fixtures.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const fixture = await makeAdminContext(browser, 390);
  const { page, context, adminState } = fixture;
  try {
    await page.goto(baseURL + '/admin');
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeHidden();

    await page.getByRole('textbox', { name: 'Search exercises' }).fill('not present');
    await expect(page.getByRole('heading', { name: 'No matching exercises' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('link', { name: 'Edit Shoulder raise', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Filter exercise status' }).selectOption('inactive');
    await expect(page.getByRole('heading', { name: 'No matching exercises' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();

    let release;
    adminState.gate = new Promise(resolve => { release = resolve; });
    await page.getByRole('button', { name: 'Deactivate Shoulder raise' }).click();
    await expect(page.getByRole('button', { name: 'Deactivate Shoulder raise' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete Shoulder raise' })).toBeDisabled();
    release();
    adminState.gate = null;
    await expect(page.getByRole('button', { name: 'Activate Shoulder raise' })).toBeEnabled();
    expect(adminState.writes[0].body).toEqual({ is_active: false });
    adminState.failure = true;
    await page.getByRole('button', { name: 'Activate Shoulder raise' }).click();
    await expect(page.locator('.library-error')).toContainText('could not be saved');
    await expect(page.getByRole('button', { name: 'Activate Shoulder raise' })).toBeEnabled();
    adminState.failure = false;

    page.once('dialog', dialog => dialog.dismiss());
    const beforeDelete = adminState.writes.length;
    await page.getByRole('button', { name: 'Delete Shoulder raise' }).click();
    expect(adminState.writes).toHaveLength(beforeDelete);

    await page.goto(baseURL + '/admin/exercises/' + exercise.id + '/edit');
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
    adminState.failure = true;
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('.editor-notice')).toContainText('could not be saved');
    adminState.failure = false;
    adminState.gate = new Promise(resolve => { release = resolve; });
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    release();
    adminState.gate = null;
    await expect(page.locator('.editor-notice')).toHaveText('Changes saved.');
    const saved = adminState.writes.at(-1).body;
    expect(saved.name).toBe(exercise.name);
    expect(saved.target_reps).toBe(exercise.target_reps);
    expect(saved.hold_duration_ms).toBe(exercise.hold_duration_ms);
    expect(saved.pose_criteria.criteria).toEqual(exercise.pose_criteria.criteria);
    expect(saved).not.toHaveProperty('is_active');
    expect(fixture.state.errors).toEqual([]);
    console.log('PASS admin navigation, filters, pending/error recovery, delete cancellation, editor save contract');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
