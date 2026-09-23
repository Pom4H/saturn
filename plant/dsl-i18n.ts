import type { SaturnLocale } from './diagnostics';
import { text } from './i18n';
import { entities, operators, type DslEntity } from './dsl-reference';

export interface LocalizedDslEntity extends Omit<DslEntity, 'textKey' | 'noteKey'> {
  summary: string;
  note?: string;
}

export function localizedDslEntities(locale: SaturnLocale): LocalizedDslEntity[] {
  return entities.map(entity => {
    const { textKey, noteKey, ...stable } = entity;
    return {
      ...stable,
      summary: text(textKey, locale),
      ...(noteKey ? { note: text(noteKey, locale) } : {}),
    };
  });
}

export function localizedDslEntity(name: string, locale: SaturnLocale): LocalizedDslEntity | undefined {
  return localizedDslEntities(locale).find(entity => entity.name === name);
}

export function localizedDslOperators() {
  return operators.map(([name, signature]) => ({ name, signature }));
}
