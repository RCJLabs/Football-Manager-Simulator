// Do backs, receivers and tight ends play like the real ones?
//
//   node scripts/skill-realism.mjs [games per player]
//
// The third of the realism scripts, after run-realism.mjs and pass-realism.mjs,
// and the same question as both: does a point of a player's rating move what he
// does as far as it moves it in the real game? Every back, receiver and tight
// end in the pool with a real season from 1999 on plays in the same average
// side (82 against 82), and what he does there is set against what he really
// did that season (nflverse player_stats, written down below so this runs
// offline). For each rate it prints the engine's spread, the real one, the
// slope of the real rate on the engine's (1 means the engine's differences
// between players come true one for one) and what a point of overall rating is
// worth in each.
//
// It found the receiving game's defect (DESIGN.md, "Backs, receivers and tight
// ends, held to real seasons"): a point of a receiver's rating moved his share
// of the targets six times as far as the real game's, his yards a target twice
// as far, and a back's fumbles seven times as far.
//
// Then the league: how a season's targets split between receivers, tight ends
// and backs at 82, against a real one.
import { PLAYERS } from '../src/data/db.js';
import { syntheticTeam } from './synthetic.mjs';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup, overall } from '../src/engine/ratings.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

const GAMES = Number(process.argv[2] || 150);

