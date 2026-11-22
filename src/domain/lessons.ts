export interface Lesson {
  id: string;
  category: string;
  title: string;
  description: string;
  text: string;
  targetWpm: number;
  targetAccuracy: number;
  /** keys this lesson trains, used for recommendations */
  keys: string;
}

export interface LessonCategory {
  id: string;
  title: string;
  description: string;
}

export const categories: LessonCategory[] = [
  { id: 'beginner', title: 'Beginner fundamentals', description: 'Posture, rhythm and your first keys.' },
  { id: 'home', title: 'Home row', description: 'A S D F — J K L ; is where every finger rests.' },
  { id: 'top', title: 'Top row', description: 'Q W E R T Y U I O P, reached from home.' },
  { id: 'bottom', title: 'Bottom row', description: 'Z X C V B N M and punctuation below.' },
  { id: 'fingers', title: 'Finger placement', description: 'Drills that isolate each finger.' },
  { id: 'combos', title: 'Common combinations', description: 'Frequent bigrams and trigrams.' },
  { id: 'difficult', title: 'Difficult words', description: 'Long and awkward spellings.' },
  { id: 'accuracy', title: 'Accuracy training', description: 'Slow down. Every key counts.' },
  { id: 'speed', title: 'Speed training', description: 'Short common words, high tempo.' },
  { id: 'advanced', title: 'Advanced practice', description: 'Punctuation, numbers and capitals.' },
];

const L = (
  id: string,
  category: string,
  title: string,
  description: string,
  text: string,
  targetWpm: number,
  targetAccuracy: number,
  keys: string,
): Lesson => ({ id, category, title, description, text, targetWpm, targetAccuracy, keys });

export const lessons: Lesson[] = [
  L('beginner-1', 'beginner', 'First keys: F and J', 'Find the bumps on F and J. Keep your eyes on the screen.', 'f j f j ff jj fj jf fff jjj fjf jfj f j fj jf ffj jjf fjfj jfjf', 10, 90, 'fj'),
  L('beginner-2', 'beginner', 'Index fingers', 'Add G and H by stretching your index fingers.', 'fg hj gh fgf hjh gfg jhj fghj jhgf gh hg fg hj ghgh fgfg hjhj', 12, 90, 'fghj'),
  L('beginner-3', 'beginner', 'First words', 'Short real words with the keys you know.', 'had has dash gash flag half hall glad lash sash jag shag hag gal', 15, 90, 'fghjasdl'),
  L('home-1', 'home', 'Left hand home', 'A S D F only. Return to home after every key.', 'asdf fdsa sad dad fad add as ad sass dads fads asdf sad fad dad', 15, 92, 'asdf'),
  L('home-2', 'home', 'Right hand home', 'J K L ; only.', 'jkl; ;lkj jk kl l; jkl lkj kj lk ;l jj kk ll jkl; ;lkj', 15, 92, 'jkl;'),
  L('home-3', 'home', 'Full home row', 'Real words using only the home row.', 'flask salad glass shall falls lads hash alas flash gala jade fall ask dash lass all', 20, 93, 'asdfghjkl'),
  L('top-1', 'top', 'Reaching up: E and I', 'Middle fingers reach up and come back.', 'die lie kid lid side hide ideas dial idle slide field shield', 18, 92, 'ei'),
  L('top-2', 'top', 'R, T, U, Y', 'Index fingers reach to the top row.', 'try truly rush hurt tray dusty yard rusty tray study duty fruity', 20, 92, 'rtuy'),
  L('top-3', 'top', 'Whole top row', 'Q W E R T Y U I O P in real words.', 'quiet power trip poetry writer pretty tower equity wipe query outpour', 22, 93, 'qwertyuiop'),
  L('bottom-1', 'bottom', 'C, V, N, M', 'Index and middle fingers reach down.', 'van can man mine vine calm cave name moon clean manic venom', 18, 92, 'cvnm'),
  L('bottom-2', 'bottom', 'Z, X, B', 'The awkward corners.', 'zebra box buzz oxen bronze maze exam blaze zinc axle fizz boxer', 18, 92, 'zxb'),
  L('fingers-1', 'fingers', 'Pinky power', 'Pinkies cover Q A Z P ; and more.', 'quaz paz zap quip aqua pizza plaza quasar papa zappa quiz', 16, 90, 'qazp'),
  L('fingers-2', 'fingers', 'Ring fingers', 'W S X O L — the weakest fingers need work.', 'slow owls woos lows sows wool solo loss show slosh swollen', 18, 92, 'wsxol'),
  L('combos-1', 'combos', 'th, he, in, er', 'The most common English bigrams.', 'the there then other inner winter thinner either herein thin tether', 25, 94, 'theinr'),
  L('combos-2', 'combos', 'ing, ion, and, ent', 'Common trigrams that come up everywhere.', 'going nation and sent being motion hand intent doing station brand moment', 25, 94, 'ingoaet'),
  L('difficult-1', 'difficult', 'Tricky spellings', 'Commonly misspelled words.', 'necessary separate rhythm definitely occurrence accommodate privilege threshold', 25, 92, 'nscrythdl'),
  L('difficult-2', 'difficult', 'Long words', 'Stamina for longer words.', 'infrastructure characteristic correspondence sophisticated straightforward', 25, 92, 'aeiorst'),
  L('accuracy-1', 'accuracy', 'Precision drill', 'Target 98% accuracy. Speed does not matter here.', 'the quick brown fox jumps over the lazy dog while seven wizards quietly box', 20, 98, 'abcdefghijklmnopqrstuvwxyz'),
  L('accuracy-2', 'accuracy', 'Similar shapes', 'Words that are easy to swap.', 'form from quite quiet then than affect effect lose loose were where', 22, 97, 'fromqitehnalsw'),
  L('speed-1', 'speed', 'Short word sprint', 'Short words, push the tempo.', 'it is to be or in on at we he do go so no up as an me my by of if us am', 45, 92, 'itbeoranwhdgsmyfu'),
  L('speed-2', 'speed', 'Common word flow', 'Very common words in a natural flow.', 'the and that have for not with you this but his from they say her she will one all would there their what', 50, 93, 'thaenrsoiwlyu'),
  L('advanced-1', 'advanced', 'Capitals and punctuation', 'Shift keys and punctuation in real sentences.', 'Hello, world. Are you ready? Yes! Let us begin: type fast, type well; then rest.', 35, 94, ',.?!:;'),
  L('advanced-2', 'advanced', 'Numbers and symbols', 'The number row and common symbols.', 'In 2024 we sold 135 units at $12.50 each, a 7% rise over 2023 (98 units).', 30, 93, '0123456789$%()'),
];

export function getLesson(id: string): Lesson | undefined {
  return lessons.find((l) => l.id === id);
}
