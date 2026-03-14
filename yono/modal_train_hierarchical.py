"""
YONO Hierarchical Classifier Training on Modal (v2)

Decomposes the make classifier into a 2-tier decision tree:
  Tier 1: Make family (8 classes: american, german, british, etc.)
  Tier 2: Specific make within each family (20-40 classes each)

Each tier is a separate EfficientNet-B2 (260x260), trained on A100.
Images are pre-cached to Modal volume — zero HTTP during training.

Usage:
  modal run yono/modal_train_hierarchical.py --action cache-images       # pre-download images
  modal run yono/modal_train_hierarchical.py --action train-all          # train all tiers
  modal run yono/modal_train_hierarchical.py --action train-tier1        # family only
  modal run yono/modal_train_hierarchical.py --action train-tier2        # per-family only
  modal run yono/modal_train_hierarchical.py --action train-tier2 --family american
  modal run yono/modal_train_hierarchical.py --action export             # ONNX export
  modal run yono/modal_train_hierarchical.py --action list               # list runs
  modal run yono/modal_train_hierarchical.py --action train-all --limit 982000 --detach
"""

import modal
import os

app = modal.App("yono-hierarchical-train")

# GPU image: training + export
gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "torch",
        "torchvision",
        "timm",
        "pillow",
        "tqdm",
        "numpy",
        "onnx",
        "onnxruntime",
    ])
)

# CPU image: image caching (needs aiohttp, not torch)
cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install([
        "aiohttp",
        "pillow",
        "tqdm",
    ])
)

volume = modal.Volume.from_name("yono-data", create_if_missing=True)

# ──────────────────────────────────────────────
# Make Family Taxonomy
# ──────────────────────────────────────────────

MAKE_FAMILIES = {
    "american": [
        "Chevrolet", "Ford", "Dodge", "Plymouth", "Pontiac", "Buick",
        "Cadillac", "Oldsmobile", "Lincoln", "Mercury", "GMC", "Jeep",
        "Chrysler", "AMC", "Hudson", "Studebaker", "Packard", "Willys",
        "DeSoto", "Nash", "Kaiser", "Frazer", "Edsel", "Imperial",
        "International", "Checker", "Shelby", "Saleen", "De Tomaso",
        "Vector", "Mosler", "SSC", "Karma", "Rivian", "Tesla",
        "Lucid", "Fisker", "DeLorean", "Excalibur", "Avanti", "Stutz",
        "Rambler", "Crosley", "Bricklin", "Cord", "Auburn", "Duesenberg",
        "Locomobile", "Pierce-Arrow", "Graham", "Hupmobile", "REO",
        "Essex", "Terraplane", "Peerless", "Franklin", "Marmon",
        "Cunningham", "LaSalle", "Whippet", "Durant", "Stanley",
        "Overland", "Autocar", "Divco", "AM General",
    ],
    "german": [
        "BMW", "Mercedes-Benz", "Volkswagen", "Porsche", "Audi",
        "Opel", "Maybach", "Smart", "Borgward", "DKW", "NSU",
        "Alpina", "Ruf", "Messerschmitt", "Goggomobil", "Isetta",
        "Wiesmann", "Gumpert", "Artega", "Koenigsegg",
    ],
    "british": [
        "Jaguar", "MG", "Austin-Healey", "Triumph", "Rolls-Royce", "Bentley",
        "Aston Martin", "Land Rover", "Morgan", "TVR", "Lotus",
        "Caterham", "Bristol", "Daimler", "Sunbeam", "Riley", "Humber",
        "Singer", "Austin", "Morris", "Rover", "Vauxhall", "Hillman",
        "Wolseley", "Standard", "AC", "Alvis", "Armstrong Siddeley",
        "Jensen", "McLaren", "Noble", "Allard", "Healey", "Lagonda",
        "Lister", "Radical", "Elva", "Ginetta", "Marcos", "Reliant",
        "Swallow", "Turner", "Gordon-Keeble", "Arnolt-Bristol",
        "Jensen-Healey", "Panther",
    ],
    "japanese": [
        "Toyota", "Honda", "Mazda", "Nissan", "Datsun", "Subaru",
        "Mitsubishi", "Isuzu", "Suzuki", "Lexus", "Acura", "Infiniti",
        "Scion", "Daihatsu", "Autozam",
    ],
    "italian": [
        "Ferrari", "Lamborghini", "Alfa Romeo", "Maserati", "Fiat",
        "Lancia", "Autobianchi", "Innocenti", "ISO", "Bizzarrini",
        "De Tomaso", "Ghia", "Pagani", "Abarth",
    ],
    "french": [
        "Citroen", "Peugeot", "Renault", "Bugatti", "Talbot",
        "Simca", "Facel Vega", "Panhard", "Delage", "Delahaye",
        "Talbot-Lago", "Alpine",
    ],
    "swedish": [
        "Volvo", "Saab", "Koenigsegg",
    ],
    "korean": [
        "Hyundai", "Kia", "Genesis",
    ],
    "other": [],  # catch-all
}

# Reverse mapping: make -> family
_MAKE_TO_FAMILY = {}
for _fam, _makes in MAKE_FAMILIES.items():
    for _m in _makes:
        _MAKE_TO_FAMILY[_m.lower()] = _fam

FAMILY_NAMES = list(MAKE_FAMILIES.keys())


# ──────────────────────────────────────────────
# Make Aliases (~200 entries)
# Maps variant spellings, abbreviations, case issues, and sub-brands
# to their canonical make name.
# ──────────────────────────────────────────────