// That regular season: [games, carries, rushing yards, fumbles, targets,
// receptions, receiving yards, target share %].
const REAL_SKILL = {
  'aaron-jones-2019': [16, 236, 1084, 3, 68, 49, 474, 14],
  'adam-thielen-2018': [16, 5, 30, 1, 153, 113, 1373, 25.8],
  'adrian-peterson-2012': [16, 348, 2097, 4, 51, 40, 217, 11.2],
  'ahman-green-2003': [16, 355, 1883, 7, 50, 50, 367, 17.5],
  'aj-green-2013': [16, 0, 0, 1, 178, 98, 1426, 30.9],
  'alfred-morris-2012': [16, 335, 1613, 4, 16, 11, 77, 5.3],
  'allen-robinson-2015': [16, 0, 0, 0, 151, 80, 1400, 25.1],
  'alvin-kamara-2018': [15, 194, 883, 0, 105, 81, 709, 21.4],
  'amani-toomer-2002': [16, 1, 2, 0, 134, 82, 1343, 24.8],
  'amari-cooper-2021': [15, 0, 0, 1, 104, 68, 865, 19],
  'amon-ra-st-brown-2023': [16, 4, 24, 1, 164, 119, 1515, 30],
  'andre-johnson-2008': [16, 0, 0, 1, 115, 115, 1575, 31.3],
  'anquan-boldin-2005': [14, 12, 45, 2, 102, 102, 1398, 29.2],
  'anthony-fasano-2012': [16, 0, 0, 0, 69, 41, 332, 13.8],
  'anthony-thomas-2001': [14, 278, 1183, 0, 30, 22, 178, 8.6],
  'antonio-brown-2015': [16, 3, 28, 1, 193, 136, 1834, 33],
  'antonio-gates-2005': [15, 0, 0, 0, 89, 89, 1101, 27.8],
  'arian-foster-2010': [16, 326, 1614, 3, 84, 66, 604, 14.8],
  'benjarvus-green-ellis-2010': [16, 229, 1008, 0, 16, 12, 85, 5.9],
  'bijan-robinson-2024': [17, 304, 1456, 1, 72, 61, 431, 13.4],
  'brandin-cooks-2018': [15, 10, 68, 1, 117, 80, 1204, 22.8],
  'brandon-aiyuk-2023': [16, 0, 0, 1, 105, 75, 1342, 24],
  'brandon-marshall-2012': [16, 1, -2, 2, 194, 118, 1508, 40.1],
  'brandon-pettigrew-2011': [16, 0, 0, 0, 126, 83, 777, 18.9],
  'braylon-edwards-2007': [16, 0, 0, 3, 80, 80, 1289, 26.1],
  'breece-hall-2023': [17, 223, 994, 2, 95, 76, 591, 16.9],
  'breshad-perriman-2019': [14, 2, 16, 0, 69, 36, 645, 13],
  'brock-bowers-2024': [17, 5, 13, 0, 153, 112, 1194, 25.8],
  'cadillac-williams-2005': [14, 290, 1178, 3, 20, 20, 81, 10.2],
  'calvin-johnson-2012': [16, 0, 0, 3, 204, 122, 1964, 27.9],
  'carlos-hyde-2016': [13, 217, 988, 5, 33, 27, 163, 9],
  'cedric-benson-2009': [13, 301, 1251, 1, 24, 17, 111, 7.3],
  'ceedee-lamb-2023': [17, 14, 113, 3, 181, 135, 1749, 29.9],
  'chad-johnson-2005': [16, 5, 33, 1, 97, 97, 1432, 26.8],
  'chester-taylor-2006': [15, 304, 1214, 5, 42, 42, 288, 15.7],
  'chris-cooley-2008': [16, 0, 0, 3, 83, 83, 849, 26],
  'chris-godwin-2019': [14, 1, 8, 0, 121, 86, 1333, 22.5],
  'chris-ivory-2015': [15, 247, 1070, 4, 37, 30, 217, 7.3],
  'chris-johnson-2009': [16, 358, 2006, 3, 71, 50, 503, 15.2],
  'christian-kirk-2022': [17, 5, 11, 0, 133, 84, 1108, 23.2],
  'christian-mccaffrey-2023': [16, 272, 1459, 3, 83, 67, 564, 18.6],
  'clinton-portis-2003': [13, 290, 1591, 3, 38, 38, 314, 17.9],
  'cole-kmet-2023': [15, 3, 2, 1, 90, 73, 719, 21.5],
  'cooper-kupp-2021': [17, 4, 18, 0, 191, 145, 1947, 31.7],
  'cordarrelle-patterson-2013': [16, 12, 158, 0, 77, 45, 469, 14.4],
  'courtland-sutton-2024': [16, 0, 0, 1, 135, 81, 1081, 25.8],
  'curtis-martin-2004': [16, 371, 1697, 2, 41, 41, 245, 17.7],
  'curtis-samuel-2020': [15, 41, 200, 1, 97, 77, 851, 19.4],
  'dallas-clark-2009': [16, 2, 11, 1, 132, 100, 1106, 22],
  'dallas-goedert-2021': [15, 0, 0, 1, 76, 56, 830, 18.5],
  'danny-woodhead-2013': [16, 106, 429, 2, 87, 76, 605, 16.3],
  'dante-hall-2003': [15, 17, 66, 1, 40, 40, 423, 12.9],
  'darren-sproles-2011': [16, 88, 604, 0, 112, 86, 710, 17],
  'darren-waller-2020': [16, 0, 0, 2, 145, 107, 1196, 27.7],
  'darrius-heyward-bey-2011': [14, 0, 0, 1, 115, 64, 975, 24.7],
  'davante-adams-2020': [14, 0, 0, 1, 149, 115, 1374, 34],
  'david-montgomery-2023': [14, 219, 1015, 2, 24, 16, 117, 6.6],
  'david-njoku-2023': [16, 0, 0, 2, 123, 81, 882, 21.5],
  'dawson-knox-2021': [15, 0, 0, 0, 71, 49, 587, 13.2],
  'deandre-hopkins-2017': [15, 0, 0, 1, 174, 96, 1378, 35.3],
  'deebo-samuel-2021': [16, 59, 365, 4, 121, 77, 1405, 25.9],
  'delanie-walker-2015': [15, 1, 36, 0, 133, 94, 1088, 26.3],
  'demarco-murray-2014': [16, 392, 1845, 5, 64, 57, 416, 14.2],
  'derrick-henry-2020': [16, 378, 2027, 3, 31, 19, 114, 7.8],
  'derrick-mason-2003': [16, 3, 11, 0, 95, 95, 1303, 30.2],
  'devin-hester-2007': [13, 7, -10, 0, 20, 20, 299, 8.6],
  'devonta-freeman-2015': [15, 265, 1056, 3, 97, 73, 578, 18],
  'devonta-smith-2022': [17, 0, 0, 1, 136, 95, 1196, 26.9],
  'dez-bryant-2014': [16, 0, 0, 0, 137, 88, 1320, 29.1],
  'dk-metcalf-2020': [16, 0, 0, 1, 129, 83, 1303, 24],
  'donald-driver-2006': [16, 7, 16, 1, 91, 91, 1288, 26],
  'doug-baldwin-2015': [16, 0, 0, 1, 103, 78, 1069, 21.8],
  'doug-martin-2015': [16, 288, 1402, 5, 44, 33, 271, 9],
  'drake-london-2024': [17, 1, -3, 0, 158, 100, 1271, 29.3],
  'dwayne-bowe-2010': [16, 1, 4, 1, 133, 72, 1162, 28.7],
  'eddie-george-2000': [16, 398, 1455, 5, 63, 48, 429, 14.7],
  'edgerrin-james-2000': [16, 383, 1690, 5, 85, 61, 581, 15.3],
  'emmanuel-sanders-2014': [16, 8, 44, 1, 141, 101, 1404, 23.4],
  'eric-ebron-2018': [16, 3, -8, 1, 110, 66, 750, 18.3],
  'evan-engram-2022': [17, 2, 13, 0, 98, 73, 766, 17.1],
  'ezekiel-elliott-2016': [15, 322, 1631, 5, 40, 32, 363, 8.9],
  'frank-gore-2006': [16, 313, 1695, 7, 61, 61, 485, 23.6],
  'fred-taylor-2000': [13, 286, 1363, 4, 53, 36, 240, 12.6],
  'garrett-wilson-2022': [17, 4, 4, 2, 147, 83, 1103, 25],
  'george-kittle-2018': [16, 1, 10, 0, 136, 88, 1377, 26.4],
  'golden-tate-2014': [16, 5, 30, 1, 144, 99, 1331, 24.4],
  'greg-jennings-2010': [16, 1, -1, 2, 125, 76, 1265, 23.6],
  'greg-olsen-2016': [16, 0, 0, 0, 129, 80, 1073, 23.3],
  'heath-miller-2012': [15, 0, 0, 0, 101, 71, 816, 18.7],
  'hines-ward-2002': [16, 12, 142, 1, 161, 112, 1329, 29.5],
  'hunter-henry-2021': [16, 0, 0, 0, 75, 50, 603, 14.4],
  'hunter-renfrow-2021': [17, 3, 3, 1, 128, 103, 1038, 21.2],
  'isaiah-crowell-2016': [16, 198, 952, 2, 53, 40, 319, 9.5],
  'jahmyr-gibbs-2024': [17, 250, 1412, 1, 63, 52, 497, 13.1],
  'jakobi-meyers-2022': [14, 2, 9, 1, 96, 67, 804, 22.2],
  'jamaal-charles-2013': [15, 259, 1287, 4, 104, 70, 693, 20.6],
  'jamal-lewis-2003': [16, 388, 2063, 9, 26, 26, 205, 17],
  'jamarr-chase-2024': [17, 3, 32, 0, 175, 127, 1708, 27.9],
  'james-conner-2021': [15, 202, 752, 2, 39, 37, 375, 10.6],
  'jared-cook-2018': [16, 0, 0, 0, 101, 68, 896, 19.1],
  'jason-witten-2010': [16, 0, 0, 1, 128, 94, 1002, 22.5],
  'jaylen-waddle-2022': [17, 3, 26, 1, 117, 75, 1356, 20.8],
  'jeremy-hill-2014': [16, 222, 1124, 5, 32, 27, 215, 7.9],
  'jeremy-maclin-2014': [16, 0, 0, 0, 143, 85, 1318, 23.4],
  'jeremy-shockey-2002': [15, 0, 0, 3, 127, 74, 894, 24.9],
  'jimmy-graham-2013': [16, 0, 0, 0, 143, 86, 1215, 22.2],
  'jimmy-smith-1999': [16, 0, 0, 1, 176, 116, 1636, 33.7],
  'joe-horn-2004': [16, 0, 0, 0, 94, 94, 1399, 30.4],
  'joe-mixon-2021': [16, 292, 1205, 2, 48, 42, 314, 10.7],
  'jonathan-taylor-2021': [17, 332, 1811, 4, 51, 40, 360, 10.9],
  'jonnu-smith-2020': [14, 2, 4, 0, 65, 41, 448, 16],
  'jordan-reed-2015': [14, 0, 0, 3, 114, 87, 952, 23.8],
  'jordy-nelson-2014': [16, 0, 0, 0, 151, 98, 1519, 28.4],
  'josh-gordon-2013': [14, 5, 88, 0, 159, 87, 1646, 27.4],
  'josh-jacobs-2022': [17, 340, 1653, 3, 64, 53, 400, 11.5],
  'julian-edelman-2013': [16, 2, 11, 0, 151, 105, 1056, 24.4],
  'julio-jones-2015': [16, 0, 0, 3, 203, 136, 1871, 32.9],
  'julius-jones-2006': [16, 267, 1084, 1, 9, 9, 142, 7.3],
  'julius-thomas-2013': [14, 0, 0, 0, 90, 65, 788, 15],
  'justin-blackmon-2012': [16, 2, 23, 1, 132, 64, 865, 22.8],
  'justin-jefferson-2022': [17, 4, 24, 0, 184, 128, 1809, 28.7],
  'keenan-allen-2017': [16, 2, 9, 1, 159, 102, 1393, 27.7],
  'kenneth-walker-iii-2023': [15, 219, 905, 1, 37, 29, 259, 8.1],
  'kenny-britt-2010': [11, 0, 0, 1, 73, 42, 775, 22.4],
  'kenny-golladay-2019': [16, 0, 0, 1, 116, 65, 1190, 21.1],
  'keyshawn-johnson-2001': [15, 0, 0, 2, 180, 106, 1266, 32.7],
  'knowshon-moreno-2013': [16, 241, 1038, 1, 74, 60, 548, 11],
  'kyle-pitts-2021': [17, 0, 0, 0, 110, 68, 1026, 19.9],
  'kyle-rudolph-2017': [16, 0, 0, 0, 81, 57, 532, 15.5],
  'ladainian-tomlinson-2006': [16, 349, 1815, 2, 56, 56, 508, 19.5],
  'ladd-mcconkey-2024': [16, 0, 0, 2, 112, 82, 1149, 24.2],
  'lance-kendricks-2016': [16, 0, 0, 1, 87, 50, 499, 16.4],
  'laquon-treadwell-2018': [15, 0, 0, 0, 53, 35, 302, 9.4],
  'larry-fitzgerald-2008': [16, 0, 0, 1, 96, 96, 1434, 22.9],
  'larry-johnson-2005': [16, 336, 1750, 5, 33, 33, 343, 12.8],
  'latavius-murray-2015': [16, 266, 1066, 4, 53, 41, 232, 9.2],
  'laveranues-coles-2002': [16, 6, 39, 1, 134, 89, 1264, 27.9],
  'legarrette-blount-2016': [16, 299, 1161, 2, 8, 7, 38, 4.6],
  'leonard-fournette-2021': [14, 180, 812, 1, 84, 69, 454, 14],
  'lesean-mccoy-2013': [16, 314, 1607, 1, 64, 52, 539, 13],
  'leveon-bell-2014': [16, 290, 1361, 0, 105, 83, 854, 17.5],
  'levine-toilolo-2016': [13, 0, 0, 0, 19, 13, 264, 4.4],
  'luke-willson-2015': [13, 0, 0, 0, 26, 17, 213, 6.7],
  'malik-nabers-2024': [15, 5, 2, 1, 170, 109, 1204, 34.9],
  'marcedes-lewis-2010': [16, 0, 0, 2, 89, 58, 700, 19.2],
  'marion-barber-2007': [16, 203, 973, 2, 44, 44, 282, 13.4],
  'mark-andrews-2021': [17, 1, 0, 1, 153, 107, 1361, 25.9],
  'mark-ingram-2017': [16, 230, 1124, 3, 71, 58, 416, 14],
  'marques-colston-2007': [16, 0, 0, 1, 98, 98, 1202, 22],
  'marshall-faulk-1999': [15, 228, 1267, 2, 94, 80, 976, 19.9],
  'marshawn-lynch-2014': [16, 280, 1306, 3, 48, 37, 367, 11.9],
  'martellus-bennett-2014': [16, 0, 0, 0, 128, 90, 916, 21.1],
  'marvin-harrison-2002': [16, 2, 10, 0, 205, 143, 1722, 34.9],
  'marvin-jones-2021': [17, 0, 0, 0, 120, 73, 832, 20.6],
  'matt-forte-2013': [16, 289, 1339, 2, 94, 74, 594, 16.5],
  'maurice-jones-drew-2011': [16, 343, 1606, 5, 63, 43, 374, 15.2],
  'melvin-gordon-2018': [12, 175, 885, 1, 66, 50, 490, 17.5],
  'michael-bush-2011': [16, 256, 977, 1, 47, 37, 418, 10.4],
  'michael-crabtree-2012': [16, 1, 8, 0, 126, 85, 1105, 29.2],
  'michael-pittman-2023': [16, 0, 0, 1, 156, 109, 1152, 30.5],
  'michael-thomas-2019': [16, 1, -9, 1, 185, 149, 1725, 33.1],
  'michael-turner-2008': [16, 377, 1699, 2, 6, 6, 41, 8.1],
  'mike-alstott-1999': [16, 239, 956, 5, 34, 27, 239, 8.4],
  'mike-evans-2016': [16, 0, 0, 0, 173, 96, 1321, 30.3],
  'mike-gesicki-2021': [17, 0, 0, 0, 112, 73, 780, 18.7],
  'mike-wallace-2010': [16, 5, 39, 1, 98, 60, 1257, 20.9],
  'mike-williams-2021': [16, 0, 0, 0, 129, 76, 1146, 20.6],
  'mohamed-sanu-2016': [15, 1, 5, 1, 81, 59, 653, 16.2],
  'muhsin-muhammad-2004': [16, 3, 15, 3, 93, 93, 1405, 29.9],
  'nate-burleson-2010': [14, 7, 81, 2, 86, 55, 625, 16.3],
  'nick-chubb-2022': [17, 302, 1525, 1, 37, 27, 239, 7.3],
  'nico-collins-2024': [12, 0, 0, 0, 99, 68, 1006, 24.8],
  'nkeal-harry-2020': [13, 2, 0, 1, 57, 33, 309, 16.5],
  'noah-fant-2022': [17, 0, 0, 0, 63, 50, 486, 11.4],
  'oj-howard-2018': [10, 0, 0, 0, 48, 34, 565, 11.7],
  'owen-daniels-2008': [16, 0, 0, 1, 70, 70, 862, 19.1],
  'pat-freiermuth-2024': [17, 0, 0, 3, 78, 65, 653, 17],
  'peter-warrick-2003': [15, 17, 143, 0, 80, 80, 833, 25.9],
  'peyton-hillis-2010': [16, 270, 1177, 8, 77, 61, 477, 16.5],
  'pierre-garcon-2013': [16, 2, 19, 1, 181, 113, 1346, 30.2],
  'plaxico-burress-2007': [16, 0, 0, 0, 70, 70, 1025, 23.1],
  'priest-holmes-2002': [14, 313, 1615, 1, 81, 70, 672, 20.4],
  'puka-nacua-2023': [17, 12, 89, 1, 160, 105, 1486, 28.8],
  'randy-moss-2007': [16, 0, 0, 0, 98, 98, 1493, 24.3],
  'rashaad-penny-2021': [10, 119, 749, 0, 8, 6, 48, 5.4],
  'rashard-mendenhall-2010': [16, 324, 1273, 2, 34, 23, 167, 7.5],
  'reggie-bush-2011': [15, 216, 1086, 4, 52, 43, 296, 12],
  'reggie-wayne-2007': [16, 1, 4, 3, 104, 104, 1510, 29.3],
  'reuben-droughns-2005': [16, 309, 1232, 6, 39, 39, 369, 14.3],
  'rhamondre-stevenson-2022': [17, 210, 1040, 4, 88, 69, 421, 17],
  'ricky-williams-2002': [16, 383, 1853, 7, 59, 47, 363, 14.1],
  'rob-gronkowski-2011': [16, 1, 2, 0, 124, 90, 1327, 20.4],
  'robert-woods-2019': [15, 17, 115, 0, 139, 90, 1134, 23.3],
  'rod-smith-2000': [16, 6, 99, 1, 171, 98, 1578, 31.5],
  'roddy-white-2010': [16, 1, 3, 1, 179, 115, 1389, 31.2],
  'ron-dayne-2000': [16, 226, 758, 1, 3, 3, 11, 3.4],
  'rudi-johnson-2004': [16, 362, 1457, 4, 15, 15, 84, 7.8],
  'ryan-grant-2009': [16, 282, 1253, 1, 30, 25, 197, 8.2],
  'ryan-mathews-2013': [16, 285, 1255, 2, 33, 26, 189, 8.4],
  'sam-laporta-2023': [17, 1, 4, 0, 120, 86, 889, 20.9],
  'santana-moss-2005': [16, 3, -3, 2, 84, 84, 1483, 30.2],
  'santonio-holmes-2009': [16, 3, 6, 0, 138, 79, 1248, 25.8],
  'saquon-barkley-2024': [16, 345, 2005, 2, 43, 33, 278, 11.4],
  'shaun-alexander-2005': [16, 370, 1880, 5, 15, 15, 78, 8.1],
  'stefon-diggs-2020': [16, 1, 1, 0, 166, 127, 1535, 29],
  'stephen-davis-1999': [14, 282, 1366, 4, 27, 22, 111, 7.5],
  'sterling-shepard-2018': [16, 3, 33, 0, 107, 66, 872, 18.6],
  'steve-smith-2005': [16, 4, 25, 1, 103, 103, 1563, 38.3],
  'steven-jackson-2006': [16, 346, 1528, 4, 90, 90, 806, 25],
  'tee-higgins-2021': [14, 0, 0, 1, 110, 74, 1091, 23.9],
  'terrell-owens-2001': [16, 4, 21, 0, 155, 93, 1412, 31.1],
  'terry-mclaurin-2022': [17, 7, 29, 1, 120, 77, 1191, 22.6],
  'thomas-jones-2009': [16, 332, 1402, 2, 18, 10, 58, 6.5],
  'tiki-barber-2005': [16, 357, 1860, 1, 54, 54, 530, 18.4],
  'tj-duckett-2004': [12, 104, 509, 2, 3, 3, 15, 6.5],
  'tj-hockenson-2022': [17, 0, 0, 1, 129, 86, 914, 20.3],
  'todd-gurley-2017': [15, 279, 1305, 5, 87, 64, 788, 18.3],
  'todd-heap-2003': [16, 3, 21, 1, 57, 57, 693, 26.3],
  'tony-gonzalez-2004': [16, 1, 5, 0, 102, 102, 1258, 27.6],
  'torrey-smith-2013': [16, 0, 0, 1, 137, 65, 1128, 22.3],
  'torry-holt-2003': [16, 1, 5, 1, 117, 117, 1696, 31],
  'travis-kelce-2020': [15, 0, 0, 1, 145, 105, 1416, 25],
  'trent-richardson-2012': [15, 267, 950, 3, 70, 51, 367, 13.2],
  'trey-mcbride-2024': [16, 1, 2, 0, 147, 111, 1146, 29.3],
  'troy-williamson-2006': [12, 0, 0, 0, 37, 37, 455, 15.1],
  'tucker-kraft-2024': [17, 3, 6, 1, 70, 50, 707, 15.1],
  'tyler-boyd-2018': [14, 2, 3, 0, 108, 76, 1028, 22.2],
  'tyler-eifert-2015': [13, 0, 0, 0, 74, 52, 615, 17.7],
  'tyler-lockett-2020': [16, 0, 0, 1, 132, 100, 1054, 24.6],
  'tyreek-hill-2023': [16, 6, 15, 1, 171, 119, 1799, 32.7],
  'vernon-davis-2009': [16, 0, 0, 0, 129, 78, 965, 24.8],
  'vincent-jackson-2012': [16, 0, 0, 0, 147, 72, 1384, 26.3],
  'warrick-dunn-2004': [16, 265, 1106, 3, 29, 29, 293, 17],
  'wes-welker-2011': [16, 4, 30, 0, 173, 122, 1569, 28.4],
  'willis-mcgahee-2007': [15, 294, 1207, 4, 43, 43, 231, 13.9],
  'zac-stacy-2013': [13, 250, 973, 1, 35, 26, 141, 10.9],
  'zach-ertz-2018': [16, 0, 0, 1, 156, 116, 1163, 26.4],
  'zach-miller-2010': [15, 0, 0, 1, 92, 60, 685, 20.3],
};
// The real game's split of targets, 2019-2023 season totals.
const REAL_SHARE = { WR: [59.3, 63.3, 8.02], TE: [21.1, 68.9, 7.29], RB: [19.4, 77.0, 5.75] };

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)); };
const slope = (x, y) => { const mx = mean(x), my = mean(y); let s = 0, a = 0; for (let i = 0; i < x.length; i++) { s += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; } return s / a; };
const f2 = (x) => x.toFixed(2);
const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });

