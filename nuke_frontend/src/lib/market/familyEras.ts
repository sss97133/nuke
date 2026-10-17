export interface FamilyEraCohort {
  id: string;
  label: string;
  shortLabel: string;
  yearStart: number;
  yearEnd: number;
}

const CK_TRUCK_ERAS: FamilyEraCohort[] = [
  { id: '1960-1966', label: "1st Gen '60–'66", shortLabel: "'60–'66", yearStart: 1960, yearEnd: 1966 },
  { id: '1967-1972', label: "Action Line '67–'72", shortLabel: "Action Line '67–'72", yearStart: 1967, yearEnd: 1972 },
  { id: '1973-1987', label: "Squarebody '73–'87", shortLabel: "Squarebody '73–'87", yearStart: 1973, yearEnd: 1987 },
  { id: '1988-1998', label: "GMT400 '88–'98", shortLabel: "GMT400 '88–'98", yearStart: 1988, yearEnd: 1998 },
];

const CURATED_FAMILY_ERAS: Record<string, FamilyEraCohort[]> = {
  'ford:mustang': [
    { id: '1964-1973', label: "1st Gen '64–'73", shortLabel: "1st Gen '64–'73", yearStart: 1964, yearEnd: 1973 },
    { id: '1974-1978', label: "Mustang II '74–'78", shortLabel: "Mustang II", yearStart: 1974, yearEnd: 1978 },
    { id: '1979-1993', label: "Fox Body '79–'93", shortLabel: "Fox Body '79–'93", yearStart: 1979, yearEnd: 1993 },
    { id: '1994-2004', label: "SN95 '94–'04", shortLabel: "SN95 '94–'04", yearStart: 1994, yearEnd: 2004 },
    { id: '2005-2014', label: "S197 '05–'14", shortLabel: "S197 '05–'14", yearStart: 2005, yearEnd: 2014 },
    { id: '2015-2023', label: "S550 '15–'23", shortLabel: "S550 '15–'23", yearStart: 2015, yearEnd: 2023 },
    { id: '2024-2030', label: "S650 '24+", shortLabel: "S650 '24+", yearStart: 2024, yearEnd: 2030 },
  ],
  'chevrolet:corvette': [
    { id: '1953-1962', label: "C1 '53–'62", shortLabel: 'C1', yearStart: 1953, yearEnd: 1962 },
    { id: '1963-1967', label: "C2 '63–'67", shortLabel: 'C2', yearStart: 1963, yearEnd: 1967 },
    { id: '1968-1982', label: "C3 '68–'82", shortLabel: 'C3', yearStart: 1968, yearEnd: 1982 },
    { id: '1984-1996', label: "C4 '84–'96", shortLabel: 'C4', yearStart: 1984, yearEnd: 1996 },
    { id: '1997-2004', label: "C5 '97–'04", shortLabel: 'C5', yearStart: 1997, yearEnd: 2004 },
    { id: '2005-2013', label: "C6 '05–'13", shortLabel: 'C6', yearStart: 2005, yearEnd: 2013 },
    { id: '2014-2019', label: "C7 '14–'19", shortLabel: 'C7', yearStart: 2014, yearEnd: 2019 },
    { id: '2020-2030', label: "C8 '20+", shortLabel: 'C8', yearStart: 2020, yearEnd: 2030 },
  ],
  'chevrolet:camaro': [
    { id: '1967-1969', label: "1st Gen '67–'69", shortLabel: "1st Gen '67–'69", yearStart: 1967, yearEnd: 1969 },
    { id: '1970-1981', label: "2nd Gen '70–'81", shortLabel: "2nd Gen '70–'81", yearStart: 1970, yearEnd: 1981 },
    { id: '1982-1992', label: "3rd Gen '82–'92", shortLabel: "3rd Gen '82–'92", yearStart: 1982, yearEnd: 1992 },
    { id: '1993-2002', label: "4th Gen '93–'02", shortLabel: "4th Gen '93–'02", yearStart: 1993, yearEnd: 2002 },
    { id: '2010-2015', label: "5th Gen '10–'15", shortLabel: "5th Gen '10–'15", yearStart: 2010, yearEnd: 2015 },
    { id: '2016-2025', label: "6th Gen '16–'24", shortLabel: "6th Gen '16–'24", yearStart: 2016, yearEnd: 2025 },
  ],
  'chevrolet:c10': CK_TRUCK_ERAS,
  'chevrolet:k10': CK_TRUCK_ERAS,
  'chevrolet:c20': CK_TRUCK_ERAS,
  'chevrolet:k20': CK_TRUCK_ERAS,
  'chevrolet:c30': CK_TRUCK_ERAS,
  'chevrolet:k30': CK_TRUCK_ERAS,
  'chevrolet:c1500': CK_TRUCK_ERAS,
  'chevrolet:k1500': CK_TRUCK_ERAS,
  'gmc:c1500': CK_TRUCK_ERAS,
  'gmc:k1500': CK_TRUCK_ERAS,
  'gmc:c2500': CK_TRUCK_ERAS,
  'gmc:k2500': CK_TRUCK_ERAS,
  'gmc:c3500': CK_TRUCK_ERAS,
  'gmc:k3500': CK_TRUCK_ERAS,
  'porsche:911': [
    { id: '1964-1973', label: "F-Body '64–'73", shortLabel: 'F-Body', yearStart: 1964, yearEnd: 1973 },
    { id: '1974-1988', label: "G-Body '74–'88", shortLabel: 'G-Body', yearStart: 1974, yearEnd: 1988 },
    { id: '1989-1994', label: "964 '89–'94", shortLabel: '964', yearStart: 1989, yearEnd: 1994 },
    { id: '1995-1998', label: "993 '95–'98", shortLabel: '993', yearStart: 1995, yearEnd: 1998 },
    { id: '1999-2004', label: "996 '99–'04", shortLabel: '996', yearStart: 1999, yearEnd: 2004 },
    { id: '2005-2012', label: "997 '05–'12", shortLabel: '997', yearStart: 2005, yearEnd: 2012 },
    { id: '2013-2019', label: "991 '13–'19", shortLabel: '991', yearStart: 2013, yearEnd: 2019 },
    { id: '2020-2030', label: "992 '20+", shortLabel: '992', yearStart: 2020, yearEnd: 2030 },
  ],
  'bmw:m3': [
    { id: '1986-1991', label: "E30 '86–'91", shortLabel: 'E30', yearStart: 1986, yearEnd: 1991 },
    { id: '1992-1999', label: "E36 '92–'99", shortLabel: 'E36', yearStart: 1992, yearEnd: 1999 },
    { id: '2000-2006', label: "E46 '00–'06", shortLabel: 'E46', yearStart: 2000, yearEnd: 2006 },
    { id: '2007-2013', label: "E90/E92 '07–'13", shortLabel: 'E90/E92', yearStart: 2007, yearEnd: 2013 },
    { id: '2014-2018', label: "F80 '14–'18", shortLabel: 'F80', yearStart: 2014, yearEnd: 2018 },
    { id: '2021-2030', label: "G80 '21+", shortLabel: 'G80', yearStart: 2021, yearEnd: 2030 },
  ],
  'ford:bronco': [
    { id: '1966-1977', label: "Early Bronco '66–'77", shortLabel: "'66–'77", yearStart: 1966, yearEnd: 1977 },
    { id: '1978-1979', label: "2nd Gen '78–'79", shortLabel: "'78–'79", yearStart: 1978, yearEnd: 1979 },
    { id: '1980-1986', label: "Bullnose '80–'86", shortLabel: "'80–'86", yearStart: 1980, yearEnd: 1986 },
    { id: '1987-1991', label: "Bricknose '87–'91", shortLabel: "'87–'91", yearStart: 1987, yearEnd: 1991 },
    { id: '1992-1996', label: "OBS '92–'96", shortLabel: "'92–'96", yearStart: 1992, yearEnd: 1996 },
    { id: '2021-2030', label: "6th Gen '21+", shortLabel: "'21+", yearStart: 2021, yearEnd: 2030 },
  ],
  'toyota:land cruiser': [
    { id: '1960-1984', label: "40 Series '60–'84", shortLabel: '40 Series', yearStart: 1960, yearEnd: 1984 },
    { id: '1980-1990', label: "60 Series '80–'90", shortLabel: '60 Series', yearStart: 1980, yearEnd: 1990 },
    { id: '1991-1997', label: "80 Series '91–'97", shortLabel: '80 Series', yearStart: 1991, yearEnd: 1997 },
    { id: '1998-2007', label: "100 Series '98–'07", shortLabel: '100 Series', yearStart: 1998, yearEnd: 2007 },
    { id: '2008-2021', label: "200 Series '08–'21", shortLabel: '200 Series', yearStart: 2008, yearEnd: 2021 },
    { id: '2024-2030', label: "250 Series '24+", shortLabel: '250 Series', yearStart: 2024, yearEnd: 2030 },
  ],
};

