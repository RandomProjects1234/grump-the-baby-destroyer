// Finds whatever the player is looking at and turns it into a prompt plus an
// action. Anything that takes effort is a hold, so the player is committed and
// vulnerable while they do it.
import { ITEMS, SEARCH_TIME, isBig, isFood, itemName } from './items.js';
import { dist2 } from '../util/util.js';

const REACH = 2.5;
const CONE = 0.82;         // radians of half-angle we accept

function score(game, x, z) {
  const p = game.player;
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > REACH) return -1;
  const ang = Math.atan2(dx, dz);
  let diff = Math.abs(((ang - (p.yaw + Math.PI) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (diff > CONE) return -1;
  return (1 - d / REACH) * 0.6 + (1 - diff / CONE) * 0.4;
}

// Small things (a toddler, an item, a mess): if they sit on your line of sight
// they count as looked-at, with a little extra so they beat the furniture
// behind them.
function smallScore(game, x, z, radius = 0.35) {
  const p = game.player;
  const base = score(game, x, z);
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const dx = x - p.x, dz = z - p.z;
  const along = dx * fx + dz * fz;
  if (along <= 0 || along > REACH) return base;
  const off = Math.abs(dx * fz - dz * fx);
  if (off > radius) return base;
  return Math.max(base, (1 - along / REACH) * 0.6 + 0.4 + 0.06);
}

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

  let best = null, bestScore = 0;
  let bestHide = null, bestHideScore = 0;
  // Whatever you are already holding E on stays the target, so a toddler or
  // Grump wandering through your view does not restart the search bar.
  const holding = game.holdKey;
  const consider = (x, z, make, weight = 1, key = null, raw = null) => {
    let s = (raw === null ? score(game, x, z) : raw) * weight;
    if (key && key === holding && s > 0) s += 10;
    if (s > bestScore) { const o = make(); if (o) { if (key) o.key = key; bestScore = s; best = o; } }
  };

  // --- quest deliveries that work anywhere in the right room
  const here = game.school.roomAt(p.x, p.z);
  if (p.hands === 'hamster' && here === game.school.home) {
    return { label: 'Put Mr. Wiggles back in his classroom', hint: 'He is very pleased to be home.', hold: 0.8, act: () => game.questDeliver('hamster') };
  }
  if (p.hasItem('holocard') && here && here.type === 'lostfound') {
    return { label: 'Leave the shiny card in Lost & Found', hint: 'Somebody might come back for it.', hold: 0.8, act: () => game.questDeliver('holocard') };
  }

  // --- dropped items
  for (const it of game.groundItems.list) {
    consider(it.x, it.z, () => ({
      label: `Pick up ${itemName(it.kind)}`,
      hint: ITEMS[it.kind] && ITEMS[it.kind].desc,
      hold: 0,
      act: () => game.pickUpGroundItem(it)
    }), 1, null, smallScore(game, it.x, it.z, 0.3));
  }

  // --- toddlers
  for (const t of game.toddlers.list) {
    if (t.state === 'carried' || t.state === 'taken') continue;
    if (t.putDownAt && game.time - t.putDownAt < 1.5) continue;
    consider(t.x, t.z, () => {
      if (p.hands === 'teddy') return { label: `Give the teddy to ${t.name}`, hold: 0.8, act: () => game.teddyToddler(t) };
      const food = p.bag.find(k => isFood(k));
      if (t.hunger > 40 && food) return { label: `Feed ${t.name} your ${itemName(food).toLowerCase()}`, hint: 'Hungry toddlers cry, and crying carries.', hold: 0.7, act: () => game.feedToddler(t, food) };
      if (p.handsFree) return { label: `Pick up ${t.name}`, hint: t.hunger > 65 ? 'Hungry.' : 'Carry them to your classroom.', hold: 0.45, act: () => game.carryToddler(t) };
      return { label: `${t.name} (hands full)`, hold: 0, act: () => game.sfx.deny() };
    }, t.state === 'safe' ? 0.55 : 1, null, smallScore(game, t.x, t.z, 0.35));
  }

  // --- put a carried toddler down
  if (p.carryingToddler) {
    const inHome = game.school.roomAt(p.x, p.z) === game.school.home;
    return {
      label: inHome ? 'Put them down (safe)' : 'Put them down',
      hint: inHome ? '' : 'They are only safe in your classroom.',
      hold: 0.3,
      act: () => game.putDownToddler()
    };
  }

  // --- messes
  const mess = game.messes.nearest(p.x, p.z, REACH);
  if (mess) {
    consider(mess.x, mess.z, () => ({
      label: `Clean up ${mess.label}`,
      hint: 'Mess left at nightfall burns extra fuel.',
      hold: mess.time,
      act: () => game.cleanMess(mess)
    }), 1, 'mess' + mess.id, smallScore(game, mess.x, mess.z, 0.5));
  }

  // --- the generator
  const gen = game.generator;
  if (gen && dist2(p.x, p.z, gen.x, gen.z) < 2.6) {
    consider(gen.x, gen.z, () => {
      const status = `Fuel ${Math.round(gen.fuel)}% · Condition ${Math.round(gen.condition)}%`;
      const opts = [];
      if (p.hands === 'fuel') {
        if (gen.fuel >= 97) opts.push({ label: 'The tank is already full', hint: status, hold: 0, act: () => game.sfx.deny() });
        else opts.push({ label: 'Pour in the fuel', hint: status, hold: 2.2, act: () => { p.hands = null; game.genAction('refuel'); } });
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
        opts.push({ label: fast ? 'Repair it (wrench)' : 'Repair it', hint: status, hold: fast ? 1.3 : 2.6, act: () => { p.take('part'); game.genAction('repair'); } });
      }
      if (!opts.length) {
        return { label: 'The generator is running', hint: `${status} · ${game.fuelTimeLeft()}`, hold: 0, act: () => game.sfx.click() };
      }
      const main = opts[0];
      if (opts[1]) main.extra = Object.assign({ key: 'R' }, opts[1]);
      return main;
    });
  }

  // --- doors
  for (const d of game.school.doors) {
    if (dist2(p.x, p.z, d.x, d.z) > REACH + 0.4) continue;
    consider(d.x, d.z, () => {
      if (d.exit) {
        if (game.escapeOpen) return { label: 'LEAVE', hint: 'Go home.', hold: 2.0, act: () => game.escape() };
        return { label: 'The front doors', hint: 'Chained from the outside.', hold: 0, act: () => { game.sfx.deny(); game.ui.toast('Chained. Something rattles on the far side.'); } };
      }
      if (d.locked) {
        if (p.hasItem('key')) return { label: 'Unlock', hold: 1.0, act: () => { p.take('key'); d.locked = false; game.toggleDoor(d, true); game.ui.toast('Unlocked.'); } };
        return { label: 'Locked', hint: 'A staff key would open it.', hold: 0, act: () => { game.sfx.deny(); game.emitNoise(d.x, d.z, 0.4); } };
      }
      return { label: d.open ? 'Close the door' : 'Open the door', hold: 0, act: () => game.toggleDoor(d, !d.open) };
    });
  }

  // --- light switches
  for (const sw of game.switches) {
    consider(sw.x, sw.z, () => {
      const on = sw.room.lightsOn !== false;
      return {
        label: on ? `Lights off · ${sw.room.name}` : `Lights on · ${sw.room.name}`,
        hint: game.generator.running ? '' : 'No power right now -- they will come on when the generator does.',
        hold: 0, act: () => game.setRoomLights(sw.room, !on, 'player')
      };
    });
  }

  // --- fusebox
  if (game.fusebox) {
    consider(game.fusebox.x, game.fusebox.z, () => ({
      label: 'Reset every breaker',
      hint: 'Switches the whole school back on. Burns fuel fast.',
      hold: 1.6,
      act: () => game.resetBreakers()
    }));
  }

  // --- searchable furniture and hiding places
  for (const prop of game.school.props) {
    if (!prop.search && !prop.hide && !prop.crib) continue;
    if (dist2(p.x, p.z, prop.x, prop.z) > REACH + Math.max(prop.hw, prop.hd) + 0.2) continue;
    const aim = aimAtProp(game, prop);
    if (!aim) continue;
    if (prop.hide) {
      if (aim.score > bestHideScore) { bestHideScore = aim.score; bestHide = prop; }
    }
    consider(aim.x, aim.z, () => {
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
        // Always searchable. The first rummage is the good one; after that
        // there is less and less left, but there is always a chance.
        const n = prop.searchCount || 0;
        const hint = n === 0 ? (prop.hide ? 'You could also hide in here.' : '')
          : n === 1 ? 'Already searched once -- might be something left at the back.'
            : 'Searched a lot today. Probably picked clean.';
        return {
          label: n ? `Search the ${labelOf(prop)} again` : `Search the ${labelOf(prop)}`,
          hint,
          hold: SEARCH_TIME[prop.search] || 1.4,
          extra: prop.hide ? { label: 'Hide', key: 'R', hold: 0.7, act: () => game.hideIn(prop) } : null,
          act: () => game.searchProp(prop)
        };
      }
      if (prop.hide) {
        return {
          label: `Hide ${prop.hide === 'under' ? 'under' : 'in'} the ${labelOf(prop)}`,
          hint: prop.searched ? 'Already searched.' : '',
          isHide: true,
          hold: 0.7,
          act: () => game.hideIn(prop)
        };
      }
      return null;
    }, 1, 'prop' + prop.id, aim.score);
  }

  // --- Mrs. Honeywell
  const hw = game.honeywell;
  if (hw && hw.visible && dist2(p.x, p.z, hw.x, hw.z) < REACH + 0.6) {
    consider(hw.x, hw.z, () => ({
      label: 'Talk to Mrs. Honeywell',
      hint: 'She will go over the list with you.',
      hold: 0,
      act: () => hw.talk()
    }));
  }

  // --- grump
  const g = game.grump;
  if (g && dist2(p.x, p.z, g.x, g.z) < REACH + 0.6) {
    consider(g.x, g.z, () => {
      if (g.hunting || g.turned) {
        return { label: 'Grump', hint: 'He has finished asking.', hold: 0, act: () => game.tryTalkToGrump() };
      }
      if (p.hasItem('crayon')) {
        return { label: 'Give Grump back his crayon', hint: 'The only kind thing you can do for him.', hold: 0.6, act: () => game.questDeliver('crayon') };
      }
      if (g.talkCd > 0) return { label: 'Grump is thinking', hint: 'Give him a moment.', hold: 0, act: () => game.sfx.deny() };
      return {
        label: 'Talk to Grump',
        hint: 'Ignoring him all day costs more than talking to him.',
        hold: 0.35,
        act: () => game.tryTalkToGrump()
      };
    // Holding his crayon, he is what you came for -- do not let a generator or
    // a door standing next to him steal the prompt.
    }, p.hasItem('crayon') ? 1.8 : 1);
  }

  // --- reviving a downed friend
  for (const rp of game.remotePlayers.values()) {
    if (!rp.downed) continue;
    consider(rp.x, rp.z, () => ({
      label: `Pat ${rp.name} until they get up`,
      hold: 3.0,
      act: () => game.requestRevive(rp)
    }));
  }

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

// How squarely are you looking at a piece of furniture? Walks along your line
// of sight and checks it against the whole box (any side, any size), so a big
// sandpit or a lunch table works from wherever you stand. Falls back to the
// nearest edge for a looser score. Returns { x, z, score } or null.
function aimAtProp(game, prop) {
  const p = game.player;
  const c = Math.cos(prop.rot), s = Math.sin(prop.rot);
  const pad = 0.18;
  const local = (x, z) => {
    const dx = x - prop.x, dz = z - prop.z;
    return [dx * c - dz * s, dx * s + dz * c];     // [across, along]
  };
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  for (let t = 0.15; t <= REACH; t += 0.1) {
    const x = p.x + fx * t, z = p.z + fz * t;
    const [u, v] = local(x, z);
    if (Math.abs(u) <= prop.hw + pad && Math.abs(v) <= prop.hd + pad) {
      if (!game.collider.lineClear(p.x, p.z, x - fx * 0.12, z - fz * 0.12)) return null;
      // Same scale as score() with perfect aim, so a toddler or a mess that is
      // closer than the furniture still wins.
      return { x, z, score: (1 - t / REACH) * 0.6 + 0.4 };
    }
  }
  // Not looking straight at it: nearest point on its edge, normal scoring.
  const [u, v] = local(p.x, p.z);
  const cu = Math.max(-prop.hw - pad, Math.min(prop.hw + pad, u));
  const cv = Math.max(-prop.hd - pad, Math.min(prop.hd + pad, v));
  const x = prop.x + cu * c + cv * s, z = prop.z - cu * s + cv * c;
  const sc = score(game, x, z);
  return sc > 0 ? { x, z, score: sc } : null;
}

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
    case 'key':
      game.ui.toast('Use it on a locked door.'); game.sfx.deny(); break;
    default:
      game.ui.toast(`${itemName(kind)} is used elsewhere.`); game.sfx.deny();
  }
}

export function dropHands(game) {
  const p = game.player;
  if (p.carryingToddler) { game.putDownToddler(); return; }
  if (!p.hands) { game.sfx.deny(); return; }
  const f = p.forward();
  game.spawnGroundItem(p.hands, p.x + f.x * 0.9, p.z + f.z * 0.9);
  p.hands = null;
  game.sfx.drop();
}

export { isBig };
