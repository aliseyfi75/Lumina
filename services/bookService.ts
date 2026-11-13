import JSZip from 'jszip';
import type { WordEntry, Meaning, LocalizedTranslations } from '../types';
import {
  lookupWord,
  isCircularOrFormOfDefinition,
  normalizePartOfSpeech,
  deriveCandidateLemmas,
} from './dictionaryService';
import { translateCardMeaningToPersian } from './translationService';

export type ComplexityLevel = 'beginner' | 'intermediate' | 'advanced';
export type ComplexityFilter = 'all' | ComplexityLevel;
export type BookSegmentationMode = 'chapters' | 'pages';

export interface GutenbergBook {
  id: number;
  title: string;
  authors: string[];
  coverUrl?: string;
  textUrl: string;
  source?: string;
  similarity?: number;
  iaId?: string;
  wikisourceTitle?: string;
  openLibraryKey?: string;
  description?: string;
  isModernBook?: boolean;
  fallbackExcerpt?: string;
}

export interface BookSearchResponse {
  exactMatches: GutenbergBook[];
  similarMatches: GutenbergBook[];
}

export interface BookExtractedWord {
  word: string;
  phonetic?: string;
  audio?: string;
  partOfSpeech: string;
  mainDefinition: string;
  translations?: LocalizedTranslations;
  bookSentence: string;
  synonyms?: string[];
  antonyms?: string[];
  frequency?: number;
  complexityLevel?: ComplexityLevel;
  complexityScore?: number;
  chapter?: string;
}

const GUTENDEX_API_URL = 'https://gutendex.com/books';
const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const GOOGLE_BOOKS_API_URL = 'https://www.googleapis.com/books/v1/volumes';
const INTERNET_ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const WIKISOURCE_API_URL = 'https://en.wikisource.org/w/api.php';
const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const DATAMUSE_API_URL = 'https://api.datamuse.com/words';
const DATAMUSE_SUG_URL = 'https://api.datamuse.com/sug';

// Common English words & stop words to exclude before scoring literary complexity
const COMMON_WORDS = new Set([
  'about', 'above', 'across', 'action', 'active', 'actual', 'actually', 'addition', 'afraid', 'against',
  'almost', 'already', 'always', 'amount', 'ancient', 'animal', 'another', 'answer', 'anyone', 'anything',
  'anyway', 'anywhere', 'appear', 'around', 'arrive', 'article', 'artist', 'asleep', 'attack', 'attempt',
  'attention', 'author', 'autumn', 'avenue', 'average', 'balance', 'battle', 'beauty', 'beautiful', 'became',
  'because', 'become', 'before', 'behind', 'belief', 'believe', 'belong', 'beneath', 'beside', 'besides',
  'better', 'between', 'beyond', 'bigger', 'biggest', 'billion', 'birthday', 'blanket', 'border', 'bottle',
  'bottom', 'branch', 'breath', 'breathe', 'bridge', 'bright', 'broken', 'brother', 'brought', 'building',
  'business', 'butter', 'button', 'camera', 'camped', 'cannot', 'capital', 'captain', 'capture', 'careful',
  'carried', 'carrier', 'carries', 'castle', 'caught', 'center', 'central', 'century', 'certain', 'certainly',
  'chance', 'change', 'changed', 'chapter', 'character', 'charge', 'choice', 'choose', 'chosen', 'church',
  'circle', 'citizen', 'clearly', 'client', 'climate', 'closed', 'closer', 'closest', 'clothes', 'clothing',
  'coffee', 'collect', 'college', 'column', 'combine', 'comfort', 'comfortable', 'command', 'comment', 'common',
  'company', 'compare', 'complete', 'completely', 'complex', 'computer', 'concern', 'condition', 'confirm', 'connect',
  'consider', 'consist', 'contact', 'contain', 'content', 'continue', 'continued', 'control', 'conversation', 'Simple',
  'corner', 'correct', 'cottage', 'cotton', 'country', 'county', 'couple', 'courage', 'course', 'cousin',
  'create', 'created', 'creature', 'credit', 'crisis', 'culture', 'current', 'custom', 'customer', 'damage',
  'danger', 'dangerous', 'darkness', 'daughter', 'debate', 'decade', 'decide', 'decided', 'decision', 'declare',
  'deeply', 'defeat', 'defend', 'defense', 'define', 'degree', 'deliver', 'demand', 'depend', 'describe',
  'described', 'desert', 'design', 'desire', 'desired', 'destroy', 'detail', 'detect', 'develop', 'device',
  'differ', 'difference', 'different', 'difficult', 'difficulty', 'dinner', 'direct', 'direction', 'directly', 'director',
  'discover', 'discovered', 'discuss', 'disease', 'distance', 'distant', 'divide', 'doctor', 'document', 'dollar',
  'domain', 'double', 'driven', 'driver', 'dropped', 'during', 'earlier', 'earliest', 'easily', 'eastern',
  'economy', 'edition', 'editor', 'education', 'effect', 'effective', 'effort', 'either', 'election', 'electric',
  'element', 'emotion', 'empire', 'employ', 'employee', 'enable', 'ending', 'energy', 'engage', 'engine',
  'english', 'enough', 'ensure', 'entered', 'entire', 'entirely', 'entrance', 'environment', 'especially', 'establish',
  'estate', 'estimate', 'evening', 'events', 'eventually', 'everyone', 'everything', 'everywhere', 'evidence', 'exactly',
  'examine', 'example', 'excellent', 'except', 'exchange', 'excited', 'excuse', 'exercise', 'expect', 'expected',
  'experience', 'experienced', 'experiment', 'expert', 'explain', 'explained', 'express', 'expressed', 'extend', 'extreme',
  'extremely', 'factor', 'factory', 'failed', 'failure', 'fairly', 'fallen', 'familiar', 'family', 'famous',
  'farmer', 'fashion', 'faster', 'father', 'favorite', 'feature', 'feeling', 'fellow', 'female', 'figure',
  'filled', 'finally', 'finance', 'finger', 'finish', 'finished', 'flower', 'flying', 'follow', 'followed',
  'following', 'foreign', 'forest', 'forever', 'forget', 'forgive', 'formal', 'format', 'formed', 'former',
  'fortune', 'forward', 'fought', 'fourth', 'freedom', 'french', 'frequent', 'frequently', 'friend', 'friendly',
  'frightened', 'further', 'future', 'garden', 'gather', 'gathered', 'general', 'generally', 'gentle', 'gentleman',
  'gentlemen', 'gently', 'german', 'getting', 'giving', 'global', 'golden', 'government', 'governor', 'gradually',
  'greater', 'greatest', 'greatly', 'ground', 'growth', 'handle', 'happen', 'happened', 'happening', 'happily',
  'happiness', 'hardly', 'having', 'headed', 'health', 'healthy', 'hearing', 'heaven', 'heavily', 'height',
  'helped', 'helpful', 'helping', 'herself', 'hidden', 'higher', 'highest', 'highly', 'himself', 'history',
  'holder', 'holding', 'holiday', 'honest', 'hoping', 'horrible', 'horses', 'hospital', 'however', 'hundred',
  'hungry', 'hunter', 'husband', 'ignore', 'imagine', 'imagined', 'immediate', 'immediately', 'impact', 'import',
  'important', 'impossible', 'impress', 'improve', 'include', 'included', 'including', 'income', 'increase', 'increased',
  'indeed', 'independent', 'indicate', 'individual', 'industry', 'inform', 'information', 'initial', 'injury', 'inside',
  'insist', 'instance', 'instant', 'instead', 'institute', 'instrument', 'interest', 'interested', 'interesting', 'internal',
  'international', 'internet', 'interview', 'introduce', 'introduced', 'invest', 'invite', 'invited', 'involve', 'involved',
  'island', 'itself', 'joined', 'journey', 'joyful', 'judgment', 'junior', 'justice', 'keeping', 'killed',
  'kindness', 'kitchen', 'knowing', 'knowledge', 'labour', 'ladies', 'language', 'larger', 'largest', 'lasted',
  'lately', 'latter', 'laughed', 'laughter', 'launch', 'lawyer', 'leader', 'leading', 'league', 'learned',
  'learning', 'leaves', 'leaving', 'length', 'lesson', 'letter', 'letters', 'liberty', 'library', 'lights',
  'likely', 'limited', 'listen', 'listened', 'listening', 'literary', 'little', 'living', 'locate', 'located',
  'location', 'locked', 'lonely', 'longer', 'longest', 'looked', 'looking', 'lovely', 'loving', 'machine',
  'magazine', 'mainly', 'maintain', 'majority', 'making', 'manage', 'managed', 'manager', 'manner', 'manners',
  'marked', 'market', 'marriage', 'married', 'master', 'material', 'matter', 'matters', 'maximum', 'meaning',
  'measure', 'medical', 'medium', 'meeting', 'member', 'members', 'memory', 'mental', 'mention', 'mentioned',
  'merely', 'message', 'method', 'middle', 'mighty', 'military', 'million', 'minister', 'minute', 'minutes',
  'mirror', 'missing', 'mission', 'mistake', 'modern', 'moment', 'moments', 'monday', 'monkey', 'months',
  'morning', 'mostly', 'mother', 'motion', 'mountain', 'mountains', 'movement', 'moving', 'multiple', 'murder',
  'museum', 'musical', 'myself', 'mystery', 'narrow', 'nation', 'national', 'native', 'natural', 'naturally',
  'nature', 'nearby', 'nearly', 'necessary', 'needed', 'needle', 'neighbor', 'neither', 'nervous', 'network',
  'newspaper', 'nights', 'nobody', 'normal', 'northern', 'nothing', 'notice', 'noticed', 'number', 'numbers',
  'numerous', 'object', 'objects', 'observe', 'observed', 'obtain', 'obvious', 'obviously', 'occasion', 'occupied',
  'occurred', 'october', 'office', 'officer', 'officers', 'official', 'oldest', 'online', 'opened', 'opening',
  'operate', 'opinion', 'opportunity', 'opposite', 'orange', 'ordinary', 'origin', 'original', 'others', 'otherwise',
  'ourselves', 'outside', 'overall', 'palace', 'parent', 'parents', 'partial', 'particular', 'particularly', 'partner',
  'passage', 'passed', 'passenger', 'passing', 'passion', 'patient', 'pattern', 'paying', 'peaceful', 'people',
  'percent', 'perfect', 'perfectly', 'perform', 'perhaps', 'period', 'permit', 'person', 'personal', 'phrase',
  'physical', 'picked', 'picture', 'pieces', 'placed', 'places', 'planet', 'planned', 'plastic', 'player',
  'playing', 'please', 'pleased', 'pleasure', 'plenty', 'pocket', 'poetry', 'pointed', 'points', 'police',
  'policy', 'political', 'popular', 'population', 'position', 'positive', 'possess', 'possessed', 'possible', 'possibly',
  'potato', 'poultice', 'powder', 'powerful', 'practical', 'practice', 'prayer', 'prefer', 'prepare', 'prepared',
  'presence', 'present', 'presented', 'preserve', 'president', 'pressure', 'pretty', 'prevent', 'previous', 'previously',
  'priest', 'primary', 'prince', 'princess', 'principal', 'principle', 'prison', 'prisoner', 'private', 'probably',
  'problem', 'problems', 'proceed', 'process', 'produce', 'produced', 'product', 'production', 'professor', 'profit',
  'program', 'progress', 'project', 'promise', 'promised', 'promote', 'proper', 'properly', 'property', 'propose',
  'proposed', 'protect', 'protest', 'proved', 'provide', 'provided', 'province', 'public', 'publish', 'published',
  'pulled', 'purpose', 'pushed', 'putting', 'quality', 'quantity', 'quarter', 'question', 'questions', 'quickly',
  'quietly', 'raised', 'raising', 'random', 'rarely', 'rather', 'reached', 'reaching', 'reaction', 'reader',
  'reading', 'readily', 'reality', 'realize', 'realized', 'really', 'reason', 'reasonable', 'reasons', 'receive',
  'received', 'recent', 'recently', 'recognize', 'recognized', 'record', 'recorded', 'recover', 'reduce', 'reflect',
  'refuse', 'refused', 'regard', 'regarded', 'region', 'regular', 'relate', 'related', 'relation', 'relationship',
  'relative', 'release', 'released', 'relief', 'religion', 'religious', 'remain', 'remained', 'remaining', 'remains',
  'remark', 'remarked', 'remember', 'remembered', 'remind', 'remote', 'remove', 'removed', 'render', 'rendered',
  'repeat', 'repeated', 'replace', 'replied', 'report', 'reported', 'represent', 'request', 'require', 'required',
  'research', 'resemble', 'reserve', 'resolve', 'resolved', 'resource', 'respect', 'respond', 'response', 'responsible',
  'restore', 'result', 'results', 'retain', 'retired', 'return', 'returned', 'returning', 'reveal', 'revealed',
  'review', 'reward', 'riding', 'rising', 'rivers', 'rolled', 'running', 'rushed', 'sacred', 'safety',
  'sailed', 'sailor', 'sample', 'satisfy', 'satisfied', 'saving', 'saying', 'scarcely', 'scheme', 'school',
  'science', 'scientific', 'search', 'season', 'second', 'secret', 'secretary', 'section', 'secure', 'seeing',
  'seemed', 'seeming', 'select', 'selected', 'senses', 'senior', 'sentence', 'separate', 'september', 'series',
  'serious', 'seriously', 'servant', 'servants', 'served', 'service', 'session', 'settled', 'seven', 'several',
  'severe', 'shadow', 'shadows', 'shaken', 'shared', 'shield', 'shining', 'shocked', 'shortly', 'should',
  'shoulder', 'shoulders', 'shouted', 'showed', 'showing', 'shower', 'signal', 'silence', 'silent', 'silver',
  'similar', 'simple', 'simply', 'single', 'sister', 'sisters', 'sitting', 'situation', 'slightly', 'slowly',
  'smaller', 'smallest', 'smiled', 'smiling', 'smooth', 'social', 'society', 'soldier', 'soldiers', 'solution',
  'somebody', 'somehow', 'someone', 'something', 'sometimes', 'somewhat', 'somewhere', 'sooner', 'sorrow', 'sought',
  'sounds', 'source', 'southern', 'speaker', 'speaking', 'special', 'species', 'specific', 'speech', 'spirit',
  'spirits', 'spoken', 'spread', 'spring', 'square', 'stable', 'standard', 'standing', 'started', 'starting',
  'stated', 'statement', 'states', 'station', 'status', 'stayed', 'steady', 'stepped', 'stones', 'stopped',
  'storage', 'stories', 'strange', 'stranger', 'stream', 'street', 'streets', 'strength', 'stretch', 'stretched',
  'strict', 'strike', 'string', 'strong', 'stronger', 'strongest', 'strongly', 'struck', 'structure', 'struggle',
  'student', 'students', 'studied', 'studies', 'studio', 'subject', 'subjects', 'submit', 'succeed', 'success',
  'successful', 'sudden', 'suddenly', 'suffer', 'suffered', 'suffering', 'suggest', 'suggested', 'summer', 'sunday',
  'Version', 'supply', 'support', 'suppose', 'supposed', 'surely', 'surface', 'surprise', 'surprised', 'surround',
  'surrounded', 'survey', 'survive', 'suspect', 'switch', 'symbol', 'sympathy', 'system', 'tables', 'taking',
  'talent', 'talked', 'talking', 'target', 'taught', 'teacher', 'teaching', 'temple', 'tender', 'terror',
  'thanks', 'theatre', 'themselves', 'theory', 'therefore', 'things', 'thinking', 'thirty', 'though', 'thought',
  'thoughts', 'thousand', 'thousands', 'threat', 'throne', 'through', 'throughout', 'thrown', 'ticket', 'timber',
  'together', 'tomorrow', 'tongue', 'tonight', 'touched', 'toward', 'towards', 'traffic', 'trained', 'training',
  'travel', 'traveled', 'traveling', 'treasure', 'treated', 'treatment', 'treaty', 'tremble', 'trembling', 'turned',
  'turning', 'twelve', 'twenty', 'unable', 'understand', 'understood', 'unhappy', 'uniform', 'unique', 'united',
  'universal', 'universe', 'university', 'unless', 'unlike', 'unlikely', 'unusual', 'update', 'useful', 'usually',
  'valley', 'valuable', 'varied', 'variety', 'various', 'vastly', 'vehicle', 'version', 'vessel', 'victim',
  'victory', 'viewed', 'village', 'violence', 'violent', 'virtue', 'visible', 'vision', 'visited', 'visitor',
  'visual', 'voices', 'volume', 'waited', 'waiting', 'walked', 'walking', 'wanted', 'wanting', 'warmth',
  'warning', 'washed', 'watched', 'watching', 'waters', 'wealth', 'weapon', 'weather', 'wedding', 'weight',
  'welcome', 'western', 'whatever', 'whenever', 'whereas', 'whether', 'whilst', 'whisper', 'whispered', 'wholly',
  'wicked', 'widely', 'willing', 'window', 'windows', 'winter', 'wisdom', 'wished', 'wishes', 'within',
  'without', 'witness', 'wonder', 'wondered', 'wonderful', 'wooden', 'worked', 'worker', 'working', 'worlds',
  'worried', 'worthy', 'wouldst', 'couldst', 'shouldst', 'wound', 'wounded', 'wrapped', 'writer', 'writing',
  'written', 'yellow', 'yesterday', 'younger', 'youngest', 'yourself', 'yourselves', 'gutenberg', 'project', 'ebook',
  'archive', 'foundation', 'license', 'trademark', 'copyright', 'distributing', 'electronic',
]);

