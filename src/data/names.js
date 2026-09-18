// Fictional names: a stable, one-to-one replacement for every real name in
// the pool, for builds or players that would rather not show real people.
// A name is chosen from the hash of the player's id, so it never changes
// between sessions or versions as long as these lists only ever grow at the
// end and the pool stays append-only (uniqueness is settled in pool order).

const FIRST = [
  'Amos', 'Booker', 'Cal', 'Dex', 'Eli', 'Fitz', 'Gus', 'Hollis', 'Ike', 'Jules', 'Kit', 'Lou', 'Mack', 'Ned', 'Otis', 'Pax', 'Quinn', 'Rex', 'Sid', 'Tate',
  'Ulysses', 'Vance', 'Wes', 'Xavier', 'York', 'Zeke', 'Abe', 'Bram', 'Cyrus', 'Dorian', 'Emmett', 'Floyd', 'Grady', 'Hank', 'Ira', 'Jasper', 'Knox', 'Lyle',
  'Milo', 'Nico', 'Orson', 'Pierce', 'Reid', 'Silas', 'Thad', 'Uriah', 'Vern', 'Wade', 'Yusuf', 'Zane', 'Alonzo', 'Bo', 'Cedric', 'Darius', 'Elvin', 'Fabian',
  'Gideon', 'Hugo', 'Isaiah', 'Jamal', 'Kendrick', 'Lamar', 'Marcus', 'Nate', 'Omar', 'Percy', 'Rashad', 'Sterling', 'Tobias', 'Ulric', 'Vaughn', 'Walt',
  'Andre', 'Bennett', 'Clyde', 'Desmond', 'Ezra', 'Forrest', 'Gordon', 'Harvey', 'Ivan', 'Jerome', 'Kofi', 'Leon', 'Malik', 'Nolan', 'Oscar', 'Preston',
  'Rufus', 'Simon', 'Terrence', 'Vince', 'Warren', 'Amari', 'Boyd', 'Curtis', 'Dante', 'Everett', 'Felix', 'Garrett', 'Hollis', 'Idris', 'Jonah', 'Kwame',
];
const LAST = [
  'Abernathy', 'Blackwood', 'Calloway', 'Dunmore', 'Ellery', 'Fairbanks', 'Gatlin', 'Hartwell', 'Ingram', 'Jessup', 'Kimball', 'Lockhart', 'Marchetti', 'Northcott',
  'Okafor', 'Pemberton', 'Quarles', 'Redfern', 'Sallis', 'Thornbury', 'Underhill', 'Vandermeer', 'Whitlock', 'Yarrow', 'Zimmer', 'Ashby', 'Barlow', 'Cotter',
  'Delacroix', 'Eversole', 'Fontaine', 'Greer', 'Haddad', 'Iverson', 'Juarez', 'Kessler', 'Lindqvist', 'Moreau', 'Nakamura', 'Ortega', 'Pruitt', 'Ravel',
  'Sandoval', 'Tremblay', 'Ulmer', 'Villanueva', 'Westbrook', 'Yates', 'Zapata', 'Aldana', 'Brightwater', 'Castellano', 'Draper', 'Espinoza', 'Farrow', 'Gilchrist',
  'Holloway', 'Ibarra', 'Jankowski', 'Kirkland', 'Lachance', 'Mbeki', 'Novak', 'Oduya', 'Pinkney', 'Quintero', 'Rasmussen', 'Sokolov', 'Tolliver', 'Uzoma',
  'Voss', 'Wakefield', 'Xiong', 'Yellowhorse', 'Zell', 'Ackerley', 'Bonner', 'Crossley', 'Dagan', 'Eastwood', 'Fenwick', 'Galloway', 'Hensley', 'Innes',
  'Jarvis', 'Kittredge', 'Lowry', 'Mattingly', 'Nesbitt', 'Ogilvie', 'Pascal', 'Rowe', 'Stroud', 'Tunney', 'Upchurch', 'Vickery', 'Winslow', 'Ybarra', 'Zuniga',
  'Amundsen', 'Beaumont', 'Corrigan', 'Dubois', 'Egan', 'Flanagan', 'Goldsmith', 'Havili', 'Isaacs', 'Jefferies', 'Keating', 'Lombardi', 'Muir', 'Naylor',
  'Osei', 'Pettigrew', 'Riordan', 'Saldana', 'Tanaka', 'Ulloa', 'Vasquez', 'Whitfield', 'Youngblood', 'Zaragoza', 'Applewhite', 'Bassett', 'Crenshaw', 'Dorsey',
];

/** 32-bit FNV-1a of a string. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** The fictional name for one id, given the names already claimed. Deterministic; probes on collision. */
export function fictionalNameFor(id, taken = new Set()) {
  const h = hash(id);
  for (let k = 0; k < 64; k++) {
    const a = (h + k * 7919) % FIRST.length;
    const b = ((h >>> 8) + k * 104729) % LAST.length;
    const name = `${FIRST[a]} ${LAST[b]}`;
    if (!taken.has(name)) return name;
  }
  return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]} ${(h % 90) + 10}`;
}

/** A one-to-one map id -> fictional name for a whole pool, settled in pool order. */
export function buildFictionalNames(players) {
  const taken = new Set();
  const out = new Map();
  for (const p of players) {
    const name = fictionalNameFor(p.id, taken);
    taken.add(name);
    out.set(p.id, name);
  }
  return out;
}

export const NAME_MODES = ['real', 'fictional'];

/**
 * Switch the pool's display names in place. The real name is kept on the
 * player so the switch is reversible; ids never change, so saves are safe.
 * Names already written into logs and records stay as they were written.
 */
export function applyNameMode(players, mode = 'real') {
  const fictional = mode === 'fictional' ? buildFictionalNames(players) : null;
  for (const p of players) {
    if (p.realName == null) p.realName = p.name;
    p.name = fictional ? fictional.get(p.id) : p.realName;
  }
  return mode;
}
