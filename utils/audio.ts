let activeAudio: HTMLAudioElement | null = null;

export const stopAudio = () => {
    if (activeAudio) {
        try {
            activeAudio.pause();
            activeAudio.currentTime = 0;
        } catch {
            // ignore playback stop errors
        }
        activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
};

export const playAudio = (word: string, audioUrl?: string | null) => {
    stopAudio();

    if (audioUrl) {
        const audio = new Audio(audioUrl);
        activeAudio = audio;
        audio.onended = () => {
            if (activeAudio === audio) {
                activeAudio = null;
            }
        };

        // Attempt to play the audio file
        audio.play().catch((error) => {
            if (activeAudio === audio) {
                activeAudio = null;
            }
            console.warn("Failed to play audio URL, falling back to speech synthesis:", error);
            playSynth(word);
        });
    } else {
        // No audio URL provided, use fallback
        playSynth(word);
    }
};

const playSynth = (word: string) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
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