// ---- the players --------------------------------------------------------------
const SIDE = syntheticTeam('side', 82, 2, 1), OPP = syntheticTeam('opp', 82, 2, 2);
const rows = [];
for (const p of PLAYERS.filter((x) => REAL_SKILL[x.id])) {
  const slot = ROSTER_SLOTS.find((s) => s.pos === p.pos && s.starter).id;
  const t = { ...SIDE, slots: { ...SIDE.slots }, byId: new Map(SIDE.byId) };
  t.byId.set(p.id, p); t.slots[slot] = p.id;
  const e = { car: 0, ryds: 0, fum: 0, tgt: 0, rec: 0, yds: 0, att: 0 };
  for (let i = 0; i < GAMES; i++) {
    const home = i % 2 === 0;
    const g = createGame(home ? tf(t) : tf(OPP), home ? tf(OPP) : tf(t), { seed: 70000 + i, homeAdvantage: false });
    simulateGame(g);
    const side = home ? 0 : 1;
    e.att += g.stats[side].team.passAtt;
    const s = g.stats[side].players[p.id];
    if (s) { e.car += s.rush.att; e.ryds += s.rush.yds; e.fum += s.rush.fum; e.tgt += s.rec.tgt; e.rec += s.rec.rec; e.yds += s.rec.yds; }
  }
  const [games, car, ryds, fum, tgt, rec, yds, share] = REAL_SKILL[p.id];
  rows.push({ pos: p.pos, ovr: overall(p), e: { ...e, n: GAMES }, r: { games, car, ryds, fum, tgt, rec, yds, share } });
}
const RATES = [
  ['targets a game', (e) => e.tgt / e.n, (r) => r.tgt / r.games, 'rec'],
  ['share of targets %', (e) => 100 * e.tgt / e.att, (r) => r.share, 'rec'],
  ['catch rate %', (e) => 100 * e.rec / e.tgt, (r) => 100 * r.rec / r.tgt, 'rec'],
  ['yards a target', (e) => e.yds / e.tgt, (r) => r.yds / r.tgt, 'rec'],
  ['carries a game', (e) => e.car / e.n, (r) => r.car / r.games, 'rush'],
  ['yards a carry', (e) => e.ryds / e.car, (r) => r.ryds / r.car, 'rush'],
  ['fumbles a 100 touches', (e) => 100 * e.fum / (e.car + e.rec), (r) => 100 * r.fum / (r.car + r.rec), 'rush'],
];
const slopes = {};
for (const pos of ['WR', 'TE', 'RB']) {
  const mine = rows.filter((x) => x.pos === pos);
  const minT = pos === 'RB' ? 20 : 40;
  console.log(`${pos}: ${mine.length} players, each ${GAMES} games in the same average side`);
  console.log(`  ${'rate'.padEnd(24)} engine mean / sd   real mean / sd   slope, real on engine   a point of overall, engine / real`);
  for (const [label, fe, fr, kind] of RATES) {
    if (kind === 'rush' && pos !== 'RB') continue;
    const rs = mine.filter((x) => (kind === 'rec' ? x.r.tgt >= minT : x.r.car >= 100));
    const E = rs.map((x) => fe(x.e)), Rr = rs.map((x) => fr(x.r)), O = rs.map((x) => x.ovr);
    const b = slope(E, Rr);
    slopes[`${pos} ${label}`] = b;
    console.log(`  ${label.padEnd(24)} ${f2(mean(E)).padStart(6)} / ${f2(sd(E)).padEnd(6)}   ${f2(mean(Rr)).padStart(6)} / ${f2(sd(Rr)).padEnd(6)}   ${f2(b).padStart(6)}                  ${slope(O, E).toFixed(3)} / ${slope(O, Rr).toFixed(3)}`);
  }
}
console.log(`  receivers, share of targets, real on engine slope: ${f2(slopes['WR share of targets %'])}`);
console.log(`  backs, carries a game, real on engine slope: ${f2(slopes['RB carries a game'])}`);

