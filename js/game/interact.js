// Finds whatever the player is looking at and turns it into a prompt plus an
// action. Anything that takes effort is a hold, so the player is committed and
// vulnerable while they do it.
//
// How "looking at" works: every interactable thing has a real shape (a box
// for furniture, doors, the generator; a circle for people, items, messes).
// A line is cast from your eyes along your crosshair, and the NEAREST shape it
// passes through within reach is the one you get -- exactly what you are
// pointing at, never something behind it. Walls and closed doors stop the
// line, so nothing on the other side of a wall can steal the prompt. Look
// down at the floor and small things at your feet count too. Only when the
// line hits nothing at all do we fall back to the closest thing roughly in
// front of you.
import { ITEMS, SEARCH_TIME, isBig, isFood, itemName } from './items.js?v=2026-09-13d';
import { dist2 } from '../util/util.js?v=2026-09-13d';

const REACH = 2.5;
const FALLBACK_CONE = 0.45;   // radians either side, only when nothing is hit

// ---------------------------------------------------------------- geometry

// Distance along a 2D ray (origin o, unit dir d) to where it enters a box
// centred at (cx, cz), half sizes hw x hd, rotated by rot. Infinity if missed.
function rayBox(ox, oz, dx, dz, cx, cz, hw, hd, rot) {
  const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
  // into the box's frame: across = x*c - z*s, along = x*s + z*c
  const lx = (ox - cx) * c - (oz - cz) * s, lz = (ox - cx) * s + (oz - cz) * c;
  const vx = dx * c - dz * s, vz = dx * s + dz * c;
  let tmin = -Infinity, tmax = Infinity;
  for (const [p, v, h] of [[lx, vx, hw], [lz, vz, hd]]) {
    if (Math.abs(v) < 1e-9) { if (p < -h || p > h) return Infinity; continue; }
    let t1 = (-h - p) / v, t2 = (h - p) / v;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (tmax < 0) return Infinity;
  return Math.max(0, tmin);
}

function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const fx = ox - cx, fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;                       // already inside it
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? Infinity : t;
}

// How far the crosshair line gets before a wall or closed door stops it.
function wallDistance(game, ox, oz, dx, dz) {
  const col = game.collider;
  const scratch = [];
  let best = Infinity;
  col.near(ox + dx * REACH / 2, oz + dz * REACH / 2, REACH / 2 + 0.6, scratch);
  for (const b of scratch) {
    if (b.prop || b.npc) continue;              // furniture and people do not block
    const t = rayBox(ox, oz, dx, dz, b.x, b.z, b.hw, b.hd, 0);
    if (t < best) best = t;
  }
  return best;
}

// ---------------------------------------------------------------- selection

