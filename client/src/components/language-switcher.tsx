/**
 * Language selection, and an honest account of what is not on offer.
 *
 * Renders nothing when there is only one available language, which is the
 * current state: a switcher with a single option is furniture. It becomes a
 * control the moment a second language passes the gate in i18n.ts.
 *
 * The `<LanguageCoverage />` export is the operator-facing half. Languages
 * blocked for missing safety-critical strings or for want of clinical review are
 * listed with the reason, so "why can nobody pick isiZulu" has an answer visible
 * in the application rather than only in the source.
 */
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { availableLanguages, languageStatuses } from '@/lib/language-availability';

export function LanguageSwitcher() {
  const options = availableLanguages();
  const [current, setCurrent] = useState(options[0]?.code ?? 'en');

  // One language is not a choice, and the i18next runtime is not even loaded in
  // that case — so this reads the availability gate rather than i18n.language.
  if (options.length < 2) return null;

  return (
    <Select
      value={current}
      onValueChange={(code) => {
        setCurrent(code);
        // Imported here rather than at module scope: the runtime is only present
        // when there is more than one language, which is exactly this branch.
        void import('@/i18n').then((m) => m.setLanguage(code));
      }}
    >
      <SelectTrigger className="w-40 bg-slate-800 border-slate-600 text-white" aria-label="Language">
        <Globe className="w-4 h-4 mr-2 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-slate-800 border-slate-600">
        {options.map((option) => (
          <SelectItem key={option.code} value={option.code} className="text-white">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What is offered, what is not, and why. For the admin system view. */
export function LanguageCoverage() {
  const statuses = languageStatuses();

  return (
    <div className="space-y-2">
      {statuses.map((status) => (
        <div
          key={status.code}
          className="flex items-start justify-between gap-4 rounded border border-slate-700 bg-slate-900/40 p-3"
        >
          <div>
            <p className="text-white text-sm">
              {status.label} <span className="text-slate-500 font-mono text-xs">{status.code}</span>
            </p>
            {status.reason && <p className="text-xs text-amber-300 mt-0.5">{status.reason}</p>}
          </div>
          <span
            className={`text-xs font-mono uppercase tracking-wide px-2 py-1 rounded shrink-0 ${
              status.available
                ? 'bg-emerald-900/50 text-emerald-200'
                : 'bg-slate-700 text-slate-300'
            }`}
          >
            {status.available ? 'offered' : 'withheld'}
          </span>
        </div>
      ))}
      <p className="text-xs text-slate-500 pt-1">
        A language is offered only when every safety-critical string is translated and a
        clinical speaker has signed the translation off. Partial coverage would wrap
        translated navigation around an English "not a diagnosis" banner, which is the one
        string that most needs to be understood.
      </p>
    </div>
  );
}

export default LanguageSwitcher;
