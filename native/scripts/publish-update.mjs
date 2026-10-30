#!/usr/bin/env node
// Publish an OVER-THE-AIR update of Betty's JavaScript to her own server (voice.forme.africa/updates, behind the
// same `app` login as the voice server). Installed apps with the SAME native code (same runtime version, a
// fingerprint of every native piece) download it when they open and use it the next time they open.
// A change to native code (a module, a permission, a native library) gives a new runtime version: that needs a new
// APK / Xcode build (scripts/build-apk.sh), and old installs simply do not see the update.
//
//   node scripts/publish-update.mjs            # android and ios
//   node scripts/publish-update.mjs android    # one platform
//
// Server layout (/var/www/betty-updates): <runtime>/<platform>/manifest.json (the live one), <runtime>/<platform>/
// history/<id>.json (every one published, to roll back: copy one over manifest.json), files/<runtime>/<id>/... (the
// bundle and assets). Caddy maps the app's request (headers expo-runtime-version, expo-platform) to the manifest.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'root@139.84.250.9';
const REMOTE = '/var/www/betty-updates';
const BASE_URL = 'https://voice.forme.africa/updates';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const platforms = process.argv.slice(2).length ? process.argv.slice(2) : ['android', 'ios'];
const out = join(root, '.update-export');
const stage = join(root, '.update-stage');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
const sha256url = (buf) => createHash('sha256').update(buf).digest('base64url');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', json: 'application/json' };
/** A UUID made from the update's content, so publishing the same thing twice gives the same id. */
const uuidFrom = (hex) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;

console.log(`Exporting ${platforms.join(' + ')}...`);
rmSync(out, { recursive: true, force: true });
rmSync(stage, { recursive: true, force: true });
run('npx', ['expo', 'export', ...platforms.flatMap((p) => ['--platform', p]), '--output-dir', out], { stdio: ['ignore', 'inherit', 'inherit'] });
const meta = JSON.parse(readFileSync(join(out, 'metadata.json'), 'utf8'));

// The app config the app sees as Constants.expoConfig, WITHOUT the login header.
const expoClient = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json']));
if (expoClient.updates) delete expoClient.updates.requestHeaders;

const published = [];
for (const platform of platforms) {
  const fm = meta.fileMetadata[platform];
  if (!fm) throw new Error(`no ${platform} in the export`);
  const runtime = JSON.parse(run('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', platform])).runtimeVersion;
  const bundle = readFileSync(join(out, fm.bundle));
  const files = [{ path: fm.bundle, buf: bundle, ext: 'bundle' }, ...fm.assets.map((a) => ({ path: a.path, buf: readFileSync(join(out, a.path)), ext: a.ext }))];
  const id = uuidFrom(createHash('sha256').update(platform + runtime + files.map((f) => sha256url(f.buf)).join()).digest('hex'));
  const url = (p) => `${BASE_URL}/files/${runtime}/${id}/${p}`;
  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    runtimeVersion: runtime,
    launchAsset: { hash: sha256url(bundle), key: md5(bundle), contentType: 'application/javascript', fileExtension: '.bundle', url: url(fm.bundle) },
    assets: files.slice(1).map((f) => ({ hash: sha256url(f.buf), key: md5(f.buf), contentType: TYPES[f.ext] ?? 'application/octet-stream', fileExtension: `.${f.ext}`, url: url(f.path) })),
    metadata: {},
    extra: { expoClient },
  };
  const dir = join(stage, runtime, platform);
  mkdirSync(join(dir, 'history'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'history', `${id}.json`), JSON.stringify(manifest));
  for (const f of files) { const to = join(stage, 'files', runtime, id, f.path); mkdirSync(dirname(to), { recursive: true }); cpSync(join(out, f.path), to); }
  published.push({ platform, runtime, id, kb: Math.round(bundle.length / 1024), assets: files.length - 1 });
}

console.log('Uploading...');
run('ssh', [HOST, `mkdir -p ${REMOTE}`]);
// Files first, the manifests last: an app never reads a manifest whose files are not there yet.
run('rsync', ['-az', '--exclude', '*/manifest.json', `${stage}/`, `${HOST}:${REMOTE}/`], { stdio: ['ignore', 'inherit', 'inherit'] });
run('rsync', ['-az', `${stage}/`, `${HOST}:${REMOTE}/`], { stdio: ['ignore', 'inherit', 'inherit'] });
run('ssh', [HOST, `chown -R caddy:caddy ${REMOTE} 2>/dev/null || true`]);
rmSync(out, { recursive: true, force: true });
rmSync(stage, { recursive: true, force: true });
for (const p of published) console.log(`Published ${p.platform}: update ${p.id} (bundle ${p.kb} KB, ${p.assets} assets) for runtime ${p.runtime}`);
console.log('Phones with that build get it the next time Betty opens, and run it the time after (or Garage > Check for updates).');
