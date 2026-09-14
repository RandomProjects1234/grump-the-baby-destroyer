// All DOM handling. The game never touches elements directly.
import { ITEMS, itemName } from '../game/items.js?v=2026-09-13f';
import { fmtTime, clamp } from '../util/util.js?v=2026-09-13f';

const $ = s => document.querySelector(s);
const SCREENS = ['menu', 'soloscreen', 'hostscreen', 'joinscreen', 'settings', 'howto'];

// A tile of grey noise for the static overlay, generated once.
function makeStaticTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v; img.data[i + 1] = v * 0.9; img.data[i + 2] = v * 0.9;
    img.data[i + 3] = Math.random() < 0.5 ? 255 : 0;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('#hud'), crosshair: $('#crosshair'),
      phase: $('#phase'), timeleft: $('#timeleft'), clock: $('#clock'),
      power: $('#powerpill'), powerText: $('#powertext'),
      objectives: $('#objectives'),
      prompt: $('#prompt'), promptLabel: $('#promptlabel'), promptHint: $('#prompthint'),
      promptBar: $('#promptbar').firstElementChild, promptExtra: $('#promptextra'),
      pkey: document.querySelector('#prompt .pkey'),
      health: $('#bar-health').firstElementChild,
      stam: $('#bar-stam').firstElementChild,
      food: $('#bar-food').firstElementChild,
      fear: $('#bar-fear').firstElementChild,
      hands: $('#hands'), hotbar: $('#hotbar'),
      subtitle: $('#subtitle'), bigline: $('#bigline'),
      toasts: $('#toasts'), flash: $('#flash'), vignette: $('#vignette'),
      chatlog: $('#chatlog'), chatbox: $('#chatbox'), chatinput: $('#chatinput'),
      hidebadge: $('#hidebadge'),
      dialogue: $('#dialogue'), dlgQ: $('#dlg-q'), dlgA: $('#dlg-a'),
      dlgReply: $('#dlg-reply'), dlgMeter: $('#dlg-meter'),
      drawing: $('#drawing'), drawTitle: $('#draw-title'), drawText: $('#draw-text'),
      dawn: $('#dawn'), dawnTitle: $('#dawn-title'), dawnLines: $('#dawn-lines'), dawnKicker: $('#dawn-kicker'),
      over: $('#over'), overTitle: $('#over-title'), overSub: $('#over-sub'), overStats: $('#over-stats'),
      pause: $('#pause'), pauseCode: $('#pause-code'),
      loading: $('#loading'), loadText: $('#loadtext'),
      quests: $('#quests'), modline: $('#modline'), static: $('#static'),
      pauseCoop: $('#pause-coop')
    };
    this.el.static.style.backgroundImage = `url(${makeStaticTile()})`;
    this.questHtml = '';
    this.subT = 0;
    this.slots = [];
    this.buildHotbar();
    this.objVisible = false;
  }

  // ---------------------------------------------------------------- screens
  screen(name) {
    for (const id of SCREENS) {
      $('#' + id).classList.toggle('hidden', id !== name);
    }
    this.lastScreen = name;
  }
  hideScreens() {
    for (const id of SCREENS) $('#' + id).classList.add('hidden');
  }
  showHud(on) { this.el.hud.classList.toggle('hidden', !on); }
  loading(on, text) {
    this.el.loading.classList.toggle('hidden', !on);
    if (text) this.el.loadText.textContent = text;
  }

  // ---------------------------------------------------------------- messages
  toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; }, 2600);
    setTimeout(() => d.remove(), 3100);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild.remove();
  }

  subtitle(msg) {
    this.el.subtitle.textContent = msg;
    this.el.subtitle.classList.add('show');
    this.subT = 3.2;
  }

  bigLine(msg) {
    const e = this.el.bigline;
    e.textContent = msg;
    e.classList.remove('show');
    void e.offsetWidth;               // restart the animation
    e.classList.add('show');
  }

  // Black bars top and bottom while a cutscene plays.
  letterbox(on) {
    const e = document.getElementById('letterbox');
    if (e) e.classList.toggle('on', !!on);
    this.el.hud.classList.toggle('cinematic', !!on);
  }

  // The hunger badge under the bars and the food bar's alarm state.
  hunger(level, how) {
    const b = document.getElementById('hungerbadge');
    const bar = document.getElementById('bar-food');
    if (bar) {
      bar.classList.toggle('low', level >= 2);
      bar.classList.toggle('critical', level >= 3);
    }
    document.getElementById('vignette').classList.toggle('starving', level >= 4);
    if (!b) return;
    if (level < 2) { b.classList.add('hidden'); return; }
    const text = level >= 4 ? 'STARVING: LOSING HEALTH' : level === 3 ? 'STARVING' : 'HUNGRY';
    const key = level + '|' + how;
    if (b.dataset.key !== key) {
      b.dataset.key = key;
      b.innerHTML = `<b>${text}</b><span>${how}</span>`;
    }
    b.classList.remove('hidden');
    b.classList.toggle('critical', level >= 3);
  }

  flash(kind) {
    const e = this.el.flash;
    e.className = '';
    void e.offsetWidth;
    e.className = kind;
  }

  chat(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.chatlog.appendChild(d);
    while (this.el.chatlog.children.length > 7) this.el.chatlog.firstElementChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; }, 11000);
    setTimeout(() => d.remove(), 11800);
  }

  openChat(on) {
    this.el.chatbox.classList.toggle('hidden', !on);
    if (on) { this.el.chatinput.value = ''; this.el.chatinput.focus(); }
    else this.el.chatinput.blur();
  }

  // ---------------------------------------------------------------- hotbar
  buildHotbar() {
    this.el.hotbar.innerHTML = '';
    this.slots = [];
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<span class="num">${i + 1}</span><span class="ic"></span><span class="nm"></span>`;
      this.el.hotbar.appendChild(d);
      this.slots.push(d);
    }
  }

  // ---------------------------------------------------------------- prompt
  setPrompt(inter, progress) {
    const e = this.el.prompt;
    if (!inter) {
      e.classList.add('hidden');
      this.el.crosshair.classList.remove('active');
      return;
    }
    e.classList.remove('hidden');
    this.el.crosshair.classList.add('active');
    this.el.promptLabel.textContent = inter.label;
    this.el.promptHint.textContent = inter.hint || '';
    this.el.pkey.textContent = inter.key || 'E';
    this.el.promptBar.style.width = (inter.hold ? clamp(progress / inter.hold, 0, 1) * 100 : 0) + '%';
    if (inter.extra) {
      this.el.promptExtra.classList.remove('hidden');
      this.el.promptExtra.innerHTML = `<b>${inter.extra.key || 'R'}</b> ${inter.extra.label}`;
    } else this.el.promptExtra.classList.add('hidden');
  }

  // ---------------------------------------------------------------- hud tick
  update(dt, game) {
    const p = game.player;

    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.el.subtitle.classList.remove('show');
    }

    this.el.health.style.width = p.health + '%';
    this.el.stam.style.width = p.stamina + '%';
    this.el.food.style.width = p.food + '%';
    if (p.dead) this.hunger(0, '');
    this.el.fear.style.width = p.fear + '%';

    const night = game.phase === 'night';
    this.el.clock.classList.toggle('night', night);
    this.el.phase.textContent = (night ? 'NIGHT ' : 'DAY ') + game.night;
    this.el.timeleft.textContent = fmtTime(game.phaseTime);
    this.el.clock.classList.toggle('warn', game.phaseTime < 30);

    const running = game.generator && game.generator.running;
    this.el.power.classList.toggle('off', !running);
    this.el.powerText.textContent = running
      ? `POWER ${Math.round(game.generator.fuel)}%`
      : 'NO POWER';

    // hands
    if (p.carryingToddler) {
      const t = game.toddlers.byId(p.hands.toddler);
      this.el.hands.innerHTML = `<b>${t ? t.name : 'a toddler'}</b><br><small>Q to put down</small>`;
    } else if (p.hands) {
      this.el.hands.innerHTML = `<b>${itemName(p.hands)}</b><br><small>Q to put down</small>`;
    } else {
      this.el.hands.innerHTML = '<span class="empty">hands empty</span>';
    }

    // bag
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i], kind = p.bag[i];
      s.classList.toggle('sel', i === p.selected);
      const def = kind ? ITEMS[kind] : null;
      s.querySelector('.ic').textContent = def ? def.icon : '';
      s.querySelector('.nm').textContent = def ? def.name.split(' ')[0] : '';
    }

    // hiding / downed view treatment
    this.el.hud.classList.toggle('hiding', !!p.hidden);
    this.el.hud.classList.toggle('peeking', !!p.hidden && p.peeking);
    this.el.hud.classList.toggle('downed', p.downed);
    this.el.hidebadge.classList.toggle('hidden', !p.hidden);
    if (p.hidden && p.tapedIn > 0) {
      this.el.hidebadge.innerHTML = `TAPED SHUT · ${Math.ceil(p.tapedIn)}s`;
    } else if (p.hidden) {
      this.el.hidebadge.innerHTML = 'HIDDEN &nbsp;·&nbsp; hold <b>RMB</b> to peek';
    }

    // fear tightens the vignette
    const fearV = 0.5 + (p.fear / 100) * 0.42;
    this.el.vignette.style.opacity = p.hidden ? '' : String(fearV);

    // Grump's static, and the red edge once he has turned.
    const dread = game.grump ? (game.grump.dread || 0) : 0;
    this.el.static.style.opacity = String(Math.min(0.55, dread * dread * 0.6));
    this.el.hud.classList.toggle('turned', !!(game.grump && game.grump.turned && dread > 0.25));

    // Quest list only re-renders when it changes.
    const qh = game.quests ? game.quests.html() : '';
    if (qh !== this.questHtml) { this.questHtml = qh; this.el.quests.innerHTML = qh; }
    const ml = game.modText || '';
    if (this.el.modline.textContent !== ml) this.el.modline.textContent = ml;
  }

  setObjectives(show, html) {
    this.el.objectives.classList.toggle('show', show);
    if (html !== undefined) this.el.objectives.innerHTML = html;
  }

  // ---------------------------------------------------------------- dialogue
  showDialogue(q, resent, onPick) {
    const e = this.el;
    e.dialogue.classList.remove('hidden');
    e.dlgQ.textContent = q.q;
    e.dlgReply.classList.add('hidden');
    e.dlgMeter.style.width = clamp(resent, 0, 100) + '%';
    e.dlgA.innerHTML = '';
    q.a.forEach((ans, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<b>${i + 1}</b>${ans.t}`;
      b.onclick = () => {
        e.dlgA.querySelectorAll('button').forEach(x => { x.disabled = true; x.style.opacity = '.4'; });
        b.style.opacity = '1';
        onPick(ans, i);
      };
      e.dlgA.appendChild(b);
    });
    this.dlgButtons = [...e.dlgA.querySelectorAll('button')];
  }

  showDialogueReply(text, resent, onDone) {
    this.el.dlgReply.textContent = '“' + text + '”';
    this.el.dlgReply.classList.remove('hidden');
    this.el.dlgMeter.style.width = clamp(resent, 0, 100) + '%';
    const b = document.createElement('button');
    b.className = 'big';
    b.textContent = 'Back away slowly';
    b.style.marginTop = '18px';
    b.onclick = onDone;
    this.el.dlgA.innerHTML = '';
    this.el.dlgA.appendChild(b);
    this.dlgButtons = [b];
  }

  closeDialogue() { this.el.dialogue.classList.add('hidden'); }

  // ---------------------------------------------------------------- pages
  showDrawing(page) {
    this.el.drawing.classList.remove('hidden');
    this.el.drawTitle.textContent = page.title;
    this.el.drawText.textContent = page.text;
  }
  closeDrawing() { this.el.drawing.classList.add('hidden'); }

  showDawn(title, kicker, lines) {
    this.el.dawn.classList.remove('hidden');
    document.exitPointerLock();
    this.el.dawnTitle.textContent = title;
    this.el.dawnKicker.textContent = kicker;
    this.el.dawnLines.innerHTML = lines.map(l =>
      `<div class="${l[1] || ''}">${l[0]}</div>`).join('');
  }
  closeDawn() { this.el.dawn.classList.add('hidden'); }

  showOver(title, sub, stats) {
    this.el.over.classList.remove('hidden');
    this.el.overTitle.textContent = title;
    this.el.overSub.textContent = sub;
    this.el.overStats.innerHTML = stats.map(s => `<div>${s}</div>`).join('');
  }
  closeOver() { this.el.over.classList.add('hidden'); }

  showPause(on, code) {
    this.el.pause.classList.toggle('hidden', !on);
    this.el.pauseCoop.classList.toggle('hidden', !code);
    this.el.pauseCode.classList.toggle('hidden', !code);
    if (code) this.el.pauseCode.innerHTML = `Room code <b style="color:var(--amber);letter-spacing:6px">${code}</b>`;
  }
}
