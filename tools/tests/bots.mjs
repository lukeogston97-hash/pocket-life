// Makes people on the local test server who then go away, for checks that need a busy world:
//   node bots.mjs <how many> <version> <build> [port]
// Each one connects, makes a person and leaves, one after another (so the world never counts more than one of them as playing).
import WebSocket from 'ws';
const [many, version, build, port = '8795'] = process.argv.slice(2);
const name = (i) => 'Bo' + [...String(i)].map((d) => 'abcdefghij'[d]).join(''); // letters only, so the name filter is happy
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < Number(many); i++) {
  await new Promise((done) => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/world`);
    s.on('open', async () => {
      s.send(JSON.stringify({ t: 'hello', proto: 2, watch: false, v: version, b: Number(build), link: 'test', pid: `bot${i}` }));
      await wait(25);
      s.send(JSON.stringify({ t: 'create', name: name(i), age: 20 + (i % 60), look: {} }));
      await wait(25);
      s.close(); done();
    });
    s.on('error', () => done());
  });
}
console.log(`made ${many} people`);
