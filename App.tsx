
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { PERSONAS, AUDIO_SAMPLE_RATE_INPUT, AUDIO_SAMPLE_RATE_OUTPUT } from './constants.ts';
import { VoicePersona, TranscriptionEntry } from './types.ts';
import { createPcmBlob, decode, decodeAudioData } from './services/audioUtils.ts';
import PersonaCard from './components/PersonaCard.tsx';
import AudioVisualizer from './components/AudioVisualizer.tsx';

const App: React.FC = () => {
  // UI State
  const [selectedPersona, setSelectedPersona] = useState<VoicePersona>(PERSONAS[0]);
  const [isLive, setIsLive] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Audio Processing Refs
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const analyserInRef = useRef<AnalyserNode | null>(null);
  const analyserOutRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // Transcription buffer
  const currentInputText = useRef<string>('');
  const currentOutputText = useRef<string>('');

  const stopSession = useCallback(() => {
    setIsLive(false);

    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => {
        try {
          session.close();
        } catch (e) {
          console.debug('Error closing session:', e);
        }
      });
      sessionPromiseRef.current = null;
    }
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    const ctxIn = audioContextInRef.current;
    if (ctxIn && ctxIn.state !== 'closed') {
      ctxIn.close().catch(err => console.debug('Error closing ctxIn:', err));
    }
    audioContextInRef.current = null;

    const ctxOut = audioContextOutRef.current;
    if (ctxOut && ctxOut.state !== 'closed') {
      ctxOut.close().catch(err => console.debug('Error closing ctxOut:', err));
    }
    audioContextOutRef.current = null;
    
    sourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  const startSession = async () => {
    try {
      setError(null);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const ctxIn = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE_INPUT });
      const ctxOut = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE_OUTPUT });
      audioContextInRef.current = ctxIn;
      audioContextOutRef.current = ctxOut;

      const anaIn = ctxIn.createAnalyser();
      const anaOut = ctxOut.createAnalyser();
      analyserInRef.current = anaIn;
      analyserOutRef.current = anaOut;

      const outputGain = ctxOut.createGain();
      outputGain.connect(anaOut);
      anaOut.connect(ctxOut.destination);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedPersona.geminiVoice } },
          },
          systemInstruction: selectedPersona.systemInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            const source = ctxIn.createMediaStreamSource(stream);
            const scriptProcessor = ctxIn.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(anaIn);
            source.connect(scriptProcessor);
            scriptProcessor.connect(ctxIn.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              currentOutputText.current += message.serverContent.outputTranscription.text;
            } else if (message.serverContent?.inputTranscription) {
              currentInputText.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              if (currentInputText.current || currentOutputText.current) {
                const newEntries: TranscriptionEntry[] = [];
                if (currentInputText.current) {
                  newEntries.push({ role: 'user', text: currentInputText.current, timestamp: Date.now() });
                }
                if (currentOutputText.current) {
                  newEntries.push({ role: 'model', text: currentOutputText.current, timestamp: Date.now() });
                }
                setTranscriptions(prev => [...prev, ...newEntries].slice(-50));
                currentInputText.current = '';
                currentOutputText.current = '';
              }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctxOut.currentTime);
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                ctxOut,
                AUDIO_SAMPLE_RATE_OUTPUT,
                1
              );
              
              const source = ctxOut.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputGain);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const s of sourcesRef.current.values()) {
                try { s.stop(); } catch(e) {}
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            setError('The celestial connection was interrupted.');
            stopSession();
          },
          onclose: () => {
            stopSession();
          },
        },
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (err: any) {
      setError(err.message || 'Failed to establish spiritual link.');
      stopSession();
    }
  };

  const handleShare = () => {
    const text = "Exploring the wisdom of Bhagwat Geeta & Ramayan with this Real-time AI Guide. 🕉️✨";
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: 'Dharmic Wisdom Explainer', text, url });
    } else {
      navigator.clipboard.writeText(`${text} ${url}`);
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2000);
    }
  };

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptions]);

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-amber-600/20 border border-amber-500/40 flex items-center justify-center text-3xl shadow-inner">🕉️</div>
          <div>
            <h1 className="text-4xl font-spiritual font-black saffron-gradient tracking-tight">
              DHARMIC WISDOM
            </h1>
            <p className="text-stone-500 font-mono text-xs tracking-widest uppercase">Geeta & Ramayan Real-time Guide</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-amber-500/20 text-xs font-bold text-amber-500 hover:bg-amber-500/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
            {shareSuccess ? 'LINK COPIED' : 'SHARE SATSANG'}
          </button>
          <div className="flex items-center gap-3 glass px-4 py-2 rounded-full border border-amber-500/20">
            <div className={`w-3 h-3 rounded-full ${isLive ? 'bg-orange-500 animate-pulse' : 'bg-stone-700'}`}></div>
            <span className="text-xs font-bold uppercase tracking-widest text-stone-400">
              {isLive ? 'Divine Aura Active' : 'Seeking Enlightenment'}
            </span>
          </div>
        </div>
      </header>

      {/* Error Message */}
      {error && (
        <div className="w-full bg-orange-900/20 border border-orange-500/50 p-4 rounded-xl text-orange-200 text-sm flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
          {error}
        </div>
      )}

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
        
        {/* Left Column: Personas */}
        <div className="lg:col-span-4 space-y-6">
          <section className="glass p-6 rounded-2xl border-amber-500/10">
            <h2 className="text-xl font-spiritual font-bold mb-4 flex items-center gap-2 text-amber-200/90">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              Choose Your Guide
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {PERSONAS.map(p => (
                <PersonaCard 
                  key={p.id} 
                  persona={p} 
                  isSelected={selectedPersona.id === p.id} 
                  onSelect={(p) => {
                    if (isLive) stopSession();
                    setSelectedPersona(p);
                  }}
                />
              ))}
            </div>
          </section>
          
          {/* Signal Panel */}
          <section className="glass p-6 rounded-2xl border-amber-500/10">
            <h2 className="text-xl font-spiritual font-bold mb-4 flex items-center gap-2 text-amber-200/90">
              <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              Spiritual Frequencies
            </h2>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-stone-500 uppercase mb-2 tracking-widest">Seeker's Voice</p>
                <AudioVisualizer analyser={analyserInRef.current} isActive={isLive && !isMuted} color="#f59e0b" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-stone-500 uppercase mb-2 tracking-widest">Guide's Resonance</p>
                <AudioVisualizer analyser={analyserOutRef.current} isActive={isLive} color="#ea580c" />
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Interaction Hub */}
        <div className="lg:col-span-8 flex flex-col space-y-6">
          <section className="glass flex-1 p-6 rounded-2xl flex flex-col min-h-[500px] border-amber-500/10 relative overflow-hidden">
            {/* Background pattern */}
            <div className="absolute top-0 right-0 opacity-5 pointer-events-none select-none text-[200px] leading-none -mr-20 -mt-10">🕉️</div>
            
            <h2 className="text-xl font-spiritual font-bold mb-4 flex items-center gap-2 text-amber-200/90">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>
              Satsang Transcript
            </h2>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-6 scrollbar-thin scrollbar-thumb-amber-600/30">
              {transcriptions.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-stone-600 text-center px-8">
                  <div className="w-20 h-20 rounded-full bg-amber-600/5 border border-amber-600/20 flex items-center justify-center mb-6 shadow-inner">
                    <svg className="w-10 h-10 text-amber-600/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                  </div>
                  <p className="font-spiritual text-amber-200/50 text-lg mb-2">Silence is the first step to wisdom</p>
                  <p className="text-sm italic text-stone-500">Ask about life, Dharma, any shlok or story from the holy epics.</p>
                </div>
              )}
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                  <div className={`max-w-[85%] p-5 rounded-3xl ${
                    t.role === 'user' 
                      ? 'bg-amber-900/30 text-amber-100 rounded-tr-none border border-amber-700/30' 
                      : 'bg-stone-900/50 text-stone-200 rounded-tl-none border border-stone-800 shadow-xl'
                  }`}>
                    <p className={`text-md leading-relaxed ${t.role === 'model' ? 'font-serif' : ''}`}>{t.text}</p>
                    <div className={`flex items-center gap-2 mt-3 opacity-60 ${t.role === 'user' ? 'justify-end' : ''}`}>
                       <span className="text-[10px] uppercase font-mono tracking-widest">
                        {t.role === 'user' ? 'Seeker' : selectedPersona.name}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            {/* Controls */}
            <div className="mt-8 pt-6 border-t border-amber-500/10 flex flex-wrap gap-4 items-center justify-center">
              {!isLive ? (
                <button
                  onClick={startSession}
                  className="px-10 py-5 bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white rounded-full font-spiritual font-bold text-lg flex items-center gap-3 transition-all animate-pulse-gold shadow-2xl shadow-orange-900/40 transform active:scale-95"
                >
                  <span className="text-2xl">🕉️</span>
                  INVOKE WISDOM
                </button>
              ) : (
                <div className="flex gap-4">
                   <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={`p-5 rounded-full border transition-all ${
                      isMuted 
                        ? 'bg-orange-900/40 border-orange-500 text-orange-400' 
                        : 'bg-stone-800/50 border-stone-700 text-stone-300 hover:bg-stone-700'
                    }`}
                  >
                    {isMuted ? (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    )}
                  </button>
                  <button
                    onClick={stopSession}
                    className="px-10 py-5 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/50 rounded-full font-spiritual font-bold flex items-center gap-3 transition-all"
                  >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" /></svg>
                    DISCONNECT
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="w-full text-center py-10 text-stone-600 font-mono text-[10px] uppercase tracking-[0.3em] flex flex-col gap-3 items-center">
        <div className="flex items-center gap-4 text-amber-900/20 text-xl font-spiritual select-none">
          <span>ॐ</span> <span>शान्ति:</span> <span>शान्ति:</span> <span>शान्ति:</span>
        </div>
        <div className="flex items-center gap-6 mb-2">
           <a href="https://github.com/adeshbhumihar" target="_blank" rel="noopener noreferrer" className="text-stone-700 hover:text-amber-600 transition-colors uppercase tracking-widest text-[9px] border-b border-transparent hover:border-amber-600">Documentation</a>
           <a href="#" className="text-stone-700 hover:text-amber-600 transition-colors uppercase tracking-widest text-[9px] border-b border-transparent hover:border-amber-600">Privacy Policy</a>
        </div>
        <span>Dharmic Neural Resonance v2.1.0 // Powered by Gemini Live</span>
        <span className="text-amber-600/40 font-bold border-t border-amber-900/10 pt-4 px-10">Made by Adesh Bhumihar</span>
      </footer>
    </div>
  );
};

export default App;
