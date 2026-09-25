// Собирает montage/index.html из src/: страница + ядро + обработка звука + интерфейс в одном
// файле, чтобы его можно было открыть и с GitHub Pages, и просто с диска.
import fs from 'fs';
const dir = new URL('./src/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');
const strip = src => src.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '');
const names = src => [...src.matchAll(/^export (?:const|function\*?|let) ?(\w+)/gm)].map(m => m[1]);
const core = read('core.js'), dsp = read('dsp.js'), master = read('master.js'), fxdsp = read('fxdsp.js'), sfx = read('sfx.js');
const lib = strip(core) + '\n' + strip(dsp) + '\n' + strip(master) + '\n' + strip(fxdsp) + '\n' + strip(sfx), libNames = [...names(core), ...names(dsp), ...names(master), ...names(fxdsp), ...names(sfx)];
const bundleLib = `const C = (() => {\n${lib}\nreturn { ${libNames.join(', ')} };\n})();`;
// фоновый воркер обработки звука: то же ядро плюс приём сообщений
const workerSrc = lib + `
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'analyze') { self.postMessage({ id: m.id, type: 'analyzed', A: analyze(m.y), noise: noiseProfile(m.y), ltas: m.wantLtas ? ltas(m.y, 2) : null }); }
    else if (m.type === 'fx') { const y = fxProcess(m.y, m.key); self.postMessage({ id: m.id, type: 'done', y }, [y.buffer]); }
    else if (m.type === 'preview') {                 // отрывок чистки: спектры и громкость «было/стало» — тоже здесь, не в главном потоке
      const specBefore = avgSpectrum(m.y, m.freqs), lufsBefore = integratedLufs(m.y), sgBefore = m.sg && m.sgBefore ? { ...spectrogram(m.y, m.sg), w: m.sg.cols } : null, r = runChain(m.y, m.chain, m.aux || {});
      const sgAfter = m.sg ? { ...spectrogram(r.y, m.sg), w: m.sg.cols } : null;       // и спектрограмма «стало»
      self.postMessage({ id: m.id, type: 'done', y: r.y, log: r.log, specBefore, specAfter: avgSpectrum(r.y, m.freqs), lufsBefore, lufsAfter: integratedLufs(r.y), sgAfter, sgBefore }, [r.y.buffer]);
    }
    else if (m.type === 'synth') { const y = synthSound(m.key).slice(); self.postMessage({ id: m.id, type: 'done', y }, [y.buffer]); }   // заглушки звуков — тоже в фоне
    else if (m.type === 'run') { const r = runChain(m.y, m.chain, m.aux || {}, p => self.postMessage({ id: m.id, type: 'progress', p })); self.postMessage({ id: m.id, type: 'done', y: r.y, log: r.log }, [r.y.buffer]); }
  } catch (err) { self.postMessage({ id: m.id, type: 'error', message: String(err && err.message || err) }); }
};`;
const app = strip(read('app.js')), cleanup = strip(read('cleanup.js')), sounds = strip(read('sounds.js')), sfxdb = strip(read('sfxdb.js')), timeline = strip(read('history.js')) + '\n' + strip(read('timeline.js')) + '\n' + strip(read('motion.js')) + '\n' + strip(read('deck.js')), fx = strip(read('fx.js')), amb = strip(read('amb.js')), extras = strip(read('extras.js')) + '\n' + strip(read('video.js')) + '\n' + strip(read('read.js')) + '\n' + strip(read('record.js'));
const icons = strip(read('icons.js')) + '\n' + strip(read('spring.js')) + '\n' + strip(read('fader.js')) + '\n' + strip(read('nums.js'));
const bundle = `${bundleLib}\nconst DSP_WORKER_SRC = ${JSON.stringify(workerSrc)};\n\n${icons}\n\n${cleanup}\n\n${sounds}\n\n${sfxdb}\n\n${fx}\n\n${amb}\n\n${timeline}\n\n${extras}\n\n${app}`;
const page = read('page.html').replace('/*BUNDLE*/', () => bundle);
fs.writeFileSync(new URL('./index.html', import.meta.url), page);
console.log(`index.html: ${(page.length / 1024).toFixed(0)} КБ, ядро: ${libNames.length} функций`);