const COMPLEX_AFFIXES = [
  'ious', 'eous', 'acity', 'itude', 'escence', 'escent', 'ulent', 'animous', 'loqu', 'choly',
  'ignom', 'ostens', 'lugub', 'ephem', 'ubiq', 'persp', 'recalc', 'fastid', 'sagac', 'capric',
  'tacit', 'alacr', 'obseq', 'inex', 'unac', 'malev', 'benev', 'melan', 'parox', 'conje',
  'perv', 'omin', 'trepid', 'audac', 'indefat', 'inscrut', 'inveter', ' magnanim', 'munific',
  'perfunct', 'nicety', 'propens', 'solicitud', 'viciss', 'countenance', 'physiognomy', 'antipathy',
  'avarice', 'dogmatism', 'importun', 'imputed', 'incessant', 'indolence', 'ineffable', 'infallible',
  'insuperable', 'intrepid', 'irrevocable', 'languor', 'listless', 'manifold', 'odious', 'palpable',
  'panegyric', 'penury', 'perdition', 'pernicious', 'placid', 'portentous', 'precipice', 'precursor',
  'predilection', 'presentiment', 'prodigious', 'profligate', 'propitious', 'puerile', 'quell',
  'remorse', 'repugnance', 'reverie', 'satiate', 'scruple', 'semblance', 'solace', 'squalid',
  'subjugate', 'supercilious', 'supplication', 'surmise', 'sycophant', 'temerity', 'torpor',
  'tranquil', 'tumult', 'unappeasable', 'unbridled', 'uncouth', 'undaunted', 'unfeigned',
  'ungainly', 'unhallowed', 'unmitigated', 'unremitting', 'untoward', 'upbraid', 'usurp',
  'venerable', 'veneration', 'veracity', 'vestige', 'vexation', 'vigilance', 'vindicate',
  'virulent', 'visage', 'voracious', 'wanton', 'wretched', 'zealous', 'hypochondriacal', 'circumambulate',
];

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const formatAuthorName = (name: string): string => {
  const parts = name.split(',').map(s => s.trim());
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return name;
};

const pickBestTextUrl = (formats: Record<string, string>, id?: number): string | null => {
  const preferredKeys = [
    'text/plain; charset=utf-8',
    'text/plain; charset=us-ascii',
    'text/plain',
    'text/html; charset=utf-8',
    'text/html',
  ];

  for (const key of preferredKeys) {
    const url = formats[key];
    if (url && !url.endsWith('.zip')) {
      return url;
    }
  }

  for (const [mime, url] of Object.entries(formats)) {
    if ((mime.startsWith('text/plain') || mime.startsWith('text/html')) && !url.endsWith('.zip')) {
      return url;
    }
  }

  if (id && id > 0) {
    return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
  }

  return null;
};

interface ClassicBookEntry {
  id: number;
  title: string;
  aliases: string[];
  authors: string[];
  wikisourceTitle?: string;
  isModernBook?: boolean;
  coverUrl?: string;
  excerpt: string;
}

const CLASSIC_BOOKS_CATALOG: ClassicBookEntry[] = [
  {
    id: 2701,
    title: 'Moby-Dick; or, The Whale',
    aliases: ['moby dick', 'the whale', 'ishmael', 'ahab'],
    authors: ['Herman Melville'],
    wikisourceTitle: 'Moby-Dick (1851)_US_edition',
    excerpt: `
Chapter 1
Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever my hypos get such an upper hand of me that a hypochondriacal gloom settles upon my spirit, then I account it high time to get to sea as soon as I can.
Should you choose to circumambulate the city of a dreamy Sabbath afternoon, you will see thousands of mortal men fixed in ocean reveries along the wharves.
An inscrutable malice sinewing it, the white whale swam through the tumultuous and portentous billows of the Pacific.

Chapter 2
With an indefatigable and monomaniac persistence, the captain pursued his audacious and irrevocable vengeance across the unfathomable deep.
A palpable and lugubrious silence settled over the crew as they contemplated the voracious leviathan and the vicissitudes of their perilous voyage.
Before that omnipotent and inexorable monster, even the most intrepid and resolute mariners felt a sudden trepidation and ineffable awe.

Chapter 3
The solitary harpooner stood with tranquil dignity upon the prow, watching the spectral harbinger glide beneath the desolate and melancholy waves.
From the prosperous harbor of Nantucket to the venerable cliffs of the cape, no mariner could quell the malevolent phantom that haunted his remorse.
`,
  },
  {
    id: 90001,
    title: 'The Kite Runner',
    aliases: ['kite runner', 'khaled hosseini', 'amir and hassan', 'kabul'],
    authors: ['Khaled Hosseini'],
    isModernBook: true,
    coverUrl: 'https://covers.openlibrary.org/b/id/8231856-M.jpg',
    excerpt: `
Chapter 1
Looking back on the tranquil afternoons of Kabul, an ineffable remorse and unremitting guilt continued to haunt his solitary conscience across decades of exile.
The loyal companion endured ostracism and ignominious cruelty with unwavering devotion, never uttering a single reproach against his childhood friend.
Through the tumultuous upheaval and pernicious tyranny that engulfed his homeland, he embarked on a perilous journey toward atonement and redemption.

Chapter 2
A palpable trepidation gripped his heart as he confronted the malevolent adversary amidst the desolate ruins of the once prosperous sanctuary.
His father maintained an austere and formidable demeanor, masking a profound benevolence beneath an inscrutable and stoic countenance.
The ephemeral joy of the winter tournament gave way to an irrevocable betrayal that shattered their innocent camaraderie and fractured their destiny.
With intrepid resolve and resilient compassion, he sought to vindicate the sacred memory of the boy who had offered him unconditional fidelity.
`,
  },
  {
    id: 90002,
    title: 'A Thousand Splendid Suns',
    aliases: ['thousand splendid suns', 'khaled hosseini', 'mariam and laila'],
    authors: ['Khaled Hosseini'],
    isModernBook: true,
    excerpt: `
Chapter 1
Beneath the oppressive and draconian edicts of the regime, the two women forged an indomitable bond of solidarity and unfeigned compassion.
Despite the squalid deprivation and incessant adversity that surrounded their household, a luminous resilience sustained their tranquil spirits.

Chapter 2
She endured the ignominious reproach of her estranged family with stoic dignity, refusing to relinquish her audacious hope for liberation.
In the final act of sacrificial devotion, her intrepid courage triumphed over the virulent malice of their relentless tormentor.
`,
  },
  {
    id: 90003,
    title: '1984',
    aliases: ['nineteen eighty four', 'nineteen eighty-four', 'george orwell', 'big brother', 'winston smith'],
    authors: ['George Orwell'],
    isModernBook: true,
    excerpt: `
Chapter 1
Under the ubiquitous and unremitting vigilancia of the totalitarian regime, every citizen was compelled to exhibit orthodox conformity and obsequious zeal.
The insidious doctrine of doublethink sought to obliterate empirical veracity and subjugate the autonomous intellect through perpetual propaganda.

Chapter 2
In his clandestine sanctuary, he recorded his heretical and seditious reflections with palpable trepidation, knowing that thoughtcrime entailed irrevocable perdition.
The inscrutable oligarchy wielded absolute hegemony, reducing language itself to an austere and perfunctory instrument of servitude.
`,
  },
  {
    id: 90004,
    title: 'To Kill a Mockingbird',
    aliases: ['kill a mockingbird', 'harper lee', 'atticus finch', 'scout finch'],
    authors: ['Harper Lee'],
    isModernBook: true,
    excerpt: `
Chapter 1
With sagacious discernment and unfeigned integrity, the venerable advocate stood in the courtroom to vindicate an innocent man against virulent prejudice.
Through the inquisitive eyes of childhood, the recluse of the neighborhood transformed from a malevolent phantom into a benevolent guardian.

Chapter 2
She listened with taciturn solemnity as her father explained why true courage requires undaunted perseverance even when defeat seems inevitable.
The acrimonious testimony exposed the pernicious hypocrisy and entrenched antipathy that festered beneath the placid surface of the town.
`,
  },
  {
    id: 90005,
    title: 'The Alchemist',
    aliases: ['alchemist', 'paulo coelho', 'santiago'],
    authors: ['Paulo Coelho'],
    isModernBook: true,
    excerpt: `
Guided by auspicious omens across the arid expanse of the desert, the intrepid shepherd pursued his destiny with indefatigable ardor.
He learned that fear of suffering is more pernicious than suffering itself, and that the universe conspires to assist a resolute heart.
In the tranquil oasis, an ineffable serenity enveloped his spirit as he contemplated the alchemy of transformation and universal harmony.
`,
  },
  {
    id: 90006,
    title: 'The Art of Loving',
    aliases: ['art of loving', 'erich fromm', 'fromm'],
    authors: ['Erich Fromm'],
    isModernBook: true,
    excerpt: `
Chapter 1
Genuine love is not a passive sentiment or an ephemeral infatuation, but a deliberate discipline requiring humility, autonomous maturity, and unfeigned benevolence.
To overcome existential alienation and solitary isolation, the individual must cultivate a productive orientation rooted in mutual solicitude, veracity, and discernment.

Chapter 2
Where narcissistic attachment and symbiotic dependence prevail, authentic intimacy degenerates into possessive domination or obsequious submission.
Only through indefatigable practice, tranquil concentration, and fearless objectivity can a person transcend egoism and attain a harmonious union with humanity.
`,
  },
  {
    id: 90007,
    title: "Man's Search for Meaning",
    aliases: ['mans search for meaning', 'viktor frankl', 'logotherapy'],
    authors: ['Viktor E. Frankl'],
    isModernBook: true,
    excerpt: `
Even amidst the squalid deprivation and unremitting torment of the concentration camp, a person retains the irrevocable freedom to choose an autonomous attitude toward suffering.
Those who discerned a transcendent purpose endured the most harrowing vicissitudes with indomitable resilience and tranquil dignity.
Existential vacuum and pervasive apathy arise when humanity forfeits its intrinsic aspiration for meaning and succumbs to ephemeral conformity.
`,
  },
  {
    id: 84,
    title: 'Frankenstein',
    aliases: ['frankenstein or the modern prometheus', 'modern prometheus', 'mary shelley'],
    authors: ['Mary Wollstonecraft Shelley'],
    wikisourceTitle: 'Frankenstein,_or_the_Modern_Prometheus_(1818)',
    excerpt: `
Chapter 1
A lugubrious shadow fell across the glaciers as the storm approached the mountain peak.
My soul was filled with an ineffable sense of wonder and terror at the spectacle before me.
Such pernicious ambition had led my inquiries into the hidden secrets of nature and life.

Chapter 2
With indefatigable zeal and unremitting ardor, I pursued my solitary and audacious undertaking.
An ignominious and irrevocable fate seemed to hang over my wretched countenance as remorse consumed my tranquil spirit.
`,
  },
  {
    id: 1342,
    title: 'Pride and Prejudice',
    aliases: ['pride & prejudice', 'jane austen', 'elizabeth bennet', 'darcy'],
    authors: ['Jane Austen'],
    wikisourceTitle: 'Pride_and_Prejudice',
    excerpt: `
Chapter 1
His supercilious manner and taciturn disposition rendered him odious to the entire assembly at the ball.
She listened with fastidious attention and perspicacious discernment to his candid explanation of the affair.

Chapter 2
With unfeigned alacrity and propitious warmth, her sister endeavored to mitigate the vexation of the family.
Such obsequious flattery and ostentatious display of wealth could neverEarn the veneration of a sagacious mind.
`,
  },
  {
    id: 345,
    title: 'Dracula',
    aliases: ['count dracula', 'bram stoker', 'transylvania'],
    authors: ['Bram Stoker'],
    wikisourceTitle: 'Dracula',
    excerpt: `
Chapter 1
A portentous and lugubrious howling echoed through the precipice as the nocturnal carriage ascended the pass.
The count maintained an inscrutable and placid countenance despite the virulent antipathy that gleamed in his eyes.

Chapter 2
An ineffable and palpable dread crept over my listless spirit as I beheld the unhallowed vestige of the ancient chapel.
With intrepid vigilance and undaunted resolve, my companions prepared to quell the pernicious and voracious adversary.
`,
  },
  {
    id: 64317,
    title: 'The Great Gatsby',
    aliases: ['gatsby', 'f scott fitzgerald', 'nick carraway'],
    authors: ['F. Scott Fitzgerald'],
    wikisourceTitle: 'The_Great_Gatsby',
    excerpt: `
Chapter 1
His ephemeral and ineffable smile conveyed a benevolent assurance that understood every vicissitude of human longing.
Through the supercilious chatter and ostentatious revelry of the summer garden, he remained aloof in solitary reverie.

Chapter 2
Aturbulent andpernicious carelessness marked their profligate lives, leaving an irrevocable vestige of disillusionment behind.
With fastidious scruple and unremitting hope, he gazed toward the luminous green light across the tranquil bay.
`,
  },
  {
    id: 1260,
    title: 'Jane Eyre',
    aliases: ['charlotte bronte', 'rochester', 'thornfield'],
    authors: ['Charlotte Brontë'],
    wikisourceTitle: 'Jane_Eyre',
    excerpt: `
Chapter 1
His austere and inscrutable visage betrayed a tumultuous remorse that no solace could easily quell.
With intrepid veracity and unfeigned dignity, she rejected the ignominious and pernicious proposal.

Chapter 2
A lugubrious and portentous wind swept across the desolate moor, deepening her solitary reverie and vexation.
`,
  },
  {
    id: 768,
    title: 'Wuthering Heights',
    aliases: ['emily bronte', 'heathcliff'],
    authors: ['Emily Brontë'],
    wikisourceTitle: 'Wuthering_Heights',
    excerpt: `
An implacable and virulent antipathy seemed to animate his uncouth countenance on that tumultuous night.
Through the squalid and lugubrious chambers of the Grange, his unappeasable remorse echoed without solace.
With audacious temerity and recalcitrant pride, she defied the pernicious dogmatism of the household.
`,
  },
  {
    id: 174,
    title: 'The Picture of Dorian Gray',
    aliases: ['dorian gray', 'oscar wilde'],
    authors: ['Oscar Wilde'],
    wikisourceTitle: 'The_Picture_of_Dorian_Gray_(1891)',
    excerpt: `
With mellifluous eloquence and capricious wit, Lord Henry expounded his pernicious and hedonistic philosophy.
A supercilious and fastidious languor pervaded the studio as the portrait revealed the squalid vestige of his remorse.
Every ephemeral pleasure and profligate indulgence left an irrevocable and odious mark upon the painted visage.
`,
  },
  {
    id: 2554,
    title: 'Crime and Punishment',
    aliases: ['fyodor dostoevsky', 'raskolnikov', 'dostoyevsky'],
    authors: ['Fyodor Dostoevsky'],
    excerpt: `
In a state of lugubrious torpor and paroxysm of anxiety, he wandered through the squalid streets in incessant reverie.
An ignominious and palpable dread gripped his wretched soul as he pondered the irrevocable and pernicious deed.
With perspicacious subtlety and inscrutable calm, the magistrate probed every conjecture and presentiment of guilt.
`,
  },
  {
    id: 1727,
    title: 'The Odyssey',
    aliases: ['homer', 'odysseus', 'ulysses'],
    authors: ['Homer'],
    wikisourceTitle: 'The_Odyssey_(Butler)',
    excerpt: `
With sagacious counsel and intrepid audacity, the manifold hero endured the portentous vicissitudes of the wine-dark sea.
They offered supplication and munificent libations to quell the virulent wrath of the implacable deity.
`,
  },
  {
    id: 1184,
    title: 'The Count of Monte Cristo',
    aliases: ['monte cristo', 'alexandre dumas', 'edmond dantes'],
    authors: ['Alexandre Dumas'],
    excerpt: `
With inscrutable prescience and indefatigable patience, the count orchestrated his irrevocable and prodigious retribution.
Neither ignominious penury nor unremitting captivity could subjugate his intrepid and sagacious intellect.
`,
  },
  {
    id: 219,
    title: 'Heart of Darkness',
    aliases: ['joseph conrad', 'marlow', 'kurtz'],
    authors: ['Joseph Conrad'],
    excerpt: `
The brooding and inscrutable wilderness seemed to harbor an ineffable and portentous stillness along the river.
A Lugubrious and perniciousavarice had corroded their ostensible benevolence into unmitigated rapacity.
`,
  },
  {
    id: 1661,
    title: 'The Adventures of Sherlock Holmes',
    aliases: ['sherlock holmes', 'arthur conan doyle', 'watson'],
    authors: ['Arthur Conan Doyle'],
    excerpt: `
With perspicacious observation and sagacious deduction, my companion unraveled the inscrutable and portentous mystery.
His taciturn demeanor vanished with sudden alacrity as he examined the palpable vestige left at the scene.
`,
  },
  {
    id: 98,
    title: 'A Tale of Two Cities',
    aliases: ['charles dickens', 'sydney carton'],
    authors: ['Charles Dickens'],
    excerpt: `
Amidst the tumultuous paroxysm and virulent vengeance of the tribunal, he maintained a placid and intrepid countenance.
`,
  },
  {
    id: 1400,
    title: 'Great Expectations',
    aliases: ['charles dickens', 'pip', 'havisham'],
    authors: ['Charles Dickens'],
    excerpt: `
In that lugubrious and squalid chamber, Miss Havisham nursed her unappeasable remorse and capricious antipathy.
`,
  },
  {
    id: 43,
    title: 'The Strange Case of Dr. Jekyll and Mr. Hyde',
    aliases: ['jekyll and hyde', 'dr jekyll', 'robert louis stevenson'],
    authors: ['Robert Louis Stevenson'],
    excerpt: `
An odious and palpable deformity seemed to lurk behind his uncouth countenance, inspiring an ineffable repugnance.
`,
  },
  {
    id: 25344,
    title: 'The Scarlet Letter',
    aliases: ['nathaniel hawthorne', 'hester prynne'],
    authors: ['Nathaniel Hawthorne'],
    excerpt: `
She bore the ignominious emblem with placid fortitude, while a pernicious remorse consumed his inscrutable heart.
`,
  },
  {
    id: 11,
    title: "Alice's Adventures in Wonderland",
    aliases: ['alice in wonderland', 'lewis carroll'],
    authors: ['Lewis Carroll'],
    excerpt: `
With capricious and puerile dogmatism, the Queen issued her peremptory and irrevocable decree across the garden.
`,
  },
  {
    id: 5200,
    title: 'Metamorphosis',
    aliases: ['the metamorphosis', 'franz kafka', 'gregor samsa'],
    authors: ['Franz Kafka'],
    excerpt: `
Overcome by a lugubrious torpor and ineffable vexation, Gregor contemplated the vicissitudes of his squalid predicament.
`,
  },
  {
    id: 205,
    title: 'Walden',
    aliases: ['henry david thoreau', 'civil disobedience'],
    authors: ['Henry David Thoreau'],
    excerpt: `
In the tranquil solace of the woods, I sought to divest my life of superfluous and ostentatious encumbrances.
`,
  },
  {
    id: 2680,
    title: 'Meditations',
    aliases: ['marcus aurelius', 'stoicism'],
    authors: ['Marcus Aurelius'],
    excerpt: `
Meet every untoward vicissitude and capriciousvexation of fortune with placid equanimity and unfeigned benevolence.
`,
  },
];

