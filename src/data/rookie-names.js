// Name parts for generated rookies. Two lists, combined, give well over a
// hundred thousand distinct names, which is far more than a long dynasty will
// ever need. They are ordinary names rather than the invented ones the
// fictional-name toggle uses, because a rookie class should read like a draft
// class and not like a parody.
//
// Appending to either list is safe. Reordering or removing entries is not:
// a rookie's name is chosen from a seed, so changing the lists renames
// players in leagues already saved.

export const FIRST_NAMES = [
  'Aaron', 'Abe', 'Adrian', 'AJ', 'Alec', 'Alonzo', 'Amari', 'Amos', 'Andre', 'Angelo', 'Anthony', 'Antoine', 'Archie', 'Arlo', 'Armand', 'Arthur', 'Asher', 'Aubrey', 'Augie', 'Austin',
  'Avery', 'Barrett', 'Bennie', 'Benson', 'Bernard', 'Bishop', 'Blaine', 'Blake', 'Bo', 'Bobby', 'Booker', 'Boyd', 'Brady', 'Brandt', 'Braxton', 'Brennan', 'Brett', 'Brock', 'Bruce', 'Bryce',
  'Byron', 'Cade', 'Cal', 'Caleb', 'Calvin', 'Cam', 'Carlos', 'Carson', 'Carter', 'Casey', 'Cedric', 'Chance', 'Chandler', 'Charlie', 'Chase', 'Chris', 'Clay', 'Clifton', 'Clint', 'Clyde',
  'Cody', 'Colby', 'Cole', 'Colin', 'Colt', 'Conrad', 'Cooper', 'Corey', 'Cornelius', 'Cortez', 'Craig', 'Cruz', 'Curtis', 'Cyrus', 'Dale', 'Dallas', 'Dalton', 'Damon', 'Dante', 'Darius',
  'Darnell', 'Darren', 'Dashiell', 'Davante', 'Dave', 'Davion', 'Dawson', 'Deandre', 'Declan', 'Dee', 'Demarcus', 'Denzel', 'Deon', 'Derrick', 'Desmond', 'Devin', 'Dexter', 'Diego', 'Dominic', 'Donnell',
  'Dorian', 'Doug', 'Drew', 'Duke', 'Duncan', 'Dwight', 'Earl', 'Eddie', 'Edgar', 'Eli', 'Elias', 'Elijah', 'Ellis', 'Elmer', 'Elvin', 'Emerson', 'Emmett', 'Enzo', 'Eric', 'Ernie',
  'Ethan', 'Eugene', 'Evan', 'Everett', 'Ezekiel', 'Ezra', 'Fabian', 'Felix', 'Fernando', 'Finn', 'Fletcher', 'Floyd', 'Ford', 'Forrest', 'Francis', 'Frank', 'Franklin', 'Fred', 'Gabe', 'Gage',
  'Gareth', 'Garrett', 'Gary', 'Gavin', 'Gene', 'Geno', 'George', 'Gerald', 'Gideon', 'Gil', 'Glen', 'Gordon', 'Grady', 'Graham', 'Grant', 'Grayson', 'Greg', 'Griffin', 'Gus', 'Hank',
  'Harold', 'Harrison', 'Harvey', 'Hayden', 'Heath', 'Hector', 'Henry', 'Herbert', 'Hollis', 'Homer', 'Horace', 'Howard', 'Hudson', 'Hugh', 'Hugo', 'Hunter', 'Ian', 'Ibrahim', 'Idris', 'Ike',
  'Isaac', 'Isaiah', 'Ivan', 'Jabari', 'Jace', 'Jack', 'Jackson', 'Jacoby', 'Jaden', 'Jalen', 'Jamal', 'Jameson', 'Jamie', 'Jared', 'Jarrett', 'Jasper', 'Javon', 'Jaxon', 'Jay', 'Jaylen',
  'Jedediah', 'Jeff', 'Jeremiah', 'Jermaine', 'Jerome', 'Jesse', 'Jimmy', 'Joaquin', 'Joel', 'Johnny', 'Jonah', 'Jordan', 'Jose', 'Josiah', 'Judah', 'Jules', 'Julian', 'Julius', 'Junior', 'Justice',
  'Kade', 'Kai', 'Kaleb', 'Kane', 'Kareem', 'Karl', 'Keenan', 'Keith', 'Kendrick', 'Kenny', 'Kevon', 'Khalil', 'Kieran', 'King', 'Kirk', 'Kit', 'Knox', 'Kobe', 'Kofi', 'Kyle',
  'Lamar', 'Lance', 'Landon', 'Lane', 'Larry', 'Lawson', 'Layne', 'Lee', 'Leo', 'Leon', 'Leroy', 'Levi', 'Lewis', 'Liam', 'Lincoln', 'Lionel', 'Logan', 'Lonnie', 'Lorenzo', 'Lou',
  'Lucas', 'Luka', 'Luther', 'Lyle', 'Mack', 'Macon', 'Malachi', 'Malik', 'Marcus', 'Mario', 'Marlon', 'Marques', 'Marshall', 'Martin', 'Marvin', 'Mason', 'Mateo', 'Matteo', 'Maurice', 'Max',
  'Maxwell', 'Micah', 'Miles', 'Milo', 'Mitchell', 'Monte', 'Morgan', 'Moses', 'Myles', 'Nash', 'Nate', 'Nehemiah', 'Neil', 'Nelson', 'Nico', 'Noah', 'Nolan', 'Norman', 'Odell', 'Olin',
  'Oliver', 'Omar', 'Orion', 'Orlando', 'Orson', 'Oscar', 'Otis', 'Owen', 'Pablo', 'Parker', 'Pat', 'Patrick', 'Paul', 'Pax', 'Percy', 'Perry', 'Peyton', 'Phil', 'Phoenix', 'Pierce',
  'Porter', 'Preston', 'Quentin', 'Quincy', 'Quinn', 'Rafael', 'Ralph', 'Ramon', 'Randall', 'Raphael', 'Rashad', 'Ray', 'Reece', 'Reed', 'Reggie', 'Reid', 'Remy', 'Rene', 'Rex', 'Rhett',
  'Ricardo', 'Rick', 'Rico', 'Riley', 'River', 'Roan', 'Robert', 'Roderick', 'Rodney', 'Roger', 'Roland', 'Roman', 'Ronnie', 'Rory', 'Roscoe', 'Ross', 'Roy', 'Ruben', 'Rudy', 'Rufus',
  'Russell', 'Ryan', 'Ryder', 'Sam', 'Samson', 'Saul', 'Sawyer', 'Scott', 'Sean', 'Sebastian', 'Sergio', 'Seth', 'Shane', 'Shaun', 'Sheldon', 'Sidney', 'Silas', 'Simon', 'Solomon', 'Spencer',
  'Stan', 'Stefan', 'Sterling', 'Stone', 'Sullivan', 'Sylvester', 'Tanner', 'Tariq', 'Tate', 'Terrance', 'Terry', 'Thaddeus', 'Theo', 'Thomas', 'Tobias', 'Todd', 'Tomas', 'Tony', 'Trace', 'Travis',
  'Trent', 'Trevor', 'Trey', 'Tristan', 'Troy', 'Tucker', 'Ty', 'Tyler', 'Tyrese', 'Ulysses', 'Uriah', 'Valentin', 'Vance', 'Vaughn', 'Vernon', 'Victor', 'Vince', 'Virgil', 'Wade', 'Walker',
  'Wallace', 'Walter', 'Warren', 'Waylon', 'Wayne', 'Wendell', 'Wesley', 'Weston', 'Wilbur', 'Wiley', 'Will', 'Willie', 'Wilson', 'Winston', 'Wyatt', 'Xander', 'Xavier', 'Yusuf', 'Zane', 'Zeke',
];

