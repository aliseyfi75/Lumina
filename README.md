<img width="1024" height="559" alt="Lumina Vocabulary & Flashcards Preview" src="https://github.com/user-attachments/assets/e5c54ecf-0760-4251-803d-bb08e0e526cf" />

# Lumina

**Illuminate your vocabulary.**

Lumina is a modern, privacy-first dictionary, book vocabulary prep tool, and spaced-repetition flashcard app. Look up words in English & Persian, extract tough vocabulary from books before reading, import existing Anki `.apkg` decks, and master every word with active-recall study modes — completely free, private, and works offline.

👉 [Try Lumina Live Here](https://aliseyfi75.github.io/Lumina/)

[![Lumina](https://img.youtube.com/vi/zdaJXz-VHzA/0.jpg)](https://www.youtube.com/watch?v=zdaJXz-VHzA)

## Why Lumina?

Learning vocabulary often breaks across disconnected tools: you look up a word in a dictionary, forget it the next day, or spend hours formatting spreadsheets to build flashcards.

**Lumina unifies the entire loop:**
1. **Discover** — Instantly look up definitions, IPA phonetics, audio pronunciation, synonyms, and bilingual Persian (`فارسی`) meanings.
2. **Capture** — Turn any dictionary definition, book chapter word, Anki deck, or highlighted webpage word into a rich flashcard in one click.
3. **Master** — Retain vocabulary permanently with spaced repetition, Fill-in-the-Blank Cloze, Smart Quiz, Listening Recall, Daily Goals, and Streak Freeze.

---

## Key Features

* **📖 Intelligent Bilingual Dictionary (EN / فارسی)**: Instant autocomplete, full definitions, IPA phonetics, audio playback, synonyms/antonyms, and automatic English + Persian (`فارسی`) meanings with crisp RTL typography (`Vazirmatn`).
* **📚 Book Vocabulary Prep**: Search thousands of classics from Project Gutenberg or upload your own `.epub` / `.txt` book. Lumina extracts chapter-by-chapter vocabulary ranked by difficulty so you can learn tricky words *before* reading each chapter.
* **📦 In-Browser Anki (`.apkg`) Import**: Import existing Anki decks directly in the browser (powered by `sql.js` & `JSZip`) with safe HTML sanitization, embedded image/audio preservation, and automatic deck tagging.
* **🧠 Active-Recall Study Modes**:
  * **Classic 3D Flip** — Dynamic spaced-repetition intervals (`1d → 7d → 14d → 30d → Mastered`) with swipe & keyboard shortcuts.
  * **Smart Quiz** — Multiple-choice challenges with part-of-speech-matched distractors, contextual example feedback, and 1-click `"Mark Mastered"`.
  * **Fill-in-the-Blank (Cloze)** — Recall target words inside real book or dictionary example sentences with letter hints.
  * **Listening Recall** — Audio-first recall mode that hides spelling until you flip the card.
  * **Focus on Hardest Words** — Drill cards you previously missed for targeted mastery.
* **🎯 Daily Goals, Streak Freeze & Celebrations**: Customizable daily review rings (`5 / 10 / 20 / 30` cards), automatic Streak Freeze earned every 5 active days, milestone celebration modals (`25, 50, 100, 200+` mastered words) with downloadable 1200×630 PNG share cards, and a Quick 1-Card Warmup right on Home.
* **📊 Analytics & Reminders**: Interactive 90-day study heatmap, vocabulary growth & upcoming-review charts, and recurring `.ics` calendar study reminders.
* **☁️ Instant Cloud & Local Sync**:
  * **GitHub Gist Sync (Recommended)** — Fast, 1-request encrypted-in-transit sync using your own private GitHub Gist.
  * **Pantry Cloud Sync** — Zero-account free JSON storage with automatic chunking.
  * **Local File Sync & Data Freedom** — Auto-save directly to a local file via the File System Access API, or import/export JSON & CSV anytime.
* **📱 Offline-First PWA**: Primary IndexedDB storage with persistent storage support, dark mode, WCAG 2.1 AA accessibility, and full mobile/desktop installation.

---

## Browser Extension — Lumina Collector v2.0

Capture vocabulary directly while reading articles, docs, or books on the web with **Lumina Collector**:
* **Instant Double-Click Lookup Tooltip** on any webpage with 1-click **"Save to Lumina"**.
* **Automatic Context Capture** saves the surrounding sentence as your card's example and tags the source website (`Web: domain.com`).
* **GitHub Gist (Instant) & Pantry Sync** matching your Lumina web deck.

👉 [Get Lumina Collector on Chrome Web Store](https://chromewebstore.google.com/detail/lumina-collector/jngpnagbkdaifmokdcokhakfkbpdnlag)

---

## How to Use

### 1. Dictionary & Bilingual Search
Type any word into the Home or Dictionary search bar for instant autocomplete suggestions. Click **"Add to Flashcards"** on the exact sense you want to remember, or switch between **English**, **Persian (`فارسی`)**, and **Both** in Settings.

### 2. Book Vocabulary Prep
Open **Prepare for a Book** from the Home screen or Flashcards view. Search Project Gutenberg or upload an `.epub` / `.txt` file, pick chapters and difficulty level, and import selected words straight into a tagged Book deck.

### 3. Flashcard Deck & Bulk Tools
Browse, filter by status/tag/book, flip cards inline, edit custom definitions/images, undo accidental deletes, or use **Select Mode** for bulk tagging, resetting, and cleanup.

### 4. Focused Study Sessions
Start a Full Session, Short Sprint, Smart Quiz, Fill-in-the-Blank Cloze, or Listening Recall session—optionally scoped to a specific Book, Chapter, Tag, or Hardest Words.

### 5. Cloud Sync & Backups (Data Manager)
Click the **Database / Cloud icon** in the header to connect **GitHub Gist**, **Pantry Cloud**, **Local File Sync**, import **Anki `.apkg`** decks, or export JSON/CSV backups.

---

## Tech Stack

* **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Recharts, Lucide React
* **Offline & Imports**: IndexedDB, Workbox PWA (`vite-plugin-pwa`), `sql.js`, `JSZip`
* **APIs**: Free Dictionary API, Datamuse API, Gutendex / Project Gutenberg, GitHub Gist API, Pantry Cloud
* **Testing**: Playwright End-to-End & Unit Test Suite

---

## Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/aliseyfi75/Lumina.git
   cd Lumina
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```

## License

This project is open source and available under the [MIT License](LICENSE).
