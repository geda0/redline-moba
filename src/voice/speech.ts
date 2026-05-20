// Browser voice input via the Web Speech API (Chrome / Edge). Press V to
// speak one command; the transcript is handed to the same resolveCommand
// path the text command bar uses — voice is just another front-end.
//
// The Gemini WS server (server/) is the richer-NLU upgrade path; this is the
// zero-dependency one that works offline-of-our-server.

// Minimal typings — SpeechRecognition isn't reliably in the TS DOM lib.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class VoiceInput {
  /** False on browsers without the Web Speech API (e.g. Firefox). */
  readonly supported: boolean;
  private rec: SpeechRecognitionLike | null = null;
  private listening = false;

  constructor(
    private readonly onTranscript: (text: string) => void,
    private readonly onState: (listening: boolean) => void,
  ) {
    const Ctor = recognitionCtor();
    this.supported = Ctor !== null;
    if (Ctor) {
      this.rec = new Ctor();
      this.rec.lang = "en-US";
      this.rec.interimResults = false;
      this.rec.continuous = false;
      this.rec.onresult = (e) => {
        const text = e.results[0]?.[0]?.transcript ?? "";
        if (text.trim()) this.onTranscript(text.trim());
      };
      this.rec.onend = () => { this.listening = false; this.onState(false); };
      this.rec.onerror = () => { this.listening = false; this.onState(false); };
    }

    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (document.activeElement?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "v") this.toggle();
    });
  }

  /** Start one utterance of recognition (no-op if already listening). */
  toggle(): void {
    if (!this.rec || this.listening) return;
    try {
      this.rec.start();
      this.listening = true;
      this.onState(true);
    } catch {
      this.listening = false;
      this.onState(false);
    }
  }
}