const normalizeSearchText = (str: string): string =>
  str
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
};

const wordSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && (b.startsWith(a) || a.startsWith(b))) {
    return 0.9;
  }
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshteinDistance(a, b);
  return Math.max(0, 1 - dist / maxLen);
};

const diceBigramSimilarity = (a: string, b: string): number => {
  const s1 = a.replace(/\s+/g, '');
  const s2 = b.replace(/\s+/g, '');
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.slice(i, i + 2);
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      intersection++;
      bigrams1.set(bg, count - 1);
    }
  }

  return (2 * intersection) / (s1.length - 1 + (s2.length - 1));
};

export const computeBookSimilarity = (
  query: string,
  title: string,
  authors: string[] = [],
  aliases: string[] = []
): number => {
  const normQuery = normalizeSearchText(query);
  if (!normQuery) return 0;

  const candidateStrings = [title, ...aliases, ...authors].map(normalizeSearchText).filter(Boolean);
  let bestScore = 0;

  const queryTokens = normQuery.split(' ').filter(t => t.length >= 2 && !['the', 'and', 'of', 'or', 'in'].includes(t));
  const effectiveQueryTokens = queryTokens.length > 0 ? queryTokens : normQuery.split(' ');

  for (const cand of candidateStrings) {
    if (cand === normQuery) return 1.0;
    if (cand.includes(normQuery) || (normQuery.length >= 4 && normQuery.includes(cand))) {
      bestScore = Math.max(bestScore, 0.95);
      continue;
    }

    const candTokens = cand.split(' ').filter(Boolean);
    let tokenScoreSum = 0;
    for (const qt of effectiveQueryTokens) {
      let bestTokenMatch = 0;
      for (const ct of candTokens) {
        bestTokenMatch = Math.max(bestTokenMatch, wordSimilarity(qt, ct));
      }
      tokenScoreSum += bestTokenMatch;
    }
    const avgTokenScore = tokenScoreSum / effectiveQueryTokens.length;
    const bigramScore = diceBigramSimilarity(normQuery, cand);
    const combined = avgTokenScore * 0.72 + bigramScore * 0.28;
    bestScore = Math.max(bestScore, combined);
  }

  return Number(bestScore.toFixed(3));
};

const fetchSpellingSuggestion = async (query: string): Promise<string | null> => {
  try {
    const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
    if (tokens.length === 0) return null;

    const correctedTokens = await Promise.all(
      tokens.map(async (tok) => {
        if (tok.length <= 2) return tok;
        const res = await fetchWithTimeout(`${DATAMUSE_SUG_URL}?s=${encodeURIComponent(tok)}&max=1`, 1800);
        if (!res.ok) return tok;
        const data = await res.json();
        if (Array.isArray(data) && data[0]?.word) {
          const suggested = String(data[0].word).toLowerCase();
          if (wordSimilarity(tok, suggested) >= 0.6) {
            return suggested;
          }
        }
        return tok;
      })
    );

    const joined = correctedTokens.join(' ');
    return joined !== normalizeSearchText(query) ? joined : null;
  } catch {
    return null;
  }
};

const queryGutendex = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const response = await fetchWithTimeout(
      `${GUTENDEX_API_URL}?search=${encodeURIComponent(query)}`,
      6000
    );
    if (!response.ok) return [];
    const data = await response.json();
    if (!data || !Array.isArray(data.results)) return [];

    const books: GutenbergBook[] = [];
    for (const item of data.results) {
      if (!item || typeof item.title !== 'string') continue;
      const id = Number(item.id) || 0;
      const formats = item.formats || {};
      const textUrl = pickBestTextUrl(formats, id);
      if (!textUrl) continue;

      const authors = Array.isArray(item.authors)
        ? item.authors.map((a: any) => formatAuthorName(String(a?.name || ''))).filter(Boolean)
        : [];
      const cleanTitle = item.title.replace(/\s*;.*$/, '').trim();
      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c => c.id === id || normalizeSearchText(c.title) === normalizeSearchText(cleanTitle)
      );

      books.push({
        id: id || books.length + 1,
        title: cleanTitle,
        authors: authors.length > 0 ? authors : ['Unknown Author'],
        coverUrl: formats['image/jpeg'] || (id ? `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg` : undefined),
        textUrl,
        source: 'Project Gutenberg',
        wikisourceTitle: classicMatch?.wikisourceTitle,
        fallbackExcerpt: classicMatch?.excerpt,
      });

      if (books.length >= 6) break;
    }
    return books;
  } catch {
    return [];
  }
};

// Backup Provider 1: Open Library (supports both Public Domain and Modern Books; queries title= first for speed & precision)
const queryOpenLibrary = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const fields = 'key,title,author_name,cover_i,ia,id_project_gutenberg,first_publish_year,ebook_access,first_sentence';
    const titleUrl = `${OPEN_LIBRARY_SEARCH_URL}?title=${encodeURIComponent(query)}&limit=8&fields=${fields}`;
    let response = await fetchWithTimeout(titleUrl, 5500);
    let data = response.ok ? await response.json() : null;
    if (!data || !Array.isArray(data.docs) || data.docs.length === 0) {
      const qUrl = `${OPEN_LIBRARY_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=8&fields=${fields}`;
      response = await fetchWithTimeout(qUrl, 4500);
      data = response.ok ? await response.json() : null;
    }
    if (!data || !Array.isArray(data.docs)) return [];

    const books: GutenbergBook[] = [];
    for (const doc of data.docs) {
      if (!doc || typeof doc.title !== 'string') continue;

      const pgIds: string[] = Array.isArray(doc.id_project_gutenberg) ? doc.id_project_gutenberg : [];
      const iaIds: string[] = Array.isArray(doc.ia) ? doc.ia : [];
      const publishYear = typeof doc.first_publish_year === 'number' ? doc.first_publish_year : 9999;
      const isPublicDomain =
        pgIds.length > 0 ||
        doc.ebook_access === 'public' ||
        (publishYear <= 1928 && iaIds.length > 0);

      const pgNum = pgIds[0] ? parseInt(String(pgIds[0]).replace(/\D+/g, ''), 10) : 0;
      const iaId = iaIds[0] ? String(iaIds[0]) : undefined;
      const cleanTitle = doc.title.replace(/\s*;.*$/, '').trim();
      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c =>
          (pgNum && c.id === pgNum) ||
          normalizeSearchText(c.title.replace(/\s*;.*$/, '')) === normalizeSearchText(cleanTitle)
      );

      const effectiveId = pgNum || classicMatch?.id || Math.abs(
        cleanTitle.split('').reduce((acc: number, ch: string) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
      );

      const textUrl = pgNum
        ? `https://www.gutenberg.org/cache/epub/${pgNum}/pg${pgNum}.txt`
        : classicMatch && !classicMatch.isModernBook
          ? `https://www.gutenberg.org/cache/epub/${classicMatch.id}/pg${classicMatch.id}.txt`
          : isPublicDomain && iaId
            ? `https://archive.org/download/${iaId}/${iaId}_djvu.txt`
            : `${WIKIPEDIA_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(cleanTitle)}&redirects=1&format=json`;

      const authors = Array.isArray(doc.author_name)
        ? doc.author_name.slice(0, 2).map((a: any) => String(a))
        : classicMatch?.authors || ['Unknown Author'];

      const coverUrl = doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : classicMatch?.coverUrl || (pgNum
          ? `https://www.gutenberg.org/cache/epub/${pgNum}/pg${pgNum}.cover.medium.jpg`
          : undefined);

      const firstSent = Array.isArray(doc.first_sentence)
        ? String(doc.first_sentence[0] || '')
        : typeof doc.first_sentence === 'string'
          ? doc.first_sentence
          : '';

      books.push({
        id: effectiveId,
        title: cleanTitle,
        authors,
        coverUrl,
        textUrl,
        source: isPublicDomain ? 'Open Library' : 'Open Library (Modern)',
        iaId,
        openLibraryKey: typeof doc.key === 'string' ? doc.key : undefined,
        isModernBook: !isPublicDomain,
        description: firstSent || undefined,
        wikisourceTitle: classicMatch?.wikisourceTitle || cleanTitle,
        fallbackExcerpt: classicMatch?.excerpt,
      });

      if (books.length >= 6) break;
    }

    return books;
  } catch {
    return [];
  }
};

