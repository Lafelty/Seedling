/* Run against `npm run dev -- --port 3000`. All account/API traffic is mocked. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { mkdir } = require('node:fs/promises');
const { makeContext, fakeTracking, baseURL, result, pendingKey, group } = require('./fixtures.cjs');

async function checkLayout(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow`).toBe(true);
  const smallTargets = await page.locator('main a, main button, main input:not([type="file"]), main select, main summary, .patient-nav a, dialog button, dialog summary').evaluateAll(elements => elements.flatMap(element => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || element.matches(':disabled') || getComputedStyle(element).visibility === 'hidden') return [];
    return rect.width < 47.9 || rect.height < 47.9 ? [{text:element.getAttribute('aria-label') || element.textContent.trim().slice(0,40),width:rect.width,height:rect.height}] : [];
  }));
  expect(smallTargets, `${name}: 48px touch targets`).toEqual([]);
  const scan = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(scan.violations.map(v => ({id:v.id, nodes:v.nodes.map(n => ({target:n.target,summary:n.failureSummary}))})), `${name}: accessibility`).toEqual([]);
  await page.screenshot({path:`test-results/${name}.png`,fullPage:true});
}

(async () => {
  await mkdir('test-results', {recursive:true});
  const browser = await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try {
    const {context,page,state} = await makeContext(browser,320);
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      for (const [path,heading,active] of [
        ['/','Fixture Patient','Garden'], ['/levels','Exercises','Exercises'],
        ['/levels/'+group.id,group.name,'Exercises'], ['/progress','Progress','Progress'],
        ['/dashboard','Progress','Progress'], ['/profile','Profile','Profile'],
      ]) {
        await page.goto(baseURL+path);
        await expect(page.getByRole('heading',{level:1,name:heading,exact:true})).toBeVisible();
        await expect(page.locator('.patient-nav [aria-current="page"]')).toHaveText(active);
        await checkLayout(page,`${active.toLowerCase()}-${path === '/dashboard' ? 'trends-' : path.includes(group.id) ? 'group-' : ''}${width}`);
      }
    }
    console.log('PASS patient routes: navigation, responsive layout, WCAG axe scans at 320/390/768/1440px');

    await page.setViewportSize({width:390,height:844});
    await page.goto(baseURL+'/levels');
    const card = page.getByRole('button',{name:/Shoulder mobility/});
    await card.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    for(let i=0;i<6;i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);
    }
    await checkLayout(page,'exercise-dialog');
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    console.log('PASS exercise dialog traps focus and Escape returns to its opener');

    state.profileFailure=true;
    await page.goto(baseURL+'/profile');
    await expect(page.locator('p[role="alert"]')).toContainText('profile couldn’t be loaded', {timeout:20000});
    await expect(page.getByRole('button',{name:'Save Profile',exact:true})).toHaveCount(0);
    state.profileFailure=false;
    await page.getByRole('button',{name:'Retry loading'}).click();
    await expect(page.getByRole('button',{name:'Save Profile',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Save Profile',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Profile saved');
    expect(state.profileWrites).toHaveLength(1);
    expect(state.profileWrites[0]).not.toHaveProperty('guardian_email');
    expect(state.profileWrites[0]).not.toHaveProperty('guardian_notify');
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkLayout(page,'profile-cropper');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    console.log('PASS profile load failure prevents blank writes; save preserves guardian preferences');

    state.historyRows = [{id:result.sessionId,exercise_id:result.exerciseId,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),duration_seconds:30,completed_reps:2,target_reps:2,form_quality_score:60,exercises:{name:'Shoulder raise'}}];
    for(const path of ['/progress','/dashboard']) {
      await page.goto(baseURL+path);
      await expect(page.getByRole('heading',{level:1,name:'Progress'})).toBeVisible();
      if(path === '/dashboard') await expect(page.locator('.recharts-area-dot').first()).toBeVisible();
      await checkLayout(page,'populated-'+path.slice(1));
    }
    expect(state.errors).toEqual([]);
    await context.close();

    const active=await makeContext(browser,320);
    await fakeTracking(active.context);
    await active.page.goto(baseURL+'/session?exercise='+result.exerciseId);
    await expect(active.page.getByRole('button',{name:'Enable camera',exact:true})).toBeVisible();
    expect(await active.page.evaluate(()=>window.__cameraRequests)).toBe(0);
    await checkLayout(active.page,'session-preparation-320');
    await active.page.getByRole('button',{name:'Enable camera',exact:true}).click();
    await expect(active.page.getByRole('button',{name:'Start session',exact:true})).toBeVisible();
    await checkLayout(active.page,'session-preview-320');
    await active.page.setViewportSize({width:844,height:390});
    await checkLayout(active.page,'session-preview-landscape');
    await active.page.setViewportSize({width:320,height:844});
    await active.page.getByRole('button',{name:'Start session',exact:true}).click();
    await expect(active.page.getByRole('region',{name:'Movement guidance'})).toBeVisible();
    await checkLayout(active.page,'session-active-320');
    await active.page.evaluate(()=>window.__fixtureGood=true);
    await expect(active.page.locator('.session-reps')).toContainText('1 / 2');
    await active.page.getByRole('button',{name:'Pause session',exact:true}).click();
    await expect(active.page.getByRole('dialog')).toBeVisible();
    await checkLayout(active.page,'session-paused');
    await active.page.getByRole('button',{name:'End Session',exact:true}).click();
    await expect(active.page.getByRole('dialog')).toHaveCount(1);
    await expect(active.page.getByRole('heading',{name:'Save and end session?'})).toBeVisible();
    await active.page.keyboard.press('Escape');
    await expect(active.page.getByRole('heading',{name:'Paused',exact:true})).toBeVisible();
    await active.page.evaluate(()=>window.__fixtureTracks[0].dispatchEvent(new Event('ended')));
    await expect(active.page.getByText(/The camera disconnected/)).toBeVisible();
    expect(await active.page.evaluate(()=>window.__fixtureTracks.every(t=>t.readyState==='ended'))).toBe(true);
    await active.page.getByRole('button',{name:'Retry camera and tracking'}).click();
    await expect(active.page.getByRole('dialog')).toBeVisible();
    await active.page.evaluate(()=>window.__fixtureGood=false);
    await active.page.getByRole('button',{name:'Resume Session'}).click();
    await expect(active.page.getByRole('region',{name:'Movement guidance'})).toBeVisible();
    await active.page.evaluate(()=>window.__fixtureGood=true);
    await expect(active.page.getByText('+1 star earned · 4 total')).toBeVisible();
    await checkLayout(active.page,'session-reward-320');
    expect(active.state.completions).toHaveLength(1);
    expect(active.state.writes.flat()).toHaveLength(2);
    expect(await active.page.evaluate(()=>window.__fixtureTracks.every(t=>t.readyState==='ended'))).toBe(true);
    expect(active.state.errors).toEqual([]);
    await active.context.close();
    console.log('PASS opt-in camera, preview, reps, accessible pause/exit, reconnection, single completion');

    const denied=await makeContext(browser);
    await denied.context.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError')}});
    await denied.page.goto(baseURL+'/session?exercise='+result.exerciseId);
    await denied.page.getByRole('button',{name:'Enable camera'}).click();
    await expect(denied.page.locator('p[role="alert"]')).toContainText('Camera permission is needed');
    await expect(denied.page.getByRole('button',{name:'Start session',exact:true})).toHaveCount(0);
    await checkLayout(denied.page,'camera-denied');
    await denied.context.close();

    const failedTracker=await makeContext(browser);
    await failedTracker.context.route('**/mediapipe/**',route=>route.abort());
    await failedTracker.context.addInitScript(()=>{
      window.Worker=undefined;
      const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async(...args)=>{
        const stream=await acquire(...args);
        window.__fixtureTracks=stream.getTracks();
        return stream;
      };
    });
    await failedTracker.page.goto(baseURL+'/session?exercise='+result.exerciseId);
    await failedTracker.page.getByRole('button',{name:'Enable camera'}).click();
    await expect(failedTracker.page.locator('p[role="alert"]')).toContainText('Movement tracking could not start',{timeout:20000});
    expect(await failedTracker.page.evaluate(()=>window.__fixtureTracks.every(t=>t.readyState==='ended'))).toBe(true);
    await expect(failedTracker.page.getByRole('button',{name:'Start session',exact:true})).toHaveCount(0);
    await failedTracker.context.close();

    const recovery=await makeContext(browser,320);
    recovery.state.repFailure=true;
    await recovery.page.goto(baseURL+'/health');
    await recovery.page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:pendingKey,value:result});
    await recovery.page.goto(baseURL+'/session?recover='+result.sessionId);
    await recovery.page.getByRole('button',{name:'Retry saving',exact:true}).click();
    await expect(recovery.page.locator('p[role="alert"]')).toContainText('repetitions could not be saved');
    await recovery.page.reload();
    recovery.state.repFailure=false;
    await recovery.page.getByRole('button',{name:'Retry saving',exact:true}).click();
    await expect(recovery.page.getByText('+1 star earned · 4 total')).toBeVisible();
    expect(recovery.state.writes).toHaveLength(2);
    expect(recovery.state.writes[0]).toEqual(recovery.state.writes[1]);
    expect(await recovery.page.evaluate(key=>localStorage.getItem(key),pendingKey)).toBeNull();
    expect(recovery.state.errors).toEqual([]);
    await recovery.context.close();
    console.log('PASS camera denial and Phase 1 durable save/retry regression checks');
  } finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
