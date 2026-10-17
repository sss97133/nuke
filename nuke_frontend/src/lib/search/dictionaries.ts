export const KNOWN_MAKES: string[] = [
  'Abarth', 'Ace', 'Acura', 'Airstream', 'Alfa Romeo', 'Alvis', 'AM General', 'AMC',
  'American Bantam', 'American Underslung', 'Amilcar', 'Apollo', 'Ariel', 'Arnolt',
  'Arnolt-Bristol', 'Arnolt-Mg', 'Asa', 'Aston Martin', 'Atalanta', 'Auburn', 'Audi',
  'Austin', 'Austin-Healey', 'Autobianchi', 'Autocar', 'Autokraft', 'Autozam', 'Avanti',
  'Avions Voisin', 'Backdraft', 'Baker', 'Beck', 'Benetton', 'Bentley', 'Bimota',
  'Bizzarrini', 'BMW', 'Bocar', 'Brabham', 'Brewster', 'Bricklin', 'Brough Superior',
  'BSA', 'Bugatti', 'Buick', 'Bultaco', 'Cadillac', 'Callaway', 'Caterham', 'Chalmers',
  'Checker', 'Cheetah', 'Chevrolet', 'Chrisman', 'Chrysler', 'Citroen', 'Citroën',
  'Cleveland', 'Confederate', 'Cooper', 'Cord', 'Crane-Simplex', 'Crosley', 'Curtiss',
  'Cushman', 'Daihatsu', 'Daimler', 'Dallara', 'Darracq', 'Datsun', 'De Dion Bouton',
  'De Tomaso', 'Delage', 'Delahaye', 'Delaunay-Belleville', 'DeSoto', 'Detroit Electric',
  'Devin', 'Diamond T', 'Divco', 'Dkw', 'Doble', 'Dodge', 'Dual-Ghia', 'Ducati',
  'Duesenberg', 'Eagle', 'Edsel', 'Elva', 'Era', 'Excalibur', 'Excelsior',
  'Factory Five', 'Ferrari', 'Fiat', 'Fisker', 'Flying Merkel', 'Ford', 'Franklin',
  'Frazer Nash', 'Freightliner', 'Ghia', 'GMC', 'Graham', 'Griffith', 'Harley-Davidson',
  'Healey', 'Henderson', 'Hennessey', 'Hispano-Suiza', 'Honda', 'Horch', 'Hudson',
  'Humber', 'Hummer', 'Husqvarna', 'Hyundai', 'Icon', 'Imperial', 'Indian', 'INEOS',
  'Infiniti', 'Intermeccanica', 'International', 'Invicta', 'Iso', 'Iso Grifo',
  'Isotta Fraschini', 'Isuzu', 'Jaguar', 'Jeep', 'Jensen', 'John Deere', 'Kaiser',
  'Kaiser-Darrin', 'Karma', 'Kawasaki', 'Kenworth', 'Kirkham', 'Kissel', 'Knox',
  'Koenigsegg', 'Ktm', 'Kurtis', 'Kurtis-Kraft', 'Lagonda', 'Lamborghini', 'Lanchester',
  'Lancia', 'Land Rover', 'LaSalle', 'Laverda', 'Lea-Francis', 'Lexus', 'Leyland',
  'Ligier', 'Lincoln', 'Lister', 'Lister-Chevrolet', 'Local', 'Locomobile', 'Lola',
  'Lorraine-Dietrich', 'Lotus', 'Lozier', 'Lucid', 'Mack', 'March', 'Marcos', 'Marmon',
  'Maserati', 'Matra', 'Mauck', 'Maxwell', 'Maybach', 'Mazda', 'McLaren', 'Mercer',
  'Mercedes-Benz', 'Mercedes-Maybach', 'Mercedes-Simplex', 'Mercury', 'Messerschmitt',
  'Meyers', 'MG', 'Miller', 'Minerva', 'Mini', 'Mitchell', 'Mitsubishi', 'Modena',
  'Moke', 'Monteverdi', 'Morgan', 'Morris', 'Mors', 'Mosler', 'Moto Guzzi', 'Muntz',
  'MV Agusta', 'Napier', 'Nash', 'Nash-Healey', 'Nissan', 'Noble', 'Norton', 'Nsu',
  'Oldsmobile', 'Opel', 'Osca', 'Packard', 'Pagani', 'Panhard', 'Panhard Et Levassor',
  'Panhard-Levassor', 'Panoz', 'Peterbilt', 'Peugeot', 'Pierce', 'Pierce-Arrow',
  'Pininfarina', 'Plymouth', 'Polaris', 'Pontiac', 'Pope-Hartford', 'Porsche',
  'Prevost', 'Puch', 'Qvale', 'Radical', 'Ram', 'Rambler', 'Rauch', 'Renault', 'REO',
  'Rezvani', 'Richard-Brasier', 'Riley', 'Rivian', 'Rolls-Royce', 'Rossion', 'Roush',
  'Rover', 'Ruf', 'Runge', 'Rupp', 'Ruxton', 'Saab', 'Saturn', 'Scarab', 'Scion',
  'Sears', 'Shelby', 'Sherp', 'Siata', 'Simca', 'Simplex', 'Singer', 'Smart',
  'Spartan', 'Speedwell', 'Spyker', 'Srt', 'Stanley', 'Stearns', 'Sterling',
  'Stevens-Duryea', 'Steyr', 'Steyr-Puch', 'Stoddard Dayton', 'Studebaker', 'Stutz',
  'Subaru', 'Sunbeam', 'Superformance', 'Superlite', 'Suzuki', 'Swallow', 'Talbot',
  'Talbot-Lago', 'Tatra', 'Tesla', 'Thomas', 'Thomas Flyer', 'Thor', 'Toyota',
  'Triumph', 'Tucker', 'TVR', 'Tyrrell', 'Ultima', 'Vanderhall', 'Vauxhall', 'Vector',
  'Vespa', 'Vincent', 'Volkswagen', 'Volvo', 'Wanderer', 'Watercar', 'Watson',
  'Westfield', 'White', 'Williams', 'Willys', 'Willys-Overland', 'Winnebago', 'Winton',
  'Wolseley', 'Yale', 'Yamaha', 'Zimmer', 'Zundapp'
];

