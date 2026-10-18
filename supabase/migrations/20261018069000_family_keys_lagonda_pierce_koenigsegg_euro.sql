-- Slice 16: Key classic European & pre-war coachbuilt marques (Lagonda, Pierce-Arrow, Talbot,
-- Koenigsegg, Isotta Fraschini, Citroën with accented diaeresis, Doble, Siata, Avions Voisin,
-- Frazer Nash, Vauxhall, Lozier, Bizzarrini, Lola, Horch, Maybach SW38, Invicta,
-- American Underslung, Riley, Panhard, Airstream, Minerva, Lister, Abarth, White, Freightliner,
-- Rolls-Royce 20/25, Renault 40 CV, AMC Rambler, Ferrari Daytona SP3, Jaguar SS100) and expand
-- concatenated sub-model aliases across Ferrari, Mercedes-Benz, Porsche, Aston Martin, Bugatti,
-- Maserati, Jaguar, Bentley, Simplex, Peugeot, Alvis, Oldsmobile, Fiat, Harley-Davidson, and Shelby.
--
-- All aliases are strictly 1–3 alphanumeric words so they match mv_model_family_names's 1..4-word
-- n-gram index, and no catch-all Custom/Deluxe/Super family receives multi-word generic body suffixes.

BEGIN;

-- 1. Insert 36 canonical model families where not already present
WITH new_families(id, make, canonical_model, year_start, year_end, aliases) AS (
  VALUES
    ('00000000-0000-4000-f000-000000000241'::uuid, 'Lagonda', 'LG45', 1906, NULL::integer,
      ARRAY['lg45', 'lg45r', 'lg6', 'm45', 'm45r', 'm35', 'm35r', 'rapide', 'rapier', 'taraf', '4 1/2 litre']),
    ('00000000-0000-4000-f000-000000000242'::uuid, 'Lagonda', 'V12', 1930, NULL::integer,
      ARRAY['v12', 'v-12', 'v8']),
    ('00000000-0000-4000-f000-000000000243'::uuid, 'Lagonda', '3-Litre', 1906, NULL::integer,
      ARRAY['3-litre', '3.0-litre', 'three-litre', '2.6-litre', '2.6-liter', '2.6', '2-litre', '16/80', '16/80hp', '14/60', '14/60hp', '11.1hp', 'low chassis', 'tourer']),
    ('00000000-0000-4000-f000-000000000244'::uuid, 'Pierce-Arrow', 'Model 48', 1901, NULL::integer,
      ARRAY['model 48', '48-b', '48b', 'model 48ss', 'model 66', '66', 'model 38', '38', '38-c-4', 'model 36', 'model 33', 'series 33', 'model 31', 'series 51', 'model 51', 'model 80', 'model 81']),
    ('00000000-0000-4000-f000-000000000245'::uuid, 'Pierce-Arrow', 'Twelve', 1928, NULL::integer,
      ARRAY['silver arrow', '1247', '1245', '1240a', 'twelve', 'model 53', 'model 54', '840a', '840-a', '845', '836', '836a', '1601', '1701', '1801', 'model 41', 'model 42', 'model 43', 'model 125', 'model 133', 'model 143', 'model a', 'model b', 'model c']),
    ('00000000-0000-4000-f000-000000000246'::uuid, 'Talbot', 'T26', 1903, NULL::integer,
      ARRAY['lago', 't26', 't150c', 't120', 't23', 't14', 't-15', 'av105', 'av95', 'ba105', 'bg110', 'bg 110', 'bi105', 'bi 105', '105', '110', '75', 'aw75', 'aw 75', 'm-75', 'm67', 'au65', '14/45', '14/45hp', '14hp', '15hp', '6ct', '25/50hp', 'darracq', 'sunbeam lotus', 'matra', 'type ct2k', 'type ct4-0b', 'z 10', 'ten']),
    ('00000000-0000-4000-f000-000000000247'::uuid, 'Koenigsegg', 'Regera', 2000, NULL::integer,
      ARRAY['regera', 'agera', 'cc8s', 'ccx', 'ccxr', 'ccgt', 'jesko', 'gemera', 'one:1']),
    ('00000000-0000-4000-f000-000000000248'::uuid, 'Isotta Fraschini', 'Tipo 8A', 1900, NULL::integer,
      ARRAY['tipo 8a', 'tipo 8as', '8a', 'tipo 8', 'tipo km', 'tipo im', 'tipo pm', 'tipo fenc', 'type fc']),
    ('00000000-0000-4000-f000-000000000249'::uuid, 'Citroën', 'DS', 1955, NULL::integer,
      ARRAY['ds', 'ds21', 'ds 21', 'ds19', 'ds 19', 'ds23', 'ds 23', 'id19', 'id 19', 'id20']),
    ('00000000-0000-4000-f000-000000000250'::uuid, 'Citroën', 'SM', 1970, NULL::integer,
      ARRAY['sm']),
    ('00000000-0000-4000-f000-000000000251'::uuid, 'Citroën', '2CV', 1934, NULL::integer,
      ARRAY['2cv', '2 cv', 'mehari', 'traction avant', '11cv', '15cv', '7cv', 'cx', 'bx', 'xm', 'gs', 'gsa', 'ami', 'dyane', 'hy', 'type h', 'h van', 'c4', 'c6', 'ds3']),
    ('00000000-0000-4000-f000-000000000252'::uuid, 'Doble', 'Series E', 1914, NULL::integer,
      ARRAY['series e', 'series f', 'model e', 'model f']),
    ('00000000-0000-4000-f000-000000000253'::uuid, 'Siata', '208S', 1948, NULL::integer,
      ARRAY['208s', '208 cs', '208', '200cs', '300 bc', '300bc', 'daina', 'gran sport', '750', 'spring', 'amalfi']),
    ('00000000-0000-4000-f000-000000000254'::uuid, 'Avions Voisin', 'C25', 1919, NULL::integer,
      ARRAY['c25', 'c23', 'c24', 'c14', 'c28', 'c30', 'c31', 'c11', 'c7', 'c6', 'c4s', 'c3', 'c1', 'oc1']),
    ('00000000-0000-4000-f000-000000000255'::uuid, 'Frazer Nash', 'Le Mans Replica', 1922, NULL::integer,
      ARRAY['le mans', 'tt replica', 'bmw 328', 'bmw 315', 'bmw 319', 'bmw 335', 'targa florio', 'mille miglia', 'super sports', 'norris special', 'shelsley', 'dkw']),
    ('00000000-0000-4000-f000-000000000256'::uuid, 'Vauxhall', '30-98', 1903, NULL::integer,
      ARRAY['30-98', '30/98', '30-98hp', '30/98hp', '23-60', '23/60hp', 'type od', '25hp', '25/70hp', '20/60', '16/20hp', '14/40', '14/40hp', '14hp', '10/4', '7/9hp', '5hp', 'prince henry', 'velox', 'wensum', 'd-type', 'e-type', 'cresta', 'chevette', 'firenza', 'cavalier', 'calibra', 'carlton', 'victor', 'viva', 'vx', 'wyvern', 'omega', 'envoy', 'cadet']),
    ('00000000-0000-4000-f000-000000000257'::uuid, 'Lozier', 'Type 72', 1905, NULL::integer,
      ARRAY['type 72', 'type h', 'meadowbrook', 'briarcliff']),
    ('00000000-0000-4000-f000-000000000258'::uuid, 'Bizzarrini', '5300 GT', 1964, NULL::integer,
      ARRAY['5300 gt', 'strada', 'p538', 'p708', '128p', 'europa', 'barchetta']),
    ('00000000-0000-4000-f000-000000000259'::uuid, 'Lola', 'T70', 1958, NULL::integer,
      ARRAY['t70', 't90', 't900', 't900s', 't616', 't163', 't-160', 't160', 't700', 't222', 't332', 't330', 't300', 't165', 't162', 't212', 't290', 't292', 't294', 't296', 't298', 't492', 't590', 't592', 't598', 't600', 't640', 'mk1', 'mk2', 'mkii', 'mk3', 'mkiii']),
    ('00000000-0000-4000-f000-000000000260'::uuid, 'Horch', '853', 1904, NULL::integer,
      ARRAY['853', '853a', '851', '830', '780', '930']),
    ('00000000-0000-4000-f000-000000000261'::uuid, 'Maybach', 'SW38', 1921, 1945,
      ARRAY['sw-38', 'sw38', 'sw35', 'sw42', 'ds8', 'ds7', 'zeppelin', 'w5', 'w3']),
    ('00000000-0000-4000-f000-000000000262'::uuid, 'Invicta', '4 1/2 Litre', 1925, NULL::integer,
      ARRAY['4 1/2 litre', '4 1/2 liter', 's-type', 'low chassis', 'high chassis', '12/45', '3-litre', 'black prince']),
    ('00000000-0000-4000-f000-000000000263'::uuid, 'American Underslung', '50 HP', 1906, NULL::integer,
      ARRAY['50hp', '50/60 hp', 'type 56-a', 'model 644', 'model 34a', 'model 22', 'traveler', 'tourist', 'scout', 'roadster']),
    ('00000000-0000-4000-f000-000000000264'::uuid, 'Riley', 'MPH', 1900, NULL::integer,
      ARRAY['mph', 'sprite', 'imp', 'brooklands', 'ulster', '12/4', '9hp', '1 1/2 litre', 'rmc', 'rmd', 'rma', 'rmb', 'rme', 'rmf', 'tt six', 'kestrel', 'elf', 'one-point-five', 'pathfinder', 'adelphi', 'lynx', 'monaco', 'gamecock', 'nine']),
    ('00000000-0000-4000-f000-000000000265'::uuid, 'Panhard', 'Levassor', 1890, NULL::integer,
      ARRAY['levassor', 'et levassor', 'type a', 'type a2', 'type b1', 'model b', 'type m2f', 'dyna', 'pl17', 'pl 17', '24ct', '24bt', 'cd', 'db', 'junior']),
    ('00000000-0000-4000-f000-000000000266'::uuid, 'Airstream', 'Interstate', 1931, NULL::integer,
      ARRAY['interstate', 'atlas', 'flying cloud', 'classic', 'international', 'bambi', 'caravel', 'globetrotter', 'safari', 'sovereign', 'overlander', 'ambassador', 'excella', 'trade wind', 'land yacht', 'basecamp', 'nest']),
    ('00000000-0000-4000-f000-000000000267'::uuid, 'Minerva', 'Type AL', 1900, NULL::integer,
      ARRAY['type al', 'type ak', 'model ak', 'type k', 'ai', 'af', 'am', 'type dd', '32cv', '32 cv', '40 hp', '40 cv', '26 hp', '38 hp', '14hp']),
    ('00000000-0000-4000-f000-000000000268'::uuid, 'Lister', 'Knobbly', 1954, NULL::integer,
      ARRAY['knobbly', 'costin', 'jaguar', 'chevrolet', 'maserati', 'storm', 'bell', 'roadster']),
    ('00000000-0000-4000-f000-000000000269'::uuid, 'Abarth', '750', 1949, NULL::integer,
      ARRAY['750', 'record monza', 'simca', '1300', '1300ot', '2000', '1000', 'osella', 'periscopio', 'scorpione', '850', '595', '695', '205', '207a']),
    ('00000000-0000-4000-f000-000000000270'::uuid, 'Rolls-Royce', '20/25', 1904, 1945,
      ARRAY['20/25', '20/25hp', '20/25 hp', '25/30', '25/30hp', '25/30 hp', '20hp', '20 hp', 'twenty', '10hp', '15hp', '30hp']),
    ('00000000-0000-4000-f000-000000000271'::uuid, 'White', 'Model L', 1900, NULL::integer,
      ARRAY['model l', 'model g', 'model o', 'model e', 'model 30', 'type d', 'steamer', '65', 'model 4-45', 'model 15-45', 'tour bus', 'yellowstone']),
    ('00000000-0000-4000-f000-000000000272'::uuid, 'Freightliner', 'M2', 1942, NULL::integer,
      ARRAY['m2', 'unimog', 'sprinter', 'sportchassis', 'sport chassis', 'fl60', 'fl70', 'fl80', 'fld', 'cascadia', 'coronado', 'century', 'classic', 'argosy', 'dx3', 'hauler', '16m']),
    ('00000000-0000-4000-f000-000000000273'::uuid, 'Renault', '40 CV', 1898, 1944,
      ARRAY['type ai', 'ai', '35/45hp', '35/45 hp', 'vanderbilt', '40 cv', '40cv', '35 cv', '20/30', 'model 45', 'type cb', 'type n-b', 'type n-c', 'type dp', 'type g', 'type d', 'ft', 'nn', 'kz', 'monaquatre', 'celtaquatre', 'juvaquatre', 'vivaquatre', 'nervasport', 'vivastella', 'reinastella']),
    ('00000000-0000-4000-f000-000000000274'::uuid, 'AMC', 'Rambler', 1950, NULL::integer,
      ARRAY['rambler', 'sc/rambler', 'sc rambler', 'marlin', 'american', 'classic']),
    ('00000000-0000-4000-f000-000000000275'::uuid, 'Ferrari', 'Daytona SP3', 2018, NULL::integer,
      ARRAY['daytona sp3', 'monza sp1', 'monza sp2', 'sp30', 'luce']),
    ('00000000-0000-4000-f000-000000000276'::uuid, 'Jaguar', 'SS100', 1931, NULL::integer,
      ARRAY['ss100', 'ss 100', 'ss90', 'ss 90', 'ss1', 'ss 1', 'ss2'])
)
INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases)
SELECT nf.id, nf.make, nf.canonical_model, nf.year_start, nf.year_end, nf.aliases
FROM new_families nf
WHERE NOT EXISTS (
  SELECT 1
  FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(nf.make)
    AND lower(cm.canonical_model) = lower(nf.canonical_model)
);