export function parseEraRange(eraParam: string | null | undefined): { yearStart: number; yearEnd: number } | null {
  if (!eraParam) return null;
  const m = eraParam.trim().match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (!m) return null;
  const yearStart = parseInt(m[1], 10);
  const yearEnd = parseInt(m[2], 10);
  if (!Number.isFinite(yearStart) || !Number.isFinite(yearEnd) || yearStart > yearEnd) return null;
  return { yearStart, yearEnd };
}

export function matchesEraRange(year: number | null | undefined, eraParam: string | null | undefined): boolean {
  const range = parseEraRange(eraParam);
  if (!range) return true;
  if (year == null || !Number.isFinite(year)) return false;
  return year >= range.yearStart && year <= range.yearEnd;
}

export function getFamilyEraCohorts(
  brand: string | null | undefined,
  familyName: string | null | undefined,
  years: Array<number | null | undefined>,
): Array<FamilyEraCohort & { count: number }> {
  const validYears = years.filter((y): y is number => typeof y === 'number' && y >= 1886 && y <= 2100);
  if (!validYears.length) return [];

  const lookupKey = `${(brand ?? '').trim().toLowerCase()}:${(familyName ?? '').trim().toLowerCase()}`;
  const curated = CURATED_FAMILY_ERAS[lookupKey];
  if (curated) {
    const withCounts = curated
      .map((c) => ({
        ...c,
        count: validYears.filter((y) => y >= c.yearStart && y <= c.yearEnd).length,
      }))
      .filter((c) => c.count > 0);
    return withCounts.length >= 2 ? withCounts : [];
  }

  // Fallback for any multi-decade model family: build decade cohorts (e.g. 1960s, 1970s, 1980s)
  const byDecade = new Map<number, number>();
  for (const y of validYears) {
    const d = Math.floor(y / 10) * 10;
    byDecade.set(d, (byDecade.get(d) ?? 0) + 1);
  }
  const decades = [...byDecade.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => a[0] - b[0])
    .map(([d, count]) => ({
      id: `${d}-${d + 9}`,
      label: `${d}s`,
      shortLabel: `${d}s`,
      yearStart: d,
      yearEnd: d + 9,
      count,
    }));

  return decades.length >= 2 ? decades : [];
}
