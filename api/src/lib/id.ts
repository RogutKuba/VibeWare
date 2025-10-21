import { nanoid } from 'nanoid';

export const Entities = {
  deployment: 'd',
  sandbox: 's',
  agent: 'a',
  todo: 't',
} as const;

export type Entities = typeof Entities;

type IdsWithPrefixes = {
  [key in keyof Entities]: `${Entities[key]}_${string}`;
};

export type Id<T extends keyof Entities> = IdsWithPrefixes[T];

export type EntityKeys = keyof typeof Entities;
export const generateId = <T extends keyof Entities>(entity: T): Id<T> => {
  return `${Entities[entity]}_${nanoid()}` as Id<T>;
};
