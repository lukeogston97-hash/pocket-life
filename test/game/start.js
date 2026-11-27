/* ---------- your person lives on the server now ----------
   The game joins the world first; the server says whether you have a person (and how they got on while you were away),
   or whether you're making a new one. Old saves from before 0.0.7 are cleared. */
import * as THREE from 'three';
import { game } from './links.js';
import { pondShapeAt } from './rules.js';
import { camera, canvas, renderer } from './core.js';
import { groundUnder, groundY, landAsMade, POND, pondShape, setFlats } from './land.js';
import {
  berryBushes, noLongerHere, oldStumps, removeSpotNear, rocks, spotKey, spots, trees, WALK_THROUGH, wildBushes,
} from './nature.js';
import { plants } from './plants.js';
import { CHOP, DETAILS, groundMovedUnder, LIFTED, MINE } from './world-build.js';
import { buildItem, SOURCES, STAT } from './items.js';
import { getItem, itemViews, world } from './world-items.js';
import { heldView, player, ui, you } from './you.js';
import { tip } from './tips.js';
import { applyGraphics, controls, gfx, speed } from './camera.js';
import { clearCellsNear, dropGhosts, findPath, freeAt, queueTask, solidAt, tasks, walk } from './moving.js';
import {
  cantPlaceAt, claimAt, claimHere, claimMine, cropBerriesNow, cropK, CROPS, digActions, drawCrop, endSit,
  fieldActions, fieldState, finishPlacing, fuelLeft, isLit, levelPlaced, movePlacing, notMineAt, placed,
  frontSpot, placeGrid, placedActions, placedName, placeSpotsShown, placing, rectOf, startDigging, startPlacing, stationNear, storedIn, storeWords,
  turnPlacing,
} from './placeables.js';
import { storeShowing } from './inventory.js';
import { glowOn, menuActions, ndc, pickTarget } from './input.js';
import { die, enterMenu, showGoneCard, showWelcomeBack } from './screens.js';
import { frame } from './loop.js';
import {
  goOnline, hideMaintenance, layoutData, net, others, outbox, sendAct, setNet, showMaintenance,
} from './online.js';
import { admin, adminTab, firesData, inboxData, itemsData, logData, playerData, playersData } from './admin.js';
import { peopleDrawn } from './others.js';
import { drawSociety, inviteAction, openSociety } from './society.js';
import { ADMIN_LINK, adminActionsFor, adminMode, openAdminLogin } from './admin-mode.js';

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
if (location.search.includes('debug')) window.__pl = { THREE, renderer, groundY, rectOf, groundUnder, startPlacing, turnPlacing, landAsMade, speed, tip, pondShape, pondShapeAt, POND, solidAt, walk, tasks, trees, you, others, net, plants, queueTask, camera, berryBushes, buildItem, layoutData, oldStumps, rocks, placed, placedActions, placedName, stationNear, placing, placeGrid, movePlacing, finishPlacing, cantPlaceAt, startDigging, digActions, fieldActions, fieldState, CROPS, cropK, cropBerriesNow, drawCrop, DETAILS, setFlats, levelPlaced, LIFTED, groundMovedUnder, wildBushes, spots, spotKey, WALK_THROUGH, fuelLeft, isLit, endSit, get player() { return player; }, get heldView() { return heldView; }, get freshLook() { return game.freshLook; }, itemViews, dropGhosts, findPath, freeAt, die, showWelcomeBack, showGoneCard, showMaintenance, hideMaintenance, admin, STAT, SOURCES, CHOP, MINE, world, menuActions, notMineAt, claimMine, claimHere, openSociety, drawSociety, inviteAction, claimAt, sendAct, outbox, goOnline, getItem, peopleDrawn, get glowOn() { return glowOn; }, get adminData() { return { playersData, playerData, inboxData, itemsData, firesData, logData, adminTab }; },
  ui, controls, openAdminLogin, storedIn, storeWords, storeShowing, // storage (0.2.2)
  placeSpotsShown, frontSpot, // the circles while placing, and a crate's front (0.2.3)
  // what a tap at a spot on the screen would find, and what the admin could do with it (for checks)
  adminAt(px, py) { const r = canvas.getBoundingClientRect(); ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1); const t = pickTarget(px - r.left, py - r.top); return { kind: t ? t.kind : null, name: t ? t.name : null, acts: t ? adminActionsFor(t).map((a) => a.label) : [] }; },
  get adminMode() { return { on: adminMode.on, asking: adminMode.asking, hasCode: !!adminMode.code, follow: adminMode.follow }; } }; // (adminMode: never the password itself)
