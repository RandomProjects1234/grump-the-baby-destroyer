// Mrs. Honeywell's list.
//
// Every morning your teacher's to-do list is on the board: three or four small
// jobs that send you out into the building. Finishing one leaves a reward in
// the crib back in your classroom, so the day becomes a loop of going out,
// doing the thing, and coming home to collect.
//
// The host owns progress. It sends the list itself as a compact spec (template
// id + parameters), so every player sees the same jobs even when the list
// depends on something only the host knows, like whether Grump has turned.
import { makeRng, hashStr } from '../util/util.js';
import { itemName } from './items.js';

const ROOM_LABEL = {
  library: 'the library', art: 'the art room', music: 'the music room', gym: 'the gym',
  cafeteria: 'the cafeteria', kitchen: 'the kitchen', storage: 'the storage room',
  nurse: 'the nurse office', lostfound: 'Lost & Found', staff: 'the staff room',
  yard: 'the playground', boiler: 'the boiler room', bathroom: 'the bathroom'
};

// Rewards are either things left in the crib, or a favour done for you.
const REWARD_POOLS = {
  basic: [['battery'], ['snack', 'apple'], ['glowstick', 'glowstick'], ['juice'], ['tape']],
  good: [['sandwich'], ['nightlight', 'battery'], ['teddy'], ['part'], ['milk', 'apple']],
  great: [['fuel'], ['key', 'sandwich'], ['wrench'], ['part', 'part'], ['nightlight', 'battery', 'snack']]
};

// Each template: how to describe it, what event advances it, and how hard it is.
const TEMPLATES = {
  genStart: {
    title: () => 'Get the lights working',
    desc: () => 'Pull the starter cord on the generator in the boiler room.',
    event: 'genStart', goal: () => 1, tier: 'good'
  },
  fuel: {
    title: () => 'Feed the generator',
    desc: s => `Pour ${s.g} can${s.g > 1 ? 's' : ''} of fuel into it.`,
    event: 'refuel', goal: n => n >= 4 ? 2 : 1, tier: 'great'
  },
  repair: {
    title: () => 'Patch it up',
    desc: s => `Fit ${s.g} spare part${s.g > 1 ? 's' : ''} to the generator.`,
    event: 'repair', goal: n => n >= 5 ? 2 : 1, tier: 'good'
  },
  clean: {
    title: () => 'Tidy up',
    desc: s => `Clean up ${s.g} messes. Mrs. Honeywell hates a mess.`,
    event: 'clean', goal: n => Math.min(5, 2 + Math.floor(n / 3)), tier: 'good'
  },
  eat: {
    title: () => 'Lunch time',
    desc: s => `Eat ${s.g} thing${s.g > 1 ? 's' : ''}. Big babies need big lunches.`,
    event: 'eat', goal: n => n <= 1 ? 1 : 2, tier: 'basic'
  },
  feed: {
    title: () => 'Snack time for the little ones',
    desc: s => `Feed ${s.g} hungry toddler${s.g > 1 ? 's' : ''}.`,
    event: 'fed', goal: () => 1, tier: 'good'
  },
  rescue: {
    title: () => 'Round them up',
    desc: s => `Carry ${s.g} little one${s.g > 1 ? 's' : ''} back to your classroom.`,
    event: 'saved', goal: n => n <= 1 ? 1 : 2, tier: 'great'
  },
  searchRoom: {
    title: s => `Rummage through ${ROOM_LABEL[s.p] || s.p}`,
    desc: s => `Search ${s.g} things in ${ROOM_LABEL[s.p] || s.p}.`,
    event: 'search', match: (s, d) => d.room === s.p, goal: () => 3, tier: 'basic'
  },
  lights: {
    title: s => `Brighten ${ROOM_LABEL[s.p] || s.p}`,
    desc: s => `Switch the lights on in ${ROOM_LABEL[s.p] || s.p}.`,
    event: 'lights', match: (s, d) => d.room === s.p && d.on, goal: () => 1, tier: 'basic'
  },
  visit: {
    title: s => `Go and look at ${ROOM_LABEL[s.p] || s.p}`,
    desc: s => `Somebody should check on ${ROOM_LABEL[s.p] || s.p}.`,
    event: 'visit', match: (s, d) => d.room === s.p, goal: () => 1, tier: 'basic'
  },
  hide: {
    title: () => 'Hide and seek',
    desc: s => `Hide in ${s.g} places. Practice for later.`,
    event: 'hide', goal: () => 3, tier: 'basic'
  },
  drawing: {
    title: () => 'Read the walls',
    desc: () => 'Find a crayon drawing and look at it.',
    event: 'drawing', goal: () => 1, tier: 'basic'
  },
  hamster: {
    title: () => 'Find Mr. Wiggles',
    desc: s => `The class hamster escaped into ${ROOM_LABEL[s.p] || 'the school'}. Put him back in the crib.`,
    event: 'deliver', match: (s, d) => d.item === 'hamster', goal: () => 1, tier: 'great',
    spawn: 'hamster'
  },
  crayon: {
    title: () => "Grump's crayon",
    desc: s => `Grump lost his green crayon in ${ROOM_LABEL[s.p] || 'the school'}. Give it back to him.`,
    event: 'deliver', match: (s, d) => d.item === 'crayon', goal: () => 1, tier: 'good',
    spawn: 'crayon', perk: 'calm'
  },
  holocard: {
    title: () => 'The shiny card',
    desc: s => `A boy dropped a card in ${ROOM_LABEL[s.p] || 'the school'}. Leave it in Lost & Found.`,
    event: 'deliver', match: (s, d) => d.item === 'holocard', goal: () => 1, tier: 'good',
    spawn: 'holocard'
  }
};

