# The Cellar Stalker

A first-person stealth horror game for the browser, in the spirit of *Granny*.
Find the keys, unlock the cellar door, and don't make a sound. Five nights, each worse than the last.

Built with TypeScript, three.js and Rapier. Every texture, model and sound is generated in code, so the
game ships as three static files with no external assets.

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
| Shift | Sprint (loud, drains stamina) |
| C | Crouch (slow, quiet, harder to see) |
| F | Flashlight |
| E | Take / hide / unlock |
| Left click | Shove an object |
| Esc | Pause |

## The five nights

| Night | Name | What changes |
| --- | --- | --- |
| 1 | The Cellar | 3 keys. She is slow and short-sighted. |
| 2 | The West Wing | 4 keys. A new wing opens; she is faster and the lamps are dimmer. |
| 3 | Blackout | 4 keys. The crypt opens, the lamps are dead, batteries drain faster. |
| 4 | The Hunt | 5 keys. She is nearly as fast as you and periodically senses where you are. |
| 5 | No Way Out | 5 keys. There are two of them, and you only get two chances. |

Difficulty lives in one table: `src/core/Levels.ts`. Keys and batteries are placed differently on every attempt.
Progress, best times and settings are saved in the browser's local storage.

## Publish

```bash
npm run build
```

This writes a self-contained build to `dist/` (about 0.9 MB gzipped). Asset paths are relative, so it can be:

- zipped and uploaded to **itch.io** as an HTML5 game (set the viewport to 1280×720 and enable fullscreen);
- pushed to **GitHub Pages**, **Netlify** or **Vercel** as a static site;
- served from any folder of any web server.

`npm run preview` serves the production build locally for a final check.

## Project layout

```
src/core         game loop, level table, save data, input, physics
src/ai           the stalker: senses, state machine, pathfinding, model
src/environment  the cellar, wardrobes, props, pickups, creaky floorboards
src/player       movement, flashlight, interaction
src/rendering    materials, post-processing, particles
src/audio        synthesized sound
src/ui           HUD and menus
```
