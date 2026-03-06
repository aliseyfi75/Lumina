export const playAudio = (word: string, audioUrl?: string | null) => {
    if (audioUrl) {
        const audio = new Audio(audioUrl);

        // Attempt to play the audio file
        audio.play().catch((error) => {
            console.warn("Failed to play audio URL, falling back to speech synthesis:", error);
            playSynth(word);
        });
    } else {
        // No audio URL provided, use fallback
        playSynth(word);
    }
};

const playSynth = (word: string) => {
    if ('speechSynthesis' in window) {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(word);
        // Optional: we can try to set the language to en-US. 
        // Usually it defaults to the system's language.
        utterance.lang = 'en-US';

        window.speechSynthesis.speak(utterance);
    } else {
        console.warn("Speech synthesis is not supported in this browser.");
    }
};
