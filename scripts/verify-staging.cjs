/* Real database contract check. Uses two dedicated patients, never a service key.
 * Creates one labelled session and awards one star; leaves evidence for review.
 * No migration, account creation, email, upload, or cleanup is performed.
 */
const { readFileSync, existsSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { parseEnv } = require('node:util');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');

function configuration() {
  const file = process.env.STAGING_ENV_FILE || '.env.staging.local';
  const values = { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env };
  const required = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_EXPECTED_HOST', 'STAGING_PATIENT_EMAIL', 'STAGING_PATIENT_PASSWORD', 'STAGING_OTHER_EMAIL', 'STAGING_OTHER_PASSWORD', 'STAGING_EXERCISE_ID'];
  const missing = required.filter(key => !values[key]);
  if (missing.length) throw new Error('Staging configuration missing: '+missing.join(', ')+'. See .env.staging.example. No requests were sent.');
  const url = new URL(values.STAGING_SUPABASE_URL);
  assert.equal(url.host, values.STAGING_EXPECTED_HOST, 'Staging host does not match STAGING_EXPECTED_HOST');
  assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)), 'Use HTTPS or local Supabase');
  assert.ok(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Staging URL must be an origin');
  assert.notEqual(values.STAGING_PATIENT_EMAIL, values.STAGING_OTHER_EMAIL, 'Use two different test patients');
  assert.match(values.STAGING_EXERCISE_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid exercise ID');
  const key = values.STAGING_SUPABASE_ANON_KEY;
  if (!key.startsWith('sb_publishable_')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* invalid key */ }
    assert.equal(role, 'anon', 'Use a public anon/publishable key, never a privileged key');
  }
  return values;
}

