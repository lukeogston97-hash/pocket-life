/* ---------- your person lives on the server now ----------
   The game joins the world first; the server says whether you have a person (and how they got on while you were away),
   or whether you're making a new one. Old saves from before 0.0.7 are cleared. */
try { localStorage.removeItem('pocket-life:test'); localStorage.removeItem('pocket-life:release'); } catch (err) { /* none */ }
applyGraphics(gfx);
setNet('connecting');
enterMenu();
goOnline();
requestAnimationFrame(frame);
// for automated checks only: open the page with ?debug to reach the game's state from the browser console
if (location.search.includes('debug')) window.__pl = { THREE, renderer, solidAt, walk, tasks, trees, you, others, net, plants, queueTask, camera, berryBushes, buildItem, layoutData, oldStumps, placed, placedActions, stationNear, placing, movePlacing, finishPlacing, cantPlaceAt, fuelLeft, isLit, endSit, get player() { return player; }, get heldView() { return heldView; }, get freshLook() { return freshLook; }, itemViews, findPath, freeAt, die, showWelcomeBack, showGoneCard, showMaintenance, hideMaintenance };