export const LAST_NAMES = [
  'Abney', 'Acosta', 'Adkins', 'Aguilar', 'Albright', 'Alderman', 'Alford', 'Allred', 'Alston', 'Ambrose', 'Amos', 'Anders', 'Appling', 'Archuleta', 'Arledge', 'Armitage', 'Ashford', 'Atwater', 'Aubrey', 'Averill',
  'Babcock', 'Bagwell', 'Bainbridge', 'Baldock', 'Ballard', 'Bancroft', 'Banning', 'Barfield', 'Barkley', 'Barlow', 'Barnhart', 'Barringer', 'Bartholomew', 'Bascomb', 'Bassett', 'Batiste', 'Baxley', 'Beauchamp', 'Beckham', 'Bedford',
  'Belcher', 'Bellinger', 'Benavides', 'Benning', 'Bergeron', 'Berryhill', 'Bethune', 'Bickford', 'Biggers', 'Billings', 'Birdsong', 'Bishop', 'Blackmon', 'Blackwell', 'Blanchard', 'Bledsoe', 'Blount', 'Bodine', 'Bolander', 'Bolden',
  'Bonham', 'Boone', 'Boseman', 'Bosworth', 'Bourne', 'Bowden', 'Bracken', 'Bradbury', 'Braddock', 'Bramlett', 'Brantley', 'Breedlove', 'Brenner', 'Bridgeman', 'Brightwell', 'Brinkley', 'Bristol', 'Brockway', 'Brodeur', 'Bromley',
  'Broussard', 'Browning', 'Brunell', 'Buckner', 'Buford', 'Bullard', 'Bunting', 'Burchfield', 'Burkhart', 'Burnside', 'Butterfield', 'Byars', 'Cadwell', 'Calhoun', 'Callahan', 'Calloway', 'Camacho', 'Cambridge', 'Canady', 'Cantrell',
  'Capers', 'Cardona', 'Carlisle', 'Carmichael', 'Carrington', 'Carvalho', 'Cashman', 'Castellanos', 'Castleberry', 'Caudill', 'Cavanaugh', 'Chadwick', 'Chamberlain', 'Chandler', 'Chatman', 'Cheatham', 'Chesney', 'Chilton', 'Christenson', 'Clanton',
  'Claridge', 'Clemons', 'Cleveland', 'Clifton', 'Coffey', 'Colbert', 'Coleridge', 'Collier', 'Colston', 'Comeaux', 'Conover', 'Considine', 'Copeland', 'Corbett', 'Cordova', 'Cornish', 'Costello', 'Cottrell', 'Coulter', 'Courtland',
  'Covington', 'Cowart', 'Craddock', 'Crandall', 'Cravens', 'Creighton', 'Crenshaw', 'Crockett', 'Crosby', 'Crowder', 'Culpepper', 'Cumberland', 'Cunningham', 'Curran', 'Cushing', 'Dabney', 'Dalrymple', 'Danforth', 'Darby', 'Darrington',
  'Davenport', 'Deacon', 'Dearborn', 'Delacroix', 'Delgado', 'Demarco', 'Denham', 'Dennison', 'Derringer', 'Devereaux', 'Dewitt', 'Dillard', 'Dinwiddie', 'Doggett', 'Dombrowski', 'Donahue', 'Dorsett', 'Dover', 'Doyle', 'Draper',
  'Driscoll', 'Duckworth', 'Dudley', 'Duffy', 'Dugger', 'Dunbar', 'Dunlap', 'Dupree', 'Durant', 'Dutton', 'Eakins', 'Easley', 'Eastwood', 'Eberhardt', 'Echols', 'Eckert', 'Edmonds', 'Elkins', 'Ellington', 'Ellsworth',
  'Embry', 'Emmons', 'Endicott', 'Engram', 'Ennis', 'Epperson', 'Escobar', 'Esparza', 'Estes', 'Etheridge', 'Everson', 'Ewing', 'Fairchild', 'Falcone', 'Fanning', 'Farley', 'Farnsworth', 'Faulkner', 'Feathers', 'Ferrell',
  'Fielder', 'Finnegan', 'Fitzhugh', 'Flannery', 'Fleetwood', 'Flournoy', 'Fogarty', 'Fontenot', 'Forbes', 'Fordham', 'Forsythe', 'Fortier', 'Foster', 'Fournier', 'Fowler', 'Franco', 'Frazier', 'Freeman', 'Fulcher', 'Furman',
  'Gaddis', 'Gainey', 'Galbraith', 'Gallagher', 'Galloway', 'Gamble', 'Gannon', 'Garber', 'Gardiner', 'Garfield', 'Garrison', 'Gatewood', 'Gatlin', 'Gentry', 'Gerber', 'Gibbons', 'Gilchrist', 'Gillespie', 'Gilmore', 'Girardi',
  'Glover', 'Goddard', 'Godwin', 'Goforth', 'Goldsby', 'Goodwin', 'Gorham', 'Gossett', 'Grafton', 'Granger', 'Grantham', 'Graves', 'Greenwood', 'Gregory', 'Gresham', 'Grier', 'Griffith', 'Grimsley', 'Grissom', 'Guerrero',
  'Guillory', 'Gunderson', 'Guthrie', 'Hackett', 'Hadley', 'Hagerty', 'Halloran', 'Hambrick', 'Hamlin', 'Hammond', 'Hancock', 'Hanley', 'Hannon', 'Hargrove', 'Harkness', 'Harlow', 'Harmon', 'Harrington', 'Hartfield', 'Hartley',
  'Haskins', 'Hasselbeck', 'Hathaway', 'Hawkins', 'Hayward', 'Headley', 'Hearne', 'Heathcote', 'Hedrick', 'Hefner', 'Helms', 'Hemphill', 'Henderson', 'Hendrix', 'Hennessy', 'Hensley', 'Herrera', 'Hewitt', 'Hickman', 'Higginbotham',
  'Hightower', 'Hildreth', 'Hillman', 'Hinojosa', 'Hobbs', 'Hockenberry', 'Hodgins', 'Holbrook', 'Holcomb', 'Holliday', 'Hollins', 'Holloway', 'Holmgren', 'Honeycutt', 'Hopkins', 'Hornsby', 'Horton', 'Houston', 'Hovland', 'Howell',
  'Hubbard', 'Huddleston', 'Hudgins', 'Huffman', 'Humphries', 'Hunnicutt', 'Hurlbert', 'Hutchins', 'Ingersoll', 'Inglis', 'Ingram', 'Ironside', 'Irvine', 'Isbell', 'Ivers', 'Jaconelli', 'Jamison', 'Jarrell', 'Jeffcoat', 'Jennings',
  'Jernigan', 'Jessup', 'Jiminez', 'Johannsen', 'Jolley', 'Jordan', 'Joyner', 'Kaminski', 'Kavanagh', 'Keaton', 'Keegan', 'Kellerman', 'Kemper', 'Kendrick', 'Kenner', 'Kerrigan', 'Kessinger', 'Kettering', 'Kilgore', 'Kimbrough',
  'Kincaid', 'Kingsley', 'Kinsler', 'Kirkpatrick', 'Kittle', 'Knighton', 'Kowalski', 'Kraemer', 'Ladner', 'Lafferty', 'Laird', 'Lamarre', 'Lambert', 'Lancaster', 'Landrum', 'Langford', 'Lanier', 'Larkin', 'Latimer', 'Laughlin',
  'Lavelle', 'Lawrence', 'Leachman', 'Ledbetter', 'Lefebvre', 'Lehmann', 'Leland', 'Lemieux', 'Lennox', 'Leverett', 'Lightfoot', 'Lindgren', 'Linscott', 'Lipscomb', 'Littleton', 'Livingston', 'Lockridge', 'Loflin', 'Lombardo', 'Longstreet',
  'Lovejoy', 'Lowery', 'Lucero', 'Ludlow', 'Lumpkin', 'Lunsford', 'Lyman', 'Lynchburg', 'Mabry', 'MacAllister', 'Macklin', 'Maddox', 'Magnuson', 'Mahaffey', 'Malcolm', 'Mallory', 'Manzano', 'Marbury', 'Marchand', 'Markham',
  'Marlowe', 'Marsden', 'Mashburn', 'Massey', 'Masterson', 'Mathurin', 'Matlock', 'Maxfield', 'Mayfield', 'McAfee', 'McBride', 'McCallum', 'McCarron', 'McCloud', 'McCorkle', 'McCutcheon', 'McFadden', 'McGarry', 'McKinnon', 'McLendon',
  'McNair', 'McQuaid', 'Meacham', 'Medlock', 'Melancon', 'Mendenhall', 'Meriwether', 'Merritt', 'Middleton', 'Milburn', 'Milledge', 'Millsap', 'Minshew', 'Mixon', 'Moffett', 'Monroe', 'Montague', 'Moody', 'Moorehead', 'Moraga',
  'Moreland', 'Morrissey', 'Mortensen', 'Mosley', 'Mulcahy', 'Mulligan', 'Mundy', 'Murchison', 'Murdock', 'Musgrave', 'Nadeau', 'Nagurski', 'Nailor', 'Nance', 'Naughton', 'Needham', 'Nesbitt', 'Newcomb', 'Newkirk', 'Niedermeyer',
  'Nightingale', 'Noland', 'Norcross', 'Northrup', 'Norwood', 'Nunnally', 'Oakley', 'Oberlin', 'Odom', 'Ogletree', 'Okonkwo', 'Oldham', 'Olsen', 'Orlovsky', 'Osgood', 'Osteen', 'Overstreet', 'Owings', 'Paddock', 'Padilla',
  'Paige', 'Palmieri', 'Pankey', 'Parnell', 'Parrish', 'Partridge', 'Patenaude', 'Patton', 'Peebles', 'Pemberton', 'Pendleton', 'Pennington', 'Percival', 'Perkins', 'Perrault', 'Pettigrew', 'Pharaoh', 'Philbin', 'Pickens', 'Pickering',
  'Pilcher', 'Pinkerton', 'Pittman', 'Plunkett', 'Poindexter', 'Polanco', 'Pollard', 'Poole', 'Poplin', 'Portis', 'Poteat', 'Prescott', 'Prewitt', 'Pritchard', 'Prosser', 'Pruitt', 'Puckett', 'Purcell', 'Quarterman', 'Quigley',
  'Quinlan', 'Radcliffe', 'Rainwater', 'Ramsdell', 'Randolph', 'Rankin', 'Ratliff', 'Rawlings', 'Redding', 'Redmond', 'Reeder', 'Renfro', 'Renshaw', 'Revere', 'Reynoso', 'Rhinehart', 'Ricketts', 'Riddick', 'Ridgeway', 'Rigsby',
  'Rinaldi', 'Ripley', 'Rittenhouse', 'Roark', 'Robicheaux', 'Rockwell', 'Roderick', 'Rollins', 'Roper', 'Rosales', 'Rothwell', 'Roundtree', 'Rountree', 'Rousseau', 'Rowland', 'Ruffin', 'Rundgren', 'Rushing', 'Rutherford', 'Sackett',
  'Salisbury', 'Sampson', 'Sanderson', 'Sandoval', 'Sanford', 'Sargent', 'Satterfield', 'Saunders', 'Scarborough', 'Schaeffer', 'Schilling', 'Schuster', 'Scoggins', 'Seabrook', 'Seaver', 'Sedgwick', 'Selleck', 'Sessions', 'Severson', 'Shackleford',
  'Shanahan', 'Sharpe', 'Shelton', 'Shepherd', 'Sheridan', 'Sherrill', 'Shipley', 'Shumate', 'Sinclair', 'Skaggs', 'Slaughter', 'Sledge', 'Sloan', 'Smallwood', 'Smathers', 'Snellings', 'Somerville', 'Sorenson', 'Southall', 'Spearman',
  'Speight', 'Spillane', 'Spurrier', 'Stackhouse', 'Stallworth', 'Stancil', 'Standridge', 'Stanfield', 'Starkey', 'Steadman', 'Stenson', 'Stepney', 'Stillwell', 'Stockton', 'Stoddard', 'Stokely', 'Stonebraker', 'Stovall', 'Strahan', 'Stratton',
  'Stringer', 'Strother', 'Stubblefield', 'Sturdivant', 'Sudduth', 'Sumrall', 'Sutherland', 'Swafford', 'Swearingen', 'Sweeney', 'Swinton', 'Sylvester', 'Tabor', 'Taggart', 'Talley', 'Tanksley', 'Tarver', 'Tatum', 'Teague', 'Tedford',
  'Templeton', 'Terrell', 'Thackeray', 'Thibodeaux', 'Thigpen', 'Thornhill', 'Thurmond', 'Tidwell', 'Tillery', 'Tinsley', 'Tolbert', 'Tomlinson', 'Toomey', 'Torrence', 'Toussaint', 'Trammell', 'Treadwell', 'Trimble', 'Tromblay', 'Truesdale',
  'Tubbs', 'Tuggle', 'Turnbull', 'Tuttle', 'Twombly', 'Underwood', 'Upshaw', 'Urbina', 'Vandiver', 'Vanover', 'Varnado', 'Vaughan', 'Verdun', 'Vickers', 'Villarreal', 'Vinatieri', 'Voorhees', 'Waddell', 'Wadsworth', 'Wagoner',
  'Wakefield', 'Waldron', 'Walkup', 'Wallis', 'Wamsley', 'Wardlow', 'Warfield', 'Warrick', 'Washburn', 'Waterman', 'Watkins', 'Waverly', 'Weatherspoon', 'Weddington', 'Welborn', 'Wellman', 'Wentworth', 'Westbrook', 'Wetherby', 'Whaley',
  'Wheatley', 'Whisenhunt', 'Whitaker', 'Whitfield', 'Whitmore', 'Whitten', 'Wickersham', 'Widener', 'Wiggins', 'Wilburn', 'Wilcoxen', 'Wilhite', 'Wilkerson', 'Willard', 'Willingham', 'Winborne', 'Windham', 'Winfield', 'Wingate', 'Winkler',
  'Winstead', 'Witherspoon', 'Wolcott', 'Womack', 'Woodard', 'Woodson', 'Wooldridge', 'Worthington', 'Wrenn', 'Wyche', 'Yancey', 'Yarborough', 'Yeager', 'Yoakum', 'Youngblood', 'Zabel', 'Zeigler', 'Zimmerman', 'Zuniga', 'Zweig',
];

export const NAME_COMBINATIONS = FIRST_NAMES.length * LAST_NAMES.length;
