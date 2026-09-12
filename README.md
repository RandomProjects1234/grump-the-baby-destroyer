# Grump the Baby Destroyer

It is the last day of school. Everyone got picked up. Except you.

**Play it: <https://randomprojects1234.github.io/grump-the-baby-destroyer/>**

A 3D survival-horror game about a baby left behind in an empty school, a
generator that will not feed itself, a janitor who wants you back in your
classroom, and a small boy in green dungarees who would like to ask you some
questions.

Runs entirely in the browser. No build step, no backend, no install.

```bash
node server.js
```

Then open <http://localhost:3493>. On Windows there is `Start Baby Destroyer.bat`
in the parent folder.

## Hosting it on GitHub Pages

The whole game is static files, so pushing this folder to a repo and turning on
Pages is all it takes. `.nojekyll` is already here so the `js/` folder is served
as-is. Multiplayer keeps working on Pages because it is peer-to-peer — there is
no server of ours anywhere in the stack.

## The loop

**Day** (4 minutes) — search the school, feed the generator, clean up, and
carry the other toddlers back to your classroom.

**Night** (3 minutes) — you cannot leave. Your classroom is safe *only while
the lights are on*.

Repeat, five nights by default, with both threats getting worse.

### Day work

| Job | Why |
| --- | --- |
| Search lockers, desks, bins, crates | Fuel and parts live in the boiler room and storage |
| Pour fuel, fit parts | The generator powers every light in the building |
| Clean up messes | Every mess still on the floor at dusk makes the generator drink faster |
| Carry toddlers to your classroom | Any left out in the building do not survive the night |
| Talk to Grump | Ignoring him all day costs *more* than talking to him |

### Night

**The nights belong to Bob.** He is the one who will actually hurt you for the
first three of them.

- **Light is safety.** Bob will not touch you in a lit room. Grump will not
  enter one — until he has turned, and then he will.
- **Bob** patrols every night, hums, sweeps a torch, and from night 2 switches
  lights off behind him. He gets faster every night. Hide in a locker and hold
  still.
- **Grump** only watches for the first three nights. He gets bigger each one.
- **Noise carries.** Sprinting is loud, crawling is silent, and a baby at
  maximum fear starts crying — the loudest thing in the building.

### Grump

Every question he asks has no correct answer. Each option costs him a little
more patience, and walking away costs the most of all. Cleaning up his school is
the only thing that ever takes the edge off.

**On day 4 he stops asking questions**, and from then on he hunts you in
daylight as well as in the dark. Being rude enough to max his resentment brings
that forward; being polite does not push it back. The dialogue decides how bad
he is when he turns, not whether he turns.

## Controls

| Key | |
| --- | --- |
| `WASD` | waddle |
| `Shift` | run — loud and tiring |
| `Ctrl` | crawl — quiet and slow |
| `E` / `LMB` | interact; hold for anything that takes effort |
| `R` | use the selected item, or the second option on a prompt |
| `1`–`6` | pick from the bag |
| `Q` | put down whatever is in your hands |
| `F` | torch |
| `RMB` | peek, while hidden |
| `Tab` | objectives |
| `T` | chat (co-op) |
| `Esc` | pause |

You are a baby: you can carry **one** big thing in your hands (a fuel can, a
teddy, a toddler) plus six small things in the bag.

## Co-op

Up to four babies. **Host Co-op** gives you a five-letter room code; everyone
else uses **Join Co-op**.

The host runs the simulation — the phase clock, the generator, Bob, Grump, the
toddlers and every loot roll — and mirrors it to the others. Clients own only
their own movement, which keeps it responsive on a home connection. The host
sends one number, the seed, and every client rebuilds a byte-identical school
from it, down to which locker holds the wrench. Keep the host's tab open.

The boy with the Pokémon cards is deliberately a local encounter: everybody gets
their own.

## Layout

```
index.html            markup for every screen and the HUD
css/style.css
audio/                the recorded voice lines (everything else is synthesised)
js/
  main.js             Game: the loop, phases, and all the glue
  util/util.js        seeded RNG and small maths helpers
  audio/sfx.js        Web Audio synthesis + voice-line playback
  render/
    textures.js       every surface painted into a canvas at load time
    meshbuilder.js    merges quads into one geometry per material
    models.js         characters and items, built from boxes
    renderer.js       scene setup and the light pool
  world/
    schoolgen.js      the school as a cell grid: rooms, walls, doors, furniture
    build.js          that description turned into meshes
  game/
    collide.js        AABB collision, nav blocking, connectivity repair
    nav.js            grid A* and the steering that follows it
    player.js         movement, stats, carrying, hiding
    threats.js        Bob and Grump
    cardkid.js        the boy with the cards, and the thing that takes him
    toddlers.js       the children you are trying to keep
    systems.js        generator, messes, dropped items, portable lights
    interact.js       what you are looking at, and what E does to it
    items.js          items and loot tables
    dialogue.js       Grump's questions
  ui/ui.js            all DOM handling
  net/net.js          PeerJS host/client
```

## Notes for anyone poking at it

- **Everything is procedural** except seven recorded voice lines. Textures are
  painted into canvases, models are boxes, all other audio is synthesised.
- **The school is a pure function of the seed.** `generateSchool(seed)` returns
  the same building on every machine, which is the whole basis of multiplayer.
- **Furniture can seal a room off from its own door** on unlucky seeds.
  `repairConnectivity` finds the specific pieces doing it and removes them
  before the geometry is built. Without it roughly one seed in ten stranded a
  room.
- **The spine corridor is its own room laid over the two long halls**, so the
  cell ids differ down both its sides and the wall pass seals it. `schoolgen`
  reopens both crossroads explicitly — remove that and the east wing becomes
  unreachable.
- **The light pool** is six real point lights reassigned each frame to the
  nearest switched-on fixtures. There are ~75 fixtures; a GPU will not shade
  them all, and you can only ever see one or two rooms at once.
- **World geometry uses `MeshPhongMaterial`,** not Lambert. Lambert shades
  per-vertex, and a merged floor quad has four vertices, so a point light on it
  looks wrong.
- **`window.__GRUMP`** is the live game object — handy for poking at state:
  `__GRUMP.generator.fuel = 100`, `__GRUMP.grump.anger(50, __GRUMP)`,
  `__GRUMP.phaseTime = 1`.
- **The day-4 turn lives in `Grump.checkSchedule()`** (`threats.js`), called at
  each dawn. `GRUMP_TURNS_ON_DAY` is the constant. Everything downstream asks
  `grump.turned`, never `resent >= 100`.
- **A watchdog drives the loop** if `requestAnimationFrame` stalls, which it
  does in some embedded viewers and in background tabs. Without it the night
  clock can silently freeze.
