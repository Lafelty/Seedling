const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
const ref = new URL(origin).hostname.split('.')[0];
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test', user_metadata: {}, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const token = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url') + '.test';
const session = { access_token: token, refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user };
const result = { version: 1, userId: user.id, sessionId: '22222222-2222-4222-8222-222222222222', exerciseId: '33333333-3333-4333-8333-333333333333', exerciseName: 'Shoulder raise', startedAt: new Date().toISOString(), completed: true, durationSeconds: 24, targetReps: 1, formQualityScore: 60, reps: [{ id: '44444444-4444-4444-8444-444444444444', repNumber: 1, holdDuration: 500, formScore: 80, timestamp: new Date().toISOString() }] };
const pendingKey = `medproj_pending_session_${user.id}_${result.sessionId}`;
const group = { id: '55555555-5555-4555-8555-555555555555', name: 'Shoulder mobility', description: 'A gentle place to start.', sort_order: 0 };
const exercise = { id: result.exerciseId, group_id: group.id, rank_in_group: 0, difficulty: 'easy', unlock_min_score: null, unlock_max_seconds: null, name: 'Shoulder raise', description: 'Follow the recorded movement.', exercise_type: 'static', tracking_mode: 'body', target_reps: 2, hold_duration_ms: 500, pose_criteria: { targetBodyParts: ['left_shoulder','left_elbow','left_wrist'], criteria: [{ joint:'left_elbow', targetAngle:90, minAngle:80, maxAngle:100, relativeTo:['left_shoulder','left_wrist'] }], levelingRules: [] }, recorded_paths: [], feedback_messages: {}, demo_images: [] };

async function makeContext(browser, width = 390) {
  const state = { profileFailure: false, historyFailure: false, repFailure: false, completionFailure: false, awardFailure: false, historyRows: [], writes: [], completions: [], awards: [], errors: [], profileWrites: [] };
  const chromium = browser.browserType().name() === 'chromium';
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', permissions: chromium ? ['camera'] : [] });
  if (!chromium) {
    // A real MediaStream from a generated canvas; no hardware or permission UI.
    // This exercises video playback/lifecycle, not physical camera compatibility.
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return; // about:blank / axe's sandboxed frames
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const paint = () => {
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#526958';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        };
        paint();
        const stream = canvas.captureStream(15);
        const timer = setInterval(paint, 66);
        const track = stream.getVideoTracks()[0];
        // Firefox's automation realm needs explicit synthetic-event opt-in.
        // Other engines ignore the fourth addEventListener argument.
        const listen = track.addEventListener.bind(track);
        track.addEventListener = (type, callback, options) => listen(type, callback, options, true);
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        return stream;
      };
    });
  }
  await context.addCookies([{ name: `sb-${ref}-auth-token`, value: 'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'), url: baseURL, sameSite: 'Lax' }]);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      const path = url.pathname;
      if (path.includes('/auth/v1/user')) return route.fulfill({ json: user });
      if (path.includes('/auth/v1/logout')) return route.fulfill({ status: 204 });
      if (path.endsWith('/rep_data')) { state.writes.push(request.postDataJSON()); return route.fulfill({ status: state.repFailure ? 503 : 201, json: state.repFailure ? { message: 'Fixture offline' } : null }); }
      if (path.endsWith('/rpc/complete_session')) { state.completions.push(request.postDataJSON()); return route.fulfill({ status: state.completionFailure ? 503 : 200, json: state.completionFailure ? {message:'Fixture offline'} : true }); }
      if (path.endsWith('/rpc/award_stars')) { state.awards.push(request.postDataJSON()); return route.fulfill({ status: state.awardFailure ? 503 : 200, json: state.awardFailure ? {message:'Fixture offline'} : 4 }); }
      if (path.endsWith('/profiles')) {
        if (request.method() !== 'GET') state.profileWrites.push(request.postDataJSON());
        return route.fulfill({ status: state.profileFailure ? 503 : 200, json: state.profileFailure ? {message:'Fixture offline'} : { email: user.email, name: 'Fixture Patient', is_admin: false, total_stars: 4, phone: '', avatar_path: null, height_cm: null, weight_kg: null, guardian_email: 'guardian@example.test', guardian_notify: true } });
      }
      if (path.endsWith('/therapy_sessions')) return route.fulfill({ status: state.historyFailure ? 503 : 200, json: state.historyFailure ? {message:'Fixture offline'} : request.method() === 'POST' ? {id:result.sessionId} : state.historyRows });
      if (path.endsWith('/exercises')) return route.fulfill({ json: url.searchParams.get('select').includes('pose_criteria') ? exercise : [exercise] });
      if (path.endsWith('/exercise_groups')) return route.fulfill({ json: [group] });
      throw new Error('Unmocked database endpoint: '+path);
    }
    if (url.origin === baseURL) {
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { mocked: true } });
      return route.continue();
    }
    return route.abort(); // Never send real database writes, video, or email.
  });
  const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  return { context, page, state };
}

async function fakeTracking(context) {
  await context.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    window.__fixtureGood = false;
    window.__cameraRequests = 0;
    window.Worker = class {
      postMessage(message) {
        message.bitmap?.close();
        const angle = window.__fixtureGood ? Math.PI/2 : Math.PI;
        const pose = { keypoints: [
          {name:'left_shoulder',x:200,y:100,score:1},
          {name:'right_shoulder',x:400,y:100,score:1},
          {name:'left_elbow',x:200,y:200,score:1},
          {name:'left_wrist',x:200+100*Math.sin(angle),y:200-100*Math.cos(angle),score:1},
        ]};
        setTimeout(() => this.onmessage?.({data:{id:message.id,ok:true,pose}}), 10);
      }
      terminate() {}
    };
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__cameraRequests++;
      const stream = await acquire(...args);
      window.__fixtureTracks = stream.getTracks();
      return stream;
    };
  });
}

module.exports = { makeContext, fakeTracking, baseURL, user, result, pendingKey, group, exercise };
