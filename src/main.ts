import { Game } from './core/Game';

const container = document.getElementById('app');
if (!container) throw new Error('#app container missing');

Game.create(container).then((game) => {
  (window as unknown as { __game: Game }).__game = game;
  game.start();
});
