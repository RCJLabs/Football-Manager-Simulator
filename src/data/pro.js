// The 32-team pro league: two conferences of four divisions, real geography,
// original franchise names (no league or club marks are used).

export const CONFERENCES = ['American', 'National'];
export const DIVISIONS = ['East', 'North', 'South', 'West'];

export const PRO_TEAMS = [
  // American East
  { name: 'New England Minutemen', abbr: 'NE',  city: 'New England',  color: '#0b2a4a', conf: 0, div: 0 },
  { name: 'Buffalo Blizzard',      abbr: 'BUF', city: 'Buffalo',      color: '#1e5bb8', conf: 0, div: 0 },
  { name: 'Miami Tide',            abbr: 'MIA', city: 'Miami',        color: '#0aa3a3', conf: 0, div: 0 },
  { name: 'New York Skyliners',    abbr: 'NYS', city: 'New York',     color: '#15633f', conf: 0, div: 0 },
  // American North
  { name: 'Pittsburgh Forge',      abbr: 'PIT', city: 'Pittsburgh',   color: '#f2b705', conf: 0, div: 1 },
  { name: 'Baltimore Clippers',    abbr: 'BAL', city: 'Baltimore',    color: '#4b2a8a', conf: 0, div: 1 },
  { name: 'Cleveland Rockers',     abbr: 'CLE', city: 'Cleveland',    color: '#c8531f', conf: 0, div: 1 },
  { name: 'Cincinnati Riverboats', abbr: 'CIN', city: 'Cincinnati',   color: '#e0521b', conf: 0, div: 1 },
  // American South
  { name: 'Houston Wildcatters',   abbr: 'HOU', city: 'Houston',      color: '#8b1a2b', conf: 0, div: 2 },
  { name: 'Indianapolis Racers',   abbr: 'IND', city: 'Indianapolis', color: '#1b4fa0', conf: 0, div: 2 },
  { name: 'Jacksonville Anchors',  abbr: 'JAX', city: 'Jacksonville', color: '#0e6b6b', conf: 0, div: 2 },
  { name: 'Nashville Rhythm',      abbr: 'NSH', city: 'Nashville',    color: '#3a7fd5', conf: 0, div: 2 },
  // American West
  { name: 'Kansas City Cattlemen', abbr: 'KC',  city: 'Kansas City',  color: '#d11f2f', conf: 0, div: 3 },
  { name: 'Denver Summit',         abbr: 'DEN', city: 'Denver',       color: '#f26b21', conf: 0, div: 3 },
  { name: 'Las Vegas High Rollers', abbr: 'LV', city: 'Las Vegas',    color: '#8c8c8c', conf: 0, div: 3 },
  { name: 'Los Angeles Surf',      abbr: 'LAS', city: 'Los Angeles',  color: '#2b8ee6', conf: 0, div: 3 },
  // National East
  { name: 'Dallas Wranglers',      abbr: 'DAL', city: 'Dallas',       color: '#2456a6', conf: 1, div: 0 },
  { name: 'Philadelphia Founders', abbr: 'PHI', city: 'Philadelphia', color: '#0f5f4a', conf: 1, div: 0 },
  { name: 'Washington Monuments',  abbr: 'WAS', city: 'Washington',   color: '#7a1f1f', conf: 1, div: 0 },
  { name: 'New York Gothams',      abbr: 'NYG', city: 'New York',     color: '#1c2f6e', conf: 1, div: 0 },
  // National North
  { name: 'Green Bay Lumberjacks', abbr: 'GB',  city: 'Green Bay',    color: '#2a5f2e', conf: 1, div: 1 },
  { name: 'Chicago Blues',         abbr: 'CHI', city: 'Chicago',      color: '#0d2d6b', conf: 1, div: 1 },
  { name: 'Detroit Motors',        abbr: 'DET', city: 'Detroit',      color: '#1a76c2', conf: 1, div: 1 },
  { name: 'Minnesota Northmen',    abbr: 'MIN', city: 'Minnesota',    color: '#5a2a8c', conf: 1, div: 1 },
  // National South
  { name: 'New Orleans Second Line', abbr: 'NO', city: 'New Orleans', color: '#b99a4a', conf: 1, div: 2 },
  { name: 'Atlanta Phoenix',       abbr: 'ATL', city: 'Atlanta',      color: '#c41e3a', conf: 1, div: 2 },
  { name: 'Carolina Copperheads',  abbr: 'CAR', city: 'Carolina',     color: '#2a8fb8', conf: 1, div: 2 },
  { name: 'Tampa Bay Cannons',     abbr: 'TB',  city: 'Tampa Bay',    color: '#a2231d', conf: 1, div: 2 },
  // National West
  { name: 'San Francisco Prospectors', abbr: 'SF', city: 'San Francisco', color: '#b3161b', conf: 1, div: 3 },
  { name: 'Seattle Evergreens',    abbr: 'SEA', city: 'Seattle',      color: '#1f7a3f', conf: 1, div: 3 },
  { name: 'Arizona Scorpions',     abbr: 'ARI', city: 'Arizona',      color: '#9c1c2e', conf: 1, div: 3 },
  { name: 'Los Angeles Stars',     abbr: 'LAX', city: 'Los Angeles',  color: '#2f3d8f', conf: 1, div: 3 },
];

export const PRO_SEASON_GAMES = 17;

export function divisionName(team) {
  return `${CONFERENCES[team.conf]} ${DIVISIONS[team.div]}`;
}
