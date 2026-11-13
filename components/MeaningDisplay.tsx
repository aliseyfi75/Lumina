import React from 'react';
import { LocalizedTranslations, MeaningLanguagePreference } from '../types';
import { resolveMeaningDisplay } from '../utils/languageUtils';

interface MeaningDisplayProps {
  englishText: string;
  translations?: LocalizedTranslations;
  preference: MeaningLanguagePreference;
  /** Visual surface theme: 'lightAdaptive' follows app light/dark theme; 'darkCard' is always on a dark slate card back */
  variant?: 'lightAdaptive' | 'darkCard' | 'compact';
  englishClassName?: string;
  persianClassName?: string;
  containerClassName?: string;
  testIdPrefix?: string;
}

export const MeaningDisplay: React.FC<MeaningDisplayProps> = ({
  englishText,
  translations,
  preference,
  variant = 'lightAdaptive',
  englishClassName,
  persianClassName,
  containerClassName = '',
  testIdPrefix,
}) => {
  const resolved = resolveMeaningDisplay(englishText, translations, preference);

  const defaultEnglishClass =
    variant === 'darkCard'
      ? 'text-slate-100 text-sm sm:text-base leading-relaxed'
      : variant === 'compact'
        ? 'text-slate-600 dark:text-slate-300 text-sm leading-relaxed'
        : 'text-slate-800 dark:text-slate-100 text-base sm:text-lg leading-relaxed';

  const defaultPersianOnlyClass =
    variant === 'darkCard'
      ? 'font-persian text-slate-100 text-sm sm:text-base leading-relaxed text-right'
      : variant === 'compact'
        ? 'font-persian text-slate-700 dark:text-slate-200 text-sm leading-relaxed text-right'
        : 'font-persian text-slate-800 dark:text-slate-100 text-base sm:text-lg leading-relaxed text-right';

  const defaultPersianSecondaryClass =
    variant === 'darkCard'
      ? 'font-persian text-emerald-300/95 text-sm sm:text-base leading-relaxed text-right pt-2 border-t border-slate-700/70'
      : variant === 'compact'
        ? 'font-persian text-emerald-700 dark:text-emerald-300 text-sm leading-relaxed text-right pt-1.5 border-t border-slate-100 dark:border-slate-700/60'
        : 'font-persian text-emerald-800 dark:text-emerald-300 text-base sm:text-lg leading-relaxed text-right pt-2 border-t border-slate-100 dark:border-slate-700/70';

  return (
    <div
      className={`space-y-2 ${containerClassName}`.trim()}
      data-testid={testIdPrefix ? `${testIdPrefix}-meaning-container` : undefined}
    >
      {resolved.showEnglish && (
        <p
          lang="en"
          dir="ltr"
          data-testid={testIdPrefix ? `${testIdPrefix}-meaning-en` : undefined}
          className={englishClassName || defaultEnglishClass}
        >
          {resolved.englishText}
        </p>
      )}

      {resolved.showPersian && (
        <p
          lang="fa"
          dir="rtl"
          data-testid={testIdPrefix ? `${testIdPrefix}-meaning-fa` : undefined}
          className={
            persianClassName ||
            (resolved.showEnglish ? defaultPersianSecondaryClass : defaultPersianOnlyClass)
          }
        >
          {resolved.persianText}
        </p>
      )}
    </div>
  );
};
