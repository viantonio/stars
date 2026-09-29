/**
 * Correspondence tables for the "As Above" layer: Western astrology and
 * Hermetic Qabalah. Pure data plus small helpers; no DOM, no three.js.
 *
 * Sources (all attributions are tradition, not science):
 *  - Sefer Yetzirah (Book of Formation): the 3 mother, 7 double and 12 simple
 *    letters. The planetary attribution of the doubles differs between
 *    recensions; `letterSY` below follows the Gra (Vilna Gaon) version as
 *    tabulated by Aryeh Kaplan, "Sefer Yetzirah: The Book of Creation" (1990),
 *    ch. 4, which places Bet…Tav in the Chaldean order Saturn…Moon. Other
 *    recensions (Short/Long versions, Saadia, and the 1877 Kalisch translation)
 *    order them differently.
 *  - Golden Dawn / Crowley, "Liber 777" (1909): letter↔planet/sign/element
 *    attributions, path numbers 11–32 and the paths' positions on the Tree.
 *    (Crowley's later Thoth-deck swap of Heh/Tzaddi is NOT applied.)
 *  - Agrippa, "Three Books of Occult Philosophy" (1533): planetary metals and days.
 *  - Isaac Newton's translation of the Emerald Tablet (Keynes MS 28, King's
 *    College Cambridge; Newton d. 1727, so the text is public domain).
 */
import type { AspectType, Chart, LetterTradition, PointId } from './types';

export type ElementName = 'Fire' | 'Earth' | 'Air' | 'Water';
export type Modality = 'Cardinal' | 'Fixed' | 'Mutable';

/** Append U+FE0E (text presentation) so glyphs never render as colour emoji. */
const T = (s: string): string => s + '︎';

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

export interface SignInfo {
  /** 0 = Aries … 11 = Pisces. */
  index: number;
  name: string;
  glyph: string;
  element: ElementName;
  modality: Modality;
  /** Traditional (classical) ruler. */
  ruler: PointId;
  /** Modern ruler where one was added after the discovery of the outer planets. */
  modernRuler?: PointId;
  /** Hebrew simple letter (Golden Dawn attribution = Sefer Yetzirah, Gra). */
  letter: string;
  letterName: string;
  keywords: string[];
  /** One sentence, phrased as tradition. */
  theme: string;
  /** The constellation the sign was named after (IAU abbreviation, name, figure). */
  constellation: { id: string; name: string; figure: string };
}