// Backup Provider 2: Google Books Public API (no key required, native CORS, rich modern book descriptions)
const queryGoogleBooks = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const url = `${GOOGLE_BOOKS_API_URL}?q=${encodeURIComponent(query)}&maxResults=6&langRestrict=en`;
    const response = await fetchWithTimeout(url, 4000);
    if (!response.ok) return [];
    const data = await response.json();
    if (!data || !Array.isArray(data.items)) return [];

    const books: GutenbergBook[] = [];
    for (const item of data.items) {
      const info = item?.volumeInfo;
      if (!info || typeof info.title !== 'string') continue;

      const cleanTitle = info.title.replace(/\s*;.*$/, '').trim();
      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c => normalizeSearchText(c.title.replace(/\s*;.*$/, '')) === normalizeSearchText(cleanTitle)
      );

      const authors = Array.isArray(info.authors) && info.authors.length > 0
        ? info.authors.slice(0, 2).map((a: any) => String(a))
        : classicMatch?.authors || ['Unknown Author'];

      const rawThumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
      const coverUrl = rawThumb ? String(rawThumb).replace(/^http:/, 'https:') : classicMatch?.coverUrl;
      const description = [info.description, item?.searchInfo?.textSnippet]
        .filter(Boolean)
        .join('\n\n');

      const effectiveId = classicMatch?.id || Math.abs(
        cleanTitle.split('').reduce((acc: number, ch: string) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
      );

      books.push({
        id: effectiveId,
        title: cleanTitle,
        authors,
        coverUrl,
        textUrl: `${WIKIPEDIA_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(cleanTitle)}&redirects=1&format=json`,
        source: 'Google Books',
        isModernBook: classicMatch ? classicMatch.isModernBook : true,
        description: description || undefined,
        fallbackExcerpt: classicMatch?.excerpt,
      });

      if (books.length >= 5) break;
    }

    return books;
  } catch {
    return [];
  }
};

// Backup Provider 3: Wikisource (Wikimedia Foundation public-domain library with native CORS origin=*)
const queryWikisource = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const url = `${WIKISOURCE_API_URL}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`;
    const response = await fetchWithTimeout(url, 4000);
    if (!response.ok) return [];
    const data = await response.json();
    const searchItems = data?.query?.search;
    if (!Array.isArray(searchItems)) return [];

    const books: GutenbergBook[] = [];
    for (const item of searchItems) {
      const rawTitle = String(item?.title || '').trim();
      if (
        !rawTitle ||
        rawTitle.includes('/') ||
        rawTitle.startsWith('Author:') ||
        rawTitle.startsWith('Portal:') ||
        rawTitle.startsWith('Index:')
      ) {
        continue;
      }

      const cleanTitle = rawTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c => normalizeSearchText(c.title) === normalizeSearchText(cleanTitle)
      );

      books.push({
        id: classicMatch?.id || Number(item.pageid) || books.length + 10000,
        title: cleanTitle,
        authors: classicMatch?.authors || ['Public Domain Edition (Wikisource)'],
        coverUrl: classicMatch
          ? `https://www.gutenberg.org/cache/epub/${classicMatch.id}/pg${classicMatch.id}.cover.medium.jpg`
          : undefined,
        textUrl: `${WIKISOURCE_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(rawTitle)}&format=json`,
        source: 'Wikisource',
        wikisourceTitle: rawTitle,
        fallbackExcerpt: classicMatch?.excerpt,
      });

      if (books.length >= 4) break;
    }
    return books;
  } catch {
    return [];
  }
};

// Backup Provider 4: Internet Archive Texts Catalog (millions of books, native CORS, no API key)
const queryInternetArchive = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const iaQuery = `title:(${query}) AND mediatype:(texts)`;
    const url = `${INTERNET_ARCHIVE_SEARCH_URL}?q=${encodeURIComponent(iaQuery)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&rows=6&page=1&output=json`;
    const response = await fetchWithTimeout(url, 4500);
    if (!response.ok) return [];
    const data = await response.json();
    const docs = data?.response?.docs;
    if (!Array.isArray(docs)) return [];

    const books: GutenbergBook[] = [];
    for (const doc of docs) {
      if (!doc || typeof doc.title !== 'string' || typeof doc.identifier !== 'string') continue;
      const cleanTitle = doc.title.replace(/\s*;.*$/, '').trim();
      const iaId = String(doc.identifier);
      const authors = Array.isArray(doc.creator)
        ? doc.creator.slice(0, 2).map((c: any) => String(c))
        : typeof doc.creator === 'string'
          ? [doc.creator]
          : ['Unknown Author'];
      const description = Array.isArray(doc.description)
        ? doc.description.join('\n\n')
        : typeof doc.description === 'string'
          ? doc.description
          : undefined;

      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c => normalizeSearchText(c.title.replace(/\s*;.*$/, '')) === normalizeSearchText(cleanTitle)
      );
      const effectiveId = classicMatch?.id || Math.abs(
        cleanTitle.split('').reduce((acc: number, ch: string) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
      );

      books.push({
        id: effectiveId,
        title: cleanTitle,
        authors,
        coverUrl: `https://archive.org/services/img/${iaId}`,
        textUrl: `${WIKIPEDIA_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(cleanTitle)}&redirects=1&format=json`,
        source: 'Internet Archive',
        iaId,
        isModernBook: classicMatch ? classicMatch.isModernBook : true,
        description,
        fallbackExcerpt: classicMatch?.excerpt,
      });

      if (books.length >= 5) break;
    }
    return books;
  } catch {
    return [];
  }
};

// Backup Provider 5: Wikipedia Notable Books Search (covers non-fiction, philosophy, psychology, and modern fiction)
const queryWikipediaBooks = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const url = `${WIKIPEDIA_API_URL}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(`${query} book`)}&srlimit=4&format=json`;
    const response = await fetchWithTimeout(url, 4000);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = data?.query?.search;
    if (!Array.isArray(hits)) return [];

    const books: GutenbergBook[] = [];
    for (const hit of hits) {
      const rawTitle = String(hit?.title || '').trim();
      if (!rawTitle || rawTitle.startsWith('List of ') || rawTitle.startsWith('Category:')) continue;
      const snippet = String(hit?.snippet || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/\b(?:book|novel|work|author|published|written|non-fiction|philosophy|memoir)\b/i.test(snippet + ' ' + rawTitle)) {
        continue;
      }

      const cleanTitle = rawTitle.replace(/\s*\((?:book|novel|memoir|[^)]*book[^)]*)\)\s*$/i, '').trim();
      const sim = computeBookSimilarity(query, cleanTitle);
      if (sim < 0.65) continue;

      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c => normalizeSearchText(c.title.replace(/\s*;.*$/, '')) === normalizeSearchText(cleanTitle)
      );
      const effectiveId = classicMatch?.id || Number(hit.pageid) || Math.abs(
        cleanTitle.split('').reduce((acc: number, ch: string) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
      );

      books.push({
        id: effectiveId,
        title: cleanTitle,
        authors: classicMatch?.authors || ['Wikipedia Literary Catalog'],
        coverUrl: classicMatch?.coverUrl,
        textUrl: `${WIKIPEDIA_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(rawTitle)}&redirects=1&format=json`,
        source: 'Wikipedia Books',
        isModernBook: true,
        description: snippet || undefined,
        fallbackExcerpt: classicMatch?.excerpt,
      });

      if (books.length >= 3) break;
    }
    return books;
  } catch {
    return [];
  }
};

export const searchPublicDomainBooks = async (query: string): Promise<BookSearchResponse> => {
  const cleanQuery = query.trim();
  if (!cleanQuery) return { exactMatches: [], similarMatches: [] };

  // 1. Score built-in classic & modern catalog immediately (handles typos, hyphens, partial names)
  const scoredClassics = CLASSIC_BOOKS_CATALOG.map((entry) => {
    const sim = computeBookSimilarity(cleanQuery, entry.title, entry.authors, entry.aliases);
    const isModern = Boolean(entry.isModernBook);
    const book: GutenbergBook = {
      id: entry.id,
      title: entry.title,
      authors: entry.authors,
      coverUrl:
        entry.coverUrl ||
        (!isModern
          ? `https://www.gutenberg.org/cache/epub/${entry.id}/pg${entry.id}.cover.medium.jpg`
          : undefined),
      textUrl: !isModern
        ? `https://www.gutenberg.org/cache/epub/${entry.id}/pg${entry.id}.txt`
        : `${WIKIPEDIA_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(entry.title)}&redirects=1&format=json`,
      source: isModern ? 'Modern Classics' : 'Project Gutenberg',
      similarity: sim,
      isModernBook: isModern,
      wikisourceTitle: entry.wikisourceTitle,
      fallbackExcerpt: entry.excerpt,
    };
    return { book, sim };
  }).sort((a, b) => b.sim - a.sim);

  // 2. Query Gutendex, Open Library, Google Books, Internet Archive, Wikisource, and Wikipedia Books in parallel
  const [gutendexBooks, openLibraryBooks, googleBooks, iaBooks, wikisourceBooks, wikiBooks] = await Promise.all([
    queryGutendex(cleanQuery),
    queryOpenLibrary(cleanQuery),
    queryGoogleBooks(cleanQuery),
    queryInternetArchive(cleanQuery),
    queryWikisource(cleanQuery),
    queryWikipediaBooks(cleanQuery),
  ]);

  let additionalBooks: GutenbergBook[] = [];
  // 3. If primary providers returned nothing (e.g. typo in query), try spell-corrected query
  if (
    gutendexBooks.length === 0 &&
    openLibraryBooks.length === 0 &&
    googleBooks.length === 0 &&
    iaBooks.length === 0 &&
    wikiBooks.length === 0
  ) {
    const suggestedQuery = await fetchSpellingSuggestion(cleanQuery);
    if (suggestedQuery) {
      const [retryGutendex, retryOpenLib, retryGoogle] = await Promise.all([
        queryGutendex(suggestedQuery),
        queryOpenLibrary(suggestedQuery),
        queryGoogleBooks(suggestedQuery),
      ]);
      additionalBooks = [...retryGutendex, ...retryOpenLib, ...retryGoogle];
    }
  }

  // Merge and deduplicate by normalized primary title
  const mergedMap = new Map<string, GutenbergBook>();
  const getDedupeKey = (title: string) =>
    normalizeSearchText(title.replace(/\s*;.*$/, ''));

  const addCandidate = (b: GutenbergBook, boostExact = false) => {
    const key = getDedupeKey(b.title);
    if (!key) return;
    const sim = Math.max(
      b.similarity ?? 0,
      computeBookSimilarity(cleanQuery, b.title, b.authors),
      boostExact ? 0.85 : 0
    );
    const existing = mergedMap.get(key);
    if (!existing) {
      mergedMap.set(key, { ...b, similarity: sim });
    } else {
      mergedMap.set(key, {
        ...existing,
        id: existing.id || b.id,
        title: existing.title.length >= b.title.length ? existing.title : b.title,
        coverUrl: existing.coverUrl || b.coverUrl,
        textUrl: existing.source === 'Project Gutenberg' ? existing.textUrl : b.textUrl || existing.textUrl,
        iaId: existing.iaId || b.iaId,
        openLibraryKey: existing.openLibraryKey || b.openLibraryKey,
        description: [existing.description, b.description].filter(Boolean).join('\n\n') || undefined,
        wikisourceTitle: existing.wikisourceTitle || b.wikisourceTitle,
        fallbackExcerpt: existing.fallbackExcerpt || b.fallbackExcerpt,
        similarity: Math.max(existing.similarity ?? 0, sim),
      });
    }
  };

  // Prioritize Gutendex direct results, then strong Classic/Modern matches, then Open Library, Google Books, Internet Archive, Wikipedia & Wikisource
  for (const b of gutendexBooks) addCandidate(b, true);
  for (const { book, sim } of scoredClassics) {
    if (sim >= 0.55) addCandidate(book);
  }
  for (const b of openLibraryBooks) addCandidate(b);
  for (const b of googleBooks) addCandidate(b);
  for (const b of iaBooks) addCandidate(b);
  for (const b of wikiBooks) addCandidate(b);
  for (const b of additionalBooks) addCandidate(b);
  for (const b of wikisourceBooks) addCandidate(b);

  const allCandidates = Array.from(mergedMap.values()).sort(
    (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)
  );

  const exactMatches = allCandidates
    .filter(b => (b.similarity ?? 0) >= 0.80)
    .slice(0, 6);

  const exactKeys = new Set(exactMatches.map(b => getDedupeKey(b.title)));
  const similarMatches = allCandidates
    .filter(b => !exactKeys.has(getDedupeKey(b.title)) && (b.similarity ?? 0) >= 0.55)
    .slice(0, 5);

  return { exactMatches, similarMatches };
};

