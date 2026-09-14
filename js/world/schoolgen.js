// Builds the school: a cell grid, then walls, doors, lights and furniture.
//
// Everything here is a pure function of the seed. Multiplayer never sends
// geometry -- the host sends one number and every client rebuilds the same
// building from it, right down to which locker holds the wrench.
import { makeRng } from '../util/util.js?v=2026-09-13f';

export const CELL = 2.4;         // metres per grid cell
export const WALL_H = 3.0;       // standard ceiling height
export const WALL_T = 0.26;      // wall thickness

export const GRID_W = 36;
export const GRID_H = 32;

// Band layout, in grid rows. The building is a squat "H": two long corridors
// crossed by one spine, with rooms filling the blocks between them.
const NORTH = [1, 6];
const CORR_A = [7, 8];
const MIDDLE = [9, 16];
const CORR_B = [17, 18];
const SOUTH = [19, 24];
const YARD = [25, 30];
const SPINE = [17, 18];
const LEFT = [1, 16];
const RIGHT = [19, 34];
const YARD_X = [7, 28];

export const T = {
  HALL: 'hall', CLASSROOM: 'classroom', HOME: 'home', LIBRARY: 'library',
  ART: 'art', MUSIC: 'music', GYM: 'gym', CAFETERIA: 'cafeteria', KITCHEN: 'kitchen',
  BOILER: 'boiler', STORAGE: 'storage', BATHROOM: 'bathroom', NURSE: 'nurse',
  LOSTFOUND: 'lostfound', STAFF: 'staff', YARD: 'yard'
};

const ROOM_STYLE = {
  hall: { floor: 'floorHall', wall: 'wallTile', name: 'Hallway' },
  classroom: { floor: 'floorRoom', wall: 'wallPaint', name: 'Classroom' },
  home: { floor: 'floorRoom', wall: 'wallPaintBlue', name: 'Your Classroom' },
  library: { floor: 'floorCarpet', wall: 'wallPaint', name: 'Library' },
  art: { floor: 'floorRoom', wall: 'wallPaint', name: 'Art Room' },
  music: { floor: 'floorCarpet', wall: 'wallPaintBlue', name: 'Music Room' },
  gym: { floor: 'floorGym', wall: 'cinder', name: 'Gymnasium', ceil: 5.4 },
  cafeteria: { floor: 'floorHall', wall: 'wallPaint', name: 'Cafeteria', ceil: 3.6 },
  kitchen: { floor: 'floorConcrete', wall: 'wallTile', name: 'Kitchen' },
  boiler: { floor: 'floorConcrete', wall: 'cinder', name: 'Boiler Room' },
  storage: { floor: 'floorConcrete', wall: 'cinder', name: 'Storage' },
  bathroom: { floor: 'floorConcrete', wall: 'wallTile', name: 'Bathroom' },
  nurse: { floor: 'floorRoom', wall: 'wallTile', name: 'Nurse Office' },
  lostfound: { floor: 'floorRoom', wall: 'wallPaint', name: 'Lost & Found' },
  staff: { floor: 'floorCarpet', wall: 'wallPaint', name: 'Staff Room' },
  yard: { floor: 'grass', wall: null, name: 'Playground', ceil: 0 }
};

export function roomStyle(type) { return ROOM_STYLE[type] || ROOM_STYLE.classroom; }

// Rooms whose outside walls stay solid -- no daylight gets into these.
const NO_WINDOWS = new Set([T.BOILER, T.STORAGE, T.BATHROOM, T.KITCHEN]);