// Returns { label, hint, hold, act } or null.
export function findInteraction(game) {
  const p = game.player;
  if (p.dead) return null;

  // While hidden the only choices are to get out, or to tape yourself in.
  if (p.hidden) {
    const out = { label: 'Get out', hold: 0.45, act: () => p.exitHide(game) };
    if (p.hidden.hide === 'locker' && p.hasItem('tape') && p.tapedIn <= 0) {
      out.extra = {
        label: 'Tape the door shut', key: 'R', hold: 0,
        act: () => {
          p.take('tape');
          p.tapedIn = 30;
          game.ui.toast('Taped shut. Thirty seconds.');
          game.sfx.clean();
        }
      };
    }
    return out;
  }

  const carrying = p.carryingToddler;

  // --- quest deliveries that work anywhere in the right room
  const here = game.school.roomAt(p.x, p.z);
  if (!carrying && p.hands === 'hamster' && here === game.school.home) {
    return { label: 'Put Mr. Wiggles back in his classroom', hint: 'He is very pleased to be home.', hold: 0.8, act: () => game.questDeliver('hamster') };
  }
  if (!carrying && p.hasItem('holocard') && here && here.type === 'lostfound') {
    return { label: 'Leave the shiny card in Lost & Found', hint: 'Somebody might come back for it.', hold: 0.8, act: () => game.questDeliver('holocard') };
  }

  // --- the crosshair line
  const ox = p.x, oz = p.z;
  const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
  const wallT = wallDistance(game, ox, oz, dx, dz);
  // Looking down: where the line meets the floor (small things there count).
  const eye = p.eye || 0.62;
  const floorT = p.pitch < -0.25 ? eye / Math.tan(-p.pitch) : Infinity;
  const floorX = ox + dx * floorT, floorZ = oz + dz * floorT;

  const targets = [];
  // shape: { box: [cx, cz, hw, hd, rot] } or { circle: [cx, cz, r] }
  // onWall: mounted on a wall (switch, door), so the wall itself does not hide it
  // floor: small enough to pick by looking down at it
  const add = (shape, make, o = {}) => targets.push({ shape, make, key: o.key || null, onWall: !!o.onWall, floor: !!o.floor, weight: o.weight || 0, hide: o.hide || null, core: o.core || null });

  // dropped items
  for (const it of game.groundItems.list) {
    if (dist2(ox, oz, it.x, it.z) > REACH + 1) continue;
    add({ circle: [it.x, it.z, 0.32] }, () => ({
      label: `Pick up ${itemName(it.kind)}`,
      hint: ITEMS[it.kind] && ITEMS[it.kind].desc,
      hold: 0,
      act: () => game.pickUpGroundItem(it)
    }), { floor: true, key: 'item' + it.id, weight: 0.2 });
  }

  // toddlers
  for (const t of game.toddlers.list) {
    if (t.state === 'carried' || t.state === 'taken') continue;
    if (t.putDownAt && game.time - t.putDownAt < 1.5) continue;
    if (dist2(ox, oz, t.x, t.z) > REACH + 1) continue;
    add({ circle: [t.x, t.z, 0.36] }, () => {
      if (p.hands === 'teddy') return { label: `Give the teddy to ${t.name}`, hold: 0.8, act: () => game.teddyToddler(t) };
      const food = p.bag.find(k => isFood(k));
      if (t.hunger > 40 && food) return { label: `Feed ${t.name} your ${itemName(food).toLowerCase()}`, hint: 'Hungry toddlers cry, and crying carries.', hold: 0.7, act: () => game.feedToddler(t, food) };
      if (p.handsFree) return { label: `Pick up ${t.name}`, hint: t.hunger > 65 ? 'Hungry.' : 'Carry them to your classroom.', hold: 0.45, act: () => game.carryToddler(t) };
      return { label: `${t.name} (hands full)`, hint: 'Put down what you are holding first (Q).', hold: 0, act: () => game.sfx.deny() };
    }, { floor: true, key: 'tod' + t.id, weight: t.state === 'safe' ? 0 : 0.3 });
  }

  // messes
  for (const m of game.messes.list) {
    if (m.done || dist2(ox, oz, m.x, m.z) > REACH + 1) continue;
    add({ circle: [m.x, m.z, 0.55] }, () => ({
      label: `Clean up ${m.label}`,
      hint: 'Mess left at nightfall burns extra fuel.',
      hold: m.time,
      act: () => game.cleanMess(m)
    }), { floor: true, key: 'mess' + m.id, weight: 0.1 });
  }

  // the generator
  const gen = game.generator;
  if (gen && dist2(ox, oz, gen.x, gen.z) < REACH + 1.5) {
    const gp = game.school.props.find(q => q.generator);
    const shape = gp ? { box: [gp.x, gp.z, gp.hw + 0.15, gp.hd + 0.15, gp.rot] } : { circle: [gen.x, gen.z, 0.9] };
    add(shape, () => {
      const status = `Fuel ${Math.round(gen.fuel)}% · Condition ${Math.round(gen.condition)}%`;
      const opts = [];
      if (p.hands === 'fuel') {
        if (gen.fuel >= 97) opts.push({ label: 'The tank is already full', hint: status, hold: 0, act: () => game.sfx.deny() });
        else opts.push({ label: 'Pour in the fuel', hint: status, hold: 2.2, act: () => { if (p.hands === 'fuel') { p.hands = null; game.genAction('refuel'); } } });
      }
      if (!gen.running) {
        opts.push({
          label: 'Pull the starter cord',
          hint: gen.fuel <= 1 ? 'It needs fuel first.' : gen.condition <= 12 ? 'Too broken to start. Fit a spare part.' : status,
          hold: 1.1, act: () => game.genAction('start')
        });
      }
      if (p.hasItem('part') && gen.condition < 97) {
        const fast = p.hasItem('wrench');
        opts.push({ label: fast ? 'Repair it (wrench)' : 'Repair it', hint: status, hold: fast ? 1.3 : 2.6, act: () => { if (p.take('part')) game.genAction('repair'); } });
      }
      if (!opts.length) {
        const why = p.hands && p.hands !== 'fuel' ? ' · bring fuel in your hands to top it up' : '';
        return { label: gen.running ? 'The generator is running' : 'The generator', hint: `${status} · ${game.fuelTimeLeft()}${why}`, hold: 0, act: () => game.sfx.click() };
      }
      const main = opts[0];
      if (opts[1]) main.extra = Object.assign({ key: 'R' }, opts[1]);
      return main;
    }, { key: 'generator', weight: 0.25 });
  }

  // doors
  for (const d of game.school.doors) {
    if (dist2(ox, oz, d.x, d.z) > REACH + 1.2) continue;
    const alongX = d.dir !== 'w';
    const hw = alongX ? 0.62 : 0.3, hd = alongX ? 0.3 : 0.62;
    add({ box: [d.x, d.z, d.style === 'double' ? (alongX ? 1.0 : 0.3) : hw, d.style === 'double' ? (alongX ? 0.3 : 1.0) : hd, 0] }, () => {
      if (d.exit) {
        if (game.escapeOpen) return { label: 'LEAVE', hint: 'Go home.', hold: 2.0, carryOk: true, act: () => game.escape() };
        return { label: 'The front doors', hint: 'Chained from the outside.', hold: 0, act: () => { game.sfx.deny(); game.ui.toast('Chained. Something rattles on the far side.'); } };
      }
      if (d.locked) {
        const why = d.yard ? 'The playground is locked for the night. It opens again in the morning.' : 'The staff room is kept locked.';
        if (p.hasItem('key')) {
          return {
            label: 'Unlock with your staff key', hint: 'Hold E. ' + why, hold: 0.5, carryOk: true,
            act: () => game.unlockDoor(d)
          };
        }
        return {
          label: d.yard ? 'Locked for the night' : 'Locked', hint: why + ' A staff key would open it.', hold: 0,
          act: () => { game.sfx.deny(); game.emitNoise(d.x, d.z, 0.4); game.ui.toast(why + ' A staff key would open it.'); }
        };
      }
      return { label: d.open ? 'Close the door' : 'Open the door', hold: 0, carryOk: true, act: () => game.toggleDoor(d, !d.open, false, 'player') };
    }, { onWall: true, key: 'door' + d.id, weight: 0 });
  }

  // light switches
  for (const sw of game.switches) {
    if (dist2(ox, oz, sw.x, sw.z) > REACH + 0.6) continue;
    add({ circle: [sw.x, sw.z, 0.28] }, () => {
      const on = sw.room.lightsOn !== false;
      return {
        label: on ? `Lights off · ${sw.room.name}` : `Lights on · ${sw.room.name}`,
        hint: game.generator.running ? '' : 'No power right now -- they will come on when the generator does.',
        hold: 0, carryOk: true, act: () => game.setRoomLights(sw.room, !on, 'player')
      };
    }, { onWall: true, key: 'switch' + sw.room.id + ':' + sw.x.toFixed(1), weight: 0.15 });
  }

  // fusebox
  const fb = game.fusebox;
  if (fb && dist2(ox, oz, fb.x, fb.z) < REACH + 1) {
    add({ box: [fb.x, fb.z, (fb.hw || 0.3) + 0.12, (fb.hd || 0.2) + 0.12, fb.rot] }, () => ({
      label: 'Reset every breaker',
      hint: 'Switches the whole school back on. Burns fuel fast.',
      hold: 1.6,
      act: () => game.resetBreakers()
    }), { onWall: true, key: 'fusebox', weight: 0.2 });
  }

  // furniture: search, hide, the crib
  for (const prop of game.school.props) {
    if (!prop.search && !prop.hide && !prop.crib) continue;
    if (dist2(ox, oz, prop.x, prop.z) > REACH + Math.max(prop.hw, prop.hd) + 0.3) continue;
    add({ box: [prop.x, prop.z, prop.hw + 0.12, prop.hd + 0.12, prop.rot] }, () => {
      if (prop.crib) {
        if (p.hands === 'hamster') {
          return { label: 'Put Mr. Wiggles back', hint: 'He is very pleased to be home.', hold: 0.8, act: () => game.questDeliver('hamster') };
        }
        return { label: 'The crib', hint: `${game.toddlers.saved} little ones safe here. Quest rewards turn up here too.`, hold: 0, act: () => game.sfx.babble() };
      }
      if (prop.search === 'lost' && p.hasItem('holocard')) {
        return { label: 'Leave the shiny card in Lost & Found', hint: 'Somebody might come back for it.', hold: 0.8, act: () => game.questDeliver('holocard') };
      }
      if (prop.search) {
        const n = prop.searchCount || 0;
        const hint = n === 0 ? (prop.hide ? 'You could also hide in here (R).' : '')
          : n === 1 ? 'Already searched once -- might be something left at the back.'
            : 'Searched a lot today. Probably picked clean.';
        return {
          label: n ? `Search the ${labelOf(prop)} again` : `Search the ${labelOf(prop)}`,
          hint,
          hold: SEARCH_TIME[prop.search] || 1.4,
          extra: prop.hide ? { label: `Hide ${prop.hide === 'under' ? 'under' : 'in'} it`, key: 'R', hold: 0, act: () => game.hideIn(prop) } : null,
          act: () => game.searchProp(prop)
        };
      }
      if (prop.hide) {
        return {
          label: `Hide ${prop.hide === 'under' ? 'under' : 'in'} the ${labelOf(prop)}`,
          hint: '',
          isHide: true,
          hold: 0.7,
          act: () => game.hideIn(prop)
        };
      }
      return null;
    }, { key: 'prop' + prop.id, hide: prop.hide ? prop : null, core: [prop.x, prop.z, prop.hw, prop.hd, prop.rot] });
  }

  // people
  const hw = game.honeywell;
  if (hw && hw.visible && dist2(ox, oz, hw.x, hw.z) < REACH + 1) {
    add({ circle: [hw.x, hw.z, 0.42] }, () => ({
      label: 'Talk to Mrs. Honeywell', hint: 'She will go over the list with you.', hold: 0, act: () => hw.talk()
    }), { key: 'honeywell', weight: 0.3 });
  }
  const mer = game.meredith;
  if (mer && mer.visible && dist2(ox, oz, mer.x, mer.z) < REACH + 1) {
    add({ circle: [mer.x, mer.z, 0.45] }, () => mer.interaction(), { key: 'meredith', weight: 0.3 });
  }
  const g = game.grump;
  if (g && g.model && g.model.visible !== false && dist2(ox, oz, g.x, g.z) < REACH + 1) {
    const scale = (g.model && g.model.scale && g.model.scale.x) || 1;
    add({ circle: [g.x, g.z, 0.38 * scale] }, () => {
      if (g.hunting || g.turned) {
        return { label: 'Grump', hint: 'He has finished asking.', hold: 0, act: () => game.tryTalkToGrump() };
      }
      if (p.hasItem('crayon')) {
        return { label: 'Give Grump back his crayon', hint: 'The only kind thing you can do for him.', hold: 0.6, act: () => game.questDeliver('crayon') };
      }
      if (g.talkCd > 0) return { label: 'Grump is thinking', hint: 'Give him a moment.', hold: 0, act: () => game.sfx.deny() };
      return { label: 'Talk to Grump', hint: 'Ignoring him all day costs more than talking to him.', hold: 0.35, act: () => game.tryTalkToGrump() };
    }, { key: 'grump', weight: 0.4 });
  }
  for (const rp of game.remotePlayers.values()) {
    if (!rp.downed || rp.dead) continue;
    add({ circle: [rp.x, rp.z, 0.45] }, () => ({
      label: `Pat ${rp.name} until they get up`, hold: 3.0, act: () => game.requestRevive(rp)
    }), { floor: true, key: 'revive' + rp.id, weight: 0.5 });
  }

  // --- pick: nearest thing the crosshair line passes through
  const holding = game.holdKey;
  const hits = [];
  for (const tg of targets) {
    let t = tg.shape.box
      ? rayBox(ox, oz, dx, dz, ...tg.shape.box)
      : rayCircle(ox, oz, dx, dz, ...tg.shape.circle);
    // small things at your feet, picked by looking down at them
    if (tg.floor && isFinite(floorT) && floorT <= REACH) {
      const [cx, cz, r] = tg.shape.circle || [tg.shape.box[0], tg.shape.box[1], 0.4];
      if (Math.hypot(floorX - cx, floorZ - cz) < r + 0.3) t = Math.min(t, floorT);
    }
    if (!(t <= REACH)) continue;
    // a wall or closed door in front of it hides it (things on the wall itself
    // -- switches, the fusebox, doors -- sit just past the wall's surface)
    if (t > wallT + (tg.onWall ? 0.45 : 0.02)) continue;
    // Furniture stands against walls, and its easy-to-aim-at outline pokes a
    // little way into the wall. Judge "is a wall in front of it" by the real
    // piece of furniture, so a locker cannot be used from the other side.
    if (tg.core && wallT < Infinity) {
      const tc = rayBox(ox, oz, dx, dz, ...tg.core);
      if (isFinite(tc) ? tc > wallT + 0.02 : t > wallT - 0.08) continue;
    }
    // sort key: distance, nudged by a small preference for more important things
    hits.push({ tg, t, rank: t - tg.weight * 0.25 - (holding && tg.key === holding ? 5 : 0) });
  }
  hits.sort((a, b) => a.rank - b.rank);

  let best = null, bestHide = null;
  for (const h of hits) {
    if (!bestHide && h.tg.hide) bestHide = h.tg.hide;
    if (best) continue;
    const o = h.tg.make();
    if (!o || (carrying && !o.carryOk)) continue;
    if (h.tg.key) o.key = h.tg.key;
    best = o;
  }

  // --- nothing under the crosshair: the closest thing roughly ahead
  if (!best && !hits.length) {
    let bestScore = 0, pick = null;
    for (const tg of targets) {
      const [cx, cz] = tg.shape.box ? tg.shape.box : tg.shape.circle;
      const ddx = cx - ox, ddz = cz - oz;
      const dist = Math.hypot(ddx, ddz);
      if (dist > REACH + 0.2) continue;
      const along = (ddx * dx + ddz * dz) / (dist || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, along)));
      if (ang > FALLBACK_CONE) continue;
      if (!game.collider.wallsClear(ox, oz, cx - Math.sign(ddx) * 0.2, cz - Math.sign(ddz) * 0.2) && !tg.onWall) continue;
      const sc = (1 - dist / (REACH + 0.2)) * 0.5 + (1 - ang / FALLBACK_CONE) * 0.5 + tg.weight * 0.1 + (holding && tg.key === holding ? 5 : 0);
      if (sc > bestScore) {
        const o = tg.make();
        if (!o || (carrying && !o.carryOk)) continue;
        if (tg.key) o.key = tg.key;
        bestScore = sc; pick = o;
      }
    }
    best = pick;
  }

  // --- carrying a toddler: doors and switches still work; R (or E anywhere
  // else) puts them down
  if (carrying) {
    const inHome = here === game.school.home;
    const putDown = {
      label: inHome ? 'Put them down (safe)' : 'Put them down',
      hint: inHome ? '' : 'They are only safe in your classroom.',
      hold: 0.3,
      act: () => game.putDownToddler()
    };
    if (best) {
      best.extra = { label: putDown.label, key: 'R', hold: 0, act: putDown.act };
      return best;
    }
    return putDown;
  }

  // R always hides you in whatever hiding place you are looking at.
  if (best && bestHide && !best.extra && !best.isHide) {
    const prop = bestHide;
    best.extra = { label: `Hide ${prop.hide === 'under' ? 'under' : 'in'} the ${labelOf(prop)}`, key: 'R', hold: 0, act: () => game.hideIn(prop) };
  }
  return best;
}