export const SIGNS: SignInfo[] = [
  {
    index: 0, name: 'Aries', glyph: T('♈'), element: 'Fire', modality: 'Cardinal', ruler: 'Mars',
    letter: 'ה', letterName: 'Heh', keywords: ['initiative', 'courage', 'beginnings', 'will'],
    theme: 'Traditionally the sign of the spring equinox and the first impulse of life, bold and pioneering.',
    constellation: { id: 'Ari', name: 'Aries', figure: 'the Ram' },
  },
  {
    index: 1, name: 'Taurus', glyph: T('♉'), element: 'Earth', modality: 'Fixed', ruler: 'Venus',
    letter: 'ו', letterName: 'Vav', keywords: ['stability', 'sensuality', 'patience', 'substance'],
    theme: 'Traditionally the fertile, steady earth of spring, concerned with what endures and nourishes.',
    constellation: { id: 'Tau', name: 'Taurus', figure: 'the Bull' },
  },
  {
    index: 2, name: 'Gemini', glyph: T('♊'), element: 'Air', modality: 'Mutable', ruler: 'Mercury',
    letter: 'ז', letterName: 'Zayin', keywords: ['curiosity', 'exchange', 'duality', 'versatility'],
    theme: 'Traditionally the sign of the Twins, of language, exchange and the play of opposites.',
    constellation: { id: 'Gem', name: 'Gemini', figure: 'the Twins' },
  },
  {
    index: 3, name: 'Cancer', glyph: T('♋'), element: 'Water', modality: 'Cardinal', ruler: 'Moon',
    letter: 'ח', letterName: 'Chet', keywords: ['nurture', 'memory', 'home', 'protection'],
    theme: 'Traditionally the sign of the summer solstice and the Moon, the enclosure that shelters and feeds.',
    constellation: { id: 'Cnc', name: 'Cancer', figure: 'the Crab' },
  },
  {
    index: 4, name: 'Leo', glyph: T('♌'), element: 'Fire', modality: 'Fixed', ruler: 'Sun',
    letter: 'ט', letterName: 'Tet', keywords: ['radiance', 'heart', 'creativity', 'sovereignty'],
    theme: 'Traditionally the Sun’s own house, the steady fire of the heart, dignity and creative display.',
    constellation: { id: 'Leo', name: 'Leo', figure: 'the Lion' },
  },
  {
    index: 5, name: 'Virgo', glyph: T('♍'), element: 'Earth', modality: 'Mutable', ruler: 'Mercury',
    letter: 'י', letterName: 'Yod', keywords: ['discernment', 'craft', 'service', 'purity'],
    theme: 'Traditionally the harvest maiden holding the ear of wheat, the discernment that sorts and perfects.',
    constellation: { id: 'Vir', name: 'Virgo', figure: 'the Maiden' },
  },
  {
    index: 6, name: 'Libra', glyph: T('♎'), element: 'Air', modality: 'Cardinal', ruler: 'Venus',
    letter: 'ל', letterName: 'Lamed', keywords: ['balance', 'justice', 'relationship', 'harmony'],
    theme: 'Traditionally the sign of the autumn equinox, when day and night are weighed equal on the Scales.',
    constellation: { id: 'Lib', name: 'Libra', figure: 'the Scales (anciently the Scorpion’s Claws)' },
  },
  {
    index: 7, name: 'Scorpio', glyph: T('♏'), element: 'Water', modality: 'Fixed', ruler: 'Mars', modernRuler: 'Pluto',
    letter: 'נ', letterName: 'Nun', keywords: ['depth', 'transformation', 'desire', 'secrecy'],
    theme: 'Traditionally the fixed water of death and regeneration, where what is hidden is transformed.',
    constellation: { id: 'Sco', name: 'Scorpius', figure: 'the Scorpion' },
  },
  {
    index: 8, name: 'Sagittarius', glyph: T('♐'), element: 'Fire', modality: 'Mutable', ruler: 'Jupiter',
    letter: 'ס', letterName: 'Samekh', keywords: ['aspiration', 'faith', 'journey', 'wisdom'],
    theme: 'Traditionally the Archer’s arrow aimed at far horizons, the quest for meaning and higher law.',
    constellation: { id: 'Sgr', name: 'Sagittarius', figure: 'the Archer' },
  },
  {
    index: 9, name: 'Capricorn', glyph: T('♑'), element: 'Earth', modality: 'Cardinal', ruler: 'Saturn',
    letter: 'ע', letterName: 'Ayin', keywords: ['structure', 'ambition', 'discipline', 'time'],
    theme: 'Traditionally the sign of the winter solstice, the Sea-goat climbing from the depths to the summit.',
    constellation: { id: 'Cap', name: 'Capricornus', figure: 'the Sea-goat' },
  },
  {
    index: 10, name: 'Aquarius', glyph: T('♒'), element: 'Air', modality: 'Fixed', ruler: 'Saturn', modernRuler: 'Uranus',
    letter: 'צ', letterName: 'Tzaddi', keywords: ['community', 'vision', 'independence', 'ideals'],
    theme: 'Traditionally the Water-bearer pouring out for all, the fixed air of ideals and the common good.',
    constellation: { id: 'Aqr', name: 'Aquarius', figure: 'the Water-bearer' },
  },
  {
    index: 11, name: 'Pisces', glyph: T('♓'), element: 'Water', modality: 'Mutable', ruler: 'Jupiter', modernRuler: 'Neptune',
    letter: 'ק', letterName: 'Qoph', keywords: ['compassion', 'imagination', 'surrender', 'dreams'],
    theme: 'Traditionally the two Fishes of the closing sign, where boundaries dissolve before the cycle renews.',
    constellation: { id: 'Psc', name: 'Pisces', figure: 'the Fishes' },
  },
];

// ---------------------------------------------------------------------------
// Planets and points
// ---------------------------------------------------------------------------

