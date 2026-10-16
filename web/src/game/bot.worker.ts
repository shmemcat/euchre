import { chooseAction } from "./ai";
import type { Observation } from "./engine";

self.onmessage = (
   event: MessageEvent<{ id: number; observation: Observation }>
) => {
   try {
      self.postMessage({
         id: event.data.id,
         action: chooseAction(event.data.observation),
      });
   } catch {
      self.postMessage({
         id: event.data.id,
         error: "Bot could not choose a move.",
      });
   }
};
