/* ---------- your person lives on the server now ----------
   The game joins the world first; the server says whether you have a person (and how they got on while you were away),
   or whether you're making a new one. Old saves from before 0.0.7 are cleared. */
try { localStorage.removeItem('pocket-life:test'); localStorage.removeItem('pocket-life:release'); } catch (err) { /* none */ }
// the old stumps and fallen logs that were taken out (nature.js): free their spots now the layout is done, so you can walk there
for (const [x, z] of noLongerHere) { removeSpotNear(x, z); clearCellsNear(x, z, 1.5); }
applyGraphics(gfx);
setNet('connecting');
enterMenu();
goOnline();
requestAnimationFrame(frame);
// for automated checks only: open the page with ?debug to reach the game's state from the browser console
if (location.search.includes('debug')) window.__pl = { THREE, renderer, solidAt, walk, tasks, trees, you, others, net, plants, queueTask, camera, berryBushes, buildItem, layoutData, oldStumps, rocks, placed, placedActions, stationNear, placing, movePlacing, finishPlacing, cantPlaceAt, fuelLeft, isLit, endSit, get player() { return player; }, get heldView() { return heldView; }, get freshLook() { return freshLook; }, itemViews, dropGhosts, findPath, freeAt, die, showWelcomeBack, showGoneCard, showMaintenance, hideMaintenance, admin, STAT, SOURCES, CHOP, MINE, world, menuActions, notMineAt, claimAt, sendAct, outbox, goOnline, getItem, peopleDrawn, get glowOn() { return glowOn; }, get adminData() { return { playersData, playerData, inboxData, adminTab }; },
  ui, controls, openAdminLogin, get adminMode() { return { on: adminMode.on, asking: adminMode.asking, hasCode: !!adminMode.code }; } }; // (adminMode: never the password itself)
