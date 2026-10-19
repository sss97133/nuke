import { supabase } from '../supabase';
import { KNOWN_MAKES, MAKE_ALIASES } from './dictionaries';

export interface ResolvedMarketScope {
  make: string;
  family?: string;
  family_name?: string;
  model?: string;
  year?: number;
  era?: string;
}

interface FamilyMarketRow {
  brand: string;
  family_key: string;
  family: string | null;
  model_key: string;
  model: string | null;
  sold: number | null;
  usd: number | null;
}

// Cultural / generational shorthands that map directly to a canonical brand + family/model query
const CULTURAL_SCOPE_ALIASES: Array<{
  pattern: RegExp;
  make: string;
  familyHint: string;
  modelHint?: string;
  era?: string;
}> = [
  {
    pattern: /\b(square\s*body|squarebody|73\s*[-–/to]+\s*87\s*(gm|chevy|chevrolet|gmc)?(\s*trucks?|\s*pickups?|\s*c\/?k)?)\b/i,
    make: 'Chevrolet',
    familyHint: 'C10',
    era: '1973-1987',
  },
  {
    pattern: /\b(action\s*line|67\s*[-–/to]+\s*72\s*(gm|chevy|chevrolet|gmc)?(\s*trucks?|\s*pickups?|\s*c\/?k)?)\b/i,
    make: 'Chevrolet',
    familyHint: 'C10',
    era: '1967-1972',
  },
  {
    pattern: /\b(fox\s*body|foxbody)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    era: '1979-1993',
  },
  {
    pattern: /\b(early\s*bronco)\b/i,
    make: 'Ford',
    familyHint: 'Bronco',
    era: '1966-1977',
  },
  {
    pattern: /\b(shelby\s*gt\s*350\w*)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Shelby GT350',
  },
  {
    pattern: /\b(shelby\s*gt\s*500\w*)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Shelby GT500',
  },
  {
    pattern: /\b(boss\s*302)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Mustang Boss 302',
  },
  {
    pattern: /\b(boss\s*429)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Mustang Boss 429',
  },
  {
    pattern: /\b(mach\s*1)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Mustang Mach 1',
  },
  {
    pattern: /\b(pagoda|w113|230\s*sl|250\s*sl|280\s*sl)\b/i,
    make: 'Mercedes-Benz',
    familyHint: 'SL',
    era: '1963-1971',
  },
  {
    pattern: /\b(gullwing|300\s*sl)\b/i,
    make: 'Mercedes-Benz',
    familyHint: 'SL',
    modelHint: '300SL',
    era: '1954-1963',
  },
  {
    pattern: /\b(e30\s*m3)\b/i,
    make: 'BMW',
    familyHint: 'M3',
    era: '1986-1991',
  },
  {
    pattern: /\b(e36\s*m3)\b/i,
    make: 'BMW',
    familyHint: 'M3',
    era: '1992-1999',
  },
  {
    pattern: /\b(e46\s*m3)\b/i,
    make: 'BMW',
    familyHint: 'M3',
    era: '2000-2006',
  },
  {
    pattern: /\b(e9\b|3\.0\s*cs[il]?)\b/i,
    make: 'BMW',
    familyHint: '3.0 CSL',
  },
  {
    pattern: /\b(993(?:\s+911)?|911\s+993)\b/i,
    make: 'Porsche',
    familyHint: '911',
    era: '1995-1998',
  },
  {
    pattern: /\b(964(?:\s+911)?|911\s+964)\b/i,
    make: 'Porsche',
    familyHint: '911',
    era: '1989-1994',
  },
  {
    pattern: /\b(split\s*window|c2\s*corvette|sting\s*ray\s*c2)\b/i,
    make: 'Chevrolet',
    familyHint: 'Corvette',
    era: '1963-1967',
  },
  {
    pattern: /\b(p\s*1800\w*|1800\s*(?:s|e|es))\b/i,
    make: 'Volvo',
    familyHint: 'P1800',
  },
  {
    pattern: /\b(defender\s*(?:90|110|130))\b/i,
    make: 'Land Rover',
    familyHint: 'Defender',
  },
  {
    pattern: /\b(syclone)\b/i,
    make: 'GMC',
    familyHint: 'Syclone',
  },
  {
    pattern: /\b(grand\s*national|gnx)\b/i,
    make: 'Buick',
    familyHint: 'Grand National',
  },
  {
    pattern: /\b(2000\s*gt)\b/i,
    make: 'Toyota',
    familyHint: '2000GT',
  },
  {
    pattern: /\b(fj[-\s]?4[035]|fj[-\s]?55|fj[-\s]?6[02]|fzj[-\s]?80|uzj[-\s]?100)\b/i,
    make: 'Toyota',
    familyHint: 'Land Cruiser',
  },
  {
    pattern: /\b((?:datsun|nissan)?\s*510\b)/i,
    make: 'Nissan',
    familyHint: '510',
  },
  {
    pattern: /\b(fairlady(?:\s+roadster)?|(?:1600|2000)\s+roadster)\b/i,
    make: 'Nissan',
    familyHint: 'Roadster',
  },
  {
    pattern: /\b(figaro)\b/i,
    make: 'Nissan',
    familyHint: 'Figaro',
  },
  {
    pattern: /\b(cr[-\s]?x(?:\s+si)?)\b/i,
    make: 'Honda',
    familyHint: 'CRX',
  },
  {
    pattern: /\b(gsx(?:\s+stage\s*1)?)\b/i,
    make: 'Buick',
    familyHint: 'GS',
  },
  {
    pattern: /\b(vista\s*cruiser)\b/i,
    make: 'Oldsmobile',
    familyHint: 'Vista Cruiser',
  },
  {
    pattern: /\b(coupe\s*de\s*ville|sedan\s*de\s*ville)\b/i,
    make: 'Cadillac',
    familyHint: 'DeVille',
  },
  {
    pattern: /\b(540\s*k|500\s*k)\b/i,
    make: 'Mercedes-Benz',
    familyHint: '540K',
  },
  {
    pattern: /\b(delta\s*integrale(?:\s*evo(?:\s*2)?)?|lancia\s+delta)\b/i,
    make: 'Lancia',
    familyHint: 'Delta Integrale',
  },
  {
    pattern: /\b(ur[-\s]?quattro|sport\s*quattro)\b/i,
    make: 'Audi',
    familyHint: 'Quattro',
  },
  {
    pattern: /\b(r3[234]\s*(?:gt[-\s]?r|skyline)?|skyline\s*gt[-\s]?r|hakosuka|kenmeri)\b/i,
    make: 'Nissan',
    familyHint: 'Skyline',
  },
  {
    pattern: /\b(sunbeam\s+tiger)\b/i,
    make: 'Sunbeam',
    familyHint: 'Tiger',
  },
  {
    pattern: /\b(meyers\s+manx|manx\s+dune\s+buggy)\b/i,
    make: 'Meyers',
    familyHint: 'Manx',
  },
  {
    pattern: /\b(w123|w124|240\s*d|300\s*td|500\s*e)\b/i,
    make: 'Mercedes-Benz',
    familyHint: 'E-Class',
  },
  {
    pattern: /\b(series\s*ii\s*a|series\s*iii|land\s*rover\s*88|land\s*rover\s*109)\b/i,
    make: 'Land Rover',
    familyHint: 'Series',
  },
  {
    pattern: /\b(ducati\s*(?:916|996|998|748)|916\s*sps|916\s*senna)\b/i,
    make: 'Ducati',
    familyHint: '916',
  },
  {
    pattern: /\b(mh\s*900\s*e|paul\s*smart\s*1000)\b/i,
    make: 'Ducati',
    familyHint: 'SportClassic',
  },
  {
    pattern: /\b(caterham\s*(?:super\s*)?(?:seven|7)|super\s*seven)\b/i,
    make: 'Caterham',
    familyHint: 'Seven',
  },
  {
    pattern: /\b(tvr\s*(?:griffith|chimaera|cerbera|tuscan|sagaris|2500\s*m|vixen|grantura)|chimaera|cerbera|sagaris)\b/i,
    make: 'TVR',
    familyHint: 'Griffith',
  },
  {
    pattern: /\b(jensen\s*(?:interceptor|healey|ff)|interceptor\s*(?:mk\s*)?iii)\b/i,
    make: 'Jensen',
    familyHint: 'Interceptor',
  },
  {
    pattern: /\b(stutz\s*(?:bearcat|blackhawk)|bearcat)\b/i,
    make: 'Stutz',
    familyHint: 'Bearcat',
  },
  {
    pattern: /\b(delage\s*d[68](?:[-\s]?120)?)\b/i,
    make: 'Delage',
    familyHint: 'D8',
  },
  {
    pattern: /\b(lead\s*sled|mercury\s*eight|merc\s*eight)\b/i,
    make: 'Mercury',
    familyHint: 'Eight',
  },
  {
    pattern: /\b(vehicross)\b/i,
    make: 'Isuzu',
    familyHint: 'VehiCROSS',
  },
  {
    pattern: /\b(205\s*(?:gti|t16|rallye)|peugeot\s*205)\b/i,
    make: 'Peugeot',
    familyHint: '205',
  },
  {
    pattern: /\b(hayabusa|gsx\s*1300\s*r|rg\s*500\s*gamma)\b/i,
    make: 'Suzuki',
    familyHint: 'GSX-R',
  },
  {
    pattern: /\b(suzuki\s*carry|carry\s*(?:pickup|dump\s*truck|kei))\b/i,
    make: 'Suzuki',
    familyHint: 'Carry',
  },
  {
    pattern: /\b(rd\s*(?:350|400)|rz\s*(?:350|500)|tz\s*750)\b/i,
    make: 'Yamaha',
    familyHint: 'RD350',
  },
  {
    pattern: /\b(260\s*z)\b/i,
    make: 'Nissan',
    familyHint: '260Z',
  },
  {
    pattern: /\b(big\s*healey|healey\s*3000|bj8|bt7|bn7)\b/i,
    make: 'Austin-Healey',
    familyHint: '3000',
  },
  {
    pattern: /\b(fd3s|fc3s|fb\s*rx[-\s]?7|rx[-\s]?7)\b/i,
    make: 'Mazda',
    familyHint: 'RX-7',
  },
  {
    pattern: /\b(koenigsegg\s*(?:regera|agera|jesko|cc8s|ccx|ccxr|ccgt|gemera)|regera|agera\s*rs|jesko)\b/i,
    make: 'Koenigsegg',
    familyHint: 'Regera',
  },
  {
    pattern: /\b(lagonda\s*(?:lg\s*45|lg\s*6|m\s*45|rapide|taraf)|lg45r?)\b/i,
    make: 'Lagonda',
    familyHint: 'LG45',
  },
  {
    pattern: /\b(pierce[-\s]?arrow\s*(?:silver\s*arrow|1247|1245|twelve)|silver\s*arrow)\b/i,
    make: 'Pierce-Arrow',
    familyHint: 'Twelve',
  },
  {
    pattern: /\b(pierce[-\s]?arrow\s*(?:model\s*48|model\s*66|great\s*arrow)|great\s*arrow)\b/i,
    make: 'Pierce-Arrow',
    familyHint: 'Model 48',
  },
  {
    pattern: /\b(isotta\s*fraschini|tipo\s*8\s*a)\b/i,
    make: 'Isotta Fraschini',
    familyHint: 'Tipo 8A',
  },
  {
    pattern: /\b(siata\s*(?:208\s*s?|300\s*bc|daina)|208\s*s\s*spider)\b/i,
    make: 'Siata',
    familyHint: '208S',
  },
  {
    pattern: /\b(bizzarrini\s*(?:5300\s*gt|strada|p538)|5300\s*gt\s*strada)\b/i,
    make: 'Bizzarrini',
    familyHint: '5300 GT',
  },
  {
    pattern: /\b(lola\s*t\s*(?:70|90|160|163|332)|t70\s*mk)\b/i,
    make: 'Lola',
    familyHint: 'T70',
  },
  {
    pattern: /\b(horch\s*(?:853|853a|780|851)|853\s*sport\s*cabriolet)\b/i,
    make: 'Horch',
    familyHint: '853',
  },
  {
    pattern: /\b(maybach\s*sw[-\s]?38|sw[-\s]?38\s*special)\b/i,
    make: 'Maybach',
    familyHint: 'SW38',
  },
  {
    pattern: /\b(lister\s*(?:knobbly|costin|jaguar)|knobbly)\b/i,
    make: 'Lister',
    familyHint: 'Knobbly',
  },
  {
    pattern: /\b(daytona\s*sp3|monza\s*sp[12])\b/i,
    make: 'Ferrari',
    familyHint: 'Daytona SP3',
  },
  {
    pattern: /\b(rolls[-\s]?royce\s*(?:20\/25|25\/30|20\s*hp)|20\/25\s*hp|25\/30\s*hp)\b/i,
    make: 'Rolls-Royce',
    familyHint: '20/25',
  },
  {
    pattern: /\b(jaguar\s*ss\s*100|ss\s*100\s*(?:2\.5|3\.5|roadster))\b/i,
    make: 'Jaguar',
    familyHint: 'SS100',
  },
  {
    pattern: /\b(sc\/rambler|hurst\s*sc\s*rambler|amc\s*(?:rambler|marlin))\b/i,
    make: 'AMC',
    familyHint: 'Rambler',
  },
  {
    pattern: /\b(valkyrie|valhalla|one[-\s]?77|aston\s*martin\s*vulcan)\b/i,
    make: 'Aston Martin',
    familyHint: 'Valkyrie',
  },
  {
    pattern: /\b(aston\s*martin\s*ulster|db\s*mk\s*ii)\b/i,
    make: 'Aston Martin',
    familyHint: 'Ulster',
  },
  {
    pattern: /\b(ferrari\s*(?:312\s*t|f2002|f300|641|642|126\s*c2)|312\s*t)\b/i,
    make: 'Ferrari',
    familyHint: '312T',
  },
  {
    pattern: /\b(500\s*trc|340\s*mm|342\s*america|195\s*inter|500\s*mondial)\b/i,
    make: 'Ferrari',
    familyHint: '500 TRC',
  },
  {
    pattern: /\b(porsche\s*(?:917|956|962)|917\s*k)\b/i,
    make: 'Porsche',
    familyHint: '917',
  },
  {
    pattern: /\b(bugatti\s*(?:type\s*59|type\s*54|type\s*51|type\s*39|type\s*37|type\s*35)|type\s*59|type\s*35)\b/i,
    make: 'Bugatti',
    familyHint: 'Type 35',
  },
  {
    pattern: /\b(bugatti\s*(?:mistral|divo|centodieci|bolide|chiron)|w16\s*mistral)\b/i,
    make: 'Bugatti',
    familyHint: 'Chiron',
  },
  {
    pattern: /\b(lamborghini\s*(?:sian|sián|essenza|centenario|veneno|temerario)|sian\s*fkp\s*37|essenza\s*scv12)\b/i,
    make: 'Lamborghini',
    familyHint: 'Sian',
  },
  {
    pattern: /\b(alfa\s*romeo\s*tipo\s*33|tipo\s*33|t33\/2)\b/i,
    make: 'Alfa Romeo',
    familyHint: 'Tipo 33',
  },
  {
    pattern: /\b(lancia\s*(?:lambda|astura|aprilia|dilambda)|lambda)\b/i,
    make: 'Lancia',
    familyHint: 'Lambda',
  },
  {
    pattern: /\b(lancia\s*(?:037|rally\s*037|delta\s*s4)|rally\s*037|037\s*stradale)\b/i,
    make: 'Lancia',
    familyHint: '037',
  },
  {
    pattern: /\b(avions\s*voisin|voisin\s*c\d+)\b/i,
    make: 'Avions Voisin',
    familyHint: 'C25',
  },
  {
    pattern: /\b(osca\s*(?:1600\s*gt|mt4|750)|mt4\s*spider)\b/i,
    make: 'Osca',
    familyHint: '1600 GT',
  },
  {
    pattern: /\b(norton\s*(?:commando|manx|dominator|atlas)|commando\s*(?:750|850|961))\b/i,
    make: 'Norton',
    familyHint: 'Commando',
  },
  {
    pattern: /\b(bsa\s*(?:gold\s*star|a10|a65|spitfire|victor)|gold\s*star)\b/i,
    make: 'BSA',
    familyHint: 'Gold Star',
  },
  {
    pattern: /\b(bultaco\s*(?:pursang|sherpa|matador|metralla)|pursang)\b/i,
    make: 'Bultaco',
    familyHint: 'Pursang',
  },
  {
    pattern: /\b(mv\s*agusta|agusta\s*(?:f4|brutale|750))\b/i,
    make: 'MV Agusta',
    familyHint: '750 S',
  },
  {
    pattern: /\b(moto\s*guzzi|guzzi\s*(?:v7|le\s*mans|falcone))\b/i,
    make: 'Moto Guzzi',
    familyHint: 'V7 Sport',
  },
  {
    pattern: /\b(tatra\s*(?:t87|t77a?|t600|603)|tatraplan)\b/i,
    make: 'Tatra',
    familyHint: 'T87',
  },
  {
    pattern: /\b(opel\s*(?:gt|kadett|manta|speedster))\b/i,
    make: 'Opel',
    familyHint: 'GT',
  },
  {
    pattern: /\b(monteverdi\s*(?:high\s*speed|375|hai)|high\s*speed\s*375)\b/i,
    make: 'Monteverdi',
    familyHint: 'High Speed 375',
  },
  {
    pattern: /\b(radical\s*(?:sr3|sr8|sr10|rxc))\b/i,
    make: 'Radical',
    familyHint: 'SR3',
  },
  {
    pattern: /\b(winnebago\s*(?:revel|minnie\s*winnie|view|navion|brave|chieftain))\b/i,
    make: 'Winnebago',
    familyHint: 'Revel',
  },
  {
    pattern: /\b(peterbilt\s*(?:359|379|389|350|352))\b/i,
    make: 'Peterbilt',
    familyHint: '359',
  },
  {
    pattern: /\b(kenworth\s*(?:w900|k100|bullnose))\b/i,
    make: 'Kenworth',
    familyHint: 'W900',
  },
  {
    pattern: /\b(local\s*motors\s*rally\s*fighter|rally\s*fighter)\b/i,
    make: 'Local',
    familyHint: 'Rally Fighter',
  },
  {
    pattern: /\b(autozam\s*az[-\s]?1|az[-\s]?1\s*mazdaspeed)\b/i,
    make: 'Autozam',
    familyHint: 'AZ-1',
  },
  {
    pattern: /\b(scion\s*(?:fr[-\s]?s|xb|tc|iq)|fr[-\s]?s)\b/i,
    make: 'Scion',
    familyHint: 'FR-S',
  },
  {
    pattern: /\b(smart\s*(?:fortwo|crossblade|roadster)|fortwo)\b/i,
    make: 'Smart',
    familyHint: 'Fortwo',
  },
  {
    pattern: /\b(checker\s*(?:marathon|a[-\s]?11|a[-\s]?12|aerobus))\b/i,
    make: 'Checker',
    familyHint: 'Marathon',
  },
  {
    pattern: /\b(divco\s*(?:milk\s*truck|b100|300))\b/i,
    make: 'Divco',
    familyHint: 'Milk Truck',
  },
  {
    pattern: /\b(vanderhall\s*(?:venice|carmel|laguna))\b/i,
    make: 'Vanderhall',
    familyHint: 'Venice',
  },
  {
    pattern: /\b(steyr[-\s]*puch\s*(?:pinzgauer|haflinger)|pinzgauer\s*(?:710|712))\b/i,
    make: 'Steyr-Puch',
    familyHint: 'Pinzgauer',
  },
  {
    pattern: /\b(mosler\s*(?:mt900s?|consulier|gtp)|consulier\s*gtp)\b/i,
    make: 'Mosler',
    familyHint: 'MT900',
  },
  {
    pattern: /\b(vector\s*(?:m[-\s]?12|w8))\b/i,
    make: 'Vector',
    familyHint: 'M12',
  },
  {
    pattern: /\b(hennessey\s*(?:venom\s*(?:gt|f5)|velociraptor|mammoth|exorcist)|venom\s*gt)\b/i,
    make: 'Hennessey',
    familyHint: 'Venom GT',
  },
  {
    pattern: /\b(rezvani\s*(?:tank|beast|vengeance))\b/i,
    make: 'Rezvani',
    familyHint: 'Tank',
  },
  {
    pattern: /\b(arnolt[-\s]*bristol|bolide)\b/i,
    make: 'Arnolt-Bristol',
    familyHint: 'Bolide',
  },
  {
    pattern: /\b(kaiser[-\s]*darrin(?:\s*161)?)\b/i,
    make: 'Kaiser-Darrin',
    familyHint: '161',
  },
  {
    pattern: /\b(laverda\s*(?:750\s*sfc?|1000\s*jota|jota|rgs))\b/i,
    make: 'Laverda',
    familyHint: '750 SFC',
  },
  {
    pattern: /\b(bimota\s*(?:tesi|db\d|sb\d|kb1|hb1|yb\d+))\b/i,
    make: 'Bimota',
    familyHint: 'Tesi',
  },
  {
    pattern: /\b(vespa\s*(?:400|gs\s*160|946|sprint|rally|primavera))\b/i,
    make: 'Vespa',
    familyHint: '400',
  },
  {
    pattern: /\b(cushman\s*(?:eagle|truckster|pacemaker|husky))\b/i,
    make: 'Cushman',
    familyHint: 'Eagle',
  },
  {
    pattern: /\b((?:plymouth\s+)?hemi\s+road\s*runner)\b/i,
    make: 'Plymouth',
    familyHint: 'Road Runner',
    modelHint: 'Hemi Road Runner',
  },
  {
    pattern: /\b((?:plymouth\s+)?road\s*runner)\b/i,
    make: 'Plymouth',
    familyHint: 'Road Runner',
  },
  {
    pattern: /\b((?:plymouth\s+)?(?:hemi\s+)?(?:'?cuda|barracuda))\b/i,
    make: 'Plymouth',
    familyHint: 'Barracuda',
  },
  {
    pattern: /\b((?:plymouth\s+)?superbird)\b/i,
    make: 'Plymouth',
    familyHint: 'Superbird',
  },
];

// Words that indicate a natural-language filter query rather than a market scope drill
const NL_FILTER_WORDS = /\b(under|over|below|above|less\s+than|more\s+than|between|near|within|miles|mileage|clean\s+title|salvage|no\s+reserve|with\s+a|without)\b|\$\d/i;

export function isOnMarketTab(pathname: string, search: string): boolean {
  if (pathname !== '/') return false;
  const tab = new URLSearchParams(search).get('tab');
  return !tab || tab === 'market';
}

export function buildMarketScopeUrl(scope: ResolvedMarketScope, currentSearch = ''): string {
  const next = new URLSearchParams(currentSearch);
  next.set('tab', 'market');
  next.set('make', scope.make);
  if (scope.family) next.set('family', scope.family);
  else next.delete('family');
  if (scope.family_name) next.set('family_name', scope.family_name);
  else next.delete('family_name');
  if (scope.model) next.set('model', scope.model);
  else next.delete('model');
  if (scope.year != null && Number.isFinite(scope.year)) next.set('year', String(scope.year));
  else next.delete('year');
  if (scope.era) next.set('era', scope.era);
  else next.delete('era');
  ['lot', 'inspect', 'board', 'mapFocus', 'mapChild'].forEach((k) => next.delete(k));
  return `/?${next.toString()}`;
}

/**
 * Resolves a human search query on the Market page ("mustang", "ford mustang", "1967 mustang",
 * "corvette", "squarebody", "73-87 gm trucks", "porsche 911 gt3") to a Market URL scope.
 * Returns null if the query is a complex filter query or does not match any known brand/family.
 */
export function resolveSynchronousMarketAlias(rawQuery: string): ResolvedMarketScope | null {
  const q = rawQuery.trim();
  if (!q || q.length > 80 || NL_FILTER_WORDS.test(q)) return null;
  let year: number | undefined;
  const yearMatch = q.match(/(?:^|\s)((?:19[0-9]{2}|20[0-2][0-9]))(?:\s|$)/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }
  for (const alias of CULTURAL_SCOPE_ALIASES) {
    if (alias.pattern.test(q)) {
      return {
        make: alias.make,
        family_name: alias.familyHint,
        model: alias.modelHint ?? alias.familyHint,
        ...(alias.era ? { era: alias.era } : {}),
        ...(year ? { year } : {}),
      };
    }
  }
  return null;
}

export async function resolveMarketScopeQuery(rawQuery: string): Promise<ResolvedMarketScope | null> {
  const q = rawQuery.trim();
  if (!q || q.length > 80) return null;
  if (NL_FILTER_WORDS.test(q)) return null;

  // 1. Check cultural / generational shorthand first ("squarebody", "73-87 gm trucks", "fox body", "shelby gt350", etc.)
  for (const alias of CULTURAL_SCOPE_ALIASES) {
    if (alias.pattern.test(q)) {
      const resolved = await lookupFamilyInMarket(alias.make, alias.familyHint, alias.modelHint ?? null, null);
      if (resolved) return { ...resolved, ...(alias.era ? { era: alias.era } : {}) };
      return { make: alias.make, model: alias.modelHint ?? alias.familyHint, ...(alias.era ? { era: alias.era } : {}) };
    }
  }

  // 2. Extract optional 4-digit year (e.g. "1967 ford mustang" or "mustang 1967")
  let year: number | null = null;
  let rest = q;
  const yearMatch = rest.match(/(?:^|\s)((?:19[0-9]{2}|20[0-2][0-9]))(?:\s|$)/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    rest = rest.replace(yearMatch[0], ' ').trim();
  }

  const normalized = rest.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();

  // 3. Check if the entire remaining string is just a brand ("ford", "chevy", "porsche", "mercedes-benz")
  const directMake = matchBrandOnly(lower);
  if (directMake && year == null) {
    return { make: directMake };
  }

  // 4. Split leading brand if present ("ford mustang mach 1" -> make: "Ford", remainder: "mustang mach 1")
  const { make, remainder } = splitLeadingBrand(normalized);
  const targetTerm = (remainder || normalized).trim();
  if (!targetTerm) {
    return make ? { make } : null;
  }

  return lookupFamilyInMarket(make, targetTerm, remainder ? remainder : null, year);
}

function matchBrandOnly(lower: string): string | null {
  const cleaned = lower.replace(/[^a-z0-9\s-]/g, '').trim();
  if (MAKE_ALIASES[cleaned]) return MAKE_ALIASES[cleaned];
  const found = KNOWN_MAKES.find((m) => m.toLowerCase() === cleaned);
  return found ?? null;
}

function splitLeadingBrand(text: string): { make: string | null; remainder: string } {
  const lower = text.toLowerCase();
  // Check two-word brands first ("alfa romeo", "aston martin", "land rover", "mercedes benz", "rolls royce", "de tomaso")
  const candidates: Array<{ phrase: string; canonical: string }> = [
    ...KNOWN_MAKES.map((m) => ({ phrase: m.toLowerCase(), canonical: m })),
    ...KNOWN_MAKES.filter((m) => m.includes('-')).map((m) => ({ phrase: m.toLowerCase().replace(/-/g, ' '), canonical: m })),
    ...Object.entries(MAKE_ALIASES).map(([k, v]) => ({ phrase: k.toLowerCase(), canonical: v })),
  ].sort((a, b) => b.phrase.length - a.phrase.length);

  for (const c of candidates) {
    if (lower === c.phrase) {
      return { make: c.canonical, remainder: '' };
    }
    if (lower.startsWith(`${c.phrase} `)) {
      return { make: c.canonical, remainder: text.slice(c.phrase.length).trim() };
    }
  }
  return { make: null, remainder: text };
}

async function lookupFamilyInMarket(
  make: string | null,
  term: string,
  explicitModelHint: string | null,
  year: number | null,
): Promise<ResolvedMarketScope | null> {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return make ? { make } : null;

  try {
    let query = supabase
      .from('mv_family_market')
      .select('brand, family_key, family, model_key, model, sold, usd')
      .neq('family_key', 'other')
      .gt('sold', 0)
      .order('usd', { ascending: false })
      .limit(100);

    if (make) {
      query = query.eq('brand', make);
    }
    const normKey = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
    const cleanNorm = normKey(cleanTerm);
    const firstWord = cleanTerm.split(/[\s-]+/)[0];
    if (firstWord && firstWord.length >= 2) {
      const searchPrefix = !cleanTerm.includes(' ') && firstWord.length >= 7 ? firstWord.slice(0, 4) : firstWord;
      query = query.ilike('model_key', `%${searchPrefix}%`);
    }

    const { data, error } = await Promise.resolve(query);
    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return make ? { make, model: explicitModelHint ?? term, ...(year ? { year } : {}) } : null;
    }

    const rows = data as FamilyMarketRow[];
    // Aggregate families by (brand, family_key) so we pick the highest-dollar family whose name or model matches
    const families = new Map<string, {
      brand: string;
      familyKey: string;
      familyName: string;
      totalUsd: number;
      exactFamily: boolean;
      exactModel: string | null;
      prefixModel: string | null;
    }>();

    for (const r of rows) {
      if (!r.family || !r.family_key || r.family_key === 'other') continue;
      const famLower = r.family.toLowerCase();
      const modLower = (r.model_key || r.model || '').toLowerCase();
      const famNorm = normKey(famLower);
      const modNorm = normKey(modLower);
      const isExactFamily = famLower === cleanTerm || (cleanNorm.length >= 3 && famNorm === cleanNorm);
      const isExactModel = !isExactFamily && (modLower === cleanTerm || (cleanNorm.length >= 3 && modNorm === cleanNorm));
      const isFamilyPrefix = cleanTerm.startsWith(`${famLower} `) || cleanTerm.startsWith(`${famLower}-`) || (famNorm.length >= 3 && cleanNorm.startsWith(famNorm) && cleanNorm !== famNorm);
      const isModelMatch = modLower.includes(cleanTerm) || cleanTerm.includes(famLower) || (cleanNorm.length >= 4 && (modNorm.includes(cleanNorm) || cleanNorm.includes(famNorm)));

      if (!isExactFamily && !isExactModel && !isFamilyPrefix && !isModelMatch) continue;

      const key = `${r.brand}:${r.family_key}`;
      const prev = families.get(key) ?? {
        brand: r.brand,
        familyKey: r.family_key,
        familyName: r.family,
        totalUsd: 0,
        exactFamily: false,
        exactModel: null,
        prefixModel: null,
      };
      prev.totalUsd += Number(r.usd) || 0;
      if (isExactFamily) prev.exactFamily = true;
      if (isExactModel && r.model) prev.exactModel = r.model;
      else if (isFamilyPrefix && (modLower.includes(cleanTerm) || modNorm.includes(cleanNorm)) && r.model && !prev.prefixModel) {
        prev.prefixModel = r.model;
      }
      families.set(key, prev);
    }

    const best = [...families.values()].sort((a, b) => {
      if (a.exactFamily !== b.exactFamily) return a.exactFamily ? -1 : 1;
      if ((a.exactModel != null) !== (b.exactModel != null)) return a.exactModel != null ? -1 : 1;
      return b.totalUsd - a.totalUsd;
    })[0];

    if (!best) {
      return make ? { make } : null;
    }

    // If the user typed a sub-model ("mustang mach 1", "911 gt3") or a specific year ("1967 mustang"), include model
    const explicitDiffersFromFamily =
      explicitModelHint && normKey(explicitModelHint) !== normKey(best.familyName);
    const subModel = explicitDiffersFromFamily
      ? explicitModelHint
      : !best.exactFamily
        ? (best.exactModel ?? best.prefixModel ?? undefined)
        : (year != null ? (best.exactModel ?? best.familyName) : undefined);

    return {
      make: best.brand,
      family: best.familyKey,
      family_name: best.familyName,
      ...(subModel ? { model: subModel } : {}),
      ...(year != null ? { year } : {}),
    };
  } catch {
    return make ? { make } : null;
  }
}