-- 2. Widen year bounds on existing families where pre-war / continuation years were excluded
WITH year_fixes(make, canonical_model, new_year_start, clear_year_end) AS (
  VALUES
    ('Mercedes-Benz', 'E-Class', 1931, true),
    ('Mercedes-Benz', '540K', 1901, true),
    ('Porsche', '550', 1953, true),
    ('Aston Martin', 'Valkyrie', 2009, true),
    ('Aston Martin', 'DB4', 1950, true),
    ('Bugatti', 'Type 57', 1920, true),
    ('Maserati', 'Tipo 61 Birdcage', 1926, true),
    ('Jaguar', 'Mark II', 1945, true),
    ('Jaguar', 'S-Type', 1963, true),
    ('Bentley', '3 1/2 Litre', 1920, true),
    ('Talbot-Lago', 'T150-C-SS', 1930, true),
    ('Simplex', '50 HP', 1900, true),
    ('Peugeot', '205', 1890, true),
    ('Alvis', 'Speed 25', 1920, true),
    ('Alvis', 'TD 21', 1950, true),
    ('Oldsmobile', 'Hurst/Olds', 1965, true),
    ('Oldsmobile', '88', 1901, true),
    ('Oldsmobile', 'Cutlass', 1960, true),
    ('Fiat', '500', 1900, true),
    ('Fiat', '124 Spider', 1965, true),
    ('Fiat', 'X1/9', 1964, true),
    ('Harley-Davidson', 'FL', 1903, true),
    ('Harley-Davidson', 'EL', 1903, true),
    ('AMC', 'AMX', 1966, true),
    ('AMC', 'Javelin', 1966, true)
)
UPDATE public.canonical_models cm
SET
  year_start = CASE
    WHEN cm.year_start IS NULL THEN yf.new_year_start
    ELSE LEAST(cm.year_start, yf.new_year_start)
  END,
  year_end = CASE
    WHEN yf.clear_year_end THEN NULL
    ELSE cm.year_end
  END
