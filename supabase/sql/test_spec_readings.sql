-- Read-only checks for text_spec_matches_v2 (20261124020000). Each row must return ok = true.
WITH t(name, txt, src, mk, model, kind, code, expect) AS (VALUES
  ('cid',            'powered by a 455ci V8',                          'listing', 'Pontiac',   'Firebird', 'engine_cid',        '455',           true),
  ('speeds',         'paired with a four-speed manual transmission',   'listing', 'Pontiac',   'Firebird', 'trans_speeds',      '4',             true),
  ('type',           'paired with a four-speed manual transmission',   'listing', 'Pontiac',   'Firebird', 'trans_type',        'MANUAL',        true),
  ('axle',           'a 3.42 Safe-T-Track rear end',                   'listing', 'Pontiac',   'Firebird', 'axle_ratio',        '3.42',          true),
  ('axle to one',    'running 3.73:1 gears',                           'listing', 'Chevrolet', 'Camaro',   'axle_ratio',        '3.73',          true),
  ('build month',    'It was built in July 1973 at Norwood',           'listing', 'Pontiac',   'Firebird', 'build_date',        '1973-07',       true),
  ('build of part',  'The engine was built in July 1973',              'listing', 'Pontiac',   'Firebird', 'build_date',        '1973-07',       false),
  ('msrp',           'the original sticker price was $4,204',          'listing', 'Pontiac',   'Firebird', 'original_msrp',     '4204',          true),
  ('phs',            'accompanied by PHS documentation',               'listing', 'Pontiac',   'Firebird', 'documentation',     'PHS',           true),
  ('no build sheet', 'No build sheet was found.',                      'listing', 'Pontiac',   'Firebird', 'documentation',     'BUILD_SHEET',   false),
  ('marti',          'A Deluxe Marti Report is included',              'listing', 'Ford',      'Mustang',  'documentation',     'MARTI',         true),
  ('ford letter',    'an R-code 428 Cobra Jet car',                    'listing', 'Ford',      'Mustang',  'engine_code',       'R',             true),
  ('ford paint',     'Paint code T.',                                  'listing', 'Ford',      'Mustang',  'paint_code',        'T',             true),
  ('dso',            'DSO 84',                                         'listing', 'Ford',      'Mustang',  'dealer_zone',       '84',            true),
  ('trim code',      'trim code 232',                                  'listing', 'Pontiac',   'Firebird', 'interior_trim_code','232',           true),
  ('rpo label',      'RPO code U58',                                   'listing', 'Pontiac',   'Firebird', 'rpo_code',          'U58',           true),
  ('tire not rpo',   'F70-14 tires',                                   'listing', 'Pontiac',   'Firebird', 'rpo_code',          'F70',           false),
  ('m22',            'Muncie M22 rock crusher',                        'listing', 'Chevrolet', 'Camaro',   'trans_model',       'M22',           true),
  ('bmw m20',        'the M20 six',                                    'listing', 'BMW',       '325i',     'trans_model',       'M20',           false),
  ('trim title',     '1973 Pontiac Firebird Trans Am 455',             'title',   'Pontiac',   'Firebird', 'trim_level',        'TRANS_AM',      true),
  ('clone',          'This Trans Am clone started life as a base car', 'lead',    'Pontiac',   'Firebird', 'trim_level',        'TRANS_AM',      false),
  ('not a real',     'Not a real Trans Am.',                           'lead',    'Pontiac',   'Firebird', 'trim_level',        'TRANS_AM',      false),
  ('style stripes',  'Z/28-style stripes',                             'title',   'Chevrolet', 'Camaro',   'trim_level',        'Z28',           false),
  ('gt 390',         '1967 Ford Mustang GT 390',                       'title',   'Ford',      'Mustang',  'trim_level',        'GT',            true),
  ('gt350 not gt',   '1966 Ford Mustang GT-350',                       'title',   'Ford',      'Mustang',  'trim_level',        'GT',            false),
  ('body',           '1969 Ford Mustang Fastback',                     'title',   'Ford',      'Mustang',  'body_style',        'FASTBACK',      true),
  ('dealer',         'It was sold new at Example Pontiac in Ohio',     'listing', 'Pontiac',   'Firebird', 'selling_dealer',    'STATED',        true))
SELECT t.name, t.expect = EXISTS (SELECT 1 FROM public.text_spec_matches_v2(t.txt, t.src, t.mk, t.model) m
                                   WHERE m.kind = t.kind AND m.code = t.code) AS ok
  FROM t ORDER BY ok, t.name;