export interface PlanetInfo {
  id: PointId;
  name: string;
  glyph: string;
  /** One of the seven classical planets (Sun…Saturn). */
  classical: boolean;
  /** Sephira number 1..10 (Golden Dawn / 777); null where there is no classical attribution. */
  sephira: number | null;
  /** Hebrew double letter, Golden Dawn / Liber 777. */
  letterGD: string | null;
  /** Hebrew double letter, Sefer Yetzirah (Gra version, per Kaplan). */
  letterSY: string | null;
  /** Agrippa's planetary metal. */
  metal: string | null;
  weekday: string | null;
  /** Golden Dawn Queen-scale colour of the planet's sephira. */
  colour: { name: string; hex: string } | null;
  theme: string;
  /** Note on non-classical or disputed attributions. */
  note?: string;
}

export const PLANETS: PlanetInfo[] = [
  {
    id: 'Sun', name: 'Sun', glyph: T('☉'), classical: true, sephira: 6, letterGD: 'ר', letterSY: 'כ',
    metal: 'Gold', weekday: 'Sunday', colour: { name: 'Gold', hex: '#e8b923' },
    theme: 'Traditionally the heart and centre: vitality, will and the conscious self.',
  },
  {
    id: 'Moon', name: 'Moon', glyph: T('☽'), classical: true, sephira: 9, letterGD: 'ג', letterSY: 'ת',
    metal: 'Silver', weekday: 'Monday', colour: { name: 'Violet', hex: '#8a5cc7' },
    theme: 'Traditionally the reflecting soul: feeling, memory, instinct and the rhythms of growth.',
  },
  {
    id: 'Mercury', name: 'Mercury', glyph: T('☿'), classical: true, sephira: 8, letterGD: 'ב', letterSY: 'ר',
    metal: 'Quicksilver', weekday: 'Wednesday', colour: { name: 'Orange', hex: '#e8822a' },
    theme: 'Traditionally the messenger: mind, speech, exchange and the art of interpretation.',
  },
  {
    id: 'Venus', name: 'Venus', glyph: T('♀'), classical: true, sephira: 7, letterGD: 'ד', letterSY: 'פ',
    metal: 'Copper', weekday: 'Friday', colour: { name: 'Emerald', hex: '#2e9e5b' },
    theme: 'Traditionally the principle of attraction: love, beauty, harmony and the arts.',
  },
  {
    id: 'Mars', name: 'Mars', glyph: T('♂'), classical: true, sephira: 5, letterGD: 'פ', letterSY: 'ד',
    metal: 'Iron', weekday: 'Tuesday', colour: { name: 'Scarlet', hex: '#d0312d' },
    theme: 'Traditionally the principle of force: courage, desire, severance and action.',
  },
  {
    id: 'Jupiter', name: 'Jupiter', glyph: T('♃'), classical: true, sephira: 4, letterGD: 'כ', letterSY: 'ג',
    metal: 'Tin', weekday: 'Thursday', colour: { name: 'Blue', hex: '#2f5fbf' },
    theme: 'Traditionally the greater benefic: growth, generosity, law and faith.',
  },
  {
    id: 'Saturn', name: 'Saturn', glyph: T('♄'), classical: true, sephira: 3, letterGD: 'ת', letterSY: 'ב',
    metal: 'Lead', weekday: 'Saturday', colour: { name: 'Black', hex: '#1b1b1f' },
    theme: 'Traditionally the keeper of limits: time, structure, discipline and understanding through form.',
  },
  {
    id: 'Uranus', name: 'Uranus', glyph: T('♅'), classical: false, sephira: null, letterGD: null, letterSY: null,
    metal: null, weekday: null, colour: null,
    theme: 'In modern astrology, the awakener: sudden change, originality and liberation.',
    note: 'Discovered 1781; no classical attribution. Some modern Qabalists place it at Chokmah.',
  },
  {
    id: 'Neptune', name: 'Neptune', glyph: T('♆'), classical: false, sephira: null, letterGD: null, letterSY: null,
    metal: null, weekday: null, colour: null,
    theme: 'In modern astrology, the dissolver: dreams, mysticism, compassion and illusion.',
    note: 'Discovered 1846; no classical attribution. Modern authors variously place it at Chokmah or Keter.',
  },
  {
    id: 'Pluto', name: 'Pluto', glyph: T('♇'), classical: false, sephira: null, letterGD: null, letterSY: null,
    metal: null, weekday: null, colour: null,
    theme: 'In modern astrology, the transformer: depth, power, death and rebirth.',
    note: 'Discovered 1930; no classical attribution. Some modern authors place it at Keter.',
  },
];