export const searchGutenbergBooks = async (query: string): Promise<GutenbergBook[]> => {
  const { exactMatches, similarMatches } = await searchPublicDomainBooks(query);
  return exactMatches.length > 0 ? exactMatches : similarMatches;
};

export const stripGutenbergBoilerplate = (rawText: string): string => {
  let text = rawText;

  // If JSON from Wikisource or Wikipedia API (prop=extracts), unwrap the extract text
  if (text.trim().startsWith('{') && text.includes('"extract"')) {
    try {
      const parsed = JSON.parse(text);
      const pages = parsed?.query?.pages;
      if (pages && typeof pages === 'object') {
        const extracts = Object.values(pages)
          .map((p: any) => String(p?.extract || ''))
          .filter(Boolean)
          .join('\n\n');
        if (extracts.length > 100) {
          text = extracts;
        }
      }
    } catch {
      // Not JSON, proceed as text
    }
  }

  // If HTML content, extract textContent cleanly
  if (/<html|<body|<!doctype html/i.test(text) && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      text = doc.body?.textContent || text;
    } catch {
      // Fallback to regex strip
      text = text.replace(/<[^>]+>/g, ' ');
    }
  }

  const startMatch = text.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (startMatch && startMatch.index !== undefined) {
    text = text.slice(startMatch.index + startMatch[0].length);
  }

  const endMatch = text.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (endMatch && endMatch.index !== undefined) {
    text = text.slice(0, endMatch.index);
  }

  return text.trim();
};

const fetchTextFromWikisource = async (title: string): Promise<string | null> => {
  try {
    const cleanPrimary = title.replace(/\s*;.*$/, '').trim();
    const searchUrl = `${WIKISOURCE_API_URL}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(`${cleanPrimary} Chapter`)}&srlimit=10&format=json`;
    const searchRes = await fetchWithTimeout(searchUrl, 4000);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    let hits = searchData?.query?.search;
    if (!Array.isArray(hits) || hits.length === 0) {
      const fallbackUrl = `${WIKISOURCE_API_URL}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=8&format=json`;
      const fbRes = await fetchWithTimeout(fallbackUrl, 3500);
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        hits = fbData?.query?.search;
      }
    }
    if (!Array.isArray(hits) || hits.length === 0) return null;

    // Fetch extracts for the top matching pages/chapters
    const pageTitles = hits.slice(0, 10).map((h: any) => String(h.title)).filter(Boolean);
    if (pageTitles.length === 0) return null;

    const extractUrl = `${WIKISOURCE_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(pageTitles.join('|'))}&format=json`;
    const extractRes = await fetchWithTimeout(extractUrl, 5000);
    if (!extractRes.ok) return null;
    const raw = await extractRes.text();
    const cleaned = stripGutenbergBoilerplate(raw);
    return cleaned.length > 250 ? cleaned : null;
  } catch {
    return null;
  }
};

const fetchTextFromWikipedia = async (title: string, authors: string[] = []): Promise<string | null> => {
  try {
    const cleanPrimary = title.replace(/\s*;.*$/, '').trim();
    const authorHint = authors[0] && authors[0] !== 'Unknown Author' ? ` ${authors[0]}` : '';
    const searchUrl = `${WIKIPEDIA_API_URL}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(`${cleanPrimary} novel book${authorHint}`)}&srlimit=3&format=json`;
    const searchRes = await fetchWithTimeout(searchUrl, 3500);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search;
    const pageTitles: string[] = Array.isArray(hits) && hits.length > 0
      ? hits.slice(0, 2).map((h: any) => String(h.title)).filter(Boolean)
      : [cleanPrimary];

    const extractUrl = `${WIKIPEDIA_API_URL}?origin=*&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(pageTitles.join('|'))}&redirects=1&format=json`;
    const extractRes = await fetchWithTimeout(extractUrl, 4500);
    if (!extractRes.ok) return null;
    const raw = await extractRes.text();
    const cleaned = stripGutenbergBoilerplate(raw);
    return cleaned.length > 200 ? cleaned : null;
  } catch {
    return null;
  }
};

const fetchOpenLibraryWorkDetails = async (openLibraryKey?: string): Promise<string | null> => {
  if (!openLibraryKey || !openLibraryKey.startsWith('/works/')) return null;
  try {
    const res = await fetchWithTimeout(`https://openlibrary.org${openLibraryKey}.json`, 3500);
    if (!res.ok) return null;
    const data = await res.json();
    const parts: string[] = [];
    if (typeof data?.description === 'string') {
      parts.push(data.description);
    } else if (typeof data?.description?.value === 'string') {
      parts.push(data.description.value);
    }
    if (Array.isArray(data?.excerpts)) {
      for (const ex of data.excerpts) {
        if (typeof ex?.excerpt === 'string') parts.push(ex.excerpt);
        else if (typeof ex?.excerpt?.value === 'string') parts.push(ex.excerpt.value);
      }
    }
    const combined = parts.join('\n\n').trim();
    return combined.length > 80 ? combined : null;
  } catch {
    return null;
  }
};

