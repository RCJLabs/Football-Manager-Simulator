// AI franchise identities and GM personalities.

export const AI_TEAMS = [
  { name: 'Iron Curtain',      abbr: 'IRC', color: '#c9a227' },
  { name: 'Monsters of Midway', abbr: 'MID', color: '#0b3d91' },
  { name: 'Air Coryell',       abbr: 'AIR', color: '#f7b400' },
  { name: 'Purple Reign',      abbr: 'PRP', color: '#5b2d90' },
  { name: 'Steel Dynasty',     abbr: 'STL', color: '#8a8d8f' },
  { name: 'Greatest Show',     abbr: 'GSO', color: '#003594' },
  { name: 'Legion of Boom',    abbr: 'LOB', color: '#69be28' },
  { name: 'Silver & Black',    abbr: 'SLB', color: '#a5acaf' },
  { name: 'Orange Crush',      abbr: 'ORC', color: '#fb4f14' },
  { name: 'No-Name Defense',   abbr: 'NND', color: '#008e97' },
  { name: 'Run & Shoot',       abbr: 'RNS', color: '#4b92db' },
  { name: 'Doomsday',          abbr: 'DMS', color: '#869397' },
  { name: 'Frozen Tundra',     abbr: 'FZT', color: '#203731' },
  { name: 'Gold Rush',         abbr: 'GLD', color: '#b3995d' },
  { name: 'Sack Exchange',     abbr: 'SXG', color: '#125740' },
  { name: 'Cardiac Kids',      abbr: 'CDK', color: '#d50a0a' },
];

/**
 * How much of a GM's valuation comes from real win impact rather than hype.
 * It also decides how well he reads a prospect he has never seen play: the
 * general managers who chase value are the ones whose scouting is worth having.
 */
export const SAVVY = { modern: 0.7, trenches: 0.62, defense: 0.5, balanced: 0.34, gambler: 0.26, ground: 0.16, oldschool: 0.18, airraid: 0.1 };

export const GM_PERSONALITIES = [
  { id: 'balanced',  name: 'Balanced',        blurb: 'Takes the best value on the board.', pos: {}, era: null,
    strategy: { passRate: 0.55, aggression: 0.4, tempo: 0.5, blitzRate: 0.25, deepShell: 0.2 } },
  { id: 'airraid',   name: 'Air Raid',        blurb: 'Loves quarterbacks and receivers.', pos: { QB: 1.1, WR: 1.12, TE: 1.04, RB: 0.9, OL: 0.97 }, era: null,
    strategy: { passRate: 0.66, aggression: 0.55, tempo: 0.7, blitzRate: 0.25, deepShell: 0.25 } },
  { id: 'ground',    name: 'Ground & Pound',  blurb: 'Backs and big men up front.', pos: { RB: 1.15, OL: 1.1, TE: 1.05, WR: 0.92, QB: 0.97 }, era: null,
    strategy: { passRate: 0.44, aggression: 0.35, tempo: 0.3, blitzRate: 0.2, deepShell: 0.2 } },
  { id: 'defense',   name: 'Defense Wins',    blurb: 'Builds from the defensive side.', pos: { DL: 1.12, LB: 1.1, CB: 1.1, S: 1.08, QB: 0.95, WR: 0.95 }, era: null,
    strategy: { passRate: 0.5, aggression: 0.3, tempo: 0.4, blitzRate: 0.35, deepShell: 0.2 } },
  { id: 'oldschool', name: 'Old School',      blurb: 'Prefers players from before 1990.', pos: { RB: 1.05, OL: 1.03 }, era: (season) => (season < 1990 ? 1.07 : 0.96),
    strategy: { passRate: 0.47, aggression: 0.3, tempo: 0.35, blitzRate: 0.3, deepShell: 0.15 } },
  { id: 'modern',    name: 'Analytics',       blurb: 'Modern players, aggressive on 4th down.', pos: { QB: 1.08, WR: 1.05, CB: 1.03 }, era: (season) => (season >= 2005 ? 1.06 : 0.97),
    strategy: { passRate: 0.62, aggression: 0.8, tempo: 0.6, blitzRate: 0.3, deepShell: 0.25 } },
  { id: 'trenches',  name: 'Trenches',        blurb: 'Wins the line of scrimmage on both sides.', pos: { OL: 1.14, DL: 1.14, QB: 0.96, WR: 0.94 }, era: null,
    strategy: { passRate: 0.5, aggression: 0.4, tempo: 0.45, blitzRate: 0.2, deepShell: 0.2 } },
  { id: 'gambler',   name: 'Gambler',         blurb: 'Blitz-happy and aggressive.', pos: { LB: 1.08, S: 1.06, WR: 1.05 }, era: null,
    strategy: { passRate: 0.58, aggression: 0.75, tempo: 0.65, blitzRate: 0.5, deepShell: 0.1 } },
];