async function main() {
  const config = configuration();
  if (process.argv.includes('--check-config')) { console.log('PASS staging configuration (no requests sent)'); return; }
  const report = { startedAt: new Date().toISOString(), host: config.STAGING_EXPECTED_HOST, sessionId: null, passed: false, checks: [] };
  const pass = message => { report.checks.push(message); console.log('PASS '+message); };
  const checked = async (label, query) => {
    const response = await query;
    if (response.error) throw new Error(`${label} failed (${response.error.code || 'network/auth error'})`);
    return response.data;
  };
  let repFault = null;
  const makeClient = (injectFault = false) => createClient(config.STAGING_SUPABASE_URL, config.STAGING_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url || input.toString());
      const fault = injectFault && init?.method === 'POST' && url.pathname.endsWith('/rep_data') ? repFault : null;
      if (fault) repFault = null;
      if (fault === 'offline') throw new TypeError('Simulated offline request');
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
      if (fault === 'lost-response' && response.ok) {
        await response.arrayBuffer();
        throw new TypeError('Simulated response lost after committed write');
      }
      return response;
    } },
  });
  const patient = makeClient(true);
  const other = makeClient();
  try {
    const a = await checked('Patient sign-in', patient.auth.signInWithPassword({email:config.STAGING_PATIENT_EMAIL,password:config.STAGING_PATIENT_PASSWORD}));
    const b = await checked('Other patient sign-in', other.auth.signInWithPassword({email:config.STAGING_OTHER_EMAIL,password:config.STAGING_OTHER_PASSWORD}));
    assert.notEqual(a.user.id, b.user.id, 'Accounts must differ');
    const profile = await checked('Patient profile', patient.from('profiles').select('is_admin,total_stars').eq('id',a.user.id).single());
    const otherProfile = await checked('Other profile', other.from('profiles').select('is_admin,total_stars').eq('id',b.user.id).single());
    assert.equal(profile.is_admin, false, 'Primary account must be a dedicated non-admin patient');
    assert.equal(otherProfile.is_admin, false, 'Other account must be a dedicated non-admin patient');
    const exercise = await checked('Exercise read', patient.from('exercises').select('id,exercise_type').eq('id',config.STAGING_EXERCISE_ID).single());
    pass('Two non-admin patients authenticate and the configured exercise is readable');

    const opened = await checked('Session start', patient.from('therapy_sessions').insert({user_id:a.user.id,exercise_id:exercise.id,exercise_type:exercise.exercise_type,started_at:new Date().toISOString(),target_reps:2,notes:'Release verification '+report.startedAt}).select('id').single());
    report.sessionId = opened.id;
    const readSession = () => checked('Session read', patient.from('therapy_sessions').select('completed_at,duration_seconds,completed_reps,form_quality_score,stars_awarded').eq('id',opened.id).single());
    const complete = {p_session_id:opened.id,p_completed:true,p_duration_seconds:24,p_completed_reps:2,p_form_quality_score:60};
    assert.deepEqual(await checked('Cross-account session read', other.from('therapy_sessions').select('id').eq('id',opened.id)), []);
    const forbiddenCompletion = await other.rpc('complete_session', complete);
    assert.equal(forbiddenCompletion.error?.code, '42501', 'Another patient must not complete this session');
    const forbiddenRep = await other.from('rep_data').insert({id:randomUUID(),session_id:opened.id,rep_number:1,hold_duration_ms:500,form_score:80,timestamp:new Date().toISOString()});
    assert.equal(forbiddenRep.error?.code, '42501', 'Another patient must not insert repetitions');
    assert.equal(await checked('Cross-account award', other.rpc('award_stars',{p_session_id:opened.id})), otherProfile.total_stars);
    assert.equal((await readSession()).stars_awarded, false);
    pass('Cross-account session reads, repetition writes, completion and awards are isolated');

    assert.equal(await checked('Incomplete award', patient.rpc('award_stars',{p_session_id:opened.id})), profile.total_stars);
    const reps = [1,2].map(rep_number => ({id:randomUUID(),session_id:opened.id,rep_number,hold_duration_ms:500,form_score:80,timestamp:new Date().toISOString()}));
    const upsert = () => patient.from('rep_data').upsert(reps,{onConflict:'id',ignoreDuplicates:true});
    const readReps = () => checked('Repetition read', patient.from('rep_data').select('id,rep_number,hold_duration_ms,form_score').eq('session_id',opened.id).order('rep_number'));
    repFault = 'offline';
    assert.ok((await upsert()).error, 'Offline attempt must report failure');
    assert.equal((await readReps()).length, 0);
    assert.equal((await readSession()).completed_at, null);
    repFault = 'lost-response';
    assert.ok((await upsert()).error, 'Lost response must report failure');
    assert.equal((await readReps()).length, 2, 'Ambiguous write actually committed');
    await checked('Repetition retry', upsert());
    assert.deepEqual(await readReps(), reps.map(({id,rep_number,hold_duration_ms,form_score}) => ({id,rep_number,hold_duration_ms,form_score})));
    assert.deepEqual(await checked('Cross-account repetition read', other.from('rep_data').select('id').eq('session_id',opened.id)), []);
    pass('Offline and lost-response repetition retries persist exactly two rows with stable IDs');

    assert.equal(await checked('Completion', patient.rpc('complete_session',complete)), true);
    const saved = await readSession();
    assert.ok(saved.completed_at);
    assert.equal(saved.duration_seconds,24);
    assert.equal(saved.completed_reps,2);
    assert.equal(Number(saved.form_quality_score),60);
    assert.equal(await checked('Completion retry', patient.rpc('complete_session',{...complete,p_duration_seconds:99})), false);
    assert.deepEqual(await readSession(), saved);
    const totals = await Promise.all([1,2,3].map(() => checked('Concurrent award',patient.rpc('award_stars',{p_session_id:opened.id}))));
    totals.forEach(total => assert.equal(total,profile.total_stars+1));
    assert.equal(await checked('Award retry',patient.rpc('award_stars',{p_session_id:opened.id})),profile.total_stars+1);
    assert.equal((await readSession()).stars_awarded,true);
    const finalProfile = await checked('Final stars',patient.from('profiles').select('total_stars').eq('id',a.user.id).single());
    assert.equal(finalProfile.total_stars,profile.total_stars+1);
    const forbiddenStars = await patient.from('profiles').update({total_stars:finalProfile.total_stars}).eq('id',a.user.id);
    assert.equal(forbiddenStars.error?.code,'42501','Patients must not directly edit stars');
    const forbiddenSession = await patient.from('therapy_sessions').update({stars_awarded:true}).eq('id',opened.id);
    assert.equal(forbiddenSession.error?.code,'42501','Patients must not directly edit the completion ledger');
    pass('Completion is final and concurrent/repeated awards produce exactly one star');
    pass('Direct star and session-ledger updates are denied');
    report.passed = true;
  } catch (error) {
    // Do not print raw SDK responses or credentials in reports.
    report.failure = error.message;
    throw error;
  } finally {
    await Promise.allSettled([patient.auth.signOut({scope:'local'}),other.auth.signOut({scope:'local'})]);
    report.finishedAt = new Date().toISOString();
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/staging-report.json',JSON.stringify(report,null,2)+'\n');
    console.log('Staging evidence: test-results/staging-report.json');
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { configuration };
