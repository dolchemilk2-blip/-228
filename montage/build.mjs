// Собирает montage/index.html из src/: страница + ядро + обработка звука + интерфейс в одном
// файле, чтобы его можно было открыть и с GitHub Pages, и просто с диска.
import fs from 'fs';
const dir = new URL('./src/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');
const strip = src => src.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '');
const names = src => [...src.matchAll(/^export (?:const|function|let) (\w+)/gm)].map(m => m[1]);
const core = read('core.js'), dsp = read('dsp.js'), master = read('master.js'), sfx = read('sfx.js');
const lib = strip(core) + '\n' + strip(dsp) + '\n' + strip(master) + '\n' + strip(sfx), libNames = [...names(core), ...names(dsp), ...names(master), ...names(sfx)];
const bundleLib = `const C = (() => {\n${lib}\nreturn { ${libNames.join(', ')} };\n})();`;
// фоновый воркер обработки звука: то же ядро плюс приём сообщений
const workerSrc = lib + `
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'analyze') { self.postMessage({ id: m.id, type: 'analyzed', A: analyze(m.y), noise: noiseProfile(m.y), ltas: m.wantLtas ? ltas(m.y, 2) : null }); }
    else if (m.type === 'run') { const r = runChain(m.y, m.chain, m.aux || {}, p => self.postMessage({ id: m.id, type: 'progress', p })); self.postMessage({ id: m.id, type: 'done', y: r.y, log: r.log }, [r.y.buffer]); }
  } catch (err) { self.postMessage({ id: m.id, type: 'error', message: String(err && err.message || err) }); }
};`;
const app = strip(read('app.js')), cleanup = strip(read('cleanup.js')), sounds = strip(read('sounds.js')), sfxdb = strip(read('sfxdb.js')), timeline = strip(read('timeline.js')), fx = strip(read('fx.js')), amb = strip(read('amb.js')), extras = strip(read('extras.js'));
const bundle = `${bundleLib}\nconst DSP_WORKER_SRC = ${JSON.stringify(workerSrc)};\n\n${cleanup}\n\n${sounds}\n\n${sfxdb}\n\n${fx}\n\n${amb}\n\n${timeline}\n\n${extras}\n\n${app}`;
const page = read('page.html').replace('/*BUNDLE*/', () => bundle);
fs.writeFileSync(new URL('./index.html', import.meta.url), page);
console.log(`index.html: ${(page.length / 1024).toFixed(0)} КБ, ядро: ${libNames.length} функций`);