/** Display glyphs and names for every chart point (planets plus nodes and angles). */
export const POINT_INFO: Record<PointId, { name: string; glyph: string }> = {
  Sun: { name: 'Sun', glyph: T('☉') },
  Moon: { name: 'Moon', glyph: T('☽') },
  Mercury: { name: 'Mercury', glyph: T('☿') },
  Venus: { name: 'Venus', glyph: T('♀') },
  Mars: { name: 'Mars', glyph: T('♂') },
  Jupiter: { name: 'Jupiter', glyph: T('♃') },
  Saturn: { name: 'Saturn', glyph: T('♄') },
  Uranus: { name: 'Uranus', glyph: T('♅') },
  Neptune: { name: 'Neptune', glyph: T('♆') },
  Pluto: { name: 'Pluto', glyph: T('♇') },
  NorthNode: { name: 'North Node', glyph: T('☊') },
  SouthNode: { name: 'South Node', glyph: T('☋') },
  Ascendant: { name: 'Ascendant', glyph: 'AC' },
  Midheaven: { name: 'Midheaven', glyph: 'MC' },
};

// ---------------------------------------------------------------------------
// Hebrew letters and the 22 paths
// ---------------------------------------------------------------------------

export type LetterClass = 'mother' | 'double' | 'simple';

export interface HebrewLetter {
  glyph: string;
  /** Final (sofit) form where one exists. */
  finalForm?: string;
  name: string;
  translit: string;
  /** Traditional literal meaning of the letter's name. */
  meaning: string;
  /** Standard gematria value (mispar hechrachi). */
  value: number;
  /** Value of the final form in the extended (sofit) system. */
  finalValue?: number;
  class: LetterClass;
  /** Golden Dawn / Liber 777 attribution. */
  attribution: { kind: 'element' | 'planet' | 'sign'; id: string };
  /** For the seven doubles: planet per Sefer Yetzirah (Gra version, Kaplan). */
  syPlanet?: PointId;
  /** Quality given to the double letter in Sefer Yetzirah 4 (Gra version). */
  syQuality?: string;
  /** Golden Dawn path number 11..32. */
  path: number;
  /** The two sephiroth the path joins (Golden Dawn / Kircher tree). */
  connects: [number, number];
}

