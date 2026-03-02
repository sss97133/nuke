export const KNOWN_MAKES: string[] = [
  'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick',
  'Cadillac', 'Chevrolet', 'Chrysler', 'Datsun', 'De Tomaso', 'Dodge',
  'Ferrari', 'Fiat', 'Ford', 'GMC', 'Honda', 'Hummer', 'Hyundai',
  'Infiniti', 'Jaguar', 'Jeep', 'Lamborghini', 'Land Rover', 'Lexus',
  'Lincoln', 'Lotus', 'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz',
  'Mercury', 'Mini', 'Mitsubishi', 'Nissan', 'Oldsmobile', 'Opel',
  'Peugeot', 'Plymouth', 'Pontiac', 'Porsche', 'Ram', 'Rolls-Royce',
  'Saab', 'Saturn', 'Shelby', 'Subaru', 'Suzuki', 'Tesla', 'Toyota',
  'Triumph', 'Volkswagen', 'Volvo'
];

export const MAKE_ALIASES: Record<string, string> = {
  'chevy': 'Chevrolet', 'vw': 'Volkswagen', 'merc': 'Mercedes-Benz',
  'benz': 'Mercedes-Benz', 'mb': 'Mercedes-Benz', 'bmw': 'BMW',
  'alfa': 'Alfa Romeo', 'aston': 'Aston Martin', 'lr': 'Land Rover',
  'landy': 'Land Rover', 'rr': 'Rolls-Royce', 'lambo': 'Lamborghini',
  'jag': 'Jaguar', 'poncho': 'Pontiac', 'olds': 'Oldsmobile',
  'mopar': 'Chrysler',
  'detomaso': 'De Tomaso', 'de tomaso': 'De Tomaso'
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
