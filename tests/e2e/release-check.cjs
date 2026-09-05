/* Run after npm run build. Owns a production server and tests all three engines. */
const { spawn, execFileSync } = require('node:child_process');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');

async function main() {
  const port = process.env.E2E_PORT || '3101';
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid E2E_PORT');
  const baseURL = `http://127.0.0.1:${port}`;
  // Refuse an occupied port rather than accidentally checking another build.
  const net = require('node:net');
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(Number(port), '127.0.0.1', () => probe.close(resolve));
  });
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: 'inherit' });
  let serverFailed = false;
  server.on('error', () => { serverFailed = true; });
  server.on('exit', () => { serverFailed = true; });
  const report = { startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim(), workingTree: execFileSync('git', ['diff', '--name-only'], { encoding:'utf8' }).trim().split('\n').filter(Boolean), database: 'mocked', camera: 'synthetic', browsers: [] };
  let activeTest;
  const stop = () => { activeTest?.kill(); server.kill(); };
  const interrupted = () => { stop(); process.exit(130); };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (serverFailed) throw new Error('Production server exited before readiness');
      try { ready = (await fetch(baseURL+'/health', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
      if (ready) break;
      await delay(500);
    }
    if (!ready) throw new Error('Production server did not become ready');
    for (const browser of ['chromium', 'webkit', 'firefox']) {
      const code = await new Promise((resolve, reject) => {
        activeTest = spawn(process.execPath, [path.join(__dirname, 'patient-experience.cjs')], {
          stdio: 'inherit', env: { ...process.env, E2E_BASE_URL: baseURL, E2E_BROWSER: browser },
        });
        const timeout = setTimeout(() => activeTest.kill(), 10 * 60 * 1000);
        activeTest.once('error', error => { clearTimeout(timeout); reject(error); });
        activeTest.once('exit', code => { clearTimeout(timeout); resolve(code); });
      });
      const coverage = code === 0 ? JSON.parse(await readFile(`test-results/${browser}/coverage.json`,'utf8')) : null;
      report.browsers.push({ browser, passed: code === 0, exitCode: code, coverage });
    }
    if (report.browsers.some(entry => !entry.passed)) process.exitCode = 1;
  } finally {
    stop();
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    report.finishedAt = new Date().toISOString();
    await mkdir('test-results', { recursive:true });
    await writeFile('test-results/release-browser-report.json', JSON.stringify(report, null, 2)+'\n');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
