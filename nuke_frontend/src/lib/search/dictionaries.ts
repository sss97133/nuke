export const KNOWN_MAKES: string[] = [
  'Abarth', 'Acura', 'Airstream', 'Alfa Romeo', 'Alvis', 'AM General', 'AMC',
  'American Underslung', 'Ariel', 'Aston Martin', 'Auburn', 'Audi', 'Austin',
  'Austin-Healey', 'Autobianchi', 'Avanti', 'Avions Voisin', 'Backdraft', 'Beck',
  'Bentley', 'Bizzarrini', 'BMW', 'Bricklin', 'Brough Superior', 'Bugatti',
  'Buick', 'Cadillac', 'Caterham', 'Chevrolet', 'Chrysler', 'Citroen', 'Citroën',
  'Cord', 'Crane-Simplex', 'Daimler', 'Datsun', 'De Tomaso', 'Delage', 'Delahaye',
  'DeSoto', 'Diamond T', 'Doble', 'Dodge', 'Dual-Ghia', 'Ducati', 'Duesenberg',
  'Edsel', 'Factory Five', 'Ferrari', 'Fiat', 'Fisker', 'Ford', 'Frazer Nash',
  'Freightliner', 'GMC', 'Harley-Davidson', 'Henderson', 'Hispano-Suiza', 'Honda',
  'Horch', 'Hudson', 'Hummer', 'Hyundai', 'Imperial', 'Indian', 'INEOS', 'Infiniti',
  'Intermeccanica', 'International', 'Invicta', 'Iso', 'Isotta Fraschini', 'Isuzu',
  'Jaguar', 'Jeep', 'Jensen', 'Kaiser', 'Kawasaki', 'Koenigsegg', 'Lagonda',
  'Lamborghini', 'Lancia', 'Land Rover', 'LaSalle', 'Lexus', 'Lincoln', 'Lister',
  'Lister-Chevrolet', 'Locomobile', 'Lola', 'Lotus', 'Lozier', 'Lucid', 'Marmon',
  'Maserati', 'Maybach', 'Mazda', 'McLaren', 'Mercer', 'Mercedes-Benz',
  'Mercedes-Simplex', 'Mercury', 'Messerschmitt', 'Meyers', 'MG', 'Minerva',
  'Mini', 'Mitsubishi', 'Morgan', 'Morris', 'Muntz', 'Nash', 'Nash-Healey',
  'Nissan', 'Noble', 'Oldsmobile', 'Opel', 'Packard', 'Pagani', 'Panhard',
  'Panoz', 'Peugeot', 'Pierce-Arrow', 'Plymouth', 'Pontiac', 'Porsche', 'Qvale',
  'Ram', 'Renault', 'Riley', 'Rivian', 'Rolls-Royce', 'Rossion', 'Ruf', 'Saab',
  'Saturn', 'Shelby', 'Siata', 'Simplex', 'Spyker', 'Stearns', 'Studebaker',
  'Stutz', 'Subaru', 'Sunbeam', 'Superformance', 'Suzuki', 'Talbot', 'Talbot-Lago',
  'Tesla', 'Toyota', 'Triumph', 'Tucker', 'TVR', 'Ultima', 'Vauxhall', 'Vincent',
  'Volkswagen', 'Volvo', 'White', 'Willys', 'Yamaha'
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
