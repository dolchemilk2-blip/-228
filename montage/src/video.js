// Монтажка — субтитры и видео для YouTube.
// Субтитры (.srt, .vtt) — из раскладки сведения: реплика с именем говорящего, звук — в квадратных скобках
// по тексту ремарки (как принято в субтитрах для слабослышащих). Длинное делится на куски по две строки
// до 42 знаков, время делится по длине текста.
// Видео — кадры рисуются на холсте и кодируются WebCodecs (H.264 + AAC в MP4, если браузер умеет; иначе
// VP9 + Opus в WebM), упаковщик mp4-muxer / webm-muxer грузится с jsDelivr только при сборке.
// Кадр — в мире Монтажки: тёмная дека, обложка или стрелочный индикатор, имя и реплика, сцена, волна всего
// спектакля с курсором. Считается быстрее реального времени; прогресс — в «острове».
// Использует S, C, $, esc, fmt, charName, colorOf, cssVar, progress, notify, download из app.js.
const MP4_MUX = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm', WEBM_MUX = 'https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/+esm';
const SUB_LINE = 42, SUB_MAX = 84;
/** Реплики и звуки дорожки как куски субтитров: [{a, b, text, who, spk}]. */
function subCues({ names = true } = {}) {
  const r = S.result; if (!r || !r.lay) return [];
  const out = [];
  for (const row of r.lay.rows) {
    if (!row.recorded || row.bed || row.dur < 0.15) continue;
    const c = row.cue, line = c.type === 'line';
    const body = row.sound ? `[${c.text.replace(/^[(\[]|[)\]]$/g, '')}]` : line ? c.text.replace(/^[—–-]\s*/, '') : `(${c.text.replace(/^[(]|[)]$/g, '')})`;
    const parts = subSplit(body), total = parts.reduce((s, p) => s + p.length, 0);
    let t = row.at;
    parts.forEach((p, i) => {
      const d = row.dur * p.length / total, who = line && i === 0 && names ? charName(c.spk) : '';
      out.push({ a: t, b: t + Math.max(0.8, d), text: (who ? who + ': ' : '') + p, who: line ? charName(c.spk) : '', spk: line ? c.spk : null, id: c.id });
      t += d;
    });
  }
  for (let i = 1; i < out.length; i++) if (out[i].a < out[i - 1].b) out[i - 1].b = Math.max(out[i - 1].a + 0.3, out[i].a - 0.02);   // без наложений
  return out;
}
/** Деление по фразам, потом по словам: куски не длиннее двух строк. */
function subSplit(text) {
  const bits = String(text).split(/(?<=[.!?…])\s+|(?<=[,;:—])\s+/), out = [];
  let cur = '';
  for (const b of bits) {
    if ((cur + ' ' + b).trim().length <= SUB_MAX) { cur = (cur + ' ' + b).trim(); continue; }
    if (cur) out.push(cur);
    if (b.length <= SUB_MAX) { cur = b; continue; }
    let w = ''; for (const word of b.split(/\s+/)) { if ((w + ' ' + word).trim().length > SUB_MAX) { out.push(w); w = word; } else w = (w + ' ' + word).trim(); }
    cur = w;
  }
  if (cur) out.push(cur);
  return out;
}
/** Перенос: разрыв у пробела ближе к середине, если строка длиннее 42. */
function subWrap(s) {
  if (s.length <= SUB_LINE) return s;
  let best = -1; for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - s.length / 2) < Math.abs(best - s.length / 2))) best = i;
  return best < 0 ? s : s.slice(0, best) + '\n' + s.slice(best + 1);
}
const subTime = (t, sep) => { const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
function srtText() { return subCues().map((c, i) => `${i + 1}\n${subTime(c.a, ',')} --> ${subTime(c.b, ',')}\n${subWrap(c.text)}\n`).join('\n'); }
function vttText() { return 'WEBVTT\n\n' + subCues().map((c, i) => `${i + 1}\n${subTime(c.a, '.')} --> ${subTime(c.b, '.')}\n${subWrap(c.text)}\n`).join('\n'); }
// ------------------------------------------------------------------ видео
/** Лучший формат, который браузер умеет кодировать. */
async function videoFormat(W, H, fps) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;
  const v = async c => { try { return (await VideoEncoder.isConfigSupported(c)).supported; } catch { return false; } };
  const a = async c => { try { return (await AudioEncoder.isConfigSupported(c)).supported; } catch { return false; } };
  const avc = { codec: 'avc1.4d0028', width: W, height: H, bitrate: 2_500_000, framerate: fps, avc: { format: 'avc' } };
  const vp9 = { codec: 'vp09.00.31.08', width: W, height: H, bitrate: 2_000_000, framerate: fps };
  const vp8 = { codec: 'vp8', width: W, height: H, bitrate: 2_000_000, framerate: fps };
  const aac = { codec: 'mp4a.40.2', sampleRate: C.SR, numberOfChannels: 1, bitrate: 160_000 };
  const opus = { codec: 'opus', sampleRate: C.SR, numberOfChannels: 1, bitrate: 128_000 };
  if (await v(avc) && await a(aac)) return { ext: 'mp4', type: 'video/mp4', v: avc, a: aac, lib: MP4_MUX, vc: 'avc', ac: 'aac' };
  if (await v(avc) && await a(opus)) return { ext: 'mp4', type: 'video/mp4', v: avc, a: opus, lib: MP4_MUX, vc: 'avc', ac: 'opus' };
  if (await v(vp9) && await a(opus)) return { ext: 'webm', type: 'video/webm', v: vp9, a: opus, lib: WEBM_MUX, vc: 'V_VP9', ac: 'A_OPUS' };
  if (await v(vp8) && await a(opus)) return { ext: 'webm', type: 'video/webm', v: vp8, a: opus, lib: WEBM_MUX, vc: 'V_VP8', ac: 'A_OPUS' };
  return null;
}
/**
 * Видео спектакля. opt: { title, cover (ImageBitmap|null), fps = 24, from = 0, to = конец } — from/to для пробы.
 * Возвращает Blob.
 */
