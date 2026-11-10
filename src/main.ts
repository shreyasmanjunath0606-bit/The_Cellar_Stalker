import { Game } from './core/Game';

const boot = document.getElementById('boot');

function fail(message: string): void {
  if (!boot) return;
  boot.classList.add('error');
  boot.querySelector('p')!.textContent = message;
}

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing');
  if (!supportsWebGL2()) {
    fail('This game needs WebGL 2. Please try a current version of Chrome, Edge or Firefox.');
    return;
  }
  if (!('pointerLockElement' in document) || !window.matchMedia('(pointer: fine)').matches) {
    // still boot, so the menu is visible, but tell touch-only visitors why they can't play
    boot?.insertAdjacentHTML('afterend', '<div id="notice">A keyboard and mouse are required to play.</div>');
  }

  const game = await Game.create(container);
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  game.start();
  boot?.classList.add('done');
  window.setTimeout(() => boot?.remove(), 900);
}

main().catch((err) => {
  console.error(err);
  fail('The game failed to start. Reload the page, or try another browser.');
});
