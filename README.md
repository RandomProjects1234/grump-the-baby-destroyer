# Grump the Baby Destroyer

It is the last day of school. Everyone got picked up. Except you.

**Play it: <https://randomprojects1234.github.io/grump-the-baby-destroyer/>**

**Wiki: <https://randomprojects1234.github.io/grump-the-baby-destroyer-wiki/>**

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

Repeat for 3, 5, 7, 10, 15 or 20 nights — or Endless — with both threats
getting worse. From night 5 every night rolls a twist (a storm, Bob on overtime,
the long night...), and from night 10 it rolls two.

### Day work

Every morning your teacher, **Mrs. Honeywell**, is standing at the chalkboard in
your classroom. She reads out the day, and her list is waiting: three or four jobs (four
from night 6) that send you out into the building. Each one you finish leaves a
reward in the crib in your classroom.

| Kind of job | Example |
| --- | --- |
| Keep the power on | Pour 2 cans of fuel, fit a spare part |
| Look after the little ones | Carry 2 toddlers home, feed a hungry one |
| Chores | Clean up 3 messes, search 3 things in the library |
| Explore | Check on the playground, switch the gym lights on |
| Lost things | Find Mr. Wiggles the class hamster, return a shiny card to Lost & Found |
| Grump's crayon | Give him back his crayon — the only thing that ever calms him (before day 4) |

Talk to her any time during the day and she goes over the list again. Sit in a
dark classroom — switch off, or no generator — and she will tell you about it.
She is not by the board any more in the last seconds before dark, and nobody
sees her leave.

Press **M** for the map: every room, your friends, the little ones, food, fuel,
parts, messes, today's job rooms outlined, and job items starred. Bob never
appears on it. Grump only does in daylight, before day 4.

**You have to eat.** Your tummy empties over a day and a night; at zero you
start losing health. Sandwiches, milk and apples live in the cafeteria, kitchen
and staff room, and a few lunchboxes turn up around the school every morning
(press R to open one).

**Meredith the lunch lady** stands at the cafeteria counter all day. Talk to her
for a tray of lunch -- after a tiny three-lane rhythm game (A S D). Keep the
beat for a gold tray (four things to eat); miss everything and she still gives
you something. One tray each, each day.

**Jerry the gym teacher** comes sprinting out of the gym now and then, blowing
his whistle, because you are slacking off. You cannot say no. He picks one of
three pop-up games -- **laps** (a top-down racer round a track; three laps, the
grass is slow), **dumbbells** (spam click to lift, four reps), or **jump rope**
(press on the beat, six in a row). Each takes well under a minute if you are
good. Pass and you stay fit for a while (stamina drains at half speed); fail and
the effort makes you hungry. Hide in a locker and he gives up.

**The Big Boys Club.** Once a run, on day 2 or 3, three big kids corner you in a
hall. It is a cutscene, and it is the one time Grump is on your side.

Anything searchable can always be searched -- again and again. The first
rummage is the good one; each repeat on the same day finds less.

Between jobs: search containers, fuel the generator, clean up (messes left at
dusk make the generator drink faster), and talk to Grump — ignoring him all day
costs more than talking to him.

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
that forward; being polite does not push it back.

Once he has turned:

- He **charges** the moment he has a clear look at you.
- He **waits outside your hiding place**, breathing, and catches you if you come out too soon.
- **Bulbs pop** when he walks under them, and the screen fills with static as he gets close.
- He **arrives somewhere nearer** when you are not looking.
- He **repeats your own answers back to you**.
- If he catches you, you see his face.

Before day 4 he never hurts you — but he knocks on your classroom door, and if
the power dies he comes and stands very close.

## Controls

| Key | |
| --- | --- |
| `WASD` | waddle |
| `Shift` | run — loud and tiring |
| `Ctrl` | crawl — quiet and slow |
| `E` / `LMB` | interact; hold for anything that takes effort |
| `R` | use the selected item, or the second option on a prompt |
| `1`–`6` | pick from the bag |
| `Q` | drop what is in your hands, or the selected bag item |
| `F` | torch |
| `RMB` | peek, while hidden |
| `M` | map of the school |
| `Tab` | objectives |
| `T` | chat (co-op) |
| `Esc` | pause |

You are a baby: you can carry **one** big thing in your hands (a fuel can, a
teddy, a toddler) plus six small things in the bag.

## Co-op

Up to four babies. **Host Co-op** gives you a five-letter room code; everyone
else uses **Join Co-op**.

The host runs the simulation — the phase clock, the generator, Bob, Grump, the
toddlers, loot, quests — and mirrors it to the others. Clients own only their
own movement. **Everything else a joiner does is sent to the host and applied
there**: fuel, repairs, cleaning, feeding, dropped items, answers to Grump.
Nothing a joiner does exists only on their own screen.

- The school never pauses in co-op. Opening a menu does not stop anyone else.
- Bob and Grump hurt whoever they actually catch.
- If you die you spectate a living teammate (click to switch) — **including the
  host**, whose game keeps simulating for everyone. The run ends only when
  everyone is gone, or when anyone gets out the front door.
- A downed teammate can be patted back up.

The host sends one number, the seed, and every client rebuilds the same school
from it; a player joining mid-game is sent the door, light, mess and quest state
on top. Keep the host's tab open — it is the server.

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
    threats.js        Bob and Grump: host-only AI + per-player presentation
    quests.js         Mrs. Honeywell's list
    honeywell.js      Mrs. Honeywell herself
    jerry.js          Jerry the gym teacher
    meredith.js       Meredith the lunch lady
    bullies.js        the Big Boys Club cutscene
    cardkid.js        the boy with the cards, and the thing that takes him
    toddlers.js       the children you are trying to keep
    systems.js        generator, messes, dropped items, portable lights
    interact.js       what you are looking at, and what E does to it
    items.js          items and loot tables
    dialogue.js       Grump's questions
  ui/ui.js            all DOM handling
  ui/map.js           minimap and the full map (M)
  ui/minigames.js     laps, dumbbells, jump rope, the lunch line
  net/net.js          PeerJS host/client
```

## Notes for anyone poking at it

- **Everything is procedural** except fourteen recorded voice lines: Grump (3),
  Bob (3, pitched down), Mrs. Honeywell (2), Jerry (3), Meredith (1) and the
  card boy (2). Textures are
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
- **Threats are split into `update()` and `present()`.** The AI runs on the
  host only; animation, footsteps and ambience run on every machine from the
  positions it sends. Voice lines and one-off effects go through `game.fx()`,
  which plays them locally and broadcasts them, each player attenuating by
  their own distance.
- **A watchdog drives the loop** if `requestAnimationFrame` stalls, which it
  does in some embedded viewers and in background tabs. Without it the night
  clock can silently freeze.
