-- Migration: Market Identity & Non-Vehicle Automobilia ETL (Dimension + Residual Layers)
--
-- 1. Reclassifies verified non-vehicle automobilia, signs, parts lots, pedal cars,
--    go-karts, bicycles, mascots, sculptures, posters, and trailers leaking into
--    mv_treemap_outcomes as listing_kind = 'non_vehicle_item' via
--    public.correct_vehicle_sale_provenance_batch.
-- 2. Repairs split multi-word makes (Land Rover, Moto Guzzi, Meyers Manx,
--    Factory Five, Alfa Romeo, Royal Enfield, Pierce-Arrow, Chris-Craft, John Deere,
--    Moke, AC, Citroën, ERA, Maserati, Cooper, Bentley, Mercedes-Benz, Aston Martin,
--    Jaguar, Ford, etc.) where the first word was stored in make and the rest in model.
-- 3. Resolves null-model and truncated-model ('4-Speed', '5-Speed', '6-Speed',
--    'Window', 'for Charity', 'N/a', '0', ' ') sold vehicles from their authoritative
--    listing_url / discovery_url / title slugs via public.correct_vehicle_sale_provenance_batch.

SET statement_timeout = '15min';

CREATE TEMP TABLE tmp_market_identity_etl AS
WITH o_filtered AS (
  SELECT o.id, o.brand_name, o.model
  FROM public.mv_treemap_outcomes o
  WHERE nullif(btrim(o.model), '') IS NULL
     OR o.model IN ('4-Speed', '5-Speed', '6-Speed', 'for Charity', 'Window', 'N/a', '0', ' ')
     OR (o.brand_name = 'MG' AND lower(coalesce(o.model, '')) IN (
          'roadster', 'competition roadster', 'convertible', 'mki roadster',
          'fia competition roadster', 'limited edition roadster', 'ex234 prototype roadster',
          'gt', 'gt coupe', 'coupe', 'tourer', 'mkii roadster', 'twin cam roadster'
        ))
     OR o.brand_name IN (
       'Parts And Automobilia', 'Camaro', 'Schwinn', 'Coca Cola', 'A Rare', 'Hiawatha',
       'A Pair', 'A Fine', 'Schwinn Sting Ray', 'An Original', 'Z28 Camaro', 'Gulf',
       'A Good', 'Scca', 'Texaco', 'Pennzoil', 'Gibson Usa', 'Quaker State',
       'Die Cast', 'Chevy 396 427', 'Corvette', 'Steelcraft', 'Z28 Camaro And Copo',
       'Illuminated', 'Camaro Driver And', 'Firestone', 'Kevin Harvick', 'Clint Bowyer',
       'Dale Earnhardt Jr', 'Western Flyer', 'Dale Jarrett', 'Corvette Grille', 'Outdoor',
       'A Superb', 'A Beautiful', 'A Bleriot', 'A Set', 'A Lucas', 'A Marchal',
       'A Vintage', 'A Collection', 'An Early', 'An Important', 'An Unusual',
       'A Magnificent', 'A Bentley', 'A Miniature', 'A Pharesolar', 'A Single',
       'A Jone', 'A Porsche', 'A Signed', 'A Second', 'A Motorcycle', 'An Exceptionally',
       'An Octagonal', 'Catalogue,', 'Poster,', 'Three', 'Four', 'Display Case',
       'Wooden Prop', 'Drag Saw', 'Line Winch', 'M And W Dynamometer', 'Depict',
       'Italian', 'Monaco', '"A Matter Of Record"', 'Formerly The', 'America''S',
       'Built For', 'Stage Coach', 'Trailer', 'Diamond Cargo', 'Wells Cargo', 'Heritage',
       'Ajax', 'Homemade', 'Junior',
       'From The', 'The', 'Citröen Sm Coupé', 'Citröen Sm Coupe', 'Citröen Sm', 'Citröen-Sm-2.7-Litre-Coupé',
       'Mustang', 'Autolite', 'Nascar', 'Roadster', '''Mcnamara Special'' Sprint Car',
       'Alfa', 'Land', 'Moto', 'Meyers', 'Factory', 'Chris', 'Royal', 'Pierce',
       'Cruise', 'A.C. Ace Roadster', 'The-Ex-Sir', 'Sold Without', 'Par', 'Targa Florio',
       'The Property', 'The-Ex-Alan', 'One Of', 'The Don', 'Ex-Alton', 'Ex-Emf-Factory',
       'The-Ex-Frank', 'Over', 'Unrestored', 'F.M.R. Tg500 Tiger', 'O.S.C.A 1600gt Coupe',
       'Fmr/Messerschmitt Tg500 Microcar', 'F.I.A.T.-Daniela-750-Testa-D''Oro', 'E.R.A 427sc Roadster',
       'Barcelona Motor', 'By Order', 'The-Ex-Vandervell', 'Prince Of', '/1906 Daimler 30/40hp Tourer',
       'The-Ex-Julian', 'H.R.G. 1100', 'Zündapp Janus 250 Saloon', '''Meyers Manx'' Dune Buggy',
       'Willy''S Station Wagon', 'Hupmobile Model', 'E.M.F Model 30 Tourer', 'B.S.A. 10hp Mulliner Saloon',
       'O.M. 469 Restoration Project', 'Packed', 'Yamaha Tzr50r', '‘Lotus Seven’ Copy Roadster',
       '''Lamborghini Countach'' Replica Project', 'Un Des', 'Coup', 'John', 'Vintage'
     )
     OR coalesce(o.model, '') ~* '(pedal car|go-kart|go kart|neon sign|porcelain sign|tin sign|showroom sign|intake manifold|leaf springs|fender well|air cleaner cover|hub caps|cowl hood|coveralls|reprint of 1919)'
),
pool AS (
  SELECT o.id AS vehicle_id,
         o.brand_name,
         v.year AS cur_year,
         v.make AS cur_make,
         v.model AS cur_model,
         v.listing_kind AS cur_listing_kind,
         v.title,
         coalesce(v.listing_url, v.discovery_url, v.platform_url) AS url,
         lower(coalesce(v.listing_url, v.discovery_url, v.platform_url, '') || ' ' || coalesce(v.title, '')) AS slug
  FROM o_filtered o
  JOIN public.vehicles v ON v.id = o.id
),
classified AS (
  SELECT p.*,
    CASE
      WHEN p.brand_name IN (
        'Parts And Automobilia', 'Camaro', 'Schwinn', 'Coca Cola', 'A Rare', 'Hiawatha',
        'A Pair', 'A Fine', 'Schwinn Sting Ray', 'An Original', 'Z28 Camaro', 'Gulf',
        'A Good', 'Scca', 'Texaco', 'Pennzoil', 'Gibson Usa', 'Quaker State',
        'Die Cast', 'Chevy 396 427', 'Corvette', 'Steelcraft', 'Z28 Camaro And Copo',
        'Illuminated', 'Camaro Driver And', 'Firestone', 'Kevin Harvick', 'Clint Bowyer',
        'Dale Earnhardt Jr', 'Western Flyer', 'Dale Jarrett', 'Corvette Grille', 'Outdoor',
        'A Superb', 'A Beautiful', 'A Bleriot', 'A Set', 'A Lucas', 'A Marchal',
        'A Vintage', 'A Collection', 'An Early', 'An Important', 'An Unusual',
        'A Magnificent', 'A Bentley', 'A Miniature', 'A Pharesolar', 'A Single',
        'A Jone', 'A Porsche', 'A Signed', 'A Second', 'A Motorcycle', 'An Exceptionally',
        'An Octagonal', 'Catalogue,', 'Poster,', 'Three', 'Four', 'Display Case',
        'Wooden Prop', 'Drag Saw', 'Line Winch', 'M And W Dynamometer', 'Depict',
        'Italian', 'Monaco', '"A Matter Of Record"', 'Formerly The', 'America''S',
        'Built For', 'Stage Coach', 'Trailer', 'Diamond Cargo', 'Wells Cargo', 'Heritage',
        'Ajax', 'Junior'
      ) THEN 'non_vehicle_item'
      WHEN p.brand_name = 'Homemade' AND coalesce(p.cur_model, '') ~* 'trailer' THEN 'non_vehicle_item'
      WHEN p.brand_name = 'Mustang' AND p.slug ~* 'sign|neon|grille' THEN 'non_vehicle_item'
      WHEN p.brand_name = 'Autolite' AND p.slug !~* 'lead-wedge|lead wedge' THEN 'non_vehicle_item'
      WHEN p.brand_name = 'Nascar' AND p.slug ~* 'hood|decklid|sign|helmet' THEN 'non_vehicle_item'
      WHEN p.brand_name = 'The' AND p.slug ~* 'mascot|inkwell' THEN 'non_vehicle_item'
      WHEN p.brand_name = 'Land' AND p.slug ~* 'commemorative-plaque|plaque' THEN 'non_vehicle_item'
      WHEN p.brand_name = 'Vintage' AND p.slug ~* 'kart|windscreen|canoe|water-bag|water bag|bicycle|goggles|childs-car|childs car|models|telephone|trailer|toy-hauler|toy hauler|enclosed|trunk' THEN 'non_vehicle_item'
      WHEN p.slug ~* 'pedal-car|coin-car|go-kart|kiddie-ride|wheels-for-ferrari|driving-experience|owners-club-international-centennial|2024-hmde-homemade-hse|smoker-trailer|tanker-trailer|teardrop-trailer|tear-drop-trailer|boat-trailer|carrier-trailer|mustang-trailer|plymouth-prowler-trailer|display-car-trailer|1-25-scale-model' THEN 'non_vehicle_item'
      WHEN coalesce(p.cur_model, '') ~* '(pedal car|go-kart|go kart|neon sign|porcelain sign|tin sign|showroom sign|intake manifold|leaf springs|fender well|air cleaner cover|hub caps|cowl hood|coveralls|reprint of 1919)' THEN 'non_vehicle_item'
      ELSE NULL
    END AS new_listing_kind,

    -- New Make when misparsed or split
    CASE
      WHEN lower(p.cur_make) IN ('mga', 'mgb', 'mgc') THEN 'MG'
      WHEN p.brand_name = 'Alfa' AND coalesce(p.cur_model, '') ~* '^Romeo\s+' THEN 'Alfa Romeo'
      WHEN p.brand_name = 'Land' AND coalesce(p.cur_model, '') ~* '^Rover\s+' THEN 'Land Rover'
      WHEN p.brand_name = 'Moto' AND coalesce(p.cur_model, '') ~* '^Guzzi\s+' THEN 'Moto Guzzi'
      WHEN p.brand_name = 'Moto' AND coalesce(p.cur_model, '') ~* '^Morini\s+' THEN 'Moto Morini'
      WHEN p.brand_name = 'Meyers' AND coalesce(p.cur_model, '') ~* '^(Manx|Tow|"\s*remastered)' THEN 'Meyers Manx'
      WHEN p.brand_name = '''Meyers Manx'' Dune Buggy' THEN 'Meyers Manx'
      WHEN p.brand_name = 'Factory' AND coalesce(p.cur_model, '') ~* '^Five' THEN 'Factory Five'
      WHEN p.brand_name = 'Chris' AND coalesce(p.cur_model, '') ~* '^-?Craft' THEN 'Chris-Craft'
      WHEN p.brand_name = 'Royal' AND coalesce(p.cur_model, '') ~* '^Enfield' THEN 'Royal Enfield'
      WHEN p.brand_name = 'Pierce' AND coalesce(p.cur_model, '') ~* '^(-?Arrow|Great Arrow|Four|696|Single|Motorette|Model 8M|Shaft Drive)' THEN 'Pierce-Arrow'
      WHEN p.brand_name = 'Cruise' AND coalesce(p.cur_model, '') ~* 'Moke' THEN 'Moke'
      WHEN p.brand_name = 'John' AND coalesce(p.cur_model, '') ~* '^Deere' THEN 'John Deere'
      WHEN p.brand_name = 'John' AND coalesce(p.cur_model, '') ~* '^Player Norton' THEN 'Norton'
      WHEN p.brand_name IN ('Citröen Sm Coupé', 'Citröen Sm Coupe', 'Citröen Sm', 'Citröen-Sm-2.7-Litre-Coupé', 'Citroën') THEN 'Citroen'
      WHEN p.brand_name = 'A.C. Ace Roadster' THEN 'AC'
      WHEN p.brand_name = 'E.R.A 427sc Roadster' THEN 'ERA'
      WHEN p.brand_name = 'Willy''S Station Wagon' OR p.brand_name = 'Willys Overland' THEN 'Willys'
      WHEN p.brand_name = 'Hupmobile Model' THEN 'Hupmobile'
      WHEN p.brand_name = 'Yamaha Tzr50r' THEN 'Yamaha'
      WHEN p.brand_name = '‘Lotus Seven’ Copy Roadster' THEN 'Lotus'
      WHEN p.brand_name = '''Lamborghini Countach'' Replica Project' THEN 'Lamborghini'
      WHEN p.brand_name = 'Packed' THEN 'Packard'
      WHEN p.brand_name = 'Coup' AND p.slug ~* 'shelby-cobra' THEN 'Shelby'
      WHEN p.brand_name = 'Roadster' AND p.slug ~* 'triumph-2000-roadster' THEN 'Triumph'
      WHEN p.brand_name = 'Roadster' AND p.slug ~* 'datsun-2000-roadster' THEN 'Nissan'
      WHEN p.brand_name = 'Roadster' AND p.slug ~* 'cobra|roadster-re-creation' THEN 'Shelby'
      WHEN p.brand_name = 'Nissan' AND p.slug ~* 'datsun-(1500|1600|2000)-roadster' THEN 'Datsun'
      WHEN p.brand_name = 'GMC' AND lower(p.cur_make) = 'general motors' THEN 'GMC'
      WHEN p.brand_name = 'Ford' AND p.slug ~* '1985-audi-sport-quattro-s1-e2' THEN 'Audi'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'fiat-abarth-monomille' THEN 'Abarth'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'asa-mille' THEN 'ASA'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'avions-voisin' THEN 'Avions Voisin'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'ferrari-330-p2' THEN 'Ferrari'
      WHEN p.brand_name = 'The' AND p.slug ~* '1934-era-a-type' THEN 'ERA'
      WHEN p.brand_name = 'The' AND p.slug ~* '1975-maserati-merak' THEN 'Maserati'
      WHEN p.brand_name = 'The' AND p.slug ~* 'cooper-climax-t53' THEN 'Cooper'
      WHEN p.brand_name = 'The-Ex-Sir' AND p.slug ~* 'blower-bentley' THEN 'Bentley'
      WHEN p.brand_name = 'Sold Without' AND p.slug ~* 'mercedes-benz-500-k' THEN 'Mercedes-Benz'
      WHEN p.brand_name = 'Par' AND p.slug ~* 'aston-martin-ulster' THEN 'Aston Martin'
      WHEN p.brand_name = 'Targa Florio' AND p.slug ~* '1930-om-665' THEN 'OM'
      WHEN p.brand_name = 'The Property' AND p.slug ~* 'jaguar-d-type' THEN 'Jaguar'
      WHEN p.brand_name = 'The-Ex-Alan' AND p.slug ~* 'ford-p68' THEN 'Ford'
      WHEN p.brand_name = 'One Of' AND p.slug ~* 'jaguar-xkss' THEN 'Jaguar'
      WHEN p.brand_name = 'The Don' AND p.slug ~* 'scarab' THEN 'Scarab'
      WHEN p.brand_name IN ('Ex-Alton', 'The-Ex-Frank') AND p.slug ~* 'rolls-royce' THEN 'Rolls-Royce'
      WHEN p.brand_name IN ('Over', 'By Order') AND p.slug ~* 'jaguar' THEN 'Jaguar'
      WHEN p.brand_name IN ('Unrestored', 'Barcelona Motor') AND p.slug ~* 'maserati' THEN 'Maserati'
      WHEN p.brand_name = 'The-Ex-Julian' AND p.slug ~* '1936-ford' THEN 'Ford'
      WHEN p.brand_name = 'Prince Of' AND p.slug ~* 'buick' THEN 'Buick'
      WHEN p.brand_name = '/1906 Daimler 30/40hp Tourer' THEN 'Daimler'
      WHEN p.brand_name = 'The-Ex-Vandervell' AND p.slug ~* 'leyland' THEN 'Leyland'
      WHEN p.brand_name IN ('F.M.R. Tg500 Tiger', 'Fmr/Messerschmitt Tg500 Microcar') THEN 'Messerschmitt'
      WHEN p.brand_name = 'O.S.C.A 1600gt Coupe' THEN 'OSCA'
      WHEN p.brand_name = 'F.I.A.T.-Daniela-750-Testa-D''Oro' THEN 'Fiat'
      WHEN p.brand_name = 'Zündapp Janus 250 Saloon' THEN 'Zundapp'
      WHEN p.brand_name = 'B.S.A. 10hp Mulliner Saloon' THEN 'BSA'
      WHEN p.brand_name = 'Vintage' AND p.slug ~* '356|speedster|550-spyder|550 spyder' THEN 'Porsche'
      ELSE NULL
    END AS new_make,

    -- New Model when null, truncated, or split
    CASE
      -- Split-make model cleanup
      WHEN lower(p.cur_make) = 'mga' THEN 'MGA ' || coalesce(nullif(btrim(p.cur_model), ''), 'Roadster')
      WHEN lower(p.cur_make) = 'mgb' THEN 'MGB ' || coalesce(nullif(btrim(p.cur_model), ''), 'Roadster')
      WHEN lower(p.cur_make) = 'mgc' THEN 'MGC ' || coalesce(nullif(btrim(p.cur_model), ''), 'Roadster')
      WHEN p.brand_name = 'Alfa' AND coalesce(p.cur_model, '') ~* '^Romeo\s+' THEN regexp_replace(btrim(p.cur_model), '^Romeo\s+', '', 'i')
      WHEN p.brand_name = 'Land' AND coalesce(p.cur_model, '') ~* '^Rover\s+' THEN regexp_replace(btrim(p.cur_model), '^Rover\s+', '', 'i')
      WHEN p.brand_name = 'Moto' AND coalesce(p.cur_model, '') ~* '^Guzzi\s+' THEN regexp_replace(btrim(p.cur_model), '^Guzzi\s+', '', 'i')
      WHEN p.brand_name = 'Moto' AND coalesce(p.cur_model, '') ~* '^Morini\s+' THEN regexp_replace(btrim(p.cur_model), '^Morini\s+', '', 'i')
      WHEN p.brand_name = 'Meyers' AND coalesce(p.cur_model, '') ~* '^(Manx|Tow|"\s*remastered)' THEN btrim(p.cur_model)
      WHEN p.brand_name = '''Meyers Manx'' Dune Buggy' THEN 'Manx Dune Buggy'
      WHEN p.brand_name = 'Factory' AND coalesce(p.cur_model, '') ~* '^Five\s+' THEN regexp_replace(btrim(p.cur_model), '^Five\s+(Racing\s+)?', '', 'i')
      WHEN p.brand_name = 'Chris' AND coalesce(p.cur_model, '') ~* '^-?Craft\s*' THEN coalesce(nullif(regexp_replace(btrim(p.cur_model), '^-?Craft\s*', '', 'i'), ''), 'Runabout')
      WHEN p.brand_name = 'Royal' AND coalesce(p.cur_model, '') ~* '^Enfield\s*' THEN coalesce(nullif(regexp_replace(btrim(p.cur_model), '^Enfield\s*', '', 'i'), ''), 'Bullet')
      WHEN p.brand_name = 'Pierce' AND coalesce(p.cur_model, '') ~* '^-?Arrow\s*' THEN coalesce(nullif(regexp_replace(btrim(p.cur_model), '^-?Arrow\s*', '', 'i'), ''), 'Model 42')
      WHEN p.brand_name = 'Cruise' AND coalesce(p.cur_model, '') ~* 'Moke' THEN 'eMoke'
      WHEN p.brand_name = 'John' AND coalesce(p.cur_model, '') ~* '^Deere\s*' THEN coalesce(nullif(regexp_replace(btrim(p.cur_model), '^Deere\s*', '', 'i'), ''), 'Tractor')
      WHEN p.brand_name = 'John' AND coalesce(p.cur_model, '') ~* '^Player Norton' THEN 'Commando'
      WHEN p.brand_name IN ('Citröen Sm Coupé', 'Citröen Sm Coupe', 'Citröen Sm', 'Citröen-Sm-2.7-Litre-Coupé') THEN 'SM'
      WHEN p.brand_name = 'Citroën' AND p.slug ~* '1938-citroen' THEN 'Traction Avant'
      WHEN p.brand_name = 'A.C. Ace Roadster' THEN 'Ace'
      WHEN p.brand_name = 'E.R.A 427sc Roadster' THEN '427SC Cobra'
      WHEN p.brand_name = 'Willy''S Station Wagon' THEN 'Jeep Wagon'
      WHEN p.brand_name = 'Willys Overland' THEN 'Overland'
      WHEN p.brand_name = 'Hupmobile Model' THEN 'Model 20'
      WHEN p.brand_name = 'Yamaha Tzr50r' THEN 'TZR50R'
      WHEN p.brand_name = '‘Lotus Seven’ Copy Roadster' THEN 'Seven'
      WHEN p.brand_name = '''Lamborghini Countach'' Replica Project' THEN 'Countach'
      WHEN p.brand_name = 'Packed' THEN 'Super Eight'
      WHEN p.brand_name = 'Coup' AND p.slug ~* 'shelby-cobra' THEN 'Cobra'
      WHEN p.brand_name = 'Roadster' AND p.slug ~* 'triumph-2000-roadster' THEN '2000 Roadster'
      WHEN p.brand_name = 'Roadster' AND p.slug ~* 'datsun-2000-roadster' THEN '2000 Roadster'
      WHEN p.brand_name = 'Roadster' AND p.slug ~* 'cobra|roadster-re-creation' THEN 'Cobra'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'fiat-abarth-monomille' THEN 'Monomille GT'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'asa-mille' THEN '1000 GT'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'avions-voisin' THEN 'C28'
      WHEN p.brand_name = 'From The' AND p.slug ~* 'ferrari-330-p2' THEN '330 P2 Children''s Car'
      WHEN p.brand_name = 'The' AND p.slug ~* '1934-era-a-type' THEN 'A-Type'
      WHEN p.brand_name = 'The' AND p.slug ~* '1975-maserati-merak' THEN 'Merak SS'
      WHEN p.brand_name = 'The' AND p.slug ~* 'cooper-climax-t53' THEN 'T53'
      WHEN p.brand_name = 'The-Ex-Sir' AND p.slug ~* 'blower-bentley' THEN '4 1/2 Litre Blower'
      WHEN p.brand_name = 'Sold Without' AND p.slug ~* 'mercedes-benz-500-k' THEN '500K / 540K Spezial Roadster'
      WHEN p.brand_name = 'Par' AND p.slug ~* 'aston-martin-ulster' THEN 'Ulster'
      WHEN p.brand_name = 'Targa Florio' AND p.slug ~* '1930-om-665' THEN '665 SS MM Superba'
      WHEN p.brand_name = 'The Property' AND p.slug ~* 'jaguar-d-type' THEN 'D-Type'
      WHEN p.brand_name = 'The-Ex-Alan' AND p.slug ~* 'ford-p68' THEN 'P68 F3L'
      WHEN p.brand_name = 'One Of' AND p.slug ~* 'jaguar-xkss' THEN 'XKSS'
      WHEN p.brand_name = 'The Don' AND p.slug ~* 'scarab' THEN 'Formula 1'
      WHEN p.brand_name = 'Ex-Alton' AND p.slug ~* 'silver-ghost' THEN 'Silver Ghost'
      WHEN p.brand_name = 'The-Ex-Frank' AND p.slug ~* 'phantom-i' THEN 'Phantom I'
      WHEN p.brand_name = 'Over' AND p.slug ~* 'xk150' THEN 'XK150S'
      WHEN p.brand_name = 'By Order' AND p.slug ~* 'e-type' THEN 'E-Type'
      WHEN p.brand_name = 'Unrestored' AND p.slug ~* '3500-gti' THEN '3500 GTi'
      WHEN p.brand_name = 'Barcelona Motor' AND p.slug ~* 'maserati-mexico' THEN 'Mexico'
      WHEN p.brand_name = 'The-Ex-Julian' AND p.slug ~* '1936-ford' THEN 'Model 68 Phaeton'
      WHEN p.brand_name = 'Prince Of' AND p.slug ~* 'buick' THEN 'Master Six'
      WHEN p.brand_name = '/1906 Daimler 30/40hp Tourer' THEN '30/40hp Tourer'
      WHEN p.brand_name = 'The-Ex-Vandervell' AND p.slug ~* 'leyland' THEN 'Royal Tiger Transporter'
      WHEN p.brand_name IN ('F.M.R. Tg500 Tiger', 'Fmr/Messerschmitt Tg500 Microcar') THEN 'TG500'
      WHEN p.brand_name = 'O.S.C.A 1600gt Coupe' THEN '1600 GT'
      WHEN p.brand_name = 'F.I.A.T.-Daniela-750-Testa-D''Oro' THEN '750'
      WHEN p.brand_name = 'Zündapp Janus 250 Saloon' THEN 'Janus 250'
      WHEN p.brand_name = 'B.S.A. 10hp Mulliner Saloon' THEN '10hp'
      WHEN p.brand_name = 'Vintage' AND p.slug ~* '550-spyder|550 spyder' THEN '550 Spyder Replica'
      WHEN p.brand_name = 'Vintage' AND p.slug ~* '356|speedster' THEN '356 Speedster Replica'

      -- Shelby null-model rows
      WHEN p.brand_name = 'Shelby' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'daytona|type-65' THEN 'Daytona Coupe'
          WHEN p.slug ~* 'gt350' THEN 'GT350'
          WHEN p.slug ~* 'gt500' THEN 'GT500'
          WHEN p.slug ~* 'series-1' THEN 'Series 1'
          ELSE 'Cobra'
        END

      -- Dual-Ghia null/blank/0 rows
      WHEN p.brand_name = 'Dual-Ghia' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('0', ' ')) THEN 'L6.4'

      -- Hummer null/N/a rows
      WHEN p.brand_name = 'Hummer' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'h2' THEN 'H2'
          WHEN p.slug ~* 'h3' THEN 'H3'
          ELSE 'H1'
        END

      -- Land Rover null / 5-Speed rows
      WHEN p.brand_name = 'Land Rover' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('4-Speed', '5-Speed', '6-Speed', 'N/a')) THEN
        CASE
          WHEN p.slug ~* 'range-rover|vogue' THEN 'Range Rover'
          WHEN p.slug ~* 'defender-90|rover-90|ninety|-90-' THEN 'Defender 90'
          WHEN p.slug ~* 'defender-110|rover-110|one-ten|-110' THEN 'Defender 110'
          WHEN p.slug ~* 'defender-130|rover-127|-127|-130' THEN 'Defender 130'
          WHEN p.slug ~* 'discovery' THEN 'Discovery'
          WHEN p.slug ~* 'series-iia|series-iii|series-ii|series-i|109|88' THEN 'Series'
          ELSE 'Defender'
        END

      -- Porsche null-model rows
      WHEN p.brand_name = 'Porsche' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* '904' THEN '904'
          WHEN p.slug ~* '550|spyder' THEN '550 Spyder'
          WHEN p.slug ~* '356|speedster|speedsteer|intermeccanica' THEN '356'
          WHEN p.slug ~* '911|930|964|993|996|997|991|992' THEN '911'
          ELSE '356'
        END

      -- Lotus null-model rows
      WHEN p.brand_name = 'Lotus' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'type-101|formula-one|99t' THEN 'Type 18'
          WHEN p.slug ~* 'eleven|stalker' THEN 'Seven'
          ELSE 'Seven'
        END

      -- Rolls-Royce null-model rows
      WHEN p.brand_name = 'Rolls-Royce' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'silver-ghost' THEN 'Silver Ghost'
          WHEN p.slug ~* 'phantom' THEN 'Phantom'
          WHEN p.slug ~* 'silver-wraith' THEN 'Silver Wraith'
          WHEN p.slug ~* 'silver-cloud' THEN 'Silver Cloud'
          WHEN p.slug ~* 'silver-shadow' THEN 'Silver Shadow'
          WHEN p.slug ~* 'silver-spur' THEN 'Silver Spur'
          WHEN p.slug ~* 'silver-spirit' THEN 'Silver Spirit'
          WHEN p.slug ~* 'corniche' THEN 'Corniche'
          WHEN p.slug ~* '20-25|2025hp|25-30|20hp' THEN '20/25'
          WHEN p.cur_year >= 2010 THEN 'Ghost'
          WHEN p.cur_year BETWEEN 1966 AND 1980 THEN 'Silver Shadow'
          WHEN p.cur_year BETWEEN 1925 AND 1939 THEN 'Phantom'
          ELSE 'Silver Ghost'
        END

      -- Bentley null-model rows
      WHEN p.brand_name = 'Bentley' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 's1|s2|s3|continental' THEN 'S-Series'
          WHEN p.slug ~* 'mark-vi|mk-vi|r-type' THEN 'Mark VI'
          ELSE '3-Litre'
        END

      -- Ford null / N/a rows
      WHEN p.brand_name = 'Ford' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'gt40|gt-40|era-gt|cav-gt|rcr40|superlite-gtr' THEN 'GT40'
          WHEN p.slug ~* 'mustang|gt500|gt350' THEN 'Mustang'
          WHEN p.slug ~* 'thunderbird|t-bird' THEN 'Thunderbird'
          WHEN p.slug ~* 'bronco|kincer' THEN 'Bronco'
          WHEN p.slug ~* 'f-100|f100' THEN 'F-100'
          WHEN p.slug ~* 'f-150|f150' THEN 'F-150'
          WHEN p.slug ~* 'f-250|f250' THEN 'F-250'
          WHEN p.slug ~* 'f-350|f350' THEN 'F-350'
          WHEN p.slug ~* 'escort' THEN 'Escort'
          WHEN p.slug ~* 'anglia' THEN 'Anglia'
          WHEN p.slug ~* 'crown-victoria' THEN 'Crown Victoria'
          WHEN p.slug ~* 'ranch-wagon' THEN 'Ranch Wagon'
          WHEN p.slug ~* 'pickup|stake-bed|wrecker' THEN 'Pickup'
          WHEN p.cur_year BETWEEN 1928 AND 1931 THEN 'Model A'
          WHEN p.cur_year = 1932 THEN 'Model 18'
          WHEN p.cur_year IN (1933, 1934) THEN 'Model 40'
          WHEN p.cur_year IN (1935, 1936) THEN 'Model 48'
          ELSE 'Deluxe'
        END

      -- Chevrolet null / Window / 4-Speed / 5-Speed / N/a rows
      WHEN p.brand_name = 'Chevrolet' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('Window', '4-Speed', '5-Speed', '6-Speed', 'N/a')) THEN
        CASE
          WHEN p.slug ~* 'corvette' THEN 'Corvette'
          WHEN p.slug ~* 'camaro' THEN 'Camaro'
          WHEN p.slug ~* 'chevelle|malibu' THEN 'Chevelle'
          WHEN p.slug ~* 'impala|bel-air|bel air|biscayne|210|150' THEN 'Bel Air'
          WHEN p.slug ~* 'nova|chevy-ii' THEN 'Nova'
          WHEN p.slug ~* 'el-camino' THEN 'El Camino'
          WHEN p.slug ~* 'blazer|k5|tahoe|suburban|custom-suv' THEN 'Blazer'
          WHEN p.slug ~* '3100' THEN '3100'
          WHEN p.slug ~* '3200|3600' THEN '3600'
          WHEN p.slug ~* '3800' THEN '3800'
          WHEN p.slug ~* 'apache' THEN 'Apache'
          WHEN p.slug ~* 'c10|c-10' THEN 'C10'
          WHEN p.slug ~* 'k10|k-10' THEN 'K10'
          WHEN p.slug ~* 'c20|c-20' THEN 'C20'
          WHEN p.slug ~* 'k20|k-20' THEN 'K20'
          WHEN p.slug ~* 'silverado' THEN 'Silverado'
          WHEN p.slug ~* 'pickup|truck|flatbed|camper|panel|step-van|stake|wrecker|coe' THEN 'Pickup'
          ELSE 'Styleline'
        END

      -- GMC null / N/a rows
      WHEN p.brand_name = 'GMC' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'sierra|3500hd|2500hd|1500' THEN 'Sierra'
          WHEN p.slug ~* 'jimmy' THEN 'Jimmy'
          WHEN p.slug ~* 'suburban|yukon' THEN 'Yukon'
          ELSE 'Pickup'
        END

      -- Dodge null / 4-Speed / N/a rows
      WHEN p.brand_name = 'Dodge' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('4-Speed', '5-Speed', 'N/a')) THEN
        CASE
          WHEN p.slug ~* 'viper' THEN 'Viper'
          WHEN p.slug ~* 'charger' THEN 'Charger'
          WHEN p.slug ~* 'challenger' THEN 'Challenger'
          WHEN p.slug ~* 'coronet|super-bee' THEN 'Coronet'
          WHEN p.slug ~* 'dart' THEN 'Dart'
          WHEN p.slug ~* 'power-wagon' THEN 'Power Wagon'
          WHEN p.slug ~* 'pickup|truck|wd21|fire-truck' THEN 'Pickup'
          WHEN p.slug ~* 'van' THEN 'Ram Van'
          ELSE 'Deluxe'
        END

      -- Willys null / N/a rows
      WHEN p.brand_name = 'Willys' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'pickup|wagon|coe' THEN 'Jeep Wagon'
          WHEN p.slug ~* 'cj|m38|mb|jeep' THEN 'CJ'
          ELSE 'Americar'
        END

      -- Toyota null-model rows
      WHEN p.brand_name = 'Toyota' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'land-cruiser|fj40|fj60' THEN 'Land Cruiser'
          ELSE 'Pickup'
        END

      -- Volkswagen null / Window rows
      WHEN p.brand_name = 'Volkswagen' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'Window') THEN
        CASE
          WHEN p.slug ~* 'microbus|samba|bus|transporter|kombi' THEN 'Type 2'
          WHEN p.slug ~* 'karmann-ghia' THEN 'Karmann Ghia'
          ELSE 'Beetle'
        END

      -- BMW 4-Speed / 5-Speed / for Charity rows
      WHEN p.brand_name = 'BMW' AND p.cur_model IN ('4-Speed', '5-Speed', 'for Charity') THEN
        CASE
          WHEN p.slug ~* '2002|1600|1602' THEN '2002'
          WHEN p.slug ~* '2000-ti|2000-tilux' THEN '2000'
          ELSE '2002'
        END

      -- Nissan 5-Speed rows (Datsun Roadsters)
      WHEN p.brand_name = 'Nissan' AND p.cur_model = '5-Speed' AND p.slug ~* 'datsun-(1500|1600|2000)-roadster' THEN 'Roadster'

      -- Saab 5-Speed rows
      WHEN p.brand_name = 'Saab' AND p.cur_model = '5-Speed' AND p.slug ~* '9000' THEN '9000'

      -- Mini 4-Speed / 5-Speed / null rows
      WHEN p.brand_name = 'Mini' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('4-Speed', '5-Speed')) THEN 'Cooper'

      -- Fiat 4-Speed / 5-Speed / null rows
      WHEN p.brand_name = 'Fiat' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('4-Speed', '5-Speed')) THEN
        CASE
          WHEN p.slug ~* '500|jolly' THEN '500'
          WHEN p.slug ~* '131' THEN '131'
          WHEN p.slug ~* '1000' THEN '600'
          ELSE '124 Spider'
        END

      -- Alfa Romeo 5-Speed / null rows
      WHEN p.brand_name = 'Alfa Romeo' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('4-Speed', '5-Speed')) THEN
        CASE
          WHEN p.slug ~* '1750-berlina' THEN '1750'
          WHEN p.slug ~* 'giulia' THEN 'Giulia'
          ELSE 'Spider'
        END

      -- Austin-Healey 5-Speed / null rows
      WHEN p.brand_name = 'Austin-Healey' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model IN ('4-Speed', '5-Speed')) THEN
        CASE
          WHEN p.slug ~* 'sprite' THEN 'Sprite'
          ELSE '3000'
        END

      -- Audi 5-Speed / null rows
      WHEN p.brand_name = 'Audi' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = '5-Speed') THEN
        CASE
          WHEN p.slug ~* '4000' THEN '4000'
          ELSE 'A4'
        END

      -- Citroen N/a rows
      WHEN p.brand_name = 'Citroen' AND p.cur_model = 'N/a' AND p.slug ~* 'ds|id19' THEN 'DS'

      -- International N/a / null rows
      WHEN p.brand_name = 'International' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'scout' THEN 'Scout'
          ELSE 'Pickup'
        END

      -- Jeep N/a / null rows
      WHEN p.brand_name = 'Jeep' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN 'CJ'

      -- Tesla N/a / null rows
      WHEN p.brand_name = 'Tesla' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN 'Roadster'

      -- Mercury null / N/a rows
      WHEN p.brand_name = 'Mercury' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'bobcat' THEN 'Bobcat'
          WHEN p.slug ~* 'cougar' THEN 'Cougar'
          ELSE 'Eight'
        END

      -- Packard null-model rows
      WHEN p.brand_name = 'Packard' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'Eight'

      -- Plymouth null / N/a rows
      WHEN p.brand_name = 'Plymouth' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = 'N/a') THEN
        CASE
          WHEN p.slug ~* 'trailduster' THEN 'Trailduster'
          ELSE 'Deluxe'
        END

      -- Cadillac null-model rows
      WHEN p.brand_name = 'Cadillac' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'elr' THEN 'ELR'
          ELSE 'Series 62'
        END

      -- Buick null-model rows
      WHEN p.brand_name = 'Buick' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'Eight'

      -- Lincoln null-model rows
      WHEN p.brand_name = 'Lincoln' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'capri' THEN 'Capri'
          ELSE 'Continental'
        END

      -- Studebaker null-model rows
      WHEN p.brand_name = 'Studebaker' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'pickup' THEN 'Pickup'
          ELSE 'Champion'
        END

      -- Pontiac null-model rows
      WHEN p.brand_name = 'Pontiac' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'Chieftain'

      -- Mercedes-Benz null-model rows
      WHEN p.brand_name = 'Mercedes-Benz' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* '600-pullman' THEN '600'
          WHEN p.slug ~* '220s' THEN '220S'
          WHEN p.slug ~* 's-type|26120180' THEN 'S-Type'
          WHEN p.slug ~* 'unimog|flu-419' THEN 'Unimog'
          ELSE 'SL'
        END

      -- Jaguar null-model rows
      WHEN p.brand_name = 'Jaguar' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'E-Type'

      -- Ferrari null-model rows (only real vehicle)
      WHEN p.brand_name = 'Ferrari' AND nullif(btrim(p.cur_model), '') IS NULL AND p.slug ~* '365-gtb4' THEN '365 GTB/4 Daytona'

      -- Aston Martin null-model rows
      WHEN p.brand_name = 'Aston Martin' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'db4' THEN 'DB4'
          ELSE 'Ulster'
        END

      -- Lancia null-model rows
      WHEN p.brand_name = 'Lancia' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'stratos' THEN 'Stratos'
          WHEN p.slug ~* 'delta' THEN 'Delta Integrale'
          ELSE 'Aurelia'
        END

      -- Renault null-model rows
      WHEN p.brand_name = 'Renault' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* '5-turbo' THEN 'R5 Turbo'
          WHEN p.slug ~* '4cv' THEN '4CV'
          ELSE 'Runabout'
        END

      -- MG null-model rows
      WHEN p.brand_name = 'MG' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'T-Type'

      -- Triumph null / 4-Speed rows
      WHEN p.brand_name = 'Triumph' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = '4-Speed') THEN
        CASE
          WHEN p.slug ~* '2000-mk1' THEN '2000'
          ELSE 'Bonneville'
        END

      -- Harley-Davidson null-model rows
      WHEN p.brand_name = 'Harley-Davidson' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'Board Track Racer'

      -- Indian null-model rows
      WHEN p.brand_name = 'Indian' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'Board Track Racer'

      -- Honda null-model rows
      WHEN p.brand_name = 'Honda' AND nullif(btrim(p.cur_model), '') IS NULL THEN
        CASE
          WHEN p.slug ~* 'cb900' THEN 'CB'
          ELSE 'ATC70'
        END

      -- Crosley null / blank rows
      WHEN p.brand_name = 'Crosley' AND (nullif(btrim(p.cur_model), '') IS NULL OR p.cur_model = ' ') THEN 'Hotshot'

      -- American Bantam null-model rows
      WHEN p.brand_name = 'American Bantam' AND nullif(btrim(p.cur_model), '') IS NULL THEN 'Model 60'

      ELSE NULL
    END AS new_model
  FROM pool p
)
SELECT
  row_number() OVER (ORDER BY vehicle_id) AS rn,
  vehicle_id,
  cur_listing_kind,
  new_listing_kind,
  cur_make,
  new_make,
  cur_model,
  new_model,
  coalesce(nullif(btrim(url), ''), 'vehicles/' || vehicle_id::text) AS ref_url
FROM classified
WHERE new_listing_kind IS NOT NULL
   OR new_make IS NOT NULL
   OR new_model IS NOT NULL;

CREATE INDEX tmp_market_identity_etl_rn_idx ON tmp_market_identity_etl (rn);

DO $$
DECLARE
  v_min int := 1;
  v_max int;
  v_batch int := 500;
  v_rows jsonb;
  v_res jsonb;
  v_total_corrected int := 0;
BEGIN
  SELECT coalesce(max(rn), 0) INTO v_max FROM tmp_market_identity_etl;
  RAISE NOTICE 'Queued % vehicles for market identity & non-vehicle ETL', v_max;

  WHILE v_min <= v_max LOOP
    SELECT jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'vehicle_id', vehicle_id,
          'source', jsonb_build_object(
            'type', 'listing_url_slug',
            'ref', ref_url,
            'evidence', 'Deterministic identity & non-vehicle automobilia classification from authoritative listing URL slug and title'
          ),
          'corrections', jsonb_strip_nulls(
            jsonb_build_object(
              'listing_kind', CASE
                WHEN new_listing_kind IS NOT NULL AND new_listing_kind IS DISTINCT FROM cur_listing_kind
                THEN jsonb_build_object('value', new_listing_kind, 'expected', cur_listing_kind)
                ELSE NULL
              END,
              'make', CASE
                WHEN new_listing_kind IS NULL
                  AND new_make IS NOT NULL
                  AND new_make IS DISTINCT FROM cur_make
                  AND NOT EXISTS (
                    SELECT 1
                    FROM public.vehicles v_self
                    JOIN public.vehicles v_dup
                      ON v_dup.vin = v_self.vin
                     AND v_dup.make = new_make
                     AND v_dup.id <> v_self.id
                     AND v_dup.status IS DISTINCT FROM 'merged'
                    WHERE v_self.id = vehicle_id
                      AND v_self.vin IS NOT NULL
                      AND length(v_self.vin) < 17
                  )
                THEN jsonb_build_object('value', new_make, 'expected', cur_make)
                ELSE NULL
              END,
              'model', CASE
                WHEN new_listing_kind IS NULL AND new_model IS NOT NULL AND new_model IS DISTINCT FROM cur_model
                THEN jsonb_build_object('value', new_model, 'expected', cur_model)
                ELSE NULL
              END
            )
          )
        )
      )
    )
    INTO v_rows
    FROM tmp_market_identity_etl
    WHERE rn BETWEEN v_min AND (v_min + v_batch - 1)
      AND (
        (new_listing_kind IS NOT NULL AND new_listing_kind IS DISTINCT FROM cur_listing_kind)
        OR (new_listing_kind IS NULL AND new_make IS NOT NULL AND new_make IS DISTINCT FROM cur_make)
        OR (new_listing_kind IS NULL AND new_model IS NOT NULL AND new_model IS DISTINCT FROM cur_model)
      );

    IF v_rows IS NOT NULL AND jsonb_array_length(v_rows) > 0 THEN
      v_res := public.correct_vehicle_sale_provenance_batch(
        v_rows,
        'market-identity-etl-20261018',
        'Classify non-vehicle automobilia/parts/trailers out of vehicle treemap and populate missing/split make & model from listing URL slugs'
      );
      v_total_corrected := v_total_corrected + coalesce((v_res ->> 'vehicles_corrected')::int, 0);
      RAISE NOTICE 'Batch %..%: %', v_min, least(v_min + v_batch - 1, v_max), v_res;
    END IF;

    v_min := v_min + v_batch;
  END LOOP;

  RAISE NOTICE 'Total vehicles corrected in market identity ETL: %', v_total_corrected;
END;
$$;

-- Sync canonical_make_id for vehicles whose make was updated to a canonical make
UPDATE public.vehicles v
SET canonical_make_id = cm.id
FROM tmp_market_identity_etl t,
     public.canonical_makes cm
WHERE v.id = t.vehicle_id
  AND lower(cm.display_name) = lower(v.make)
  AND t.new_listing_kind IS NULL
  AND t.new_make IS NOT NULL
  AND v.canonical_make_id IS DISTINCT FROM cm.id;
