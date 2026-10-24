// Run: deno test --allow-read supabase/functions/extract-bonhams/
import { chassisFromLotUrl, pickChassis } from './lotPage.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const U = 'https://bonhams.com/auction/22723/lot/354/1983-porsche-911-turbo-33-litre-coupe-chassis-no-wpqzzz93zds000846';

Deno.test('chassisFromLotUrl reads the full slug chassis, stopping at engine-no', () => {
  equal(chassisFromLotUrl(U), 'WPQZZZ93ZDS000846');
  equal(chassisFromLotUrl('https://bonhams.com/auction/17263/lot/405/1988-skoda-sport-130l-saloon-chassis-no-tmb13mool53601498-engine-no-5792872130'), 'TMB13MOOL53601498');
  equal(chassisFromLotUrl('https://bonhams.com/auction/18213/lot/380/1932-lagonda-2-litre-supercharged-low-chassis-t3-tourer-chassis-no-oh10056-engine-no-18052b-1158'), 'OH10056');
  equal(chassisFromLotUrl('https://www.bonhams.com/auction/22718/lot/18/1982-maserati-merak-ss-coupe-chassis-no-am122a-655-engine-no-am122a-655'), 'AM122A-655');
  equal(chassisFromLotUrl('https://cars.bonhams.com/auction/27205/lot/14/2012-harley-davidson-flhrc-road-king-frame-no-1hd1frm17cb638599-engine-no-frmc638599/'), '1HD1FRM17CB638599');
  equal(chassisFromLotUrl('https://bonhams.com/auction/22125/lot/218/1940-indian-junior-scout-3050ci-engine-no-ed0540'), null);
  equal(chassisFromLotUrl(null), null);
});

Deno.test('pickChassis replaces slug fragments and cut-short prefixes, keeps real page values', () => {
  equal(pickChassis('-NO-WPQZZZ93ZDS00084', 'WPQZZZ93ZDS000846'), 'WPQZZZ93ZDS000846');
  equal(pickChassis('-T3-TOURER-CHASSIS-N', 'OH10056'), 'OH10056');
  equal(pickChassis('S800', 'S8001006039'), 'S8001006039');
  equal(pickChassis('876H', '876H56913'), '876H56913');
  equal(pickChassis(null, 'OH10056'), 'OH10056');
  equal(pickChassis('AM101.1466', 'AM1011466'), 'AM101.1466');
  equal(pickChassis('LSMF48', 'LSMF48'), 'LSMF48');
  equal(pickChassis('12345', null), '12345');
});