MAKE_ALIASES = {
    # Case variants
    "bmw": "BMW", "Bmw": "BMW", "Bwm": "BMW",
    "mg": "MG", "Mg": "MG", "Mga": "MG", "Mgb": "MG",
    "gmc": "GMC", "Gmc": "GMC",
    "tvr": "TVR", "Tvr": "TVR",
    "ac": "AC", "Ac": "AC",
    "dkw": "DKW", "nsu": "NSU",
    "iso": "ISO", "Iso": "ISO",
    "ssc": "SSC", "Ssc": "SSC",
    "amg": "Mercedes-Benz",

    # Mercedes variants (66K+ images when combined)
    "mercedes": "Mercedes-Benz",
    "Mercedes": "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    "Mercedes-benz": "Mercedes-Benz",
    "Mercedes-AMG": "Mercedes-Benz",
    "mercedes-amg": "Mercedes-Benz",
    "Mercedez": "Mercedes-Benz",
    "Mercedes-Benz 300 SL": "Mercedes-Benz",

    # BMW sub-brands
    "BMW M": "BMW",
    "BMW Alpina": "BMW",
    "bmw": "BMW",
    "Alpina": "BMW",

    # Rolls-Royce variants
    "rolls royce": "Rolls-Royce",
    "Rolls": "Rolls-Royce",
    "rolls": "Rolls-Royce",
    "ROLLS": "Rolls-Royce",

    # Land Rover / Range Rover
    "range rover": "Land Rover",
    "Range Rover": "Land Rover",
    "Range": "Land Rover",
    "range": "Land Rover",
    "land": "Land Rover",
    "Land": "Land Rover",

    # Alfa Romeo
    "alfa": "Alfa Romeo",
    "Alfa": "Alfa Romeo",
    "alfa romeo": "Alfa Romeo",

    # Volkswagen
    "vw": "Volkswagen",
    "Vw": "Volkswagen",
    "VW": "Volkswagen",
    "volkswagen": "Volkswagen",
    "Volkwagen": "Volkswagen",
    "1641 cc Volkswagen": "Volkswagen",

    # Chevrolet
    "chevy": "Chevrolet",
    "Chevy": "Chevrolet",
    "chev": "Chevrolet",
    "chevrolet": "Chevrolet",
    "Chevrolet Camaro": "Chevrolet",
    "Chevrolet Chevelle": "Chevrolet",
    "Chevrolet Corvette": "Chevrolet",
    "Chevrolet Bel Air": "Chevrolet",
    "Chevrolet 327 Turbo Fire": "Chevrolet",
    "Z28 Camaro": "Chevrolet",
    "396 427 COPO Camaro": "Chevrolet",
    "COPO Camaro": "Chevrolet",
    "Camaro": "Chevrolet",
    "Corvette": "Chevrolet",

    # Ford
    "Ford/shelby": "Ford",
    "ford": "Ford",
    "Ford V8": "Ford",
    "Ford V8 Rolling": "Ford",
    "Ford V8 Deuce": "Ford",
    "Ford Flathead V8": "Ford",
    "Mustang": "Ford",
    "Bronco": "Ford",

    # Dodge
    "dodge": "Dodge",
    "Dodge Challenger": "Dodge",
    "Viper": "Dodge",

    # Pontiac
    "pontiac": "Pontiac",

    # Buick
    "buick": "Buick",

    # Cadillac
    "cadillac": "Cadillac",
    "Cadilac": "Cadillac",

    # Lincoln
    "lincoln": "Lincoln",

    # Mercury
    "mercury": "Mercury",

    # Oldsmobile
    "oldsmobile": "Oldsmobile",

    # Plymouth
    "plymouth": "Plymouth",

    # Chrysler
    "chrysler": "Chrysler",

    # Toyota / Lexus / Scion
    "toyota": "Toyota",
    "Lexus": "Lexus",
    "LEXUS": "Lexus",
    "Scion": "Scion",
    "scion": "Scion",

    # Honda / Acura
    "honda": "Honda",
    "Acura": "Acura",
    "acura": "Acura",

    # Nissan / Datsun / Infiniti
    "nissan": "Nissan",
    "datsun": "Datsun",
    "Datsun": "Datsun",  # Keep Datsun separate (collector accuracy)
    "Infiniti": "Infiniti",
    "INFINITI": "Infiniti",
    "Infinity": "Infiniti",
    "infiniti": "Infiniti",

    # Mazda
    "mazda": "Mazda",

    # Subaru
    "subaru": "Subaru",

    # Mitsubishi
    "mitsubishi": "Mitsubishi",

    # Isuzu
    "isuzu": "Isuzu",

    # Suzuki
    "suzuki": "Suzuki",

    # Jaguar
    "jaguar": "Jaguar",

    # MG variants
    "MGA": "MG",
    "MGB": "MG",
    "mg": "MG",
    "mgb": "MG",

    # Austin-Healey
    "austin healey": "Austin-Healey",
    "Austin Healey": "Austin-Healey",
    "austin-healey": "Austin-Healey",

    # Aston Martin
    "aston": "Aston Martin",
    "Aston": "Aston Martin",
    "aston martin": "Aston Martin",

    # Ferrari
    "ferrari": "Ferrari",

    # Lamborghini
    "lamborghini": "Lamborghini",

    # Maserati
    "maserati": "Maserati",

    # Fiat
    "fiat": "Fiat",
    "Fiat-Abarth": "Fiat",

    # Porsche
    "porsche": "Porsche",

    # Audi
    "audi": "Audi",

    # Volvo
    "volvo": "Volvo",

    # Saab
    "saab": "Saab",

    # Citroen
    "Citroën": "Citroen",
    "citroën": "Citroen",
    "CITROEN": "Citroen",
    "citroen": "Citroen",

    # Peugeot
    "peugeot": "Peugeot",

    # Renault
    "renault": "Renault",

    # Bugatti
    "bugatti": "Bugatti",

    # De Tomaso
    "de tomaso": "De Tomaso",
    "De": "De Tomaso",
    "de": "De Tomaso",
    "detomaso": "De Tomaso",
    "Shelby/DeTomaso": "De Tomaso",

    # DeLorean
    "Delorean": "DeLorean",
    "delorean": "DeLorean",
    "DeLorean": "DeLorean",

    # Triumph
    "triumph": "Triumph",

    # Lotus
    "lotus": "Lotus",

    # Sunbeam
    "sunbeam": "Sunbeam",

    # Riley
    "riley": "Riley",

    # Humber
    "humber": "Humber",

    # Singer
    "singer": "Singer",

    # Morgan
    "morgan": "Morgan",

    # Bentley
    "bentley": "Bentley",

    # Lancia
    "lancia": "Lancia",

    # Opel
    "opel": "Opel",

    # Bristol
    "bristol": "Bristol",

    # Daimler
    "daimler": "Daimler",

    # Jensen
    "jensen": "Jensen",
    "Jensen-Healey": "Jensen",

    # AMC / Rambler
    "amc": "AMC",
    "AM": "AMC",
    "Am": "AMC",
    "Rambler": "AMC",

    # Hudson
    "hudson": "Hudson",

    # Studebaker
    "studebaker": "Studebaker",

    # Packard
    "packard": "Packard",

    # Willys
    "willys": "Willys",
    "Willys-Overland": "Willys",

    # Nash
    "Nash-Healey": "Nash",

    # DeSoto
    "DeSoto": "DeSoto",
    "desoto": "DeSoto",

    # Kaiser / Frazer
    "Kaiser-Frazer": "Kaiser",
    "Frazer": "Frazer",
    "frazer": "Frazer",

    # International
    "International Harvester": "International",
    "international": "International",

    # Shelby (keep separate from Ford — distinct collector make)
    "shelby": "Shelby",

    # REO
    "Reo": "REO",
    "reo": "REO",

    # Pierce-Arrow
    "Pierce-arrow": "Pierce-Arrow",
    "Pierce": "Pierce-Arrow",

    # Allard
    "allard": "Allard",

    # Talbot-Lago
    "Talbot-lago": "Talbot-Lago",
    "talbot": "Talbot-Lago",

    # Autobianchi
    "autobianchi": "Autobianchi",

    # Innocenti
    "innocenti": "Innocenti",

    # Lagonda
    "lagonda": "Lagonda",

    # Delahaye
    "delahaye": "Delahaye",

    # DKW
    "Dkw": "DKW",

    # Abarth
    "Abarth": "Abarth",
    "abarth": "Abarth",

    # Pagani
    "pagani": "Pagani",

    # Panhard
    "panhard": "Panhard",

    # Smart
    "smart": "Smart",

    # Koenigsegg
    "koenigsegg": "Koenigsegg",

    # Geo (GM sub-brand)
    "Geo": "Chevrolet",

    # Hyundai
    "hyundai": "Hyundai",

    # Checker
    "Checker": "Checker",
    "checker": "Checker",

    # Iso Rivolta
    "IsoRivolta": "ISO",

    # Dual-Ghia
    "Dual-Ghia": "Dual-Ghia",
    "Dual": "Dual-Ghia",

    # Meyers Manx
    "Meyers Manx": "Meyers",
    "Meyers": "Meyers",

    # Bizzarrini
    "bizzarrini": "Bizzarrini",

    # Caterham
    "caterham": "Caterham",

    # Intermeccanica
    "Intermeccanica": "Intermeccanica",

    # Callaway
    "Callaway": "Chevrolet",

    # Saleen
    "Saleen": "Saleen",

    # Clenet
    "Clenet": "Clenet",

    # Arnolt-Bristol
    "Arnolt-Bristol": "Arnolt-Bristol",
    "Arnolt": "Arnolt-Bristol",

    # Pinzgauer (Austrian, but "other" is fine)
    "Pinzgauer": "Pinzgauer",

    # Steyr-Puch
    "Steyr-Puch": "Steyr-Puch",
    "steyr-puch": "Steyr-Puch",

    # Case variants caught in data audit
    "Amc": "AMC",
    "Mclaren": "McLaren",
    "Desoto": "DeSoto",
    "Am General": "AM General",
    "am general": "AM General",
    "Lasalle": "LaSalle",
    "lasalle": "LaSalle",
    "Graham-Paige": "Graham",
    "graham-paige": "Graham",
    "Dodge Brothers": "Dodge",
    "dodge brothers": "Dodge",
    "Ram": "Dodge",  # Ram is Dodge's truck brand
    "ram": "Dodge",
    "Hummer": "GMC",  # GM brand
    "hummer": "GMC",
    "Willys Overland": "Willys",
    "Overland": "Willys",
    "overland": "Willys",
    "Jeepster": "Willys",
    "jeepster": "Willys",
    "Meyers Manx": "Meyers",
    "meyers manx": "Meyers",
    "American": "AMC",  # American Motors
}

