// Makes people on the local test server who then go away, for checks that need a busy world:
//   node bots.mjs <how many> <version> <build> [port]
// Each one connects, makes a person and leaves, one after another (so the world never counts more than one of them as playing).
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
// the era goes in every hello: without it the server takes the game for an old one and sends it away to update (so no
// person was ever made, and the crowd check found nobody: broken from the day versions were renumbered until 24 Nov 2026)
const ERA = JSON.parse(readFileSync(new URL('../../test/game-data.json', import.meta.url), 'utf8')).era || 0;
const [many, version, build, port = '8795'] = process.argv.slice(2);
const name = (i) => 'Bo' + [...String(i)].map((d) => 'abcdefghij'[d]).join(''); // letters only, so the name filter is happy
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < Number(many); i++) {
  await new Promise((done) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/world`);
    s.on('open', async () => {
      s.send(JSON.stringify({ t: 'hello', proto: 2, watch: false, v: version, b: Number(build), e: ERA, link: 'test', pid: `bot${i}` }));
      await wait(25);
      s.send(JSON.stringify({ t: 'create', name: name(i), age: 20 + (i % 60), look: {} }));
      await wait(25);
      s.close(); done();
    });
    s.on('error', () => done());
  });
}
console.log(`made ${many} people`);