// Rooms worth sending a baby to, per template.
const PLACES = {
  searchRoom: ['library', 'art', 'music', 'cafeteria', 'kitchen', 'nurse', 'lostfound', 'storage'],
  lights: ['library', 'art', 'music', 'gym', 'cafeteria', 'kitchen', 'nurse'],
  visit: ['yard', 'gym', 'library', 'music', 'bathroom', 'staff'],
  hamster: ['gym', 'library', 'art', 'music', 'cafeteria', 'nurse', 'yard'],
  crayon: ['art', 'library', 'cafeteria', 'gym', 'bathroom'],
  holocard: ['gym', 'yard', 'cafeteria', 'music', 'library']
};

export class Quests {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.night = 0;
    this.completed = 0;
  }

  // ---------------------------------------------------------------- planning

  // Host only: decide today's list.
  plan(night, seed) {
    const g = this.game;
    const rng = makeRng(hashStr(seed + ':quests:' + night));
    let picks;
    if (night === 1) {
      // Day one teaches the loop.
      picks = ['genStart', 'eat', 'rescue'];
    } else {
      const pool = ['fuel', 'repair', 'clean', 'eat', 'feed', 'rescue', 'searchRoom', 'lights',
        'visit', 'hide', 'drawing', 'hamster', 'holocard'];
      if (!g.grump.turned) pool.push('crayon', 'crayon');
      // The big three (fuel, food, children) come up more than the flavour jobs.
      pool.push('fuel', 'eat', 'rescue');
      const want = night >= 6 ? 4 : 3;
      picks = [];
      rng.shuffle(pool);
      for (const t of pool) {
        if (picks.length >= want) break;
        if (picks.includes(t)) continue;
        picks.push(t);
      }
    }
    const spec = picks.map(t => {
      const tpl = TEMPLATES[t];
      const places = PLACES[t];
      return { t, p: places ? rng.pick(places) : null, g: tpl.goal(night) };
    });
    return spec;
  }

  // Everyone: build the live list from a spec.
  load(spec, night) {
    this.night = night;
    this.list = spec.map((s, i) => {
      const tpl = TEMPLATES[s.t];
      return {
        i, spec: s, tpl,
        title: tpl.title(s), desc: tpl.desc(s),
        goal: s.g, progress: 0, done: false,
        reward: null
      };
    });
  }

  // Host: drop any quest objects into the world.
  spawnItems() {
    const g = this.game;
    const s = g.school;
    for (const q of this.list) {
      if (!q.tpl.spawn) continue;
      const room = s.rooms.find(r => r.type === q.spec.p) || s.gym;
      // Try a few spots so it never lands inside a desk.
      let x = room.cx, z = room.cz;
      for (let k = 0; k < 12; k++) {
        const tx = room.cx + (Math.random() - 0.5) * (room.w - 1.2) * s.CELL;
        const tz = room.cz + (Math.random() - 0.5) * (room.h - 1.2) * s.CELL;
        if (g.collider.free(tx, tz, 0.3)) { x = tx; z = tz; break; }
      }
      g.spawnGroundItem(q.tpl.spawn, x, z);
    }
  }

  // ---------------------------------------------------------------- progress

  // Host only. Returns nothing; completion side effects go through the game.
  event(type, data = {}) {
    for (const q of this.list) {
      if (q.done || q.tpl.event !== type) continue;
      if (q.tpl.match && !q.tpl.match(q.spec, data)) continue;
      q.progress = Math.min(q.goal, q.progress + (data.amount || 1));
      if (q.progress >= q.goal) this.complete(q);
    }
  }

  complete(q) {
    const g = this.game;
    q.done = true;
    this.completed++;
    const rng = makeRng(hashStr(g.seed + ':reward:' + this.night + ':' + q.i));
    const pool = REWARD_POOLS[q.tpl.tier] || REWARD_POOLS.basic;
    const items = pool[Math.floor(rng() * pool.length) % pool.length];
    q.reward = items;
    g.questReward(q, items);
  }

  get allDone() { return this.list.length > 0 && this.list.every(q => q.done); }

  serialize() { return this.list.map(q => [q.progress, q.done ? 1 : 0]); }

  apply(rows) {
    if (!rows) return;
    rows.forEach((r, i) => {
      const q = this.list[i];
      if (!q) return;
      const wasDone = q.done;
      q.progress = r[0];
      q.done = !!r[1];
      if (q.done && !wasDone) this.game.onQuestSeenDone(q);
    });
  }

  html() {
    if (!this.list.length) return '';
    const rows = this.list.map(q => {
      const pct = Math.round((q.progress / q.goal) * 100);
      return `<div class="q ${q.done ? 'done' : ''}">
        <span class="qbox">${q.done ? '✓' : ''}</span>
        <span class="qt">${q.title}${q.goal > 1 && !q.done ? ` <em>${q.progress}/${q.goal}</em>` : ''}</span>
        ${q.done ? '' : `<span class="qbar"><i style="width:${pct}%"></i></span>`}
      </div>`;
    }).join('');
    return `<h5>Mrs. Honeywell's list</h5>${rows}`;
  }

  detailHtml() {
    return this.list.map(q =>
      `<div class="${q.done ? 'done' : ''}">${q.done ? '✓' : '☐'} <b>${q.title}</b> — ${q.desc}` +
      (q.done && q.reward ? ` <i>(left ${q.reward.map(itemName).join(' + ')} in the crib)</i>` : '') +
      '</div>').join('');
  }
}
