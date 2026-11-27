// The /demo/ viewer's API on Cloudflare Pages (public/_worker.js), answered from the game test's fixtures the way
// web-dev/serve.mjs does it.
// Stateless: progress loops on the clock, and edits made in the demo (access, notes, shares) aren't kept.
import state from './fixtures/state.json';
import statusPlacement from './fixtures/status-placement.json';
import statusShared from './fixtures/status-shared.json';
import viewPlacement from './fixtures/view-placement.json';
import viewSelection from './fixtures/view-selection.json';
import viewShared from './fixtures/view-shared.json';

const views = { selection: viewSelection, placement: viewPlacement, shared: viewShared };
const statuses = { placement: statusPlacement, shared: statusShared };
const ALICE = 'b6d1f0f2-0000-4000-8000-00000000a1ce';
const BOB = '5c2e7a10-0000-4000-8000-000000000b0b';
const LIGHTHOUSE = 'a7d0c3a2-1111-4000-8000-00000000beef';
const CYCLE = 56; // 2 s steps: about 100 s to finish the roof, 10 s to admire it, then it starts over
const PER_STEP = 6;
const MISSING = [...atob(statusShared.status)].filter((c) => c === '\x02').length;

const step = () => Math.floor(Date.now() / 2000) % CYCLE;

// Every 2 s, mark a few of the lowest still-missing blocks as placed.
function status(s) {
  const st = Uint8Array.from(atob(s.status), (c) => c.charCodeAt(0));
  let budget = step() * PER_STEP;
  for (let i = 0; i < st.length && budget > 0; i++)
    if (st[i] === 2) {
      st[i] = 1;
      budget--;
    }
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const b of st) counts[b]++;
  counts[0] = 0;
  return { counts, status: btoa(String.fromCharCode(...st)) };
}

// Two more players help as progress advances, plus someone else's share and a pending share request.
function demoState() {
  const now = Date.now();
  // Alice and bob place the blocks the progress loop marks placed, two to one.
  const placed = Math.min(step() * PER_STEP, MISSING);
  const shared = state.shared.map((s) => ({
    ...s,
    author: 'Kestrel_Builds',
    manage: true,
    answer: 'pending',
    access: 'players',
    players: { [ALICE]: 'Alice_Mines', [BOB]: 'bob' },
    contributors: {
      ...s.contributors,
      [s.owner]: { ...s.contributors[s.owner], last: now - 5 * 3600e3 }, // "Player0 is you. One block, five hours ago."
      [ALICE]: { name: 'Alice_Mines', placed: 18 + Math.round((placed * 2) / 3), last: now - 20_000 },
      [BOB]: { name: 'bob', placed: 7 + Math.round(placed / 3), last: now - 400_000 },
    },
  }));
  const theirs = {
    ...shared[0],
    id: 'a7d0c3a2-3333-4000-8000-00000000beef',
    name: 'Item Sorter',
    origin: [61, -63, 1], // copies the cottage share; put it beside the cottage, not on top of it
    owner: ALICE,
    ownerName: 'Alice_Mines',
    mine: false,
    manage: false,
    access: 'everyone',
    answer: 'accepted',
    notes:
      'About 2,800 items an hour with two hoppers per slice.\n\nBuild order: the hopper line first, then the comparators, then the item frames.',
  };
  const here = { key: 'server:kestrel.gg', name: 'Kestrel SMP', address: 'kestrel.gg' };
  const s0 = state.shared[0];
  return {
    ...state,
    singleplayer: false,
    shared: [
      ...shared,
      theirs,
      { ...theirs, id: LIGHTHOUSE, name: 'Harbor Lighthouse', origin: [31, -63, 31], answer: 'pending' },
    ],
    placements: state.placements.map((p) => ({ ...p, author: 'Kestrel_Builds' })),
    server: here,
    online: [
      { uuid: ALICE, name: 'Alice_Mines' },
      { uuid: BOB, name: 'bob' },
    ],
    servers: [
      { ...here, seen: now, shared: state.shared },
      {
        key: 'server:creative.kestrel.gg',
        name: 'Kestrel Creative',
        address: 'creative.kestrel.gg',
        seen: now - 2 * 86400e3,
        shared: [
          {
            ...s0,
            id: LIGHTHOUSE,
            name: 'Harbor Lighthouse',
            origin: [31, -63, 31],
            owner: ALICE,
            ownerName: 'Alice_Mines',
            mine: false,
            manage: false,
          },
          {
            ...s0,
            id: 'a7d0c3a2-2222-4000-8000-00000000beef',
            name: 'Spawn Market',
            origin: [1, -63, 31],
            owner: BOB,
            ownerName: 'bob',
            mine: false,
          },
        ],
      },
    ],
  };
}

const json = (body, code = 200) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // The viewer asks for tex/<ns>/<path> without the extension, as the mod's own server answers it.
    if (url.pathname.startsWith('/demo/tex/')) return env.ASSETS.fetch(new URL(`${url.pathname}.png`, url));
    if (!url.pathname.startsWith('/demo/api/')) return env.ASSETS.fetch(req);
    const path = url.pathname.slice('/demo/api/'.length);
    if (path.startsWith('shaders'))
      return json({ error: 'Shader packs need Minecraft running. Install the mod to try them.' }, 503);
    switch (path) {
      case 'state':
        return json(demoState());
      case 'view': {
        const v = views[url.searchParams.get('type')];
        // Of the remembered server's schematics, only the lighthouse was opened there before.
        if (!v || (url.searchParams.get('server') && !url.searchParams.get('id')?.includes('1111')))
          return json({ error: 'not-saved' }, 404);
        return json(v);
      }
      case 'status': {
        const s = statuses[url.searchParams.get('type')];
        return s ? json(status(s)) : json({ error: 'Unknown type' }, 404);
      }
      case 'skin': {
        const id = url.searchParams.get('uuid') || '';
        if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad player id' }, 400);
        return env.ASSETS.fetch(new URL(`/demo/skins/${id}.png`, url));
      }
      case 'portals':
        return json({ portals: [] }); // the demo cottage has no Nether half to link portals to
      case 'access':
      case 'link':
      case 'notes':
      case 'load':
      case 'unload':
      case 'answer':
      case 'share':
      case 'unshare':
      case 'capture':
        return json({});
    }
    return json({ error: 'Not found' }, 404);
  },
};
