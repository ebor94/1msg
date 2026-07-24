import { vi } from 'vitest';

const localStorageDB = {};

export const mockLocalStorage = {
  getItem: (key) => localStorageDB[key] || null,
  setItem: (key, value) => {
    localStorageDB[key] = String(value);
  },
  removeItem: (key) => {
    delete localStorageDB[key];
  },
  clear: () => {
    Object.keys(localStorageDB).forEach(key => delete localStorageDB[key]);
  },
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});
