import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
const data: Record<string, string> = {};
const storage: Storage = {
   getItem: (key) => data[key] ?? null,
   setItem: (key, value) => {
      data[key] = String(value);
   },
   removeItem: (key) => {
      delete data[key];
   },
   clear: () => {
      Object.keys(data).forEach((key) => delete data[key]);
   },
   key: (index) => Object.keys(data)[index] ?? null,
   get length() {
      return Object.keys(data).length;
   },
};
Object.defineProperty(globalThis, "localStorage", {
   value: storage,
   configurable: true,
});
beforeEach(() => {
   storage.clear();
});
afterEach(() => {
   cleanup();
   vi.restoreAllMocks();
});
