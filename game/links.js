/* ---------- links between the game's files ----------
   The game's files load in the order game/main.js lists them, and each one imports what it needs from the files above
   it. Two things can't be done with a plain import:
   - using something from a file further down the list (it hasn't loaded yet when the file above loads), and
   - changing a variable that lives in another file (imports are read-only).
   Both go through `game`: the file that owns the thing shares it at its end with share({ ... }), and other files use
   game.name. A variable shared this way is a getter and a setter, so every file sees its current value.
   Only use game.name for those two cases; everything else is a normal import. */
export const game = {};
export function share(things) {
  Object.defineProperties(game, Object.getOwnPropertyDescriptors(things));
}