const LABELS = {
  lockerBank: 'locker', teacherDesk: 'teacher desk', cafeTable: 'lunch table',
  servingCounter: 'serving counter', medCabinet: 'medicine cabinet', lostBin: 'lost property bin',
  ballCart: 'ball cart', prepTable: 'prep table', readingTable: 'reading table',
  roundTable: 'table', boilerTank: 'boiler', pipeRack: 'pipe rack', sandbox: 'sandpit',
  tube: 'concrete tube', bleacher: 'bleachers', vault: 'vaulting box', toybox: 'toy box'
};
function labelOf(p) { return LABELS[p.type] || p.type; }

// ---------------------------------------------------------------- using items

export function useSelected(game) {
  const p = game.player;
  const kind = p.selectedItem;
  if (!kind) { game.sfx.deny(); return; }
  if (isFood(kind)) { game.eat(kind); return; }
  switch (kind) {
    case 'lunchbox':
      game.openLunchbox();
      break;
    case 'battery':
      p.take('battery'); p.torchBattery = Math.min(100, p.torchBattery + 58);
      game.sfx.click(); game.ui.toast('Torch charged.'); break;
    case 'glowstick': {
      p.take('glowstick');
      const f = p.forward();
      const tx = p.x + f.x * 3.2, tz = p.z + f.z * 3.2;
      game.placeLight('glow', tx, tz);
      game.sfx.click();
      break;
    }
    case 'nightlight':
      if (!p.hasItem('battery')) { game.ui.toast('It needs a battery.'); game.sfx.deny(); return; }
      p.take('nightlight'); p.take('battery');
      game.placeLight('night', p.x, p.z);
      game.sfx.lightOn(); game.ui.toast('Night light placed.');
      break;
    case 'tape':
      game.ui.toast('Tape is for locking yourself into a locker.'); game.sfx.deny(); break;
    case 'drawing':
      p.take('drawing'); game.readDrawing(); break;
    case 'flashlight':
      game.toggleTorch(); break;
    case 'key': {
      // Selected key + R near a locked door: unlock it, same as holding E.
      let door = null, bd = 3.2;
      for (const d of game.school.doors) {
        if (!d.locked || d.exit) continue;
        const dd = dist2(p.x, p.z, d.x, d.z);
        if (dd < bd) { bd = dd; door = d; }
      }
      if (!door) { game.ui.toast('Walk up to a locked door (the staff room) and press R or hold E.'); game.sfx.deny(); break; }
      game.unlockDoor(door);
      break;
    }
    default:
      game.ui.toast(`${itemName(kind)} is used elsewhere.`); game.sfx.deny();
  }
}

