import JSZip from 'jszip';
import { lookupWord } from './dictionaryService';

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
  bookSentence: string;
  synonyms?: string[];
  antonyms?: string[];
  frequency?: number;
}

const GUTENDEX_API_URL = 'https://gutendex.com/books';
const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const WIKISOURCE_API_URL = 'https://en.wikisource.org/w/api.php';
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
Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever my hypos get such an upper hand of me that a hypochondriacal gloom settles upon my spirit, then I account it high time to get to sea as soon as I can.
Should you choose to circumambulate the city of a dreamy Sabbath afternoon, you will see thousands of mortal men fixed in ocean reveries along the wharves.
An inscrutable malice sinewing it, the white whale swam through the tumultuous and portentous billows of the Pacific.
With an indefatigable and monomaniac persistence, the captain pursued his audacious and irrevocable vengeance across the unfathomable deep.
A palpable and lugubrious silence settled over the crew as they contemplated the voracious leviathan and the vicissitudes of their perilous voyage.
`,
  },
  {
    id: 84,
    title: 'Frankenstein',
    aliases: ['frankenstein or the modern prometheus', 'modern prometheus', 'mary shelley'],
    authors: ['Mary Wollstonecraft Shelley'],
    wikisourceTitle: 'Frankenstein,_or_the_Modern_Prometheus_(1818)',
    excerpt: `
A lugubrious shadow fell across the glaciers as the storm approached the mountain peak.
My soul was filled with an ineffable sense of wonder and terror at the spectacle before me.
Such pernicious ambition had led my inquiries into the hidden secrets of nature and life.
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
His supercilious manner and taciturn disposition rendered him odious to the entire assembly at the ball.
She listened with fastidious attention and perspicacious discernment to his candid explanation of the affair.
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
A portentous and lugubrious howling echoed through the precipice as the nocturnal carriage ascended the pass.
The count maintained an inscrutable and placid countenance despite the virulent antipathy that gleamed in his eyes.
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
His ephemeral and ineffable smile conveyed a benevolent assurance that understood every vicissitude of human longing.
Through the supercilious chatter and ostentatious revelry of the summer garden, he remained aloof in solitary reverie.
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
His austere and inscrutable visage betrayed a tumultuous remorse that no solace could easily quell.
With intrepid veracity and unfeigned dignity, she rejected the ignominious and pernicious proposal.
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