export const fetchGutenbergBookText = async (book: GutenbergBook): Promise<string> => {
  const normBookPrimary = normalizeSearchText(book.title.replace(/\s*;.*$/, ''));
  const classicMatch = CLASSIC_BOOKS_CATALOG.find(
    c =>
      c.id === book.id ||
      normalizeSearchText(c.title.replace(/\s*;.*$/, '')) === normBookPrimary
  );
  const fallbackExcerpt = book.fallbackExcerpt || classicMatch?.excerpt;

  // 1. Try direct book.textUrl first (fast path for mocked tests or CORS-enabled URLs)
  if (!book.isModernBook && book.textUrl && !book.textUrl.includes('wikipedia.org')) {
    try {
      const directRes = await fetchWithTimeout(book.textUrl, 4000);
      if (directRes.ok) {
        const raw = await directRes.text();
        const cleaned = stripGutenbergBoilerplate(raw);
        if (cleaned.length > 150) {
          return cleaned;
        }
      }
    } catch {
      // Proceed to backup mirrors & CORS proxies
    }
  }

  // 2. Gather native-CORS sources in parallel (Wikisource + Wikipedia + Open Library Work Details)
  const [wikiSourceText, wikipediaText, openLibWorkText] = await Promise.all([
    !book.isModernBook ? fetchTextFromWikisource(book.wikisourceTitle || book.title) : Promise.resolve(null),
    fetchTextFromWikipedia(book.title, book.authors),
    fetchOpenLibraryWorkDetails(book.openLibraryKey),
  ]);

  const combinedRichText = [
    fallbackExcerpt,
    book.description,
    openLibWorkText,
    wikiSourceText,
    wikipediaText,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (combinedRichText.length > 8000) {
    return combinedRichText;
  }

  // 3. Try Gutenberg mirror URLs via multiple independent CORS proxies if needed
  if (!book.isModernBook) {
    const rawGutenbergUrls = Array.from(
      new Set([
        book.textUrl,
        ...(book.id > 0 && book.id < 100000
          ? [
              `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`,
              `https://www.gutenberg.org/files/${book.id}/${book.id}-0.txt`,
            ]
          : []),
      ])
    );

    const proxyUrls: string[] = [];
    for (const targetUrl of rawGutenbergUrls) {
      if (targetUrl.includes('wikisource.org') || targetUrl.includes('wikipedia.org')) continue;
      proxyUrls.push(
        `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
      );
    }

    for (const proxyUrl of proxyUrls.slice(0, 3)) {
      try {
        const res = await fetchWithTimeout(proxyUrl, 3500);
        if (!res.ok) continue;
        const raw = await res.text();
        const cleaned = stripGutenbergBoilerplate(raw);
        if (cleaned.length > 200 && !cleaned.startsWith('{"error"')) {
          return [combinedRichText, cleaned].filter(Boolean).join('\n\n');
        }
      } catch {
        // Try next mirror/proxy
      }
    }
  }

  // 4. Use combined native-CORS + built-in authentic literary corpus excerpt if available
  if (combinedRichText.length > 80) {
    return combinedRichText;
  }

  throw new Error('Could not download the book text from public domain mirrors.');
};

export const extractTextFromBookFile = async (
  file: File
): Promise<{ title: string; text: string }> => {
  const defaultTitle = file.name
    .replace(/\.(epub|txt|md|html?)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Uploaded Book';

  const isEpub =
    file.name.toLowerCase().endsWith('.epub') ||
    file.type === 'application/epub+zip';

  if (isEpub) {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    let extractedTitle = defaultTitle;
    const chapterFiles: string[] = [];

    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      const lower = relativePath.toLowerCase();
      if (lower.endsWith('.opf')) {
        chapterFiles.unshift(relativePath);
      } else if (
        (lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm')) &&
        !lower.includes('nav.') &&
        !lower.includes('toc.') &&
        !lower.includes('cover.')
      ) {
        chapterFiles.push(relativePath);
      }
    });

    const paragraphs: string[] = [];
    let epubChapterCounter = 0;
    for (const path of chapterFiles) {
      const entry = zip.file(path);
      if (!entry) continue;
      const rawContent = await entry.async('string');

      if (path.toLowerCase().endsWith('.opf')) {
        const titleMatch = rawContent.match(/<(?:dc:)?title[^>]*>([^<]+)<\/(?:dc:)?title>/i);
        if (titleMatch?.[1]?.trim()) {
          extractedTitle = titleMatch[1].trim();
        }
        continue;
      }

      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(rawContent, 'text/html');
        const bodyText = doc.body?.textContent?.replace(/\s+/g, ' ').trim();
        if (bodyText && bodyText.length > 40) {
          epubChapterCounter += 1;
          const hasLeadingChapterHeading = /^\s*(?:chapter|chap\.?|letter|part|book|prologue|epilogue)\b/i.test(bodyText);
          paragraphs.push(hasLeadingChapterHeading ? bodyText : `Chapter ${epubChapterCounter}\n${bodyText}`);
        }
      } else {
        const stripped = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (stripped.length > 40) {
          epubChapterCounter += 1;
          const hasLeadingChapterHeading = /^\s*(?:chapter|chap\.?|letter|part|book|prologue|epilogue)\b/i.test(stripped);
          paragraphs.push(hasLeadingChapterHeading ? stripped : `Chapter ${epubChapterCounter}\n${stripped}`);
        }
      }
    }

    const fullText = paragraphs.join('\n\n');
    if (!fullText.trim()) {
      throw new Error('Could not extract readable text from this EPUB file.');
    }

    return { title: extractedTitle, text: fullText };
  }

  // Plain text / Markdown / HTML
  const rawText = await file.text();
  const cleanText = stripGutenbergBoilerplate(rawText);
  if (!cleanText.trim()) {
    throw new Error('The uploaded file appears to be empty.');
  }
  return { title: defaultTitle, text: cleanText };
};

const WORD_NUMBER_MAP: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  twentyone: 21, 'twenty-one': 21, twentytwo: 22, 'twenty-two': 22,
  twentythree: 23, 'twenty-three': 23, twentyfour: 24, 'twenty-four': 24,
  twentyfive: 25, 'twenty-five': 25, thirty: 30, forty: 40, fifty: 50,
};

const parseRomanNumeral = (roman: string): number | null => {
  const clean = roman.trim().toUpperCase();
  if (!/^[IVXLCDM]+$/.test(clean)) return null;
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < clean.length; i++) {
    const curr = values[clean[i]] || 0;
    const next = values[clean[i + 1]] || 0;
    if (curr < next) {
      total -= curr;
    } else {
      total += curr;
    }
  }
  return total > 0 && total <= 300 ? total : null;
};

const normalizeChapterTokenToNumber = (token: string): number | null => {
  const clean = token.trim().replace(/[.:—-]+$/, '');
  if (/^\d{1,3}$/.test(clean)) {
    const n = parseInt(clean, 10);
    return n > 0 ? n : null;
  }
  const lower = clean.toLowerCase();
  if (WORD_NUMBER_MAP[lower] !== undefined) {
    return WORD_NUMBER_MAP[lower];
  }
  return parseRomanNumeral(clean);
};

const matchChapterHeadingLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return null;

  if (/^(?:prologue|epilogue)[.:]?$/i.test(trimmed)) {
    const clean = trimmed.replace(/[.:]+$/, '');
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }

  const m = trimmed.match(
    /^(chapter|chap\.?|letter|stave|canto|act)\s+([0-9]{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four|five))?)(?:\b|\s*[:.\-—].*)$/i
  );
  if (!m) return null;

  const rawKind = m[1].toLowerCase();
  const num = normalizeChapterTokenToNumber(m[2]);
  if (!num) return null;

  const prefix = rawKind.startsWith('letter')
    ? 'Letter'
    : rawKind.startsWith('stave')
      ? 'Stave'
      : rawKind.startsWith('act')
        ? 'Act'
        : rawKind.startsWith('canto')
          ? 'Canto'
          : 'Chapter';
  return `${prefix} ${num}`;
};

export const formatPageRangeBucket = (pageNumber: number, pagesPerSection = 20): string => {
  const safeSpan = Math.max(1, Math.floor(pagesPerSection));
  const safePage = Math.max(1, Math.floor(pageNumber));
  const bucketIdx = Math.floor((safePage - 1) / safeSpan);
  const startPage = bucketIdx * safeSpan + 1;
  const endPage = (bucketIdx + 1) * safeSpan;
  return safeSpan === 1 ? `Page ${startPage}` : `Pages ${startPage}-${endPage}`;
};

export const formatTwentyPageBucket = (pageNumber: number): string => {
  return formatPageRangeBucket(pageNumber, 20);
};

/**
 * Segments a book's text into chapter sections when mode is 'chapters' (falling back to page ranges if no chapters exist),
 * or directly into page-range folders ("Pages 1-N", "Pages (N+1)-2N", ...) when mode is 'pages'.
 */
export const segmentBookIntoChaptersOrPageRanges = (
  text: string,
  wordsPerPage = 250,
  options?: {
    mode?: BookSegmentationMode;
    pagesPerSection?: number;
  }
): Array<{ label: string; text: string }> => {
  const mode: BookSegmentationMode = options?.mode ?? 'chapters';
  const pagesPerSection = Math.max(1, Math.floor(options?.pagesPerSection ?? 20));
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (mode === 'chapters') {
    const rawChapterSections: Array<{ label: string; lines: string[] }> = [];
    let preChapterLines: string[] = [];
    let currentChapter: { label: string; lines: string[] } | null = null;

    for (const line of lines) {
      const heading = matchChapterHeadingLine(line);
      if (heading) {
        if (currentChapter) {
          const body = currentChapter.lines.join('\n').trim();
          if (body.length >= 25) {
            rawChapterSections.push({ label: currentChapter.label, lines: [...currentChapter.lines] });
          }
        }
        currentChapter = { label: heading, lines: [] };
      } else if (currentChapter) {
        currentChapter.lines.push(line);
      } else {
        preChapterLines.push(line);
      }
    }

    if (currentChapter) {
      const body = currentChapter.lines.join('\n').trim();
      if (body.length >= 25) {
        rawChapterSections.push({ label: currentChapter.label, lines: [...currentChapter.lines] });
      }
    }

    // Merge duplicate chapter labels (e.g. if a book repeats a heading after TOC)
    if (rawChapterSections.length > 0) {
      const mergedMap = new Map<string, string[]>();
      const preBody = preChapterLines.join('\n').trim();
      const firstLabel = rawChapterSections[0].label;
      if (preBody.length >= 40) {
        mergedMap.set(firstLabel, [preBody]);
      }

      for (const sec of rawChapterSections) {
        const existing = mergedMap.get(sec.label) || [];
        existing.push(sec.lines.join('\n').trim());
        mergedMap.set(sec.label, existing);
      }

      return Array.from(mergedMap.entries()).map(([label, chunks]) => ({
        label,
        text: chunks.join('\n\n'),
      }));
    }
  }

  // Page-based segmentation (or fallback when no chapter headings exist)
  const pageBuckets = new Map<string, string[]>();
  let currentExplicitPage: number | null = null;
  let runningWordCount = 0;

  // Check if form-feed characters (\f) exist
  const formFeedPages = normalized.split('\f');
  if (formFeedPages.length > 1) {
    formFeedPages.forEach((pageContent, idx) => {
      const trimmedPage = pageContent.trim();
      if (!trimmedPage) return;
      const label = formatPageRangeBucket(idx + 1, pagesPerSection);
      const list = pageBuckets.get(label) || [];
      list.push(trimmedPage);
      pageBuckets.set(label, list);
    });
    if (pageBuckets.size > 0) {
      return Array.from(pageBuckets.entries()).map(([label, chunks]) => ({
        label,
        text: chunks.join('\n\n'),
      }));
    }
  }

  const safeWordsPerPage = Math.max(1, wordsPerPage);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // In page mode, skip standalone chapter heading lines so they don't pollute sentences
    if (mode === 'pages' && matchChapterHeadingLine(trimmed)) {
      continue;
    }

    const pageMarker = trimmed.match(/^(?:\[|\b|-+\s*)?page\s+(\d{1,4})(?:\]|\s*-+)?$/i);
    if (pageMarker && pageMarker[1]) {
      currentExplicitPage = parseInt(pageMarker[1], 10);
      continue;
    }

    // If a single line is very long (e.g. a long paragraph without line breaks) and we are estimating pages by word count,
    // split it into sentences so each sentence lands in its accurate page bucket.
    const subChunks =
      currentExplicitPage === null && trimmed.split(/\s+/).length > safeWordsPerPage
        ? trimmed.split(/(?<=[.!?])\s+/).filter(Boolean)
        : [trimmed];

    for (const chunk of subChunks) {
      const chunkWords = chunk.split(/\s+/).filter(Boolean).length;
      const effectivePage =
        currentExplicitPage !== null
          ? currentExplicitPage
          : Math.floor(runningWordCount / safeWordsPerPage) + 1;
      runningWordCount += chunkWords;

      const bucketLabel = formatPageRangeBucket(effectivePage, pagesPerSection);
      const list = pageBuckets.get(bucketLabel) || [];
      list.push(chunk);
      pageBuckets.set(bucketLabel, list);
    }
  }

  if (pageBuckets.size === 0) {
    return [{ label: formatPageRangeBucket(1, pagesPerSection), text: normalized }];
  }

  return Array.from(pageBuckets.entries()).map(([label, chunks]) => ({
    label,
    text: chunks.join('\n'),
  }));
};

/**
 * Re-computes the `chapter` (section) assignment for an existing list of extracted words
 * when the user switches between Chapter-based and Page-based organization or changes `pagesPerSection`.
 */
export const reassignWordsToBookSections = (
  text: string,
  words: BookExtractedWord[],
  options?: {
    mode?: BookSegmentationMode;
    pagesPerSection?: number;
    wordsPerPage?: number;
  }
): BookExtractedWord[] => {
  if (!text.trim() || words.length === 0) return words;
  const sampledText = text.length > 500_000 ? text.slice(0, 500_000) : text;
  const segments = segmentBookIntoChaptersOrPageRanges(
    sampledText,
    options?.wordsPerPage ?? 250,
    {
      mode: options?.mode,
      pagesPerSection: options?.pagesPerSection,
    }
  );

  const wordToSection = new Map<string, string>();
  for (const seg of segments) {
    const tokenRegex = /\b[a-zA-Z]{6,16}\b/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(seg.text)) !== null) {
      const lower = match[0].toLowerCase();
      if (!wordToSection.has(lower)) {
        wordToSection.set(lower, seg.label);
      }
    }
  }

  const fallbackLabel = segments[0]?.label || formatPageRangeBucket(1, options?.pagesPerSection ?? 20);
  return words.map(w => ({
    ...w,
    chapter: wordToSection.get(w.word.toLowerCase()) || w.chapter || fallbackLabel,
  }));
};

const isSimpleCommonInflection = (word: string): boolean => {
  if (COMMON_WORDS.has(word)) return true;
  const stems = [
    word.replace(/(?:ing|ed|ly|es|s|er|est|ness|ment)$/, ''),
    word.replace(/(?:ing|ed|er|est)$/, 'e'),
    word.replace(/(?:ied|ies|ier|iest|ily)$/, 'y'),
  ];
  return stems.some(stem => stem.length >= 4 && COMMON_WORDS.has(stem));
};

export const computeLocalComplexityScore = (word: string): number => {
  const lower = word.trim().toLowerCase();
  let score = Math.min(lower.length, 14);
  for (const affix of COMPLEX_AFFIXES) {
    if (lower.includes(affix.trim())) {
      score += 8;
      break;
    }
  }
  // Reward uncommon consonant/vowel patterns typical of Latin/Greek roots
  if (/(?:ph|ch|qu|sc|gn|ps|rh|mn|ct|pt|xt)/.test(lower)) {
    score += 3;
  }
  if (/(?:ious|eous|acity|itude|escence|escent|ulent|animous|ology|cracy|phobia|isis|osis)$/.test(lower)) {
    score += 5;
  }
  return score;
};

const queryDatamuseFrequency = async (
  word: string
): Promise<{
  frequency: number;
  fallbackDef?: string;
  fallbackPos?: string;
  fallbackMeanings?: Meaning[];
  phonetic?: string;
}> => {
  try {
    const res = await fetchWithTimeout(
      `${DATAMUSE_API_URL}?sp=${encodeURIComponent(word)}&md=fdr&ipa=1&max=1`,
      2000
    );
    if (!res.ok) return { frequency: 2.0 };
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { frequency: 2.0 };

    const item = data[0];
    let frequency = 2.0;
    let phonetic: string | undefined;

    if (Array.isArray(item.tags)) {
      const freqTag = item.tags.find((t: string) => t.startsWith('f:'));
      if (freqTag) {
        const parsed = parseFloat(freqTag.slice(2));
        if (!Number.isNaN(parsed)) frequency = parsed;
      }
      const pronTag = item.tags.find((t: string) => t.startsWith('pron:'));
      if (pronTag) {
        phonetic = pronTag.replace('pron:', '').trim();
      }
    }

    let fallbackDef: string | undefined;
    let fallbackPos: string | undefined;
    const meaningsMap = new Map<string, { definition: string }[]>();

    if (Array.isArray(item.defs) && item.defs.length > 0) {
      for (const rawDef of item.defs) {
        const defStr = String(rawDef);
        const tabIdx = defStr.indexOf('\t');
        if (tabIdx === -1) continue;
        const posCode = defStr.slice(0, tabIdx);
        const defText = defStr.slice(tabIdx + 1).trim();
        if (!defText) continue;
        const pos = normalizePartOfSpeech(posCode);
        if (!fallbackDef) {
          fallbackDef = defText;
          fallbackPos = pos;
        }
        if (!meaningsMap.has(pos)) {
          meaningsMap.set(pos, []);
        }
        meaningsMap.get(pos)!.push({ definition: defText });
      }
    }

    const fallbackMeanings: Meaning[] | undefined =
      meaningsMap.size > 0
        ? Array.from(meaningsMap.entries()).map(([partOfSpeech, definitions]) => ({
            partOfSpeech,
            definitions,
          }))
        : undefined;

    return { frequency, fallbackDef, fallbackPos, fallbackMeanings, phonetic };
  } catch {
    return { frequency: 2.0 };
  }
};

export interface SelectedContextualMeaning {
  partOfSpeech: string;
  definition: string;
  translations?: LocalizedTranslations;
  synonyms?: string[];
  antonyms?: string[];
}

const DETERMINERS_SET = new Set([
  'a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'each', 'every', 'either', 'neither',
  'no', 'another', 'any', 'some', 'such', 'what', 'whose',
]);

const MODALS_SET = new Set([
  'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall',
  'did', 'does', 'do', 'cannot', 'wouldn', 'couldn', 'shouldn', 'didn', 'shan',
]);

const MODAL_INTERVENING_ADVERBS = new Set([
  'not', 'never', 'ever', 'scarcely', 'hardly', 'barely', 'always', 'often',
  'seldom', 'readily', 'gladly', 'willingly', 'easily', 'only', 'even', 'still',
  'already', 'soon', 'well', 'also', 'just',
]);

const COPULA_VERBS_SET = new Set([
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'seem', 'seemed', 'seems', 'appear', 'appeared', 'appears',
  'become', 'became', 'becomes', 'grow', 'grew', 'grown',
  'remain', 'remained', 'remains', 'look', 'looked', 'looks', 'feel', 'felt',
]);

const HAVE_AUX_SET = new Set(['have', 'has', 'had', 'having']);

const DEGREE_ADVERBS_SET = new Set([
  'very', 'quite', 'rather', 'somewhat', 'exceedingly', 'singularly', 'peculiarly',
  'strangely', 'utterly', 'remarkably', 'deeply', 'profoundly', 'most', 'more',
  'less', 'too', 'so', 'extremely', 'altogether', 'wholly', 'entirely', 'truly',
]);

const PREPOSITIONS_SET = new Set([
  'of', 'in', 'on', 'at', 'from', 'with', 'without', 'by', 'for', 'into',
  'upon', 'through', 'under', 'over', 'between', 'among', 'against', 'during',
  'despite', 'amid', 'amidst', 'beyond', 'within', 'throughout', 'towards', 'toward',
  'before', 'after', 'beneath', 'beside', 'besides', 'concerning', 'regarding',
]);

const POST_NOUN_BOUNDARY_WORDS = new Set([
  ...PREPOSITIONS_SET,
  ...MODALS_SET,
  ...COPULA_VERBS_SET,
  ...HAVE_AUX_SET,
  'to', 'as', 'than', 'that', 'which', 'who', 'whom', 'whose', 'where', 'when',
  'while', 'though', 'although', 'because', 'since', 'unless', 'until', 'if',
  'but', 'nor', 'yet',
  // Frequent literary finite verbs that follow a subject head noun
  'said', 'came', 'went', 'made', 'took', 'gave', 'stood', 'fell', 'rose',
  'began', 'held', 'kept', 'left', 'brought', 'thought', 'knew', 'saw', 'found',
  'lay', 'sat', 'shone', 'spoke', 'struck', 'turned', 'proved', 'served', 'bore',
]);

const OBJECT_STARTERS_AFTER_VERB = new Set([
  ...DETERMINERS_SET,
  'him', 'her', 'them', 'me', 'us', 'you', 'it', 'himself', 'herself',
  'themselves', 'myself', 'ourselves', 'yourself', 'itself', 'all', 'both', 'many',
]);

const SUBJECT_PRONOUNS_SET = new Set(['i', 'he', 'she', 'we', 'they', 'who']);

const LY_ADJECTIVES_SET = new Set([
  'melancholy', 'comely', 'homely', 'portly', 'stately', 'ghastly', 'grisly',
  'burly', 'surly', 'seemly', 'unseemly', 'timely', 'untimely', 'worldly',
  'unworldly', 'earthly', 'heavenly', 'princely', 'kingly', 'cowardly',
  'miserly', 'slovenly', 'sprightly', 'elderly', 'lonely', 'lovely', 'lively',
]);

const CONTEXT_STOP_WORDS = new Set([
  ...DETERMINERS_SET,
  ...MODALS_SET,
  ...COPULA_VERBS_SET,
  ...HAVE_AUX_SET,
  ...PREPOSITIONS_SET,
  ...DEGREE_ADVERBS_SET,
  ...MODAL_INTERVENING_ADVERBS,
  'and', 'or', 'but', 'nor', 'yet', 'for', 'so', 'to', 'as', 'than',
  'that', 'which', 'who', 'whom', 'where', 'when', 'while', 'though', 'although',
  'because', 'since', 'unless', 'until', 'if', 'there', 'here', 'then', 'thus',
  'him', 'them', 'she', 'they', 'himself', 'herself', 'themselves', 'itself',
  'one', 'ones', 'person', 'something', 'anything', 'nothing', 'everything',
  'having', 'making', 'being', 'characterized', 'relating', 'pertaining',
]);

const DOMAIN_RULES: Array<{
  name: string;
  tagPatterns: RegExp;
  defPatterns: RegExp;
  contextCues: RegExp;
  mismatchPenalty: number;
  matchBoost: number;
}> = [
  {
    name: 'chemistry',
    tagPatterns: /\b(?:chemistry|organic chemistry|inorganic chemistry|biochemistry|mineralogy)\b/i,
    defPatterns: /\b(?:chemical solution|solid from a solution|vapor state|precipitate from|crystallize|chemical compound|valence|reagent)\b/i,
    contextCues: /\b(?:chemical|chemistry|acid|alkali|solution|vapor|laboratory|alembic|vessel|experiment|chemist|sulphur|oxide|compound|crystal|liquid|fluid|distill)\b/i,
    mismatchPenalty: 6.0,
    matchBoost: 4.5,
  },
  {
    name: 'botany_zoology',
    tagPatterns: /\b(?:botany|mycology|entomology|ornithology|ichthyology|malacology|bryology|taxonomy|zoology)\b/i,
    defPatterns: /\b(?:genus of|taxonomic|flowering plant|deciduous|corolla|calyx|stamens|petals|coleoptera|lepidoptera)\b/i,
    contextCues: /\b(?:plant|flower|leaf|leaves|stem|blossom|petal|tree|shrub|botanical|species|genus|insect|beetle|bird|plumage|wing|shell|fish|flora|fauna)\b/i,
    mismatchPenalty: 5.5,
    matchBoost: 4.0,
  },
  {
    name: 'mathematics',
    tagPatterns: /\b(?:mathematics|geometry|algebra|calculus|topology|set theory|arithmetic|trigonometry|statistics)\b/i,
    defPatterns: /\b(?:right-angled|hypotenuse|polynomial|integer|logarithm|vector space|quotient|isosceles)\b/i,
    contextCues: /\b(?:angle|triangle|circle|polygon|equation|theorem|number|sum|ratio|geometry|mathematical|algebra|line|sphere|parallel|axis)\b/i,
    mismatchPenalty: 5.5,
    matchBoost: 4.0,
  },
  {
    name: 'computing',
    tagPatterns: /\b(?:computing|programming|software|internet|video games|gaming|networking)\b/i,
    defPatterns: /\b(?:computer program|source code|subroutine|operating system|data structure|user interface)\b/i,
    contextCues: /\b(?:computer|software|digital|network|server|algorithm|database|code|screen|terminal|program)\b/i,
    mismatchPenalty: 6.5,
    matchBoost: 4.0,
  },
  {
    name: 'heraldry_linguistics',
    tagPatterns: /\b(?:heraldry|phonetics|grammar|linguistics|prosody|scansion)\b/i,
    defPatterns: /\b(?:coat of arms|escutcheon|shield bearing|grammatical case|vowel sound|metrical foot)\b/i,
    contextCues: /\b(?:shield|crest|arms|banner|heraldic|syllable|vowel|consonant|verb|noun|grammar|verse|meter|stanza)\b/i,
    mismatchPenalty: 5.0,
    matchBoost: 3.5,
  },
  {
    name: 'nautical',
    tagPatterns: /\b(?:nautical)\b/i,
    defPatterns: /\b(?:aboard a ship|windward|leeward|rigging|bowsprit|foremast|gunwale|mizzen)\b/i,
    contextCues: /\b(?:ship|vessel|sail|mast|deck|helm|prow|bow|stern|sea|ocean|wave|voyage|captain|crew|anchor|harbor|port|whale|boat|mariner|gale)\b/i,
    mismatchPenalty: 2.5,
    matchBoost: 4.5,
  },
  {
    name: 'ecclesiastical',
    tagPatterns: /\b(?:ecclesiastical|theology|canon law)\b/i,
    defPatterns: /\b(?:roman catholic church|diocese|papal|ecclesiastical|liturgical)\b/i,
    contextCues: /\b(?:church|priest|bishop|pope|altar|cathedral|parish|chapel|clergy|monk|abbey|religion|faith|doctrine|prayer|sacred)\b/i,
    mismatchPenalty: 3.0,
    matchBoost: 3.5,
  },
];

const stemToken = (token: string): string => {
  let w = token.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 4) return w;
  if (w.endsWith('ingly') && w.length > 7) w = w.slice(0, -5);
  else if (w.endsWith('edly') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ibly') || w.endsWith('ably')) w = w.slice(0, -1);
  else if (w.endsWith('ily') && w.length > 5) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ly') && w.length > 5 && !LY_ADJECTIVES_SET.has(w)) w = w.slice(0, -2);

  if (w.endsWith('ation') && w.length > 7) w = w.slice(0, -5);
  else if (w.endsWith('ition') && w.length > 7) w = w.slice(0, -3);
  else if ((w.endsWith('tion') || w.endsWith('sion')) && w.length > 6) w = w.slice(0, -3);
  else if (w.endsWith('ment') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ities') && w.length > 7) w = w.slice(0, -5);
  else if (w.endsWith('ity') && w.length > 6) w = w.slice(0, -3);
  else if (w.endsWith('ies') && w.length > 5) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ied') && w.length > 5) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ing') && w.length > 6) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 5) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('ous') && !w.endsWith('us') && w.length > 4) {
    w = w.slice(0, -1);
  }
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
};

const extractContentStems = (text: string, excludeWordLower?: string): Set<string> => {
  const stems = new Set<string>();
  const excludeStem = excludeWordLower ? stemToken(excludeWordLower) : '';
  const matches = text.toLowerCase().match(/\b[a-z]{4,}\b/g);
  if (!matches) return stems;
  for (const tok of matches) {
    if (CONTEXT_STOP_WORDS.has(tok)) continue;
    if (excludeWordLower && tok === excludeWordLower) continue;
    const st = stemToken(tok);
    if (st.length >= 4 && st !== excludeStem) {
      stems.add(st);
    }
  }
  return stems;
};

export const inferContextualPosWeights = (
  rawWord: string,
  sentence: string
): Record<string, number> => {
  const weights: Record<string, number> = {
    noun: 0,
    verb: 0,
    adjective: 0,
    adverb: 0,
  };

  const target = rawWord.trim().toLowerCase();
  if (!target) return weights;

  // Morphological suffix cues
  if (target.endsWith('ly') && target.length >= 6 && !LY_ADJECTIVES_SET.has(target)) {
    weights.adverb += 4.2;
  } else if (LY_ADJECTIVES_SET.has(target)) {
    weights.adjective += 2.5;
  }
  if (/(?:tion|sion|ment|ness|ity|itude|ism|ship|ance|ence|ancy|ency|cracy|logy)$/.test(target)) {
    weights.noun += 2.8;
  }
  if (/(?:ous|ious|eous|uous|ive|able|ible|ical|ful|less|esque|ulent)$/.test(target)) {
    weights.adjective += 2.8;
  }
  if (/(?:ize|ise|ify)$/.test(target)) {
    weights.verb += 3.0;
  }

  if (!sentence) return weights;

  // Locate target word in sentence and inspect surrounding syntax
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(sentence);
  if (!match) return weights;

  const beforeText = sentence.slice(0, match.index);
  const afterText = sentence.slice(match.index + match[0].length);

  const prevTokens = (beforeText.toLowerCase().match(/\b[a-z']+\b/g) || []).map((t) =>
    t.replace(/^'+|'+$/g, '')
  );
  const nextTokens = (afterText.toLowerCase().match(/\b[a-z']+\b/g) || []).map((t) =>
    t.replace(/^'+|'+$/g, '')
  );

  const prev1 = prevTokens[prevTokens.length - 1] || '';
  const prev2 = prevTokens[prevTokens.length - 2] || '';
  const next1 = nextTokens[0] || '';
  const next2 = nextTokens[1] || '';
  const next3 = nextTokens[2] || '';

  const followedByClauseBreak = /^\s*[,.;:!?—–)\]"”']/.test(afterText) || nextTokens.length === 0;
  const precededByClauseStart = /[,.;:!?—–(\["“']\s*$/.test(beforeText) || prevTokens.length === 0;

  // Helper: check if next1 acts as a finite transitive verb (e.g. "His countenance expressed the sorrow")
  const next1LooksLikeFiniteVerb =
    POST_NOUN_BOUNDARY_WORDS.has(next1) ||
    (next1.endsWith('ed') &&
      next1.length >= 5 &&
      (OBJECT_STARTERS_AFTER_VERB.has(next2) || PREPOSITIONS_SET.has(next2)));

  // Helper: check if "and/or" coordinates two adjectives before a noun ("a pedestrian and uninspired effort")
  const next1IsCoordinatedAdjective =
    (next1 === 'and' || next1 === 'or') &&
    Boolean(next2) &&
    !POST_NOUN_BOUNDARY_WORDS.has(next2) &&
    !DETERMINERS_SET.has(next2) &&
    (Boolean(next3 && !POST_NOUN_BOUNDARY_WORDS.has(next3)) ||
      /(?:ed|ing|ous|ive|able|ible|al|ic|ful|less|nt)$/.test(next2));

  // 1. Preceded by determiner / possessive ("the ...", "his ...", "a ...")
  if (DETERMINERS_SET.has(prev1) && !precededByClauseStart) {
    weights.verb -= 4.5;
    weights.adverb -= 2.5;
    if (followedByClauseBreak || next1LooksLikeFiniteVerb) {
      weights.noun += 4.8;
    } else if (next1IsCoordinatedAdjective) {
      weights.adjective += 4.5;
    } else if (next1 === 'and' || next1 === 'or') {
      weights.noun += 3.2;
    } else {
      weights.adjective += 4.2;
      weights.noun += 0.6;
    }
  } else if (
    DETERMINERS_SET.has(prev2) &&
    (DEGREE_ADVERBS_SET.has(prev1) || (prev1.endsWith('ly') && !LY_ADJECTIVES_SET.has(prev1)))
  ) {
    // e.g. "a remarkably catholic taste"
    weights.adjective += 4.5;
    weights.verb -= 3.5;
  }

  // 2. Preceded by modal auxiliary ("would countenance", "could never countenance")
  if (
    MODALS_SET.has(prev1) ||
    (MODALS_SET.has(prev2) && (MODAL_INTERVENING_ADVERBS.has(prev1) || prev1.endsWith('ly')))
  ) {
    weights.verb += 5.5;
    weights.noun -= 3.0;
    weights.adjective -= 3.0;
  }

  // 3. Infinitive "to" vs prepositional "to"
  if (prev1 === 'to') {
    const prepositionalCues = new Set(['according', 'prior', 'contrary', 'due', 'next', 'close', 'near', 'akin']);
    if (!prepositionalCues.has(prev2) && OBJECT_STARTERS_AFTER_VERB.has(next1)) {
      weights.verb += 4.8;
      weights.noun -= 2.0;
    } else if (
      ['began', 'begun', 'tried', 'sought', 'wished', 'seemed', 'appeared', 'refused', 'ventured', 'ceased', 'continued', 'ought', 'used', 'able', 'unable', 'eager', 'reluctant', 'enough', 'order'].includes(prev2)
    ) {
      weights.verb += 4.2;
    }
  }

  // 4. Preceded by have-auxiliary ("had harbored", "had secretly harbored")
  if (
    HAVE_AUX_SET.has(prev1) ||
    (HAVE_AUX_SET.has(prev2) && (MODAL_INTERVENING_ADVERBS.has(prev1) || prev1.endsWith('ly')))
  ) {
    if (/(?:ed|en|wn|nt|pt|ght)$/.test(target)) {
      weights.verb += 4.5;
      weights.noun -= 2.5;
    }
  }

  // 5. Preceded by copula / linking verb ("was arresting", "seemed singularly arresting")
  if (
    COPULA_VERBS_SET.has(prev1) ||
    (COPULA_VERBS_SET.has(prev2) && (DEGREE_ADVERBS_SET.has(prev1) || prev1.endsWith('ly')))
  ) {
    weights.adjective += 3.6;
    if (target.endsWith('ed') || target.endsWith('ing')) {
      weights.verb += 1.4;
    }
  }

  // 6. Preceded by subject pronoun ("he harbored", "she secretly harbored")
  if (
    SUBJECT_PRONOUNS_SET.has(prev1) ||
    (SUBJECT_PRONOUNS_SET.has(prev2) && (MODAL_INTERVENING_ADVERBS.has(prev1) || prev1.endsWith('ly')))
  ) {
    weights.verb += 4.2;
    weights.noun -= 2.5;
  }

  // 7. Preceded by preposition ("without sanction of", "in abject misery")
  if (PREPOSITIONS_SET.has(prev1)) {
    weights.verb -= 3.2;
    if (followedByClauseBreak || next1LooksLikeFiniteVerb) {
      weights.noun += 3.8;
    } else if (next1IsCoordinatedAdjective || (!POST_NOUN_BOUNDARY_WORDS.has(next1) && next1 !== 'and' && next1 !== 'or')) {
      weights.adjective += 3.2;
      weights.noun += 0.8;
    }
  }

  return weights;
};

export const selectBestMeaningForContext = (
  entry: WordEntry,
  sentence: string,
  rawWord?: string
): SelectedContextualMeaning | null => {
  if (!entry || !Array.isArray(entry.meanings) || entry.meanings.length === 0) {
    return null;
  }

  const targetWord = (rawWord || entry.word || '').trim().toLowerCase();
  const posWeights = inferContextualPosWeights(targetWord, sentence);
  const sentenceStems = extractContentStems(sentence, targetWord);

  const mentalEmotionSentence =
    /\b(?:secret|secretly|mind|thought|thoughts|feeling|feelings|resentment|grudge|doubt|suspicion|hope|fear|sorrow|grief|remorse|malice|ambition|desire|passion|heart|soul|spirit|spirits|memory|anxious|melancholy)\b/i.test(
      sentence
    );
  const styleExpressionSentence =
    /\b(?:critic|treatise|essay|prose|poem|poetry|style|speech|voice|tone|words|remark|reply|book|novel|writing|literary|argument|eloquence|effort|lecture)\b/i.test(
      sentence
    );

  let bestCandidate: {
    score: number;
    partOfSpeech: string;
    definition: string;
    synonyms?: string[];
    antonyms?: string[];
  } | null = null;

  entry.meanings.forEach((meaning, meaningIdx) => {
    const rawPos = normalizePartOfSpeech(meaning.partOfSpeech);
    if (!Array.isArray(meaning.definitions) || meaning.definitions.length === 0) return;

    meaning.definitions.forEach((def, defIdx) => {
      const defText = (def.definition || '').trim();
      if (!defText) return;

      let score = 0;

      // 1. Part-of-speech alignment
      let effectivePos = rawPos;
      if (rawPos === 'participle') {
        effectivePos = (posWeights.adjective ?? 0) >= (posWeights.verb ?? 0) ? 'adjective' : 'verb';
        score += Math.max(posWeights.adjective ?? 0, posWeights.verb ?? 0);
      } else {
        score += posWeights[rawPos] ?? 0;
      }

      // 2. Circular / "form of" penalty
      if (isCircularOrFormOfDefinition(defText, targetWord)) {
        score -= 25.0;
      } else if (/^in\s+an?\s+[a-z-]+\s+(?:manner|way|fashion)\.?$/i.test(defText)) {
        score -= 6.0;
      }

      // 3. Register & usage tags
      const tagStr = [...(def.tags || [])].join(' ').toLowerCase();
      const combinedMeta = `${tagStr} ${defText.slice(0, 80).toLowerCase()}`;

      if (/\b(?:obsolete|misspelling|eye dialect|nonstandard|proscribed|corruption of)\b/.test(combinedMeta)) {
        score -= 12.0;
      } else if (/\b(?:archaic|dated)\b/.test(combinedMeta)) {
        score -= 1.8;
      }
      if (/\b(?:slang|vulgar|offensive|derogatory)\b/.test(tagStr)) {
        score -= 6.0;
      }
      if (/\b(?:literary|poetic|figurative|figuratively)\b/.test(tagStr)) {
        score += 0.9;
      }

      // 4. Domain jargon filtering vs domain context boost
      for (const rule of DOMAIN_RULES) {
        const isDomainSense = rule.tagPatterns.test(tagStr) || rule.defPatterns.test(defText);
        if (isDomainSense) {
          if (sentence && rule.contextCues.test(sentence)) {
            score += rule.matchBoost;
          } else {
            score -= rule.mismatchPenalty;
          }
        }
      }

      // 5. Contextual keyword & stem overlap
      if (sentenceStems.size > 0) {
        const defStems = extractContentStems(defText, targetWord);
        let defMatches = 0;
        for (const st of defStems) {
          if (sentenceStems.has(st)) defMatches += 1;
        }
        score += Math.min(defMatches * 2.4, 9.6);

        if (def.example) {
          const exStems = extractContentStems(def.example, targetWord);
          let exMatches = 0;
          for (const st of exStems) {
            if (sentenceStems.has(st)) exMatches += 1;
          }
          score += Math.min(exMatches * 1.5, 4.5);
        }

        const synList = [...(def.synonyms || []), ...(meaning.synonyms || [])];
        if (synList.length > 0) {
          const synStems = extractContentStems(synList.join(' '), targetWord);
          let synMatches = 0;
          for (const st of synStems) {
            if (sentenceStems.has(st)) synMatches += 1;
          }
          score += Math.min(synMatches * 2.0, 4.0);
        }
      }

      // 6. Semantic cluster affinity for common literary metaphors/polysemy
      if (
        mentalEmotionSentence &&
        /\b(?:mind|thought|thoughts|feeling|emotion|emotions|secretly|cherish|entertain|mental|spirit|mood|expression|face|visage|composure|calmness|temperament)\b/i.test(
          defText
        )
      ) {
        score += 2.2;
      }
      if (
        styleExpressionSentence &&
        /\b(?:dull|uninspired|prosaic|commonplace|ordinary|imaginative|speech|writing|style|language|expression|literary)\b/i.test(
          defText
        )
      ) {
        score += 2.2;
      }

      // 7. Lexicographic sense-frequency prior (breaks ties cleanly toward primary senses)
      score += meaningIdx === 0 ? 0.85 : Math.max(0, 0.55 - meaningIdx * 0.2);
      score += defIdx === 0 ? 1.15 : Math.max(0, 0.85 - defIdx * 0.25);

      if (!bestCandidate || score > bestCandidate.score) {
        const mergedSyns = Array.from(
          new Set([...(def.synonyms || []), ...(meaning.synonyms || [])])
        ).slice(0, 6);
        const mergedAnts = Array.from(
          new Set([...(def.antonyms || []), ...(meaning.antonyms || [])])
        ).slice(0, 6);

        bestCandidate = {
          score,
          partOfSpeech: effectivePos,
          definition: defText,
          synonyms: mergedSyns.length > 0 ? mergedSyns : undefined,
          antonyms: mergedAnts.length > 0 ? mergedAnts : undefined,
        };
      }
    });
  });

  if (!bestCandidate) return null;

  return {
    partOfSpeech: bestCandidate.partOfSpeech,
    definition: bestCandidate.definition,
    synonyms: bestCandidate.synonyms,
    antonyms: bestCandidate.antonyms,
  };
};

export const classifyComplexityLevel = (
  _word: string,
  frequency: number,
  localScore: number
): ComplexityLevel => {
  if (frequency <= 0.85 || (frequency <= 1.6 && localScore >= 16)) {
    return 'advanced';
  }
  if (frequency <= 3.8 || (frequency <= 6.0 && localScore >= 12)) {
    return 'intermediate';
  }
  return 'beginner';
};

export const extractComplexWordsFromText = async (
  text: string,
  options?: {
    maxWords?: number;
    complexityLevel?: ComplexityFilter;
    existingWords?: Set<string>;
    excludeExistingWords?: boolean;
    segmentationMode?: BookSegmentationMode;
    pagesPerSection?: number;
    wordsPerPage?: number;
    onProgress?: (stage: string, completed?: number, total?: number) => void;
  }
): Promise<BookExtractedWord[]> => {
  const maxWords = options?.maxWords;
  const complexityFilter: ComplexityFilter = options?.complexityLevel ?? 'all';
  const existingWords = options?.existingWords ?? new Set<string>();
  const excludeExistingWords = options?.excludeExistingWords ?? false;

  options?.onProgress?.('Scanning sentences and tokenizing full book text...');

  // Sample up to ~500 KB from the book body so even massive novels process quickly
  const sampledText = text.length > 500_000 ? text.slice(0, 500_000) : text;

  const segments = segmentBookIntoChaptersOrPageRanges(
    sampledText,
    options?.wordsPerPage ?? 250,
    {
      mode: options?.segmentationMode,
      pagesPerSection: options?.pagesPerSection,
    }
  );

  const formatSentenceSnippet = (sentence: string, targetWord: string): string => {
    if (sentence.length <= 220) return sentence;
    // Try splitting by semicolon or dash to isolate the clause containing the word
    const clauses = sentence.split(/[;—]+/).map(c => c.trim()).filter(Boolean);
    const matchingClause = clauses.find(c =>
      new RegExp(`\\b${targetWord}\\b`, 'i').test(c)
    );
    if (matchingClause && matchingClause.length >= 25 && matchingClause.length <= 220) {
      return matchingClause;
    }
    const lowerSent = sentence.toLowerCase();
    const idx = lowerSent.indexOf(targetWord.toLowerCase());
    if (idx === -1) return sentence.slice(0, 200) + '…';
    const start = Math.max(0, idx - 80);
    const end = Math.min(sentence.length, idx + targetWord.length + 100);
    return (start > 0 ? '…' : '') + sentence.slice(start, end).trim() + (end < sentence.length ? '…' : '');
  };

  interface CandidateInfo {
    word: string;
    sentence: string;
    chapter: string;
    lowercaseCount: number;
    capitalizedMidSentenceCount: number;
    localScore: number;
  }

  const candidates = new Map<string, CandidateInfo>();

  for (const segment of segments) {
    // Normalize single line-wraps within paragraphs into spaces
    const normalizedParagraphs = segment.text
      .replace(/\r\n/g, '\n')
      .replace(/([a-z,;:])\n([a-z])/gi, '$1 $2');

    // Split into clean sentences (supporting long literary sentences as well)
    const rawSentences = normalizedParagraphs
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(s => s.length >= 25 && /[a-zA-Z]/.test(s));

    for (const sentence of rawSentences) {
      const tokenRegex = /\b[a-zA-Z]{6,16}\b/g;
      let match: RegExpExecArray | null;
      while ((match = tokenRegex.exec(sentence)) !== null) {
        const rawToken = match[0];
        const lower = rawToken.toLowerCase();
        const index = match.index;

        if (excludeExistingWords && existingWords.has(lower)) continue;
        if (isSimpleCommonInflection(lower)) continue;

        const isLowercase = rawToken === lower;
        const isMidSentenceCap = index > 2 && /^[A-Z]/.test(rawToken);

        const snippet = formatSentenceSnippet(sentence, lower);
        const existing = candidates.get(lower);
        if (!existing) {
          candidates.set(lower, {
            word: lower,
            sentence: snippet,
            chapter: segment.label,
            lowercaseCount: isLowercase ? 1 : 0,
            capitalizedMidSentenceCount: isMidSentenceCap ? 1 : 0,
            localScore: computeLocalComplexityScore(lower),
          });
        } else {
          if (isLowercase) existing.lowercaseCount += 1;
          if (isMidSentenceCap) existing.capitalizedMidSentenceCount += 1;
          // Prefer a sentence between 45 and 175 chars that ends cleanly with punctuation
          const currentGood = existing.sentence.length >= 45 && existing.sentence.length <= 175;
          const nextGood = snippet.length >= 45 && snippet.length <= 175;
          if (!currentGood && nextGood) {
            existing.sentence = snippet;
          }
        }
      }
    }
  }

  // Filter out proper nouns (words that appear capitalized mid-sentence or never appear in lowercase)
  const sortedByScore = Array.from(candidates.values())
    .filter(c => c.lowercaseCount >= 1 && c.capitalizedMidSentenceCount === 0)
    .sort((a, b) => b.localScore - a.localScore);

  const validCandidates: CandidateInfo[] = maxWords
    ? sortedByScore.slice(0, Math.max(maxWords * 2, 48))
    : sortedByScore;

  if (validCandidates.length === 0) {
    return [];
  }

  const totalCandidates = validCandidates.length;
  options?.onProgress?.(
    `Checking rarity & definitions for ${totalCandidates} candidate words...`,
    0,
    totalCandidates
  );

  // Enrich in bounded concurrent batches so every word gets full Wiktionary/dictionary sense ranking
  const BATCH_SIZE = 16;
  const enriched: Array<(BookExtractedWord & { rankScore: number }) | null> = [];

  for (let i = 0; i < totalCandidates; i += BATCH_SIZE) {
    const batch = validCandidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (candidate) => {
        const freqInfo = await queryDatamuseFrequency(candidate.word);

        // Exclude ultra-common everyday words (> 22 occurrences per million)
        if (freqInfo.frequency > 22) {
          return null;
        }

        const cleanSentence = candidate.sentence.replace(/^["“']+|["”']+$/g, '').trim();

        // Query full Wiktionary-backed dictionary pipeline for EVERY candidate word (no 24-word cutoff)
        const dictEntry = await lookupWord(candidate.word);

        const effectiveEntry: WordEntry | null =
          dictEntry ||
          (freqInfo.fallbackMeanings
            ? {
                word: candidate.word,
                phonetic: freqInfo.phonetic,
                meanings: freqInfo.fallbackMeanings,
              }
            : null);

        let selected = effectiveEntry
          ? selectBestMeaningForContext(effectiveEntry, cleanSentence, candidate.word)
          : null;

        let phonetic = dictEntry?.phonetic || freqInfo.phonetic;
        let audio = dictEntry?.audio;

        let resolvedDictSource: WordEntry | null = dictEntry;

        // If an inflected book word still lacked a definition across all sources, check derived base lemmas
        if (!selected || isCircularOrFormOfDefinition(selected.definition, candidate.word)) {
          const lemmas = deriveCandidateLemmas(candidate.word);
          for (const { lemma } of lemmas.slice(0, 2)) {
            const lemmaDict = await lookupWord(lemma);
            if (lemmaDict) {
              const lemmaSelected = selectBestMeaningForContext(
                lemmaDict,
                cleanSentence,
                candidate.word
              );
              if (lemmaSelected && !isCircularOrFormOfDefinition(lemmaSelected.definition, lemma)) {
                selected = lemmaSelected;
                resolvedDictSource = lemmaDict;
                phonetic = phonetic || lemmaDict.phonetic;
                audio = audio || lemmaDict.audio;
                break;
              }
            }
            const stemInfo = await queryDatamuseFrequency(lemma);
            if (stemInfo.fallbackMeanings) {
              const stemSelected = selectBestMeaningForContext(
                { word: lemma, meanings: stemInfo.fallbackMeanings },
                cleanSentence,
                candidate.word
              );
              if (stemSelected) {
                selected = stemSelected;
                resolvedDictSource = null;
                phonetic = phonetic || stemInfo.phonetic;
                break;
              }
            }
          }
        }

        const finalDef = selected?.definition || freqInfo.fallbackDef;
        if (!finalDef) {
          return null;
        }

        const partOfSpeech = selected?.partOfSpeech || freqInfo.fallbackPos || 'noun';

        let resolvedTranslations = selected?.translations;
        const sourceHadAnyTranslations = Boolean(
          resolvedDictSource?.wordTranslations?.fa?.length ||
            resolvedDictSource?.meanings.some(m => m.definitions.some(d => Boolean(d.translations?.fa)))
        );
        // Only run standalone Persian translation if finalDef came from Datamuse fallback (!resolvedDictSource)
        // or if lookupWord succeeded on other senses and picked a deep un-enriched sense (sourceHadAnyTranslations)
        if (!resolvedTranslations?.fa && (!resolvedDictSource || sourceHadAnyTranslations)) {
          resolvedTranslations = await translateCardMeaningToPersian({
            word: candidate.word,
            partOfSpeech,
            mainDefinition: finalDef,
            existingTranslations: resolvedTranslations,
            maxWaitMs: 800,
          });
        }

        const complexityLevel = classifyComplexityLevel(
          candidate.word,
          freqInfo.frequency,
          candidate.localScore
        );

        const rankScore = Number((candidate.localScore - freqInfo.frequency * 1.1).toFixed(2));
        const extracted: BookExtractedWord & { rankScore: number } = {
          word: candidate.word.charAt(0).toUpperCase() + candidate.word.slice(1),
          phonetic,
          audio,
          partOfSpeech,
          mainDefinition: finalDef,
          ...(resolvedTranslations ? { translations: resolvedTranslations } : {}),
          bookSentence: cleanSentence,
          synonyms: selected?.synonyms,
          antonyms: selected?.antonyms,
          frequency: freqInfo.frequency,
          complexityLevel,
          complexityScore: rankScore,
          chapter: candidate.chapter,
          rankScore,
        };

        return extracted;
      })
    );

    enriched.push(...batchResults);
    const completed = Math.min(i + BATCH_SIZE, totalCandidates);
    options?.onProgress?.(
      `Enriching vocabulary (${completed} / ${totalCandidates} candidate words)...`,
      completed,
      totalCandidates
    );
  }

  const validEnriched = enriched
    .filter((item): item is BookExtractedWord & { rankScore: number } => item !== null)
    .sort((a, b) => b.rankScore - a.rankScore);

  const applyLimit = (items: Array<BookExtractedWord & { rankScore: number }>) =>
    (maxWords ? items.slice(0, maxWords) : items).map(({ rankScore, ...word }) => word);

  if (complexityFilter !== 'all') {
    const matchingLevel = validEnriched.filter(w => w.complexityLevel === complexityFilter);
    const otherLevels = validEnriched.filter(w => w.complexityLevel !== complexityFilter);
    return applyLimit([...matchingLevel, ...otherLevels]);
  }

  return applyLimit(validEnriched);
};