// Q: put down whatever is in your hands; with empty hands, drop the item
// selected in your bag instead.
export function dropHands(game) {
  const p = game.player;
  if (p.carryingToddler) { game.putDownToddler(); return; }
  if (p.hidden) { game.ui.toast('No room to drop anything in here.'); game.sfx.deny(); return; }
  let kind = p.hands;
  if (kind) {
    p.hands = null;
  } else {
    kind = p.selectedItem;
    if (!kind) { game.ui.toast('Nothing to drop. Pick a slot with 1-6 first.'); game.sfx.deny(); return; }
    p.bag[p.selected] = null;
    // dropping your only torch switches it off
    if (kind === 'flashlight' && !p.hasItem('flashlight')) p.torchOn = false;
  }
  const [x, z] = dropSpot(game);
  game.spawnGroundItem(kind, x, z);
  game.sfx.drop();
  game.ui.toast(`Dropped ${itemName(kind)}.`);
}

// In front of you if there is floor there, otherwise at your feet -- never
// inside a wall or a desk where it could not be picked back up.
function dropSpot(game) {
  const p = game.player;
  const f = p.forward();
  const l = Math.hypot(f.x, f.z) || 1;
  const fx = f.x / l, fz = f.z / l;
  for (const d of [0.8, 0.55, 0.3]) {
    const x = p.x + fx * d, z = p.z + fz * d;
    if (game.collider.free(x, z, 0.12) && game.collider.lineClear(p.x, p.z, x, z)) return [x, z];
  }
  return [p.x, p.z];
}

export { isBig };
