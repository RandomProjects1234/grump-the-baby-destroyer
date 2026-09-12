// Items, and what each kind of container is likely to be holding.
//
// "big" items fill both your hands -- you are a baby, you can only carry one
// awkward thing at a time. Everything else goes in the nappy bag.

export const ITEMS = {
  fuel: {
    name: 'Fuel Can', big: true, icon: '⛽', color: '#c4342a',
    desc: 'Feeds the generator. Half a can gets you through a quiet night.'
  },
  part: {
    name: 'Spare Part', icon: '⚙', color: '#9aa0a4',
    desc: 'The generator is held together with these and hope.'
  },
  wrench: {
    name: 'Wrench', icon: '🔧', color: '#8a9096',
    desc: 'Repairs go twice as fast while this is in the bag.'
  },
  battery: {
    name: 'Battery', icon: '🔋', color: '#2a6a3a',
    desc: 'Torch juice. Also runs a night light.'
  },
  snack: {
    name: 'Snack', icon: '🍪', color: '#e5a83a',
    desc: 'Eat it, or give it to a crying toddler.'
  },
  juice: {
    name: 'Juice Box', icon: '🧃', color: '#e57fa0',
    desc: 'Restores the wobble in your legs.'
  },
  teddy: {
    name: 'Teddy', big: true, icon: '🧸', color: '#a8763f',
    desc: 'Holding it keeps the fear down. Give it to a toddler and they sleep through anything.'
  },
  glowstick: {
    name: 'Glow Stick', icon: '✨', color: '#6cff9a',
    desc: 'Throw it. A little light where the lights have gone.'
  },
  nightlight: {
    name: 'Night Light', icon: '💡', color: '#ffd88a',
    desc: 'Place it anywhere. Needs a battery. Keeps one corner of the dark honest.'
  },
  key: {
    name: 'Staff Key', icon: '🔑', color: '#c8a83a',
    desc: 'Opens the doors grown-ups locked behind them.'
  },
  tape: {
    name: 'Duct Tape', icon: '📦', color: '#b4b0a0',
    desc: 'Tape a locker shut from the inside. Nothing opens it for a while.'
  },
  flashlight: {
    name: 'Torch', icon: '🔦', color: '#d8c43a',
    desc: 'Press F. Eats batteries, and it is very easy to see from a distance.'
  },
  drawing: {
    name: 'Crayon Drawing', icon: '📄', color: '#f2eee0',
    desc: 'Somebody drew this. You should look at it in the light.'
  }
};

export const isBig = k => !!(ITEMS[k] && ITEMS[k].big);
export const itemName = k => (ITEMS[k] ? ITEMS[k].name : k);

// ---------------------------------------------------------------- loot

// [kind, weight]. Rolled once per search; `empty` weight means nothing found.
const TABLES = {
  locker: [['snack', 5], ['battery', 3], ['drawing', 2], ['glowstick', 2], ['juice', 3], ['tape', 2], ['empty', 9]],
  desk: [['snack', 4], ['drawing', 3], ['glowstick', 1], ['battery', 1], ['empty', 11]],
  teacher: [['key', 4], ['battery', 3], ['tape', 2], ['snack', 2], ['flashlight', 2], ['empty', 6]],
  cabinet: [['part', 4], ['battery', 3], ['tape', 3], ['nightlight', 2], ['empty', 7]],
  bin: [['drawing', 2], ['part', 1], ['snack', 1], ['empty', 13]],
  toy: [['teddy', 5], ['glowstick', 3], ['drawing', 2], ['snack', 2], ['empty', 6]],
  book: [['drawing', 4], ['battery', 2], ['snack', 1], ['empty', 10]],
  art: [['tape', 4], ['drawing', 3], ['glowstick', 3], ['part', 2], ['empty', 7]],
  music: [['drawing', 3], ['battery', 2], ['snack', 2], ['empty', 10]],
  gym: [['juice', 4], ['snack', 3], ['tape', 2], ['empty', 8]],
  cafe: [['snack', 6], ['juice', 5], ['drawing', 1], ['empty', 7]],
  vending: [['snack', 7], ['juice', 6], ['empty', 5]],
  kitchen: [['snack', 6], ['juice', 4], ['part', 2], ['key', 1], ['empty', 6]],
  boiler: [['fuel', 6], ['part', 6], ['wrench', 3], ['battery', 2], ['empty', 4]],
  storage: [['fuel', 5], ['part', 5], ['battery', 3], ['nightlight', 3], ['tape', 2], ['empty', 5]],
  nurse: [['snack', 4], ['juice', 4], ['teddy', 2], ['battery', 2], ['empty', 6]],
  lost: [['teddy', 5], ['glowstick', 3], ['key', 2], ['drawing', 3], ['snack', 2], ['empty', 6]],
  staff: [['key', 4], ['flashlight', 3], ['battery', 3], ['snack', 3], ['juice', 2], ['empty', 6]],
  sand: [['glowstick', 2], ['drawing', 2], ['part', 1], ['empty', 12]]
};

