
import React from 'react';
import { VoicePersona } from '../types';

interface PersonaCardProps {
  persona: VoicePersona;
  isSelected: boolean;
  onSelect: (persona: VoicePersona) => void;
}

const PersonaCard: React.FC<PersonaCardProps> = ({ persona, isSelected, onSelect }) => {
  return (
    <button
      onClick={() => onSelect(persona)}
      className={`p-4 rounded-xl border transition-all duration-300 text-left ${
        isSelected 
          ? 'active-border shadow-lg shadow-amber-500/20' 
          : 'bg-black/20 border-white/5 hover:border-amber-500/30'
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className={`font-spiritual font-bold text-lg ${isSelected ? 'text-amber-400' : 'text-amber-100/80'}`}>{persona.name}</h3>
        {isSelected && (
          <span className="bg-amber-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider text-white">
            Guided
          </span>
        )}
      </div>
      <p className="text-sm text-stone-400 line-clamp-2 italic">"{persona.description}"</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-mono text-amber-500/70 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
          {persona.geminiVoice.toUpperCase()} RESONANCE
        </span>
      </div>
    </button>
  );
};

export default PersonaCard;
