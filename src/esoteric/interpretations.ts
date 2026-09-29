/**
 * Short interpretive phrases for the "As Above" notes: what astrologers
 * traditionally read into houses, planetary passages, stations, lunations and
 * eclipses. Everything is phrased as tradition, kept brief and non-fatalistic,
 * and makes no health, medical or financial claims.
 */
import type { AspectType, PointId } from './types';

export interface HouseTheme {
  house: number;
  name: string;
  /** Noun phrase used in sentences ("… brings energy to {area}"). */
  area: string;
  /** One line, phrased as tradition. */
  line: string;
}

export const HOUSE_THEMES: HouseTheme[] = [
  { house: 1, name: 'Self', area: 'your identity, presence and new beginnings', line: 'Traditionally the house of the self: temperament, appearance and how you meet the world.' },
  { house: 2, name: 'Resources', area: 'your possessions, values and sense of worth', line: 'Traditionally the house of what you hold: belongings, resources and what you value.' },
  { house: 3, name: 'Communication', area: 'conversation, learning, siblings and your neighbourhood', line: 'Traditionally the house of the near environment: speech, study, siblings and short journeys.' },
  { house: 4, name: 'Home & roots', area: 'home, family and your inner foundations', line: 'Traditionally the house of roots: home, family, ancestry and the private self.' },
  { house: 5, name: 'Creativity & joy', area: 'creativity, play, romance and children', line: 'Traditionally the house of pleasure: creative expression, romance, children and play.' },
  { house: 6, name: 'Work & service', area: 'daily work, routines and acts of service', line: 'Traditionally the house of daily labour: duties, routines, service and craft.' },
  { house: 7, name: 'Partnerships', area: 'close relationships, agreements and open rivals', line: 'Traditionally the house of the other: partners, contracts and those who oppose you openly.' },
  { house: 8, name: 'Transformation', area: 'shared resources, intimacy, endings and renewal', line: 'Traditionally the house of what is shared and what ends: intimacy, legacies and transformation.' },
  { house: 9, name: 'Philosophy & journeys', area: 'belief, higher learning and long journeys', line: 'Traditionally the house of the far: faith, philosophy, higher study and travel abroad.' },
  { house: 10, name: 'Vocation', area: 'vocation, reputation and public life', line: 'Traditionally the house of the summit: calling, standing and your place in the world.' },
  { house: 11, name: 'Friends & hopes', area: 'friendships, community and hopes for the future', line: 'Traditionally the house of good spirits: friends, allies, groups and aspirations.' },
  { house: 12, name: 'The hidden', area: 'solitude, retreat, dreams and the unseen', line: 'Traditionally the house of what is hidden: retreat, the unconscious and spiritual work.' },
];

export interface PlanetTransitTheme {
  /** Verb phrase for personal notes ("Mars entering your 7th house {verb} {area}"). */
  verb: string;
  /** What the planet's passage colours in the collective ("Mars in Scorpio colours {world} with …"). */
  world: string;
  /** Typical time spent in one sign. */
  typicalStay: string;
}

export const PLANET_TRANSIT_THEMES: Partial<Record<PointId, PlanetTransitTheme>> = {
  Sun: { verb: 'traditionally brings attention, vitality and visibility to', world: 'the collective focus and sense of purpose', typicalStay: 'about a month' },
  Moon: { verb: 'traditionally brings mood, need and sensitivity to', world: 'the public mood', typicalStay: 'about two and a half days' },
  Mercury: { verb: 'traditionally brings thought, talk and errands to', world: 'communication, commerce and news', typicalStay: 'two to eight weeks' },
  Venus: { verb: 'traditionally brings affection, harmony and appreciation to', world: 'social life, art and diplomacy', typicalStay: 'about four weeks (up to four months when retrograde)' },
  Mars: { verb: 'traditionally brings energy, drive and friction to', world: 'collective drive, conflict and initiative', typicalStay: 'about six weeks (up to seven months when retrograde)' },
  Jupiter: { verb: 'traditionally brings growth, opportunity and generosity to', world: 'growth, belief, law and optimism', typicalStay: 'about a year' },
  Saturn: { verb: 'traditionally brings structure, tests and responsibility to', world: 'institutions, limits and responsibilities', typicalStay: 'about two and a half years' },
  Uranus: { verb: 'traditionally brings awakening and sudden change to', world: 'innovation, upheaval and technology', typicalStay: 'about seven years' },
  Neptune: { verb: 'traditionally brings inspiration, idealism and uncertainty to', world: 'ideals, faith, art and collective dreams', typicalStay: 'about fourteen years' },
  Pluto: { verb: 'traditionally brings deep, slow transformation to', world: 'power, hidden structures and deep transformation', typicalStay: 'twelve to thirty years' },
  NorthNode: { verb: 'traditionally points the direction of growth toward', world: 'the direction of collective growth', typicalStay: 'about eighteen months' },
};

/** Noun phrase describing the manner of each sign, for "… colours X with {style}". */
export const SIGN_STYLES: string[] = [
  'boldness, speed and pioneering initiative',
  'steadiness, patience and attention to the material',
  'curiosity, exchange and versatility',
  'protectiveness, memory and concern for home',
  'pride, generosity and display',
  'analysis, craft and service',
  'diplomacy, balance and concern for fairness',
  'intensity, secrecy and strategy',
  'expansiveness, belief and far horizons',
  'discipline, ambition and structure',
  'innovation, collective ideals and detachment',
  'compassion, imagination and dissolving boundaries',
];

export const STATION_MEANINGS = {
  retrograde: 'Astrologers read a retrograde station as an inward turn: a time to review, revisit and reconsider rather than to launch.',
  direct: 'Astrologers read a direct station as a release: what was under review begins to move forward again.',
};

export const LUNATION_MEANINGS = {
  new: 'Traditionally the New Moon is a seed moment, favoured for setting intentions and quiet beginnings.',
  full: 'Traditionally the Full Moon brings culmination and illumination, a time to complete, celebrate or release.',
};

export const ECLIPSE_MEANINGS = {
  solar: 'Solar eclipses were traditionally read as omens for rulers and nations; modern astrologers read them as powerful new beginnings that unfold over months.',
  lunar: 'Lunar eclipses were traditionally read as omens of change; modern astrologers read them as emotional culminations that bring hidden matters to light.',
};

/** How each aspect joins two planetary principles, for mundane notes. */
export const ASPECT_WORLD_VERBS: Record<AspectType, string> = {
  conjunction: 'begins a new cycle joining',
  sextile: 'opens cooperation between',
  square: 'brings tension and a crisis of action between',
  trine: 'brings an easy flow between',
  opposition: 'brings a culmination or standoff between',
};

export const ASPECT_PERSONAL_VERBS: Record<AspectType, string> = {
  conjunction: 'merges with',
  sextile: 'offers an opening to',
  square: 'challenges',
  trine: 'supports',
  opposition: 'confronts',
};
