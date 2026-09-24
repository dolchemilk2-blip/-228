// Собирает montage/index.html из src/: страница + ядро + интерфейс в одном файле,
// чтобы его можно было открыть и с GitHub Pages, и просто с диска.
import fs from 'fs';
const dir = new URL('./src/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');
const core = read('core.js');
const names = [...core.matchAll(/^export (?:const|function|let) (\w+)/gm)].map(m => m[1]);
const coreBody = core.replace(/^export /gm, '');
const app = read('app.js').replace(/^import \* as C from '\.\/core\.js';\n/m, '');
const bundle = `const C = (() => {\n${coreBody}\nreturn { ${names.join(', ')} };\n})();\n\n${app}`;
const page = read('page.html').replace('/*BUNDLE*/', () => bundle);
fs.writeFileSync(new URL('./index.html', import.meta.url), page);
console.log(`index.html: ${(page.length / 1024).toFixed(0)} КБ, ядро: ${names.length} функций`);