export const HEBREW_LETTERS: HebrewLetter[] = [
  { glyph: 'א', name: 'Aleph', translit: 'ʾ', meaning: 'Ox', value: 1, class: 'mother', attribution: { kind: 'element', id: 'Air' }, path: 11, connects: [1, 2] },
  { glyph: 'ב', name: 'Bet', translit: 'b/v', meaning: 'House', value: 2, class: 'double', attribution: { kind: 'planet', id: 'Mercury' }, syPlanet: 'Saturn', syQuality: 'Wisdom', path: 12, connects: [1, 3] },
  { glyph: 'ג', name: 'Gimel', translit: 'g', meaning: 'Camel', value: 3, class: 'double', attribution: { kind: 'planet', id: 'Moon' }, syPlanet: 'Jupiter', syQuality: 'Wealth', path: 13, connects: [1, 6] },
  { glyph: 'ד', name: 'Dalet', translit: 'd', meaning: 'Door', value: 4, class: 'double', attribution: { kind: 'planet', id: 'Venus' }, syPlanet: 'Mars', syQuality: 'Seed', path: 14, connects: [2, 3] },
  { glyph: 'ה', name: 'Heh', translit: 'h', meaning: 'Window', value: 5, class: 'simple', attribution: { kind: 'sign', id: 'Aries' }, path: 15, connects: [2, 6] },
  { glyph: 'ו', name: 'Vav', translit: 'v/w', meaning: 'Nail', value: 6, class: 'simple', attribution: { kind: 'sign', id: 'Taurus' }, path: 16, connects: [2, 4] },
  { glyph: 'ז', name: 'Zayin', translit: 'z', meaning: 'Sword', value: 7, class: 'simple', attribution: { kind: 'sign', id: 'Gemini' }, path: 17, connects: [3, 6] },
  { glyph: 'ח', name: 'Chet', translit: 'ḥ', meaning: 'Fence', value: 8, class: 'simple', attribution: { kind: 'sign', id: 'Cancer' }, path: 18, connects: [3, 5] },
  { glyph: 'ט', name: 'Tet', translit: 'ṭ', meaning: 'Serpent', value: 9, class: 'simple', attribution: { kind: 'sign', id: 'Leo' }, path: 19, connects: [4, 5] },
  { glyph: 'י', name: 'Yod', translit: 'y', meaning: 'Hand', value: 10, class: 'simple', attribution: { kind: 'sign', id: 'Virgo' }, path: 20, connects: [4, 6] },
  { glyph: 'כ', finalForm: 'ך', name: 'Kaph', translit: 'k/kh', meaning: 'Palm of the hand', value: 20, finalValue: 500, class: 'double', attribution: { kind: 'planet', id: 'Jupiter' }, syPlanet: 'Sun', syQuality: 'Life', path: 21, connects: [4, 7] },
  { glyph: 'ל', name: 'Lamed', translit: 'l', meaning: 'Ox-goad', value: 30, class: 'simple', attribution: { kind: 'sign', id: 'Libra' }, path: 22, connects: [5, 6] },
  { glyph: 'מ', finalForm: 'ם', name: 'Mem', translit: 'm', meaning: 'Water', value: 40, finalValue: 600, class: 'mother', attribution: { kind: 'element', id: 'Water' }, path: 23, connects: [5, 8] },
  { glyph: 'נ', finalForm: 'ן', name: 'Nun', translit: 'n', meaning: 'Fish', value: 50, finalValue: 700, class: 'simple', attribution: { kind: 'sign', id: 'Scorpio' }, path: 24, connects: [6, 7] },
  { glyph: 'ס', name: 'Samekh', translit: 's', meaning: 'Prop', value: 60, class: 'simple', attribution: { kind: 'sign', id: 'Sagittarius' }, path: 25, connects: [6, 9] },
  { glyph: 'ע', name: 'Ayin', translit: 'ʿ', meaning: 'Eye', value: 70, class: 'simple', attribution: { kind: 'sign', id: 'Capricorn' }, path: 26, connects: [6, 8] },
  { glyph: 'פ', finalForm: 'ף', name: 'Peh', translit: 'p/f', meaning: 'Mouth', value: 80, finalValue: 800, class: 'double', attribution: { kind: 'planet', id: 'Mars' }, syPlanet: 'Venus', syQuality: 'Dominance', path: 27, connects: [7, 8] },
  { glyph: 'צ', finalForm: 'ץ', name: 'Tzaddi', translit: 'ṣ/tz', meaning: 'Fish-hook', value: 90, finalValue: 900, class: 'simple', attribution: { kind: 'sign', id: 'Aquarius' }, path: 28, connects: [7, 9] },
  { glyph: 'ק', name: 'Qoph', translit: 'q', meaning: 'Back of the head', value: 100, class: 'simple', attribution: { kind: 'sign', id: 'Pisces' }, path: 29, connects: [7, 10] },
  { glyph: 'ר', name: 'Resh', translit: 'r', meaning: 'Head', value: 200, class: 'double', attribution: { kind: 'planet', id: 'Sun' }, syPlanet: 'Mercury', syQuality: 'Peace', path: 30, connects: [8, 9] },
  { glyph: 'ש', name: 'Shin', translit: 'sh/s', meaning: 'Tooth', value: 300, class: 'mother', attribution: { kind: 'element', id: 'Fire' }, path: 31, connects: [8, 10] },
  { glyph: 'ת', name: 'Tav', translit: 't', meaning: 'Mark (cross)', value: 400, class: 'double', attribution: { kind: 'planet', id: 'Saturn' }, syPlanet: 'Moon', syQuality: 'Grace', path: 32, connects: [9, 10] },
];

// ---------------------------------------------------------------------------
// Sephiroth
// ---------------------------------------------------------------------------

export type Pillar = 'severity' | 'mercy' | 'middle';

export interface Sephira {
  number: number;
  hebrew: string;
  translit: string;
  english: string;
  meaning: string;
  /** Classical planet of the sephira's "mundane chakra" (Golden Dawn); null for 1, 2 and 10. */
  planet: PointId | null;
  /** The celestial sphere attributed in Liber 777. */
  sphere: string;
  /**
   * Position on the classic (Kircher / Golden Dawn) tree, as seen facing the
   * diagram: x ∈ {-1, 0, 1} (−1 = Pillar of Severity on the viewer's left,
   * +1 = Pillar of Mercy on the right), y ∈ [0, 1] from Keter (0) down to
   * Malkuth (1) on eighths. Scale y to roughly 3× the x span for the
   * traditional proportions.
   */
  x: number;
  y: number;
  pillar: Pillar;
}