# ──────────────────────────────────────────────
# Excluded makes — not cars/trucks
# Motorcycles, boats, memorabilia, sign collectibles,
# pinball machines, pedal cars, go-karts, slot machines,
# and junk/garbage parse artifacts.
# ──────────────────────────────────────────────

EXCLUDED_MAKES = {
    # Motorcycles
    "Harley-Davidson", "Harley", "Ducati", "Kawasaki", "Yamaha",
    "Honda Motorcycle", "Triumph Motorcycle", "Indian", "Norton",
    "BSA", "Moto Guzzi", "Aprilia", "KTM", "Husqvarna",
    "MV Agusta", "Benelli", "Bimota", "Laverda", "Velocette",
    "Vincent", "AJS", "Matchless", "Ariel", "Excelsior",
    "Henderson", "Scott", "Douglas", "Gilera", "Montesa",
    "Bultaco", "Maico", "Puch", "Zundapp", "Motobecane",
    "Boss Hoss", "Big Dog", "Victory", "Vespa", "Lambretta",
    "Can-Am", "Can Am", "Ural", "Royal Enfield",
    "harley-davidson", "kawasaki", "yamaha", "suzuki",
    "ducati", "indian", "norton", "bsa", "mv", "vincent",
    "velocette", "ariel", "excelsior", "benelli", "bimota",
    "laverda", "bultaco", "montesa", "maico", "motobécane",
    "moto", "Moto", "aermacchi", "royal", "greeves",
    "brockhouse", "james", "James", "scott", "parilla",
    "garelli", "sertum", "nsu", "fn", "otas", "mi-val",
    "francis-barnett", "Francis-Barnett", "raleigh",
    "egli-vincent", "Egli-Vincent", "cyc-auto", "rickman",
    "beamish", "jonghi", "terrot", "pilain", "bown",
    "montgomery-jap", "sarolea", "rex-acme", "zenith-jap",
    "swift", "wanderer", "tilling-stevens", "laurin",
    "corgi", "ansaldo", "madami", "fergat", "pettenella",
    "brough", "Brough", "douglas", "matchless", "Ridley",
    "Moto", "Ktm", "Bsa", "MV", "Whizzer", "Batavus",

    # Boats
    "Chris-Craft", "Chris-craft", "Chris", "Chriscraft",
    "Donzi", "Gar Wood", "Garwood", "Hacker Craft",
    "Sea", "Greavette",

    # Memorabilia / Signs / Collectibles (BaT sells these)
    "Texaco", "Gulf", "Shell", "Esso", "Mobil",
    "Sinclair", "Phillips 66", "Pennzoil", "Quaker State",
    "Goodyear Tires", "Firestone", "Kelly Tires", "Dunlop Tires",
    "U.S. Tires", "U.S. Royal Tires",
    "Coca-Cola", "Coca", "7Up", "7up", "Orange Crush",
    "Amalie", "Amalie Motor Oil", "Texaco Motor Oil",
    "Sinclair H-C Gasoline", "Skelly", "Polly Gas",
    "Gulflube", "Gulf Wayne", "Mobil Flying Horse",
    "Blatz Beer", "Budweiser",
    "Pennzoil", "Wolfs Head", "Indian Gas",
    "Mobilgas Tokheim", "Polly Gas Tokheim", "Skelly Tokheim",
    "Sterling Tokheim", "Sinclair Credit", "Pure National",
    "Texaco Sky Chief", "Fry Mae West",
    "Indian Silver Arrow",

    # Pinball / Arcade / Slot machines
    "Bally", "Bally Safari", "Bally Midway", "Gottlieb",
    "Williams 8 Ball", "Williams Blue Chip",
    "Rock-Ola", "Rock-Ola Master", "Wurlitzer",
    "Bank Shot", "Corvette Bally", "Playboy Bally",
    "Ship Ahoy", "Gyruss Centuri",

    # Pedal cars / toy cars / model cars
    "Steelcraft", "Steelcraft Lincoln", "Garton",
    "Garton Kidillac", "Garton Dragnet", "Murray",
    "Murray Torpedo", "Gendron Skippy", "Baby Campbell",
    "Lusse Auto", "Chevy Murray",
    "Little Car Company", "Little", "Regal Roadster",

    # Go-karts
    "Rupp", "Rupp Chaparral", "Rupp Super K Go-Kart",

    # Outboard motors
    "Evinrude", "Evinrude Fisherman", "Evinrude Sport Twin",
    "Evinrude Model 1502", "McCulloch R-1", "Elto Special",
    "Caille", "Caille Redhead", "Caille Pennant",
    "Caille 5-speed", "Caille Neptune", "Caille Liberty Drive",
    "Caille Model 79", "Super Elto", "Lockwood-Ash",
    "Weedless Fisherman", "Fisherman", "Water Sprite",
    "Neptune", "Johnson",

    # Farm equipment
    "John Deere", "Farmall", "Allis Chalmers", "Case",
    "Massey-harris", "Hart Parr", "David Bradley",

    # Trucks / Commercial (not collector cars)
    "Peterbilt", "Kenworth", "Freightliner", "Mack",
    "Thomas Freightliner",

    # RVs / Trailers
    "Winnebago", "Airstream", "Prevost", "Holiday Rambler",
    "Tiffin", "Coachman", "Featherlite", "Trailex",
    "Wells Cargo", "Bonanza", "Serro Scotty",

    # Golf carts
    "Club Car", "Ez-Go",

    # NASCAR collectibles
    "Dale Earnhardt Sr", "Dale Earnhardt Jr", "Dale Jarrett",
    "Tony Stewart", "Kevin Harvick", "Mark Martin",
    "Michael Waltrip", "Clint Bowyer", "Jeff Gordon",
    "Tony Sikorski", "Dave Snyder", "TV Tommy Ivo",
    "Darrell Gwynn",

    # Musical instruments (BaT sells these too)
    "Fender", "Epiphone", "Gibson",

    # Junk / garbage parse artifacts
    ".5", "and", "No", "Classic", "Factory", "Electric",
    "Unknown", "Unassigned", "Special", "Original", "Racing",
    "Assembled", "Vintage", "Custom", "Homemade", "Replica",
    "Kit", "Other", "N/A", "None", "Tbd", "Test",
    "General", "National", "Local", "Continental",
    "Junior", "Junior Classic", "Silver", "Twin", "F1",
    "Special Construction", "Contemporary Classic",
    "Classic II", "Contemporary Classic Cars",
    "Vintage Motor Co.", "Vintage Motorcars",
    "Ultimate Toys", "Timeless Motor Company",

    # Mileage artifacts (mis-parsed titles like "20k-Mile 2005 BMW")
    "20k-Mile", "32k-Mile", "44k-Mile", "87-Mile", "4,700-Mile",
    "37-Years-Owned",

    # Year artifacts
    "2008", "/1955", "–2005",
    "1953 Ferrari", "1967 Chevrolet", "1962 Chevrolet",
    "1964 Ford Fairlane", "1970 Oldsmobile 442",
    "1971 7up Flange Tin", "1972 Corvette", "1961 Corvette",
    "1960 Valvoline Motor", "1960 Valvoline", "1974 Wolfs Head",
    "1954 Coca Cola", "1963 Texaco", "1957 Fiat Service",
    "1954 Exide Batteries", "1992 King K", "1990 Continental",
    "2016 Sinclair Dino", "1962 Mccord Radiator",
    "1953 Coca Cola Kit", "1950s Coca Cola",

    # Model/trim artifacts (mis-parsed as make)
    # NOTE: Corvette, Camaro, Viper, Mustang, Bronco are in MAKE_ALIASES
    # mapping to their parent make, so they're handled there, not excluded.
    "Cobra", "Stingray",
    "Vanquish", "Testarossa", "Gullwing",
    "Phantom", "V12", "575m", "Sf90", "G500", "Sl",
    "Boss", "Malibu", "Blazer", "Blazer Deluxe",
    "Corvette 327", "Camaro L72", "Camaro Grille",
    "Chevron B29", "Chevy 396 427", "Chevy 427 L88",
    "Chevy 427 Big Block", "396 427 COPO",
    "Mopar 383", "383", "427", "Targa",
    "Chevy Rear End", "Autolite Spark Plug",
    "Camaro and Nova", "Camaro Driver",
    "Camaro Driver And", "Ford Dealership",

    # Engine/parts (mis-parsed)
    "Muncie", "Muncie M22", "396 Engine with",

    # Racing collectibles
    "F Racer", "F-racer", "F1-L Junior Racer",
    "Kar Kraft", "Roadster", "Pace",
    "Ferrari Racing", "Ferrari 250 Testarossa",

    # Military vehicles
    "FV432", "FV433", "M5A1", "Panzer", "Sherman",

    # Misc non-vehicles
    "Schwinn", "Schwinn Cotton", "Schwinn Lemon Peeler Krate",
    "Schwinn Cycle-Truck", "Schwinn Bike",
    "Tokheim Gas", "Cretors", "Cookman", "Weinberger",
    "General Electric", "MTD", "AMF",
    "Txt", "DNA", "OTTO", "Atc", "Cav", "Slr", "Rcr",
    "Spcon", "Schutt", "LMK", "Cmc", "VRC", "RCON",
    "TUT", "K-1", "CLCC", "Aspt", "Asve",
    "EXOMOTIVE", "Indy Pace Car",
    "Chicago Bears", "American Express", "American Eagle",
    "Exile", "Snowberger", "Vesco Racing",
    "Intech", "Jimglow", "Motoped",
    "Fat Truck", "Oreion",
    "batmobile", "Penske",
    "FLEETWOOD", "SPEED",

    # Featherweight / miscategorized
    "Featherweight", "Feather", "Light",
    "Waterloo", "Piper", "Ohio", "Cleveland",
    "Century", "Miller", "Monarch", "Champion",
    "Midget", "King Midget", "King",
    "Baker", "Eagle", "Globe", "Spartan",
    "Titan", "Trailer",
    "Sears", "sears", "Bliss",
    "Dyno Mooneyes", "Brouhard Design",
    "Montante Cicli", "Kindig",
    "Stillwater", "Maxton", "Gaslight",
    "Icon", "Exile", "Vibe",
    "Hacker-Huskins", "Triking",

    # Handle lowercase variants of excluded
    "mini", "mini-cooper",  # ambiguous without "MINI" brand context

    # Additional junk caught in data audit
    "Coca Cola", "Coca-cola",
    "Z28 Camaro and COPO", "Chevy 396 427",
    "Schwinn Sting Ray", "Schwinn Stingray",
    "Rally", "Futura", "Sterling", "White",
    "De",  # partial parse of "De Tomaso"
    "Junior", "Junior Classic",
    "F1", "Aspt", "Asve", "Atc", "Cav", "Slr", "OTTO",
    "DNA", "Sertum", "Rumi", "Brockhouse",
    "TV Tommy Ivo", "Tony Sikorski", "Vesco Racing",
    "James", "Kar Kraft", "Sears",
    "Hiawatha", "Thor", "Roger Beck", "Hugh Saint",
    "Watson", "Charleston", "Bocar", "Kirkham",
    "Kurtis Kraft", "Contemporary Classic",
    "Classic Motor Carriages", "Little Car Company",
    "Schuppan-Porsche", "Spitzer", "Runge",
    "Taylor-Dunn", "Camaro Grille",
    "Massey-Harris", "Cretors", "Firestone", "Skelly",
    "Evinrude Fisherman", "Featherlite",
    "Wells Cargo", "Bonanza",
    "Diamond", "Diamond T",  # trucks, not cars
    "Royal",  # Royal Enfield motorcycles
    "Isotta",  # usually "Isotta Fraschini" — too fragmented
    "Polaris",  # ATVs/snowmobiles
    "Cushman",  # scooters/utility vehicles
    "Icon",  # aftermarket builder, not a make
    "Backdraft",  # kit car builder
    "Superformance",  # kit car builder
    "Factory Five",  # kit car builder
    "Scion",  # already aliased to Toyota but keeping separate
    "Eagle",  # too ambiguous
    "Spartan",  # various uses
    "Titan",  # too ambiguous
    "Baker",  # too ambiguous
    "Munsters",  # TV show car
    "Ligier",  # rare French microcar
    "Silver",  # partial parse
    "Kellis on",  # kit car
    "Kellison",  # kit car
    "Champion",  # too ambiguous
    "Zimmer",  # neo-classic kit car
    "Jeepster",  # should be Willys/Kaiser-Jeep
    "Bantam",  # American Bantam - too rare
    "Ruxton",  # too rare
    "Hupmobile",  # too rare for reliable training
    "Francis-Barnett",  # motorcycle
    "Brough",  # motorcycle
    "Sears",  # department store brand
}