export const MAKE_ALIASES: Record<string, string> = {
  'chevy': 'Chevrolet', 'vw': 'Volkswagen', 'merc': 'Mercedes-Benz',
  'benz': 'Mercedes-Benz', 'mb': 'Mercedes-Benz', 'bmw': 'BMW',
  'alfa': 'Alfa Romeo', 'aston': 'Aston Martin', 'lr': 'Land Rover',
  'landy': 'Land Rover', 'rr': 'Rolls-Royce', 'lambo': 'Lamborghini',
  'jag': 'Jaguar', 'poncho': 'Pontiac', 'olds': 'Oldsmobile',
  'mopar': 'Chrysler',
  'detomaso': 'De Tomaso', 'de tomaso': 'De Tomaso',
  'healey': 'Austin-Healey', 'austin healey': 'Austin-Healey',
  'harley': 'Harley-Davidson', 'harley davidson': 'Harley-Davidson', 'hd': 'Harley-Davidson',
  'ih': 'International', 'international harvester': 'International',
  'citroën': 'Citroën', 'pierce arrow': 'Pierce-Arrow', 'isotta': 'Isotta Fraschini',
  'panhard et levassor': 'Panhard', 'panhard-levassor': 'Panhard',
  'avions-voisin': 'Avions Voisin', 'voisin': 'Avions Voisin',
  'frazer-nash': 'Frazer Nash'
};

export const KNOWN_BODY_STYLES: string[] = [
  'sedan', 'coupe', 'convertible', 'wagon', 'hatchback', 'suv',
  'truck', 'pickup', 'van', 'minivan', 'roadster', 'targa',
  'shooting brake', 'estate', 'cabriolet', 'speedster', 'spider',
  'spyder', 'fastback', 'hardtop', 'softtop', 'limousine'
];

// Maps user-friendly era terms to DB values
// DB allowed: pre-war, post-war, classic, malaise, modern-classic, modern, contemporary
export const KNOWN_ERAS: Record<string, string> = {
  'pre-war': 'pre-war', 'prewar': 'pre-war', 'antique': 'pre-war',
  'post-war': 'post-war', 'postwar': 'post-war',
  'classic': 'classic', 'muscle': 'classic', 'muscle car': 'classic',
  'malaise': 'malaise',
  'modern-classic': 'modern-classic', 'modern classic': 'modern-classic',
  'modern': 'modern', '90s': 'modern-classic', 'nineties': 'modern-classic',
  'contemporary': 'contemporary', '2000s': 'contemporary',
};

export const KNOWN_COLORS: string[] = [
  'red', 'blue', 'green', 'black', 'white', 'silver', 'grey', 'gray',
  'yellow', 'orange', 'brown', 'beige', 'tan', 'gold', 'bronze',
  'burgundy', 'maroon', 'navy', 'cream', 'ivory', 'champagne',
  'purple', 'violet', 'pink', 'copper', 'teal', 'turquoise'
];

export const KNOWN_DOMAINS: string[] = [
  'bringatrailer.com', 'carsandbids.com', 'ebay.com', 'craigslist.org',
  'facebook.com', 'hemmings.com', 'classiccars.com', 'autotrader.com',
  'hagerty.com', 'rmsothebys.com', 'bonhams.com', 'mecum.com',
  'barrett-jackson.com', 'pcarmarket.com', 'collectingcars.com'
];

// Lowercase lookup sets for O(1) matching
export const MAKES_LOWER = new Set(KNOWN_MAKES.map(m => m.toLowerCase()));
export const BODY_STYLES_LOWER = new Set(KNOWN_BODY_STYLES.map(b => b.toLowerCase()));
export const COLORS_LOWER = new Set(KNOWN_COLORS);
