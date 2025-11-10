import type { VehicleFormData } from '../pages/add-vehicle/types';

interface EmailDraft {
  subject: string;
  body: string;
}

interface EmailContext {
  vehicle: Partial<VehicleFormData>;
  listingUrl?: string;
  askingPrice?: number | null;
  sellerLocation?: string | null;
  descriptionSnippet?: string | null;
  sellerNameGuess?: string | null;
}

function pick<T>(items: T[], fallback: T): T {
  if (!items.length) return fallback;
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? fallback;
}

function buildSubject(context: EmailContext): string {
  const { vehicle, askingPrice } = context;
  const year = vehicle.year ? vehicle.year.toString() : '';
  const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const priceText = typeof askingPrice === 'number' && askingPrice > 0
    ? `$${askingPrice.toLocaleString()}`
    : '';

  const baseOptions = [
    () => `Question about your ${year} ${makeModel}`.trim(),
    () => `Interested in the ${year} ${makeModel} you listed`,
    () => `Quick follow-up on the ${makeModel || 'vehicle'} listing`,
    () => `Can we chat about your ${makeModel || 'vehicle'}?`,
  ];

  const subject = pick(baseOptions, baseOptions[0])();
  if (priceText && Math.random() > 0.5) {
    return `${subject} (${priceText})`;
  }
  return subject;
}

function buildBody(context: EmailContext): string {
  const { vehicle, listingUrl, askingPrice, sellerLocation, descriptionSnippet } = context;

  const greetings = [
    'Hey there',
    'Hi',
    'Hello',
    'Good afternoon',
  ];

  const intros = [
    (details: string) => `I spotted your listing${details} and wanted to reach out.`,
    (details: string) => `Appreciate you posting the vehicle${details}; it looks like a solid candidate for a project I’m working on.`,
    (details: string) => `Saw the listing${details} and I’m seriously interested.`,
  ];

  const priceFragment = typeof askingPrice === 'number' && askingPrice > 0
    ? ` priced around $${askingPrice.toLocaleString()}`
    : '';

  const locationFragment = sellerLocation ? ` out in ${sellerLocation}` : '';
  const listingDetails = `${locationFragment}${priceFragment}`;

  const vehicleLine = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(' ');

  const descriptiveLine = descriptionSnippet
    ? `The bit about "${descriptionSnippet?.slice(0, 140)}" definitely caught my eye.`
    : '';

  const infoRequests = [
    'Could you send over the full VIN when you get a chance? I always run a quick history check before I come out.',
    'Do you happen to have a clear photo of the title? No worries if you prefer not to send one yet—just trying to confirm the details before I arrange travel.',
    'I’d love a few higher-resolution shots if you have them—interior, engine bay, frame rails, and anything underneath that shows condition.',
    'Can you walk me through the ownership history and how long it’s been in your possession?',
    'What’s the best way to reach you directly (phone/text/email) in case something last-minute comes up?',
  ];

  const optionalRequests = [
    'If there are any recent service records or receipts, a quick snapshot would be super helpful.',
    'If the vehicle has been sitting, any notes on when it last ran or was registered would be great context.',
    'If you’re comfortable, a short walk-around video or cold-start clip would help me see what I’m working with.',
  ];

  const closingOptions = [
    'Thanks so much—looking forward to hearing back.',
    'Appreciate the time! Let me know what works for you.',
    'Thanks again. I’m flexible on timing, so whatever’s easiest on your end works for me.',
  ];

  const signatureOptions = [
    'Best,\nSkylar',
    'Thanks,\nSkylar',
    'Talk soon,\nSkylar',
  ];

  const greeting = pick(greetings, greetings[0]);
  const introTemplate = pick(intros, intros[0]);
  const closing = pick(closingOptions, closingOptions[0]);
  const signature = pick(signatureOptions, signatureOptions[0]);

  const selectedRequests = [...infoRequests];
  if (optionalRequests.length) {
    // Randomly include 1-2 optional requests to vary the template
    const shuffle = optionalRequests
      .map((item) => ({ item, score: Math.random() }))
      .sort((a, b) => a.score - b.score)
      .map(({ item }) => item);
    selectedRequests.push(...shuffle.slice(0, 2));
  }

  const requestParagraph = selectedRequests
    .map((sentence) => `• ${sentence}`)
    .join('\n');

  const introDetails = listingDetails ? `${listingDetails}` : '';

  const lines = [
    `${greeting},`,
    '',
    `${introTemplate(introDetails ? introDetails : '')}${vehicleLine ? ` I’m looking at the ${vehicleLine}.` : ''}`.trim(),
  ];

  if (descriptiveLine) {
    lines.push('', descriptiveLine);
  }

  lines.push('', 'Could you help me out with a few quick details?');
  lines.push(requestParagraph);

  if (listingUrl) {
    lines.push('', `For reference, here’s the link I saw: ${listingUrl}`);
  }

  lines.push('', closing, '', signature);

  return lines.join('\n');
}

export function generateCraigslistEmail(context: EmailContext): EmailDraft {
  return {
    subject: buildSubject(context),
    body: buildBody(context),
  };
}