// ---- the league ----------------------------------------------------------------
const by = {};
for (let i = 0; i < 800; i++) {
  const a = syntheticTeam(`sa82-${i}`, 82, 2, 100 + i), b = syntheticTeam(`sb82-${i}`, 82, 2, 7000 + i);
  const la = buildLineup(a.slots, a.byId), lb = buildLineup(b.slots, b.byId);
  const g = createGame({ ...a, lineup: la }, { ...b, lineup: lb }, { seed: 91000 + i, homeAdvantage: false });
  simulateGame(g);
  [la, lb].forEach((lu, side) => {
    const posOf = new Map(); for (const [pos, arr] of Object.entries(lu)) for (const x of arr) posOf.set(x.id, pos);
    for (const [id, s] of Object.entries(g.stats[side].players)) { const t = (by[posOf.get(id)] ??= { tgt: 0, rec: 0, yds: 0 }); t.tgt += s.rec.tgt; t.rec += s.rec.rec; t.yds += s.rec.yds; }
  });
}
const all = ['WR', 'TE', 'RB'].reduce((t, p) => t + by[p].tgt, 0);
console.log(`\nA league at 82, 800 games (real 2019-2023 in brackets):`);
for (const p of ['WR', 'TE', 'RB']) {
  const b = by[p], [share, cr, ypt] = REAL_SHARE[p];
  console.log(`  ${p}: ${(100 * b.tgt / all).toFixed(1)}% of targets (${share}), catch rate ${(100 * b.rec / b.tgt).toFixed(1)}% (${cr}), ${f2(b.yds / b.tgt)} a target (${ypt})`);
}