export function generateSchool(seed) {
  const rng = makeRng(seed >>> 0);
  const W = GRID_W, H = GRID_H;
  const cells = new Int16Array(W * H).fill(-1);
  const rooms = [];

  const OX = -W * CELL / 2, OZ = -H * CELL / 2;
  const wx = gx => OX + gx * CELL;             // grid line -> world
  const wz = gy => OZ + gy * CELL;
  const cwx = gx => OX + (gx + 0.5) * CELL;    // cell centre -> world
  const cwz = gy => OZ + (gy + 0.5) * CELL;

  function addRoom(type, x0, y0, x1, y1) {
    const st = roomStyle(type);
    const r = {
      id: rooms.length, type, name: st.name,
      x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1,
      cx: (cwx(x0) + cwx(x1)) / 2, cz: (cwz(y0) + cwz(y1)) / 2,
      ceil: st.ceil === undefined ? WALL_H : st.ceil,
      floorTex: st.floor, wallTex: st.wall,
      outdoor: type === T.YARD,
      fixtures: [], doors: [], lit: true
    };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * W + x] = r.id;
    rooms.push(r);
    return r;
  }

  // --- corridors ------------------------------------------------------------
  const hallA = addRoom(T.HALL, LEFT[0], CORR_A[0], RIGHT[1], CORR_A[1]);
  const hallB = addRoom(T.HALL, LEFT[0], CORR_B[0], RIGHT[1], CORR_B[1]);
  const spine = addRoom(T.HALL, SPINE[0], NORTH[0], SPINE[1], SOUTH[1]);
  hallA.name = 'North Hall'; hallB.name = 'South Hall'; spine.name = 'Main Hall';

  // --- room bands -----------------------------------------------------------
  function split(x0, x1, count) {
    const total = x1 - x0 + 1;
    const base = Math.floor(total / count);
    const widths = new Array(count).fill(base);
    let extra = total - base * count;
    while (extra > 0) { widths[rng.int(0, count - 1)]++; extra--; }
    const out = [];
    let x = x0;
    for (const w of widths) { out.push([x, x + w - 1]); x += w; }
    return out;
  }

  const northL = split(LEFT[0], LEFT[1], 3).map(([a, b]) => addRoom(T.CLASSROOM, a, NORTH[0], b, NORTH[1]));
  const northR = split(RIGHT[0], RIGHT[1], 3).map(([a, b]) => addRoom(T.CLASSROOM, a, NORTH[0], b, NORTH[1]));
  const kitchen = addRoom(T.KITCHEN, LEFT[0], MIDDLE[0], LEFT[0] + 4, MIDDLE[1]);
  const cafeteria = addRoom(T.CAFETERIA, LEFT[0] + 5, MIDDLE[0], LEFT[1], MIDDLE[1]);
  const gym = addRoom(T.GYM, RIGHT[0], MIDDLE[0], RIGHT[1], MIDDLE[1]);
  const southL = split(LEFT[0], LEFT[1], 3).map(([a, b]) => addRoom(T.CLASSROOM, a, SOUTH[0], b, SOUTH[1]));
  const southR = split(RIGHT[0], RIGHT[1], 3).map(([a, b]) => addRoom(T.CLASSROOM, a, SOUTH[0], b, SOUTH[1]));
  const yard = addRoom(T.YARD, YARD_X[0], YARD[0], YARD_X[1], YARD[1]);

  // --- assign the special rooms --------------------------------------------
  const retype = (room, type) => {
    const st = roomStyle(type);
    room.type = type; room.name = st.name;
    room.floorTex = st.floor; room.wallTex = st.wall;
    room.ceil = st.ceil === undefined ? WALL_H : st.ceil;
    return room;
  };

  // The boiler sits in the far south-west corner: the run home at night is long.
  retype(southL[0], T.BOILER);
  retype(southL[1], T.STORAGE);
  retype(southL[2], T.BATHROOM);
  retype(southR[0], T.LOSTFOUND);
  retype(southR[1], T.STAFF);

  const northPool = rng.shuffle([...northL, ...northR]);
  retype(northPool[0], T.LIBRARY);
  retype(northPool[1], T.ART);
  retype(northPool[2], T.MUSIC);
  retype(northPool[3], T.NURSE);
  const home = retype(northPool[4], T.HOME);

  let roomNo = 101;
  for (const r of rooms) if (r.type === T.CLASSROOM) r.name = 'Room ' + (roomNo++);

  // --- wall edge grids ------------------------------------------------------
  // wallV[x + y*(W+1)] = wall on the WEST edge of cell (x,y)
  // wallH[x + y*W]     = wall on the NORTH edge of cell (x,y)
  // 0 = open, 1 = wall, 2 = doorway
  const wallV = new Uint8Array((W + 1) * H);
  const wallH = new Uint8Array(W * (H + 1));
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : cells[y * W + x];

  for (let y = 0; y < H; y++)
    for (let x = 0; x <= W; x++)
      if (at(x - 1, y) !== at(x, y)) wallV[x + y * (W + 1)] = 1;
  for (let y = 0; y <= H; y++)
    for (let x = 0; x < W; x++)
      if (at(x, y - 1) !== at(x, y)) wallH[x + y * W] = 1;

  // The yard is fenced, not walled: drop wall segments where it meets open air.
  const fences = [];
  for (let y = YARD[0]; y <= YARD[1]; y++) {
    for (let x = YARD_X[0]; x <= YARD_X[1] + 1; x++) {
      const i = x + y * (W + 1);
      const a = at(x - 1, y), b = at(x, y);
      if (wallV[i] && (a === yard.id || b === yard.id) && (a === -1 || b === -1)) {
        wallV[i] = 0;
        fences.push({ x1: wx(x), z1: wz(y), x2: wx(x), z2: wz(y + 1) });
      }
    }
  }
  for (let y = YARD[0]; y <= YARD[1] + 1; y++) {
    for (let x = YARD_X[0]; x <= YARD_X[1]; x++) {
      const i = x + y * W;
      const a = at(x, y - 1), b = at(x, y);
      if (wallH[i] && (a === yard.id || b === yard.id) && (a === -1 || b === -1)) {
        wallH[i] = 0;
        fences.push({ x1: wx(x), z1: wz(y), x2: wx(x + 1), z2: wz(y) });
      }
    }
  }

  // --- doors ----------------------------------------------------------------
  const doors = [];
  const isHall = id => id >= 0 && rooms[id].type === T.HALL;

  function punchDoor(x, y, dir, opts = {}) {
    const idx = dir === 'w' ? x + y * (W + 1) : x + y * W;
    const arr = dir === 'w' ? wallV : wallH;
    if (arr[idx] !== 1) return null;
    arr[idx] = 2;
    const a = dir === 'w' ? at(x - 1, y) : at(x, y - 1);
    const b = at(x, y);
    const d = {
      id: doors.length, dir, gx: x, gy: y,
      x: dir === 'w' ? wx(x) : cwx(x),
      z: dir === 'w' ? cwz(y) : wz(y),
      a, b,
      open: false, locked: !!opts.locked, exit: !!opts.exit, yard: !!opts.yard,
      swing: 0, style: opts.style || 'door'
    };
    doors.push(d);
    if (a >= 0) rooms[a].doors.push(d.id);
    if (b >= 0 && b !== a) rooms[b].doors.push(d.id);
    return d;
  }

  for (const r of rooms) {
    if (r.type === T.HALL || r.type === T.YARD) continue;
    const cand = [];
    for (let x = r.x0; x <= r.x1; x++) {
      if (isHall(at(x, r.y0 - 1))) cand.push([x, r.y0, 'n']);
      if (isHall(at(x, r.y1 + 1))) cand.push([x, r.y1 + 1, 'n']);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      if (isHall(at(r.x0 - 1, y))) cand.push([r.x0, y, 'w']);
      if (isHall(at(r.x1 + 1, y))) cand.push([r.x1 + 1, y, 'w']);
    }
    if (!cand.length) continue;
    rng.shuffle(cand);
    const want = r.w * r.h > 80 ? 3 : (r.w * r.h > 30 ? 2 : 1);
    const used = [];
    for (const c of cand) {
      if (used.length >= want) break;
      if (used.some(u => Math.abs(u[0] - c[0]) + Math.abs(u[1] - c[1]) < 3)) continue;
      // Only the staff room starts locked. The boiler room holds the generator,
      // so sealing it behind a key roll could make a run unwinnable.
      const locked = r.type === T.STAFF && used.length === 0;
      punchDoor(c[0], c[1], c[2], { locked });
      used.push(c);
    }
    if (!used.length) punchDoor(cand[0][0], cand[0][1], cand[0][2], {});
  }

  // Open the two crossroads. The spine is its own room laid over the long
  // halls, so the cell ids differ down both its sides and the wall pass sealed
  // it off -- without this the school is two buildings that cannot see each
  // other, and the east wing is unreachable.
  for (const band of [CORR_A, CORR_B]) {
    for (let y = band[0]; y <= band[1]; y++) {
      wallV[SPINE[0] + y * (W + 1)] = 0;        // spine <-> west half
      wallV[(SPINE[1] + 1) + y * (W + 1)] = 0;  // spine <-> east half
    }
  }

  const yardDoors = [
    punchDoor(SPINE[0], YARD[0], 'n', { style: 'double', yard: true }),
    punchDoor(SPINE[1], YARD[0], 'n', { style: 'double', yard: true })
  ].filter(Boolean);
  const exitDoors = [
    punchDoor(SPINE[0], NORTH[0], 'n', { locked: true, exit: true, style: 'double' }),
    punchDoor(SPINE[1], NORTH[0], 'n', { locked: true, exit: true, style: 'double' })
  ].filter(Boolean);
  const exitPos = { x: cwx(SPINE[0]) + CELL / 2, z: wz(NORTH[0]) - 2.0 };

  // --- wall faces + collision runs ------------------------------------------
  // Each wall segment paints one quad per side, so a room keeps its own colour
  // on its own face and the gym can be taller than the corridor beside it.
  const wallFaces = [];
  const collision = [];

  function heightOf(id) {
    if (id < 0) return 0;
    return rooms[id].outdoor ? 0 : rooms[id].ceil;
  }
  function texOf(id) {
    if (id < 0) return 'cinder';
    return rooms[id].outdoor ? 'cinder' : rooms[id].wallTex;
  }
  // Outer shell height: the tallest thing behind that wall, plus a parapet.
  function shellHeight(id) { return Math.max(3.4, heightOf(id) + 0.5); }

  function pushSeg(dir, gx, gy, aId, bId, windowed) {
    // The playground is outdoors: from out there, a wall is the outside of
    // the building, so it gets an exterior face just like the edge of the map.
    const outdoor = id => id >= 0 && rooms[id].outdoor;
    const outerA = aId < 0 || (outdoor(aId) && !outdoor(bId)), outerB = bId < 0 || (outdoor(bId) && !outdoor(aId));
    const exterior = outerA || outerB;
    const inId = outerA ? bId : aId;
    const hIn = exterior ? shellHeight(inId) : 0;
    const seg = {
      dir, gx, gy, exterior,
      // side A is west (for 'w' segments) or north (for 'n' segments)
      a: aId, b: bId,
      hA: outerA ? hIn : heightOf(aId),
      hB: outerB ? hIn : heightOf(bId),
      texA: texOf(aId), texB: texOf(bId),
      windowed: windowed && exterior
    };
    wallFaces.push(seg);
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x <= W; x++) {
      if (wallV[x + y * (W + 1)] !== 1) continue;
      const a = at(x - 1, y), b = at(x, y);
      const inId = a < 0 ? b : a;
      const win = inId >= 0 && !NO_WINDOWS.has(rooms[inId].type) && !rooms[inId].outdoor;
      pushSeg('w', x, y, a, b, win);
    }
  }
  for (let y = 0; y <= H; y++) {
    for (let x = 0; x < W; x++) {
      if (wallH[x + y * W] !== 1) continue;
      const a = at(x, y - 1), b = at(x, y);
      const inId = a < 0 ? b : a;
      const win = inId >= 0 && !NO_WINDOWS.has(rooms[inId].type) && !rooms[inId].outdoor;
      pushSeg('n', x, y, a, b, win);
    }
  }

  // Collision runs: merge neighbouring segments into long boxes.
  for (let x = 0; x <= W; x++) {
    let y = 0;
    while (y < H) {
      if (wallV[x + y * (W + 1)] !== 1) { y++; continue; }
      let len = 1;
      while (y + len < H && wallV[x + (y + len) * (W + 1)] === 1) len++;
      collision.push({ x: wx(x), z: wz(y) + len * CELL / 2, hw: WALL_T / 2, hd: len * CELL / 2 });
      y += len;
    }
  }
  for (let y = 0; y <= H; y++) {
    let x = 0;
    while (x < W) {
      if (wallH[x + y * W] !== 1) { x++; continue; }
      let len = 1;
      while (x + len < W && wallH[x + len + y * W] === 1) len++;
      collision.push({ x: wx(x) + len * CELL / 2, z: wz(y), hw: len * CELL / 2, hd: WALL_T / 2 });
      x += len;
    }
  }
  for (const f of fences) {
    const cx = (f.x1 + f.x2) / 2, cz = (f.z1 + f.z2) / 2;
    collision.push({ x: cx, z: cz, hw: Math.max(0.1, Math.abs(f.x2 - f.x1) / 2), hd: Math.max(0.1, Math.abs(f.z2 - f.z1) / 2) });
  }

  // --- ceiling lights -------------------------------------------------------
  const fixtures = [];
  function addFixture(room, x, z, y, opts = {}) {
    const f = Object.assign({
      id: fixtures.length, room: room.id, x, z, y,
      on: true, broken: false, flicker: 0, pole: false
    }, opts);
    fixtures.push(f);
    room.fixtures.push(f.id);
    return f;
  }
  for (const r of rooms) {
    if (r.outdoor) continue;
    const nx = Math.max(1, Math.round(r.w / 4));
    const ny = Math.max(1, Math.round(r.h / 4));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const fx = cwx(r.x0) + (r.w * (i + 0.5) / nx - 0.5) * CELL;
        const fz = cwz(r.y0) + (r.h * (j + 0.5) / ny - 0.5) * CELL;
        addFixture(r, fx, fz, r.ceil - 0.14);
      }
    }
  }
  for (const px of [YARD_X[0] + 3, YARD_X[1] - 3]) {
    addFixture(yard, cwx(px), cwz(YARD[0] + 2), 4.8, { pole: true });
  }

  // --- furniture ------------------------------------------------------------
  const props = [];
  const doorCells = new Set();
  for (const d of doors) {
    doorCells.add(d.gx + ',' + d.gy);
    if (d.dir === 'w') doorCells.add((d.gx - 1) + ',' + d.gy);
    else doorCells.add(d.gx + ',' + (d.gy - 1));
  }

  let propId = 0;
  function addProp(type, x, z, rot, opts = {}) {
    const p = Object.assign({
      id: propId++, type, x, z, rot, room: -1,
      hw: 0.5, hd: 0.5, solid: true,
      search: null, hide: null, searched: false
    }, opts);
    props.push(p);
    return p;
  }

  // Walk the inside edge of a room, calling fn for each free perimeter cell
  // with an inward-facing rotation.
  function perimeter(r, fn) {
    const out = [];
    for (let x = r.x0; x <= r.x1; x++) {
      if (wallH[x + r.y0 * W]) out.push([x, r.y0, 0]);              // wall to the north
      if (wallH[x + (r.y1 + 1) * W]) out.push([x, r.y1, Math.PI]);  // wall to the south
    }
    for (let y = r.y0; y <= r.y1; y++) {
      if (wallV[r.x0 + y * (W + 1)]) out.push([r.x0, y, Math.PI / 2]);
      if (wallV[(r.x1 + 1) + y * (W + 1)]) out.push([r.x1, y, -Math.PI / 2]);
    }
    rng.shuffle(out);
    for (const c of out) {
      if (doorCells.has(c[0] + ',' + c[1])) continue;
      if (fn(c[0], c[1], c[2]) === false) return;
    }
  }

  // Nudge a prop from the cell centre toward the wall it faces.
  function against(gx, gy, rot, depth) {
    const d = CELL / 2 - depth;
    return [cwx(gx) + Math.sin(rot) * -d, cwz(gy) + Math.cos(rot) * -d];
  }

  const searchable = [];
  const hideSpots = [];

  function furnish(r) {
    const takenCells = new Set();
    const take = (x, y) => { takenCells.add(x + ',' + y); };
    const free = (x, y) => !takenCells.has(x + ',' + y) && !doorCells.has(x + ',' + y);

    const wallProp = (type, count, opts, depth = 0.24) => {
      let placed = 0;
      perimeter(r, (x, y, rot) => {
        if (placed >= count) return false;
        if (!free(x, y)) return;
        const [px, pz] = against(x, y, rot, depth);
        const p = addProp(type, px, pz, rot, Object.assign({ room: r.id }, opts));
        take(x, y); placed++;
      });
      return placed;
    };

    switch (r.type) {
      case T.HALL: {
        // Lockers line the corridors, and some of them are big enough to climb into.
        perimeter(r, (x, y, rot) => {
          if (!free(x, y) || rng() < 0.24) return;
          const [px, pz] = against(x, y, rot, 0.22);
          const hideable = rng() < 0.34;
          const p = addProp('lockerBank', px, pz, rot, {
            room: r.id, hw: CELL / 2 - 0.06, hd: 0.22,
            search: 'locker', hide: hideable ? 'locker' : null
          });
          take(x, y);
        });
        wallProp('cork', 3, { room: r.id, solid: false, decal: true }, 0.06);
        wallProp('bin', 2, { hw: 0.28, hd: 0.28, search: 'bin' }, 0.3);
        wallProp('fountain', 2, { hw: 0.35, hd: 0.24 }, 0.24);
        break;
      }
      case T.CLASSROOM:
      case T.HOME: {
        // Rows of tiny desks facing a chalkboard.
        const bx = r.x0 + 1, by = r.y0 + 1;
        for (let y = by; y <= r.y1 - 1; y += 2) {
          for (let x = bx; x <= r.x1 - 1; x += 2) {
            if (!free(x, y)) continue;
            addProp('desk', cwx(x), cwz(y) + 0.15, 0, {
              room: r.id, hw: 0.62, hd: 0.36, search: 'desk', hide: 'under'
            });
            addProp('chair', cwx(x), cwz(y) + 0.85, 0, { room: r.id, hw: 0.25, hd: 0.25 });
            take(x, y);
          }
        }
        wallProp('chalkboard', 1, { room: r.id, solid: false, decal: true }, 0.05);
        wallProp('teacherDesk', 1, { hw: 0.9, hd: 0.42, search: 'teacher', hide: 'under' }, 0.4);
        wallProp('cabinet', 2, { hw: 0.5, hd: 0.28, search: 'cabinet', hide: 'box' }, 0.26);
        wallProp('cork', 2, { room: r.id, solid: false, decal: true }, 0.06);
        wallProp('bin', 1, { hw: 0.26, hd: 0.26, search: 'bin' }, 0.3);
        if (r.type === T.HOME) {
          wallProp('crib', 1, { hw: 0.8, hd: 0.45, crib: true }, 0.45);
          wallProp('toybox', 2, { hw: 0.5, hd: 0.34, search: 'toy', hide: 'box' }, 0.32);
          wallProp('rug', 1, { solid: false, decal: false }, 1.0);
        }
        break;
      }
      case T.LIBRARY: {
        for (let y = r.y0 + 1; y <= r.y1 - 1; y += 2) {
          for (let x = r.x0 + 1; x <= r.x1 - 1; x += 3) {
            if (!free(x, y)) continue;
            addProp('bookcase', cwx(x), cwz(y), 0, { room: r.id, hw: 0.9, hd: 0.28, search: 'book' });
            take(x, y);
          }
        }
        wallProp('bookcase', 4, { hw: 0.9, hd: 0.28, search: 'book' }, 0.28);
        wallProp('readingTable', 1, { hw: 0.8, hd: 0.5, hide: 'under' }, 0.6);
        wallProp('beanbag', 2, { hw: 0.4, hd: 0.4, solid: false }, 0.5);
        break;
      }
      case T.ART: {
        wallProp('shelf', 3, { hw: 0.9, hd: 0.24, search: 'art' }, 0.24);
        wallProp('sink', 2, { hw: 0.6, hd: 0.28 }, 0.28);
        for (let i = 0; i < 5; i++) {
          const x = rng.int(r.x0 + 1, r.x1 - 1), y = rng.int(r.y0 + 1, r.y1 - 1);
          if (!free(x, y)) continue;
          addProp('easel', cwx(x), cwz(y), rng() * Math.PI * 2, { room: r.id, hw: 0.32, hd: 0.32 });
          take(x, y);
        }
        wallProp('cabinet', 2, { hw: 0.5, hd: 0.28, search: 'art', hide: 'box' }, 0.26);
        break;
      }
      case T.MUSIC: {
        wallProp('piano', 1, { hw: 0.8, hd: 0.5, hide: 'under', search: 'music' }, 0.5);
        for (let i = 0; i < 8; i++) {
          const x = rng.int(r.x0 + 1, r.x1 - 1), y = rng.int(r.y0 + 1, r.y1 - 1);
          if (!free(x, y)) continue;
          addProp('chair', cwx(x), cwz(y), rng() * 6.28, { room: r.id, hw: 0.25, hd: 0.25 });
          take(x, y);
        }
        wallProp('shelf', 2, { hw: 0.9, hd: 0.24, search: 'music' }, 0.24);
        wallProp('drum', 1, { hw: 0.4, hd: 0.4, noisy: true }, 0.5);
        break;
      }
      case T.GYM: {
        for (const side of [0, 1]) {
          const zc = side ? r.y0 + 1 : r.y1 - 1;
          addProp('hoop', cwx(Math.round((r.x0 + r.x1) / 2)), cwz(zc), side ? 0 : Math.PI,
            { room: r.id, hw: 0.9, hd: 0.3 });
        }
        for (let i = 0; i < 7; i++) {
          const x = rng.int(r.x0 + 1, r.x1 - 1), y = rng.int(r.y0 + 1, r.y1 - 1);
          if (!free(x, y)) continue;
          addProp('mat', cwx(x), cwz(y), rng() < 0.5 ? 0 : Math.PI / 2, { room: r.id, solid: false, hw: 1.2, hd: 0.7 });
          take(x, y);
        }
        wallProp('bleacher', 3, { hw: CELL / 2, hd: 0.7, hide: 'under' }, 0.7);
        wallProp('ballCart', 2, { hw: 0.5, hd: 0.5, search: 'gym' }, 0.5);
        wallProp('vault', 2, { hw: 0.6, hd: 0.4, hide: 'box' }, 0.5);
        break;
      }
      case T.CAFETERIA: {
        for (let y = r.y0 + 1; y <= r.y1 - 1; y += 3) {
          for (let x = r.x0 + 1; x <= r.x1 - 2; x += 3) {
            if (!free(x, y)) continue;
            addProp('cafeTable', cwx(x) + CELL / 2, cwz(y), 0, {
              room: r.id, hw: 1.5, hd: 0.5, hide: 'under', search: 'cafe'
            });
            take(x, y); take(x + 1, y);
          }
        }
        wallProp('servingCounter', 2, { hw: CELL / 2, hd: 0.4, hide: 'under', search: 'cafe' }, 0.4);
        wallProp('bin', 3, { hw: 0.3, hd: 0.3, search: 'bin' }, 0.32);
        wallProp('vending', 2, { hw: 0.5, hd: 0.3, search: 'vending' }, 0.3);
        break;
      }
      case T.KITCHEN: {
        wallProp('counter', 5, { hw: CELL / 2 - 0.05, hd: 0.34, search: 'kitchen', hide: 'under' }, 0.34);
        wallProp('fridge', 2, { hw: 0.45, hd: 0.36, search: 'kitchen', hide: 'box' }, 0.36);
        wallProp('shelf', 2, { hw: 0.9, hd: 0.24, search: 'kitchen' }, 0.24);
        addProp('prepTable', r.cx, r.cz, 0, { room: r.id, hw: 1.0, hd: 0.5, hide: 'under', search: 'kitchen' });
        break;
      }
      case T.BOILER: {
        // The generator lives dead centre, with fuel and parts stacked around it.
        addProp('generator', r.cx, r.cz, 0, { room: r.id, hw: 1.1, hd: 0.7, generator: true });
        wallProp('boilerTank', 2, { hw: 0.55, hd: 0.55 }, 0.6);
        wallProp('fusebox', 1, { solid: false, decal: true, fusebox: true }, 0.08);
        wallProp('crate', 4, { hw: 0.42, hd: 0.42, search: 'boiler', hide: 'box' }, 0.44);
        wallProp('pipeRack', 2, { hw: 0.9, hd: 0.2 }, 0.2);
        break;
      }
      case T.STORAGE: {
        wallProp('shelf', 5, { hw: 0.9, hd: 0.26, search: 'storage' }, 0.26);
        for (let i = 0; i < 8; i++) {
          const x = rng.int(r.x0, r.x1), y = rng.int(r.y0, r.y1);
          if (!free(x, y)) continue;
          addProp('crate', cwx(x), cwz(y), rng() * 6.28, {
            room: r.id, hw: 0.44, hd: 0.44, search: 'storage', hide: 'box'
          });
          take(x, y);
        }
        break;
      }
      case T.BATHROOM: {
        wallProp('stall', 4, { hw: 0.55, hd: 0.55, hide: 'box' }, 0.6);
        wallProp('sink', 3, { hw: 0.55, hd: 0.26 }, 0.26);
        wallProp('bin', 1, { hw: 0.26, hd: 0.26, search: 'bin' }, 0.3);
        break;
      }
      case T.NURSE: {
        wallProp('cot', 2, { hw: 0.9, hd: 0.42, hide: 'under' }, 0.45);
        wallProp('medCabinet', 2, { hw: 0.45, hd: 0.24, search: 'nurse' }, 0.24);
        wallProp('desk', 1, { hw: 0.62, hd: 0.36, search: 'teacher', hide: 'under' }, 0.4);
        wallProp('scale', 1, { hw: 0.3, hd: 0.3, solid: false }, 0.4);
        break;
      }
      case T.LOSTFOUND: {
        wallProp('shelf', 3, { hw: 0.9, hd: 0.26, search: 'lost' }, 0.26);
        for (let i = 0; i < 6; i++) {
          const x = rng.int(r.x0, r.x1), y = rng.int(r.y0, r.y1);
          if (!free(x, y)) continue;
          addProp('lostBin', cwx(x), cwz(y), rng() * 6.28, {
            room: r.id, hw: 0.5, hd: 0.4, search: 'lost', hide: 'box'
          });
          take(x, y);
        }
        break;
      }
      case T.STAFF: {
        wallProp('couch', 2, { hw: 0.9, hd: 0.4, hide: 'under', search: 'staff' }, 0.42);
        wallProp('counter', 2, { hw: CELL / 2 - 0.05, hd: 0.34, search: 'staff' }, 0.34);
        wallProp('fridge', 1, { hw: 0.45, hd: 0.36, search: 'staff', hide: 'box' }, 0.36);
        addProp('roundTable', r.cx, r.cz, 0, { room: r.id, hw: 0.7, hd: 0.7, hide: 'under' });
        wallProp('lockerBank', 2, { hw: CELL / 2 - 0.06, hd: 0.22, search: 'staff', hide: 'locker' }, 0.22);
        break;
      }
      case T.YARD: {
        addProp('slide', cwx(r.x0 + 3), cwz(r.y0 + 2), 0, { room: r.id, hw: 1.0, hd: 1.6, hide: 'under' });
        addProp('sandbox', cwx(r.x1 - 4), cwz(r.y0 + 2), 0, { room: r.id, hw: 1.6, hd: 1.6, solid: false, search: 'sand' });
        addProp('swings', cwx(Math.round((r.x0 + r.x1) / 2)), cwz(r.y1 - 1), 0, { room: r.id, hw: 2.0, hd: 0.3 });
        addProp('seesaw', cwx(r.x0 + 6), cwz(r.y1 - 2), 0.4, { room: r.id, hw: 1.4, hd: 0.3, solid: false });
        addProp('tube', cwx(r.x1 - 7), cwz(r.y1 - 2), 1.2, { room: r.id, hw: 1.2, hd: 0.6, hide: 'box' });
        for (let i = 0; i < 4; i++) {
          let tx = rng.int(r.x0, r.x1), ty = rng.int(r.y0, r.y1);
          const rot = rng() * 6.28;
          // never plant one in front of a door into the playground
          for (let k = 0; k < 12 && doors.some(d => d.yard && Math.abs(tx - d.gx) <= 1 && Math.abs(ty - d.gy) <= 1); k++) {
            tx = rng.int(r.x0, r.x1); ty = rng.int(r.y0, r.y1);
          }
          if (doors.some(d => d.yard && Math.abs(tx - d.gx) <= 1 && Math.abs(ty - d.gy) <= 1)) continue;
          addProp('tree', cwx(tx), cwz(ty), rot, { room: r.id, hw: 0.35, hd: 0.35 });
        }
        addProp('bench', cwx(r.x0 + 1), cwz(r.y1 - 3), Math.PI / 2, { room: r.id, hw: 0.9, hd: 0.3, hide: 'under' });
        break;
      }
    }
  }

  for (const r of rooms) furnish(r);

  for (const p of props) {
    if (p.search) searchable.push(p.id);
    if (p.hide) hideSpots.push(p.id);
  }

  // --- navigation -----------------------------------------------------------
  // Cells the AI may stand in. Big furniture blocks a cell so Bob does not
  // stroll through the piano.
  const blocked = new Uint8Array(W * H);
  for (const p of props) {
    if (!p.solid) continue;
    if (p.hw < 0.5 && p.hd < 0.5) continue;
    const gx = Math.floor((p.x - OX) / CELL), gy = Math.floor((p.z - OZ) / CELL);
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) blocked[gy * W + gx] = 1;
  }
  // Never block a doorway cell -- that would sever the graph.
  for (const d of doors) {
    blocked[d.gy * W + d.gx] = 0;
    if (d.dir === 'w' && d.gx > 0) blocked[d.gy * W + d.gx - 1] = 0;
    if (d.dir === 'n' && d.gy > 0) blocked[(d.gy - 1) * W + d.gx] = 0;
  }

  const school = {
    seed, W, H, CELL, WALL_H, OX, OZ,
    cells, rooms, doors, fixtures, fences, props,
    wallV, wallH, wallFaces, collision, blocked,
    searchable, hideSpots,
    home, gym, cafeteria, kitchen, yard, spine, hallA, hallB,
    boiler: southL[0], lostfound: southR[0], storage: southL[1],
    nurse: rooms.find(r => r.type === T.NURSE),
    library: rooms.find(r => r.type === T.LIBRARY),
    exitDoors, yardDoors, exitPos,
    wx, wz, cwx, cwz,
    at,
    roomAt(x, z) {
      const gx = Math.floor((x - OX) / CELL), gy = Math.floor((z - OZ) / CELL);
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return null;
      const id = cells[gy * W + gx];
      return id < 0 ? null : rooms[id];
    },
    cellOf(x, z) { return [Math.floor((x - OX) / CELL), Math.floor((z - OZ) / CELL)]; },
    // Can something walk between two neighbouring cells? Doorways count as open
    // whether or not the door leaf is swung, since the AI opens doors.
    passable(x0, y0, x1, y1) {
      if (x1 < 0 || y1 < 0 || x1 >= W || y1 >= H) return false;
      if (cells[y1 * W + x1] < 0) return false;
      if (blocked[y1 * W + x1]) return false;
      if (x1 === x0) {
        const y = Math.max(y0, y1);
        return wallH[x0 + y * W] !== 1;
      }
      const x = Math.max(x0, x1);
      return wallV[x + y0 * (W + 1)] !== 1;
    },
    // Wall-only version of passable(): ignores furniture, used by the
    // connectivity repair pass which is deciding what furniture to remove.
    wallOpen(x0, y0, x1, y1) {
      if (x1 < 0 || y1 < 0 || x1 >= W || y1 >= H) return false;
      if (cells[y1 * W + x1] < 0) return false;
      if (x1 === x0) return wallH[x0 + Math.max(y0, y1) * W] !== 1;
      return wallV[Math.max(x0, x1) + y0 * (W + 1)] !== 1;
    },
    doorBetween(x0, y0, x1, y1) {
      if (x1 === x0) {
        const y = Math.max(y0, y1);
        if (wallH[x0 + y * W] !== 2) return null;
        return doors.find(d => d.dir === 'n' && d.gx === x0 && d.gy === y) || null;
      }
      const x = Math.max(x0, x1);
      if (wallV[x + y0 * (W + 1)] !== 2) return null;
      return doors.find(d => d.dir === 'w' && d.gx === x && d.gy === y0) || null;
    }
  };

  return school;
}