# Build lowercase lookup tables at module level for O(1) matching
_ALIASES_LOWER = {k.lower(): v for k, v in MAKE_ALIASES.items()}
_EXCLUDED_LOWER = {e.lower() for e in EXCLUDED_MAKES}


def normalize_make(make: str) -> str | None:
    """Normalize a make string. Returns None for excluded/junk labels."""
    if not make:
        return None
    make = make.strip()
    if not make or len(make) < 2:
        return None

    lower = make.lower()

    # Check exclusion (case-insensitive)
    if lower in _EXCLUDED_LOWER:
        return None

    # Check exact-case alias first, then lowercase
    if make in MAKE_ALIASES:
        result = MAKE_ALIASES[make]
        if result.lower() in _EXCLUDED_LOWER:
            return None
        return result
    if lower in _ALIASES_LOWER:
        result = _ALIASES_LOWER[lower]
        if result.lower() in _EXCLUDED_LOWER:
            return None
        return result

    # Heuristic: if the make starts with a digit, it's probably a junk parse
    # e.g. "1953 Ferrari", "396 427 COPO"
    if make[0].isdigit():
        return None

    # Heuristic: if make contains a slash or is >25 chars, it's probably junk
    if "/" in make or len(make) > 25:
        return None

    # Standard casing: if all lowercase, title-case it; otherwise keep original
    if not any(c.isupper() for c in make[1:]):
        return make.title()
    return make


