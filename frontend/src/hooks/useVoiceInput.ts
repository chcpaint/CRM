import { useState, useCallback, useRef, useEffect } from 'react';

interface UseVoiceInputReturn {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  error: string | null;
}

export function useVoiceInput(onResult?: (text: string) => void): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const isSupported = !!SpeechRecognition;

  // Cleanup on unmount — prevents Safari from hanging with orphaned recognition sessions
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError('Speech recognition not supported in this browser');
      return;
    }

    // Abort any existing session first (Safari can't handle multiple)
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognition();
      // CRITICAL: continuous = false for Safari/iOS compatibility
      // Safari hangs indefinitely with continuous = true
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        const text = finalTranscript || interimTranscript;
        setTranscript(text);

        if (finalTranscript && onResultRef.current) {
          onResultRef.current(finalTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        // 'no-speech' is normal (user didn't say anything), not a real error
        // 'aborted' happens on cleanup, also not a real error
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setError(`Voice error: ${event.error}`);
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setError(`Could not start voice: ${err.message || 'unknown error'}`);
      setIsListening(false);
    }
  }, [isSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      // Use abort() instead of stop() — abort() is immediate and reliable on Safari
      // stop() can hang waiting for speech to "finish"
      try { recognitionRef.current.abort(); } catch (_) { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  return { isListening, transcript, startListening, stopListening, isSupported, error };
}
