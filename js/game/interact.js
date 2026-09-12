// Finds whatever the player is looking at and turns it into a prompt plus an
// action. Anything that takes effort is a hold, so the player is committed and
// vulnerable while they do it.
import { ITEMS, SEARCH_TIME, isBig, itemName } from './items.js';
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
  const consider = (x, z, make) => {
    const s = score(game, x, z);
    if (s > bestScore) { const o = make(); if (o) { bestScore = s; best = o; } }
  };

  // --- dropped items
  for (const it of game.groundItems.list) {
    consider(it.x, it.z, () => ({
      label: `Pick up ${itemName(it.kind)}`,
      hint: ITEMS[it.kind] && ITEMS[it.kind].desc,
      hold: 0,
      act: () => game.pickUpGroundItem(it)
    }));
  }

  // --- toddlers
  for (const t of game.toddlers.list) {
    if (t.state === 'carried' || t.state === 'taken') continue;
    consider(t.x, t.z, () => {
      if (p.hands === 'teddy') return { label: `Give the teddy to ${t.name}`, hold: 0.8, act: () => { p.hands = null; game.toddlers.calmWithTeddy(t, game); } };
      if (t.hunger > 40 && p.hasItem('snack')) return { label: `Feed ${t.name}`, hold: 0.7, act: () => { p.take('snack'); game.toddlers.feed(t, game); } };
      if (p.handsFree) return { label: `Pick up ${t.name}`, hint: t.hunger > 65 ? 'Hungry.' : 'Carry them to your classroom.', hold: 0.45, act: () => game.carryToddler(t) };
      return { label: `${t.name} (hands full)`, hold: 0, act: () => game.sfx.deny() };
    });
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
      act: () => game.messes.clean(mess, game)
    }));
  }

  // --- the generator
  const gen = game.generator;
  if (gen && dist2(p.x, p.z, gen.x, gen.z) < 2.6) {
    consider(gen.x, gen.z, () => {
      if (p.hands === 'fuel') return { label: 'Pour in the fuel', hold: 2.2, act: () => { p.hands = null; gen.refuel(game); } };
      if (p.hasItem('part')) {
        const fast = p.hasItem('wrench');
        return { label: fast ? 'Repair (wrench)' : 'Repair', hint: `Condition ${Math.round(gen.condition)}%`, hold: fast ? 1.3 : 2.6, act: () => { p.take('part'); gen.repair(game); } };
      }
      if (!gen.running) return { label: 'Pull the starter cord', hint: `Fuel ${Math.round(gen.fuel)}% · Condition ${Math.round(gen.condition)}%`, hold: 1.1, act: () => gen.start(game) };
      return { label: 'The generator is running', hint: `Fuel ${Math.round(gen.fuel)}% · ${game.fuelTimeLeft()}`, hold: 0, act: () => game.sfx.click() };
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
      const on = game.roomLit(sw.room) > 0.5;
      if (!game.generator.running) return { label: 'The switch clicks. Nothing.', hint: 'No power.', hold: 0, act: () => { game.sfx.click(); game.sfx.deny(); } };
      return { label: on ? `Lights off · ${sw.room.name}` : `Lights on · ${sw.room.name}`, hold: 0, act: () => game.setRoomLights(sw.room, !on, 'player') };
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
    const fx = Math.sin(prop.rot), fz = Math.cos(prop.rot);
    const ax = prop.x + fx * (prop.hd + 0.15), az = prop.z + fz * (prop.hd + 0.15);
    if (dist2(p.x, p.z, ax, az) > REACH) continue;
    consider(ax, az, () => {
      if (prop.crib) {
        return { label: 'The crib', hint: `${game.toddlers.saved} little ones safe here.`, hold: 0, act: () => game.sfx.babble() };
      }
      if (prop.search && !prop.searched) {
        return {
          label: `Search the ${labelOf(prop)}`,
          hint: prop.hide ? 'You could also hide in here.' : '',
          hold: SEARCH_TIME[prop.search] || 1.4,
          extra: prop.hide ? { label: 'Hide', key: 'R', hold: 0.7, act: () => game.hideIn(prop) } : null,
          act: () => game.searchProp(prop)
        };
      }
      if (prop.hide) {
        return {
          label: `Hide ${prop.hide === 'under' ? 'under' : 'in'} the ${labelOf(prop)}`,
          hint: prop.searched ? 'Already searched.' : '',
          hold: 0.7,
          act: () => game.hideIn(prop)
        };
      }
      return { label: `${labelOf(prop)} (empty)`, hold: 0, act: () => game.sfx.deny() };
    });
  }

  // --- grump
  const g = game.grump;
  if (g && dist2(p.x, p.z, g.x, g.z) < REACH + 0.6) {
    consider(g.x, g.z, () => {
      if (g.hunting || g.turned) {
        return { label: 'Grump', hint: 'He has finished asking.', hold: 0, act: () => game.tryTalkToGrump() };
      }
      if (g.talkCd > 0) return { label: 'Grump is thinking', hint: 'Give him a moment.', hold: 0, act: () => game.sfx.deny() };
      return {
        label: 'Talk to Grump',
        hint: 'Ignoring him all day costs more than talking to him.',
        hold: 0.35,
        act: () => game.tryTalkToGrump()
      };
    });
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
  switch (kind) {
    case 'snack':
      p.take('snack'); p.food = Math.min(100, p.food + 42); p.fear = Math.max(0, p.fear - 6);
      game.sfx.eat(); game.ui.toast('Nom.'); break;
    case 'juice':
      p.take('juice'); p.stamina = 100; p.fear = Math.max(0, p.fear - 10);
      game.sfx.eat(); game.ui.toast('Juice. Legs work again.'); break;
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