def get_family(make: str) -> str:
    """Get the family for a normalized make. Returns 'other' if unknown."""
    if not make:
        return "other"
    return _MAKE_TO_FAMILY.get(make.lower(), "other")


# ──────────────────────────────────────────────
# Image caching (runs on CPU, no GPU)
# ──────────────────────────────────────────────

@app.function(
    image=cpu_image,
    timeout=21600,  # 6h
    volumes={"/data": volume},
    cpu=4,
    memory=8192,
)
def cache_images(batch_start: int = 0, batch_end: int = 999):
    """Pre-download training images to Modal volume for fast disk-based training."""
    import asyncio
    import aiohttp
    import hashlib
    import json
    import os
    from pathlib import Path
    from tqdm import tqdm

    CACHE_DIR = "/data/image_cache"
    DATA_DIR = "/data/training-data/images"
    os.makedirs(CACHE_DIR, exist_ok=True)

    # Load all JSONL files
    jsonl_files = sorted(Path(DATA_DIR).glob("batch_*.jsonl"))
    if not jsonl_files:
        print(f"No JSONL files found in {DATA_DIR}")
        print(f"Upload with: modal volume put yono-data training-data/images/ /training-data/images/")
        return {"cached": 0, "skipped": 0, "failed": 0}

    # Filter to requested batch range
    jsonl_files = [f for f in jsonl_files
                   if batch_start <= int(f.stem.split("_")[1]) <= batch_end]

    print(f"Processing {len(jsonl_files)} batch files (batch_{batch_start:04d} to batch_{batch_end:04d})")

    records = []
    for f in jsonl_files:
        with open(f) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                    url = r.get("image_url", "")
                    make = r.get("make", "")
                    if url and make and normalize_make(make):
                        cache_key = hashlib.md5(url.encode()).hexdigest()
                        cache_path = f"{CACHE_DIR}/{cache_key}.jpg"
                        if not os.path.exists(cache_path):
                            records.append((url, cache_path))
                except Exception:
                    pass

    print(f"Need to download: {len(records):,} images (rest already cached)")

    if not records:
        volume.commit()
        return {"cached": 0, "skipped": 0, "failed": 0}

    cached = 0
    failed = 0

    async def download_one(session, url, path, semaphore):
        nonlocal cached, failed
        async with semaphore:
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status == 200:
                        data = await resp.read()
                        if len(data) > 1000:  # Skip tiny/broken responses
                            with open(path, "wb") as f:
                                f.write(data)
                            cached += 1
                        else:
                            failed += 1
                    else:
                        failed += 1
            except Exception:
                failed += 1

    async def download_all():
        semaphore = asyncio.Semaphore(100)
        connector = aiohttp.TCPConnector(limit=100, force_close=True)
        async with aiohttp.ClientSession(connector=connector) as session:
            # Process in chunks of 10K for progress + volume commits
            chunk_size = 10000
            for i in range(0, len(records), chunk_size):
                chunk = records[i:i + chunk_size]
                tasks = [download_one(session, url, path, semaphore) for url, path in chunk]
                await asyncio.gather(*tasks)
                volume.commit()
                print(f"  Progress: {min(i + chunk_size, len(records)):,}/{len(records):,} "
                      f"(cached={cached:,}, failed={failed:,})")

    asyncio.run(download_all())

    volume.commit()
    print(f"\nDone: cached={cached:,}, failed={failed:,}")
    return {"cached": cached, "skipped": len(records) - cached - failed, "failed": failed}


# ──────────────────────────────────────────────
# Core training function (runs on Modal GPU)
# ──────────────────────────────────────────────