// Later nights are leaner: the easy pickings are gone.
export function rollLoot(kind, rng, night) {
  const table = TABLES[kind] || TABLES.desk;
  const scarcity = 1 + Math.max(0, night - 1) * 0.35;
  let total = 0;
  const rows = table.map(([k, w]) => {
    const weight = k === 'empty' ? w * scarcity : w;
    total += weight;
    return [k, weight];
  });
  let roll = rng() * total;
  for (const [k, w] of rows) {
    roll -= w;
    if (roll <= 0) return k === 'empty' ? null : k;
  }
  return null;
}

// How long a container takes to rummage through.
export const SEARCH_TIME = {
  locker: 1.6, desk: 1.0, teacher: 1.8, cabinet: 1.5, bin: 0.9, toy: 1.2,
  book: 1.4, art: 1.3, music: 1.3, gym: 1.3, cafe: 1.1, vending: 2.2,
  kitchen: 1.5, boiler: 1.8, storage: 1.7, nurse: 1.5, lost: 1.4, staff: 1.8, sand: 2.0
};

// ---------------------------------------------------------------- lore

// One page per night, unlocked by finding drawings. This is the reveal.
export const DRAWINGS = [
  {
    title: 'Everyone Went Home',
    text: 'A yellow bus. Fourteen stick children in the windows. One stick child on the pavement, drawn much smaller than the rest, with no arms.'
  },
  {
    title: 'The New Boy',
    text: 'A boy in green dungarees, drawn bigger than the school. Underneath, in wobbly letters: HE ASKS YOU THINGS. DO NOT ANSWER. I ANSWERED.'
  },
  {
    title: 'Class Photo',
    text: 'A row of faces with the eyes scribbled out. In the back row, one face is left alone. It is smiling. Someone has written GRUMP under it, then crossed it out and written a longer word that will not fit on the page.'
  },
  {
    title: 'What Bob Found',
    text: 'A man with a mop and a torch. Beside him, a heap of small shoes, carefully coloured in. The caption reads: BOB PUTS THEM IN LOST AND FOUND. BOB IS TIDY. BOB DOES NOT LOOK IN THE BOXES.'
  },
  {
    title: 'The Baby Destroyer',
    text: 'The green boy again, taller than the corridor, arms down to the floor. Every child in the picture is drawn behind him, in a line, holding hands, walking the other way. The last one has turned around.'
  },
  {
    title: 'The Rule',
    text: 'Just words, pressed so hard the crayon tore through: THERE IS NO RIGHT ANSWER. THAT IS THE ANSWER.'
  },
  {
    title: 'Room 101',
    text: 'A map of the school, drawn from memory and mostly wrong. One classroom is coloured in solid black. An arrow points at it. The arrow says: DO NOT LET HIM IN. THE LIGHTS ARE THE DOOR.'
  }
];