export const SEPHIROTH: Sephira[] = [
  { number: 1, hebrew: 'כתר', translit: 'Keter', english: 'Crown', meaning: 'The first emanation: undivided source and pure being.', planet: null, sphere: 'Primum Mobile (Rashith ha-Gilgalim)', x: 0, y: 0, pillar: 'middle' },
  { number: 2, hebrew: 'חכמה', translit: 'Chokmah', english: 'Wisdom', meaning: 'The first outpouring of force: the dynamic masculine principle.', planet: null, sphere: 'The Zodiac / fixed stars (Mazloth)', x: 1, y: 1 / 8, pillar: 'mercy' },
  { number: 3, hebrew: 'בינה', translit: 'Binah', english: 'Understanding', meaning: 'The great mother who gives force its form.', planet: 'Saturn', sphere: 'Saturn (Shabbathai)', x: -1, y: 1 / 8, pillar: 'severity' },
  { number: 4, hebrew: 'חסד', translit: 'Chesed', english: 'Mercy', meaning: 'Loving-kindness, abundance and the benevolent ordering of creation.', planet: 'Jupiter', sphere: 'Jupiter (Tzedek)', x: 1, y: 3 / 8, pillar: 'mercy' },
  { number: 5, hebrew: 'גבורה', translit: 'Geburah', english: 'Severity (Strength)', meaning: 'Judgement, rigour and the power that cuts away.', planet: 'Mars', sphere: 'Mars (Madim)', x: -1, y: 3 / 8, pillar: 'severity' },
  { number: 6, hebrew: 'תפארת', translit: 'Tiphareth', english: 'Beauty', meaning: 'The harmonising heart of the Tree, balance of mercy and severity.', planet: 'Sun', sphere: 'Sun (Shemesh)', x: 0, y: 4 / 8, pillar: 'middle' },
  { number: 7, hebrew: 'נצח', translit: 'Netzach', english: 'Victory', meaning: 'Endurance, desire and the forces of nature and feeling.', planet: 'Venus', sphere: 'Venus (Nogah)', x: 1, y: 5 / 8, pillar: 'mercy' },
  { number: 8, hebrew: 'הוד', translit: 'Hod', english: 'Splendour', meaning: 'Intellect, language and the forms of ritual and thought.', planet: 'Mercury', sphere: 'Mercury (Kokab)', x: -1, y: 5 / 8, pillar: 'severity' },
  { number: 9, hebrew: 'יסוד', translit: 'Yesod', english: 'Foundation', meaning: 'The astral treasury of images beneath the manifest world.', planet: 'Moon', sphere: 'Moon (Levanah)', x: 0, y: 6 / 8, pillar: 'middle' },
  { number: 10, hebrew: 'מלכות', translit: 'Malkuth', english: 'Kingdom', meaning: 'The manifest world, where all the emanations come to rest.', planet: null, sphere: 'The sphere of the elements (Cholem Yesodoth)', x: 0, y: 1, pillar: 'middle' },
];

/** Da'at, the non-numbered "Knowledge" on the Abyss, for drawing only. */
export const DAAT = { hebrew: 'דעת', translit: "Da'at", english: 'Knowledge', meaning: 'The hidden gate across the Abyss; not counted among the ten.', x: 0, y: 2 / 8, pillar: 'middle' as Pillar };

// ---------------------------------------------------------------------------
// Elements, aspects, Moon phases
// ---------------------------------------------------------------------------

export interface ElementInfo {
  name: ElementName;
  glyph: string;
  /** Aristotelian qualities. */
  qualities: string;
  /** Mother letter (Earth is given Tav in the Golden Dawn scheme). */
  letter: string;
  /** Letter of the Tetragrammaton YHVH. */
  tetragrammaton: string;
  /** Golden Dawn elemental weapon. */
  weapon: string;
  signs: number[];
  theme: string;
}