// Backup Provider 1: Open Library (Internet Archive's official book search with fuzzy matching & Gutenberg IDs)
const queryOpenLibrary = async (query: string): Promise<GutenbergBook[]> => {
  try {
    const url = `${OPEN_LIBRARY_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=8&fields=key,title,author_name,cover_i,ia,id_project_gutenberg,first_publish_year,ebook_access`;
    const response = await fetchWithTimeout(url, 4500);
    if (!response.ok) return [];
    const data = await response.json();
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

      if (!isPublicDomain) continue;

      const pgNum = pgIds[0] ? parseInt(String(pgIds[0]).replace(/\D+/g, ''), 10) : 0;
      const iaId = iaIds[0] ? String(iaIds[0]) : undefined;
      const cleanTitle = doc.title.replace(/\s*;.*$/, '').trim();
      const classicMatch = CLASSIC_BOOKS_CATALOG.find(
        c => (pgNum && c.id === pgNum) || normalizeSearchText(c.title) === normalizeSearchText(cleanTitle)
      );

      const effectiveId = pgNum || classicMatch?.id || Math.abs(
        cleanTitle.split('').reduce((acc: number, ch: string) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
      );

      const textUrl = pgNum
        ? `https://www.gutenberg.org/cache/epub/${pgNum}/pg${pgNum}.txt`
        : classicMatch
          ? `https://www.gutenberg.org/cache/epub/${classicMatch.id}/pg${classicMatch.id}.txt`
          : iaId
            ? `https://archive.org/download/${iaId}/${iaId}_djvu.txt`
            : '';

      if (!textUrl) continue;

      const authors = Array.isArray(doc.author_name)
        ? doc.author_name.slice(0, 2).map((a: any) => String(a))
        : ['Unknown Author'];

      const coverUrl = doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : pgNum
          ? `https://www.gutenberg.org/cache/epub/${pgNum}/pg${pgNum}.cover.medium.jpg`
          : undefined;

      books.push({
        id: effectiveId,
        title: cleanTitle,
        authors,
        coverUrl,
        textUrl,
        source: 'Open Library',
        iaId,
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

// Backup Provider 2: Wikisource (Wikimedia Foundation public-domain library with native CORS origin=*)
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

export const searchPublicDomainBooks = async (query: string): Promise<BookSearchResponse> => {
  const cleanQuery = query.trim();
  if (!cleanQuery) return { exactMatches: [], similarMatches: [] };

  // 1. Score built-in classic catalog immediately (handles typos, hyphens, partial names)
  const scoredClassics = CLASSIC_BOOKS_CATALOG.map((entry) => {
    const sim = computeBookSimilarity(cleanQuery, entry.title, entry.authors, entry.aliases);
    const book: GutenbergBook = {
      id: entry.id,
      title: entry.title,
      authors: entry.authors,
      coverUrl: `https://www.gutenberg.org/cache/epub/${entry.id}/pg${entry.id}.cover.medium.jpg`,
      textUrl: `https://www.gutenberg.org/cache/epub/${entry.id}/pg${entry.id}.txt`,
      source: 'Project Gutenberg',
      similarity: sim,
      wikisourceTitle: entry.wikisourceTitle,
      fallbackExcerpt: entry.excerpt,
    };
    return { book, sim };
  }).sort((a, b) => b.sim - a.sim);

  // 2. Query Gutendex, Open Library, and Wikisource in parallel
  const [gutendexBooks, openLibraryBooks, wikisourceBooks] = await Promise.all([
    queryGutendex(cleanQuery),
    queryOpenLibrary(cleanQuery),
    queryWikisource(cleanQuery),
  ]);

  let additionalBooks: GutenbergBook[] = [];
  // 3. If primary providers returned nothing (e.g. typo in query), try spell-corrected query
  if (gutendexBooks.length === 0 && openLibraryBooks.length === 0) {
    const suggestedQuery = await fetchSpellingSuggestion(cleanQuery);
    if (suggestedQuery) {
      const [retryGutendex, retryOpenLib] = await Promise.all([
        queryGutendex(suggestedQuery),
        queryOpenLibrary(suggestedQuery),
      ]);
      additionalBooks = [...retryGutendex, ...retryOpenLib];
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
        wikisourceTitle: existing.wikisourceTitle || b.wikisourceTitle,
        fallbackExcerpt: existing.fallbackExcerpt || b.fallbackExcerpt,
        similarity: Math.max(existing.similarity ?? 0, sim),
      });
    }
  };

  // Prioritize Gutendex direct results, then strong Classic matches, then Open Library & Wikisource
  for (const b of gutendexBooks) addCandidate(b, true);
  for (const { book, sim } of scoredClassics) {
    if (sim >= 0.55) addCandidate(book);
  }
  for (const b of openLibraryBooks) addCandidate(b);
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

  // If JSON from Wikisource API (prop=extracts), unwrap the extract text
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
    const searchUrl = `${WIKISOURCE_API_URL}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=5&format=json`;
    const searchRes = await fetchWithTimeout(searchUrl, 4000);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search;
    if (!Array.isArray(hits) || hits.length === 0) return null;

    // Fetch extracts for the top matching pages/chapters
    const pageTitles = hits.slice(0, 3).map((h: any) => String(h.title)).filter(Boolean);
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

export const fetchGutenbergBookText = async (book: GutenbergBook): Promise<string> => {
  const normBookPrimary = normalizeSearchText(book.title.replace(/\s*;.*$/, ''));
  const classicMatch = CLASSIC_BOOKS_CATALOG.find(
    c =>
      c.id === book.id ||
      normalizeSearchText(c.title.replace(/\s*;.*$/, '')) === normBookPrimary
  );
  const fallbackExcerpt = book.fallbackExcerpt || classicMatch?.excerpt;

  // 1. Try direct book.textUrl first (fast path for mocked tests or CORS-enabled URLs like Wikisource)
  try {
    const directRes = await fetchWithTimeout(book.textUrl, 4500);
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

  // 2. Try Gutenberg mirror URLs via multiple independent CORS proxies
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
    if (targetUrl.includes('wikisource.org')) continue;
    proxyUrls.push(
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
    );
  }

  for (const proxyUrl of proxyUrls.slice(0, 5)) {
    try {
      const res = await fetchWithTimeout(proxyUrl, 5000);
      if (!res.ok) continue;
      const raw = await res.text();
      const cleaned = stripGutenbergBoilerplate(raw);
      if (cleaned.length > 200 && !cleaned.startsWith('{"error"')) {
        return cleaned;
      }
    } catch {
      // Try next mirror/proxy
    }
  }

  // 3. Try Wikisource native CORS API (100% browser-accessible without proxies)
  const wikiText = await fetchTextFromWikisource(book.wikisourceTitle || book.title);
  if (wikiText) {
    return fallbackExcerpt ? `${fallbackExcerpt}\n\n${wikiText}` : wikiText;
  }

  // 4. Use built-in authentic literary corpus excerpt if available
  if (fallbackExcerpt && fallbackExcerpt.trim().length > 100) {
    return fallbackExcerpt.trim();
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
          paragraphs.push(bodyText);
        }
      } else {
        const stripped = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (stripped.length > 40) paragraphs.push(stripped);
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

const isSimpleCommonInflection = (word: string): boolean => {
  if (COMMON_WORDS.has(word)) return true;
  const stems = [
    word.replace(/(?:ing|ed|ly|es|s|er|est|ness|ment)$/, ''),
    word.replace(/(?:ing|ed|er|est)$/, 'e'),
    word.replace(/(?:ied|ies|ier|iest|ily)$/, 'y'),
  ];
  return stems.some(stem => stem.length >= 4 && COMMON_WORDS.has(stem));
};

const computeLocalComplexityScore = (word: string): number => {
  let score = Math.min(word.length, 14);
  for (const affix of COMPLEX_AFFIXES) {
    if (word.includes(affix.trim())) {
      score += 8;
      break;
    }
  }
  // Reward uncommon consonant/vowel patterns typical of Latin/Greek roots
  if (/(?:ph|ch|qu|sc|gn|ps|rh|mn|ct|pt|xt)/.test(word)) {
    score += 3;
  }
  if (/(?:ious|eous|acity|itude|escence|escent|ulent|animous|ology|cracy|phobia|isis|osis)$/.test(word)) {
    score += 5;
  }
  return score;
};

const queryDatamuseFrequency = async (
  word: string
): Promise<{ frequency: number; fallbackDef?: string; fallbackPos?: string; phonetic?: string }> => {
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
    if (Array.isArray(item.defs) && item.defs.length > 0) {
      const defStr = String(item.defs[0]);
      const tabIdx = defStr.indexOf('\t');
      if (tabIdx !== -1) {
        const posCode = defStr.slice(0, tabIdx);
        fallbackDef = defStr.slice(tabIdx + 1).trim();
        fallbackPos =
          posCode === 'n' ? 'noun' :
          posCode === 'v' ? 'verb' :
          posCode === 'adj' ? 'adjective' :
          posCode === 'adv' ? 'adverb' : 'noun';
      }
    }

    return { frequency, fallbackDef, fallbackPos, phonetic };
  } catch {
    return { frequency: 2.0 };
  }
};

export const extractComplexWordsFromText = async (
  text: string,
  options?: {
    maxWords?: number;
    existingWords?: Set<string>;
    onProgress?: (stage: string) => void;
  }
): Promise<BookExtractedWord[]> => {
  const maxWords = options?.maxWords ?? 12;
  const existingWords = options?.existingWords ?? new Set<string>();

  options?.onProgress?.('Scanning sentences and tokenizing book text...');

  // Sample up to ~350 KB from the book body so even massive novels process in < 100ms
  const sampledText = text.length > 350_000 ? text.slice(0, 350_000) : text;

  // Normalize single line-wraps within paragraphs into spaces
  const normalizedParagraphs = sampledText
    .replace(/\r\n/g, '\n')
    .replace(/([a-z,;:])\n([a-z])/gi, '$1 $2');

  // Split into clean sentences (supporting long literary sentences as well)
  const rawSentences = normalizedParagraphs
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 25 && /[a-zA-Z]/.test(s));

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
    lowercaseCount: number;
    capitalizedMidSentenceCount: number;
    localScore: number;
  }

  const candidates = new Map<string, CandidateInfo>();

  for (const sentence of rawSentences) {
    const tokenRegex = /\b[a-zA-Z]{6,16}\b/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(sentence)) !== null) {
      const rawToken = match[0];
      const lower = rawToken.toLowerCase();
      const index = match.index;

      if (existingWords.has(lower)) continue;
      if (isSimpleCommonInflection(lower)) continue;

      const isLowercase = rawToken === lower;
      const isMidSentenceCap = index > 2 && /^[A-Z]/.test(rawToken);

      const snippet = formatSentenceSnippet(sentence, lower);
      const existing = candidates.get(lower);
      if (!existing) {
        candidates.set(lower, {
          word: lower,
          sentence: snippet,
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

  // Filter out proper nouns (words that appear capitalized mid-sentence or never appear in lowercase)
  const validCandidates = Array.from(candidates.values())
    .filter(c => c.lowercaseCount >= 1 && c.capitalizedMidSentenceCount === 0)
    .sort((a, b) => b.localScore - a.localScore)
    .slice(0, Math.max(maxWords * 2, 24));

  if (validCandidates.length === 0) {
    return [];
  }

  options?.onProgress?.('Checking word rarity and looking up definitions...');

  // Enrich with Datamuse frequency & dictionary definitions in parallel
  const enriched = await Promise.all(
    validCandidates.map(async (candidate) => {
      const [freqInfo, dictEntry] = await Promise.all([
        queryDatamuseFrequency(candidate.word),
        lookupWord(candidate.word),
      ]);

      // Exclude high-frequency everyday words (> 12 occurrences per million)
      if (freqInfo.frequency > 12) {
        return null;
      }

      const firstMeaning = dictEntry?.meanings?.[0];
      const firstDef = firstMeaning?.definitions?.[0]?.definition || freqInfo.fallbackDef;
      if (!firstDef) {
        return null;
      }

      const partOfSpeech = firstMeaning?.partOfSpeech || freqInfo.fallbackPos || 'noun';
      const phonetic = dictEntry?.phonetic || freqInfo.phonetic;

      const extracted: BookExtractedWord & { rankScore: number } = {
        word: candidate.word.charAt(0).toUpperCase() + candidate.word.slice(1),
        phonetic,
        audio: dictEntry?.audio,
        partOfSpeech,
        mainDefinition: firstDef,
        bookSentence: candidate.sentence.replace(/^["“']+|["”']+$/g, '').trim(),
        synonyms: firstMeaning?.synonyms?.slice(0, 6),
        antonyms: firstMeaning?.antonyms?.slice(0, 6),
        frequency: freqInfo.frequency,
        rankScore: candidate.localScore - freqInfo.frequency * 1.2,
      };

      return extracted;
    })
  );

  return enriched
    .filter((item): item is BookExtractedWord & { rankScore: number } => item !== null)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, maxWords)
    .map(({ rankScore, ...word }) => word);
};
