<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/e5c54ecf-0760-4251-803d-bb08e0e526cf" />

# Lumina

**Illuminate your vocabulary.**

Lumina is a modern, elegant dictionary and flashcard application designed to help you master new words effectively. It bridges the gap between looking up a word and actually remembering it by combining a clean dictionary interface with a spaced-repetition study system.

👉 [Try Lumina Live Here](https://aliseyfi75.github.io/Lumina/)

[![Lumina](https://img.youtube.com/vi/zdaJXz-VHzA/0.jpg)](https://www.youtube.com/watch?v=zdaJXz-VHzA)

## Motivation

Learning new vocabulary often feels disjointed. You look up a word, understand it for a moment, and then forget it a day later. Traditional flashcard apps can be clunky to populate, requiring manual entry of definitions.

**Lumina solves this flow:**
1.  **Discover**: Instantly look up definitions, phonetics, and examples.
2.  **Capture**: With one click, turn any definition into a flashcard.
3.  **Master**: Use a study mode that helps you focus on words you find difficult.

## Features

*   **📖 Intelligent Dictionary**: Instant search with definitions, phonetics, parts of speech, and usage examples.
*   **⚡ One-Click Flashcards**: Seamlessly add words from the dictionary results directly to your deck.
*   **🧠 Spaced Repetition Study**: A focused study mode that prioritizes "New" and "Learning" cards over "Mastered" ones.
*   **☁️ Cloud Sync**: Sync your deck across devices using a free Pantry ID (JSON storage).
*   **📂 Data Freedom**: Import/Export your deck as CSV, or sync directly to a local file on your computer (File System Access API).
*   **🎨 Elegant UI**: A beautiful, distraction-free interface built with React and Tailwind CSS.

## How to Use

### 1. Dictionary & Search
Type a word into the search bar. Lumina provides autocomplete suggestions as you type.
*   Browse the meanings and examples.
*   Click the **"Add to Flashcards"** button next to the specific definition you want to remember.

### 2. Flashcard Deck
Navigate to the **Flashcards** tab to view your collection in a grid.
*   **Flip**: Click any card to reveal the definition on the back.
*   **Quick Status**: Mark cards as "Needs Work" or "Mastered" directly from the grid.
*   **Delete**: Remove cards you no longer need.

### 3. Study Session
When you have cards to review, click the **"Start Study Session"** button.
*   The app enters a focused, distraction-free mode.
*   It presents cards you haven't mastered yet.
*   Test yourself, flip the card, and rate your retention to update the card's status.

### 4. Sync & Backup (Data Manager)
Click the **Database/Cloud icon** in the top right header to open the Data Manager.

*   **Cloud Sync (Pantry)**: Enter a Pantry ID to sync your cards across different browsers or devices for free.
*   **CSV Import/Export**: Download your deck for safekeeping or import an existing list.
*   **Local File Sync**: (Desktop Chrome/Edge only) Connect a local `.csv` file on your hard drive. Lumina will auto-save changes to this file in the background.

## Tech Stack

*   **Frontend**: React 18, TypeScript, Vite
*   **Styling**: Tailwind CSS, Lucide React (Icons)
*   **APIs**:
    *   Free Dictionary API (Definitions)
    *   Datamuse API (Autocomplete suggestions)
    *   PantryCloud (JSON Storage)

## Installation

To run Lumina locally:

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```

## License

This project is open source and available under the [MIT License](LICENSE).
