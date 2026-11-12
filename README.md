# The Cellar Stalker

A first-person stealth horror game for the browser, in the spirit of *Granny*, for one to five players.
You wake up in a bedroom of her house. Find the tools, open one of three ways out, and don't make a sound.

Built with TypeScript, three.js and Rapier. Every texture, model and sound is generated in code, so the
game ships as static files with no external assets.

## Play

```bash
npm install
npm run dev
```

Then open http://localhost:5173. A keyboard and mouse are required.

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Arrow keys | Also turn the view (useful on a laptop touchpad) |
| Shift | Sprint (loud, drains stamina) |
| C | Crouch (slow, quiet, harder to see) |
| F | Flashlight |
| E | Take / hide / use a tool / set off a distraction |
| Left click | Fire a sleeping dart at her, or shove an object |
| Esc | Pause (in co-op the night keeps going) |

Laptop touchpads: Windows blocks the touchpad while keys are held, so you cannot turn and walk at once.
Use a mouse, turn with the arrow keys, or set *Touchpad sensitivity* to "Most sensitive" in Windows settings.

## The house

Two storeys and a garage: kitchen, dining room, library, living room, entrance hall, study and garage
downstairs; her bedroom, a bathroom, a nursery, a guest bedroom (where you start), a landing and the
master bedroom with its balcony upstairs. Two staircases join the floors.

## Three ways out

Any one of them ends the night. The checklist at the bottom right of the screen tracks all three, and the
glow around an item tells you which route it belongs to.

| Way out | Glow | What it takes |
| --- | --- | --- |
| Front door | gold | Hammer for the planks, bolt cutters for the chain, then every door key |
| Garage | orange | Car battery, fuel can, winch crank for the garage door, car key |
| Balcony | blue | Balcony key, two ladder sections, rope |

Items are placed differently on every attempt.

## Surviving her

- **Sleeping darts** (violet glow): find the crossbow and a dart, then click on her. She sleeps for two minutes.
- **Distractions**: radios, alarm clocks (ring after 10 seconds), music boxes and the piano draw her
  across the house until she reaches them and shuts them up. Knocking over vases, chairs and buckets works too.
- **Hiding**: 18 places — wardrobes and the gaps under beds. They only work if she did not watch you get in.
- **Noise**: she hunts by sound. Watch the noise bar; pale patches of floor creak.

## Difficulty and nights

| Difficulty | Her | Chances | Darts |
| --- | --- | --- | --- |
| Easy | Slower than your walk, half deaf, forgetful | 5 | 4 |
| Medium | Keeps pace with a brisk walk | 4 | 3 |
| Hard | Fast, sharp-eared, quick to notice | 3 | 2 |

| Night | Name | What changes |
| --- | --- | --- |
| 1 | The House | The baseline. |
| 2 | Dim Lamps | Dimmer lamps, more creaking boards, she is faster. |
| 3 | Blackout | The lamps are dead, batteries drain faster, the front door needs 4 keys. |
| 4 | The Hunt | She periodically senses where a player is. |
| 5 | No Way Out | Two of them, and the front door needs 5 keys. |

All of it lives in one table: `src/core/Levels.ts`. Progress, best times and settings are saved in the
browser's local storage.

## Playing together

From the main menu choose **Play Together**. One player hosts and gets a five-letter room code; up to four
friends enter that code to join. The host picks the night and difficulty and starts the game.

- Everything found goes into one shared pool, and the team shares its chances (one extra per extra player).
- A caught player wakes up back in the bedroom a few seconds later.
- Once the first player is out, the rest have 90 seconds to follow.
- The host's computer runs her; if the host leaves, the game ends for everyone.

Connections are peer-to-peer (WebRTC) and are set up through the free public PeerJS matchmaking server, so
the game still works from any static host. Very strict networks may block peer-to-peer connections.

To try co-op on one machine without the network, open `http://localhost:5173/?net=local` in two tabs.

## Publish

```bash
npm run build
```

This writes a self-contained build to `dist/`. Asset paths are relative, so it can be:

- zipped and uploaded to **itch.io** as an HTML5 game (set the viewport to 1280×720 and enable fullscreen);
- pushed to **GitHub Pages**, **Netlify** or **Vercel** as a static site;
- served from any folder of any web server.

`npm run preview` serves the production build locally for a final check.

## Project layout

```
src/core         game loop and roles (solo / host / client), night and difficulty table, save data, input
src/environment  the house and its building kit, floor-plan data, items, escape routes, distractions, props
src/ai           her state machine, two-floor pathfinding, sound events
src/player       movement, flashlight, shared inventory, interaction, other players' avatars
src/net          co-op room, message types, PeerJS and same-browser transports
src/rendering    renderer, procedural materials, post-processing, particles
src/audio        synthesized sound
src/ui           HUD and menus
```
