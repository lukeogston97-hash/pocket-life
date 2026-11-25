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
if (ADMIN_LINK) openAdminLogin(); // the address ended in ?admin (admin-mode.js)
requestAnimationFrame(frame);
// for automated checks only: open the page with ?debug to reach the game's state from the browser console
if (location.search.includes('debug')) window.__pl = { THREE, renderer, groundY, rectOf, groundUnder, startPlacing, turnPlacing, landAsMade, speed, tip, pondShape, pondShapeAt, POND, solidAt, walk, tasks, trees, you, others, net, plants, queueTask, camera, berryBushes, buildItem, layoutData, oldStumps, rocks, placed, placedActions, stationNear, placing, movePlacing, finishPlacing, cantPlaceAt, fuelLeft, isLit, endSit, get player() { return player; }, get heldView() { return heldView; }, get freshLook() { return freshLook; }, itemViews, dropGhosts, findPath, freeAt, die, showWelcomeBack, showGoneCard, showMaintenance, hideMaintenance, admin, STAT, SOURCES, CHOP, MINE, world, menuActions, notMineAt, claimMine, claimHere, openSociety, drawSociety, inviteAction, claimAt, sendAct, outbox, goOnline, getItem, peopleDrawn, get glowOn() { return glowOn; }, get adminData() { return { playersData, playerData, inboxData, itemsData, firesData, logData, adminTab }; },
  ui, controls, openAdminLogin,
  // what a tap at a spot on the screen would find, and what the admin could do with it (for checks)
  adminAt(px, py) { const r = canvas.getBoundingClientRect(); ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1); const t = pickTarget(px - r.left, py - r.top); return { kind: t ? t.kind : null, name: t ? t.name : null, acts: t ? adminActionsFor(t).map((a) => a.label) : [] }; },
  get adminMode() { return { on: adminMode.on, asking: adminMode.asking, hasCode: !!adminMode.code, follow: adminMode.follow }; } }; // (adminMode: never the password itself)
