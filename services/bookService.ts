import JSZip from 'jszip';
import { lookupWord } from './dictionaryService';

export interface GutenbergBook {
  id: number;
  title: string;
  authors: string[];
  coverUrl?: string;
  textUrl: string;
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
const DATAMUSE_API_URL = 'https://api.datamuse.com/words';

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
  'virulent', 'visage', 'voracious', 'wanton', 'wretched', 'zealous',
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

const pickBestTextUrl = (formats: Record<string, string>): string | null => {
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

  return null;
};

export const searchGutenbergBooks = async (query: string): Promise<GutenbergBook[]> => {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const response = await fetchWithTimeout(
    `${GUTENDEX_API_URL}?search=${encodeURIComponent(cleanQuery)}`,
    8000
  );

  if (!response.ok) {
    throw new Error(`Book catalog search failed (${response.status})`);
  }

  const data = await response.json();
  if (!data || !Array.isArray(data.results)) return [];

  const books: GutenbergBook[] = [];
  for (const item of data.results) {
    if (!item || typeof item.title !== 'string') continue;
    const formats = item.formats || {};
    const textUrl = pickBestTextUrl(formats);
    if (!textUrl) continue;

    const authors = Array.isArray(item.authors)
      ? item.authors.map((a: any) => formatAuthorName(String(a?.name || ''))).filter(Boolean)
      : [];

    books.push({
      id: Number(item.id) || books.length + 1,
      title: item.title.replace(/\s*;.*$/, '').trim(),
      authors: authors.length > 0 ? authors : ['Unknown Author'],
      coverUrl: formats['image/jpeg'] || undefined,
      textUrl,
    });

    if (books.length >= 6) break;
  }

  return books;
};

export const stripGutenbergBoilerplate = (rawText: string): string => {
  let text = rawText;

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

export const fetchGutenbergBookText = async (book: GutenbergBook): Promise<string> => {
  const candidateUrls = [
    book.textUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(book.textUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(book.textUrl)}`,
  ];

  let lastError: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const response = await fetchWithTimeout(url, 9000);
      if (!response.ok) continue;
      const raw = await response.text();
      if (raw && raw.trim().length > 200) {
        return stripGutenbergBoilerplate(raw);
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('Could not download the book text from Project Gutenberg.');
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