FROM year_fixes yf
WHERE lower(cm.make) = lower(yf.make)
  AND lower(cm.canonical_model) = lower(yf.canonical_model);

-- 3. Merge concatenated sub-model and series aliases (1–3 words) into canonical families
WITH target_additions(make, canonical_model, add_aliases) AS (
  VALUES
    ('Ferrari', '288 GTO', ARRAY['288gto']),
    ('Ferrari', '250 GT', ARRAY['250gt', '250gte', 'europa gt', '250 lm', '250lm', '500 trc', '412p', '340 mm', '225 sport']),
    ('Ferrari', '275 GTB', ARRAY['275gtb', '275gtb/4', '275gts']),
    ('Ferrari', '330', ARRAY['330gt', '330gtc', '330gts']),
    ('Ferrari', '365', ARRAY['365gtc/4', '365gtc', '365gt', '365gtb/4', '365gtb', '365gts/4']),
    ('Ferrari', '599', ARRAY['599xx', '599xx evo']),
    ('Ferrari', 'F40', ARRAY['f40lm', 'f40 lm']),
    ('Ferrari', 'Daytona SP3', ARRAY['daytona sp3', 'monza sp1', 'monza sp2', 'sp30', 'luce']),
    ('Mercedes-Benz', 'S-Class', ARRAY['450 sel', '600sel', '300sdl', '220seb', '280se', '280sel', '300sel', '300se', '450sel', '500sel', '560sel', '560sec', '500sec']),
    ('Mercedes-Benz', 'E-Class', ARRAY['250c', '250ce', '280c', '280ce', '300ce', '230', '170 s', '170s', '170v', '170']),
    ('Mercedes-Benz', '540K', ARRAY['770k', '500k', '380k', '320n', '26/180', '36/220', '28/95', '40/50 hp', '38/70 hp', '45hp', 'simplex', 'w196r', 'patent-motorwagen']),
    ('Mercedes-Benz', 'GLS-Class', ARRAY['gls 63', 'gls63', 'gls 450', 'gls 550', 'gls 580']),
    ('Mercedes-Benz', 'M-Class', ARRAY['ml550', 'ml350', 'ml320', 'ml500', 'ml430', 'ml63', 'gla45', 'gla 45', 'gla250']),
    ('Mercedes-Benz', 'C-Class', ARRAY['c63', 'c43', 'c36', 'c32', 'c55', 'c300', 'c230', 'c280']),
    ('Porsche', '550', ARRAY['904', '904 gts', '904/6', '906', '906e', '907', '908', '910', '917', '956', '962', 'rs spyder']),
    ('Aston Martin', 'DB4', ARRAY['db4gt', 'db4 gt', 'db2/4', 'db24', 'db3s', 'db3']),
    ('Aston Martin', 'Valkyrie', ARRAY['valkyrie', 'valhalla', 'one-77', 'vulcan']),
    ('Bugatti', 'Type 57', ARRAY['type 59', 'type 55', 'type 51', 'type 50', 'type 49', 'type 46', 'type 44', 'type 43', 'type 40', 'type 37', 't35']),
    ('Bugatti', 'Chiron', ARRAY['mistral', 'divo', 'centodieci', 'bolide']),
    ('Maserati', 'Tipo 61 Birdcage', ARRAY['200si', '250f', '300s', '150 gt', '450s', 'a6/1500', 'boomerang']),
    ('Jaguar', 'XK150', ARRAY['xk150se']),
    ('Jaguar', 'XK140', ARRAY['xk140se', 'xk140mc']),
    ('Jaguar', 'XK120', ARRAY['xk120se', 'xk120m']),
    ('Jaguar', 'XJ', ARRAY['xj6c', 'xj12c', 'xj6l', 'xj12l']),
    ('Jaguar', 'XF', ARRAY['xfr', 'xfr-s']),
    ('Jaguar', 'Mark II', ARRAY['mark i', 'mk i', 'mk1', 'mk 2', 'mk2', 'mark iv', 'mark v', 'mk v', '240', '340', '420']),
    ('Jaguar', 'Mark IX', ARRAY['mkix', 'mkviii', 'mark viii', 'mkviim', 'mark vii']),
    ('Jaguar', 'S-Type', ARRAY['s-type']),
    ('Bentley', '3 1/2 Litre', ARRAY['mkvi', 's-series', 't-series', 't2', '3.5-litre', '4 1/2 liter']),
    ('Talbot-Lago', 'T150-C-SS', ARRAY['t26', 't-26', 't-26c', 't23', 't-23', 't14', 't-15']),
    ('Simplex', '50 HP', ARRAY['50hp', 'speedcar', '50 speedcar', 'model 38', '75hp', 'crane model 5', 'model 5', 'lafrance', '30hp', '90hp', 'servi-cycle']),
    ('Peugeot', '205', ARRAY['l45', '601', '145s', 'v2y2', 'type 15', 'type 26', 'type 48', 'type 63a', 'type 67a', 'type 56', 'type 69', 'type 126', 'type 150', 'type 172', 'type 190', '201', '202', '203', '204', '301', '302', '304', '306', '401', '406', '604']),
    ('Renault', 'Dauphine', ARRAY['alpine', 'a110', 'a310', '4l', 'r4', 'r8', 'r10', 'r12', 'r16', 'r17', 'estafette', 'floride', 'megane', 'twingo']),
    ('Alvis', 'Speed 25', ARRAY['speed twenty-five', 'speed 20', 'speed twenty', '12/60', '12/50', '3-liter', '3-litre', 'crested eagle', 'silver eagle', 'firefly', 'firebird', 'ta14', 'tb14']),
    ('Alvis', 'TD 21', ARRAY['td21', 'te21', 'tc21', 'ta21', 'tf21', 'tc21/100']),
    ('Oldsmobile', 'Hurst/Olds', ARRAY['hurst', 'rallye 350']),
    ('Oldsmobile', '88', ARRAY['curved dash', 'model r', 'limited', 'series 27', '60 hp', 'super', 'delta']),
    ('Oldsmobile', 'Cutlass', ARRAY['jetfire', 'f-85', 'f85']),
    ('Fiat', '500', ARRAY['500c', '500r', '126', 'panda', 'campagnola', '1100', '1100d', '128', '130', '2300s', '1500', '1200', 'tipo 682', 'tipo 642', 'model 643', 'tipo 6', 'type 24/32', 'eden roc']),
    ('Fiat', '124 Spider', ARRAY['124', '124 sport', '124 coupe', 'spider']),
    ('Fiat', 'X1/9', ARRAY['850']),
    ('Harley-Davidson', 'FL', ARRAY['fat boy', 'softail', 'heritage', 'street glide', 'road glide', 'ultra limited', 'fx', 'fxe', 'fxb', 'fxwg', 'fxstc', 'fxdl', 'fxdwg2', 'flstn', 'flsts', 'flstc', 'flstf', 'flhx', 'flhrci', 'flhtcui', 'flhtci', 'flhtc', 'dyna', 'xlch', 'xlcr', 'xlh', 'xl', 'xr1200', 'servi-car', 'captain america', 'hummer', 'baja 100', 'sprint', 'scat', 'pacer', 'topper', 'rapido', 'x-90', '165', '125', '125-s', 'mx250', 'sx250', 'mt500', 'kh']),
    ('Harley-Davidson', 'EL', ARRAY['strap tank', 'model f', 'model b', 'wld', 'wr']),
    ('Shelby', 'GT500', ARRAY['gt500cr', 'exp 500', 'stage iii']),
    ('Shelby', 'GT350', ARRAY['group ii mustang'])
)
UPDATE public.canonical_models cm
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(cm.aliases, ARRAY[]::text[]) || ta.add_aliases) AS a
)
FROM target_additions ta
WHERE lower(cm.make) = lower(ta.make)
  AND lower(cm.canonical_model) = lower(ta.canonical_model);

COMMIT;
