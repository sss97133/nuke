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
  'mercedes-benz:sl': [
    { id: '1954-1963', label: "W198/W121 '54–'63", shortLabel: '300SL/190SL', yearStart: 1954, yearEnd: 1963 },
    { id: '1963-1971', label: "W113 Pagoda '63–'71", shortLabel: 'Pagoda W113', yearStart: 1963, yearEnd: 1971 },
    { id: '1971-1989', label: "R107 '71–'89", shortLabel: 'R107', yearStart: 1971, yearEnd: 1989 },
    { id: '1990-2002', label: "R129 '90–'02", shortLabel: 'R129', yearStart: 1990, yearEnd: 2002 },
    { id: '2003-2012', label: "R230 '03–'12", shortLabel: 'R230', yearStart: 2003, yearEnd: 2012 },
    { id: '2013-2020', label: "R231 '13–'20", shortLabel: 'R231', yearStart: 2013, yearEnd: 2020 },
    { id: '2022-2030', label: "R232 '22+", shortLabel: 'R232', yearStart: 2022, yearEnd: 2030 },
  ],
  'porsche:356': [
    { id: '1948-1955', label: "Pre-A '48–'55", shortLabel: 'Pre-A', yearStart: 1948, yearEnd: 1955 },
    { id: '1956-1959', label: "356A '56–'59", shortLabel: '356A', yearStart: 1956, yearEnd: 1959 },
    { id: '1960-1963', label: "356B '60–'63", shortLabel: '356B', yearStart: 1960, yearEnd: 1963 },
    { id: '1964-1965', label: "356C/SC '64–'65", shortLabel: '356C/SC', yearStart: 1964, yearEnd: 1965 },
  ],
  'volvo:p1800': [
    { id: '1961-1969', label: "P1800/1800S '61–'69", shortLabel: 'P1800/1800S', yearStart: 1961, yearEnd: 1969 },
    { id: '1970-1972', label: "1800E '70–'72", shortLabel: '1800E', yearStart: 1970, yearEnd: 1972 },
    { id: '1972-1973', label: "1800ES '72–'73", shortLabel: '1800ES', yearStart: 1972, yearEnd: 1973 },
  ],
  'pontiac:gto': [
    { id: '1964-1967', label: "1st Gen '64–'67", shortLabel: "'64–'67", yearStart: 1964, yearEnd: 1967 },
    { id: '1968-1972', label: "2nd Gen '68–'72", shortLabel: "'68–'72", yearStart: 1968, yearEnd: 1972 },
    { id: '1973-1974', label: "3rd/4th Gen '73–'74", shortLabel: "'73–'74", yearStart: 1973, yearEnd: 1974 },
    { id: '2004-2006', label: "5th Gen '04–'06", shortLabel: "'04–'06", yearStart: 2004, yearEnd: 2006 },
  ],
  'pontiac:firebird': [
    { id: '1967-1969', label: "1st Gen '67–'69", shortLabel: "'67–'69", yearStart: 1967, yearEnd: 1969 },
    { id: '1970-1981', label: "2nd Gen '70–'81", shortLabel: "'70–'81", yearStart: 1970, yearEnd: 1981 },
    { id: '1982-1992', label: "3rd Gen '82–'92", shortLabel: "'82–'92", yearStart: 1982, yearEnd: 1992 },
    { id: '1993-2002', label: "4th Gen '93–'02", shortLabel: "'93–'02", yearStart: 1993, yearEnd: 2002 },
  ],
  'toyota:supra': [
    { id: '1978-1985', label: "A40/A60 MkI–II '78–'85", shortLabel: 'A40/A60', yearStart: 1978, yearEnd: 1985 },
    { id: '1986-1992', label: "A70 MkIII '86–'92", shortLabel: 'A70 MkIII', yearStart: 1986, yearEnd: 1992 },
    { id: '1993-2002', label: "A80 MkIV '93–'02", shortLabel: 'A80 MkIV', yearStart: 1993, yearEnd: 2002 },
    { id: '2020-2030', label: "A90 MkV '20+", shortLabel: 'A90 MkV', yearStart: 2020, yearEnd: 2030 },
  ],
  'bmw:3 series': [
    { id: '1975-1983', label: "E21 '75–'83", shortLabel: 'E21', yearStart: 1975, yearEnd: 1983 },
    { id: '1984-1991', label: "E30 '84–'91", shortLabel: 'E30', yearStart: 1984, yearEnd: 1991 },
    { id: '1992-1999', label: "E36 '92–'99", shortLabel: 'E36', yearStart: 1992, yearEnd: 1999 },
    { id: '2000-2006', label: "E46 '00–'06", shortLabel: 'E46', yearStart: 2000, yearEnd: 2006 },
    { id: '2007-2013', label: "E90/E92 '07–'13", shortLabel: 'E90/E92', yearStart: 2007, yearEnd: 2013 },
    { id: '2012-2018', label: "F30 '12–'18", shortLabel: 'F30', yearStart: 2012, yearEnd: 2018 },
    { id: '2019-2030', label: "G20 '19+", shortLabel: 'G20', yearStart: 2019, yearEnd: 2030 },
  ],
  'bmw:5 series': [
    { id: '1972-1988', label: "E12/E28 '72–'88", shortLabel: 'E12/E28', yearStart: 1972, yearEnd: 1988 },
    { id: '1989-1995', label: "E34 '89–'95", shortLabel: 'E34', yearStart: 1989, yearEnd: 1995 },
    { id: '1996-2003', label: "E39 '96–'03", shortLabel: 'E39', yearStart: 1996, yearEnd: 2003 },
    { id: '2004-2010', label: "E60 '04–'10", shortLabel: 'E60', yearStart: 2004, yearEnd: 2010 },
    { id: '2011-2023', label: "F10/G30 '11–'23", shortLabel: 'F10/G30', yearStart: 2011, yearEnd: 2023 },
  ],
  'bmw:m5': [
    { id: '1985-1988', label: "E28 '85–'88", shortLabel: 'E28', yearStart: 1985, yearEnd: 1988 },
    { id: '1989-1995', label: "E34 '89–'95", shortLabel: 'E34', yearStart: 1989, yearEnd: 1995 },
    { id: '1998-2003', label: "E39 '98–'03", shortLabel: 'E39', yearStart: 1998, yearEnd: 2003 },
    { id: '2005-2010', label: "E60 V10 '05–'10", shortLabel: 'E60', yearStart: 2005, yearEnd: 2010 },
    { id: '2011-2016', label: "F10 '11–'16", shortLabel: 'F10', yearStart: 2011, yearEnd: 2016 },
    { id: '2018-2030', label: "F90 '18+", shortLabel: 'F90', yearStart: 2018, yearEnd: 2030 },
  ],
  'nissan:skyline': [
    { id: '1968-1977', label: "Hakosuka/Kenmeri '68–'77", shortLabel: 'C10/C110', yearStart: 1968, yearEnd: 1977 },
    { id: '1981-1988', label: "R30/R31 '81–'88", shortLabel: 'R30/R31', yearStart: 1981, yearEnd: 1988 },
    { id: '1989-1994', label: "R32 '89–'94", shortLabel: 'R32', yearStart: 1989, yearEnd: 1994 },
    { id: '1995-1998', label: "R33 '95–'98", shortLabel: 'R33', yearStart: 1995, yearEnd: 1998 },
    { id: '1999-2002', label: "R34 '99–'02", shortLabel: 'R34', yearStart: 1999, yearEnd: 2002 },
  ],
  'mazda:mx-5 miata': [
    { id: '1990-1997', label: "NA '90–'97", shortLabel: 'NA', yearStart: 1990, yearEnd: 1997 },
    { id: '1999-2005', label: "NB '99–'05", shortLabel: 'NB', yearStart: 1999, yearEnd: 2005 },
    { id: '2006-2015', label: "NC '06–'15", shortLabel: 'NC', yearStart: 2006, yearEnd: 2015 },
    { id: '2016-2030', label: "ND '16+", shortLabel: 'ND', yearStart: 2016, yearEnd: 2030 },
  ],
  'jaguar:e-type': [
    { id: '1961-1967', label: "Series 1 '61–'67", shortLabel: 'Series 1', yearStart: 1961, yearEnd: 1967 },
    { id: '1968-1970', label: "Series 1.5/2 '68–'70", shortLabel: 'Series 2', yearStart: 1968, yearEnd: 1970 },
    { id: '1971-1974', label: "Series 3 V12 '71–'74", shortLabel: 'Series 3', yearStart: 1971, yearEnd: 1974 },
  ],
  'land rover:defender': [
    { id: '1948-1984', label: "Series I–III '48–'84", shortLabel: 'Series I–III', yearStart: 1948, yearEnd: 1984 },
    { id: '1983-2016', label: "Defender 90/110 '83–'16", shortLabel: "90/110 '83–'16", yearStart: 1983, yearEnd: 2016 },
    { id: '2020-2030', label: "L663 '20+", shortLabel: "L663 '20+", yearStart: 2020, yearEnd: 2030 },
  ],
  'jeep:wrangler': [
    { id: '1987-1995', label: "YJ '87–'95", shortLabel: 'YJ', yearStart: 1987, yearEnd: 1995 },
    { id: '1997-2006', label: "TJ '97–'06", shortLabel: 'TJ', yearStart: 1997, yearEnd: 2006 },
    { id: '2007-2018', label: "JK '07–'18", shortLabel: 'JK', yearStart: 2007, yearEnd: 2018 },
    { id: '2018-2030', label: "JL '18+", shortLabel: 'JL', yearStart: 2018, yearEnd: 2030 },
  ],
  'dodge:charger': [
    { id: '1966-1967', label: "1st Gen '66–'67", shortLabel: "'66–'67", yearStart: 1966, yearEnd: 1967 },
    { id: '1968-1970', label: "2nd Gen '68–'70", shortLabel: "'68–'70", yearStart: 1968, yearEnd: 1970 },
    { id: '1971-1974', label: "3rd Gen '71–'74", shortLabel: "'71–'74", yearStart: 1971, yearEnd: 1974 },
    { id: '2006-2030', label: "Modern LX/LD '06+", shortLabel: "'06+", yearStart: 2006, yearEnd: 2030 },
  ],
  'dodge:challenger': [
    { id: '1970-1974', label: "E-Body '70–'74", shortLabel: "'70–'74", yearStart: 1970, yearEnd: 1974 },
    { id: '2008-2023', label: "Modern LC '08–'23", shortLabel: "'08–'23", yearStart: 2008, yearEnd: 2023 },
  ],
  'dodge:viper': [
    { id: '1992-2002', label: "SR I/II '92–'02", shortLabel: 'SR I/II', yearStart: 1992, yearEnd: 2002 },
    { id: '2003-2010', label: "ZB I/II '03–'10", shortLabel: 'ZB I/II', yearStart: 2003, yearEnd: 2010 },
    { id: '2013-2017', label: "VX '13–'17", shortLabel: 'VX', yearStart: 2013, yearEnd: 2017 },
  ],
  'chevrolet:pickup': [
    { id: '1947-1955', label: "Advance Design '47–'55", shortLabel: "'47–'55", yearStart: 1947, yearEnd: 1955 },
    { id: '1955-1959', label: "Task Force '55–'59", shortLabel: "'55–'59", yearStart: 1955, yearEnd: 1959 },
    { id: '1960-1972', label: "C/K '60–'72", shortLabel: "'60–'72", yearStart: 1960, yearEnd: 1972 },
    { id: '1973-1987', label: "Squarebody '73–'87", shortLabel: "Squarebody '73–'87", yearStart: 1973, yearEnd: 1987 },
  ],
  'mercedes-benz:e-class': [
    { id: '1968-1976', label: "W114/W115 '68–'76", shortLabel: 'W114/W115', yearStart: 1968, yearEnd: 1976 },
    { id: '1976-1985', label: "W123 '76–'85", shortLabel: 'W123', yearStart: 1976, yearEnd: 1985 },
    { id: '1986-1995', label: "W124 / 500E '86–'95", shortLabel: 'W124', yearStart: 1986, yearEnd: 1995 },
    { id: '1996-2009', label: "W210/W211 '96–'09", shortLabel: 'W210/W211', yearStart: 1996, yearEnd: 2009 },
    { id: '2010-2030', label: "W212/W213 '10+", shortLabel: 'W212/W213', yearStart: 2010, yearEnd: 2030 },
  ],
  'mercedes-benz:s-class': [
    { id: '1965-1972', label: "W108/W109 '65–'72", shortLabel: 'W108/W109', yearStart: 1965, yearEnd: 1972 },
    { id: '1973-1980', label: "W116 '73–'80", shortLabel: 'W116', yearStart: 1973, yearEnd: 1980 },
    { id: '1980-1991', label: "W126 '80–'91", shortLabel: 'W126', yearStart: 1980, yearEnd: 1991 },
    { id: '1992-1999', label: "W140 '92–'99", shortLabel: 'W140', yearStart: 1992, yearEnd: 1999 },
    { id: '2000-2013', label: "W220/W221 '00–'13", shortLabel: 'W220/W221', yearStart: 2000, yearEnd: 2013 },
    { id: '2014-2030', label: "W222/W223 '14+", shortLabel: 'W222/W223', yearStart: 2014, yearEnd: 2030 },
  ],
  'land rover:series': [
    { id: '1948-1958', label: "Series I '48–'58", shortLabel: 'Series I', yearStart: 1948, yearEnd: 1958 },
    { id: '1958-1971', label: "Series II / IIA '58–'71", shortLabel: 'Series II/IIA', yearStart: 1958, yearEnd: 1971 },
    { id: '1971-1985', label: "Series III '71–'85", shortLabel: 'Series III', yearStart: 1971, yearEnd: 1985 },
  ],
};

export function getDefinedFamilyEras(
  brand: string | null | undefined,
  familyName: string | null | undefined,
): FamilyEraCohort[] {
  const lookupKey = `${(brand ?? '').trim().toLowerCase()}:${(familyName ?? '').trim().toLowerCase()}`;
  return CURATED_FAMILY_ERAS[lookupKey] ?? [];
}

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