export const ELEMENTS: ElementInfo[] = [
  { name: 'Fire', glyph: '🜂', qualities: 'hot and dry', letter: 'ש', tetragrammaton: 'י (Yod)', weapon: 'Wand', signs: [0, 4, 8], theme: 'Traditionally will, spirit and the rising energy of life.' },
  { name: 'Water', glyph: '🜄', qualities: 'cold and moist', letter: 'מ', tetragrammaton: 'ה (Heh)', weapon: 'Cup', signs: [3, 7, 11], theme: 'Traditionally feeling, receptivity and the depths of the soul.' },
  { name: 'Air', glyph: '🜁', qualities: 'hot and moist', letter: 'א', tetragrammaton: 'ו (Vav)', weapon: 'Dagger', signs: [2, 6, 10], theme: 'Traditionally mind, breath and the mediating link between fire and water.' },
  { name: 'Earth', glyph: '🜃', qualities: 'cold and dry', letter: 'ת', tetragrammaton: 'ה final (Heh)', weapon: 'Pentacle', signs: [1, 5, 9], theme: 'Traditionally form, body and the fixed ground of manifestation.' },
];

export interface AspectInfo {
  type: AspectType;
  angle: number;
  glyph: string;
  nature: 'neutral' | 'harmonious' | 'challenging';
  meaning: string;
}

export const ASPECT_INFO: Record<AspectType, AspectInfo> = {
  conjunction: { type: 'conjunction', angle: 0, glyph: T('☌'), nature: 'neutral', meaning: 'Traditionally a fusion: the two principles act as one, for good or ill.' },
  sextile: { type: 'sextile', angle: 60, glyph: '⚹', nature: 'harmonious', meaning: 'Traditionally an opportunity: a friendly link that rewards effort.' },
  square: { type: 'square', angle: 90, glyph: '□', nature: 'challenging', meaning: 'Traditionally friction: tension that demands action and builds strength.' },
  trine: { type: 'trine', angle: 120, glyph: '△', nature: 'harmonious', meaning: 'Traditionally ease: a natural flow between kindred elements.' },
  opposition: { type: 'opposition', angle: 180, glyph: T('☍'), nature: 'challenging', meaning: 'Traditionally polarity: awareness through the other, seeking balance.' },
};

export interface MoonPhaseMeaning {
  /** Phase angle range [start, end) in degrees (Sun–Moon elongation). */
  start: number;
  end: number;
  name: string;
  meaning: string;
}

/** Eight phases of 45° each, after Dane Rudhyar's "The Lunation Cycle" (1967). */
export const MOON_PHASE_MEANINGS: MoonPhaseMeaning[] = [
  { start: 0, end: 45, name: 'New Moon', meaning: 'Traditionally a time of seeding: new impulses begin, still unseen.' },
  { start: 45, end: 90, name: 'Crescent', meaning: 'Traditionally a time of emergence, when the new effort struggles free of the old.' },
  { start: 90, end: 135, name: 'First Quarter', meaning: 'Traditionally a crisis of action: building, deciding, committing.' },
  { start: 135, end: 180, name: 'Gibbous', meaning: 'Traditionally a time of refinement and preparation before fulfilment.' },
  { start: 180, end: 225, name: 'Full Moon', meaning: 'Traditionally culmination and illumination: what was seeded is revealed.' },
  { start: 225, end: 270, name: 'Disseminating', meaning: 'Traditionally a time of sharing what has been learned.' },
  { start: 270, end: 315, name: 'Last Quarter', meaning: 'Traditionally a crisis of consciousness: releasing forms that no longer serve.' },
  { start: 315, end: 360, name: 'Balsamic', meaning: 'Traditionally rest, surrender and the quiet preparation of the next seed.' },
];

export function moonPhaseMeaning(phaseAngle: number): MoonPhaseMeaning {
  const a = ((phaseAngle % 360) + 360) % 360;
  return MOON_PHASE_MEANINGS[Math.min(7, Math.floor(a / 45))];
}