async function buildVideo(opt = {}) {
  const r = S.result; if (!r || !r.out) throw new Error('сначала сведите спектакль');
  const W = 1280, H = 720, fps = opt.fps || 24, SR = C.SR;
  const fo = await videoFormat(W, H, fps); if (!fo) throw new Error('этот браузер не умеет собирать видео — нужен Chrome, Edge или Safari 17+');
  progress('Видео: загружаю упаковщик…', 0.01);
  const lib = await import(fo.lib);
  const target = new lib.ArrayBufferTarget();
  const muxer = fo.ext === 'mp4'
    ? new lib.Muxer({ target, video: { codec: fo.vc, width: W, height: H }, audio: { codec: fo.ac, numberOfChannels: 1, sampleRate: SR }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
    : new lib.Muxer({ target, video: { codec: fo.vc, width: W, height: H, frameRate: fps }, audio: { codec: fo.ac, numberOfChannels: 1, sampleRate: SR }, firstTimestampBehavior: 'offset' });
  let fail = null;
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { fail = e; } }); ve.configure(fo.v);
  const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { fail = e; } }); ae.configure(fo.a);
  const t0 = Math.max(0, opt.from || 0), t1 = Math.min(r.out.length / SR, opt.to || r.out.length / SR);
  const a0 = Math.round(t0 * SR), a1 = Math.round(t1 * SR);
  for (let i = a0; i < a1; i += SR) {
    const n = Math.min(SR, a1 - i), data = r.out.slice(i, i + n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i - a0) / SR * 1e6), data });
    ae.encode(ad); ad.close();
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { alpha: false }), draw = videoPainter(g, W, H, opt);
  const frames = Math.ceil((t1 - t0) * fps), started = performance.now();
  for (let k = 0; k < frames; k++) {
    if (fail) throw fail;
    if (VIDEO.cancel) throw new Error('остановлено');
    draw(t0 + k / fps, 1 / fps);
    const vf = new VideoFrame(cv, { timestamp: Math.round(k * 1e6 / fps), duration: Math.round(1e6 / fps) });
    ve.encode(vf, { keyFrame: k % (fps * 2) === 0 }); vf.close();
    if (ve.encodeQueueSize > 8) await new Promise(res => { const tick = () => ve.encodeQueueSize > 4 ? setTimeout(tick, 4) : res(); tick(); });
    if (k % fps === 0) {
      const p = k / frames, el = (performance.now() - started) / 1000, left = p > 0.02 ? el / p - el : null;
      progress(`Видео: ${fmt(t0 + k / fps)} из ${fmt(t1)}${left != null ? ` · осталось ≈ ${Math.max(1, Math.round(left / 60))} мин` : ''}`, p);
      await new Promise(res => setTimeout(res, 0));
    }
  }
  await ve.flush(); await ae.flush(); if (fail) throw fail;
  muxer.finalize(); ve.close(); ae.close();
  return { blob: new Blob([target.buffer], { type: fo.type }), ext: fo.ext, codec: fo.vc + '+' + fo.ac };
}
const VIDEO = { cancel: false, busy: false };
/** Рисовальщик кадра: всё тяжёлое (фон, волна) — один раз, на кадр — только то, что меняется. */
function videoPainter(g, W, H, opt) {
  const r = S.result, SR = C.SR, total = r.out.length / SR, cues = subCues({ names: false }), chs = typeof chapterList === 'function' ? chapterList() : [];
  const DARK = { c1: '#8DB1E6', c2: '#E59ABD', c3: '#7ED0A8', c4: '#B9A3EA', c5: '#EDB072', c6: '#85CDE0', c7: '#DDAE8C', c8: '#C6D27C' }, amber = '#F2B233', ink = '#EFE9E2', muted = '#ABA197', deck = '#14110F', onair = '#E54B3D';
  const disp = cssVar('--display') || 'sans-serif', sans = cssVar('--sans') || 'sans-serif', mono = cssVar('--mono') || 'monospace';
  // фон
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H; const b = bg.getContext('2d');
  b.fillStyle = deck; b.fillRect(0, 0, W, H);
  const glow = b.createRadialGradient(W * 0.28, H * 0.42, 20, W * 0.28, H * 0.42, W * 0.6); glow.addColorStop(0, 'rgba(242,178,51,0.10)'); glow.addColorStop(1, 'rgba(242,178,51,0)'); b.fillStyle = glow; b.fillRect(0, 0, W, H);
  b.fillStyle = '#0E0C0B'; b.fillRect(0, 0, W, 64); b.fillStyle = '#342C26'; b.fillRect(0, 64, W, 1);
  b.font = `700 24px ${disp}`; b.fillStyle = ink; b.textBaseline = 'middle'; b.fillText(opt.title || 'Радиоспектакль', 40, 33);
  // волна всего спектакля: серая и янтарная (сыгранное)
  const WX = 40, WY = H - 96, WW = W - 80, WH = 44, peaks = new Float32Array(WW);
  { const per = Math.max(1, Math.floor(r.out.length / WW)); for (let x = 0; x < WW; x++) { let m = 0; for (let i = x * per, e = Math.min(r.out.length, (x + 1) * per); i < e; i += 16) { const v = Math.abs(r.out[i]); if (v > m) m = v; } peaks[x] = m; } }
  const wave = color => { const cc = document.createElement('canvas'); cc.width = WW; cc.height = WH; const q = cc.getContext('2d'); q.fillStyle = color; for (let x = 0; x < WW; x++) { const h = Math.max(1, Math.min(1, peaks[x] * 1.3) * WH); q.fillRect(x, (WH - h) / 2, 1, h); } return cc; };
  const wGrey = wave('#3B332C'), wAmber = wave(amber);
  for (const sc of r.lay.scenes || []) { b.fillStyle = '#4A4038'; b.fillRect(WX + sc.start / total * WW, WY - 6, 1, WH + 12); }
  // обложка
  const cover = opt.cover || null, CX = 60, CY = 120, CS = 380;
  // стрелка VU — пружина по кадрам, как на деке
  let ang = -50, vel = 0;
  const vuA = db => { const v = Math.pow(10, Math.max(-20, Math.min(3, db)) / 20); return -48 + 96 * (v - 0.1) / (Math.pow(10, 0.15) - 0.1); };
  const rms = (t, win = 0.3) => { const a = Math.max(0, Math.round((t - win) * SR)), e = Math.min(r.out.length, Math.round(t * SR)); let s = 0, n = 0; for (let i = a; i < e; i += 8) { s += r.out[i] * r.out[i]; n++; } return n ? Math.sqrt(s / n) : 0; };
  const wrap = (text, maxW, font) => { g.font = font; const words = text.split(/\s+/), lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };
  return (t, dt) => {
    g.drawImage(bg, 0, 0);
    // сцена
    const ch = chs.find(c => t >= c.start && t < c.end);
    if (ch) { g.font = `700 15px ${disp}`; g.fillStyle = amber; g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillText(ch.title.replace(' — ', ' · ').toUpperCase().slice(0, 64), W - 40, 33); g.textAlign = 'left'; }
    // обложка или индикатор
    if (cover) { g.save(); g.beginPath(); g.roundRect(CX, CY, CS, CS, 16); g.clip(); const k = Math.max(CS / cover.width, CS / cover.height); g.drawImage(cover, CX + (CS - cover.width * k) / 2, CY + (CS - cover.height * k) / 2, cover.width * k, cover.height * k); g.restore(); }
    const lv = rms(t), target = lv > 1e-5 ? vuA(20 * Math.log10(lv) + 18) : -50;
    const steps = 4; for (let i = 0; i < steps; i++) { const h = dt / steps, acc = 160 * (target - ang) - 2 * Math.sqrt(160) * 0.7 * vel; vel += acc * h; ang += vel * h; }
    { const vx = cover ? CX + CS - 150 : CX, vy = cover ? CY + CS - 90 : CY + 70, vw = cover ? 150 : CS, vh = cover ? 90 : CS * 0.62, s = vw / 96;
      g.save(); g.translate(vx, vy); g.scale(s, s);
      g.fillStyle = '#2A221C'; g.strokeStyle = '#342C26'; g.lineWidth = 1 / s; g.beginPath(); g.roundRect(0.5, 0.5, 95, cover ? 56 : 58, 5); g.fill(); g.stroke();
      const lamp = g.createRadialGradient(48, 60, 2, 48, 60, 60); lamp.addColorStop(0, `rgba(242,178,51,${0.12 + Math.min(0.3, lv * 2)})`); lamp.addColorStop(1, 'rgba(242,178,51,0)'); g.fillStyle = lamp; g.fillRect(1, 1, 94, 56);
      g.strokeStyle = '#D9CBB3'; g.lineWidth = 0.8; g.beginPath(); g.arc(48, 50, 36, (-90 - 48) * Math.PI / 180, (-90 + 48) * Math.PI / 180); g.stroke();
      g.strokeStyle = onair; g.lineWidth = 2; g.beginPath(); g.arc(48, 50, 36, (-90 + vuA(0)) * Math.PI / 180, (-90 + 48) * Math.PI / 180); g.stroke();
      g.strokeStyle = ink; g.lineWidth = 1.2; g.lineCap = 'round'; const a = (ang - 90) * Math.PI / 180; g.beginPath(); g.moveTo(48, 50); g.lineTo(48 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)); g.stroke();
      g.restore(); }
    // реплика
    let cur = cues.find(c => t >= c.a && t < c.b), fade = 1;
    const TX = CX + CS + 60, TW = W - TX - 60;
    if (!cur) {                                        // пауза: прошлая реплика гаснет, потом — название сцены
      const last = cues.filter(c => c.b <= t).pop(), since = last ? t - last.b : 99;
      if (since < 1.2) { cur = last; fade = 1 - since / 1.2; }
      else if (ch) { g.globalAlpha = Math.min(1, (since - 1.2) / 0.6) * 0.55; g.font = `600 30px ${disp}`; g.fillStyle = muted; g.textBaseline = 'middle'; wrap(ch.title, TW, `600 30px ${disp}`).slice(0, 3).forEach((ln, i) => g.fillText(ln, TX, 280 + i * 42)); g.globalAlpha = 1; }
    }
    if (cur) {
      g.globalAlpha = fade;
      let y = 250;
      if (cur.who) { g.font = `700 22px ${disp}`; const wv = g.measureText(cur.who.toUpperCase()).width; g.fillStyle = cur.spk ? DARK[colorOf(cur.spk)] || amber : muted; g.globalAlpha = 0.18 * fade; g.beginPath(); g.roundRect(TX - 12, y - 20, wv + 24, 40, 20); g.fill(); g.globalAlpha = fade; g.fillText(cur.who.toUpperCase(), TX, y); y += 58; }
      g.fillStyle = cur.spk ? ink : muted; const lines = wrap(cur.text, TW, `500 38px ${sans}`).slice(0, 4); for (const ln of lines) { g.fillText(ln, TX, y); y += 50; }
      const p = Math.min(1, (t - cur.a) / Math.max(0.1, cur.b - cur.a)); g.fillStyle = amber; g.globalAlpha = 0.9 * fade; g.fillRect(TX, y - 12, Math.max(2, 120 * p), 3); g.globalAlpha = 1;
    }
    // волна и курсор
    const px = Math.round(t / total * WW);
    g.drawImage(wGrey, WX, WY); g.drawImage(wAmber, 0, 0, Math.max(1, px), WH, WX, WY, Math.max(1, px), WH);
    g.fillStyle = onair; g.fillRect(WX + px - 1, WY - 10, 2, WH + 20);
    g.font = `500 15px ${mono}`; g.fillStyle = muted; g.textBaseline = 'middle'; g.fillText(fmt(t), WX, WY + WH + 26); g.textAlign = 'right'; g.fillText(fmt(total), WX + WW, WY + WH + 26); g.textAlign = 'left';
  };
}
/** Кнопка «Собрать видео». */
async function exportVideo(from, to) {
  if (VIDEO.busy) { VIDEO.cancel = true; return; }
  const ex = await exportBegin('видео'); if (!ex) return;
  VIDEO.busy = true; VIDEO.cancel = false; renderMix();
  try {
    if (S.result.approx && typeof exactResult === 'function') await exactResult();
    const res = await buildVideo({ title: (S.videoTitle || '').trim() || 'Радиоспектакль', cover: S.videoCover || null, from, to });
    progress('', 0);
    const stamp = S.result.at.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
    if (!(await ex.commit())) return res;
    download(res.blob, `видео-${stamp}.${res.ext}`);
    notify(`Видео готово (${(res.blob.size / 1e6).toFixed(0)} МБ, ${res.ext.toUpperCase()}). Для YouTube: загрузите видео, субтитры (.srt) и главы из кнопки «Главы».`);
    return res;
  } catch (err) { progress('', 0); notify('Видео не собралось: ' + err.message); }
  finally { VIDEO.busy = false; VIDEO.cancel = false; renderMix(); }
}
function videoHtml() {
  return `<div class="vid">
    <div class="vid-h"><b>Видео для YouTube</b><span class="muted small">1280×720, MP4 (или WebM, если браузер не умеет H.264): обложка, имя и реплика, сцена, волна спектакля. Субтитры и главы — отдельными файлами для описания и дорожки субтитров.</span></div>
    <div class="vid-row">
      <input type="text" id="vid-title" placeholder="Название спектакля" value="${esc(S.videoTitle || '')}" aria-label="Название спектакля">
      <label class="ghost-b file-b">${ic('file')}${S.videoCover ? 'Обложка выбрана' : 'Обложка'}<input type="file" id="vid-cover" accept="image/*" hidden></label>
      <button class="${VIDEO.busy ? 'ghost-b' : 'primary'}" data-act="video">${VIDEO.busy ? 'Остановить' : 'Собрать видео'}</button>
      <button class="ghost-b" data-act="srt">Субтитры (.srt)</button>
      <button class="ghost-b" data-act="vtt">.vtt</button>
    </div>
  </div>`;
}
function bindVideo() {
  const out = $('#mix-out');
  out.addEventListener('input', e => { if (e.target.id === 'vid-title') S.videoTitle = e.target.value; });
  out.addEventListener('change', async e => {
    if (e.target.id !== 'vid-cover') return; const f = e.target.files[0]; if (!f) return;
    try { S.videoCover = await createImageBitmap(f); renderMix(); } catch { notify('Не получилось открыть картинку.'); }
  });
}