@app.function(
    image=gpu_image,
    gpu="A100",
    timeout=43200,  # 12h
    volumes={"/data": volume},
)
def train_hierarchical(
    limit: int = 982000,
    tier: str = "all",
    family: str = None,
    epochs_tier1: int = 30,
    epochs_tier2: int = 35,
    batch_size: int = 64,
    min_samples: int = 50,
):
    """Train hierarchical classifiers on Modal A100 from cached images."""
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
    from torchvision import transforms
    from PIL import Image
    import timm
    from tqdm import tqdm
    import json
    import hashlib
    import numpy as np
    from datetime import datetime
    from collections import Counter, defaultdict
    from pathlib import Path

    IMG_SIZE = 260  # EfficientNet-B2
    MODEL_NAME = "efficientnet_b2"
    GRAD_ACCUM_STEPS = 4  # Effective batch = 64 * 4 = 256
    WARMUP_EPOCHS = 5
    PEAK_LR = 3e-4
    WEIGHT_DECAY = 1e-2
    EARLY_STOP_PATIENCE = 7

    print("=" * 60)
    print("YONO Hierarchical Training v2 on Modal")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Config: tier={tier}, limit={limit}, family={family}")
    print(f"  model={MODEL_NAME}, img_size={IMG_SIZE}")
    print(f"  epochs_tier1={epochs_tier1}, epochs_tier2={epochs_tier2}")
    print(f"  batch_size={batch_size}, grad_accum={GRAD_ACCUM_STEPS}")
    print(f"  peak_lr={PEAK_LR}, weight_decay={WEIGHT_DECAY}")
    print(f"  warmup={WARMUP_EPOCHS}, early_stop_patience={EARLY_STOP_PATIENCE}")
    print("=" * 60)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name()}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # ── Load data from JSONL (two-pass: count makes, then filter) ──
    CACHE_DIR = "/data/image_cache"
    DATA_DIR = "/data/training-data/images"

    print("\nLoading training data from JSONL...")

    jsonl_files = sorted(Path(DATA_DIR).glob("batch_*.jsonl"))
    if not jsonl_files:
        print(f"ERROR: No JSONL files in {DATA_DIR}")
        print("Upload with: modal volume put yono-data training-data/images/ /training-data/images/")
        return

    # Pass 1: Count normalized makes across all data
    print("  Pass 1: Counting makes...")
    make_counts_raw = Counter()
    skipped_no_make = 0
    total_raw = 0
    for jf in jsonl_files:
        with open(jf) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                    raw_make = r.get("make", "")
                    if not raw_make:
                        continue
                    total_raw += 1
                    make = normalize_make(raw_make)
                    if make is None:
                        skipped_no_make += 1
                    else:
                        make_counts_raw[make] += 1
                except Exception:
                    pass

    # Only keep makes with >= min_samples images (removes long-tail junk)
    valid_makes = {m for m, c in make_counts_raw.items() if c >= min_samples}
    print(f"  {len(make_counts_raw)} unique makes -> {len(valid_makes)} with >= {min_samples} samples")
    print(f"  Excluded {skipped_no_make:,} junk labels from {total_raw:,} total")

    # Pass 2: Build records with cache path validation
    print("  Pass 2: Building dataset with cache validation...")
    all_records = []
    skipped_no_cache = 0
    skipped_rare_make = 0

    for jf in jsonl_files:
        with open(jf) as fh:
            for line in fh:
                if len(all_records) >= limit:
                    break
                try:
                    r = json.loads(line)
                    url = r.get("image_url", "")
                    raw_make = r.get("make", "")
                    if not url or not raw_make:
                        continue

                    make = normalize_make(raw_make)
                    if make is None:
                        continue
                    if make not in valid_makes:
                        skipped_rare_make += 1
                        continue

                    cache_key = hashlib.md5(url.encode()).hexdigest()
                    cache_path = f"{CACHE_DIR}/{cache_key}.jpg"
                    if not os.path.exists(cache_path):
                        skipped_no_cache += 1
                        continue

                    fam = get_family(make)
                    all_records.append({
                        "cache_path": cache_path,
                        "make": make,
                        "family": fam,
                    })
                except Exception:
                    pass
        if len(all_records) >= limit:
            break

    print(f"Loaded: {len(all_records):,} records")
    print(f"Skipped: {skipped_no_make:,} excluded, {skipped_rare_make:,} rare (<{min_samples}), {skipped_no_cache:,} uncached")

    # Stats
    family_counts = Counter(r["family"] for r in all_records)
    make_counts = Counter(r["make"] for r in all_records)
    print(f"\nFamily distribution:")
    for fam, cnt in sorted(family_counts.items(), key=lambda x: -x[1]):
        print(f"  {fam:12s}: {cnt:>8,}")
    print(f"\nUnique makes: {len(make_counts)}")
    print("Top 20 makes:")
    for m, c in make_counts.most_common(20):
        print(f"  {m:20s}: {c:>8,}")

    # ── Setup ──
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = f"/data/hierarchical/{run_id}"
    os.makedirs(output_dir, exist_ok=True)

    IMG_MEAN = [0.485, 0.456, 0.406]
    IMG_STD = [0.229, 0.224, 0.225]

    train_transform = transforms.Compose([
        transforms.RandomResizedCrop(IMG_SIZE, scale=(0.6, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.RandAugment(num_ops=2, magnitude=9),
        transforms.RandomPerspective(distortion_scale=0.15, p=0.3),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
        transforms.RandomGrayscale(p=0.05),
        transforms.ToTensor(),
        transforms.RandomErasing(p=0.2),
        transforms.Normalize(IMG_MEAN, IMG_STD),
    ])

    val_transform = transforms.Compose([
        transforms.Resize(292),  # 260 * 256/224 ≈ 297, round to 292
        transforms.CenterCrop(IMG_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(IMG_MEAN, IMG_STD),
    ])

    class CachedDataset(Dataset):
        """Loads pre-cached images from local SSD. No HTTP. No black images."""
        def __init__(self, records, label_field, label_to_idx, transform):
            self.records = records
            self.label_field = label_field
            self.label_to_idx = label_to_idx
            self.transform = transform

        def __len__(self):
            return len(self.records)

        def __getitem__(self, idx):
            rec = self.records[idx]
            label = self.label_to_idx[rec[self.label_field]]
            try:
                img = Image.open(rec["cache_path"]).convert("RGB")
                if self.transform:
                    img = self.transform(img)
                return img, label
            except Exception:
                # Corrupt file — return next valid item instead of black image
                for offset in range(1, min(100, len(self.records))):
                    next_idx = (idx + offset) % len(self.records)
                    try:
                        next_rec = self.records[next_idx]
                        img = Image.open(next_rec["cache_path"]).convert("RGB")
                        next_label = self.label_to_idx[next_rec[self.label_field]]
                        if self.transform:
                            img = self.transform(img)
                        return img, next_label
                    except Exception:
                        continue
                # Absolute last resort (should never happen with pre-validated cache)
                return torch.zeros(3, IMG_SIZE, IMG_SIZE), label

    def split_stratified(records, label_field, val_frac=0.1, seed=42):
        rng = np.random.default_rng(seed)
        by_class = defaultdict(list)
        for r in records:
            by_class[r[label_field]].append(r)
        train, val = [], []
        for cls_records in by_class.values():
            arr = list(cls_records)
            rng.shuffle(arr)
            n_val = max(1, int(len(arr) * val_frac))
            val.extend(arr[:n_val])
            train.extend(arr[n_val:])
        rng.shuffle(train)
        return train, val

    def make_weighted_sampler(records, label_field, label_to_idx):
        labels = [label_to_idx[r[label_field]] for r in records]
        class_counts = Counter(labels)
        weights = [1.0 / class_counts[l] for l in labels]
        return WeightedRandomSampler(weights, len(weights), replacement=True)

    def train_one_model(name, records, label_field, label_to_idx, epochs, bs):
        """Train a single EfficientNet-B2 classifier with warmup + cosine + early stopping."""
        n_classes = len(label_to_idx)
        print(f"\n{'='*60}")
        print(f"Training: {name} ({MODEL_NAME})")
        print(f"  Classes: {n_classes} | Samples: {len(records):,} | Epochs: {epochs}")
        print(f"  Effective batch: {bs * GRAD_ACCUM_STEPS}")

        train_recs, val_recs = split_stratified(records, label_field)
        print(f"  Train: {len(train_recs):,} | Val: {len(val_recs):,}")

        train_ds = CachedDataset(train_recs, label_field, label_to_idx, train_transform)
        val_ds = CachedDataset(val_recs, label_field, label_to_idx, val_transform)

        sampler = make_weighted_sampler(train_recs, label_field, label_to_idx)
        train_loader = DataLoader(
            train_ds, batch_size=bs, sampler=sampler,
            num_workers=8, pin_memory=True, drop_last=True, prefetch_factor=4,
            persistent_workers=True,
        )
        val_loader = DataLoader(
            val_ds, batch_size=bs * 2, shuffle=False,
            num_workers=4, pin_memory=True, prefetch_factor=2,
            persistent_workers=True,
        )

        model = timm.create_model(MODEL_NAME, pretrained=True, num_classes=n_classes)
        model = model.to(device)

        criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
        optimizer = optim.AdamW(model.parameters(), lr=PEAK_LR, weight_decay=WEIGHT_DECAY)

        # Warmup + Cosine decay scheduler
        def lr_lambda(epoch):
            if epoch < WARMUP_EPOCHS:
                return 0.1 + 0.9 * (epoch / WARMUP_EPOCHS)
            progress = (epoch - WARMUP_EPOCHS) / max(1, epochs - WARMUP_EPOCHS)
            return 0.5 * (1 + np.cos(np.pi * progress))

        scheduler = optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
        scaler = torch.amp.GradScaler()

        best_val_acc = 0.0
        best_ckpt_path = f"{output_dir}/{name}_best.pt"
        history = []
        no_improve_count = 0

        for epoch in range(1, epochs + 1):
            # Train
            model.train()
            train_loss, train_correct, train_total = 0, 0, 0
            optimizer.zero_grad()
            pbar = tqdm(train_loader, desc=f"E{epoch}/{epochs} [train]")

            for step, (imgs, labels) in enumerate(pbar):
                imgs, labels = imgs.to(device, non_blocking=True), labels.to(device, non_blocking=True)
                with torch.amp.autocast(device_type="cuda"):
                    outputs = model(imgs)
                    loss = criterion(outputs, labels) / GRAD_ACCUM_STEPS

                scaler.scale(loss).backward()

                if (step + 1) % GRAD_ACCUM_STEPS == 0:
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                    scaler.step(optimizer)
                    scaler.update()
                    optimizer.zero_grad()

                train_loss += loss.item() * GRAD_ACCUM_STEPS
                _, predicted = outputs.max(1)
                train_correct += predicted.eq(labels).sum().item()
                train_total += len(labels)
                pbar.set_postfix(
                    loss=f"{train_loss/(step+1):.4f}",
                    acc=f"{100.*train_correct/train_total:.1f}%",
                    lr=f"{scheduler.get_last_lr()[0]:.2e}",
                )

            scheduler.step()

            # Validate
            model.eval()
            val_correct, val_total = 0, 0
            with torch.no_grad():
                for imgs, labels in tqdm(val_loader, desc=f"E{epoch}/{epochs} [val]"):
                    imgs, labels = imgs.to(device, non_blocking=True), labels.to(device, non_blocking=True)
                    with torch.amp.autocast(device_type="cuda"):
                        outputs = model(imgs)
                    _, predicted = outputs.max(1)
                    val_correct += predicted.eq(labels).sum().item()
                    val_total += len(labels)

            train_acc = 100.0 * train_correct / max(train_total, 1)
            val_acc = 100.0 * val_correct / max(val_total, 1)
            current_lr = scheduler.get_last_lr()[0]
            print(f"  E{epoch:2d}/{epochs}: train_acc={train_acc:.1f}%  val_acc={val_acc:.1f}%  lr={current_lr:.2e}")

            history.append({"epoch": epoch, "train_acc": train_acc, "val_acc": val_acc, "lr": current_lr})

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                no_improve_count = 0
                torch.save({
                    "epoch": epoch,
                    "model_state_dict": model.state_dict(),
                    "val_acc": val_acc,
                    "label_to_idx": label_to_idx,
                    "n_classes": n_classes,
                    "name": name,
                    "model_name": MODEL_NAME,
                    "img_size": IMG_SIZE,
                }, best_ckpt_path)
                print(f"    -> New best: {val_acc:.1f}%")
            else:
                no_improve_count += 1
                if no_improve_count >= EARLY_STOP_PATIENCE:
                    print(f"    Early stopping: no improvement for {EARLY_STOP_PATIENCE} epochs")
                    break

            # Persist every epoch
            volume.commit()

        print(f"\n  Best val_acc: {best_val_acc:.1f}%")
        return {
            "name": name,
            "val_acc": best_val_acc,
            "n_classes": n_classes,
            "labels": list(label_to_idx.keys()),
            "checkpoint": best_ckpt_path,
            "history": history,
        }

    # ── Train Tier 1: Family classifier ──
    results = []

    if tier in ("all", "tier1"):
        print("\n[TIER 1] Training family classifier...")
        families = sorted(set(r["family"] for r in all_records))
        family_label_to_idx = {f: i for i, f in enumerate(families)}
        r = train_one_model(
            "hier_family", all_records, "family", family_label_to_idx,
            epochs=epochs_tier1, bs=batch_size,
        )
        results.append(r)

    # ── Train Tier 2: Per-family make classifiers ──
    if tier in ("all", "tier2"):
        print("\n[TIER 2] Training per-family make classifiers...")
        families_to_train = [family] if family else FAMILY_NAMES

        for fam in families_to_train:
            fam_records = [r for r in all_records if r["family"] == fam]
            if not fam_records:
                print(f"\nSkipping {fam}: no samples")
                continue

            fam_make_counts = Counter(r["make"] for r in fam_records)
            valid_makes = {m for m, c in fam_make_counts.items() if c >= min_samples}

            if len(valid_makes) < 2:
                print(f"\nSkipping {fam}: <2 makes with >={min_samples} samples")
                for m, c in fam_make_counts.most_common():
                    print(f"  {m}: {c}")
                continue

            fam_filtered = [r for r in fam_records if r["make"] in valid_makes]
            make_label_to_idx = {m: i for i, m in enumerate(sorted(valid_makes))}

            print(f"\n[{fam}] {len(valid_makes)} makes, {len(fam_filtered):,} images")
            for m, c in sorted(fam_make_counts.items(), key=lambda x: -x[1]):
                flag = "+" if m in valid_makes else "-"
                print(f"  {flag} {m}: {c:,}")

            ep = epochs_tier2 if len(fam_filtered) >= 5000 else epochs_tier2 + 5
            r = train_one_model(
                f"hier_{fam}", fam_filtered, "make", make_label_to_idx,
                epochs=ep, bs=batch_size,
            )
            results.append(r)

    # ── Save summary ──
    summary = {
        "run_id": run_id,
        "completed_at": datetime.now().isoformat(),
        "total_records": len(all_records),
        "model_name": MODEL_NAME,
        "img_size": IMG_SIZE,
        "results": results,
    }
    with open(f"{output_dir}/training_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # Save unified label map
    all_labels = {}
    for r in results:
        ckpt = torch.load(r["checkpoint"], map_location="cpu", weights_only=False)
        all_labels[r["name"]] = ckpt["label_to_idx"]
    with open(f"{output_dir}/hier_labels.json", "w") as f:
        json.dump(all_labels, f, indent=2)

    volume.commit()

    print(f"\n{'='*60}")
    print("HIERARCHICAL TRAINING v2 COMPLETE")
    for r in results:
        print(f"  {r['name']:20s}: {r['val_acc']:.1f}% val_acc  ({r['n_classes']} classes)")
    print(f"Output: {output_dir}")
    print(f"{'='*60}")

    return summary


# ──────────────────────────────────────────────
# ONNX export (runs on CPU)
# ──────────────────────────────────────────────

@app.function(
    image=gpu_image,
    timeout=3600,
    volumes={"/data": volume},
)
def export_onnx(run_id: str = None):
    """Export all hierarchical checkpoints to ONNX."""
    import torch
    import timm
    import onnx
    import onnxruntime as ort
    import json
    import glob

    # Find the latest run if not specified
    if not run_id:
        runs = sorted(glob.glob("/data/hierarchical/*/"))
        if not runs:
            print("No hierarchical training runs found.")
            return
        run_dir = runs[-1]
    else:
        run_dir = f"/data/hierarchical/{run_id}"

    if not os.path.exists(run_dir):
        print(f"Run directory not found: {run_dir}")
        return

    print(f"Exporting from: {run_dir}")
    checkpoints = sorted(glob.glob(f"{run_dir}/hier_*_best.pt"))
    if not checkpoints:
        print("No hierarchical checkpoints found.")
        return

    all_labels = {}
    for ckpt_path in checkpoints:
        name = os.path.basename(ckpt_path).replace("_best.pt", "")
        onnx_path = f"{run_dir}/{name}.onnx"

        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        n_classes = ckpt["n_classes"]
        label_to_idx = ckpt["label_to_idx"]

        # Use the model name and img_size from the checkpoint
        model_name = ckpt.get("model_name", "efficientnet_b2")
        img_size = ckpt.get("img_size", 260)

        model = timm.create_model(model_name, pretrained=False, num_classes=n_classes)
        model.load_state_dict(ckpt["model_state_dict"])
        model.eval()

        dummy = torch.randn(1, 3, img_size, img_size)
        torch.onnx.export(
            model, dummy, onnx_path,
            input_names=["image"],
            output_names=["logits"],
            dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=18,
        )

        # Save without external data
        m = onnx.load(onnx_path)
        onnx.save_model(m, onnx_path, save_as_external_data=False)

        # Verify
        sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        out = sess.run(None, {"image": dummy.numpy()})[0]
        size_mb = os.path.getsize(onnx_path) / 1e6

        print(f"  {name}: {size_mb:.1f}MB, {n_classes} classes, val_acc={ckpt['val_acc']:.1f}%")
        all_labels[name] = label_to_idx

    # Save unified label map
    labels_path = f"{run_dir}/hier_labels.json"
    with open(labels_path, "w") as f:
        json.dump(all_labels, f, indent=2)

    volume.commit()
    print(f"\nExported {len(checkpoints)} models. Labels: {labels_path}")
    return {"run_dir": run_dir, "models": len(checkpoints)}


# ──────────────────────────────────────────────
# List runs
# ──────────────────────────────────────────────

@app.function(
    image=gpu_image,
    volumes={"/data": volume},
)
def list_runs():
    """List all hierarchical training runs."""
    import json
    import glob

    runs_dir = "/data/hierarchical"
    if not os.path.exists(runs_dir):
        return []

    runs = []
    for run_dir in sorted(glob.glob(f"{runs_dir}/*/")):
        summary_path = f"{run_dir}training_summary.json"
        if os.path.exists(summary_path):
            with open(summary_path) as f:
                summary = json.load(f)
            runs.append({
                "run_id": summary.get("run_id", os.path.basename(run_dir.rstrip("/"))),
                "total_records": summary.get("total_records", 0),
                "model_name": summary.get("model_name", "efficientnet_b0"),
                "img_size": summary.get("img_size", 224),
                "models": len(summary.get("results", [])),
                "results": [
                    {"name": r["name"], "val_acc": r["val_acc"], "n_classes": r["n_classes"]}
                    for r in summary.get("results", [])
                ],
            })
    return runs


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

@app.local_entrypoint()
def main(
    action: str = "train-all",
    limit: int = 982000,
    tier: str = "all",
    family: str = None,
    epochs_tier1: int = 30,
    epochs_tier2: int = 35,
    batch_size: int = 64,
    min_samples: int = 50,
    run_id: str = None,
    batch_start: int = 0,
    batch_end: int = 999,
):
    """
    YONO Hierarchical Training v2 on Modal

    Actions:
        cache-images  Pre-download images to Modal volume (run first!)
        train-all     Train tier-1 (family) + tier-2 (per-family makes)
        train-tier1   Train only the family classifier
        train-tier2   Train only per-family classifiers (optionally --family <name>)
        export        Export checkpoints to ONNX (optionally --run-id <id>)
        list          List all training runs
    """
    if action == "cache-images":
        print(f"Caching images from batches {batch_start} to {batch_end}...")
        result = cache_images.remote(batch_start=batch_start, batch_end=batch_end)
        print(f"Cache complete: {result}")

    elif action.startswith("train"):
        if action == "train-tier1":
            tier = "tier1"
        elif action == "train-tier2":
            tier = "tier2"
        else:
            tier = "all"

        print(f"Starting hierarchical training v2: tier={tier}, limit={limit}, family={family}")
        result = train_hierarchical.remote(
            limit=limit,
            tier=tier,
            family=family,
            epochs_tier1=epochs_tier1,
            epochs_tier2=epochs_tier2,
            batch_size=batch_size,
            min_samples=min_samples,
        )
        print(f"\nTraining complete!")
        if result and "results" in result:
            for r in result["results"]:
                print(f"  {r['name']:20s}: {r['val_acc']:.1f}%  ({r['n_classes']} classes)")

    elif action == "export":
        result = export_onnx.remote(run_id=run_id)
        print(f"Export complete: {result}")

    elif action == "list":
        runs = list_runs.remote()
        if not runs:
            print("No hierarchical training runs found.")
        else:
            for run in runs:
                print(f"\nRun: {run['run_id']} ({run['total_records']:,} records, {run['model_name']})")
                for r in run["results"]:
                    print(f"  {r['name']:20s}: {r['val_acc']:.1f}%  ({r['n_classes']} classes)")

    else:
        print(f"Unknown action: {action}")
        print("Valid actions: cache-images, train-all, train-tier1, train-tier2, export, list")