/** The Emerald Tablet of Hermes, in Isaac Newton's translation (public domain). */
export const EMERALD_TABLET: string[] = [
  'Tis true without lying, certain & most true.',
  'That which is below is like that which is above & that which is above is like that which is below to do the miracles of one only thing.',
  'And as all things have been & arose from one by the mediation of one: so all things have their birth from this one thing by adaptation.',
  'The Sun is its father, the moon its mother,',
  'the wind hath carried it in its belly, the earth its nurse.',
  'The father of all perfection in the whole world is here.',
  'Its force or power is entire if it be converted into earth.',
  'Separate thou the earth from the fire, the subtle from the gross sweetly with great industry.',
  'It ascends from the earth to the heaven & again it descends to the earth and receives the force of things superior & inferior.',
  'By this means you shall have the glory of the whole world & thereby all obscurity shall fly from you.',
  'Its force is above all force. For it vanquishes every subtle thing & penetrates every solid thing.',
  'So was the world created.',
  'From this are & do come admirable adaptations whereof the means (Or process) is here in this.',
  'Hence I am called Hermes Trismegist, having the three parts of the philosophy of the whole world.',
  'That which I have said of the operation of the Sun is accomplished & ended.',
];

// ---------------------------------------------------------------------------
// Lookups and the "lit" Tree
// ---------------------------------------------------------------------------

export function planetInfo(id: PointId): PlanetInfo | undefined {
  return PLANETS.find((p) => p.id === id);
}

export function letterByGlyph(glyph: string): HebrewLetter | undefined {
  return HEBREW_LETTERS.find((l) => l.glyph === glyph);
}

export function letterForPath(path: number): HebrewLetter | undefined {
  return HEBREW_LETTERS.find((l) => l.path === path);
}

/** Hebrew letter of a planet in the chosen tradition (null for the modern planets). */
export function planetLetter(id: PointId, tradition: LetterTradition): HebrewLetter | null {
  const p = planetInfo(id);
  const g = p ? (tradition === 'golden-dawn' ? p.letterGD : p.letterSY) : null;
  return g ? letterByGlyph(g) ?? null : null;
}

/** Sum of the standard gematria values of a Hebrew string (final forms count as their base value). */
export function gematria(text: string): number {
  const finals: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  let sum = 0;
  for (const ch of text) {
    const l = letterByGlyph(finals[ch] ?? ch);
    if (l) sum += l.value;
  }
  return sum;
}

export interface TreeActivation {
  point: PointId;
  kind: 'sephira' | 'planet-path' | 'sign-path';
  /** Sephira number (kind 'sephira') or path number 11..32. */
  target: number;
  letter?: string;
  note: string;
}

export interface ActiveTree {
  /** Sephiroth lit by the chart (sorted, unique). */
  sephiroth: number[];
  /** Paths 11..32 lit by the chart (sorted, unique). */
  paths: number[];
  /** Why each item is lit, for tooltips. */
  reasons: TreeActivation[];
}

const TREE_POINTS: PointId[] = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Ascendant'];

/**
 * Which sephiroth and paths a chart "lights" in Hermetic Qabalah:
 * each classical planet lights its sephira and the path of its double letter
 * (per `tradition`); every planet (and the Ascendant) lights the path of the
 * simple letter of the sign it occupies. Path positions follow the Golden
 * Dawn tree in both traditions; only the planet↔letter attribution changes.
 */
export function activePaths(chart: Chart, tradition: LetterTradition = 'golden-dawn'): ActiveTree {
  const reasons: TreeActivation[] = [];
  for (const id of TREE_POINTS) {
    const pt = chart.points.find((p) => p.id === id);
    if (!pt) continue;
    const info = planetInfo(id);
    const name = POINT_INFO[id].name;
    if (info?.sephira) {
      const s = SEPHIROTH[info.sephira - 1];
      reasons.push({ point: id, kind: 'sephira', target: s.number, note: `${name} is attributed to ${s.translit} (${s.english}).` });
    }
    const pl = planetLetter(id, tradition);
    if (pl) {
      reasons.push({ point: id, kind: 'planet-path', target: pl.path, letter: pl.glyph, note: `${name} ↔ ${pl.name} (${pl.glyph}), path ${pl.path}.` });
    }
    const sign = SIGNS[pt.sign];
    const sl = letterByGlyph(sign.letter)!;
    reasons.push({ point: id, kind: 'sign-path', target: sl.path, letter: sl.glyph, note: `${name} in ${sign.name} ↔ ${sl.name} (${sl.glyph}), path ${sl.path}.` });
  }
  const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
  return {
    sephiroth: uniq(reasons.filter((r) => r.kind === 'sephira').map((r) => r.target)),
    paths: uniq(reasons.filter((r) => r.kind !== 'sephira').map((r) => r.target)),
    reasons,
  };
}
